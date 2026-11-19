import { useSyncExternalStore } from 'react';

/**
 * Whether a media query matches now, following changes. Where the browser cannot tell (tests,
 * old webviews) it answers `fallback`.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? fallback,
    () => fallback,
  );
}
