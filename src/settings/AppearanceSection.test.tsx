import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { AppearanceSection } from './AppearanceSection';

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('AppearanceSection', () => {
  it('follows the system until this device chooses', () => {
    render(<AppearanceSection />);
    const section = screen.getByRole('region', { name: 'Görünüm' });
    expect(within(section).getByRole('radio', { name: 'Sistem' })).toBeChecked();
    expect(within(section).getByRole('radio', { name: 'Açık' })).not.toBeChecked();
    expect(within(section).getByRole('radio', { name: 'Koyu' })).not.toBeChecked();
  });

  it('switches the screen at once and remembers the choice on this device', async () => {
    render(<AppearanceSection />);
    await userEvent.click(screen.getByRole('radio', { name: 'Koyu' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('rk.theme')).toBe('dark');

    await userEvent.click(screen.getByRole('radio', { name: 'Açık' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('rk.theme')).toBe('light');

    await userEvent.click(screen.getByRole('radio', { name: 'Sistem' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('rk.theme')).toBeNull();
  });

  it('shows the choice this device made before', () => {
    localStorage.setItem('rk.theme', 'dark');
    render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: 'Koyu' })).toBeChecked();
  });
});
