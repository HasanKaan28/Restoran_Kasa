import type { JSX } from 'react';
import { CustomersPanel } from '@/customers/CustomersScreen';

/**
 * Yönetim's credit section: the customers who pay later, their debts and payments. Bringing a
 * market's v1 customers over is not offered here: a restaurant has none.
 */
export function CreditSection(): JSX.Element {
  return (
    <>
      <h2 className="text-lg font-semibold">Veresiye</h2>
      <CustomersPanel />
    </>
  );
}
