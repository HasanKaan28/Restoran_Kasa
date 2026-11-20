-- The seller's yönetim page becomes a console (2026-11-27): an overview, each restaurant's detail
-- and the actions on it, aggregated use, announcements to the registers, better codes and a log
-- of everything the operator changed.
--
-- Live-safe:
-- - Two nullable columns on app.markets with no default (a catalogue change; the check on the
--   override reads the few market rows once, all null, under a short lock).
-- - Three new tables (app.operator_log, app.announcements, app.market_notes), no client grant.
-- - Functions replaced with the same signatures (create or replace keeps their grants; each
--   restates its empty search_path): app.license_of, public.sync_pull, public.claim_device,
--   public.owner_devices, public.list_markets, public.issue_activation_code,
--   public.revoke_activation_code, public.extend_license and public.set_market_plan.
-- - No stored row is changed, moved or deleted. Nothing is ever hard-deleted from here: a
--   restaurant "deleted" by the operator is suspended and marked, and activating it again brings
--   it back with all its data.
--
-- Compatibility: sync_pull's answer gains one key, `announcements`; `rows`, `latest` and
-- `license` are unchanged, so registers built before this ignore it and keep syncing. The
-- licence's `maxDevices` is now the restaurant's own limit when the operator set one.
--
-- Privacy (KVKK): the operator sees counts of what a restaurant synced (sales, tabs, registers
-- in the last 30 days, rows per table, storage), never a sale, a tab, a customer or any row.

-- A per-restaurant register limit, set by the operator; null keeps the plan's.
alter table app.markets add column max_devices_override integer
  check (max_devices_override is null or max_devices_override between 1 and 999);
-- Set when the operator deletes the restaurant: it is suspended too, and kept.
alter table app.markets add column deleted_at timestamptz;

