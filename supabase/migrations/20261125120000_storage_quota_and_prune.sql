-- Two housekeeping guards for a growing database.
--
-- 1. A market's synced rows are capped (default 200 MB, per-market override). The size is kept in
--    app.market_usage by a trigger on app.rows, so sync_push reads one row instead of scanning.
-- 2. app.prune() drops what is only ever needed for a while: applied_ops older than 90 days and
--    pairings that expired more than 7 days ago. Scheduled daily with pg_cron when the extension
--    is available; otherwise run `select app.prune();` by hand in the SQL editor.
--
-- Live-safe: only adds objects, one column with a stable default (existing applied_ops take the
-- migration time, so nothing is pruned for 90 days), and a backfill of the counter. sync_push
-- below is the 20261123120000 version plus one check.

create table app.market_usage (
  market_id text primary key references app.markets (id) on delete cascade,
  bytes bigint not null default 0,
  -- Null means the default (app.default_storage_limit()).
  limit_bytes bigint
);
alter table app.market_usage enable row level security;
revoke all on app.market_usage from public, anon, authenticated;

insert into app.market_usage (market_id, bytes)
select market_id, sum(pg_column_size(row))::bigint from app.rows group by market_id;

create function app.default_storage_limit() returns bigint language sql immutable as $$
  select 200::bigint * 1024 * 1024
$$;

create function app.track_row_size() returns trigger language plpgsql as $$
declare
  v_delta bigint;
  v_market text;
begin
  if tg_op = 'INSERT' then
    v_delta := pg_column_size(new.row);
    v_market := new.market_id;
  elsif tg_op = 'UPDATE' then
    v_delta := pg_column_size(new.row) - pg_column_size(old.row);
    v_market := new.market_id;
  else
    v_delta := -pg_column_size(old.row);
    v_market := old.market_id;
  end if;
  if tg_op = 'DELETE' then
    -- A market being deleted cascades here after its usage row may be gone: update only.
    update app.market_usage set bytes = greatest(bytes + v_delta, 0) where market_id = v_market;
  else
    insert into app.market_usage (market_id, bytes) values (v_market, greatest(v_delta, 0))
    on conflict (market_id) do update set bytes = greatest(app.market_usage.bytes + v_delta, 0);
  end if;
  return null;
end
$$;

create trigger rows_track_size after insert or update of row or delete on app.rows
  for each row execute function app.track_row_size();


alter table app.applied_ops add column created_at timestamptz not null default now();
create index applied_ops_created on app.applied_ops (created_at);

/**
 * Applies a register's queued operations in order. Each operation is applied once per opId; one
 * that is refused is reported and its record sent again, so the register's value reverts.
 * Refused as a whole once the market's licence is past its grace or the market is suspended, for
 * more than a thousand operations in one call, and with 'quota_exceeded' once the market's rows
 * pass its storage limit; an opId that is empty or longer than 128 characters is a bad op. The
 * register, the licence and the quota are checked again under the market's lock.
 */
create or replace function public.sync_push(ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_device app.devices := app.current_device();
  v_op jsonb;
  v_reason text;
  v_acknowledged jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  perform app.require_license(v_device.market_id);
  if jsonb_typeof(ops) is distinct from 'array' then
    raise exception 'bad_request';
  end if;
  if jsonb_array_length(ops) > 1000 then
    raise exception 'too_many_ops';
  end if;
  perform app.lock_market(v_device.market_id);
  -- Read again under the lock: revoke_device and a suspension commit before this push goes on,
  -- and a register revoked (or a market suspended) while this push waited writes nothing.
  v_device := app.current_device();
  perform app.require_license(v_device.market_id);
  if coalesce((select bytes from app.market_usage where market_id = v_device.market_id), 0)
    > coalesce((select limit_bytes from app.market_usage where market_id = v_device.market_id),
      app.default_storage_limit()) then
    raise exception 'quota_exceeded';
  end if;
  for v_op in select value from jsonb_array_elements(ops) loop
    if jsonb_typeof(v_op -> 'opId') is distinct from 'string'
      or length(v_op ->> 'opId') not between 1 and 128 then
      v_reason := 'bad_op';
    elsif exists (
      select 1 from app.applied_ops where market_id = v_device.market_id and op_id = v_op ->> 'opId'
    ) then
      v_reason := null;
      -- A retry of an edit whose answer was lost. The register has kept replaying it over newer
      -- rows from other registers; sending the record again gives it the current value.
      if (v_op ->> 'table') = any (app.entity_tables()) then
        perform app.resend(v_device.market_id, v_op ->> 'table', v_op ->> 'recordId');
      end if;
    else
      v_reason := app.apply_op(v_device.market_id, v_device.id, v_op);
      if v_reason is null then
        insert into app.applied_ops (market_id, op_id) values (v_device.market_id, v_op ->> 'opId');
      else
        perform app.resend(v_device.market_id, v_op ->> 'table', v_op ->> 'recordId');
      end if;
    end if;
    if jsonb_typeof(v_op -> 'seq') = 'number' then
      if v_reason is null then
        v_acknowledged := v_acknowledged || jsonb_build_array(v_op -> 'seq');
      else
        v_rejected := v_rejected || jsonb_build_array(
          jsonb_build_object('seq', v_op -> 'seq', 'reason', v_reason));
      end if;
    end if;
  end loop;
  update app.devices set last_seen_at = now() where id = v_device.id;
  return jsonb_build_object('acknowledged', v_acknowledged)
    || case when jsonb_array_length(v_rejected) > 0
         then jsonb_build_object('rejected', v_rejected) else '{}'::jsonb end;
end
$$;

revoke execute on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;

/**
 * Housekeeping: drops applied_ops older than 90 days (a register replaying an operation that old
 * is long past any outbox) and pairings that expired more than 7 days ago. Leaves devices,
 * revoked registers and their anonymous sessions alone. Returns what it deleted.
 */
create function app.prune() returns jsonb language plpgsql set search_path = '' as $$
declare
  v_ops bigint;
  v_pairings bigint;
begin
  delete from app.applied_ops where created_at < now() - interval '90 days';
  get diagnostics v_ops = row_count;
  delete from app.pairings where expires_at < now() - interval '7 days';
  get diagnostics v_pairings = row_count;
  return jsonb_build_object('appliedOps', v_ops, 'pairings', v_pairings);
end
$$;
revoke execute on function app.prune() from public, anon, authenticated;

-- Daily at 03:15 UTC, only where pg_cron can be enabled; elsewhere run `select app.prune();` by hand.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('restoran-kasa-prune', '15 3 * * *', 'select app.prune()');
exception when others then
  raise notice 'pg_cron not available (%): run select app.prune(); by hand', sqlerrm;
end
$$;
