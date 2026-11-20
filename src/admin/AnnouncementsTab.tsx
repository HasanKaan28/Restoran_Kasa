import { useState, type FormEvent, type JSX } from 'react';
import { Button, ChoiceGroup, SelectField } from '@/design';
import type { Announcement, OperatorApi } from './api';
import { dateTimeText, dayText } from './model';
import { failed, useLoad } from './load';
import { Alert, ConfirmDialog, Loading, TextArea } from './ui';

const MAX_MESSAGE = 280;
const EVERYONE = '';

/** How long an announcement stays up; null until it is taken down. */
type Duration = 'open' | 1 | 7 | 30;

/**
 * A short message from the seller, for one restaurant's registers or every restaurant's: each
 * register shows it under its header on its next sync, until closed there or taken down here.
 */
export function AnnouncementsTab({ api }: { api: OperatorApi }): JSX.Element {
  const announcements = useLoad(() => api.listAnnouncements(), 'announcements');
  const restaurants = useLoad(() => api.listRestaurants(), 'restaurants');

  return (
    <>
      <section aria-labelledby="new-announcement" className="flex flex-col gap-4">
        <h2 id="new-announcement" className="text-title font-semibold">
          Duyuru
        </h2>
        <AnnounceForm
          api={api}
          restaurants={(restaurants.data ?? []).filter((item) => item.deletedAt === null)}
          onSent={announcements.reload}
        />
      </section>
      <section aria-labelledby="announcements" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="announcements" className="text-label font-semibold">
            Duyurular
          </h2>
          <Button variant="ghost" className="ml-auto" onClick={announcements.reload}>
            Yenile
          </Button>
        </div>
        {announcements.error ? <Alert>{announcements.error}</Alert> : null}
        {announcements.data === undefined && !announcements.error ? <Loading /> : null}
        {announcements.data?.length === 0 ? (
          <p className="text-text-2">Henüz duyuru yayınlanmadı.</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {announcements.data?.map((item) => (
            <AnnouncementRow
              key={item.id}
              announcement={item}
              api={api}
              onChanged={announcements.reload}
            />
          ))}
        </ul>
      </section>
    </>
  );
}

function AnnounceForm({
  api,
  restaurants,
  onSent,
}: {
  api: OperatorApi;
  restaurants: { id: string; name: string }[];
  onSent(): void;
}): JSX.Element {
  const [target, setTarget] = useState(EVERYONE);
  const [message, setMessage] = useState('');
  const [duration, setDuration] = useState<Duration>(7);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setSent(undefined);
    try {
      await api.announce(
        target === EVERYONE ? null : target,
        message,
        duration === 'open' ? null : duration,
      );
      setSent(
        target === EVERYONE
          ? 'Duyuru bütün restoranlara gönderildi; cihazlar bir sonraki eşitlemede gösterir.'
          : 'Duyuru gönderildi; cihazlar bir sonraki eşitlemede gösterir.',
      );
      setMessage('');
      onSent();
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-plate border border-line bg-surface p-4"
      onSubmit={(event) => void submit(event)}
    >
      <SelectField
        label="Kime"
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        options={[
          { value: EVERYONE, label: 'Bütün restoranlar' },
          ...restaurants.map((item) => ({ value: item.id, label: item.name })),
        ]}
      />
      <TextArea
        label="Mesaj"
        hint={`${message.trim().length} / ${MAX_MESSAGE} karakter. Kasada başlığın altında görünür; kapatılabilir.`}
        maxLength={MAX_MESSAGE}
        required
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      <ChoiceGroup<Duration>
        legend="Ne kadar görünsün"
        name="announcement-duration"
        wrap
        value={duration}
        onChange={setDuration}
        options={[
          { value: 1, label: '1 gün' },
          { value: 7, label: '1 hafta' },
          { value: 30, label: '1 ay' },
          { value: 'open', label: 'Kaldırana kadar' },
        ]}
      />
      {error ? <Alert>{error}</Alert> : null}
      {sent ? (
        <p role="status" className="text-sm font-medium text-success">
          {sent}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={busy || message.trim() === ''}>
        Duyuruyu yayınla
      </Button>
    </form>
  );
}

function AnnouncementRow({
  announcement,
  api,
  onChanged,
}: {
  announcement: Announcement;
  api: OperatorApi;
  onChanged(): void;
}): JSX.Element {
  const [removing, setRemoving] = useState(false);
  const state = announcement.live
    ? announcement.expiresAt
      ? `Yayında · ${dayText(announcement.expiresAt)} tarihine kadar`
      : 'Yayında · kaldırana kadar'
    : announcement.removedAt
      ? `Kaldırıldı · ${dayText(announcement.removedAt)}`
      : 'Süresi doldu';

  return (
    <li
      className={`slip ${announcement.live ? 'edge-open' : 'edge-quiet'} flex flex-col gap-1.5 px-4 py-3`}
    >
      <p className="text-sm font-semibold">{announcement.marketName ?? 'Bütün restoranlar'}</p>
      <p className="break-words">{announcement.message}</p>
      <p className={`text-meta ${announcement.live ? 'text-success' : 'text-muted'}`}>{state}</p>
      <p className="text-meta text-muted">{dateTimeText(announcement.createdAt)}</p>
      {announcement.live ? (
        <div>
          <Button variant="ghost" className="-ml-2" onClick={() => setRemoving(true)}>
            Kaldır…
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={removing}
        title="Duyuru kaldırılsın mı?"
        description="Cihazlar bir sonraki eşitlemede bu duyuruyu göstermez."
        confirmLabel="Kaldır"
        onClose={() => setRemoving(false)}
        onConfirm={async () => {
          await api.removeAnnouncement(announcement.id);
          onChanged();
        }}
      />
    </li>
  );
}
