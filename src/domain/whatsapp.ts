/**
 * Links that open WhatsApp with a message written in: to the seller from the app, or from the
 * seller's yönetim page to a contact he picks. wa.me works in a phone's browser and on a computer.
 */

/** The seller's number as wa.me wants it (country code and digits), or null when none is set. */
export function supportNumber(value: string | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

/** A chat with `number`, the message ready to send. */
export function whatsAppChatUrl(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** The message ready to send to whichever contact the person picks. */
export function whatsAppShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
