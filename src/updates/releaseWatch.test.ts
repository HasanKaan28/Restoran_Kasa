import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReleaseWatch, type Found } from './releaseWatch';
import { CHECKED_KEY, saveCheckedAt } from './updateTimes';

describe('release watch', () => {
  beforeEach(() => localStorage.clear());

  it('starts from the last check this device remembers', () => {
    saveCheckedAt(localStorage, 1000);
    const watch = createReleaseWatch({ find: async () => null, storage: localStorage });
    expect(watch.get()).toEqual({ checking: false, checkedAt: 1000, found: null, failed: false });
  });

  it('checks, remembers when, and tells whoever listens', async () => {
    const watch = createReleaseWatch({
      find: async () => ({ version: '1.2.0' }),
      storage: localStorage,
      now: () => 5000,
    });
    const heard = vi.fn();
    watch.subscribe(heard);
    const done = watch.check();
    expect(watch.get().checking).toBe(true);
    await done;
    expect(watch.get()).toEqual({
      checking: false,
      checkedAt: 5000,
      found: { version: '1.2.0' },
      failed: false,
    });
    expect(localStorage.getItem(CHECKED_KEY)).toBe('5000');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('asks once when two checks overlap', async () => {
    const find = vi.fn(async () => null);
    const watch = createReleaseWatch({ find, storage: localStorage });
    await Promise.all([watch.check(), watch.check()]);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('says a failed check failed and keeps what an earlier check found', async () => {
    const find = vi
      .fn<() => Promise<Found | null>>()
      .mockResolvedValueOnce({ version: '1.2.0' })
      .mockRejectedValueOnce(new TypeError('offline'));
    const watch = createReleaseWatch({ find, storage: localStorage, now: () => 7 });
    await watch.check();
    await watch.check();
    expect(watch.get()).toEqual({
      checking: false,
      checkedAt: 7,
      found: { version: '1.2.0' },
      failed: true,
    });
  });

  it('stops telling a listener that left', async () => {
    const watch = createReleaseWatch({ find: async () => null, storage: localStorage });
    const heard = vi.fn();
    const leave = watch.subscribe(heard);
    leave();
    await watch.check();
    expect(heard).not.toHaveBeenCalled();
  });
});
