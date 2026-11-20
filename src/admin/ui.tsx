import { Check, Copy } from 'lucide-react';
import { useId, useState, type ComponentProps, type JSX, type ReactNode } from 'react';
import { Button, Dialog } from '@/design';
import { failed } from './load';

export function Alert({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p role="alert" className="text-sm font-medium text-danger">
      {children}
    </p>
  );
}

export function Loading(): JSX.Element {
  return (
    <p role="status" className="text-text-2">
      Yükleniyor…
    </p>
  );
}

/** A plate on the page with a heading, as the forms are drawn. */
export function Panel({
  title,
  id,
  action,
  children,
}: {
  title: string;
  id: string;
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-plate border border-line bg-surface p-4"
    >
      <div className="flex min-h-touch items-center gap-3">
        <h3 id={id} className="font-display text-label font-semibold">
          {title}
        </h3>
        {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A labelled multi-line field, drawn like TextField. */
export function TextArea({
  label,
  hint,
  id,
  className,
  ...rest
}: ComponentProps<'textarea'> & { label: string; hint?: string }): JSX.Element {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-semibold text-text">
        {label}
      </label>
      <textarea
        id={fieldId}
        aria-describedby={hintId}
        className={[
          'min-h-24 rounded-control border border-line-strong bg-surface px-3.5 py-2.5 text-base text-text placeholder:text-muted',
          'transition-[border-color,box-shadow] duration-150 hover:border-text-2 focus:border-accent focus:focus-ring focus-visible:outline-none',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Copies a text, and says so for two seconds. Without a clipboard the text stays to copy by hand. */
export function CopyButton({
  text,
  label = 'Kopyala',
  variant = 'secondary',
  className,
}: {
  text: string;
  label?: string;
  variant?: 'secondary' | 'ghost';
  className?: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an old browser, an insecure page).
    }
  }
  return (
    <Button
      variant={variant}
      {...(className ? { className } : {})}
      onClick={() => void copy()}
      icon={
        copied ? (
          <Check aria-hidden="true" size={18} strokeWidth={1.75} />
        ) : (
          <Copy aria-hidden="true" size={18} strokeWidth={1.75} />
        )
      }
    >
      {copied ? 'Kopyalandı' : label}
    </Button>
  );
}

/**
 * Asks before a change that is hard to take back: the dialog names what will happen; the
 * confirming button does it, "Vazgeç" or closing leaves everything as it was.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = true,
  disabled = false,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  /** Resolves with an error message to show, or nothing once done. */
  onConfirm(): Promise<string | void>;
  onClose(): void;
  children?: ReactNode;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm() {
    setBusy(true);
    setError(undefined);
    try {
      const problem = await onConfirm();
      if (problem) {
        setError(problem);
      } else {
        onClose();
      }
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(undefined);
          onClose();
        }
      }}
      title={title}
      {...(description ? { description } : {})}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={busy || disabled}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
        </div>
      }
    >
      {children}
      {error ? <Alert>{error}</Alert> : null}
    </Dialog>
  );
}
