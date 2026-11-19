import type { JSX, ReactNode } from 'react';

/**
 * What an empty screen shows: what will be here, and the one thing to do next. Never a bare
 * "nothing here".
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-plate border border-dashed border-line-strong bg-surface px-5 py-8 text-center">
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-chip bg-accent/12 text-accent"
      >
        {icon}
      </span>
      <div className="flex max-w-[38ch] flex-col gap-1">
        <p className="font-display text-lg font-bold tracking-[-0.01em]">{title}</p>
        {children ? <div className="text-text-2">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
