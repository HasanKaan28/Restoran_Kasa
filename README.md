# Restoran Kasa

**Site:** https://restoran-kasa-nine.vercel.app/ · **Web app:** https://restoran-kasa-nine.vercel.app/app/ · **GitHub Pages copy:** [site](https://hasankaan28.github.io/Restoran_Kasa/) / [app](https://hasankaan28.github.io/Restoran_Kasa/app/) · **Downloads:** [latest release](https://github.com/HasanKaan28/Restoran_Kasa/releases/latest)

An offline-first restaurant and bar point of sale: tables, tabs (adisyon), a kitchen and bar
screen, and the register behind them. It is built on [Market Kasa v2](https://github.com/HasanKaan28/Market_Kasa)
(same sync, staff, reports, updates and backups) and adds the restaurant's own flow. One React
codebase runs as a web app (PWA, for waiters' phones and tablets), a Windows desktop app
(Electron) and an Android app (Capacitor).

> **Status:** `1.0.0`. Restoran Kasa has its own Supabase project. The GitHub Pages copy still
> runs against the old shared project for existing registers, until they are moved.

## What it does

- **Floor (Masalar):** every table by area, empty or with its tab's total, how long it has been
  open and how many lines are ready to serve. Takeaway orders (Paket) sit beside the tables.
- **Tab (Adisyon):** the menu by category or search on one side, the order on the other. Lines
  are taken (a second tap adds one more, notes such as "acısız"), then sent in one go.
- **Kitchen and bar (Mutfak / Bar):** each product is prepared in the kitchen, at the bar or
  nowhere. Each station's screen shows one ticket per table, the longest waiting first (red
  after 15 minutes); a tap marks a line ready and the waiter sees it on the floor.
- **Changes after sending:** a line is made a treat (ikram, no charge) or voided with a reason,
  each by a person with that permission.
- **Bill (Hesap):** pay everything, or tick only some lines to split by what each person had;
  a per-head share is shown. Cash with change, or card. Every payment is a receipt on the
  register, so the Z report, the reports and the stock count it.
- **Portions and choices:** a dish can have portions at their own prices (Yarım, 1,5, Duble)
  and choice groups asked when it is ordered (Acı, Pişme); a required one must be answered.
- **Courses:** a line can be kept back ("Sonra gönder") and fired later with one tap; the
  kitchen sees the next course greyed on the ticket. A sent line can be repeated in one tap.
- **Bill requested (Hesap istendi):** the table turns amber and its tab takes no new lines
  until it is paid or unlocked. A long press (or right click) on a table offers its actions:
  open, ask for the bill, take the payment, move or merge.
- **Kitchen helpers:** a strip counts every dish still to make across tickets ("Adana ×9"),
  tickets turn yellow at 10 minutes and red at 15, and the last line marked ready by mistake
  can be brought back.
- **Move and merge:** move a tab to an empty table, or merge it into another table's tab.
- **Everything else** from Market Kasa: quick sale at the counter, menu (products) with
  categories, stock and goods receipts for the bar, customers on credit, suppliers, staff with
  PIN and permissions, reports, backups, automatic desktop updates.

Prices on an open tab follow the menu until it is paid, as a register's cart does.

Money is kept in integer kuruş, quantities in thousandths, and the business day follows the
shop's own cut-off time in Europe/Istanbul.

## Running it

Requires Node.js 24 or later.

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # Vitest
npm run lint
npm run typecheck
npm run build      # dist/
```

The data lives in the browser's IndexedDB (Dexie), one database per shop. A fresh browser starts
empty in open mode: add the owner in Settings → Personel to turn on PIN sign-in.

### Syncing registers

Copy `.env.example` to `.env.local` and fill in the Supabase project's URL and **publishable** key
(never a secret or `service_role` key). The schema is in `supabase/migrations/`; its tests run on
PGlite with `npm test`.

1. In the Supabase dashboard, turn on anonymous sign-ins. Turn "Confirm email" off unless the
   project sends email through its own SMTP: the built-in sender only reaches the team.
2. On the first device, the first screen's **Restoran kur** signs the restaurant up with its own
   email and opens it; the device becomes register K1.
3. On every other device, **Restorana giriş yap** with the same email and password: it becomes the
   next register (K2, K3…). The password is never kept on a device. Registers bound to the same
   restaurant see each other's sales, tabs and credit.

### Desktop (Windows)

```bash
npm run electron:start       # after npm run build
npm run electron:installer   # dist-electron/*.exe
```

The desktop app serves the build from its own `app://market` origin with the sandbox, web
security and a content security policy on. A packaged build has no developer tools, and links
such as WhatsApp open in the system browser.

### Android

```bash
npm run cap:sync   # builds and copies dist/ into android/
npm run cap:open   # opens Android Studio
```

Android cloud backups are off (`allowBackup="false"`).

Release APKs are signed with one release key (repository secrets `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), so each version
installs over the last one and keeps its data. Lose the key and that stops: back it up.

## Moving from v1

> **Take the backup before installing or updating to v2.** The desktop installer replaces v1
> in place and the Android app has to be reinstalled; after that, v1 and its data cannot be
> opened to export them.

v1 keeps its data in its own browser storage, which v2 cannot read. In v1, open Settings and
press **Yedek İndir (JSON)**, then in v2:

- **Products and stock:** Products → İçe aktar → choose the backup file. The usual preview
  shows what will be added; products whose VAT shows as 1% are counted, because v1 wrote 1%
  when no rate was chosen.
- **Customers and their debts:** Customers → v1'den aktar (owners only). The preview lists new
  customers, those already here (same name and phone) and rows that cannot be brought over.
  Each debt is written as one opening adjustment. Running the same backup again adds nothing.

Sales history, v1 users and supplier records are not brought over.

## Project layout

| Path | What is there |
| --- | --- |
| `src/domain` | Pure rules: money, VAT, business day, permissions, PIN, tax numbers |
| `src/data` | The Dexie database, every write as one transaction with its sync queue entry |
| `src/sync` | Push and pull of the queue, applying pulled rows |
| `src/app`, `src/design` | App shell, session, routing, shared components and tokens |
| `src/pos`, `src/products`, `src/stock`, `src/customers`, `src/suppliers`, `src/reports`, `src/invoices`, `src/settings` | The screens |
| `src/import`, `src/pwa` | v1 backup import, service worker registration |
| `electron/` | The desktop main process and its tested security helpers |
| `docs/v2` | The design (`DESIGN.md`), the plans with their implementation notes, the backlog (`ertelenenler.md`) |

The design and the plans are in Turkish.

## Releasing

Two workflows run on GitHub Actions:

- **`v2-ci.yml`** runs lint, type check, tests and a build on every push to `v2` and on pull
  requests.
- **`v2-release.yml`** runs only when started by hand or by a `v2.*` tag. It builds the web app,
  the signed APK and the Windows installer against the server in the repository variables
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. On a tag it opens a **draft** release
  (the tag must equal `v` + the version in `package.json`) and deploys the web app to GitHub
  Pages; a run by hand deploys only with **deploy_pages** ticked.

The Vercel project builds `main` on every push with its own environment variables (site at `/`,
app at `/app/`); GitHub Pages is still deployed only from `v2-release.yml`.

No workflow deploys anything on a push to a branch. v1's workflow, which redeployed Pages and
republished releases on every push to `main`, is removed on `v2`.

The service worker caches by version: bump `version` in `package.json` for each release so
installed web apps pick up the new files.

## Not built yet

Planned as milestones M0b-2 and M0b-3 (see `docs/v2/ertelenenler.md`):

- the web back office and the operator panel,
- the e-Arşiv provider adapter that issues, fails or cancels invoices (requests stay pending),
- server-side rules: licence, the last owner, permissions, invoice status changes,
- a signed desktop installer and auto-update (Windows warns before installing).

## Licence

The repository has no licence file. Unless the owner adds one, all rights are reserved.
