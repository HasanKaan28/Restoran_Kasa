import type { ServerConfig } from '@/server/config';
import { fetchPublicMenu } from './fetchMenu';
import {
  findDishes,
  formatMenuPrice,
  isPublicMenu,
  menuSections,
  readAddress,
  tableLabel,
  type MenuSection,
  type PublicDish,
  type PublicMenu,
} from './model';

/*
 * The page a guest opens from the QR code on the table. Plain DOM rather than React: the guest
 * downloads a few kilobytes, and every text is set as text, never as markup, so nothing a
 * register wrote into a dish name can run here.
 */

type KeptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type MenuPageOptions = {
  root: HTMLElement;
  /** The build's server; null when it was built without one. */
  config: ServerConfig | null;
  location: { search: string; hash: string };
  fetcher?: typeof fetch;
  /** Where the last menu loaded is kept for a dropped connection; null keeps nothing. */
  storage?: KeptStorage | null;
};

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      node.setAttribute(name, value);
    }
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child);
    }
  }
  return node;
}

/** A line icon drawn from path data, hidden from assistive technology. */
function icon(paths: readonly string[], className: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: className,
  })) {
    svg.setAttribute(name, value);
  }
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const ICONS = {
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'M20 20l-4-4'],
  card: [
    'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    'M9 8h6',
    'M9 12h6',
    'M9 16h3',
  ],
  alert: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 8v5', 'M12 16.5h.01'],
  code: [
    'M4 4h6v6H4z',
    'M14 4h6v6h-6z',
    'M4 14h6v6H4z',
    'M14 14h2',
    'M20 14v2',
    'M14 18v2h2',
    'M18 18h2v2',
  ],
} as const;

/** Scroll listeners and timers of what is on screen, undone before the next view. */
const teardowns = new WeakMap<HTMLElement, () => void>();

function reset(root: HTMLElement): void {
  teardowns.get(root)?.();
  teardowns.delete(root);
  root.replaceChildren();
}

const SHELL = 'mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 sm:px-6';

function footer(): HTMLElement {
  return h(
    'footer',
    {
      class:
        'mt-auto flex flex-col gap-1 pt-12 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-center text-meta text-muted',
    },
    h('p', {}, 'Alerjen ve içerik bilgisi için garsonumuza sorabilirsiniz.'),
    h(
      'p',
      {},
      h(
        'a',
        {
          href: 'https://restorankasa.vercel.app/',
          rel: 'noopener',
          class: 'underline decoration-line-strong underline-offset-2 hover:text-text',
        },
        'Restoran Kasa',
      ),
      ' ile hazırlandı',
    ),
  );
}

type StateView = {
  icon: readonly string[];
  title: string;
  body: string;
  action?: { label: string; run(): void };
};

const MISSING: StateView = {
  icon: ICONS.code,
  title: 'Bağlantı eksik',
  body: 'Masadaki QR kodu telefonunuzun kamerasıyla yeniden okutun.',
};

const CLOSED: StateView = {
  icon: ICONS.card,
  title: 'Menü şu an görüntülenemiyor',
  body: 'Bu bağlantı kapatılmış ya da yenilenmiş olabilir. Menüyü garsonumuzdan isteyebilirsiniz.',
};

const FAILED: StateView = {
  icon: ICONS.alert,
  title: 'Menü yüklenemedi',
  body: 'İnternet bağlantınızı kontrol edip yeniden deneyin.',
};

/** A card in the middle of the page: what happened, and the one thing the guest can do. */
function stateCard(view: StateView, heading: 'h1' | 'p'): HTMLElement {
  const card = h(
    'div',
    {
      class:
        'flex flex-col items-center gap-3 rounded-plate border border-dashed border-line-strong bg-surface px-5 py-10 text-center',
    },
    h(
      'span',
      {
        class: 'flex size-14 items-center justify-center rounded-chip bg-accent/12 text-accent',
      },
      icon(view.icon, 'size-7'),
    ),
    h(
      heading,
      { class: 'font-display text-xl font-bold tracking-[-0.01em] text-balance' },
      view.title,
    ),
    h('p', { class: 'max-w-[38ch] text-text-2' }, view.body),
  );
  if (view.action) {
    const action = view.action;
    const button = h(
      'button',
      {
        type: 'button',
        class:
          'mt-1 inline-flex min-h-touch items-center rounded-control border border-transparent bg-accent px-5 font-semibold text-on-accent transition-[background-color,transform] duration-150 hover:bg-accent-hover active:scale-[0.97]',
      },
      action.label,
    );
    button.addEventListener('click', () => action.run());
    card.append(button);
  }
  return card;
}

