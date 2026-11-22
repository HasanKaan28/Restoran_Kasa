import type { JSX } from 'react';
import { StockPanel } from '@/stock/StockScreen';

/** Yönetim's stock section: levels, goods received, critical stock and counts. */
export function StockSection(): JSX.Element {
  return (
    <>
      <h2 className="text-lg font-semibold">Stok</h2>
      <StockPanel />
    </>
  );
}
