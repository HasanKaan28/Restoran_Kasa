import type { ServerClient } from './client';
import {
  chooseMarket,
  fullPlan,
  makePairingCode,
  pairDevice,
  signInOwner,
  type ClaimedDevice,
  type FullPlan,
  type OwnedMarket,
  type Platform,
} from './pairing';

/**
 * A device bound to its market, a choice of markets, an email still to confirm, or a plan with
 * no room for another register (with the registers this device can take the place of).
 */
export type OnboardingResult =
  | { claimed: ClaimedDevice }
  | { markets: OwnedMarket[] }
  | { confirmEmail: true }
  | { full: FullPlan };

const OFFLINE = 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';

function explainSignUp(message: string): string {
  if (/password/i.test(message)) {
    return 'Şifre en az 8 karakter olmalı.';
  }
  if (/email/i.test(message)) {
    return 'E-posta adresi geçersiz.';
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Çok fazla deneme oldu. Birkaç dakika sonra yeniden deneyin.';
  }
  return OFFLINE;
}

function explainMarket(message: string): string {
  if (message.includes('activation_invalid')) {
    return 'Kod geçersiz ya da kullanılmış.';
  }
  if (message.includes('activation_required')) {
    return 'Uygulamanın bu sürümü eski. Güncel sürümü yükleyin.';
  }
  if (message.includes('too_many_markets')) {
    return 'Bu hesapla en çok 3 restoran açılabilir.';
  }
  if (message.includes('bad_name')) {
    return 'Restoran adı 1–60 karakter olmalı.';
  }
  return OFFLINE;
}

/**
 * Signs the shop up with its own email, or in when the email has an account. A project that asks
 * for emails to be confirmed answers a sign-up without a session, for a new account and for one
 * already there alike: the password then tells, and an account not confirmed yet is asked to be.
 */
async function signUpOrIn(
  owner: ServerClient,
  credentials: { email: string; password: string },
): Promise<'signedIn' | 'confirmEmail'> {
  const signUp = await owner.auth.signUp(credentials);
  if (signUp.error && !/already registered/i.test(signUp.error.message)) {
    throw new Error(explainSignUp(signUp.error.message));
  }
  if (!signUp.error && signUp.data.session) {
    return 'signedIn';
  }
  const signIn = await owner.auth.signInWithPassword(credentials);
  if (!signIn.error) {
    return 'signedIn';
  }
  if (/not confirmed/i.test(signIn.error.message)) {
    return 'confirmEmail';
  }
  throw new Error(
    /invalid login/i.test(signIn.error.message)
      ? 'Bu e-postanın hesabı var ama şifre yanlış.'
      : OFFLINE,
  );
}

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('tr') === b.trim().toLocaleLowerCase('tr');

/**
 * Opens the restaurant with the code. A code already used may have been used by this owner's
 * earlier try, which opened the restaurant and then could not bind the device: that restaurant
 * (the one of the same name) is finished instead, with no new code. At three restaurants the
 * server refuses before it reads the code, so the same holds there.
 */
async function openOrFinish(
  owner: ServerClient,
  marketName: string,
  activationCode: string,
): Promise<OwnedMarket> {
  const opened = await owner.rpc('create_own_market', {
    name: marketName.trim(),
    code: activationCode.trim(),
  });
  if (!opened.error) {
    return opened.data as OwnedMarket;
  }
  const { message } = opened.error;
  if (!/activation_invalid|too_many_markets/.test(message)) {
    throw new Error(explainMarket(message));
  }
  const owned = await owner.rpc('owner_markets');
  const markets = owned.error ? [] : ((owned.data ?? []) as OwnedMarket[]);
  const earlier = markets.find((market) => sameName(market.name, marketName));
  if (earlier) {
    return earlier;
  }
  if (message.includes('activation_invalid') && markets.length > 0) {
    const names = markets.map((market) => market.name).join(', ');
    throw new Error(
      `Kod geçersiz ya da kullanılmış. Bu hesabın restoranı var (${names}): bu cihazı eklemek için “Restorana giriş yap”.`,
    );
  }
  throw new Error(explainMarket(message));
}

