-- Follow-up to the security review of 2026-11-20 (the second, outside review). Safe to run on the
-- live project: one new nullable column with no default (a catalogue change; no row is rewritten
-- or touched), one new function, seven functions replaced with the same signatures (their grants
-- are kept; each restates its empty search_path) and the old two-argument app.apply_op dropped,
-- which only sync_push called.
--
-- 1. A record is kept under its own id. An insert whose record names another id, or a patch that
--    clears or changes the id, is refused (bad_record): stored, it would overwrite that other
--    record on every register that pulls it. A record sent without an id is stored with it.
-- 2. Every row remembers which register last sent it (app.rows.pushed_by; for an event, the one
--    that wrote it, since an event never changes). The registers of a restaurant trust each other
--    by design (README, "Who may write what"), and a row's own deviceCode or staffId are whatever
--    the sending register wrote; this column is the server's own record of who sent it. It never
--    reaches the registers.
-- 3. sync_push checks the register and the licence again once it holds the market's lock: a push
--    that waited on it while the owner revoked the register, or the seller suspended the market,
--    writes nothing after them. An empty opId, which every op could share, is a bad op.
-- 4. Past the licence's seven days of grace, or once suspended, a market gets no pairing code, no
--    new register, and cannot turn its QR menu on or give it a new link; it may still turn it off.
--    Nothing of this worked before either (such a market neither syncs nor serves its menu); the
--    owner is now told why at once instead of later.
-- 5. sync_pull also marks the register seen, at most every five minutes, so a kitchen screen that
--    only reads shows as alive on the yönetim page.

alter table app.rows add column pushed_by uuid;
comment on column app.rows.pushed_by is
  'The register (app.devices.id) that last sent this row through sync_push; null before 2026-11-23.';

/**
 * Applies one queued operation from register `p_device`; returns null when applied, else why it
 * was refused. A record id longer than 128 characters is a bad record, and so is a record or patch
 * whose own id is not the record id; a record over a megabyte of JSON, as sent or once a patch is
 * merged into it, is too large.
 */
