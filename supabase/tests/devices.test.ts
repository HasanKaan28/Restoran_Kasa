// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

type Market = { id: string; name: string };
type Claimed = { marketId: string; marketName: string; deviceId: string; deviceCode: string };
type Register = {
  id: string;
  code: string;
  name: string;
  platform: string;
  lastSeenAt: string | null;
};
type Devices = { maxDevices: number | null; devices: Register[] };

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

async function openOn(plan: string) {
  const owner = await server.addUser({ email: `${crypto.randomUUID()}@example.com` });
  const code = await server.addActivationCode({ plan });
  const market = await server.as(owner).rpc<Market>('create_own_market', ['Kebapçı Halil', code]);
  return { owner, market };
}

async function join(owner: string, marketId: string, deviceCode: string | null = null) {
  const code = await server.as(owner).rpc<string>('create_pairing', [marketId]);
  const device = await server.addUser({ anonymous: true });
  return server.as(device).rpc<Claimed>('claim_device', [code, deviceCode, 'Kasa', 'web']);
}

describe('the owner’s list of registers', () => {
  it('lists the live registers and the plan’s limit, so a full plan is known before a code', async () => {
    const { owner, market } = await openOn('qr');
    expect(await server.as(owner).rpc<Devices>('owner_devices', [market.id])).toEqual({
      maxDevices: 1,
      devices: [],
    });

    const first = await join(owner, market.id);
    const listed = await server.as(owner).rpc<Devices>('owner_devices', [market.id]);
    expect(listed.maxDevices).toBe(1);
    expect(listed.devices).toEqual([
      expect.objectContaining({ id: first.deviceId, code: 'K1', name: 'Kasa', platform: 'web' }),
    ]);
    expect(listed.devices[0]?.lastSeenAt).toEqual(expect.any(String));
  });

  it('leaves revoked registers out, and has no limit on Restoran Pro', async () => {
    const { owner, market } = await openOn('pro');
    const first = await join(owner, market.id);
    await join(owner, market.id);
    await server.as(owner).rpc('revoke_device', [first.deviceId]);

    const listed = await server.as(owner).rpc<Devices>('owner_devices', [market.id]);
    expect(listed.maxDevices).toBeNull();
    expect(listed.devices.map((device) => device.code)).toEqual(['K2']);
  });

  it('shows a market’s registers to its owner only', async () => {
    const { owner, market } = await openOn('restoran');
    const stranger = await server.addUser({ email: 'baska@example.com' });
    const register = (await server.addDevice(market.id, 'K9')).userId;

    expect(await errorOf(server.as(stranger).rpc('owner_devices', [market.id]))).toContain(
      'not_owner',
    );
    expect(await errorOf(server.as(register).rpc('owner_devices', [market.id]))).toContain(
      'not_owner',
    );
    expect(await errorOf(server.as(null).rpc('owner_devices', [market.id]))).toContain(
      'permission denied',
    );
    expect(await errorOf(server.as(owner).rpc('owner_devices', ['no-such-market']))).toContain(
      'not_owner',
    );
  });

  it('takes over a register at the plan’s limit with the owner’s code', async () => {
    const { owner, market } = await openOn('qr');
    const lost = await join(owner, market.id);
    const code = await server.as(owner).rpc<string>('create_pairing', [market.id]);
    const phone = await server.addUser({ anonymous: true });
    const taken = await server
      .as(phone)
      .rpc<Claimed>('claim_device', [code, 'K1', 'Kasa', 'web', true]);

    const listed = await server.as(owner).rpc<Devices>('owner_devices', [market.id]);
    expect(listed.devices.map((device) => device.id)).toEqual([taken.deviceId]);
    expect(taken.deviceId).not.toBe(lost.deviceId);
  });
});
