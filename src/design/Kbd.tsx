import type { JSX, ReactNode } from 'react';

/** A keyboard key, for the desktop's shortcuts; the restaurant's touch screens do not use it. */
export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd className="rounded-chip bg-current/12 px-2 py-0.5 font-sans text-meta font-semibold">
      {children}
    </kbd>
  );
}
