-- Fixes from the security review of 2026-11-20. Nothing here changes a table or a stored row:
-- functions only, each replaced whole, so the migration is safe to run on the live project.
--
-- 1. A market whose licence is past its seven days of grace, or that the operator suspended, is
--    refused alike by sync and by the guests' QR menu. Before, the menu kept being served after
--    the licence ended (for the QR Menü plan, the product itself), and a suspended market kept
--    syncing.
-- 2. One push carries at most a thousand operations (the app sends 500), each record at most a
--    megabyte of JSON once merged, and ids no longer than 128 characters: one register can no
--    longer fill the database every restaurant shares with a few large calls.
-- 3. Pairing codes are drawn from pg_strong_random (gen_random_uuid) instead of random(), which
--    is a predictable generator.
--
-- create or replace keeps each function's grants; the settings it drops (search_path) are given
-- again in every definition.

/** True when the market is suspended or its licence ended more than seven days ago. */
create function app.market_lapsed(p_market text) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from app.markets
    where id = p_market
      and (status <> 'active'
        or (license_expires_at is not null and now() > license_expires_at + interval '7 days')))
$$;

/**
 * Refuses a market whose licence ended more than seven days ago, or that is suspended; the
 * register is told the same either way. No licence end is no limit.
 */
create or replace function app.require_license(p_market text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if app.market_lapsed(p_market) then
    raise exception 'license_expired';
  end if;
end
$$;

/** Eight letters of the read-aloud alphabet from one random UUID (pg_strong_random): 40 bits. */
create function app.new_pairing_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
      1 + get_byte(random.bytes, byte.n) % 32, 1), '' order by byte.n)
  from (select uuid_send(gen_random_uuid()) as bytes) random,
    generate_series(0, 9) byte(n)
  -- The bytes that carry the UUID's version and variant are not random throughout.
  where byte.n not in (6, 8)
$$;

