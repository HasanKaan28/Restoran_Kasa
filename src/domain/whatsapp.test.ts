import { describe, expect, it } from 'vitest';
import { supportNumber, whatsAppChatUrl, whatsAppShareUrl } from './whatsapp';

describe('WhatsApp links', () => {
  it('reads the seller’s number as digits, or none', () => {
    expect(supportNumber('905321112233')).toBe('905321112233');
    expect(supportNumber(' +90 532 111 22 33 ')).toBe('905321112233');
    expect(supportNumber('')).toBeNull();
    expect(supportNumber(undefined)).toBeNull();
    expect(supportNumber('12345')).toBeNull();
  });

  it('opens a chat with the seller with the message written in', () => {
    expect(whatsAppChatUrl('905321112233', 'Merhaba, kurulum kodu')).toBe(
      'https://wa.me/905321112233?text=Merhaba%2C%20kurulum%20kodu',
    );
  });

  it('lets the seller pick the contact when no number is given', () => {
    expect(whatsAppShareUrl('Kodunuz: RK-ABCD-EFGH-JKMN')).toBe(
      'https://wa.me/?text=Kodunuz%3A%20RK-ABCD-EFGH-JKMN',
    );
  });
});
