-- Activation codes and licences. Nobody opens a restaurant without a one-time code the seller
-- issues on the yönetim page and sends over WhatsApp. The code carries a plan (how many registers
-- the restaurant may have) and a number of days; opening the restaurant uses the code up and starts
-- its licence. A register keeps syncing for seven days after the licence ends, then the server
-- refuses it until the seller extends it. Markets opened before codes keep no licence end
-- (unlimited) and the Restoran plan.
--
-- The seller is an operator: a row in app.operators, inserted by hand in the SQL editor. Every
-- operator function checks that row; no client role holds any privilege on these tables.

create table app.plans (
  id text primary key check (id ~ '^[a-z]{1,20}$'),
  name text not null check (length(trim(name)) between 1 and 40),
  -- Null: any number of registers.
  max_devices integer check (max_devices is null or max_devices >= 1)
);
insert into app.plans (id, name, max_devices) values
  ('qr', 'QR Menü', 1),
  ('restoran', 'Restoran', 5),
  ('pro', 'Restoran Pro', null);

-- Every market so far, Grenn bar among them, takes the default and keeps its null licence end.
alter table app.markets
  add column plan_id text not null default 'restoran' references app.plans (id);

create table app.activation_codes (
  code text primary key
    check (code ~ '^RK-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  plan_id text not null references app.plans (id),
  days integer not null check (days between 1 and 3660),
  note text check (note is null or length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by_market text references app.markets (id) on delete set null,
  revoked_at timestamptz
);
create index activation_codes_recent on app.activation_codes (created_at desc);

create table app.operators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Defence in depth, as for every app table: no policy and no grant.
alter table app.plans enable row level security;
alter table app.activation_codes enable row level security;
alter table app.operators enable row level security;
revoke all on app.plans, app.activation_codes, app.operators from public, anon, authenticated;

/**
 * RK- and twelve characters from one random UUID (pg_strong_random), leaving out the two bytes
 * that carry its version and variant. The alphabet has no 0/O or 1/I, since the code is read out
 * or typed from a message; 32 letters, so each byte gives five even bits: 60 in all.
 */
create function app.new_activation_code() returns text
language sql volatile set search_path = '' as $$
  select 'RK-' || substr(drawn.chars, 1, 4) || '-' || substr(drawn.chars, 5, 4) || '-'
    || substr(drawn.chars, 9, 4)
  from (
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        1 + get_byte(random.bytes, byte.n) % 32, 1), '' order by byte.n) as chars
    from (select uuid_send(gen_random_uuid()) as bytes) random,
      generate_series(0, 13) byte(n)
    where byte.n not in (6, 8)
  ) drawn
$$;

/**
 * The code as stored (RK-XXXX-XXXX-XXXX) from however it was typed: any case, with or without the
 * RK and the dashes, spaces anywhere. Null when it cannot be a code.
 */
