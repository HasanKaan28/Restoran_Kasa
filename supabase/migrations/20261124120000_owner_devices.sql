-- The owner's list of a market's registers, with the plan's limit (2026-11-24).
--
-- A device joining a full plan used to get a pairing code made for it (and an anonymous session)
-- before claim_device refused it with device_limit, leaving both behind on every try, and the
-- owner had no way to see which register a new phone could take the place of. With this list the
-- app knows the plan is full before it makes a code, and offers the live registers to take over
-- (claim_device's `replace`, which keeps the count the same).
--
-- Safe on a live project: one new function, read-only; no table, row or existing function is
-- touched. Apply it in one go (apply_migration, or the whole file in the SQL editor).

/**
 * The live registers of a market the caller owns, oldest first, and the plan's limit (null: any
 * number). A revoked register is left out: it counts for nothing and cannot be taken over.
 */
create function public.owner_devices(market_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_max integer;
begin
  if not app.is_owner(owner_devices.market_id) then
    raise exception 'not_owner';
  end if;
  select p.max_devices into v_max
  from app.markets m left join app.plans p on p.id = m.plan_id
  where m.id = owner_devices.market_id;
  return jsonb_build_object(
    'maxDevices', v_max,
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

revoke execute on function public.owner_devices(text) from public, anon;
grant execute on function public.owner_devices(text) to authenticated;
