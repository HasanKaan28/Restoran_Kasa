import { useLiveQuery } from 'dexie-react-hooks';
import { Megaphone, X } from 'lucide-react';
import { useContext, type JSX } from 'react';
import {
  dismissAnnouncement,
  loadAnnouncements,
  loadDismissedAnnouncements,
} from '@/data/announcements';
import { DataContext } from './appData';

/**
 * The seller's messages to this restaurant (sent from the yönetim page, received on sync), each a
 * line under the shell's header until someone closes it on this register.
 */
export function AnnouncementBanner(): JSX.Element | null {
  const data = useContext(DataContext);
  const shown = useLiveQuery(async () => {
    if (!data) {
      return [];
    }
    const [all, dismissed] = await Promise.all([
      loadAnnouncements(data.db),
      loadDismissedAnnouncements(data.db),
    ]);
    return all.filter((item) => !dismissed.includes(item.id));
  }, [data]);
  if (!data || !shown || shown.length === 0) {
    return null;
  }
  return (
    <section aria-label="Duyurular" className="flex flex-col">
      {shown.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 border-b border-line bg-accent/10 py-1 pr-1 pl-4 text-sm text-text md:pl-6"
        >
          <Megaphone
            aria-hidden="true"
            size={18}
            strokeWidth={1.75}
            className="shrink-0 text-accent"
          />
          <p className="min-w-0 flex-1 py-1.5 font-medium break-words">{item.message}</p>
          <button
            type="button"
            aria-label="Duyuruyu kapat"
            onClick={() => void dismissAnnouncement(data.db, item.id)}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-chip text-text-2 hover:bg-bg hover:text-text"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </section>
  );
}
