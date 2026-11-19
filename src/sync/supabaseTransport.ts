import type { ServerClient } from '@/server/client';
import type {
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  SyncTransport,
} from './protocol';

/** The owner shut this register out of the market. */
export class DeviceRevokedError extends Error {
  constructor() {
    super('Bu kasanın kaydı iptal edildi.');
    this.name = 'DeviceRevokedError';
  }
}

/** The register is not, or no longer, signed in as a register of a market. */
export class DeviceUnpairedError extends Error {
  constructor() {
    super('Kasayı yeniden bağlayın.');
    this.name = 'DeviceUnpairedError';
  }
}

function failure(error: { message: string; code?: string }): Error {
  if (error.message.includes('device_revoked')) {
    return new DeviceRevokedError();
  }
  // No register on the server, or a session that could not be renewed, which leaves the call
  // to the anonymous role that may not run the sync functions at all.
  if (
    error.message.includes('device_not_registered') ||
    error.code === '42501' ||
    error.code === 'PGRST301' ||
    /JWT/i.test(error.message)
  ) {
    return new DeviceUnpairedError();
  }
  return new Error(error.message);
}

/** The server could not read the session's token: signed by another project, or expired. */
function staleToken(error: { message: string; code?: string }): boolean {
  return error.code === 'PGRST301' || /JWT/i.test(error.message);
}

/** After a failed renewal, wait this long before trying another. */
const RENEW_RETRY_MS = 30_000;

/** The register's connection to its market through the server's sync functions. */
export function supabaseTransport(client: ServerClient): SyncTransport {
  let renewing: Promise<boolean> | undefined;
  let failedAt = Number.NEGATIVE_INFINITY;

  // The stored refresh token can outlive the project that signed the access token (the market
  // moved to another server), so renew once before calling the register unpaired. Never sign out.
  function renew(): Promise<boolean> {
    if (Date.now() - failedAt < RENEW_RETRY_MS) {
      return Promise.resolve(false);
    }
    renewing ??= client.auth
      .refreshSession()
      .then(({ error }) => error === null)
      .catch(() => false)
      .then((ok) => {
        if (!ok) {
          failedAt = Date.now();
        }
        return ok;
      })
      .finally(() => {
        renewing = undefined;
      });
    return renewing;
  }

  async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    let { data, error } = await client.rpc(fn, args);
    if (error && staleToken(error) && (await renew())) {
      ({ data, error } = await client.rpc(fn, args));
    }
    if (error) {
      throw failure(error);
    }
    return data;
  }

  return {
    async push({ ops }: PushRequest): Promise<PushResponse> {
      return (await call('sync_push', { ops })) as PushResponse;
    },
    async pull({ since, limit }: PullRequest): Promise<PullResponse> {
      return (await call('sync_pull', { since, lim: limit })) as PullResponse;
    },
  };
}