function renderState(root: HTMLElement, view: StateView): void {
  reset(root);
  document.title = 'Menü';
  root.append(
    h('div', { class: SHELL }, h('div', { class: 'pt-16' }, stateCard(view, 'h1')), footer()),
  );
}

function renderLoading(root: HTMLElement): void {
  reset(root);
  const bar = (width: string, height = 'h-4') =>
    h('div', { class: `${height} ${width} animate-pulse rounded-chip bg-line` });
  root.append(
    h(
      'div',
      { class: SHELL, 'aria-busy': 'true' },
      h('p', { class: 'sr-only' }, 'Menü yükleniyor'),
      h(
        'div',
        { class: 'flex flex-col gap-3 pt-10 pb-6', 'aria-hidden': 'true' },
        bar('w-16', 'h-3'),
        bar('w-2/3', 'h-8'),
        h('div', { class: 'mt-3 h-12 w-full rounded-control bg-line/60' }),
        h('div', { class: 'mt-2 flex gap-2' }, bar('w-24', 'h-11'), bar('w-20', 'h-11')),
        h(
          'div',
          { class: 'mt-4 flex flex-col gap-4 rounded-plate border border-line bg-surface p-4' },
          ...Array.from({ length: 5 }, (_, index) =>
            h(
              'div',
              { class: 'flex items-center gap-3' },
              bar(index % 2 === 0 ? 'w-1/2' : 'w-2/5'),
              h('div', { class: 'flex-1' }),
              bar('w-14'),
            ),
          ),
        ),
      ),
    ),
  );
}

function dishRow(dish: PublicDish, category?: string): HTMLElement {
  return h(
    'li',
    { class: 'px-4 py-3.5' },
    category ? h('p', { class: 'text-meta font-semibold text-muted' }, category) : null,
    h(
      'div',
      { class: 'flex items-baseline gap-2' },
      h('h3', { class: 'min-w-0 font-semibold leading-snug break-words' }, dish.name),
      h('span', {
        class: 'min-w-4 flex-1 border-b border-dotted border-line-strong',
        'aria-hidden': 'true',
      }),
      h(
        'p',
        { class: 'shrink-0 font-display text-label font-semibold whitespace-nowrap' },
        formatMenuPrice(dish.price),
      ),
    ),
    dish.description
      ? h('p', { class: 'mt-1 text-body text-text-2 text-pretty' }, dish.description)
      : null,
    dish.portions?.length
      ? h(
          'ul',
          { class: 'mt-2 flex flex-wrap gap-1.5', 'aria-label': 'Porsiyonlar' },
          ...dish.portions.map((portion) =>
            h(
              'li',
              {
                class: 'rounded-chip border border-line bg-bg px-2.5 py-0.5 text-meta text-text-2',
              },
              `${portion.label} `,
              h(
                'span',
                { class: 'font-display font-semibold text-text' },
                formatMenuPrice(portion.price),
              ),
            ),
          ),
        )
      : null,
    ...(dish.options ?? [])
      .filter((group) => group.choices.length > 0)
      .map((group) =>
        h(
          'p',
          { class: 'mt-1.5 text-meta text-muted' },
          `${group.name}: ${group.choices.join(', ')}`,
        ),
      ),
  );
}

function dishList(dishes: readonly PublicDish[], categoryOf?: (dish: PublicDish) => string) {
  return h(
    'ul',
    { class: 'divide-y divide-line rounded-plate border border-line bg-surface' },
    ...dishes.map((dish) => dishRow(dish, categoryOf?.(dish))),
  );
}

/** How far below the top a section counts as the one in view: under the sticky tabs. */
const SPY_OFFSET = 96;

