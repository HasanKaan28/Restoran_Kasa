/**
 * Activation codes as the seller sends them: RK- and twelve letters or digits in groups of four
 * (RK-ABCD-EFGH-JKMN). The field shows the RK- itself, so what a person types or pastes is turned
 * into the twelve characters after it; the server reads the code however it arrives.
 */

const LENGTH = 12;
// The code's own alphabet: no 0/O or 1/I. A code inside a pasted message is found by it, even
// where a one-line field has dropped the line break after it ("…TP7SUYGULAMA: …").
const IN_MESSAGE =
  /(?:^|[^A-Z0-9])RK[\s-]*([A-HJ-NP-Z2-9]{4})[\s-]*([A-HJ-NP-Z2-9]{4})[\s-]*([A-HJ-NP-Z2-9]{4})/;

/** What the field shows after its RK-: up to twelve capitals, grouped in fours. */
export function typedActivationCode(input: string): string {
  const upper = input.toUpperCase();
  const found = IN_MESSAGE.exec(upper);
  let chars = found ? found.slice(1).join('') : upper.replace(/[^A-Z0-9]/g, '');
  // "RK-" or "RK " can only be the prefix: the code's groups are four long. Without a separator,
  // RK is the prefix only once there is more than a code's worth.
  if (!found && chars.startsWith('RK') && (/^\s*RK[\s-]/.test(upper) || chars.length > LENGTH)) {
    chars = chars.slice(2);
  }
  return (chars.slice(0, LENGTH).match(/.{1,4}/g) ?? []).join('-');
}

/** The whole code to send to the server, or null while characters are missing. */
export function activationCodeOf(typed: string): string | null {
  const chars = typed.replace(/-/g, '');
  return chars.length === LENGTH ? `RK-${typed}` : null;
}
