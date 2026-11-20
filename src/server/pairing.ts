import type { DeviceSettings } from '@/app/device';
import type { ServerClient } from './client';

export type OwnedMarket = { id: string; name: string };

/** A code for one market, or the owner's markets when they must pick one first. */
export type PairingCodeResult = { code: string; market: OwnedMarket } | { markets: OwnedMarket[] };

export type ClaimedDevice = {
  marketId: string;
  marketName: string;
  deviceId: string;
  deviceCode: string;
};

export type Platform = 'windows' | 'android' | 'web';

/** A live register of a market, as its owner's list shows it. */
export type OwnedRegister = {
  id: string;
  code: string;
  name: string;
  platform: string;
  lastSeenAt: string | null;
};

/** The plan has no room for another register: these are the ones a new device can replace. */
export type FullPlan = { market: OwnedMarket; limit: number; devices: OwnedRegister[] };

/** What the server's refusals mean to the person at the register. */
const MESSAGES: Record<string, string> = {
  not_owner: 'Bu hesap bu restoranın sahibi değil.',
  pairing_invalid: 'Kod geçersiz ya da süresi doldu. Yeni kod üretin.',
  already_registered: 'Bu kasa zaten bir restorana bağlı.',
  bad_device_code: 'Kasa kodu bir harf ve en çok üç harf ya da rakam olmalı (K1, K2).',
  bad_platform: 'Bu cihaz türü desteklenmiyor.',
  license_expired: 'Lisansın süresi doldu; yeni cihaz bağlanamaz. Uzatmak için bize yazın.',
};
const OFFLINE = 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';
/** The owner's account was made but its email is not confirmed yet (the project asks for it). */
export const CONFIRM_EMAIL =
  'E-postanızı onaylayın, sonra tekrar deneyin. Onay bağlantısı kayıt olurken e-postanıza gönderildi.';

/** A refusal because another register holds the code; the person may take it over. */
export type TakenError = Error & { taken: true };

/** A refusal because the market's plan has no room for another register; `deviceLimit` is how many. */
export type DeviceLimitError = Error & { deviceLimit: number };

/** The plan's limit in a 'device_limit 5' refusal, or null for any other. */
function deviceLimitIn(message: string): number | null {
  const match = /device_limit\D*(\d+)/.exec(message);
  return match ? Number(match[1]) : null;
}

function explain(message: string, deviceCode?: string): string {
  if (message.includes('device_code_taken')) {
    return `${deviceCode ?? 'Bu'} kodu bu restoranda kullanılıyor.`;
  }
  const limit = deviceLimitIn(message);
  if (limit !== null) {
    return `Paketinizdeki cihaz sınırına ulaşıldı (${limit}). Ek cihaz için bize yazın.`;
  }
  const known = Object.keys(MESSAGES).find((key) => message.includes(key));
  return known ? (MESSAGES[known] as string) : OFFLINE;
}

/** Whether the server said no (rather than the answer being lost on the way). */
function isRefusal(message: string): boolean {
  return (
    deviceLimitIn(message) !== null ||
    message.includes('device_code_taken') ||
    Object.keys(MESSAGES).some((key) => message.includes(key))
  );
}

/** Signs the owner in, or says why not in the register's words. */
export async function signInOwner(
  owner: ServerClient,
  email: string,
  password: string,
  wrongPassword = 'E-posta ya da şifre yanlış.',
): Promise<void> {
  const signIn = await owner.auth.signInWithPassword({ email: email.trim(), password });
  if (signIn.error) {
    const { message } = signIn.error;
    throw new Error(
      /not confirmed/i.test(message)
        ? CONFIRM_EMAIL
        : /invalid login/i.test(message)
          ? wrongPassword
          : OFFLINE,
    );
  }
}