/** The sticky tabs and the sections under them; the tab of the section in view is marked. */
function browse(sections: readonly MenuSection[]): { node: HTMLElement; teardown(): void } {
  const node = h('div', { class: 'flex flex-col' });
  const strip = h('div', {
    class: 'flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:px-6',
  });
  const tabs = new Map<string, HTMLButtonElement>();
  const nodes = new Map<string, HTMLElement>();
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let active: string | undefined;
  let settling: number | undefined;
  let frame = 0;

  function mark(id: string) {
    if (id === active) {
      return;
    }
    active = id;
    for (const [tabId, tab] of tabs) {
      const current = tabId === id;
      if (current) {
        tab.setAttribute('aria-current', 'true');
      } else {
        tab.removeAttribute('aria-current');
      }
      tab.className = tabClass(current);
    }
    const chip = tabs.get(id);
    if (chip && typeof strip.scrollTo === 'function') {
      strip.scrollTo({
        left: chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2,
        behavior: reduced() ? 'auto' : 'smooth',
      });
    }
  }

  function follow() {
    if (settling !== undefined) {
      return;
    }
    let current = sections[0]?.id;
    for (const section of sections) {
      const top = nodes.get(section.id)?.getBoundingClientRect().top ?? Infinity;
      if (top <= SPY_OFFSET) {
        current = section.id;
      }
    }
    if (current) {
      mark(current);
    }
  }

  function onScroll() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(follow);
  }

  if (sections.length > 1) {
    for (const section of sections) {
      const tab = h('button', { type: 'button', class: tabClass(false) }, section.name);
      tab.addEventListener('click', () => {
        mark(section.id);
        window.clearTimeout(settling);
        settling = window.setTimeout(() => (settling = undefined), 700);
        // Never a link: the address holds the slug, and a #section would replace it.
        nodes.get(section.id)?.scrollIntoView?.({
          behavior: reduced() ? 'auto' : 'smooth',
          block: 'start',
        });
      });
      tabs.set(section.id, tab);
      strip.append(tab);
    }
    node.append(
      h(
        'nav',
        {
          'aria-label': 'Kategoriler',
          class:
            'sticky top-0 z-10 -mx-4 border-b border-line bg-bg/95 py-2 backdrop-blur sm:-mx-6',
        },
        strip,
      ),
    );
  }

  sections.forEach((section, index) => {
    const titleId = `bolum-${index}`;
    const block = h(
      'section',
      { 'aria-labelledby': titleId, class: 'flex scroll-mt-20 flex-col gap-2.5 pt-6' },
      h(
        'h2',
        {
          id: titleId,
          class: `font-display text-title font-bold tracking-[-0.015em] ${sections.length > 1 ? '' : 'sr-only'}`,
        },
        section.name,
      ),
      dishList(section.dishes),
    );
    nodes.set(section.id, block);
    node.append(block);
  });

  if (sections[0]) {
    mark(sections[0].id);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  return {
    node,
    teardown() {
      cancelAnimationFrame(frame);
      window.clearTimeout(settling);
      window.removeEventListener('scroll', onScroll);
    },
  };
}

function tabClass(current: boolean): string {
  return `min-h-11 shrink-0 rounded-chip border px-4 font-display text-body font-semibold whitespace-nowrap transition-colors duration-150 ${
    current
      ? 'border-text bg-text text-bg'
      : 'border-line-strong bg-surface text-text-2 hover:text-text'
  }`;
}

