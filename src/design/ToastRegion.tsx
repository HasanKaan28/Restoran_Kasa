import type { JSX } from 'react';
import type { ToastAction } from './useToast';

export type ToastRegionProps = {
  message: string | null;
  action?: ToastAction | undefined;
  onDismiss?(): void;
};

/**
 * Always present, so screen readers announce each new message. It sits above the screen's
 * bottom bar, never over its main buttons, and at the top while a sheet is open (shape.css).
 */
export function ToastRegion({ message, action, onDismiss }: ToastRegionProps): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Bildirim"
      aria-live="polite"
      className="toast-region pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
    >
      {message ? (
        <div
          className={`pointer-events-auto flex max-w-[480px] animate-toast-in items-center gap-1 rounded-plate bg-text py-1.5 pl-4 text-bg shadow-raised ${action ? 'pr-1.5' : 'pr-4'}`}
        >
          <p className="py-1.5 text-body font-medium">{message}</p>
          {action ? (
            <button
              type="button"
              onClick={() => {
                action.onAction();
                onDismiss?.();
              }}
              className="ml-2 min-h-11 shrink-0 rounded-control px-3 font-semibold text-bg underline decoration-2 underline-offset-4 hover:bg-bg/15"
            >
              {action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