/**
 * The restaurant is open but this device is not bound: the same form again finishes it (see
 * openOrFinish), so the owner is told no new code is needed.
 */
function notBound(reason: unknown): Error {
  const why = reason instanceof Error ? reason.message : OFFLINE;
  const error = new Error(
    `Restoran açıldı ama bu cihaz bağlanamadı. ${why} Bilgileri değiştirmeden “Restoranı kur”a yeniden basın; yeni kod gerekmez.`,
  );
  const limit = (reason as { deviceLimit?: unknown } | null)?.deviceLimit;
  return typeof limit === 'number' ? Object.assign(error, { deviceLimit: limit }) : error;
}

/**
 * The first screen's "Restoran kur": signs the shop up with its own email (or in, if the email
 * already has an account), opens the restaurant with the seller's one-time activation code and
 * binds this device as its first register. The owner's session is dropped at the end; only the
 * register's own session stays on the device. A try that failed after the code was used is
 * finished by sending the same form again.
 */
export async function openMarket({
  owner,
  device,
  email,
  password,
  marketName,
  activationCode,
  platform,
}: {
  owner: ServerClient;
  device: ServerClient;
  email: string;
  password: string;
  marketName: string;
  /** RK-XXXX-XXXX-XXXX; the server takes it however it was typed. */
  activationCode: string;
  platform: Platform;
}): Promise<OnboardingResult> {
  const credentials = { email: email.trim(), password };
  if ((await signUpOrIn(owner, credentials)) === 'confirmEmail') {
    // Nothing is opened, so the code is still unused for when the email is confirmed.
    return { confirmEmail: true };
  }
  let code: string;
  let marketId: string;
  try {
    const market = await openOrFinish(owner, marketName, activationCode);
    marketId = market.id;
    code = await makePairingCode(owner, market).catch((reason: unknown) => {
      throw notBound(reason);
    });
  } finally {
    await owner.auth.signOut({ scope: 'local' });
  }
  try {
    return {
      claimed: await pairDevice({
        device,
        code,
        deviceCode: '',
        deviceName: '',
        platform,
        marketId,
      }),
    };
  } catch (reason) {
    throw notBound(reason);
  }
}

/**
 * "Restorana giriş yap" on another device: the owner signs in once, and this device joins their
 * market as the next free register (K2, K3…). On a plan with no room left, no code is made:
 * the live registers come back, and with `replaceCode` this device takes the place of that one
 * (it is revoked), which keeps the count the same.
 */
export async function joinMarket({
  owner,
  device,
  email,
  password,
  marketId,
  replaceCode,
  platform,
}: {
  owner: ServerClient;
  device: ServerClient;
  email: string;
  password: string;
  marketId?: string;
  /** The register (K1…) this device takes the place of, the plan being full. */
  replaceCode?: string;
  platform: Platform;
}): Promise<OnboardingResult> {
  await signInOwner(owner, email, password);
  let code: string;
  let chosen: string;
  try {
    const { markets, market } = await chooseMarket(owner, marketId);
    if (!market) {
      return { markets };
    }
    chosen = market.id;
    if (!replaceCode) {
      const full = await fullPlan(owner, market);
      if (full) {
        return { full };
      }
    }
    code = await makePairingCode(owner, market);
  } finally {
    // Only this sign-in ends; the owner's sessions on other devices stay.
    await owner.auth.signOut({ scope: 'local' });
  }
  return {
    claimed: await pairDevice({
      device,
      code,
      deviceCode: replaceCode ?? '',
      deviceName: '',
      platform,
      marketId: chosen,
      ...(replaceCode ? { replace: true } : {}),
    }),
  };
}