/** A one-time code, good for ten minutes, that binds one register to this market. */
create or replace function public.create_pairing(market_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not app.is_owner(market_id) then
    raise exception 'not_owner';
  end if;
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
 * Applies one queued operation; returns null when applied, else why it was refused. A record id
 * longer than 128 characters is a bad record; a record over a megabyte of JSON, as sent or once a
 * patch is merged into it, is too large.
 */
create or replace function app.apply_op(p_market text, p_op jsonb) returns text
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
    insert into app.rows (market_id, tbl, id, server_seq, row)
    values (p_market, v_table, v_id, nextval('app.server_seq'), app.normalized(v_table, v_fields));
  elsif v_table = any (app.event_tables()) then
    -- An event is written once; a second copy of it changes nothing.
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
    v_row := app.normalized(v_table, v_row);
    if octet_length(v_row::text) > v_max_bytes then
      return 'too_large';
    end if;
    update app.rows set row = v_row, server_seq = nextval('app.server_seq'), received_at = now()
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
 * for more than a thousand operations in one call; an opId longer than 128 characters is a bad op.
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
  for v_op in select value from jsonb_array_elements(ops) loop
    if jsonb_typeof(v_op -> 'opId') is distinct from 'string' or length(v_op ->> 'opId') > 128 then
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
 * The menu a guest sees: the restaurant's name, its live categories in the owner's order and its
 * live dishes by name, each with its price, description, portions and choices. Null for a link
 * that is unknown, malformed or turned off, alike, and for a restaurant that is suspended or
 * whose licence is past its seven days of grace (as sync is): extended, the link works again.
 *
 * The rows are what the registers wrote, so every field is checked for its type and cut to a
 * length, and every list is capped: whatever a register stored, the answer stays small.
 */
create or replace function public.public_menu(slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_market app.markets;
  v_categories jsonb;
  v_dishes jsonb;
begin
  if public_menu.slug is null or public_menu.slug !~ '^[0-9A-Za-z]{22,64}$' then
    return null;
  end if;
  select m.* into v_market
  from app.qr_menus q join app.markets m on m.id = q.market_id
  where q.slug = public_menu.slug and q.enabled and not app.market_lapsed(m.id);
  if not found then
    return null;
  end if;

  with categories as (
    select r.id, left(trim(r.row ->> 'name'), 60) as name,
      case when jsonb_typeof(r.row -> 'sort') = 'number' then (r.row ->> 'sort')::numeric end
        as sort
    from app.rows r
    where r.market_id = v_market.id and r.tbl = 'categories'
      and nullif(r.row ->> 'deletedAt', '') is null
      and jsonb_typeof(r.row -> 'name') = 'string' and trim(r.row ->> 'name') <> ''
    order by sort nulls last, lower(r.row ->> 'name'), r.id
    limit 100
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
      order by c.sort nulls last, lower(c.name), c.id), '[]'::jsonb)
  into v_categories
  from categories c;

  with dishes as (
    select r.row, r.id
    from app.rows r
    where r.market_id = v_market.id and r.tbl = 'products'
      and nullif(r.row ->> 'deletedAt', '') is null
      and jsonb_typeof(r.row -> 'name') = 'string' and trim(r.row ->> 'name') <> ''
      and jsonb_typeof(r.row -> 'sellPrice') = 'number'
      and (r.row ->> 'sellPrice')::numeric between 0 and 1e12
    order by lower(trim(r.row ->> 'name')), r.id
    limit 1000
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'name', left(trim(d.row ->> 'name'), 80),
      'price', round((d.row ->> 'sellPrice')::numeric),
      'categoryId', (
        select c.value ->> 'id' from jsonb_array_elements(v_categories) c
        where c.value ->> 'id' = d.row ->> 'categoryId'),
      'description', case when jsonb_typeof(d.row -> 'description') = 'string'
        then nullif(left(trim(d.row ->> 'description'), 300), '') end,
      'portions', (
        select jsonb_agg(jsonb_build_object(
            'label', left(trim(p.value ->> 'label'), 40),
            'price', round((p.value ->> 'price')::numeric)) order by p.n)
        from jsonb_array_elements(case when jsonb_typeof(d.row -> 'portions') = 'array'
            then d.row -> 'portions' else '[]'::jsonb end) with ordinality p(value, n)
        where p.n <= 12 and jsonb_typeof(p.value) = 'object'
          and jsonb_typeof(p.value -> 'label') = 'string' and trim(p.value ->> 'label') <> ''
          and jsonb_typeof(p.value -> 'price') = 'number'
          and (p.value ->> 'price')::numeric between 0 and 1e12),
      'options', (
        select jsonb_agg(jsonb_build_object(
            'name', left(trim(g.value ->> 'name'), 40),
            'choices', coalesce((
              select jsonb_agg(left(trim(choice.value #>> '{}'), 40) order by choice.n)
              from jsonb_array_elements(case when jsonb_typeof(g.value -> 'choices') = 'array'
                  then g.value -> 'choices' else '[]'::jsonb end) with ordinality choice(value, n)
              where choice.n <= 24 and jsonb_typeof(choice.value) = 'string'), '[]'::jsonb))
            order by g.n)
        from jsonb_array_elements(case when jsonb_typeof(d.row -> 'optionGroups') = 'array'
            then d.row -> 'optionGroups' else '[]'::jsonb end) with ordinality g(value, n)
        where g.n <= 12 and jsonb_typeof(g.value) = 'object'
          and jsonb_typeof(g.value -> 'name') = 'string' and trim(g.value ->> 'name') <> '')
    )) order by lower(trim(d.row ->> 'name')), d.id), '[]'::jsonb)
  into v_dishes
  from dishes d;

  return jsonb_build_object('name', v_market.name, 'categories', v_categories, 'dishes', v_dishes);
end
$$;

revoke execute on function app.market_lapsed(text) from public, anon, authenticated;
revoke execute on function app.new_pairing_code() from public, anon, authenticated;
