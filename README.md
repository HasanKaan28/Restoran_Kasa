# Restoran Kasa

**Site:** https://restorankasa.vercel.app/ · **Web app:** https://restorankasa.vercel.app/app/ · **Old address:** [GitHub Pages app](https://hasankaan28.github.io/Restoran_Kasa/app/) (its front page sends people to the site) · **Downloads:** [latest release](https://github.com/HasanKaan28/Restoran_Kasa/releases/latest)

An offline-first restaurant and bar point of sale: tables, tabs (adisyon), a kitchen and bar
screen, and the register behind them. It is built on [Market Kasa v2](https://github.com/HasanKaan28/Market_Kasa)
(same sync, staff, reports, updates and backups) and adds the restaurant's own flow. One React
codebase runs as a web app (PWA, for waiters' phones and tablets), a Windows desktop app
(Electron) and an Android app (Capacitor).

> **Status:** `1.0.0`. Restoran Kasa has its own Supabase project and its own address. The web app
> is still served on GitHub Pages too, for registers set up there before the move (browser data is
> kept per address); both copies sync with the same project.

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
2. On the first device, the first screen's **Restoran kur** takes the seller's activation code,
   signs the restaurant up with its own email and opens it; the device becomes register K1.
3. On every other device, **Restorana giriş yap** with the same email and password: it becomes the
   next register (K2, K3…). The password is never kept on a device. Registers bound to the same
   restaurant see each other's sales, tabs and credit.

### Who may write what

The registers of one restaurant trust each other: the app is local-first, and every register
keeps selling offline and syncs later. The server keeps restaurants apart; inside one, roles and
permissions are enforced on the registers.

- **A paired register** (its anonymous session in `localStorage['rk.auth']`) may push any row of
  its own restaurant's synced tables (menu, tables and tabs, staff, settings, sales, cash, the
  audit log) through `sync_push`, and read them through `sync_pull`; never another restaurant's.
  A lost or stolen device holds the restaurant's data and can write to it: revoke it.
- **Only the server** writes the restaurant itself, its plan and licence, its registers, its QR
  menu link and the activation and pairing codes; registers reach none of them.
- **A row is kept under its own id.** An insert naming another id, or a patch that clears or
  changes the id, is refused (`bad_record`), and a register sets aside any pulled row whose id is
  not the one the server keeps it by. **Events** (sales, voids, returns, cash, the audit log…) are
  written once: never patched, and a second copy changes nothing.
- **Who sent it.** A row's `deviceCode` and `staffId` are what the sending register wrote. The
  server records which register actually sent each row (`app.rows.pushed_by`, never sent to the
  registers), so an entry written in another register's name can be traced.
- **Staff PINs** switch the person at a register; they do not protect the data from someone who
  holds a paired device or a backup. The hashes (PBKDF2-SHA256; 600,000 rounds for PINs set since
  November 2026) sync to every register and are in backups, and four to six digits fall to an
  offline search. A sign-in survives a reload only by a token whose hash is kept in that
  register's database: a staff id written into `localStorage` signs nobody in, and a PIN change
  ends that person's sessions.
- Anyone who can run code in the page (developer tools on a web register, a script on the same
  address) can do whatever that register can. The desktop app has no developer tools; keep web
  registers on devices the staff do not administer.

### Activation codes and licences

Nobody opens a restaurant without a one-time **activation code** from the seller. The seller
issues codes on the yönetim page and sends them over WhatsApp; the shop types or pastes the code
on **Restoran kur**. The schema is `supabase/migrations/20261121120000_activation.sql`.

- **Codes** look like `RK-ABCD-EFGH-JKMN`: twelve characters from an alphabet without 0/O or 1/I,
  drawn on the server from `gen_random_uuid()`. A code carries a plan and a number of days. Opening
  a restaurant uses it up in one statement, so two shops sending one code at once cannot both
  succeed. An unknown, used or revoked code is refused alike (`activation_invalid`). Registers
  built before codes call the old `create_own_market(name)`, which now answers
  `activation_required`.
- **Plans** (`app.plans`): `qr` (QR Menü, 1 register), `restoran` (Restoran, 5 registers), `pro`
  (Restoran Pro, any number). A new register past the limit is refused with `device_limit N`;
  taking over a register code, or a revoked register, does not count. Nothing else is gated by
  plan yet.
- **Licence:** opening sets `license_expires_at` to now plus the code's days. The register sees
  the plan and the end with every pull, warns in the last 7 days, and keeps selling and syncing
  for **7 days of grace** after the end. After that the server refuses `sync_push` and
  `sync_pull` (`license_expired`) and the register says so; nothing done on it is lost, and it
  syncs again as soon as the licence is extended. Past the grace, or once the seller suspends
  the restaurant, it also gets no pairing code and no new register, and its QR menu can be
  turned off but not on or given a new link. A market with no end (`license_expires_at`
  null, as every market opened before codes) is never limited, and the yönetim page will not put
  an end on it.

**The yönetim page** is `/app/yonetim` (`yonetim.html`, its own small Vite entry; Vercel rewrites
the address, GitHub Pages gets a redirect page). It is built only when `RK_YONETIM=1` (the Vercel
build and the release's Pages build set it), so the desktop and Android apps never carry it. The seller signs in with his own email and
password (**Hesap oluştur** the first time). An account sees nothing until it is an operator: run
this once in the Supabase SQL editor, with his email:

```sql
insert into app.operators (user_id)
select id from auth.users where lower(email) = lower('seller@example.com') and not is_anonymous;
```

He then issues codes (plan, 14 days trial / 1 month / 3 months / 6-month season / 1 year or any
number of days, a note), copies them or sends them on WhatsApp, revokes unused ones, and sees every
restaurant with its plan, days left, registers and when one was last seen; he can extend a
licence (from its end, or from today once it has ended) and change the plan. The page opens on an
overview (restaurants by state, codes, registers, licences ending this week with a one-tap
extension); a restaurant's detail lets him suspend or activate it, set its licence end, give it its
own register limit, rename it and its registers, revoke a register, run its QR menu, make a support
pairing code, keep a private note and delete it softly (suspended and marked, nothing removed).
He can also issue codes in bulk, filter and search them, send a dismissible announcement to one
restaurant's registers or all, and read the log of every change he made (`app.operator_log`).
**The seller sees aggregated usage only** (counts of synced sales, tabs, rows and active registers);
no sale, tab, customer or other record ever reaches the yönetim page.

**Environment:** `VITE_SUPPORT_WHATSAPP` is the seller's number, digits only with the country code
(`905xxxxxxxxx`). The first screen's "Kodunuz yok mu?" link, the device-limit message and the
licence banner open a WhatsApp chat with it; without it they say to contact the seller. Set it in
Vercel's environment variables and as a GitHub repository variable (the release workflow passes
it to every build), next to `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The site's
WhatsApp button reads the same number from `site/config.js`.

### Desktop (Windows)

```bash
npm run electron:start       # after npm run build
npm run electron:installer   # dist-electron/*.exe
```

The desktop app serves the build from its own `app://market` origin with the sandbox, web
security and a content security policy on; the page may talk only to the restaurant's Supabase
project and Open Food Facts. It is granted the camera (for the barcode scanner) and clipboard
writing, nothing else. A packaged build has no developer tools, and only the app's own links
(WhatsApp chats, its GitHub releases, restorankasa.vercel.app) open in the system browser.

### Android

```bash
npm run cap:sync   # builds and copies dist/ into android/
npm run cap:open   # opens Android Studio
```

Android cloud backups are off (`allowBackup="false"`), and the FileProvider offers only the app's
own files.

Release APKs are signed with one release key (repository secrets `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), so each version
installs over the last one and keeps its data. Lose the key and that stops: back it up.
`scripts/setup-android-signing.ps1` creates the key once (run it yourself; it refuses when the
secrets exist), sets the four secrets with `gh` and leaves a backup of the key and its password in
`Documents\Restoran-Kasa-imza`.

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
| `src/admin` | The seller's yönetim page (`yonetim.html`): overview, restaurants, codes, announcements, history |
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
app at `/app/`); GitHub Pages is still deployed only from `v2-release.yml`, with the app under
`app/` and a front page (`.github/pages/index.html`) that sends visitors to the Vercel site.

`vercel.json` gives each page its own security headers: a Content-Security-Policy (only its own
files; the app, the menu and the yönetim page may also reach the Supabase project; no framing),
`nosniff`, a Referrer-Policy and a Permissions-Policy that lets only the app use the camera. The
inline theme scripts of `index.html` and `site/index.html` are allowed by their hash: change a
script and `src/pwa/headers.test.ts` (and, for `index.html`, `electron/security.test.ts`) asks for
the new one. Moving to another Supabase project means changing its address in `vercel.json` and
`electron/security.cjs` too.

No workflow deploys anything on a push to a branch. v1's workflow, which redeployed Pages and
republished releases on every push to `main`, is removed on `v2`.

The service worker caches by version: bump `version` in `package.json` for each release so
installed web apps pick up the new files.

## Not built yet

Planned as milestones M0b-2 and M0b-3 (see `docs/v2/ertelenenler.md`):

- the web back office (the operator's yönetim page for codes and licences is built),
- the e-Arşiv provider adapter that issues, fails or cancels invoices (requests stay pending),
- server-side rules: the last owner, permissions, invoice status changes,
- a signed desktop installer and auto-update (Windows warns before installing).

## Licence

The repository has no licence file. Unless the owner adds one, all rights are reserved.