/** Every change the operator makes from the yönetim page, newest last. */
create table app.operator_log (
  id bigint generated always as identity primary key,
  operator_id uuid references auth.users (id) on delete set null,
  action text not null check (action ~ '^[a-z]+[.][a-z_]+$'),
  -- No foreign key: the line outlives anything it names.
  market_id text,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index operator_log_by_market on app.operator_log (market_id, id desc);

/** A short message to one restaurant's registers, or (market_id null) to every restaurant's. */
create table app.announcements (
  id uuid primary key default gen_random_uuid(),
  market_id text references app.markets (id) on delete cascade,
  message text not null check (length(trim(message)) between 1 and 280),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Null: until the operator removes it.
  expires_at timestamptz,
  removed_at timestamptz
);
create index announcements_live on app.announcements (market_id) where removed_at is null;

/** The operator's own note on a restaurant; no register or owner ever reads it. */
create table app.market_notes (
  market_id text primary key references app.markets (id) on delete cascade,
  note text not null check (length(note) between 1 and 2000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Defence in depth, as for every app table: no policy and no grant.
alter table app.operator_log enable row level security;
alter table app.announcements enable row level security;
alter table app.market_notes enable row level security;
revoke all on app.operator_log, app.announcements, app.market_notes
  from public, anon, authenticated;

/** Writes one line of the operator's log, as the calling operator. */
create function app.log_operator(p_action text, p_market text, p_details jsonb)
returns void
language sql volatile set search_path = '' as $$
  insert into app.operator_log (operator_id, action, market_id, details)
  values (auth.uid(), p_action, p_market, coalesce(p_details, '{}'::jsonb))
$$;

/** The number of live registers a market may have: its own limit, else its plan's (null: any). */
create function app.max_devices_of(p_market text) returns integer
language sql stable set search_path = '' as $$
  select coalesce(m.max_devices_override, p.max_devices)
  from app.markets m join app.plans p on p.id = m.plan_id
  where m.id = p_market
$$;

/** The market's plan, register limit and licence end, as a register is told them. */
create or replace function app.license_of(p_market text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'plan', p.id, 'planName', p.name,
    'maxDevices', coalesce(m.max_devices_override, p.max_devices),
    'licenseExpiresAt', m.license_expires_at)
  from app.markets m join app.plans p on p.id = m.plan_id
  where m.id = p_market
$$;

/** The announcements a market's registers show now: its own and everyone's, newest first, ≤ 5. */
create function app.live_announcements(p_market text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'message', a.message, 'createdAt', a.created_at, 'expiresAt', a.expires_at)
      order by a.created_at desc, a.id), '[]'::jsonb)
  from (
    select * from app.announcements an
    where an.removed_at is null
      and (an.expires_at is null or an.expires_at > now())
      and (an.market_id is null or an.market_id = p_market)
    order by an.created_at desc, an.id
    limit 5
  ) a
$$;

/** What a market synced in the last 30 days, as counts only. */
create function app.market_activity(p_market text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'sales', (
      select count(*) from app.rows r
      where r.market_id = p_market and r.tbl = 'sales'
        and r.received_at > now() - interval '30 days'),
    'tabs', (
      select count(*) from app.rows r
      where r.market_id = p_market and r.tbl = 'tabs'
        and r.received_at > now() - interval '30 days'),
    'activeDevices', (
      select count(*) from app.devices d
      where d.market_id = p_market and d.revoked_at is null
        and d.last_seen_at > now() - interval '30 days'))
$$;

/** The market, locked for the operator's change; raises when there is none. */
create function app.operator_market_for_update(p_market text) returns app.markets
language plpgsql volatile set search_path = '' as $$
declare
  v_market app.markets;
begin
  -- The market's lock first, as sync_push takes it: a push waiting on it sees the change.
  perform app.lock_market(p_market);
  select * into v_market from app.markets m where m.id = p_market for update;
  if not found then
    raise exception 'market_not_found';
  end if;
  return v_market;
end
$$;

/**
 * The market's rows changed after `since`, in sequence order, at most `lim` (1–1000) of them, the
 * market's plan and licence end, and the operator's announcements for its registers. Refused once
 * the licence is past its grace. Marks the register seen, at most every five minutes.
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
    'license', app.license_of(v_device.market_id),
    'announcements', app.live_announcements(v_device.market_id));
end
$$;

/**
 * Binds the caller's session to the market the code was made for, as a new register. Without a
 * register code it takes the next free one (K1, K2…). With `replace`, a register holding the
 * same code is revoked first: the owner's code is the consent. A new register past the market's
 * limit (its own, else its plan's) is refused with the limit ('device_limit 5'); taking over a
 * code is not a new register, and a revoked register counts for nothing. A market past its
 * licence's grace, or suspended, takes no register; the code is left unused.
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
    v_max := app.max_devices_of(v_pairing.market_id);
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
 * The live registers of a market the caller owns, oldest first, and the market's limit (its own,
 * else its plan's; null: any number). A revoked register is left out.
 */
create or replace function public.owner_devices(market_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner(owner_devices.market_id) then
    raise exception 'not_owner';
  end if;
  return jsonb_build_object(
    'maxDevices', app.max_devices_of(owner_devices.market_id),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', d.id, 'code', d.code, 'name', d.name, 'platform', d.platform,
          'lastSeenAt', d.last_seen_at)
        order by d.created_at, d.code)
      from app.devices d
      where d.market_id = owner_devices.market_id and d.revoked_at is null
    ), '[]'::jsonb));
end
$$;

/**
 * The latest restaurants, newest first, at most `lim` (1–200): plan, register limit, licence end,
 * how many registers are not revoked, when one was last seen, the owner's email, and whether the
 * operator deleted it.
 */
