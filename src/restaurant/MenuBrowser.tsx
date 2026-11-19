import { Search } from 'lucide-react';
import { useEffect, useRef, useState, type JSX } from 'react';
import { normalizeForSearch } from '@/data/text';
import type { CategoryRecord, ProductRecord } from '@/data/types';
import { TextField } from '@/design';
import { formatTRY } from '@/domain/money';

/** Dishes without a category, listed after the menu's own sections. */
const OTHER = 'diger';

type Section = { id: string; name: string; products: ProductRecord[] };

/**
 * The menu as the paper menu reads: one section per category in the owner's order, with a
 * sticky row of large category tabs. The tab of the section in view is marked as the menu
 * scrolls; a tap jumps to its section. Searching lists every match instead.
 */
export function MenuBrowser({
  products,
  categories,
  taken,
  onPick,
}: {
  products: readonly ProductRecord[];
  categories: readonly CategoryRecord[];
  /** How many of each dish are on the order and not yet sent, by product id. */
  taken: ReadonlyMap<string, number>;
  onPick(product: ProductRecord): void;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const needle = normalizeForSearch(term);
  const sections = menuSections(products, categories);
  const found =
    needle === ''
      ? null
      : products.filter((product) => normalizeForSearch(product.name).includes(needle));
  const spy = useSectionSpy(sections.map((section) => section.id));

  return (
    <section aria-label="Menü" className="flex min-w-0 flex-col gap-3">
      <div className="relative">
        <TextField
          label="Menüde ara"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="pl-10"
        />
        <Search
          aria-hidden="true"
          size={18}
          strokeWidth={1.75}
          className="pointer-events-none absolute bottom-[15px] left-3.5 text-muted"
        />
      </div>

      {found ? (
        found.length === 0 ? (
          <p className="rounded-plate border border-line bg-surface p-4 text-text-2">
            {`“${term.trim()}” menüde yok.`}
          </p>
        ) : (
          <DishGrid products={found} taken={taken} onPick={onPick} />
        )
      ) : (
        <>
          {sections.length > 1 ? (
            <CategoryTabs sections={sections} active={spy.active} onJump={spy.jumpTo} />
          ) : null}
          {sections.map((section) => (
            <section
              key={section.id}
              id={`menu-${section.id}`}
              ref={spy.register(section.id)}
              aria-labelledby={`menu-${section.id}-title`}
              className="flex scroll-mt-20 flex-col gap-2"
            >
              {sections.length > 1 ? (
                <h2
                  id={`menu-${section.id}-title`}
                  className="pt-2 text-lg font-bold tracking-[-0.01em] text-text-2"
                >
                  {section.name}
                </h2>
              ) : (
                <h2 id={`menu-${section.id}-title`} className="sr-only">
                  {section.name}
                </h2>
              )}
              <DishGrid products={section.products} taken={taken} onPick={onPick} />
            </section>
          ))}
        </>
      )}
    </section>
  );
}

/** The categories with dishes, in the owner's order, then the dishes without one. */
function menuSections(
  products: readonly ProductRecord[],
  categories: readonly CategoryRecord[],
): Section[] {
  const known = new Set(categories.map((category) => category.id));
  const sections: Section[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    products: products.filter((product) => product.categoryId === category.id),
  }));
  sections.push({
    id: OTHER,
    name: categories.length > 0 ? 'Diğer' : 'Menü',
    products: products.filter(
      (product) => product.categoryId === undefined || !known.has(product.categoryId),
    ),
  });
  return sections.filter((section) => section.products.length > 0);
}

function CategoryTabs({
  sections,
  active,
  onJump,
}: {
  sections: readonly Section[];
  active: string | undefined;
  onJump(id: string): void;
}): JSX.Element {
  const row = useRef<HTMLDivElement | null>(null);
  // The marked tab is kept in the middle of the row, so the next ones stay in sight.
  useEffect(() => {
    const strip = row.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (strip && chip && typeof strip.scrollTo === 'function') {
      strip.scrollTo({
        left: chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2,
        behavior: 'smooth',
      });
    }
  }, [active]);
  return (
    <nav
      aria-label="Kategoriler"
      className="sticky top-0 z-10 -mx-4 border-b border-line bg-bg/95 py-2 backdrop-blur md:-mx-6 xl:-mx-8"
    >
      <div
        ref={row}
        className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:px-6 xl:px-8"
      >
        {sections.map((section) => {
          const current = section.id === active;
          return (
            <button
              key={section.id}
              type="button"
              aria-current={current ? 'true' : undefined}
              onClick={() => onJump(section.id)}
              className={`min-h-12 shrink-0 rounded-chip border px-5 font-display text-label font-semibold whitespace-nowrap transition-colors ${
                current
                  ? 'border-text bg-text text-bg'
                  : 'border-line-strong bg-surface text-text-2 hover:text-text'
              }`}
            >
              {section.name}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function DishGrid({
  products,
  taken,
  onPick,
}: {
  products: readonly ProductRecord[];
  taken: ReadonlyMap<string, number>;
  onPick(product: ProductRecord): void;
}): JSX.Element {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
      {products.map((product) => {
        const count = taken.get(product.id) ?? 0;
        return (
          <li key={product.id}>
            <button
              type="button"
              onClick={() => onPick(product)}
              className={`relative flex min-h-20 w-full flex-col justify-between gap-2 rounded-plate border p-3 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] ${
                count > 0
                  ? 'border-accent bg-accent/10'
                  : 'border-line bg-surface hover:border-line-strong'
              }`}
            >
              <span className="pr-7 leading-snug font-semibold break-words">{product.name}</span>
              <span className="font-display text-sm font-semibold text-text-2">
                {formatTRY(product.sellPrice)}
              </span>
              {count > 0 ? (
                <span
                  key={count}
                  aria-label={`siparişte ${count}`}
                  className="absolute top-2 right-2 flex size-7 animate-bump items-center justify-center rounded-chip bg-accent font-display text-sm font-bold text-on-accent"
                >
                  {count}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Which section is in view as the page scrolls: the last whose top has passed under the sticky
 * tabs. A jump marks its section at once and lets the scroll settle before following again.
 */
function useSectionSpy(ids: readonly string[]) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const [active, setActive] = useState<string | undefined>(undefined);
  const settling = useRef<number | undefined>(undefined);
  const key = ids.join(',');

  useEffect(() => {
    let frame = 0;
    function follow() {
      if (settling.current !== undefined) {
        return;
      }
      let current: string | undefined;
      for (const id of key.split(',')) {
        const node = nodes.current.get(id);
        if (node && node.getBoundingClientRect().top <= 96) {
          current = id;
        }
      }
      setActive(current ?? key.split(',')[0]);
    }
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(follow);
    }
    follow();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [key]);

  return {
    active,
    register: (id: string) => (node: HTMLElement | null) => {
      if (node) {
        nodes.current.set(id, node);
      } else {
        nodes.current.delete(id);
      }
    },
    jumpTo(id: string) {
      setActive(id);
      window.clearTimeout(settling.current);
      settling.current = window.setTimeout(() => (settling.current = undefined), 700);
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      nodes.current.get(id)?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth' });
    },
  };
}
