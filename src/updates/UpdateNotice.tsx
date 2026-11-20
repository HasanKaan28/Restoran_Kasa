import { X } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { UpdateMark } from './UpdateMark';

/** A link that looks like the primary Button: "İndir ve kur" leaves the app for the download. */
export const PRIMARY_LINK =
  'inline-flex min-h-touch items-center justify-center gap-2 rounded-control border border-transparent bg-accent px-4 text-body font-semibold whitespace-nowrap text-on-accent no-underline select-none hover:bg-accent-hover';

export type UpdateNoticeProps = {
  open: boolean;
  /** Read out with the notice: "Yeni sürüm 1.2.0 hazır". */
  title: string;
  detail?: string;
  /** The notice's buttons, the main one first. */
  actions?: ReactNode;
  onClose(): void;
  /** One row (the web's "Yeni sürüm hazır · Yenile"); otherwise a card with room for a hint. */
  compact?: boolean;
  children?: ReactNode;
};

/**
 * A new release, offered without stopping anyone: a card under the header, on the right of a
 * wide screen and across a phone, with the mark printing itself once as it appears. The region
 * is always there, so a screen reader announces the notice when it comes.
 */
export function UpdateNotice({
  open,
  title,
  detail,
  actions,
  onClose,
  compact = false,
  children,
}: UpdateNoticeProps): JSX.Element {
  return (
    <div
      aria-live="polite"
      className="update-notice-region pointer-events-none fixed inset-x-0 z-[35] flex justify-center px-3 md:justify-end md:px-6"
    >
      {open ? (
        <section
          aria-label={title}
          className={`update-notice pointer-events-auto w-full rounded-plate border border-line bg-surface shadow-raised ${
            compact ? 'max-w-[30rem] py-2 pr-2 pl-2.5' : 'max-w-[26rem] p-3'
          }`}
        >
          <div className={`flex gap-3 ${compact ? 'items-center' : 'items-start'}`}>
            <UpdateMark play className={compact ? 'size-9' : 'size-11'} />
            <div className={`min-w-0 flex-1 ${compact ? '' : 'pt-0.5'}`}>
              <p className="font-display text-label leading-tight font-semibold tracking-[-0.01em]">
                {title}
              </p>
              {detail ? <p className="mt-0.5 text-meta text-text-2">{detail}</p> : null}
            </div>
            {compact ? actions : null}
            <button
              type="button"
              aria-label="Kapat"
              onClick={onClose}
              className={`flex size-11 shrink-0 items-center justify-center rounded-control text-text-2 hover:bg-bg hover:text-text ${compact ? '' : '-mt-1.5 -mr-1.5'}`}
            >
              <X aria-hidden="true" size={18} strokeWidth={1.75} />
            </button>
          </div>
          {children}
          {!compact && actions ? (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">{actions}</div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
