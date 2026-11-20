import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReleaseWatch } from './releaseWatch';
import { CHECK_EVERY_MS, START_DELAY_MS, TICK_MS, useScheduledChecks } from './schedule';
import { saveCheckedAt } from './updateTimes';

const HOUR = 60 * 60 * 1000;

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

function watching(checkedAt?: number) {
  if (checkedAt !== undefined) {
    saveCheckedAt(localStorage, checkedAt);
  }
  const find = vi.fn(async () => null);
  const watch = createReleaseWatch({ find, storage: localStorage });
  return { find, watch };
}

describe('scheduled update checks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100 * HOUR);
    localStorage.clear();
    setOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    setOnline(true);
  });

  it('checks when the app starts, a moment after it opens', async () => {
    const { find, watch } = watching(100 * HOUR - 1000);
    renderHook(() => useScheduledChecks(watch, { checkOnStart: 'always' }));
    expect(find).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(START_DELAY_MS));
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('checks again at most every few hours while the app stays open', async () => {
    const { find, watch } = watching();
    renderHook(() => useScheduledChecks(watch, { checkOnStart: 'always' }));
    await act(async () => vi.advanceTimersByTime(START_DELAY_MS));
    await act(async () => vi.advanceTimersByTime(CHECK_EVERY_MS - TICK_MS));
    expect(find).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(2 * TICK_MS));
    expect(find).toHaveBeenCalledTimes(2);
    expect(CHECK_EVERY_MS).toBeGreaterThanOrEqual(3 * HOUR);
  });

  it('leaves a recent check be when it starts only when due', async () => {
    const { find, watch } = watching(100 * HOUR - HOUR);
    renderHook(() => useScheduledChecks(watch, { checkOnStart: 'when-due' }));
    await act(async () => vi.advanceTimersByTime(START_DELAY_MS));
    expect(find).not.toHaveBeenCalled();
  });

  it('skips while offline and checks once the line is back', async () => {
    setOnline(false);
    const { find, watch } = watching();
    renderHook(() => useScheduledChecks(watch, { checkOnStart: 'always' }));
    await act(async () => vi.advanceTimersByTime(START_DELAY_MS + TICK_MS));
    expect(find).not.toHaveBeenCalled();
    setOnline(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('never checks during an open dialog, such as a payment', async () => {
    document.body.innerHTML = '<div role="dialog">Ödeme</div>';
    const { find, watch } = watching();
    renderHook(() => useScheduledChecks(watch, { checkOnStart: 'always' }));
    await act(async () => vi.advanceTimersByTime(START_DELAY_MS));
    expect(find).not.toHaveBeenCalled();
    document.body.innerHTML = '';
    await act(async () => vi.advanceTimersByTime(TICK_MS));
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('checks when the app comes back to the front after hours away', async () => {
    const { find, watch } = watching(100 * HOUR - 5 * HOUR);
    renderHook(() => useScheduledChecks(watch, { checkOnStart: 'when-due', startDelayMs: HOUR }));
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('does nothing when switched off', async () => {
    const { find, watch } = watching();
    renderHook(() => useScheduledChecks(watch, { checkOnStart: 'always', enabled: false }));
    await act(async () => vi.advanceTimersByTime(CHECK_EVERY_MS * 2));
    expect(find).not.toHaveBeenCalled();
  });
});
