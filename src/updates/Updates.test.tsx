import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopUpdates, UpdateStatus } from '@/settings/updates';
import { Updates } from './Updates';

function desktop() {
  let listeners: ((status: UpdateStatus) => void)[] = [];
  const bridge: DesktopUpdates = {
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    onStatus(callback) {
      listeners.push(callback);
      return () => {
        listeners = listeners.filter((listener) => listener !== callback);
      };
    },
  };
  const emit = (status: UpdateStatus) => act(async () => listeners.forEach((hear) => hear(status)));
  return { bridge, emit };
}

describe('Updates', () => {
  it('gives the desktop app its update screen and its closing-time notice', async () => {
    const { bridge, emit } = desktop();
    render(<Updates target={{ desktop: bridge, android: false, web: false }} />);
    await emit({ kind: 'ready', version: '2.0.5' });
    expect(screen.getByRole('region', { name: 'Yeni sürüm 2.0.5 hazır' })).toBeInTheDocument();
    await emit({ kind: 'downloading', percent: 12, installNow: true });
    expect(screen.getByRole('dialog', { name: 'Güncelleniyor' })).toBeInTheDocument();
    // The update screen is over everything: the notice steps behind it.
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('keeps a quiet place for the web app’s notice, and adds nothing else', () => {
    const { container } = render(<Updates target={{ android: false, web: true }} />);
    expect(container.querySelector('[aria-live="polite"]')).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
