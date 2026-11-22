# Restoran Kasa · Yönetim paneli ve ayrıntılı izinler — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Task 1 önce ve tek başına; Task 2–6 Task 1'in commit'inden sonra, her biri kendi git worktree'sinde paralel. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Sahip (ve sahibin izin verdiği personel) uygulama içinden "Yönetim" ekranını açar: raporlar, masa analizi, iptal/tekrar istatistikleri, personel performansı, kaydedilen raporlar, veresiye ve stok. Garson ve mutfak/bar varsayılan olarak bunları görmez; sahip kişi kişi açar.

**Canlı müşteri kuralları (her task için bağlayıcı):**
- `main`'e commit yok, `git push` yok, etiket yok, yayın/Pages/Vercel yok. Canlı Supabase'e (SQL, migration, RPC, dashboard) dokunulmaz.
- v1.0.4 ile uyum ve sıfır veri kaybı: mevcut IndexedDB verisi ve eşitleme güncellemeden sonra çalışır. Yeni alanların hepsi isteğe bağlıdır (`?`); eski kayıtta yokken her ekran çalışır.
- Dokunulmayacaklar: auth, `src/server/onboarding.ts`, `PairDialog`, `WelcomeScreen`, `src/admin/`, `yonetim.html`, hesap açma ve "Bağlantı kodu / Restorana katıl" akışları.
- Yeniden yazma yok, yeniden kullan: `src/stock/`, `src/customers/`, `src/pos/CustomerPicker.tsx`, `src/reports/`.
- TDD: her yeni mantık için test önce yazılır, ÇALIŞTIRILIR ve kırmızı görülür (tip değişikliğinde kırmızı `npm run typecheck` olabilir), sonra kod. Test ile kod aynı anda yazılıp ilk koşuda yeşil görülmez.
- Para hep tamsayı kuruş (`Kurus`). Metinler Türkçe; kod yorumları İngilizce, mevcut üslupta.

## Mimari

- **İzinler** (`src/domain/permissions.ts`): yeni izin `count` (Sayım). Garson (`cashier`) varsayılanı `creditSale` ve `collect`'i kaybeder; Mutfak/Bar (`stock`) varsayılanı boşalır (menü/fiyat, alış fiyatı, stok, tedarikçi yok). `RESTAURANT_PERMISSIONS` sırası: `sell, discount, voidSale, creditSale, collect, overLimit, editProducts, seeCost, stock, count, reports, closeDay, admin`. `can()` aynı kalır.
- **Mevcut personel kararı:** Restoran personel ekranı `creditSale`, `collect`, `stock`, `count`, `overLimit` için hiç kişisel ayar sunmadı; bu yüzden mevcut garsonlar yeni varsayılanı alır (veresiye/stok/rapor kapalı) ve hiçbir şey kaybetmez (bu ekranlar restoranda yoktu). Mutfak/Bar rolündeki mevcut kişiler, sahip özellikle açmadıysa Menü düzenleme ve alış fiyatını kaybeder; sahip personel ekranından tek tıkla geri açar. Kayıtlara toplu yazma yapılmaz (eşitlemeye fazladan patch gitmez).
- **Rotalar** (`src/app/route.ts`): `Route = 'tables' | 'kitchen' | 'products' | 'manage' | 'settings'`. `#/manage/<section>`; eski `#/reports` adresi `manage` + `reports` bölümüne düşer. `ManageSection = 'reports' | 'staff' | 'credit' | 'stock' | 'archive'`.
  - `export function parseManageSection(hash: string): ManageSection | null` — `#/manage/<x>` için x geçerliyse x; `#/reports...` için `'reports'`; yoksa null.
  - `export const SECTION_ACCESS: Record<ManageSection, (can: (p: Permission) => boolean) => boolean>`: reports/staff/archive → `reports`; credit → `creditSale || collect`; stock → `stock || count`.
  - `export function canOpenRoute(route: Route, can: (p: Permission) => boolean): boolean` — products → `editProducts`; manage → herhangi bir bölüm açık; settings → `admin` (yetkisize mevcut DeviceSettingsScreen); diğerleri açık.
  - `export function useManageSection(): ManageSection | null`.