create function app.canonical_activation_code(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case when length(bare.chars) = 12
    then 'RK-' || substr(bare.chars, 1, 4) || '-' || substr(bare.chars, 5, 4) || '-'
      || substr(bare.chars, 9, 4)
  end
  from (
    select case when length(typed.chars) = 14 and left(typed.chars, 2) = 'RK'
      then substr(typed.chars, 3) else typed.chars end as chars
    from (select regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g') as chars) typed
  ) bare
$$;

/** The market's plan and licence end, as a register is told them. */
create function app.license_of(p_market text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'plan', p.id, 'planName', p.name, 'maxDevices', p.max_devices,
    'licenseExpiresAt', m.license_expires_at)
  from app.markets m join app.plans p on p.id = m.plan_id
  where m.id = p_market
$$;

/** Refuses a market whose licence ended more than seven days ago. No end is no limit. */
create function app.require_license(p_market text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if exists (
    select 1 from app.markets
    where id = p_market and license_expires_at is not null
      and now() > license_expires_at + interval '7 days'
  ) then
    raise exception 'license_expired';
  end if;
end
$$;

/** True when the caller signed in with a password and is an operator. */
create function app.is_operator() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
    and exists (select 1 from app.operators where user_id = auth.uid())
$$;

create function app.require_operator() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
end
$$;

/**
 * Opens a market for the signed-in person with an activation code, and makes them its owner. The
 * code is taken in the statement that marks it used, so of two shops sending one code at once the
 * second finds it used; anything refused later rolls the use back with the market. An unknown,
 * used or revoked code is refused alike. At most three markets each.
 */
create function public.create_own_market(name text, code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(create_own_market.name, ''));
  v_code app.activation_codes;
  v_id text;
  v_expires timestamptz;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_signed_in';
  end if;
  if length(v_name) not between 1 and 60 then
    raise exception 'bad_name';
  end if;
  if (select count(*) from app.memberships where user_id = auth.uid() and role = 'owner') >= 3 then
    raise exception 'too_many_markets';
  end if;
  update app.activation_codes set used_at = now()
  where activation_codes.code = app.canonical_activation_code(create_own_market.code)
    and used_at is null and revoked_at is null
  returning * into v_code;
  if not found then
    raise exception 'activation_invalid';
  end if;
  loop
    v_id := app.market_id_for(v_name);
    exit when not exists (select 1 from app.markets where id = v_id);
  end loop;
  v_expires := now() + v_code.days * interval '1 day';
  insert into app.markets (id, name, plan_id, license_expires_at)
  values (v_id, v_name, v_code.plan_id, v_expires);
  insert into app.memberships (market_id, user_id, role) values (v_id, auth.uid(), 'owner');
  update app.activation_codes set used_by_market = v_id
  where activation_codes.code = v_code.code;
  return jsonb_build_object('id', v_id, 'name', v_name);
end
$$;

/** The call of a register built before codes: it is told to update instead of opening a market. */
create or replace function public.create_own_market(name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'activation_required';
end
$$;

/**
 * Binds the caller's session to the market the code was made for, as a new register. Without a
 * register code it takes the next free one (K1, K2…). With `replace`, a register holding the
 * same code is revoked first: the owner's code is the consent. A new register past the plan's
 * limit is refused with the limit ('device_limit 5'); taking over a code is not a new register,
 * and a revoked register counts for nothing.
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

/** Where the caller's register belongs, with its plan and licence end; null when it is not one. */
create or replace function public.my_device() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'marketId', m.id, 'marketName', m.name, 'deviceId', d.id, 'deviceCode', d.code,
    'revoked', d.revoked_at is not null) || app.license_of(m.id)
  from app.devices d join app.markets m on m.id = d.market_id
  where d.auth_user_id = auth.uid()
$$;

/**
 * Applies a register's queued operations in order. Each operation is applied once per opId; one
 * that is refused is reported and its record sent again, so the register's value reverts.
 * Refused as a whole once the market's licence is past its grace.
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
  perform app.lock_market(v_device.market_id);
  for v_op in select value from jsonb_array_elements(ops) loop
    if jsonb_typeof(v_op -> 'opId') is distinct from 'string' then
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
      v_reason := app.apply_op(v_device.market_id, v_op);
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

/**
 * The market's rows changed after `since`, in sequence order, at most `lim` (1–1000) of them, and
 * the market's plan and licence end, so the register can warn before the licence runs out.
 * Refused once the licence is past its grace.
 */
create or replace function public.sync_pull(since bigint, lim integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_device app.devices := app.current_device();
  v_since bigint := greatest(coalesce(since, 0), 0);
  v_rows jsonb;
begin
  perform app.require_license(v_device.market_id);
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

-- The operator's functions, for the yönetim page. Each answers only an operator.

/** Whether the caller is an operator; the yönetim page asks before it shows anything. */
create function public.operator_whoami() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_operator()
$$;

/** A new, unused code for a plan and a number of days (1–3660), with a note of who it is for. */
create function public.issue_activation_code(plan_id text, days integer, note text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(trim(coalesce(issue_activation_code.note, '')), '');
  v_code text;
begin
  perform app.require_operator();
  if not exists (select 1 from app.plans where id = issue_activation_code.plan_id) then
    raise exception 'bad_plan';
  end if;
  if issue_activation_code.days is null or issue_activation_code.days not between 1 and 3660 then
    raise exception 'bad_days';
  end if;
  if length(v_note) > 200 then
    raise exception 'bad_note';
  end if;
  loop
    v_code := app.new_activation_code();
    exit when not exists (select 1 from app.activation_codes c where c.code = v_code);
  end loop;
  insert into app.activation_codes (code, plan_id, days, note, created_by)
  values (v_code, issue_activation_code.plan_id, issue_activation_code.days, v_note, auth.uid());
  return v_code;
end
$$;

/** The latest codes, newest first, at most `lim` (1–200), each with what became of it. */
create function public.list_activation_codes(lim integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'code', c.code, 'plan', c.plan_id, 'planName', p.name, 'days', c.days, 'note', c.note,
        'createdAt', c.created_at, 'usedAt', c.used_at, 'revokedAt', c.revoked_at,
        'marketId', c.used_by_market, 'marketName', m.name,
        'status', case
          when c.used_at is not null then 'used'
          when c.revoked_at is not null then 'revoked'
          else 'unused' end)
        order by c.created_at desc, c.code), '[]'::jsonb)
    from (
      select * from app.activation_codes
      order by created_at desc, code
      limit least(greatest(coalesce(lim, 50), 1), 200)
    ) c
    join app.plans p on p.id = c.plan_id
    left join app.markets m on m.id = c.used_by_market);
end
$$;

/** Retires a code no one has used yet; it then opens nothing. */
create function public.revoke_activation_code(code text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_code app.activation_codes;
begin
  perform app.require_operator();
  select * into v_code from app.activation_codes c
  where c.code = app.canonical_activation_code(revoke_activation_code.code)
  for update;
  if not found then
    raise exception 'code_not_found';
  end if;
  if v_code.used_at is not null then
    raise exception 'code_used';
  end if;
  update app.activation_codes c set revoked_at = coalesce(c.revoked_at, now())
  where c.code = v_code.code;
end
$$;

/**
 * The latest restaurants, newest first, at most `lim` (1–200): plan, licence end, how many
 * registers are not revoked, when one was last seen, and the owner's email.
 */
create function public.list_markets(lim integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'status', m.status, 'plan', p.id, 'planName', p.name,
        'maxDevices', p.max_devices, 'createdAt', m.created_at,
        'licenseExpiresAt', m.license_expires_at, 'devices', d.active, 'lastSeenAt', d.last_seen,
        'ownerEmail', o.email)
        order by m.created_at desc, m.id), '[]'::jsonb)
    from (
      select * from app.markets
      order by created_at desc, id
      limit least(greatest(coalesce(lim, 50), 1), 200)
    ) m
    join app.plans p on p.id = m.plan_id
    cross join lateral (
      select count(*) filter (where dv.revoked_at is null)::int as active,
        max(dv.last_seen_at) as last_seen
      from app.devices dv where dv.market_id = m.id
    ) d
    left join lateral (
      select u.email from app.memberships ms join auth.users u on u.id = ms.user_id
      where ms.market_id = m.id and ms.role = 'owner'
      order by u.email limit 1
    ) o on true);