function renderMenu(
  root: HTMLElement,
  menu: PublicMenu,
  { table, stale }: { table?: string; stale?: { onRefresh(): void } },
): void {
  reset(root);
  document.title = `${menu.name} · Menü`;
  const shell = h('div', { class: SHELL });
  root.append(shell);

  shell.append(
    h(
      'header',
      { class: 'flex flex-col gap-2 pt-[calc(env(safe-area-inset-top)+2rem)] pb-5' },
      h('p', { class: 'text-meta font-semibold tracking-[0.14em] text-accent uppercase' }, 'Menü'),
      h(
        'h1',
        {
          class:
            'font-display text-[2.125rem] leading-[1.05] font-bold tracking-[-0.025em] text-balance break-words',
        },
        menu.name,
      ),
      table
        ? h(
            'p',
            {
              class:
                'mt-1 inline-flex items-center gap-2 self-start rounded-chip border border-line-strong bg-surface px-3 py-1 font-display font-semibold',
            },
            h('span', { class: 'size-2 rounded-chip bg-accent', 'aria-hidden': 'true' }),
            tableLabel(table),
          )
        : null,
    ),
  );

  if (stale) {
    const refresh = h(
      'button',
      {
        type: 'button',
        class:
          'min-h-11 shrink-0 rounded-control border border-line-strong bg-surface px-3 font-semibold',
      },
      'Yenile',
    );
    refresh.addEventListener('click', () => stale.onRefresh());
    shell.append(
      h(
        'div',
        { class: 'slip edge-bill mb-4 flex items-center gap-3 bg-warning-bg p-3' },
        h(
          'p',
          { class: 'flex-1 text-body font-medium' },
          'Bağlantı yok. Menünün son yüklenen hâli gösteriliyor.',
        ),
        refresh,
      ),
    );
  }

  const sections = menuSections(menu);
  if (sections.length === 0) {
    shell.append(
      stateCard(
        {
          icon: ICONS.card,
          title: 'Menü hazırlanıyor',
          body: 'Bu restoranın menüsü henüz eklenmedi. Garsonumuz yardımcı olur.',
        },
        'p',
      ),
      footer(),
    );
    return;
  }

  const search = h('input', {
    id: 'menu-search',
    type: 'search',
    placeholder: 'Menüde ara',
    autocomplete: 'off',
    enterkeyhint: 'search',
    class:
      'min-h-touch w-full rounded-control border border-line-strong bg-surface pr-3.5 pl-11 text-base text-text placeholder:text-muted transition-[border-color,box-shadow] duration-150 hover:border-text-2 focus:border-accent focus:focus-ring focus-visible:outline-none',
  });
  const status = h('p', { role: 'status', class: 'mt-3 text-body text-text-2 empty:hidden' });
  const content = h('div', { class: 'flex flex-col' });
  shell.append(
    h(
      'div',
      { class: 'relative' },
      h('label', { for: 'menu-search', class: 'sr-only' }, 'Menüde ara'),
      search,
      icon(
        ICONS.search,
        'pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted',
      ),
    ),
    status,
    content,
    footer(),
  );

  const categoryName = new Map(menu.categories.map((category) => [category.id, category.name]));
  let view: { teardown(): void } | undefined;

  function show() {
    view?.teardown();
    view = undefined;
    const found = findDishes(menu, search.value);
    if (found === null) {
      status.textContent = '';
      const browsing = browse(sections);
      view = browsing;
      content.replaceChildren(browsing.node);
      return;
    }
    status.textContent =
      found.length === 0 ? `“${search.value.trim()}” menüde yok.` : `${found.length} yemek bulundu`;
    content.replaceChildren(
      found.length === 0
        ? h('div', {})
        : h(
            'div',
            { class: 'pt-3' },
            dishList(found, (dish) =>
              dish.categoryId ? (categoryName.get(dish.categoryId) ?? '') : '',
            ),
          ),
    );
  }

  search.addEventListener('input', show);
  show();
  teardowns.set(root, () => view?.teardown());
}

const keptKey = (slug: string) => `rk.menu.${slug}`;

function keep(storage: KeptStorage | null, slug: string, menu: PublicMenu): void {
  try {
    storage?.setItem(keptKey(slug), JSON.stringify({ savedAt: new Date().toISOString(), menu }));
  } catch {
    // A full or blocked storage only loses the offline copy.
  }
}

function recall(storage: KeptStorage | null, slug: string): PublicMenu | null {
  try {
    const raw = storage?.getItem(keptKey(slug));
    const kept: unknown = raw ? (JSON.parse(raw) as { menu?: unknown }).menu : null;
    return isPublicMenu(kept) ? kept : null;
  } catch {
    return null;
  }
}

function forget(storage: KeptStorage | null, slug: string): void {
  try {
    storage?.removeItem(keptKey(slug));
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/**
 * Opens the menu behind the link: the slug from the address, one call to the server, then the
 * menu, or a card saying why there is none. A dropped connection shows the last menu loaded here.
 */
export async function startMenuPage({
  root,
  config,
  location,
  fetcher = fetch,
  storage = null,
}: MenuPageOptions): Promise<void> {
  const { slug, table } = readAddress(location);
  if (!slug) {
    renderState(root, MISSING);
    return;
  }
  if (!config) {
    renderState(root, FAILED);
    return;
  }
  const server = config;

  async function load(): Promise<void> {
    renderLoading(root);
    try {
      const answer = await fetchPublicMenu(server, slug, fetcher);
      if (answer.kind === 'closed') {
        forget(storage, slug);
        renderState(root, CLOSED);
        return;
      }
      keep(storage, slug, answer.menu);
      renderMenu(root, answer.menu, table ? { table } : {});
    } catch {
      const kept = recall(storage, slug);
      const retry = () => void load();
      if (kept) {
        renderMenu(root, kept, { ...(table ? { table } : {}), stale: { onRefresh: retry } });
      } else {
        renderState(root, { ...FAILED, action: { label: 'Yeniden dene', run: retry } });
      }
    }
  }

  await load();
}
