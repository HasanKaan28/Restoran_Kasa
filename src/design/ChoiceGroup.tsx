import type { CSSProperties, JSX } from 'react';

export type ChoiceOption<T extends string | number> = { value: T; label: string };

export type ChoiceGroupProps<T extends string | number> = {
  legend: string;
  name: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Lets a long list of options wrap onto more rows, as chips as wide as their labels. */
  wrap?: boolean;
  /** `chips`: one row of pills that scrolls sideways, for a filter such as areas or categories. */
  variant?: 'segmented' | 'chips';
  /** Keeps the legend for screen readers only, where the options name themselves. */
  hideLegend?: boolean;
};

const CHIP =
  'relative flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-chip border border-line-strong bg-surface px-4 font-medium whitespace-nowrap text-text-2 transition-colors hover:text-text has-checked:border-text has-checked:bg-text has-checked:text-bg';
const SEGMENT =
  'relative flex min-h-11 cursor-pointer items-center justify-center rounded-[8px] px-3 text-center font-medium text-text-2 transition-colors hover:text-text has-checked:bg-text has-checked:font-semibold has-checked:text-bg';
const FOCUS =
  'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent';

/**
 * Radio buttons drawn as a segmented track (two to four options) or as chips; the chosen one is
 * inked. The arrow keys move between them.
 */
export function ChoiceGroup<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
  wrap = false,
  variant = 'segmented',
  hideLegend = false,
}: ChoiceGroupProps<T>): JSX.Element {
  const chips = wrap || variant === 'chips';
  const columns: CSSProperties | undefined = chips
    ? undefined
    : { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` };
  const track = chips
    ? wrap
      ? 'flex flex-wrap gap-2'
      : '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0'
    : 'grid gap-1 rounded-control border border-line bg-bg p-1';
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className={hideLegend ? 'sr-only' : 'mb-1.5 text-sm font-semibold'}>{legend}</legend>
      <div className={track} style={columns}>
        {options.map((option) => (
          <label key={String(option.value)} className={`${chips ? CHIP : SEGMENT} ${FOCUS}`}>
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
