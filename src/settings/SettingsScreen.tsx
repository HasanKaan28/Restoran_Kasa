import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { APP_VERSION } from '@/app/version';
import { useSession } from '@/app/session';
import { listStaff } from '@/data/staff';
import { Button, ToastRegion, useToast } from '@/design';
import { ROLE_LABELS } from '@/domain/permissions';
import { AppearanceSection } from './AppearanceSection';
import { AuditLog } from './AuditLog';
import { BackupSection } from './BackupSection';
import { NotificationsSection } from '@/notify/NotificationsSection';
import { QrMenuSection } from '@/restaurant/QrMenuSection';
import { TablesSection } from '@/restaurant/TablesSection';
import { LicenseSection, MarketSection, ReceiptSection, RegisterSection } from './MarketSections';
import { StaffDialog } from './StaffDialog';
import { UpdateSection } from './UpdateSection';
import { updateTarget } from './updates';

/** The owner's settings: the market, this register, the receipt and the people who work here. */
export function SettingsScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const session = useSession();
  const toast = useToast();
  const people = useLiveQuery(() => listStaff(db), [db]);
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'edit'; id: string } | null>(null);
  const editing =
    dialog?.kind === 'edit' ? people?.find((person) => person.id === dialog.id) : null;

  useSectionFromAddress();

  function done(message: string) {
    setDialog(null);
    toast.show(message);
    void runner.run();
  }

  return (
    <>
      <AppShell
        marketName={settings.marketName}
        deviceName={settings.deviceName}
        syncState={status.state}
        pendingCount={status.pendingCount}
        syncError={status.error}
        activeNav="settings"
      >
        <h1 className="text-xl font-semibold">Ayarlar</h1>
        <MarketSection onDone={(message) => done(message)} />
        <TablesSection onDone={(message) => done(message)} />
        <QrMenuSection onDone={(message) => toast.show(message)} />
        <RegisterSection />
        <NotificationsSection />
        <AppearanceSection />
        <ReceiptSection onDone={(message) => done(message)} />
        <UpdateSection version={APP_VERSION} {...updateTarget()} />
        <BackupSection />
        <section
          aria-labelledby="staff-heading"
          className="flex flex-col gap-3 rounded-control border border-line bg-surface p-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <h2 id="staff-heading" className="text-lg font-semibold">
                Personel
              </h2>
              <p className="text-sm text-text-2">
                Her kişi uygulamaya kendi PIN'iyle girer; izinler rolden gelir, kişiye göre
                değiştirilebilir.
              </p>
            </div>
            <Button
              variant="primary"
              icon={<Plus aria-hidden="true" size={18} />}
              onClick={() => setDialog({ kind: 'new' })}
            >
              Yeni personel
            </Button>
          </div>
          {people === undefined ? null : people.length === 0 ? (
            <p className="text-text-2">
              Henüz personel yok. İlk eklenen kişi sahip olur; ondan sonra uygulama PIN ile açılır.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {people.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: 'edit', id: person.id })}
                    className="flex min-h-14 w-full items-center gap-3 px-1 text-left hover:bg-bg"
                  >
                    <span className="font-medium">{person.name}</span>
                    <span className="text-sm text-text-2">{ROLE_LABELS[person.role]}</span>
                    {person.archivedAt ? (
                      <span className="ml-auto rounded-chip bg-bg px-2 py-0.5 text-sm text-muted">
                        Pasif
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <LicenseSection />
        <AuditLog />
      </AppShell>
      {dialog?.kind === 'new' && people !== undefined ? (
        <StaffDialog
          open
          first={!people.some((person) => person.role === 'owner' && !person.archivedAt)}
          onClose={() => setDialog(null)}
          onDone={(message, created) => {
            // The first person is the owner who set things up: they stay signed in.
            if (created && session.open) {
              session.signIn(created);
            }
            done(message);
          }}
        />
      ) : null}
      {editing ? (
        <StaffDialog
          open
          person={editing}
          onClose={() => setDialog(null)}
          onDone={(message) => done(message)}
        />
      ) : null}
      <ToastRegion message={toast.message} />
    </>
  );
}

/**
 * Settings for someone who may not change the restaurant's (a waiter): only what belongs to this
 * device, its notices and its screen.
 */
export function DeviceSettingsScreen(): JSX.Element {
  const { settings, runner } = useData();
  const status = useSyncStatus(runner);
  useSectionFromAddress();
  return (
    <AppShell
      marketName={settings.marketName}
      deviceName={settings.deviceName}
      syncState={status.state}
      pendingCount={status.pendingCount}
      syncError={status.error}
      activeNav="settings"
    >
      <h1 className="text-xl font-semibold">Ayarlar</h1>
      <p className="text-text-2">
        Bu cihazın bildirimleri ve görünümü. Restoranın diğer ayarlarını yönetici değiştirir.
      </p>
      <NotificationsSection />
      <AppearanceSection />
    </AppShell>
  );
}

/** `#/settings/<section>` opens Settings at that section, as the setup list's steps do. */
const SECTIONS: Record<string, string> = {
  masalar: 'tables-heading',
  'qr-menu': 'qr-heading',
  personel: 'staff-heading',
  fis: 'receipt-heading',
  cihaz: 'register-heading',
  bildirimler: 'notify-heading',
};

function useSectionFromAddress(): void {
  useEffect(() => {
    function scroll() {
      const part = window.location.hash.split('/')[2] ?? '';
      const heading = document.getElementById(SECTIONS[part] ?? '');
      heading?.closest('section')?.scrollIntoView?.({ block: 'start' });
    }
    // After the sections have rendered their first time.
    const frame = requestAnimationFrame(scroll);
    window.addEventListener('hashchange', scroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', scroll);
    };
  }, []);
}