create function app.apply_op(p_market text, p_device uuid, p_op jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_table text := p_op ->> 'table';
  v_id text := p_op ->> 'recordId';
  v_kind text := p_op ->> 'kind';
  v_max_bytes constant integer := 1048576;
  v_fields jsonb;
  v_row jsonb;
begin
  if v_table is null or not (v_table = any (app.entity_tables() || app.event_tables())) then
    return 'unknown_table';
  end if;
  if v_id is null or v_id = '' or length(v_id) > 128 then
    return 'bad_record';
  end if;

  if v_kind not in ('insert', 'patch') then
    return 'unknown_kind';
  end if;
  if v_kind = 'patch' and not (v_table = any (app.entity_tables())) then
    return 'not_patchable';
  end if;
  v_fields := p_op -> (case v_kind when 'insert' then 'record' else 'patch' end);
  if jsonb_typeof(v_fields) is distinct from 'object' then
    return 'bad_record';
  end if;
  -- A register stores a row under its own id. One naming another record would overwrite that
  -- record on every register that pulls it, and a patch clearing the id would leave a row no
  -- register can store.
  if v_fields ? 'id' and (v_fields -> 'id') is distinct from to_jsonb(v_id) then
    return 'bad_record';
  end if;
  if octet_length(v_fields::text) > v_max_bytes then
    return 'too_large';
  end if;

  select row into v_row from app.rows
  where market_id = p_market and tbl = v_table and id = v_id
  for update;
  if not found then
    if v_kind = 'patch' then
      -- A patch for a record the server never received changes nothing, as on the fake server.
      return null;
    end if;
    insert into app.rows (market_id, tbl, id, server_seq, row, pushed_by)
    values (p_market, v_table, v_id, nextval('app.server_seq'),
      app.normalized(v_table, v_fields || jsonb_build_object('id', v_id)), p_device);
  elsif v_table = any (app.event_tables()) then
    -- An event is written once; a second copy of it changes nothing, not even who sent it.
    return null;
  else
    -- A patch, or a second insert of an entity (two registers saving the same fixed-id record
    -- offline): merged field by field, so the later arrival wins each field it sends.
    -- A null field clears it; every other field replaces the stored one.
    v_row := (v_row || coalesce(
        (select jsonb_object_agg(key, value) from jsonb_each(v_fields) where value <> 'null'::jsonb),
        '{}'::jsonb))
      - coalesce(
        (select array_agg(key) from jsonb_each(v_fields) where value = 'null'::jsonb),
        array[]::text[]);
    v_row := app.normalized(v_table, v_row || jsonb_build_object('id', v_id));
    if octet_length(v_row::text) > v_max_bytes then
      return 'too_large';
    end if;
    update app.rows
    set row = v_row, server_seq = nextval('app.server_seq'), received_at = now(),
      pushed_by = p_device
    where market_id = p_market and tbl = v_table and id = v_id;
  end if;

  if v_table = 'products' then
    perform app.settle_barcode(p_market, (
      select row ->> 'barcode' from app.rows
      where market_id = p_market and tbl = 'products' and id = v_id));
  end if;
  return null;
end
$$;

/**
 * Applies a register's queued operations in order. Each operation is applied once per opId; one
 * that is refused is reported and its record sent again, so the register's value reverts.
 * Refused as a whole once the market's licence is past its grace or the market is suspended, and
 * for more than a thousand operations in one call; an opId that is empty or longer than 128
 * characters is a bad op. The register and the licence are checked again under the market's lock.
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

drop function app.apply_op(text, jsonb);

/**
 * The market's rows changed after `since`, in sequence order, at most `lim` (1–1000) of them, and
 * the market's plan and licence end, so the register can warn before the licence runs out.
 * Refused once the licence is past its grace. Marks the register seen, at most every five minutes.
 */
create or replace function public.sync_pull(since bigint, lim integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_device app.devices := app.current_device();
  v_since bigint := greatest(coalesce(since, 0), 0);
  v_rows jsonb;
begin
  perform app.require_license(v_device.market_id);
  -- A register that only reads (a kitchen screen) is seen too, without a write on every pull.
  update app.devices set last_seen_at = now()
  where id = v_device.id
    and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
  select coalesce(jsonb_agg(jsonb_build_object(
      'table', page.tbl, 'id', page.id, 'serverSeq', page.server_seq, 'row', page.row)
      order by page.server_seq), '[]'::jsonb)
  into v_rows
  from (
    select tbl, id, server_seq, row from app.rows
    where market_id = v_device.market_id and server_seq > v_since
    order by server_seq
    limit least(greatest(coalesce(lim, 1), 1), 1000)
  ) page;
  return jsonb_build_object(
    'rows', v_rows,
    'latest', coalesce(
      (select max((item ->> 'serverSeq')::bigint) from jsonb_array_elements(v_rows) item),
      v_since),
    'license', app.license_of(v_device.market_id));
end
$$;

/**
 * A one-time code, good for ten minutes, that binds one register to this market. None for a
 * market past its licence's grace, or suspended: the register could not sync.
 */
create or replace function public.create_pairing(market_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not app.is_owner(market_id) then
    raise exception 'not_owner';
  end if;
  perform app.require_license(market_id);
  loop
    v_code := app.new_pairing_code();
    exit when not exists (select 1 from app.pairings where code = v_code);
  end loop;
  insert into app.pairings (code, market_id, created_by, expires_at)
  values (v_code, market_id, auth.uid(), now() + interval '10 minutes');
  return v_code;
end
$$;

/**
 * Binds the caller's session to the market the code was made for, as a new register. Without a
 * register code it takes the next free one (K1, K2…). With `replace`, a register holding the
 * same code is revoked first: the owner's code is the consent. A new register past the plan's
 * limit is refused with the limit ('device_limit 5'); taking over a code is not a new register,
 * and a revoked register counts for nothing. A market past its licence's grace, or suspended,
 * takes no register; the code is left unused, for once the licence is extended.
 */
create or replace function public.claim_device(
  code text, device_code text, device_name text, platform text, replace boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pairing app.pairings;
  v_market app.markets;
  v_max integer;
  v_device_id uuid := gen_random_uuid();
  v_code text := upper(trim(coalesce(device_code, '')));
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  if platform not in ('windows', 'android', 'web') then
    raise exception 'bad_platform';
  end if;
  if v_code <> '' and v_code !~ '^[A-Z][A-Z0-9]{0,3}$' then
    raise exception 'bad_device_code';
  end if;
  if exists (select 1 from app.devices where auth_user_id = auth.uid()) then
    raise exception 'already_registered';
  end if;
  -- Claiming marks the code used in the same statement, so two registers cannot share one.
  update app.pairings set used_at = now()
  where pairings.code = upper(trim(claim_device.code))
    and used_at is null and expires_at > now()
  returning * into v_pairing;
  if not found then
    raise exception 'pairing_invalid';
  end if;
  perform app.lock_market(v_pairing.market_id);
  -- Raised here, the code's use rolls back with everything else.
  perform app.require_license(v_pairing.market_id);
  select * into v_market from app.markets where id = v_pairing.market_id;
  if v_code <> '' and exists (
    select 1 from app.devices
    where market_id = v_pairing.market_id and devices.code = v_code and revoked_at is null
  ) then
    if not replace then
      raise exception 'device_code_taken';
    end if;
    update app.devices set revoked_at = now()
    where market_id = v_pairing.market_id and devices.code = v_code and revoked_at is null;
  else
    select max_devices into v_max from app.plans where id = v_market.plan_id;
    if v_max is not null and (
      select count(*) from app.devices
      where market_id = v_pairing.market_id and revoked_at is null
    ) >= v_max then
      raise exception 'device_limit %', v_max;
    end if;
    if v_code = '' then
      select 'K' || n into v_code
      from generate_series(1, 999) n
      where not exists (
        select 1 from app.devices
        where market_id = v_pairing.market_id and devices.code = 'K' || n and revoked_at is null)
      order by n limit 1;
    end if;
  end if;
  insert into app.devices (id, market_id, auth_user_id, code, name, platform, last_seen_at)
  values (v_device_id, v_pairing.market_id, auth.uid(), v_code,
    coalesce(nullif(trim(coalesce(device_name, '')), ''), 'Kasa ' || v_code), platform, now());
  return jsonb_build_object(
    'marketId', v_market.id, 'marketName', v_market.name,
    'deviceId', v_device_id, 'deviceCode', v_code);
end
$$;

/**
 * Turns the market's QR menu on or off; the first time, it is given its link. Owners only. A
 * market past its licence's grace, or suspended, may turn it off but not on.
 */
create or replace function public.set_qr_menu(market_id text, enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_menu app.qr_menus;
begin
  if not app.is_owner(set_qr_menu.market_id) then
    raise exception 'not_owner';
  end if;
  if set_qr_menu.enabled is null then
    raise exception 'bad_request';
  end if;
  if set_qr_menu.enabled then
    perform app.require_license(set_qr_menu.market_id);
  end if;
  insert into app.qr_menus (market_id, slug, enabled)
  values (set_qr_menu.market_id, app.new_menu_slug(), set_qr_menu.enabled)
  on conflict on constraint qr_menus_pkey
    do update set enabled = excluded.enabled, updated_at = now()
  returning * into v_menu;
  return jsonb_build_object('enabled', v_menu.enabled, 'slug', v_menu.slug);
end
$$;

/**
 * Gives the market's QR menu a new link; the old one stops working at once. Owners only, and not
 * for a market past its licence's grace, or suspended.
 */
create or replace function public.rotate_qr_menu(market_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_menu app.qr_menus;
begin
  if not app.is_owner(rotate_qr_menu.market_id) then
    raise exception 'not_owner';
  end if;
  perform app.require_license(rotate_qr_menu.market_id);
  insert into app.qr_menus (market_id, slug, enabled)
  values (rotate_qr_menu.market_id, app.new_menu_slug(), false)
  on conflict on constraint qr_menus_pkey
    do update set slug = excluded.slug, updated_at = now()
  returning * into v_menu;
  return jsonb_build_object('enabled', v_menu.enabled, 'slug', v_menu.slug);
end
$$;

revoke execute on function app.apply_op(text, uuid, jsonb) from public, anon, authenticated;
