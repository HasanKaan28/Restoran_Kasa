/** A4 sheets of six cards to cut, or one A6 card per page (a table tent or a stand). */
export type CardSize = 'sheet' | 'single';

/** One card: the table it stands on (none for a card at the door or the counter) and its link. */
export type TableCard = { key: string; table?: string; link: string };

export const CARDS_PER_SHEET = 6;

/**
 * The page each size prints on, edge to edge: the cards carry their own margins. A6 is given in
 * millimetres: CSS names no A6 page, and Chrome prints an unknown size on Letter.
 */
export const CARD_PAGE_RULE: Record<CardSize, string> = {
  sheet: '@page { size: A4; margin: 0; }',
  single: '@page { size: 105mm 148mm; margin: 0; }',
};
