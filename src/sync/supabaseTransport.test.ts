import { describe, expect, it, vi } from 'vitest';
import type { ServerClient } from '@/server/client';
import {
  DeviceRevokedError,
  DeviceUnpairedError,
  LicenseExpiredError,
  supabaseTransport,
} from './supabaseTransport';

type Reply = { data?: unknown; error?: { message: string; code?: string } };

const STALE: Reply = {
  error: { message: 'No suitable key was found to decode the JWT', code: 'PGRST301' },
};

/** A stand-in client that answers each RPC call from a script, in order. */
function scripted(replies: Reply[], refreshOk = true) {
  let n = 0;
  const rpc = vi.fn(async () => {
    const reply = replies[Math.min(n++, replies.length - 1)] ?? {};
    return { data: reply.data ?? null, error: reply.error ?? null };
  });
  const refreshSession = vi.fn(async () =>
    refreshOk
      ? { data: { session: {} }, error: null }
      : { data: { session: null }, error: { message: 'Invalid Refresh Token' } },
  );
  const signOut = vi.fn(async () => ({ error: null }));
  const client = {
    rpc,
    auth: { refreshSession, signOut },
  } as unknown as ServerClient;
  return { client, rpc, refreshSession, signOut };
}

describe('supabase transport session renewal', () => {
  it('renews the session once and retries when the token is from another project', async () => {
    const t = scripted([STALE, { data: { rows: [], latest: 3 } }]);
    const out = await supabaseTransport(t.client).pull({ since: 0, limit: 10 });
    expect(out).toEqual({ rows: [], latest: 3 });
    expect(t.refreshSession).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledTimes(2);
    expect(t.signOut).not.toHaveBeenCalled();
  });

  it('asks to pair again when the renewal fails, without signing out', async () => {
    const t = scripted([STALE], false);
    await expect(supabaseTransport(t.client).push({ ops: [] })).rejects.toThrow(
      DeviceUnpairedError,
    );
    expect(t.refreshSession).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.signOut).not.toHaveBeenCalled();
  });

  it('asks to pair again when the retry fails the same way, after one renewal', async () => {
    const t = scripted([STALE, STALE]);
    await expect(supabaseTransport(t.client).pull({ since: 0, limit: 1 })).rejects.toThrow(
      DeviceUnpairedError,
    );
    expect(t.refreshSession).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledTimes(2);
  });

  it('does not hammer the server with renewals after one failed', async () => {
    const t = scripted([STALE], false);
    const transport = supabaseTransport(t.client);
    await expect(transport.push({ ops: [] })).rejects.toThrow(DeviceUnpairedError);
    await expect(transport.pull({ since: 0, limit: 1 })).rejects.toThrow(DeviceUnpairedError);
    expect(t.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('reports a revoked register without renewing', async () => {
    const t = scripted([{ error: { message: 'device_revoked' } }]);
    await expect(supabaseTransport(t.client).push({ ops: [] })).rejects.toThrow(DeviceRevokedError);
    expect(t.refreshSession).not.toHaveBeenCalled();
  });

  it('reports a licence past its grace without renewing', async () => {
    const t = scripted([{ error: { message: 'license_expired', code: 'P0001' } }]);
    await expect(supabaseTransport(t.client).pull({ since: 0, limit: 1 })).rejects.toThrow(
      LicenseExpiredError,
    );
    expect(t.refreshSession).not.toHaveBeenCalled();
  });

  it('reports an unregistered register without renewing', async () => {
    const t = scripted([{ error: { message: 'device_not_registered' } }]);
    await expect(supabaseTransport(t.client).push({ ops: [] })).rejects.toThrow(
      DeviceUnpairedError,
    );
    expect(t.refreshSession).not.toHaveBeenCalled();
  });
});