end
$$;

/**
 * Adds days (1–3660) to a licence: from its end while it runs, from now once it has ended. A
 * market without an end (opened before codes) is refused, so no extension ever limits it.
 */
create function public.extend_license(market_id text, days integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_market app.markets;
begin
  perform app.require_operator();
  if extend_license.days is null or extend_license.days not between 1 and 3660 then
    raise exception 'bad_days';
  end if;
  select * into v_market from app.markets m where m.id = extend_license.market_id for update;
  if not found then
    raise exception 'market_not_found';
  end if;
  if v_market.license_expires_at is null then
    raise exception 'license_unlimited';
  end if;
  update app.markets m
  set license_expires_at = greatest(now(), m.license_expires_at)
    + extend_license.days * interval '1 day'
  where m.id = v_market.id
  returning * into v_market;
  return jsonb_build_object('licenseExpiresAt', v_market.license_expires_at);
end
$$;

/** Moves a restaurant to another plan; registers past a smaller limit keep working. */
create function public.set_market_plan(market_id text, plan_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_operator();
  if not exists (select 1 from app.plans p where p.id = set_market_plan.plan_id) then
    raise exception 'bad_plan';
  end if;
  update app.markets m set plan_id = set_market_plan.plan_id
  where m.id = set_market_plan.market_id;
  if not found then
    raise exception 'market_not_found';
  end if;
end
$$;

revoke execute on function app.new_activation_code() from public, anon, authenticated;
revoke execute on function app.canonical_activation_code(text) from public, anon, authenticated;
revoke execute on function app.license_of(text) from public, anon, authenticated;
revoke execute on function app.require_license(text) from public, anon, authenticated;
revoke execute on function app.is_operator() from public, anon, authenticated;
revoke execute on function app.require_operator() from public, anon, authenticated;

revoke execute on function public.create_own_market(text, text) from public, anon;
revoke execute on function public.operator_whoami() from public, anon;
revoke execute on function public.issue_activation_code(text, integer, text) from public, anon;
revoke execute on function public.list_activation_codes(integer) from public, anon;
revoke execute on function public.revoke_activation_code(text) from public, anon;
revoke execute on function public.list_markets(integer) from public, anon;
revoke execute on function public.extend_license(text, integer) from public, anon;
revoke execute on function public.set_market_plan(text, text) from public, anon;
grant execute on function public.create_own_market(text, text) to authenticated;
grant execute on function public.operator_whoami() to authenticated;
grant execute on function public.issue_activation_code(text, integer, text) to authenticated;
grant execute on function public.list_activation_codes(integer) to authenticated;
grant execute on function public.revoke_activation_code(text) to authenticated;
grant execute on function public.list_markets(integer) to authenticated;
grant execute on function public.extend_license(text, integer) to authenticated;
grant execute on function public.set_market_plan(text, text) to authenticated;
