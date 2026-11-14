-- The restaurant's tables, the tabs open at them and their order lines sync like the market's
-- other entities: patched field by field, so the kitchen marking a line ready and the waiter
-- adding to the tab never overwrite each other.
create or replace function app.entity_tables() returns text[] language sql immutable as $$
  select array['products', 'customers', 'categories', 'suppliers', 'staff', 'settings', 'invoices',
    'diningTables', 'tabs', 'tabItems']
$$;