/** The signed-in owner's markets, and the one meant: the only one, or the one chosen. */
export async function chooseMarket(
  owner: ServerClient,
  marketId?: string,
): Promise<{ markets: OwnedMarket[]; market?: OwnedMarket }> {
  const owned = await owner.rpc('owner_markets');
  if (owned.error) {
    throw new Error(explain(owned.error.message));
  }
  const markets = (owned.data ?? []) as OwnedMarket[];
  if (markets.length === 0) {
    throw new Error('Bu hesabın sahibi olduğu restoran yok.');
  }
  const market = marketId
    ? markets.find((item) => item.id === marketId)
    : markets.length === 1
      ? markets[0]
      : undefined;
  return { markets, ...(market ? { market } : {}) };
}

/**
 * The plan's limit and live registers when the market has no room for another, else null. Null
 * too from a server that cannot list them yet (before owner_devices): the claim then decides.
 */
export async function fullPlan(owner: ServerClient, market: OwnedMarket): Promise<FullPlan | null> {
  const listed = await owner.rpc('owner_devices', { market_id: market.id });
  if (listed.error) {
    if (
      listed.error.code === 'PGRST202' ||
      /could not find the function|does not exist/i.test(listed.error.message)
    ) {
      return null;
    }
    throw new Error(explain(listed.error.message));
  }
  const room = listed.data as { maxDevices: number | null; devices: OwnedRegister[] } | null;
  if (!room) {
    return null;
  }
  const { maxDevices, devices } = room;
  return maxDevices !== null && devices.length >= maxDevices
    ? { market, limit: maxDevices, devices }
    : null;
}

/** A ten-minute pairing code for the signed-in owner's market. */
export async function makePairingCode(owner: ServerClient, market: OwnedMarket): Promise<string> {
  const made = await owner.rpc('create_pairing', { market_id: market.id });
  if (made.error) {
    throw new Error(explain(made.error.message));
  }
  return String(made.data);
}

/**
 * Signs the owner in, makes a ten-minute pairing code for their market and signs out again.
 * With several markets and none chosen, returns the markets instead.
 */
export async function createPairingCode({
  owner,
  email,
  password,
  marketId,
}: {
  owner: ServerClient;
  email: string;
  password: string;
  marketId?: string;
}): Promise<PairingCodeResult> {
  await signInOwner(owner, email, password);
  try {
    const { markets, market } = await chooseMarket(owner, marketId);
    if (!market) {
      return { markets };
    }
    return { code: await makePairingCode(owner, market), market };
  } finally {
    // Only this sign-in ends; the owner's sessions on other devices stay.
    await owner.auth.signOut({ scope: 'local' });
  }
}

/** Signs the register in on its own and binds it to the market the code was made for. */
export async function pairDevice({
  device,
  code,
  deviceCode,
  deviceName,
  platform,
  replace = false,
  marketId,
  claims,
}: {
  device: ServerClient;
  code: string;
  deviceCode: string;
  deviceName: string;
  platform: Platform;
  /** Take the code over from the register that holds it; that register is revoked. */
  replace?: boolean;
  /** The market the code was made for, when this device made it (Restoran kur, giriş yap). */
  marketId?: string;
  /** Where the code of a claim still waiting for its answer is kept; the browser's storage. */
  claims?: ClaimMemo;
}): Promise<ClaimedDevice> {
  const registerCode = deviceCode.trim().toUpperCase();
  const pairingCode = code.trim().toUpperCase();
  const memo = claims ?? browserClaims();
  const { data } = await device.auth.getSession();
  if (data.session) {
    const mine = await currentDevice(device);
    // A claim whose answer was lost already bound this session: take that result, but only
    // for that same claim. A session left over from another restaurant (its register settings
    // gone, the session not) would otherwise bind this device back to that one.
    const retry = mine?.marketId === marketId || memo.read() === pairingCode;
    if (mine && !mine.revoked && retry) {
      memo.clear();
      return withoutRevoked(mine);
    }
    if (mine) {
      // A revoked register, or another restaurant's: this device starts a session of its own.
      await device.auth.signOut({ scope: 'local' });
      await signInAnonymously(device);
    }
  } else {
    await signInAnonymously(device);
  }
  memo.write(pairingCode);
  const claimed = await device.rpc('claim_device', {
    code: pairingCode,
    device_code: registerCode,
    device_name: deviceName.trim(),
    platform,
    replace,
  });
  if (claimed.error) {
    if (claimed.error.message.includes('already_registered')) {
      const mine = await currentDevice(device);
      if (mine && !mine.revoked) {
        memo.clear();
        return withoutRevoked(mine);
      }
    }
    if (isRefusal(claimed.error.message)) {
      memo.clear();
    }
    // Refused, so nothing is bound to this session: it goes, and no stray one stays on the
    // device. Kept when the answer was lost (the claim may have gone through, and the same
    // session picks it up next time) and when the code's register is to be taken over next.
    if (isRefusal(claimed.error.message) && !claimed.error.message.includes('device_code_taken')) {
      await device.auth.signOut({ scope: 'local' });
    }
    const error = new Error(explain(claimed.error.message, registerCode));
    if (claimed.error.message.includes('device_code_taken')) {
      Object.assign(error, { taken: true });
    }
    const limit = deviceLimitIn(claimed.error.message);
    if (limit !== null) {
      Object.assign(error, { deviceLimit: limit });
    }
    throw error;
  }
  memo.clear();
  return claimed.data as ClaimedDevice;
}

