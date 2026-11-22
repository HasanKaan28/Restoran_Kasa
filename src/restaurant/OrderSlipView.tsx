import type { JSX } from 'react';
import { formatLineQty } from '@/pos/format';
import { PRINTABLE_WIDTH } from '@/pos/printPage';
import { waiterLine } from '@/pos/receipt';
import { slipDateTime, type OrderSlip } from './orderSlip';

/** Slips as wide as the printer prints on the given paper, one after the other; printed as shown. */
export function OrderSlipsView({
  slips,
  paperWidth,
}: {
  slips: OrderSlip[];
  paperWidth: 58 | 80;
}): JSX.Element {
  return (
    <div
      style={{ width: `${PRINTABLE_WIDTH[paperWidth]}mm` }}
      className="mx-auto flex max-w-full flex-col divide-y divide-dashed divide-black/40 bg-white text-[13px] leading-snug text-black"
    >
      {slips.map((slip) => (
        <SlipView key={slip.id} slip={slip} />
      ))}
    </div>
  );
}

function SlipView({ slip }: { slip: OrderSlip }): JSX.Element {
  const { date, time } = slipDateTime(slip.sentAt);
  return (
    <article aria-label={`${slip.title} siparişi`} className="flex flex-col gap-2 px-2 py-3">
      <p className="text-center font-semibold">{slip.delivered ? 'Teslim edildi' : 'Sipariş'}</p>
      <p className="text-center text-[18px] font-bold">{slip.title}</p>
      {slip.waiters.length > 0 ? <p>{waiterLine(slip.waiters.join(', '))}</p> : null}
      {slip.devices.length > 0 ? <p>{`Cihaz: ${slip.devices.join(', ')}`}</p> : null}
      <div className="flex justify-between">
        <span>{date}</span>
        <span>{time}</span>
      </div>
      <hr className="border-dashed border-black/40" />
      <ul className="flex flex-col gap-1">
        {slip.lines.map((line, index) => (
          <li key={index}>
            <p className="text-[15px] font-semibold">
              {`${formatLineQty(line.qtyMilli, line.unit)} × ${line.label}`}
            </p>
            {line.details.map((detail) => (
              <p key={detail} className="pl-2 text-black/70">
                {detail}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </article>
  );
}
