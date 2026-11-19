import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastRegion } from './ToastRegion';
import { useToast } from './useToast';

afterEach(() => {
  vi.useRealTimers();
});

describe('toast', () => {
  it('shows a message and clears it after the duration', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast(1000));
    act(() => result.current.show('Satış tamamlandı'));
    expect(result.current.message).toBe('Satış tamamlandı');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.message).toBeNull();
  });

  it('announces its message politely', () => {
    render(<ToastRegion message="Satış tamamlandı" />);
    expect(screen.getByRole('status', { name: 'Bildirim' })).toHaveTextContent('Satış tamamlandı');
  });

  it('carries an action, such as undo, and stays longer with one', () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    const { result } = renderHook(() => useToast(1000));
    act(() => result.current.show('Masa 1 hazır', { label: 'Geri al', onAction }));
    expect(result.current.action?.label).toBe('Geri al');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.message).toBe('Masa 1 hazır');
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.message).toBeNull();
    expect(result.current.action).toBeUndefined();
  });

  it('runs its action once and closes', async () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ToastRegion
        message="Ayran hazır"
        action={{ label: 'Geri al', onAction }}
        onDismiss={onDismiss}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
