import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBottomBar } from './useBottomBar';

function Bar() {
  const ref = useBottomBar<HTMLDivElement>();
  return <div ref={ref}>Gönder</div>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useBottomBar', () => {
  it('lifts toasts above the bar while it is on screen', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(72);
    const root = document.documentElement;
    const { unmount } = render(<Bar />);
    expect(root.style.getPropertyValue('--bottom-bar-h')).toBe('72px');
    unmount();
    expect(root.style.getPropertyValue('--bottom-bar-h')).toBe('');
  });
});