create or replace function public.list_markets(lim integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'status', m.status, 'plan', p.id, 'planName', p.name,
        'maxDevices', coalesce(m.max_devices_override, p.max_devices),
        'planMaxDevices', p.max_devices, 'maxDevicesOverride', m.max_devices_override,
        'createdAt', m.created_at, 'deletedAt', m.deleted_at,
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

-- The older operator functions, now logging what they change.

/** A new, unused code for a plan and a number of days (1–3660), with a note of who it is for. */
create or replace function public.issue_activation_code(plan_id text, days integer, note text)
returns text
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
  perform app.log_operator('code.issue', null, jsonb_build_object(
    'plan', issue_activation_code.plan_id, 'days', issue_activation_code.days, 'count', 1,
    'note', v_note, 'codes', jsonb_build_array(v_code)));
  return v_code;
end
$$;

/** Retires a code no one has used yet; it then opens nothing. */
create or replace function public.revoke_activation_code(code text) returns void
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
  perform app.log_operator('code.revoke', null, jsonb_build_object('code', v_code.code));
end
$$;

/**
 * Adds days (1–3660) to a licence: from its end while it runs, from now once it has ended. A
 * market without an end (opened before codes) is refused, so no extension ever limits it.
 */
create or replace function public.extend_license(market_id text, days integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_market app.markets;
  v_before timestamptz;
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
  v_before := v_market.license_expires_at;
  update app.markets m
  set license_expires_at = greatest(now(), m.license_expires_at)
    + extend_license.days * interval '1 day'
  where m.id = v_market.id
  returning * into v_market;
  perform app.log_operator('license.extend', v_market.id, jsonb_build_object(
    'days', extend_license.days, 'from', v_before, 'to', v_market.license_expires_at));
  return jsonb_build_object('licenseExpiresAt', v_market.license_expires_at);
end
$$;

/** Moves a restaurant to another plan; registers past a smaller limit keep working. */
create or replace function public.set_market_plan(market_id text, plan_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_before text;
begin
  perform app.require_operator();
  if not exists (select 1 from app.plans p where p.id = set_market_plan.plan_id) then
    raise exception 'bad_plan';
  end if;
  select m.plan_id into v_before from app.markets m where m.id = set_market_plan.market_id
  for update;
  if not found then
    raise exception 'market_not_found';
  end if;
  update app.markets m set plan_id = set_market_plan.plan_id
  where m.id = set_market_plan.market_id;
  perform app.log_operator('market.plan', set_market_plan.market_id, jsonb_build_object(
    'from', v_before, 'to', set_market_plan.plan_id));
end
$$;

-- The console's reads.

/**
 * Counts for the overview: restaurants by state (deleted ones apart), codes by what became of
 * them, live registers, and the restaurants whose licence ends within seven days or ended within
 * its seven days of grace, soonest first, at most 20.
 */
create function public.operator_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator();
  return jsonb_build_object(
    'restaurants', (
      select jsonb_build_object(
        'total', count(*) filter (where m.deleted_at is null),
        'active', count(*) filter (where m.deleted_at is null and m.status = 'active'
          and (m.license_expires_at is null or m.license_expires_at > now())),
        'suspended', count(*) filter (where m.deleted_at is null and m.status = 'suspended'),
        'expiring', count(*) filter (where m.deleted_at is null and m.status = 'active'
          and m.license_expires_at > now()
          and m.license_expires_at <= now() + interval '7 days'),
        'expired', count(*) filter (where m.deleted_at is null and m.status = 'active'
          and m.license_expires_at <= now()),
        'deleted', count(*) filter (where m.deleted_at is not null))
      from app.markets m),
    'codes', (
      select jsonb_build_object(
        'issued', count(*),
        'used', count(*) filter (where c.used_at is not null),
        'unused', count(*) filter (where c.used_at is null and c.revoked_at is null),
        'revoked', count(*) filter (where c.used_at is null and c.revoked_at is not null))
      from app.activation_codes c),
    'devices', (
      select jsonb_build_object(
        'total', count(*),
        'seenToday', count(*) filter (where d.last_seen_at > now() - interval '1 day'))
      from app.devices d join app.markets m on m.id = d.market_id
      where d.revoked_at is null and m.deleted_at is null),
    'expiring', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', e.id, 'name', e.name, 'status', e.status, 'planName', e.plan_name,
          'licenseExpiresAt', e.license_expires_at)
          order by e.license_expires_at, e.id), '[]'::jsonb)
      from (
        select m.id, m.name, m.status, p.name as plan_name, m.license_expires_at
        from app.markets m join app.plans p on p.id = m.plan_id
        where m.deleted_at is null and m.license_expires_at is not null
          and m.license_expires_at <= now() + interval '7 days'
          and m.license_expires_at > now() - interval '7 days'
        order by m.license_expires_at, m.id
        limit 20
      ) e));
end
$$;

/**
 * One restaurant as the seller looks after it: plan, limits, licence, owner, storage, rows per
 * table, last sync, QR menu, the operator's note, its registers (live first, at most 100) and
 * its last 30 days of use. Counts only: no synced row leaves through here.
 */
