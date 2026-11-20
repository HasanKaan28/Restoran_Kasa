import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopUpdates, UpdateStatus } from '@/settings/updates';
import { DesktopReadyNotice } from './DesktopReadyNotice';
import { loadCheckedAt } from './updateTimes';

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

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('DesktopReadyNotice', () => {
  it('says a release downloaded at work goes in when the app closes, or now on a press', async () => {
    const { bridge, emit } = desktop();
    render(<DesktopReadyNotice desktop={bridge} />);
    expect(screen.queryByRole('region')).toBeNull();

    emit({ kind: 'ready', version: '2.0.5' });
    const notice = screen.getByRole('region', { name: 'Yeni sürüm 2.0.5 hazır' });
    expect(notice).toHaveTextContent('Program kapanınca kendiliğinden kurulacak.');
    await userEvent.click(screen.getByRole('button', { name: 'Şimdi yeniden başlat' }));
    expect(bridge.install).toHaveBeenCalled();
  });

  it('goes away when closed, and the release still goes in at closing time', async () => {
    const { bridge, emit } = desktop();
    render(<DesktopReadyNotice desktop={bridge} />);
    emit({ kind: 'ready', version: '2.0.5' });
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('region')).toBeNull();
    expect(bridge.install).not.toHaveBeenCalled();
  });

  it('waits behind an open dialog, such as a payment', async () => {
    const { bridge, emit } = desktop();
    render(<DesktopReadyNotice desktop={bridge} />);
    const payment = document.createElement('div');
    payment.setAttribute('role', 'dialog');
    await act(async () => document.body.append(payment));
    emit({ kind: 'ready', version: '2.0.5' });
    expect(screen.queryByRole('region')).toBeNull();
    await act(async () => payment.remove());
    expect(screen.getByRole('region', { name: 'Yeni sürüm 2.0.5 hazır' })).toBeInTheDocument();
  });

  it('steps aside once the install starts', () => {
    const { bridge, emit } = desktop();
    render(<DesktopReadyNotice desktop={bridge} />);
    emit({ kind: 'ready', version: '2.0.5' });
    emit({ kind: 'installing', version: '2.0.5' });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('remembers when the updater last heard back, for Settings', () => {
    const { bridge, emit } = desktop();
    render(<DesktopReadyNotice desktop={bridge} now={() => 4242} />);
    emit({ kind: 'checking' });
    expect(loadCheckedAt(localStorage)).toBeNull();
    emit({ kind: 'current' });
    expect(loadCheckedAt(localStorage)).toBe(4242);
  });
});
