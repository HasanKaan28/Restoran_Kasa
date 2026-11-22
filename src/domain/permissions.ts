export type Role = 'cashier' | 'stock' | 'manager' | 'owner';

export const ROLES: readonly Role[] = ['cashier', 'stock', 'manager', 'owner'];

/** The keys are the market's (stored with every person); the names are the restaurant's. */
export const ROLE_LABELS: Record<Role, string> = {
  cashier: 'Garson',
  stock: 'Mutfak / Bar',
  manager: 'Yönetici',
  owner: 'Sahip',
};

/** What a person may do, one key per row of DESIGN §8.5. */
export const PERMISSIONS = [
  'sell',
  'creditSale',
  'overLimit',
  'discount',
  'returnWithReceipt',
  'voidSale',
  'collect',
  'addProduct',
  'editProducts',
  'seeCost',
  'stock',
  'count',
  'suppliers',
  'reports',
  'closeDay',
  'invoice',
  'admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  sell: 'Hesap alma, ödeme',
  creditSale: 'Veresiye satış',
  overLimit: 'Veresiye limit aşımı onayı',
  discount: 'İkram, indirim',
  returnWithReceipt: 'Fişli iade',
  voidSale: 'Gönderilmiş ürünü iptal, satış iptali',
  collect: 'Tahsilat, veresiye müşterileri',
  addProduct: 'Kasada yeni ürün ekleme',
  editProducts: 'Menü düzenleme, fiyat değiştirme',
  seeCost: 'Alış fiyatı ve kârı görme',
  stock: 'Stok, mal kabul, kritik stok',
  count: 'Sayım',
  suppliers: 'Tedarikçi, alış faturaları',
  reports: 'Raporlar',
  closeDay: 'Gün sonu',
  invoice: 'Fatura kesme',
  admin: 'Personel, cihaz, ayar, dışa aktarma',
};

/**
 * What the restaurant's staff screen offers, in its order. The rest (returns, adding a product
 * at the register, invoices) are the market's: kept on each person, not shown here.
 */
export const RESTAURANT_PERMISSIONS: readonly Permission[] = [
  'sell',
  'discount',
  'voidSale',
  'creditSale',
  'collect',
  'overLimit',
  'editProducts',
  'seeCost',
  'stock',
  'count',
  'suppliers',
  'reports',
  'closeDay',
  'admin',
];

// No "Gün sonu" for a waiter: it lives in Yönetim, which a waiter does not see, and closing the
// day (counting the till, the Z) is a manager's. Credit and stock are the owner's to give too:
// staff records are never rewritten, so what an owner turned on for a person stays on.
const CASHIER: readonly Permission[] = ['sell', 'returnWithReceipt', 'addProduct', 'invoice'];
// The kitchen and the bar prepare what is ordered; menu, cost, stock and suppliers are given
// person by person.
const STOCK: readonly Permission[] = [];

/**
 * Each role's permissions by default: the market's DESIGN §8.5, narrowed for the restaurant's
 * waiters and kitchen.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  cashier: CASHIER,
  stock: STOCK,
  manager: PERMISSIONS.filter((permission) => permission !== 'admin'),
  owner: PERMISSIONS,
};

/** A person as far as permissions go: a role, and what is turned on or off for them alone. */
export type Grantee = { role: Role; permissions?: Partial<Record<Permission, boolean>> };

/**
 * Whether a person may do something: their own setting when they have one, else their role's.
 * The owner may do everything, so a market can never lock itself out of its own settings, and
 * only an owner may do what `admin` covers (DESIGN §8.3 asks for the owner). A role this build
 * does not know, as from a newer device, may do nothing.
 */
export function can(person: Grantee, permission: Permission): boolean {
  if (person.role === 'owner') {
    return true;
  }
  const defaults = ROLE_PERMISSIONS[person.role] as readonly Permission[] | undefined;
  if (permission === 'admin' || defaults === undefined) {
    return false;
  }
  return person.permissions?.[permission] ?? defaults.includes(permission);
}