create function public.operator_market(market_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_market app.markets;
  v_plan app.plans;
begin
  perform app.require_operator();
  select * into v_market from app.markets m where m.id = operator_market.market_id;
  if not found then
    raise exception 'market_not_found';
  end if;
  select * into v_plan from app.plans p where p.id = v_market.plan_id;
  return jsonb_build_object(
    'id', v_market.id, 'name', v_market.name, 'status', v_market.status,
    'deletedAt', v_market.deleted_at, 'plan', v_plan.id, 'planName', v_plan.name,
    'planMaxDevices', v_plan.max_devices, 'maxDevicesOverride', v_market.max_devices_override,
    'maxDevices', coalesce(v_market.max_devices_override, v_plan.max_devices),
    'licenseExpiresAt', v_market.license_expires_at, 'createdAt', v_market.created_at,
    'ownerEmail', (
      select u.email from app.memberships ms join auth.users u on u.id = ms.user_id
      where ms.market_id = v_market.id and ms.role = 'owner'
      order by u.email limit 1),
    'storage', (
      select jsonb_build_object(
        'bytes', coalesce(max(mu.bytes), 0),
        'limitBytes', coalesce(max(mu.limit_bytes), app.default_storage_limit()))
      from app.market_usage mu where mu.market_id = v_market.id),
    'rowCounts', (
      select coalesce(jsonb_agg(jsonb_build_object('table', c.tbl, 'count', c.n)
          order by c.tbl), '[]'::jsonb)
      from (
        select r.tbl, count(*) as n from app.rows r
        where r.market_id = v_market.id
        group by r.tbl order by r.tbl limit 50
      ) c),
    'lastSyncAt', (
      select max(d.last_seen_at) from app.devices d where d.market_id = v_market.id),
    'qrMenu', (
      select jsonb_build_object('enabled', q.enabled, 'slug', q.slug)
      from app.qr_menus q where q.market_id = v_market.id),
    'note', (select n.note from app.market_notes n where n.market_id = v_market.id),
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', d.id, 'code', d.code, 'name', d.name, 'platform', d.platform,
          'createdAt', d.created_at, 'lastSeenAt', d.last_seen_at, 'revokedAt', d.revoked_at)
          order by d.revoked_at is not null, d.created_at, d.code), '[]'::jsonb)
      from (
        select * from app.devices dv
        where dv.market_id = v_market.id
        order by dv.revoked_at is not null, dv.created_at, dv.code
        limit 100
      ) d),
    'activity', app.market_activity(v_market.id));
end
$$;

/** The last 30 days of use of the latest restaurants (at most `lim`, 1–200), as counts. */
create function public.operator_activity(lim integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator();
  return (
    select coalesce(jsonb_agg(
        jsonb_build_object('id', m.id, 'name', m.name) || app.market_activity(m.id)
        order by m.created_at desc, m.id), '[]'::jsonb)
    from (
      select * from app.markets mk
      where mk.deleted_at is null
      order by mk.created_at desc, mk.id
      limit least(greatest(coalesce(lim, 50), 1), 200)
    ) m);
end
$$;

/**
 * The operator's log, newest first: at most `lim` (1–200) lines older than `before_id` when one
 * is given, and only one restaurant's when `market_id` is.
 */
create function public.operator_history(lim integer, before_id bigint, market_id text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'at', l.at, 'action', l.action, 'marketId', l.market_id,
        'marketName', mk.name, 'operatorEmail', u.email, 'details', l.details)
        order by l.id desc), '[]'::jsonb)
    from (
      select * from app.operator_log ol
      where (operator_history.before_id is null or ol.id < operator_history.before_id)
        and (operator_history.market_id is null or ol.market_id = operator_history.market_id)
      order by ol.id desc
      limit least(greatest(coalesce(lim, 50), 1), 200)
    ) l
    left join app.markets mk on mk.id = l.market_id
    left join auth.users u on u.id = l.operator_id);
end
$$;

/**
 * The latest codes, newest first, at most `lim` (1–500): only those in `status` (unused, used or
 * revoked) when given, and only those whose note or code holds `search` (letters as typed, any
 * case) when given.
 */
create function public.operator_list_codes(lim integer, status text, search text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_status text := nullif(trim(coalesce(operator_list_codes.status, '')), '');
  v_search text := left(nullif(trim(coalesce(operator_list_codes.search, '')), ''), 100);
  v_pattern text;
begin
  perform app.require_operator();
  if v_status is not null and v_status not in ('unused', 'used', 'revoked') then
    raise exception 'bad_status';
  end if;
  v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'code', c.code, 'plan', c.plan_id, 'planName', p.name, 'days', c.days, 'note', c.note,
        'createdAt', c.created_at, 'usedAt', c.used_at, 'revokedAt', c.revoked_at,
        'marketId', c.used_by_market, 'marketName', m.name, 'status', c.state)
        order by c.created_at desc, c.code), '[]'::jsonb)
    from (
      select ac.*, case
          when ac.used_at is not null then 'used'
          when ac.revoked_at is not null then 'revoked'
          else 'unused' end as state
      from app.activation_codes ac
      where (v_status is null or v_status = case
          when ac.used_at is not null then 'used'
          when ac.revoked_at is not null then 'revoked'
          else 'unused' end)
        and (v_search is null or ac.note ilike v_pattern or ac.code ilike v_pattern)
      order by ac.created_at desc, ac.code
      limit least(greatest(coalesce(lim, 100), 1), 500)
    ) c
    join app.plans p on p.id = c.plan_id
    left join app.markets m on m.id = c.used_by_market);
