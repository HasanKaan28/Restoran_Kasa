import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicMenu } from './model';
import { startMenuPage } from './page';

const config = { url: 'https://proje.supabase.co', key: 'sb_publishable_abc' };
const SLUG = 'Ab3dEf6hIj9kLm2nOp4qRs7tUv';

const menu: PublicMenu = {
  name: 'Kebapçı Halil',
  categories: [
    { id: 'c-corba', name: 'Çorbalar' },
    { id: 'c-izgara', name: 'Izgara' },
  ],
  dishes: [
    {
      name: 'Adana kebap',
      price: 45000,
      categoryId: 'c-izgara',
      portions: [{ label: 'Yarım', price: 25000 }],
      options: [{ name: 'Acı', choices: ['Acılı', 'Acısız'] }],
    },
    { name: 'Mercimek çorbası', price: 12050, categoryId: 'c-corba', description: 'Limonla' },
    { name: 'Ayran', price: 5000 },
  ],
};

const respond = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.title = '';
});

const open = (options: Partial<Parameters<typeof startMenuPage>[0]> = {}) =>
  startMenuPage({
    root,
    config,
    location: { search: '?masa=5', hash: `#${SLUG}` },
    fetcher: respond(menu),
    storage: localStorage,
    ...options,
  });

describe('the guest menu page', () => {
  it('shows the restaurant, the table and its categories in order', async () => {
    await open();

    expect(screen.getByRole('heading', { level: 1, name: 'Kebapçı Halil' })).toBeInTheDocument();
    expect(screen.getByText('Masa 5')).toBeInTheDocument();
    expect(document.title).toBe('Kebapçı Halil · Menü');
    const tabs = within(screen.getByRole('navigation', { name: 'Kategoriler' }));
    expect(tabs.getAllByRole('button').map((tab) => tab.textContent)).toEqual([
      'Çorbalar',
      'Izgara',
      'Diğer',
    ]);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Çorbalar',
      'Izgara',
      'Diğer',
    ]);
    const adana = screen.getByRole('heading', { level: 3, name: 'Adana kebap' }).closest('li');
    expect(adana).toHaveTextContent('₺450');
    expect(adana).toHaveTextContent('Yarım ₺250');
    expect(adana).toHaveTextContent('Acı: Acılı, Acısız');
    expect(screen.getByText('Limonla')).toBeInTheDocument();
    expect(screen.getByText('₺120,50')).toBeInTheDocument();
  });

  it('marks the tab of the section a guest jumps to', async () => {
    await open();
    const tab = screen.getByRole('button', { name: 'Izgara' });
    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Çorbalar' })).not.toHaveAttribute('aria-current');
    // Jumping never touches the address, which holds the slug.
    expect(window.location.hash).toBe('');
  });

  it('searches the menu and says what it found', async () => {
    await open();
    const search = screen.getByRole('searchbox', { name: 'Menüde ara' });

    fireEvent.input(search, { target: { value: 'corba' } });
    expect(screen.getByRole('status')).toHaveTextContent('1 yemek bulundu');
    expect(screen.queryByRole('navigation', { name: 'Kategoriler' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Mercimek çorbası' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Ayran' })).not.toBeInTheDocument();

    fireEvent.input(search, { target: { value: 'pizza' } });
    expect(screen.getByRole('status')).toHaveTextContent('“pizza” menüde yok.');

    fireEvent.input(search, { target: { value: '' } });
    expect(screen.getByRole('navigation', { name: 'Kategoriler' })).toBeInTheDocument();
  });

  it('says so when the link is turned off or unknown, and forgets the kept copy', async () => {
    localStorage.setItem(`rk.menu.${SLUG}`, JSON.stringify({ menu }));
    await open({ fetcher: respond(null) });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Menü şu an görüntülenemiyor',
    );
    expect(localStorage.getItem(`rk.menu.${SLUG}`)).toBeNull();
  });

  it('asks for the code again when the link has no slug, without calling the server', async () => {
    const fetcher = respond(menu);
    await open({ location: { search: '', hash: '' }, fetcher });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bağlantı eksik');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('offers to try again after a failure, and loads on the second try', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify(menu)));
    await open({ fetcher });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Menü yüklenemedi');
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Kebapçı Halil' })).toBeInTheDocument(),
    );
  });

  it('shows the last menu it loaded when the connection drops', async () => {
    await open();
    root.replaceChildren();
    await open({ fetcher: vi.fn<typeof fetch>(() => Promise.reject(new TypeError('offline'))) });

    expect(screen.getByRole('heading', { level: 1, name: 'Kebapçı Halil' })).toBeInTheDocument();
    expect(screen.getByText(/son yüklenen hâli/)).toBeInTheDocument();
  });

  it('tells the guest when the menu has no dishes yet', async () => {
    await open({ fetcher: respond({ ...menu, dishes: [] }) });
    expect(screen.getByRole('heading', { level: 1, name: 'Kebapçı Halil' })).toBeInTheDocument();
    expect(screen.getByText('Menü hazırlanıyor')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('cannot be fooled into drawing markup from the menu', async () => {
    await open({
      fetcher: respond({ ...menu, name: '<img src=x onerror=alert(1)>', dishes: [] }),
    });
    expect(root.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('<img src=x');
  });
});
