import type { CSSProperties, JSX } from 'react';
import { tableLabel } from '@/menu/model';
import { qrModules, qrPath, QUIET_ZONE } from './qrCode';
import { CARDS_PER_SHEET, type CardSize, type TableCard } from './tableCardSizes';

/** A QR code drawn as one black path on white, crisp at any print size. */
export function QrCode({ text, size }: { text: string; size: string }): JSX.Element {
  const modules = qrModules(text);
  const side = modules.length + 2 * QUIET_ZONE;
  return (
    <svg
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={`QR kod: ${text}`}
      shapeRendering="crispEdges"
      style={{ width: size, height: size, display: 'block' }}
    >
      <rect width={side} height={side} fill="#fff" />
      <path d={qrPath(modules)} fill="#000" />
    </svg>
  );
}

const FONT = "'Bricolage Grotesque', 'Instrument Sans', Arial, sans-serif";

/** Every length of a card, by size: an A4 sheet's sixth (105 × 99 mm) or an A6 page. */
const LAYOUT = {
  sheet: {
    width: '105mm',
    height: '99mm',
    padding: '7mm 8mm',
    qr: '50mm',
    name: '12pt',
    table: '22pt',
    hint: '9.5pt',
  },
  single: {
    width: '105mm',
    height: '148mm',
    padding: '12mm 10mm',
    qr: '70mm',
    name: '15pt',
    table: '30pt',
    hint: '11pt',
  },
} as const;

function Card({
  card,
  marketName,
  size,
}: {
  card: TableCard;
  marketName: string;
  size: CardSize;
}): JSX.Element {
  const layout = LAYOUT[size];
  const style: CSSProperties = {
    width: layout.width,
    height: layout.height,
    boxSizing: 'border-box',
    padding: layout.padding,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    textAlign: 'center',
    color: '#000',
    background: '#fff',
    fontFamily: FONT,
    overflow: 'hidden',
    breakInside: 'avoid',
    // Where to cut: a fine grey line round each card of a sheet.
    ...(size === 'sheet' ? { outline: '0.2mm dashed #9a9a9a', outlineOffset: '-0.1mm' } : {}),
  };
  return (
    <li style={style} data-card={card.key}>
      <div
        style={{
          fontSize: layout.name,
          fontWeight: 700,
          letterSpacing: '0.02em',
          lineHeight: 1.15,
          maxHeight: '2.3em',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
        }}
      >
        {marketName}
      </div>
      <QrCode text={card.link} size={layout.qr} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5mm' }}>
        <div
          style={{
            fontSize: layout.table,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-0.01em',
            overflowWrap: 'anywhere',
          }}
        >
          {card.table ? tableLabel(card.table) : 'Menü'}
        </div>
        <div style={{ fontSize: layout.hint, fontWeight: 500 }}>Menüyü görmek için okutun</div>
      </div>
    </li>
  );
}

const PAGE_STYLE: Record<CardSize, CSSProperties> = {
  sheet: {
    width: '210mm',
    height: '297mm',
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 105mm)',
    gridAutoRows: '99mm',
  },
  single: { width: '105mm', height: '148mm', display: 'block' },
};

/**
 * The table cards as they print, black on white: the restaurant's name, the menu's QR code with
 * the table in its link, the table's name and one line on what to do. Six to an A4 sheet, or
 * one to an A6 page.
 */
export function TableCardSheet({
  cards,
  marketName,
  size,
}: {
  cards: readonly TableCard[];
  marketName: string;
  size: CardSize;
}): JSX.Element {
  const perPage = size === 'sheet' ? CARDS_PER_SHEET : 1;
  const pages = Array.from({ length: Math.ceil(cards.length / perPage) }, (_, index) =>
    cards.slice(index * perPage, (index + 1) * perPage),
  );
  return (
    <div aria-label="Masa kartları" style={{ background: '#fff' }}>
      {pages.map((page, index) => (
        <ul
          key={index}
          style={{
            ...PAGE_STYLE[size],
            listStyle: 'none',
            margin: 0,
            padding: 0,
            overflow: 'hidden',
            breakAfter: index < pages.length - 1 ? 'page' : 'auto',
          }}
        >
          {page.map((card) => (
            <Card key={card.key} card={card} marketName={marketName} size={size} />
          ))}
        </ul>
      ))}
    </div>
  );
}

/** A single card at its printed size, for the dialog to show before printing. */
export function TableCardPreview(props: {
  card: TableCard;
  marketName: string;
  size: CardSize;
}): JSX.Element {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      <Card {...props} />
    </ul>
  );
}
