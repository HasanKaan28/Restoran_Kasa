import type { JSX } from 'react';
import { PRINTABLE_WIDTH } from './printPage';
import type { ReceiptModel, ReceiptRow } from './receipt';

/** A receipt as wide as the printer prints on the given paper; the same layout is printed. */
export function ReceiptView({
  model,
  paperWidth,
}: {
  model: ReceiptModel;
  paperWidth: 58 | 80;
}): JSX.Element {
  return (
    <article
      aria-label={model.heading ?? `Fiş ${model.receiptNo}`}
      style={{ width: `${PRINTABLE_WIDTH[paperWidth]}mm` }}
      className="mx-auto flex max-w-full flex-col gap-2 bg-white px-2 py-3 text-[13px] leading-snug text-black"
    >
      <header className="text-center">
        {model.header.map((line, index) => (
          <p key={index} className={index === 0 ? 'text-[15px] font-semibold' : ''}>
            {line}
          </p>
        ))}
      </header>
      <div className="flex justify-between">
        <span>{model.device}</span>
        <span>{model.dateTime}</span>
      </div>
      {model.heading ? (
        <p className="text-center text-[15px] font-semibold">{model.heading}</p>
      ) : null}
      {model.receiptNo ? <p className="font-mono">{`Fiş ${model.receiptNo}`}</p> : null}
      {model.table ? <p className="font-semibold">{model.table}</p> : null}
      {model.waiter ? <p>{model.waiter}</p> : null}
      <hr className="border-dashed border-black/40" />
      <ul className="flex flex-col gap-1">
        {model.lines.map((line, index) => (
          <li key={index}>
            <Row label={line.name} amount={line.amount} />
            <p className="pl-2 text-black/70">{line.detail}</p>
            {line.discount ? <p className="pl-2 text-black/70">{line.discount}</p> : null}
          </li>
        ))}
      </ul>
      <hr className="border-dashed border-black/40" />
      <dl>
        {model.totals.map((row) => (
          <Row
            key={row.label}
            label={row.label}
            amount={row.amount}
            strong={row.label === 'Toplam'}
          />
        ))}
        {model.vat.map((row) => (
          <Row key={row.label} label={row.label} amount={row.amount} muted />
        ))}
      </dl>
      {model.payments.length > 0 ? <hr className="border-dashed border-black/40" /> : null}
      <dl>
        {model.payments.map((row: ReceiptRow, index) => (
          // Two shares paid the same way carry the same label.
          <Row key={index} label={row.label} amount={row.amount} />
        ))}
      </dl>
      {model.customer ? <p>{model.customer}</p> : null}
      {model.marks.map((mark) => (
        <p key={mark} className="text-center font-semibold">
          {`*** ${mark} ***`}
        </p>
      ))}
      <hr className="border-dashed border-black/40" />
      <footer className="text-center text-black/70">
        {model.footer.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </footer>
    </article>
  );
}

function Row({
  label,
  amount,
  strong = false,
  muted = false,
}: {
  label: string;
  amount: string;
  strong?: boolean;
  muted?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex justify-between gap-2 ${strong ? 'text-[15px] font-semibold' : ''} ${muted ? 'text-black/70' : ''}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="font-mono">{amount}</span>
    </div>
  );
}
