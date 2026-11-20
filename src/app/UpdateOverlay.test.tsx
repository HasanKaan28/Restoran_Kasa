import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopUpdates, UpdateStatus } from '@/settings/updates';
import { UpdateOverlay } from './UpdateOverlay';

function desktop() {
  let listener: ((status: UpdateStatus) => void) | undefined;
  const bridge: DesktopUpdates = {
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    onStatus(callback) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  return { bridge, emit: (status: UpdateStatus) => act(() => listener?.(status)) };
}

function preferReducedMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const mark = () => document.querySelector('.update-mark');

describe('UpdateOverlay', () => {
  it('covers the screen while a startup update downloads, then while it installs', () => {
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    emit({ kind: 'available', version: '2.0.6', installNow: true });
    const dialog = screen.getByRole('dialog', { name: 'Güncelleniyor' });
    expect(dialog).toHaveTextContent('Sürüm 2.0.6 indiriliyor');
    expect(dialog).toHaveTextContent(
      'Verileriniz cihazda güvende; birazdan kendiliğinden açılacak.',
    );

    emit({ kind: 'downloading', percent: 42, installNow: true });
    expect(screen.getByRole('progressbar', { name: 'İndirme' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('%42');
    expect(screen.getByRole('dialog')).toHaveTextContent('Sürüm 2.0.6 indiriliyor');

    emit({ kind: 'installing', version: '2.0.6' });
    expect(screen.getByRole('dialog', { name: 'Kuruluyor' })).toHaveTextContent(
      'Program kapanıp yeni sürümle kendiliğinden açılacak.',
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('prints the mark as the download runs and settles it with a tick when it is in', () => {
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    emit({ kind: 'downloading', percent: 30, installNow: true });
    expect(mark()).toHaveAttribute('data-state', 'feed');
    expect(mark()).toHaveStyle({ '--feed': '0.3' });
    emit({ kind: 'installing', version: '2.0.6' });
    expect(mark()).toHaveAttribute('data-done');
  });

  it('names the version even when the page missed the first news of it', () => {
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    emit({ kind: 'downloading', percent: 10, installNow: true, version: '2.0.7' });
    expect(screen.getByRole('dialog')).toHaveTextContent('Sürüm 2.0.7 indiriliyor');
  });

  it('holds the mark still and shows a plain bar for reduced motion', () => {
    preferReducedMotion();
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    emit({ kind: 'downloading', percent: 42, installNow: true });
    expect(mark()).toHaveAttribute('data-state', 'still');
    const bar = screen.getByRole('progressbar', { name: 'İndirme' });
    expect(bar.querySelector('[data-bar]')).toHaveStyle({ width: '42%' });
  });

  it('stays away from an update that waits for the app to close', () => {
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    emit({ kind: 'available', version: '2.0.6', installNow: false });
    emit({ kind: 'downloading', percent: 42, installNow: false });
    emit({ kind: 'ready', version: '2.0.6' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no way to put the update off: it always goes in', () => {
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    emit({ kind: 'downloading', percent: 5, installNow: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('gives up on a failed download and lets the register work', () => {
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    emit({ kind: 'downloading', percent: 5, installNow: true });
    emit({ kind: 'error' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
