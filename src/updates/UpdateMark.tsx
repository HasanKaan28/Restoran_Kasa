import type { CSSProperties, JSX } from 'react';
import './updates.css';

// The mark's own paths (branding/mark.svg): the adisyon slip whose top edge becomes a fork.
const SLIP =
  'M0 0H45C54-2 57-12 57-26C57-36 32-40 32-62C32-72 35.5-78 35.5-86V-155A7.5 7.5 0 0 1 50.5-155V-89A5.5 5.5 0 0 0 61.5-89V-155A7.5 7.5 0 0 1 76.5-155V-89A5.5 5.5 0 0 0 87.5-89V-155A7.5 7.5 0 0 1 102.5-155V-89A5.5 5.5 0 0 0 113.5-89V-155A7.5 7.5 0 0 1 128.5-155V-86C128.5-78 132-72 132-62C132-40 107-36 107-26C107-12 110-2 119 0H148V203L129.5 185 111 203 92.5 185 74 203 55.5 185 37 203 18.5 185 0 203Z';
// The three order lines, top to bottom, and how far the slip must be out for each to print.
// The slip leaves the slot torn edge first, so the bottom line prints first.
const LINES = [
  { d: 'M31 73H118', printsAt: 0.4 },
  { d: 'M31 103H118', printsAt: 0.32 },
  { d: 'M31 133H92', printsAt: 0.24 },
] as const;

export type UpdateMarkProps = {
  /** How far the download is, 0–100: the slip feeds out of the printer slot as it rises. */
  progress?: number;
  /** Downloaded: the fork's tines settle into the logo and a tick confirms it. */
  done?: boolean;
  /** A short one-off print (about a second) for a notice, then still. */
  play?: boolean;
  /** The finished logo with no motion at all, for reduced motion. */
  still?: boolean;
  className?: string;
};

/**
 * The Restoran Kasa mark printing itself: a slot across the top of the terracotta tile feeds the
 * adisyon slip out line by line, and at the end the slip tilts into the logo's pose. Only
 * transform and opacity move (updates.css), so it stays smooth on a slow register.
 */
export function UpdateMark({
  progress = 0,
  done = false,
  play = false,
  still = false,
  className = 'size-11',
}: UpdateMarkProps): JSX.Element {
  const feed = done || still ? 1 : Math.min(Math.max(progress, 0), 100) / 100;
  return (
    <span
      aria-hidden="true"
      data-state={still ? 'still' : play ? 'play' : 'feed'}
      data-done={done ? '' : undefined}
      className={`update-mark ${className}`}
      style={{ '--feed': feed } as CSSProperties}
    >
      <span className="update-mark__tile" />
      <svg className="update-mark__shadow" viewBox="0 0 512 512">
        <g transform="translate(256 256) scale(1.08)">
          <path fill="#7F2F1B" transform="translate(5 6) rotate(16) translate(-66 -28)" d={SLIP} />
        </g>
      </svg>
      <span className="update-mark__window">
        <span className="update-mark__paper">
          <svg viewBox="0 0 512 512">
            <g transform="translate(256 256) scale(1.08) translate(-66 -28)">
              <path fill="#F6ECDC" d={SLIP} />
              {LINES.map((line, index) => (
                <path
                  key={line.d}
                  className="update-mark__line"
                  data-line={index}
                  data-printed={feed >= line.printsAt ? '' : undefined}
                  pathLength={1}
                  fill="none"
                  stroke="#2A2420"
                  strokeWidth={13}
                  strokeLinecap="round"
                  d={line.d}
                />
              ))}
              <circle cx="120" cy="32" r="9" fill="#6E7A3A" />
            </g>
          </svg>
        </span>
      </span>
      <span className="update-mark__slot" />
      <span className="update-mark__led" />
      <span className="update-mark__tick">
        <svg viewBox="0 0 24 24">
          <path
            pathLength={1}
            d="M6.5 12.5l3.5 3.5 7.5-8"
            fill="none"
            strokeWidth={2.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  );
}
