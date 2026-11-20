-- Shares of a tab paid by amount (one guest's part of the bill, cash or card) sync as events of
-- their own table, 'tabPayments'. The tab's last payment records one sale whose payments carry
-- each share (by its id), so receipts, reports and the Z read the sale as before; a register's
-- drawer counts a cash share when it was taken.
--
-- Live-safe: one immutable function is replaced with the same signature and a list that only
-- grows (its grants are kept; it restates its empty search_path). No table, row, index or other
-- function changes. A register older than v1.0.2 parks the new rows unread and goes on syncing.
-- Apply before releasing v1.0.2: until then the server refuses the new rows (unknown_table) and
-- a share stays on the register that took it.

create or replace function app.event_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array['sales', 'stockMovements', 'ledger', 'saleVoids', 'returns', 'purchases',
    'stockCounts', 'supplierLedger', 'cashMovements', 'cashSessions', 'auditLog', 'tabPayments']
$$;
