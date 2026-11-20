import type { JSX } from 'react';
// Part of the build (small enough to be inlined), so the mark shows offline too: the service
// worker keeps public/logo.svg for the manifest but answers only pages and built files.
import mark from '../../branding/mark.svg';

/** The Restoran Kasa mark (branding/mark.svg, as public/logo.svg); decorative beside a name. */
export function Logo({ className = 'size-9' }: { className?: string }): JSX.Element {
  return <img src={mark} alt="" aria-hidden="true" className={`shrink-0 ${className}`} />;
}
