import { supportNumber } from '@/domain/whatsapp';

type Env = { VITE_SUPPORT_WHATSAPP?: string };

/** The seller's WhatsApp number this build was made with, or null when it has none. */
export const SUPPORT_WHATSAPP: string | null = supportNumber(
  (import.meta.env as Env).VITE_SUPPORT_WHATSAPP,
);

/** The messages the app writes in for the person, and what it says when there is no number. */
export const SUPPORT = {
  code: {
    label: 'Kodunuz yok mu? WhatsApp’tan yazın',
    message: 'Merhaba, Restoran Kasa için kurulum kodu almak istiyorum.',
    fallback: 'Kurulum kodu için satıcınızla iletişime geçin.',
  },
  devices: (limit: number) => ({
    label: 'Ek cihaz için WhatsApp’tan yazın',
    message: `Merhaba, Restoran Kasa paketimdeki cihaz sınırına ulaştım (${limit}). Ek cihaz istiyorum.`,
    fallback: 'Ek cihaz için satıcınızla iletişime geçin.',
  }),
  /** A device that could not join because the licence ran out; the market's name is not known yet. */
  licenseExpired: {
    label: 'Lisansı uzatmak için WhatsApp’tan yazın',
    message: 'Merhaba, Restoran Kasa lisansımı uzatmak istiyorum.',
    fallback: 'Lisansı uzatmak için satıcınızla iletişime geçin.',
  },
  license: (marketName: string) => ({
    label: 'Lisansı uzatmak için WhatsApp’tan yazın',
    message: `Merhaba, ${marketName} için Restoran Kasa lisansımı uzatmak istiyorum.`,
    fallback: 'Lisansı uzatmak için satıcınızla iletişime geçin.',
  }),
} as const;

export type SupportTopic = { label: string; message: string; fallback: string };
