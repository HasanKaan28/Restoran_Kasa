-- The QR menu: a guest scans the code on the table and reads the restaurant's current menu on
-- their phone, with no app and no account. Each restaurant has one unguessable link; the owner
-- turns it on or off and can make a new one, which retires the old link and every card printed
-- with it. Guests reach the menu only through public.public_menu, which reads the market's synced
-- rows and answers with the fields a printed menu would show, nothing else.

create table app.qr_menus (
  market_id text primary key references app.markets (id) on delete cascade,
  slug text not null unique check (slug ~ '^[0-9A-Za-z]{22,64}$'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
-- Defence in depth, as for every app table: no policy and no grant.
alter table app.qr_menus enable row level security;
revoke all on app.qr_menus from public, anon, authenticated;

/**
 * 28 base62 characters from two random UUIDs (pg_strong_random), leaving out the bytes that carry
 * the UUID version and variant. Each character holds a little under 6 bits: about 166 in all.
 */
create function app.new_menu_slug() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr(
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      1 + get_byte(random.bytes, byte.n) % 62, 1), '' order by byte.n)
  from (select uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()) as bytes) random,
    generate_series(0, 31) byte(n)
  where byte.n not in (6, 8, 22, 24)
$$;

/** Turns the market's QR menu on or off; the first time, it is given its link. Owners only. */
create function public.set_qr_menu(market_id text, enabled boolean) returns jsonb
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
  insert into app.qr_menus (market_id, slug, enabled)
  values (set_qr_menu.market_id, app.new_menu_slug(), set_qr_menu.enabled)
  on conflict on constraint qr_menus_pkey
    do update set enabled = excluded.enabled, updated_at = now()
  returning * into v_menu;
  return jsonb_build_object('enabled', v_menu.enabled, 'slug', v_menu.slug);
end
$$;

/** Gives the market's QR menu a new link; the old one stops working at once. Owners only. */
create function public.rotate_qr_menu(market_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_menu app.qr_menus;
begin
  if not app.is_owner(rotate_qr_menu.market_id) then
    raise exception 'not_owner';
  end if;
  insert into app.qr_menus (market_id, slug, enabled)
  values (rotate_qr_menu.market_id, app.new_menu_slug(), false)
  on conflict on constraint qr_menus_pkey
    do update set slug = excluded.slug, updated_at = now()
  returning * into v_menu;
  return jsonb_build_object('enabled', v_menu.enabled, 'slug', v_menu.slug);
end
$$;

/**
 * The calling register's QR menu, so any register can show the link and print table cards; only
 * the owner changes it. The slug is null until the owner turns the menu on the first time.
 */
create function public.my_qr_menu() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_device app.devices := app.current_device();
  v_menu app.qr_menus;
begin
  select * into v_menu from app.qr_menus where qr_menus.market_id = v_device.market_id;
  return jsonb_build_object('enabled', coalesce(v_menu.enabled, false), 'slug', v_menu.slug);
end
$$;

/**
 * The menu a guest sees: the restaurant's name, its live categories in the owner's order and its
 * live dishes by name, each with its price, description, portions and choices. Null for a link
 * that is unknown, malformed or turned off, alike, and for a suspended restaurant.
 *
 * The rows are what the registers wrote, so every field is checked for its type and cut to a
 * length, and every list is capped: whatever a register stored, the answer stays small.
 */
create function public.public_menu(slug text) returns jsonb
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
  where q.slug = public_menu.slug and q.enabled and m.status = 'active';
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

revoke execute on function app.new_menu_slug() from public, anon, authenticated;
revoke execute on function public.set_qr_menu(text, boolean) from public, anon;
revoke execute on function public.rotate_qr_menu(text) from public, anon;
revoke execute on function public.my_qr_menu() from public, anon;
revoke execute on function public.public_menu(text) from public;
grant execute on function public.set_qr_menu(text, boolean) to authenticated;
grant execute on function public.rotate_qr_menu(text) to authenticated;
grant execute on function public.my_qr_menu() to authenticated;
-- The one function a guest without an account may call.
grant execute on function public.public_menu(text) to anon, authenticated;
