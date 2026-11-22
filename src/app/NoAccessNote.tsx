import type { JSX } from 'react';

/** What a screen or a section shows a person not allowed to use it, as when they type its address. */
export function NoAccessNote(): JSX.Element {
  return (
    <p className="rounded-control border border-line bg-surface p-5 text-text-2">
      Bu ekran için yetkiniz yok.
    </p>
  );
}
