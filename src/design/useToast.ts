import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_DURATION_MS = 4000;
/** A toast that offers an action (usually "Geri al") stays long enough to reach it. */
const ACTION_DURATION_MS = 6000;

export type ToastAction = { label: string; onAction(): void };

/** One short message at a time; a new message replaces the old one and restarts the timer. */
export function useToast(durationMs: number = DEFAULT_DURATION_MS): {
  message: string | null;
  action: ToastAction | undefined;
  show(message: string, action?: ToastAction): void;
  dismiss(): void;
} {
  const [toast, setToast] = useState<{ message: string; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback(
    (message: string, action?: ToastAction) => {
      clearTimeout(timer.current);
      setToast(action ? { message, action } : { message });
      timer.current = setTimeout(
        () => setToast(null),
        action ? Math.max(durationMs, ACTION_DURATION_MS) : durationMs,
      );
    },
    [durationMs],
  );

  useEffect(() => {
    const pending = timer;
    return () => clearTimeout(pending.current);
  }, []);

  return { message: toast?.message ?? null, action: toast?.action, show, dismiss };
}
