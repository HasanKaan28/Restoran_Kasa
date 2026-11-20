import { BellRing, X } from 'lucide-react';
import type { JSX } from 'react';
import { noticeText, STATION_LABELS, type ReadyNotice } from './readyNotices';

export type ReadyBannerProps = {
  notices: readonly ReadyNotice[];
  /** A tap on a notice: open its tab. */
  onOpen(notice: ReadyNotice): void;
  onDismiss(id: string): void;
};

/**
 * "Masa 5 hazır" at the top of the screen, over whatever is open: one slip per table and station,
 * the newest first. A tap opens the tab; the cross puts it away. Always present, so a screen
 * reader announces each new one.
 */
export function ReadyBanner({ notices, onOpen, onDismiss }: ReadyBannerProps): JSX.Element {
  return (
    <div
      role="region"
      aria-label="Hazır siparişler"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+8px)]"
    >
      {notices.map((notice) => {
        const text = noticeText(notice);
        return (
          <div
            key={notice.id}
            className="slip edge-ready pointer-events-auto flex w-full max-w-[480px] animate-toast-in items-stretch shadow-raised"
          >
            <button
              type="button"
              onClick={() => onOpen(notice)}
              aria-label={`${text.sentence}. Adisyonu aç`}
              className="flex min-h-14 min-w-0 flex-1 items-start gap-3 rounded-l-plate py-2.5 pr-1 pl-3 text-left hover:bg-bg"
            >
              <BellRing
                aria-hidden="true"
                size={20}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0 text-success"
              />
              <span className="flex min-w-0 flex-col">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-base font-semibold">{text.title}</span>
                  <span className="text-meta font-medium text-muted">
                    {STATION_LABELS[notice.station]}
                  </span>
                </span>
                <span className="text-body text-text-2">{text.body}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDismiss(notice.id)}
              aria-label={`${text.title}: kapat`}
              className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-r-plate text-muted hover:bg-bg hover:text-text"
            >
              <X aria-hidden="true" size={18} strokeWidth={1.75} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