- **Menü:** alt menü yine 5 öğe: Masalar, Mutfak/Bar, Menü, **Yönetim**, Ayarlar. Yönetim yalnız `canOpenRoute('manage')` olana görünür. 375 px'te alt menü taşmaz, sayfa yana kaymaz.
- **Yönetim ekranı** `src/manage/ManageScreen.tsx`: AppShell (`activeNav="manage"`), başlık "Yönetim", bölüm sekmeleri (`#/manage/<section>` bağlantıları, yalnız izinli olanlar; dar ekranda kendi kabında yatay kayar ya da sarar, sayfa kaymaz). Bölüm yoksa ilk izinli bölüme gider. İzinsiz bölüm adresi "Bu ekran için yetkiniz yok." gösterir. Bölüm bileşenleri ayrı dosyalarda (Task 2–6 bunları doldurur):
  - `src/manage/ReportsSection.tsx` — dönem seçici + kasa seçici (mevcut ReportsScreen'den) + alt görünüm: `Satışlar` (mevcut rapor gövdesi, gün sonu dahil) | `Masalar` → `<TableReportView from to />` | `İptal / tekrar` → `<VoidReportView from to />`.
  - `src/reports/TableReportView.tsx`, `src/reports/VoidReportView.tsx` — imza `({ from, to }: { from: string; to: string }) => JSX.Element`; Task 1'de yer tutucu.
  - `src/manage/StaffSection.tsx`, `src/manage/CreditSection.tsx`, `src/manage/StockSection.tsx`, `src/manage/ArchiveSection.tsx` — imza `() => JSX.Element`; Task 1'de yer tutucu.
- **Tipler** (`src/data/types.ts`), hepsi isteğe bağlı:
  - `TabItemRecord`: `voidedAt?: string` (ISO), `voidedByStaffId?: string`, `remakeOf?: string` (asıl satırın id'si), `remakeReason?: string`.
  - `TabRecord`: `closedByStaffId?: string`.
  - Yeni `SavedReportRecord`:
    ```ts
    export type SavedReportRecord = {
      id: string;
      title: string;
      kind: 'period';
      /** Business days, YYYY-MM-DD, both ends included. */
      from: string;
      to: string;
      /** The register the report was limited to; absent for every register. */
      register?: string;
      /** The figures as they were when saved; never recomputed. */
      summary: Summary;
      deviceCode: string;
      staffId?: string;
      createdAt: string;
      updatedAt: string;
      archivedAt?: string;
    };
    ```
- **Dexie v18** (`src/data/db.ts`): `savedReports: 'id, createdAt'`; `tabItems: 'id, tabId, status, station, sentAt, paidSaleId'` (masa raporu için indeks). Upgrade fonksiyonu yok; mevcut satırlar aynen kalır.
- **Eşitleme:** `savedReports` bir **entity** tablosu (arşivlemek için patch'lenir): `OutboxTable`, `SyncTable`, `apply.ts` `ENTITY_TABLES`, gerekiyorsa yedek (`backup.ts`) listesine eklenir. Sunucu bu tabloyu migration uygulanana kadar `unknown_table` ile reddeder: istemci op'u düşürür, satır cihazda kalır. Migration dosyası `supabase/migrations/20261128120000_saved_reports.sql` yazılır, **uygulanmaz** (`app.entity_tables()`'a `'savedReports'` eklenir; tam liste en son migration'dan alınır; `tab_payments` migration'ının "live-safe" başlık üslubu).

## Global Constraints

| Kural | Koruyan test (Task) | Testte kuralı kırabilecek yol |
|---|---|---|
| v17 veritabanı v18'e açılınca tüm satırlar aynen kalır | T1 "upgrades a v17 database without losing rows" | v17 şemasıyla açılmış, `tabItems`/`sales` dolu bir DB; v18 kodu açar, sayım ve içerik aynı |
| Garson varsayılan olarak `creditSale, collect, stock, count, reports, seeCost` göremez; Mutfak/Bar `editProducts, seeCost, stock, count` göremez | T1 permissions testi | kişisel ayarı olmayan garson ve mutfak kişisi |
| Kişisel açık/kapalı ayar varsayılanı ezer (eski kayıtlar korunur) | T1 permissions testi | `{ role:'cashier', permissions:{ creditSale:true } }` |
| İzinsiz kişi ekranı menüde görmez **ve** `#/...` adresiyle açamaz | T1 (Yönetim, bölümler), T2 (PayDialog Veresiye), T6 (Stok/Veresiye bölümleri) | garson oturumu, `#/manage/stock`, `#/manage/credit`, `#/reports` |
| Veresiye seçeneği yalnız `creditSale` iznine; limit aşımı `overLimit` onayına bağlı | T2 | garson oturumunda PayDialog; limiti aşan müşteri |
| Eski kayıtta yeni alan yokken rapor çalışır | T3 (voidedAt/voidedByStaffId yok), T4 | `voidedAt` olmayan iptal satırı → `updatedAt` ile, "bilinmiyor" kişi |
| Tekrar hazırla satırı ücretsiz ama mutfağa yeni fiş olarak gider | T2 | `remakeItem` sonrası `complimentary:true`, `status:'sent'`, yeni `sentAt`; hesap toplamı değişmez |
| Para tamsayı kuruş | her task'ın hesap testleri | ortalama hesap (bölme) yuvarlanır |

**İki cihaz (yerel öncelikli):** Tekrar hazırla ve veresiye satış yeni id'li olay satırlarıdır; iki çevrimdışı cihaz aynı satırı tekrar ederse iki ücretsiz satır oluşur ve raporda iki tekrar görünür (kabul: ikisi de gerçekten mutfağa gitti). İki cihazın aynı müşteriyle limiti birlikte aşması Market Kasa'daki mevcut davranıştır; bu plan değiştirmez.

## Task 1 — Temel: izinler, rotalar, tipler, şema, Yönetim iskeleti (tek başına, önce)

**Files:** `src/domain/permissions.ts`, `src/domain/permissions.test.ts`, `src/app/route.ts`, `src/app/route.test.ts`, `src/app/Screens.tsx`, `src/app/AppShell.tsx`, `src/app/AppShell.test.tsx`, `src/app/access.test.tsx`, `src/data/types.ts`, `src/data/db.ts`, `src/data/db.test.ts`, `src/sync/apply.ts`, `src/sync/protocol.ts` (ve `OutboxTable` nerede tanımlıysa), `src/data/backup.ts` (gerekirse), `src/reports/ReportsScreen.tsx` (gövdeyi gömülebilir yap), `src/manage/*` (yeni), `src/reports/TableReportView.tsx`, `src/reports/VoidReportView.tsx` (yer tutucu), `src/settings/StaffDialog.tsx` (yalnız gerekiyorsa: yeni izinlerin görünmesi), `src/notify/ReadyNotifier.tsx` (yalnız `'reports'` rotasına bağımlıysa), `supabase/migrations/20261128120000_saved_reports.sql`.

- [ ] İzin testleri (kırmızı) → `permissions.ts` değişikliği. Etiketler: `creditSale: 'Veresiye satış'`, `collect: 'Tahsilat, veresiye müşterileri'`, `overLimit: 'Veresiye limit aşımı onayı'`, `stock: 'Stok, mal kabul, kritik stok'`, `count: 'Sayım'`.
- [ ] Rota testleri (kırmızı) → `route.ts`: `parseRoute('#/reports') === 'manage'`, `parseManageSection`, `SECTION_ACCESS`, `canOpenRoute`.
- [ ] `access.test.tsx`/`AppShell.test.tsx` (kırmızı): garson menüde Yönetim görmez; `#/manage/stock` ve `#/reports` "yetkiniz yok"; sahip Yönetim'i görür ve 5 sekme; stok izni olan mutfak kişisi Yönetim'de yalnız Stok sekmesini görür.
- [ ] ManageScreen + bölüm yer tutucuları + ReportsSection (mevcut rapor davranışı aynen: mevcut `ReportsScreen.test.tsx` geçer; gerekirse testi yeni yerine taşı, beklentileri zayıflatma).
- [ ] Tipler, Dexie v18, eşitleme tablosu, v17→v18 testi, migration dosyası.
- [ ] `npm run lint && npm run typecheck && npm test` temiz → commit `feat(manage): Yönetim screen, finer permissions and the shared schema`.

## Task 2 — Adisyon akışları: iptal damgası, tekrar hazırla, veresiye ödeme

**Files:** `src/data/restaurant.ts`, `src/data/restaurant.test.ts` (veya yeni `src/data/remake.test.ts`), `src/restaurant/tender.ts`, `src/restaurant/tender.test.ts`, `src/restaurant/PayDialog.tsx`, `src/restaurant/TabView.tsx`, `src/restaurant/OrderLines.tsx` (gerekirse), `src/restaurant/KitchenScreen.tsx` (tekrar etiketi), ilgili `src/restaurant/*.test.tsx`.

- [ ] `voidItem(db, itemId, reason, at, staffId?)`: patch'e `voidedAt: at.toISOString()` ve varsa `voidedByStaffId`. TabView çağrısı oturumdaki kişiyi geçirir.
- [ ] `payTabItems`: tab kapanırken (paid ya da cancelled) `closedByStaffId` (input.staffId varsa). Input'a `customerId?: string`; `recordSale`'e geçer (veresiye borcu `recordSale`'in mevcut yoluyla yazılır).
- [ ] `remakeItem(db, { itemId, reason, deviceCode, staffId? }, at): Promise<TabItemRecord>`: asıl satır `sent` ya da `ready` (ödenmiş olabilir mi? karar ver, ledger'a yaz); sebep boş olamaz; tab açık olmalı. Yeni satır: ürün, ad, birim, fiyat, miktar, porsiyon, seçenekler, not, istasyon aynı; `complimentary: true`, `remakeOf`, `remakeReason`, `status: 'sent'` (hazırlık istemeyen istasyonda `sendTab` ile aynı kural), `sentAt = orderedAt = at`. Tek transaction, outbox'a yazılır. Hesap toplamı değişmez.
- [ ] TabView'de gönderilmiş satırda "Tekrar hazırla" eylemi; sebep sorulur (iptal sebebi diyaloğunun üslubu). İzin: `discount` (ikram ile aynı); yoksa mevcut `useApproval` ile onay. Mutfak ekranında tekrar satırı "Tekrar" etiketiyle görünür.
- [ ] `tender.ts`: `Tender` 'credit' eklenir → `[{ method: 'credit', amount: due }]`. PayDialog'da "Veresiye" seçeneği yalnız `session.can('creditSale')` ise; seçilince `CustomerPicker` ile müşteri zorunlu; limit aşımı `overLimit` onayı (PosScreen'deki akışı örnek al, yeniden yazma). Paylı (tutar) ödeme veresiye almaz.
- [ ] Testler: garson oturumunda Veresiye seçeneği yok; izinli kişi müşteri seçmeden ödeyemez; veresiye satış müşteriye borç yazar; `remakeItem` hesap toplamını değiştirmez ve mutfak fişinde görünür; eski `voidItem` çağrısı (staffId yok) çalışır.
- [ ] Commit'ler bu task'ın dalında.

## Task 3 — Masa analizi ve iptal/tekrar raporu

**Files (yeni):** `src/reports/tableReport.ts`, `src/reports/tableReport.test.ts`, `src/reports/voidReport.ts`, `src/reports/voidReport.test.ts`, `src/reports/TableReportView.tsx`, `src/reports/VoidReportView.tsx` (+ testleri). Başka dosyaya dokunma.

- [ ] `loadTableReport(db, { from, to })`: dönemdeki (business day) iptal edilmemiş satışlar → `tabItems.paidSaleId` → tab → masa. Masa başına: adisyon sayısı, fiş sayısı, ciro, ortalama adisyon (kuruş, yuvarlanmış). Paket (masasız tab) ayrı satır; tab'a bağlanmayan satış (Market Kasa satışı) "Diğer". Toplam satırı. Arşivlenmiş masa adıyla görünür.
- [ ] `loadVoidReport(db, { from, to, cutoffMinutes })`: (a) fiş iptalleri `saleVoids` (sebep, kim, ne zaman, tutar); (b) mutfağa gitmiş satır iptalleri: `status === 'void'` ve `sentAt` dolu (`voidedAt` yoksa `updatedAt`; `voidedByStaffId` yoksa kişi bilinmiyor); (c) iptal adisyonlar: `status === 'cancelled'` (kapanış zamanı, `closedByStaffId ?? staffId`); (d) tekrarlar: `remakeOf` dolu satırlar (sebep, kim, ne zaman, asıl ürün). Sayılar ve listeler. Dönem filtresi business day ile (`businessDate` + `cutoffMinutes`).
- [ ] Görünümler: tablo + mobilde kart; 375 px'te sayfa yana kaymaz. Personel adları `db.staff`'tan.
- [ ] Bugünkü mevcut veriyle çalışır (yeni alanlar olmadan).

## Task 4 — Personel performansı (Bugün / Bu ay)

**Files (yeni):** `src/manage/staffStats.ts`, `src/manage/staffStats.test.ts`, `src/manage/StaffSection.tsx`, `src/manage/StaffSection.test.tsx`.

- [ ] `loadStaffStats(db, { from, to, cutoffMinutes })` kişi başına: sipariş satırı (`tabItems.staffId`, `orderedAt` dönemde, `remakeOf` olanlar ayrı sayılmaz/sayılır — karar ver, yaz), açtığı adisyon (`tabs.staffId`, `openedAt`), kapattığı hesap ve satış toplamı (`sales.staffId`, `businessDate`; iptal edilen fiş toplamdan düşer), yaptığı iptal (`voidedByStaffId` satırlar + `saleVoids.staffId`).
- [ ] StaffSection: her aktif personel için Bugün ve Bu ay sütunları; arşivli ama dönemde işi olan da görünür; personel yokken açıklama. Telefonda kart.

## Task 5 — Kaydedilen raporlar (arşiv)

**Files (yeni):** `src/data/savedReports.ts`, `src/data/savedReports.test.ts`, `src/manage/ArchiveSection.tsx`, `src/manage/ArchiveSection.test.tsx`.

- [ ] `saveReport(db, { title, from, to, register?, summary, deviceCode, staffId? }, at)`, `listSavedReports(db)` (arşivlenmemiş, yeni önce), `archiveSavedReport(db, id, at)`; `src/data/records.ts`'in mevcut insert/patch + outbox yardımcılarıyla.
- [ ] ArchiveSection: (1) Gün sonu kayıtları: `cashSessions` listesi (tarih, kasa, kişi, beklenen/sayılan/fark), açınca mevcut Z raporu görünümü/yazdırma yeniden kullanılır. (2) "Dönemi kaydet": dönem seçici (`periodOf`), başlık, `loadSummary` sonucu anlık görüntü olarak saklanır. (3) Kaydedilenler listesi: aç (kayıtlı `summary` mevcut rapor tablolarıyla gösterilir, yeniden hesaplanmaz), CSV (`reportCsv`), yazdır/PDF (`printReport`), arşivle.
- [ ] Not: sunucu migration'ı yokken kayıt cihazda kalır; ekranda bunu söylemeye gerek yok.

## Task 6 — Stok ve veresiye bölümleri

**Files:** `src/stock/StockScreen.tsx` (gövdeyi AppShell'siz bir panele ayır), `src/customers/CustomersScreen.tsx` (aynı; "v1'den aktar" restoran panelinde gizli), `src/manage/StockSection.tsx`, `src/manage/CreditSection.tsx`, testleri.

- [ ] StockSection: Mal kabul, Kritik stok, SKT → `stock`; Sayım → `count`. Yalnız izinli görünümler. Alış fiyatı/kâr yalnız `seeCost` ile (mevcut bileşenler zaten uyuyorsa aynen bırak; uymuyorsa ekle).
- [ ] CreditSection: mevcut müşteri ekranı; tahsilat `collect`, limit düzenleme/borç düzeltme mevcut `overLimit` onayları. Yazma yollarını kodda ara (müşteri ekle/düzenle, tahsilat, düzeltme, limit) ve her birinin hangi izne bağlı olduğunu raporda listele; açık kalan yol varsa kapat.
- [ ] Mevcut Market Kasa testleri geçmeye devam eder.

## Review Focus

1. Her izin kuralının **nesnesine** giden tüm yazma yolları (veresiye: ödeme diyaloğu, müşteri ekranı tahsilat/düzeltme/limit; stok: mal kabul, sayım, elle düzeltme; maliyet: her görünüm). Ekran değil, nesne korunur.
2. Eski kayıtlar (yeni alanlar yok) ve v1.0.4 cihazdan gelen satırlar.
3. 375 px: alt menü, Yönetim sekmeleri, rapor tabloları — sayfa yana kaymaz.
4. Business day sınırı (`cutoffMinutes`) ile "Bugün/Bu ay".

---

## Ek (2026-11-22, kullanıcının yeni istekleri)

Task 1'e eklenenler (temel): `ManageSection` → `'suppliers'` (Tedarikçi / Fatura, izin `suppliers`, `src/manage/SuppliersSection.tsx` yer tutucu); ReportsSection'a 4. alt görünüm `Günlük rapor` → `src/reports/DailyReportView.tsx` (`{from, to}`); `TabItemRecord.deliveredAt?: string`.

**Karar — "fatura takibi":** `src/invoices/` e-Arşiv satış faturasıdır; faturayı sunucudaki sağlayıcı bağdaştırıcısı keser ve canlı sunucuda yoktur (kayıtlar "bekliyor"da kalır). Bu yüzden restorana bağlanmaz; sunucu adımı olarak raporlanır. Alış faturası takibi `src/suppliers/` (tedarikçi, alış faturası, ödeme; `suppliers` + `supplierLedger` canlıda zaten eşitleniyor) Task 6 kapsamında Yönetim > Tedarikçi / Fatura bölümüne bağlanır.

## Task 7 — Bölüme göre masa numarası

**Files:** `src/restaurant/TablesSection.tsx` ve masa adı önerisini üreten yer (gerekirse yeni saf modül `src/restaurant/tableNumbering.ts` + testi). `src/data/restaurant.ts`'e dokunma (gerekiyorsa yalnız okunur).

- [ ] Bir bölüme masa eklenirken önerilen numara o bölümün kendi en büyük numarasından devam eder; boş bölüm 1'den başlar (Salon 1–10, Dışarı 1, 2…). Toplu ekleme varsa aynı kural.
- [ ] Mevcut masalar, id'leri ve adları değişmez; yalnız yeni masa önerisi değişir. Arşivli masalar numara hesabında: ruling ver, yaz.
- [ ] Test önce: Salon 1–10 varken Dışarı'ya eklenen ilk masa "1".

## Task 8 — Günlük rapor (ürün bazlı, yazdır/PDF)

**Files (yeni):** `src/reports/dailyReport.ts`, `src/reports/dailyReport.test.ts`, `src/reports/DailyReportView.tsx` (+ test), `src/reports/printDailyReport.tsx`. Mevcut `summary.ts`, `printReport.tsx`, `reportCsv.ts`'i yeniden kullan; değiştirme (gerekirse yalnız ekleme).

- [ ] Dönem için (çoğunlukla Bugün): kategoriye göre gruplu ürün satırları (ad, adet/miktar, tutar), kategori ara toplamları, genel toplam, ödeme dağılımı (nakit/kart/veresiye), ikramlar ve iptaller ayrı satırda, fiş sayısı. Kategorisiz ürünler "Diğer".
- [ ] "Günlük rapor al": temiz, sunulabilir sayfa; Yazdır (tarayıcı yazdırma = PDF olarak kaydet) ve CSV. 375 px'te okunur.
- [ ] Para tamsayı kuruş; iptal edilmiş fiş rapora girmez.

## Task 10 — "Teslim edildi" ve otomatik sipariş adisyonu

**Files:** yeni `src/data/deliver.ts` (+ test), yeni `src/restaurant/orderSlip.ts` (+ test), yeni `src/restaurant/OrderSlipPrinter.tsx`, yeni cihaz ayarı modülü (mevcut `src/notify/` cihaz ayarı deseniyle), sipariş girişindeki gönder düğmesinin olduğu bileşen (TabView/OrderLines/MenuBrowser — en az dokunuşla), Ayarlar'da cihaz ayarı satırı (`src/settings/SettingsScreen.tsx` DeviceSettings bölümü). `src/data/restaurant.ts`'e yalnız gerekli küçük export eklemeleri.

- [ ] Gönderilmemiş satırlar için "Mutfağa gönder"in yanında "Teslim edildi": satırlar `status: 'ready'`, `sentAt = readyAt = servedAt = deliveredAt = at` olur; mutfak/bar ekranında görünmez, beklemez. v1.0.4 bu satırları servis edilmiş hazır satır olarak okur (yeni durum yok).
- [ ] Cihaz ayarı "Siparişte adisyon bas": Kapalı (varsayılan) / Yalnız teslim edilenler / Tüm siparişler. Yalnız açık cihaz basar.
- [ ] Basan cihaz, eşitlemeyle gelen her yeni sipariş partisini (aynı tab + aynı `sentAt`) bir kez basar: ürünler ve adetler, giren kişi, masa, saat ve tarih. Yeniden yükleme/yeniden eşitleme sonrası tekrar basmaz; ayar ilk açıldığında eski partileri basmaz (açılış anı imleç olarak saklanır; basılan parti anahtarları cihazda tutulur, sınırlı boyutta).
- [ ] Sessiz baskı: tarayıcı her zaman yazdırma penceresi gösterir; Electron'da sessiz baskı mümkünse `electron/` tarafına küçük bir köprü (yoksa ruling + rapor). Android: ne mümkün olduğunu rapora yaz, kod yazma.
- [ ] Ödemedeki fiş değişmez; normal mutfağa gönder akışı aynen kalır.

## Paralel dağıtım (Task 1'den sonra, her biri kendi worktree'sinde)

T2 (iptal damgası, tekrar, veresiye ödeme), T3 (masa + iptal/tekrar raporu), T4 (personel performansı + StaffDialog izin ekranı), T5 (rapor arşivi), T6 (stok + veresiye + tedarikçi/fatura bölümleri), T7 (masa numarası), T8 (günlük rapor), T10 (teslim edildi + adisyon). T2 ve T10 `TabView`/`restaurant.ts`'te çakışabilir: ikisi de değişikliği küçük tutar, yeni kodu yeni dosyalara koyar; birleştirmeyi controller yapar.
