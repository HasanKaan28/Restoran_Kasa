-- Reports of a period saved for Yönetim's archive sync as entities of their own table,
-- 'savedReports': a register writes one with the figures as they were, and archiving it later is
-- a patch, so every register of the restaurant sees the same archive.
--
-- Live-safe: one immutable function is replaced with the same signature and a list that only
-- grows (its grants are kept; it restates its empty search_path). No table, row, index or other
-- function changes. A register on v1.0.4 or older parks the new rows unread and goes on syncing.
-- Apply before releasing the Yönetim panel: until then the server refuses the new rows
-- (unknown_table) and a saved report stays on the register that saved it.

create or replace function app.entity_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array['products', 'customers', 'categories', 'suppliers', 'staff', 'settings', 'invoices',
    'diningTables', 'tabs', 'tabItems', 'savedReports']
$$;
