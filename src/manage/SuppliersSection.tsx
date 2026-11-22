import type { JSX } from 'react';
import { SuppliersPanel } from '@/suppliers/SuppliersScreen';

/** Yönetim's suppliers section: suppliers, what is owed to them and the purchase invoices. */
export function SuppliersSection(): JSX.Element {
  return (
    <>
      <h2 className="text-lg font-semibold">Tedarikçi / Fatura</h2>
      <SuppliersPanel />
    </>
  );
}