end
$$;

/** The latest announcements (at most `lim`, 1–200), newest first, live or not. */
create function public.operator_list_announcements(lim integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_operator();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'marketId', a.market_id, 'marketName', m.name, 'message', a.message,
        'createdAt', a.created_at, 'expiresAt', a.expires_at, 'removedAt', a.removed_at,
        'live', a.removed_at is null and (a.expires_at is null or a.expires_at > now()))
        order by a.created_at desc, a.id), '[]'::jsonb)
    from (
      select * from app.announcements an
      order by an.created_at desc, an.id
      limit least(greatest(coalesce(lim, 50), 1), 200)
    ) a
    left join app.markets m on m.id = a.market_id);
end
$$;

-- The console's changes. Each answers only an operator and writes a line of the log.

/** Issues `count` (1–50) codes at once for one plan, period and note; returns them. */
create function public.operator_issue_codes(plan_id text, days integer, note text, count integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(trim(coalesce(operator_issue_codes.note, '')), '');
  v_codes jsonb := '[]'::jsonb;
  v_code text;
begin
  perform app.require_operator();
  if not exists (select 1 from app.plans p where p.id = operator_issue_codes.plan_id) then
    raise exception 'bad_plan';
  end if;
  if operator_issue_codes.days is null or operator_issue_codes.days not between 1 and 3660 then
    raise exception 'bad_days';
  end if;
  if length(v_note) > 200 then
    raise exception 'bad_note';
  end if;
  if operator_issue_codes.count is null or operator_issue_codes.count not between 1 and 50 then
    raise exception 'bad_count';
  end if;
  for i in 1..operator_issue_codes.count loop
    loop
      v_code := app.new_activation_code();
      exit when not exists (select 1 from app.activation_codes c where c.code = v_code);
    end loop;
    insert into app.activation_codes (code, plan_id, days, note, created_by)
    values (v_code, operator_issue_codes.plan_id, operator_issue_codes.days, v_note, auth.uid());
    v_codes := v_codes || jsonb_build_array(v_code);
  end loop;
  perform app.log_operator('code.issue', null, jsonb_build_object(
    'plan', operator_issue_codes.plan_id, 'days', operator_issue_codes.days,
    'count', operator_issue_codes.count, 'note', v_note, 'codes', v_codes));
  return v_codes;
end
$$;

/**
 * Suspends a restaurant (its registers stop syncing, its QR menu stops) or activates it again.
 * Activating a deleted restaurant brings it back.
 */
create function public.operator_set_market_status(market_id text, status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_market app.markets;
  v_before app.markets;
begin
  perform app.require_operator();
  if operator_set_market_status.status is null
    or operator_set_market_status.status not in ('active', 'suspended') then
    raise exception 'bad_status';
  end if;
  v_before := app.operator_market_for_update(operator_set_market_status.market_id);
  update app.markets m
  set status = operator_set_market_status.status,
    deleted_at = case when operator_set_market_status.status = 'active' then null
      else m.deleted_at end
  where m.id = v_before.id
  returning * into v_market;
  perform app.log_operator('market.status', v_market.id, jsonb_build_object(
    'from', v_before.status, 'to', v_market.status,
    'restored', v_before.deleted_at is not null and v_market.deleted_at is null));
  return jsonb_build_object('status', v_market.status, 'deletedAt', v_market.deleted_at);
end
$$;

/**
 * Sets the licence's end directly: later, earlier (it may end it at once), or null for no end.
 * Within ten years either side of today.
 */
create function public.operator_set_license(market_id text, expires_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before app.markets;
  v_market app.markets;
begin
  perform app.require_operator();
  if operator_set_license.expires_at is not null and (
    operator_set_license.expires_at < now() - interval '3660 days'
    or operator_set_license.expires_at > now() + interval '3660 days') then
    raise exception 'bad_date';
  end if;
  v_before := app.operator_market_for_update(operator_set_license.market_id);
  update app.markets m set license_expires_at = operator_set_license.expires_at
  where m.id = v_before.id
  returning * into v_market;
  perform app.log_operator('license.set', v_market.id, jsonb_build_object(
    'from', v_before.license_expires_at, 'to', v_market.license_expires_at));
  return jsonb_build_object('licenseExpiresAt', v_market.license_expires_at);
end
$$;

/** Gives a restaurant its own register limit (1–999), or null to follow its plan again. */
create function public.operator_set_max_devices(market_id text, max_devices integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before app.markets;
begin
  perform app.require_operator();
  if operator_set_max_devices.max_devices is not null
    and operator_set_max_devices.max_devices not between 1 and 999 then
    raise exception 'bad_max_devices';
  end if;
  v_before := app.operator_market_for_update(operator_set_max_devices.market_id);
  update app.markets m set max_devices_override = operator_set_max_devices.max_devices
  where m.id = v_before.id;
  perform app.log_operator('market.max_devices', v_before.id, jsonb_build_object(
    'from', v_before.max_devices_override, 'to', operator_set_max_devices.max_devices));
  return jsonb_build_object(
    'maxDevicesOverride', operator_set_max_devices.max_devices,
    'maxDevices', app.max_devices_of(v_before.id));
end
$$;

/** Renames a restaurant (1–60 characters); its registers show the new name after a restart. */
create function public.operator_rename_market(market_id text, name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(operator_rename_market.name, ''));
  v_before app.markets;
begin
  perform app.require_operator();
  if length(v_name) not between 1 and 60 then
    raise exception 'bad_name';
  end if;
  v_before := app.operator_market_for_update(operator_rename_market.market_id);
  update app.markets m set name = v_name where m.id = v_before.id;
  perform app.log_operator('market.rename', v_before.id, jsonb_build_object(
    'from', v_before.name, 'to', v_name));
  return jsonb_build_object('name', v_name);
end
$$;

/** Turns a restaurant's QR menu on or off, as its owner can; the first time, it gets its link. */
create function public.operator_set_qr_menu(market_id text, enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_market app.markets;
  v_menu app.qr_menus;
begin
  perform app.require_operator();
  if operator_set_qr_menu.enabled is null then
    raise exception 'bad_request';
  end if;
  v_market := app.operator_market_for_update(operator_set_qr_menu.market_id);
  insert into app.qr_menus (market_id, slug, enabled)
  values (v_market.id, app.new_menu_slug(), operator_set_qr_menu.enabled)
  on conflict on constraint qr_menus_pkey
    do update set enabled = excluded.enabled, updated_at = now()
  returning * into v_menu;
  perform app.log_operator('qr.set', v_market.id, jsonb_build_object('enabled', v_menu.enabled));
  return jsonb_build_object('enabled', v_menu.enabled, 'slug', v_menu.slug);
end
$$;

/** Gives a restaurant's QR menu a new link; the old one, and every card printed with it, stop. */
create function public.operator_rotate_qr_menu(market_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_market app.markets;
  v_menu app.qr_menus;
begin
  perform app.require_operator();
  v_market := app.operator_market_for_update(operator_rotate_qr_menu.market_id);
  insert into app.qr_menus (market_id, slug, enabled)
  values (v_market.id, app.new_menu_slug(), false)
  on conflict on constraint qr_menus_pkey
    do update set slug = excluded.slug, updated_at = now()
  returning * into v_menu;
  perform app.log_operator('qr.rotate', v_market.id, '{}'::jsonb);
  return jsonb_build_object('enabled', v_menu.enabled, 'slug', v_menu.slug);
end
$$;

/**
 * A one-time pairing code, good for ten minutes, so the seller can attach a register for the
 * customer (claim_device takes it as it takes the owner's). None for a restaurant past its
 * licence's grace, or suspended. The code is not written to the log.
 */
create function public.operator_create_pairing(market_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_market app.markets;
  v_code text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  perform app.require_operator();
  select * into v_market from app.markets m where m.id = operator_create_pairing.market_id;
  if not found then
    raise exception 'market_not_found';
  end if;
  perform app.require_license(v_market.id);
  loop
    v_code := app.new_pairing_code();
    exit when not exists (select 1 from app.pairings pr where pr.code = v_code);
  end loop;
  insert into app.pairings (code, market_id, created_by, expires_at)
  values (v_code, v_market.id, auth.uid(), v_expires);
  perform app.log_operator('pairing.create', v_market.id, jsonb_build_object(
    'expiresAt', v_expires));
  return jsonb_build_object('code', v_code, 'expiresAt', v_expires);
end
$$;

/** Keeps the operator's note on a restaurant (at most 2000 characters); empty removes it. */
create function public.operator_set_note(market_id text, note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(trim(coalesce(operator_set_note.note, '')), '');
begin
  perform app.require_operator();
  if length(v_note) > 2000 then
    raise exception 'note_too_long';
  end if;
  if not exists (select 1 from app.markets m where m.id = operator_set_note.market_id) then
    raise exception 'market_not_found';
  end if;
  if v_note is null then
    delete from app.market_notes n where n.market_id = operator_set_note.market_id;
  else
    insert into app.market_notes (market_id, note, updated_by)
    values (operator_set_note.market_id, v_note, auth.uid())
    on conflict on constraint market_notes_pkey
      do update set note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform app.log_operator('note.set', operator_set_note.market_id, jsonb_build_object(
    'length', coalesce(length(v_note), 0)));
end
$$;

/**
 * Deletes a restaurant softly: it is suspended and marked deleted, and nothing of it is removed;
 * activating it again brings it back. The restaurant's name must be typed to confirm (any case).
 */
create function public.operator_delete_market(market_id text, confirm_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before app.markets;
  v_market app.markets;
begin
  perform app.require_operator();
  v_before := app.operator_market_for_update(operator_delete_market.market_id);
  if lower(trim(coalesce(operator_delete_market.confirm_name, ''))) <> lower(trim(v_before.name))
  then
    raise exception 'name_mismatch';
  end if;
  update app.markets m
  set status = 'suspended', deleted_at = coalesce(m.deleted_at, now())
  where m.id = v_before.id
  returning * into v_market;
  perform app.log_operator('market.delete', v_market.id, jsonb_build_object(
    'name', v_market.name, 'statusBefore', v_before.status));
  return jsonb_build_object('status', v_market.status, 'deletedAt', v_market.deleted_at);
end
$$;

/** Shuts a register out of its restaurant; its next sync is refused. */
create function public.operator_revoke_device(device_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_device app.devices;
begin
  perform app.require_operator();
  select * into v_device from app.devices d where d.id = operator_revoke_device.device_id;
  if not found then
    raise exception 'device_not_found';
  end if;
  perform app.lock_market(v_device.market_id);
  update app.devices d set revoked_at = coalesce(d.revoked_at, now())
  where d.id = v_device.id;
  perform app.log_operator('device.revoke', v_device.market_id, jsonb_build_object(
    'deviceId', v_device.id, 'code', v_device.code, 'name', v_device.name));
end
$$;

/** Renames a register (1–60 characters), as the seller and the owner see it in the lists. */
create function public.operator_rename_device(device_id uuid, name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(operator_rename_device.name, ''));
  v_device app.devices;
begin
  perform app.require_operator();
  if length(v_name) not between 1 and 60 then
    raise exception 'bad_name';
  end if;
  select * into v_device from app.devices d where d.id = operator_rename_device.device_id
  for update;
  if not found then
    raise exception 'device_not_found';
  end if;
  update app.devices d set name = v_name where d.id = v_device.id;
  perform app.log_operator('device.rename', v_device.market_id, jsonb_build_object(
    'deviceId', v_device.id, 'code', v_device.code, 'from', v_device.name, 'to', v_name));
end
$$;

/**
 * A message (1–280 characters) for one restaurant's registers, or every restaurant's when
 * `market_id` is null, shown until removed or for `days` (1–365). Registers get it on sync.
 */
create function public.operator_set_announcement(market_id text, message text, days integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_message text := trim(coalesce(operator_set_announcement.message, ''));
  v_row app.announcements;
begin
  perform app.require_operator();
  if length(v_message) not between 1 and 280 then
    raise exception 'bad_message';
  end if;
  if operator_set_announcement.days is not null
    and operator_set_announcement.days not between 1 and 365 then
    raise exception 'bad_days';
  end if;
  if operator_set_announcement.market_id is not null and not exists (
    select 1 from app.markets m where m.id = operator_set_announcement.market_id) then
    raise exception 'market_not_found';
  end if;
  insert into app.announcements (market_id, message, created_by, expires_at)
  values (operator_set_announcement.market_id, v_message, auth.uid(),
    now() + operator_set_announcement.days * interval '1 day')
  returning * into v_row;
  perform app.log_operator('announcement.create', v_row.market_id, jsonb_build_object(
    'id', v_row.id, 'message', v_row.message, 'days', operator_set_announcement.days));
  return jsonb_build_object(
    'id', v_row.id, 'marketId', v_row.market_id, 'message', v_row.message,
    'createdAt', v_row.created_at, 'expiresAt', v_row.expires_at);
end
$$;

/** Takes an announcement down; registers stop showing it on their next sync. */
create function public.operator_remove_announcement(id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row app.announcements;
begin
  perform app.require_operator();
  update app.announcements a set removed_at = coalesce(a.removed_at, now())
  where a.id = operator_remove_announcement.id
  returning * into v_row;
  if not found then
    raise exception 'announcement_not_found';
  end if;
  perform app.log_operator('announcement.remove', v_row.market_id, jsonb_build_object(
    'id', v_row.id, 'message', v_row.message));
end
$$;

revoke execute on function app.log_operator(text, text, jsonb) from public, anon, authenticated;
revoke execute on function app.max_devices_of(text) from public, anon, authenticated;
revoke execute on function app.live_announcements(text) from public, anon, authenticated;
revoke execute on function app.market_activity(text) from public, anon, authenticated;
revoke execute on function app.operator_market_for_update(text)
  from public, anon, authenticated;

revoke execute on function public.operator_overview() from public, anon;
revoke execute on function public.operator_market(text) from public, anon;
revoke execute on function public.operator_activity(integer) from public, anon;
revoke execute on function public.operator_history(integer, bigint, text) from public, anon;
revoke execute on function public.operator_list_codes(integer, text, text) from public, anon;
revoke execute on function public.operator_list_announcements(integer) from public, anon;
revoke execute on function public.operator_issue_codes(text, integer, text, integer)
  from public, anon;
revoke execute on function public.operator_set_market_status(text, text) from public, anon;
revoke execute on function public.operator_set_license(text, timestamptz) from public, anon;
revoke execute on function public.operator_set_max_devices(text, integer) from public, anon;
revoke execute on function public.operator_rename_market(text, text) from public, anon;
revoke execute on function public.operator_set_qr_menu(text, boolean) from public, anon;
revoke execute on function public.operator_rotate_qr_menu(text) from public, anon;
revoke execute on function public.operator_create_pairing(text) from public, anon;
revoke execute on function public.operator_set_note(text, text) from public, anon;
revoke execute on function public.operator_delete_market(text, text) from public, anon;
revoke execute on function public.operator_revoke_device(uuid) from public, anon;
revoke execute on function public.operator_rename_device(uuid, text) from public, anon;
revoke execute on function public.operator_set_announcement(text, text, integer)
  from public, anon;
revoke execute on function public.operator_remove_announcement(uuid) from public, anon;

grant execute on function public.operator_overview() to authenticated;
grant execute on function public.operator_market(text) to authenticated;
grant execute on function public.operator_activity(integer) to authenticated;
grant execute on function public.operator_history(integer, bigint, text) to authenticated;
grant execute on function public.operator_list_codes(integer, text, text) to authenticated;
grant execute on function public.operator_list_announcements(integer) to authenticated;
grant execute on function public.operator_issue_codes(text, integer, text, integer)
  to authenticated;
grant execute on function public.operator_set_market_status(text, text) to authenticated;
grant execute on function public.operator_set_license(text, timestamptz) to authenticated;
grant execute on function public.operator_set_max_devices(text, integer) to authenticated;
grant execute on function public.operator_rename_market(text, text) to authenticated;
grant execute on function public.operator_set_qr_menu(text, boolean) to authenticated;
grant execute on function public.operator_rotate_qr_menu(text) to authenticated;
grant execute on function public.operator_create_pairing(text) to authenticated;
grant execute on function public.operator_set_note(text, text) to authenticated;
grant execute on function public.operator_delete_market(text, text) to authenticated;
grant execute on function public.operator_revoke_device(uuid) to authenticated;
grant execute on function public.operator_rename_device(uuid, text) to authenticated;
grant execute on function public.operator_set_announcement(text, text, integer) to authenticated;
grant execute on function public.operator_remove_announcement(uuid) to authenticated;
