import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Screens } from '@/app/Screens';
import { SessionProvider } from '@/app/SessionProvider';
import { closeCashSession, currentCashSession } from '@/data/cash';
import { createProduct } from '@/data/products';
import { createStaff } from '@/data/staff';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { signInAs } from '@/test/session';

afterEach(async () => {
  localStorage.clear();
  await disposeTestData();
});

async function restaurant() {
  const data = createTestData();
  await createProduct(data.db, { name: 'Ayran', sellPrice: 4000, vatRate: 1 }, new Date());
  return data;
}

describe('opening the till in the morning', () => {
  it('asks for the opening cash when the day starts with no till open', async () => {
    const data = await restaurant();
    await renderWithData(<Screens route="tables" />, data);
    const prompt = await screen.findByRole('dialog', { name: 'Kasayı aç' });
    await userEvent.type(within(prompt).getByLabelText('Açılış tutarı'), '500');
    await userEvent.click(within(prompt).getByRole('button', { name: 'Kasayı aç' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Kasayı aç' })).toBeNull());
    expect(await currentCashSession(data.db, 'K1')).toMatchObject({ openingCash: 50000 });
    expect(await screen.findByText('Kasa açıldı · ₺500,00')).toBeInTheDocument();
  });

  it('asks once the menu arrives, as on a register that has just joined', async () => {
    const data = createTestData();
    await renderWithData(<Screens route="tables" />, data);
    await screen.findByRole('heading', { name: 'Masalar' });
    expect(screen.queryByRole('dialog', { name: 'Kasayı aç' })).toBeNull();
    await createProduct(data.db, { name: 'Ayran', sellPrice: 4000, vatRate: 1 }, new Date());
    expect(await screen.findByRole('dialog', { name: 'Kasayı aç' })).toBeInTheDocument();
  });

  it('lets it wait for today, and asks no more today', async () => {
    const data = await restaurant();
    const first = await renderWithData(<Screens route="tables" />, data);
    const prompt = await screen.findByRole('dialog', { name: 'Kasayı aç' });
    await userEvent.click(within(prompt).getByRole('button', { name: 'Şimdi değil' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Kasayı aç' })).toBeNull());
    first.unmount();

    await renderWithData(<Screens route="tables" />, data);
    await screen.findByRole('heading', { name: 'Masalar' });
    expect(screen.queryByRole('dialog', { name: 'Kasayı aç' })).toBeNull();
    expect(await currentCashSession(data.db, 'K1')).toBeUndefined();
  });

  it('does not ask a register that closed today, nor a person who does not close the day', async () => {
    const closed = await restaurant();
    await closeCashSession(closed.db, { deviceCode: 'K1', countedCash: 0 }, new Date());
    const view = await renderWithData(<Screens route="tables" />, closed);
    await screen.findByRole('heading', { name: 'Masalar' });
    expect(screen.queryByRole('dialog', { name: 'Kasayı aç' })).toBeNull();
    view.unmount();

    const data = await restaurant();
    await createStaff(data.db, { name: 'Mert', role: 'owner', pin: '1111' }, new Date());
    const ali = await createStaff(
      data.db,
      { name: 'Ali', role: 'cashier', pin: '2222' },
      new Date(),
    );
    await signInAs(data.db, ali.id);
    await renderWithData(
      <SessionProvider>
        <Screens route="tables" />
      </SessionProvider>,
      data,
    );
    await screen.findByRole('heading', { name: 'Masalar' });
    expect(screen.queryByRole('dialog', { name: 'Kasayı aç' })).toBeNull();
  });
});
