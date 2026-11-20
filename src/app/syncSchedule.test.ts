import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepSyncing, SYNC_INTERVAL_MS } from './syncSchedule';

function fakeRunner() {
  return { run: vi.fn(() => Promise.resolve({} as never)), start: vi.fn(), stop: vi.fn() };
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
});

describe('keepSyncing', () => {
  it('syncs every few seconds, so a ticket reaches the kitchen while the guests wait', () => {
    const runner = fakeRunner();
    stop = keepSyncing(runner);
    expect(runner.start).toHaveBeenCalledWith(SYNC_INTERVAL_MS);
    expect(SYNC_INTERVAL_MS).toBeLessThanOrEqual(10_000);
  });

  it('syncs at once when the network comes back', () => {
    const runner = fakeRunner();
    stop = keepSyncing(runner);
    window.dispatchEvent(new Event('online'));
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('syncs at once when the screen is shown again, not when it is hidden', () => {
    const runner = fakeRunner();
    stop = keepSyncing(runner);
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(runner.run).not.toHaveBeenCalled();
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('stops the rounds and stops listening once stopped', () => {
    const runner = fakeRunner();
    keepSyncing(runner)();
    expect(runner.stop).toHaveBeenCalled();
    window.dispatchEvent(new Event('online'));
    expect(runner.run).not.toHaveBeenCalled();
  });
});