/** The pairing code of the claim this device sent last and has had no answer for. */
export type ClaimMemo = { read(): string | null; write(code: string): void; clear(): void };

const CLAIM_KEY = 'rk.claim';

function browserClaims(): ClaimMemo {
  const storage = (): Storage | undefined =>
    typeof localStorage === 'undefined' ? undefined : localStorage;
  // Storage that cannot be read or written only loses the retry of a lost answer.
  const attempt = <T>(act: (store: Storage) => T, fallback: T): T => {
    try {
      const store = storage();
      return store ? act(store) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    read: () => attempt((store) => store.getItem(CLAIM_KEY), null),
    write: (code) => attempt((store) => store.setItem(CLAIM_KEY, code), undefined),
    clear: () => attempt((store) => store.removeItem(CLAIM_KEY), undefined),
  };
}

async function signInAnonymously(device: ServerClient): Promise<void> {
  const signIn = await device.auth.signInAnonymously();
  if (signIn.error) {
    throw new Error(OFFLINE);
  }
}

type MyDevice = ClaimedDevice & { revoked: boolean };

async function currentDevice(device: ServerClient): Promise<MyDevice | null> {
  const { data, error } = await device.rpc('my_device');
  return error ? null : ((data ?? null) as MyDevice | null);
}

function withoutRevoked({ marketId, marketName, deviceId, deviceCode }: MyDevice): ClaimedDevice {
  return { marketId, marketName, deviceId, deviceCode };
}

/**
 * The register's settings once it stops syncing so it can be paired again: its database, and
 * every queued operation in it, stay where they are.
 */
export function unpairedSettings(current: DeviceSettings): DeviceSettings {
  const unpaired = { ...current, databaseId: current.databaseId ?? current.marketId };
  delete unpaired.paired;
  return unpaired;
}

/**
 * The register's settings once paired. `keepData` keeps this register's database, and with it
 * the queue of everything done here so far, which then goes to the market; otherwise the
 * register starts on a new, empty database and the old one stays where it was.
 */
export function pairedSettings(
  current: DeviceSettings,
  claimed: ClaimedDevice,
  deviceName: string,
  keepData: boolean,
): DeviceSettings {
  return {
    marketId: claimed.marketId,
    marketName: claimed.marketName,
    deviceCode: claimed.deviceCode,
    deviceName: deviceName.trim(),
    databaseId: keepData ? (current.databaseId ?? current.marketId) : claimed.marketId,
    paired: true,
  };
}

/** Which kind of register this is, for the server's list of devices. */
export function currentPlatform(): Platform {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/electron/i.test(agent)) {
    return 'windows';
  }
  return /android/i.test(agent) ? 'android' : 'web';
}
