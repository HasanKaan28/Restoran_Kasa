import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const serviceWorker = readFileSync('public/sw.js', 'utf8');

type FetchEvent = {
  request: { url: string; method: string; mode: string };
  respondWith(response: Promise<Response>): void;
};

/** Runs the worker with a network and a cache stood in for, and returns its fetch handler. */
function startWorker(network: (url: string) => Promise<Response>) {
  const kept = new Map<string, Response>();
  let onFetch: ((event: FetchEvent) => void) | undefined;
  runInNewContext(serviceWorker, {
    URL,
    Response,
    fetch: (request: { url: string } | string) =>
      network(typeof request === 'string' ? request : request.url),
    self: {
      location: {
        href: 'https://restorankasa.vercel.app/app/sw.js?v=1.0.0',
        origin: 'https://restorankasa.vercel.app',
      },
      addEventListener: (type: string, listener: (event: FetchEvent) => void) => {
        if (type === 'fetch') {
          onFetch = listener;
        }
      },
    },
    caches: {
      open: () =>
        Promise.resolve({
          put: (key: string, response: Response) => {
            kept.set(key, response);
            return Promise.resolve();
          },
          match: (key: string) => Promise.resolve(kept.get(key)),
        }),
    },
  });
  async function navigate(path: string): Promise<Response> {
    let answer: Promise<Response> | undefined;
    onFetch?.({
      request: { url: `https://restorankasa.vercel.app${path}`, method: 'GET', mode: 'navigate' },
      respondWith: (response) => (answer = response),
    });
    if (!answer) {
      throw new Error(`The worker left ${path} to the browser`);
    }
    return answer;
  }
  /** A file the page asks for (an icon, the manifest), not a page opened in the tab. */
  async function load(path: string): Promise<Response | undefined> {
    let answer: Promise<Response> | undefined;
    onFetch?.({
      request: { url: `https://restorankasa.vercel.app${path}`, method: 'GET', mode: 'no-cors' },
      respondWith: (response) => (answer = response),
    });
    return answer;
  }
  return { kept, navigate, load };
}

/** A page as the host serves it: HTML. */
const page = (text: string) =>
  new Response(text, { headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('the service worker and the QR menu', () => {
  it('keeps the guest menu page apart from the app it keeps for offline use', async () => {
    let online = true;
    const worker = startWorker((url) =>
      online
        ? Promise.resolve(page(new URL(url).pathname.endsWith('menu.html') ? 'menu' : 'app'))
        : Promise.reject(new TypeError('offline')),
    );

    expect(await (await worker.navigate('/app/')).text()).toBe('app');
    expect(await (await worker.navigate('/app/menu.html?masa=5')).text()).toBe('menu');
    await Promise.resolve();
    expect(await worker.kept.get('./index.html')?.clone().text()).toBe('app');
    expect(await worker.kept.get('./menu.html')?.clone().text()).toBe('menu');

    online = false;
    expect(await (await worker.navigate('/app/menu.html')).text()).toBe('menu');
    expect(await (await worker.navigate('/app/')).text()).toBe('app');
  });
});

describe('the service worker and the yönetim page', () => {
  it('leaves the seller’s page to the browser and keeps the app’s copy', async () => {
    const worker = startWorker((url) =>
      Promise.resolve(page(new URL(url).pathname.includes('yonetim') ? 'yönetim' : 'app')),
    );
    expect(await (await worker.navigate('/app/')).text()).toBe('app');
    for (const path of ['/app/yonetim.html', '/app/yonetim', '/app/yonetim/']) {
      await expect(worker.navigate(path), path).rejects.toThrow('left /app/yonetim');
    }
    await Promise.resolve();
    expect(await worker.kept.get('./index.html')?.clone().text()).toBe('app');
  });
});

describe('the service worker and a page that is not the app', () => {
  it('never keeps a file opened in the tab as the app’s offline copy', async () => {
    let online = true;
    const worker = startWorker((url) => {
      if (!online) {
        return Promise.reject(new TypeError('offline'));
      }
      const path = new URL(url).pathname;
      if (path.endsWith('.json')) {
        return Promise.resolve(
          new Response('{"name":"Restoran Kasa"}', {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (path.endsWith('.js')) {
        return Promise.resolve(
          new Response('console.log(1)', { headers: { 'content-type': 'text/javascript' } }),
        );
      }
      return Promise.resolve(page(path.endsWith('menu.html') ? 'menu' : 'app'));
    });
    expect(await (await worker.navigate('/app/')).text()).toBe('app');
    expect(await (await worker.navigate('/app/menu.html')).text()).toBe('menu');
    // A link to the manifest or a built file, opened as a page, shows it as the host sent it...
    expect(await (await worker.navigate('/app/manifest.json')).text()).toContain('Restoran');
    expect(await (await worker.navigate('/app/assets/index-abc.js')).text()).toBe('console.log(1)');
    await Promise.resolve();

    // ...and offline the app and the menu still open, not that file.
    online = false;
    expect(await (await worker.navigate('/app/')).text()).toBe('app');
    expect(await (await worker.navigate('/app/menu.html')).text()).toBe('menu');
  });
});

describe('the service worker and the app’s icon and manifest', () => {
  const ORIGIN = 'https://restorankasa.vercel.app';
  const SHELL_FILES = [
    '/app/logo.svg',
    '/app/manifest.json',
    '/app/icon-192.png',
    '/app/icon-512.png',
    '/app/icon-maskable-512.png',
    '/app/apple-touch-icon.png',
  ];

  it('keeps the icons and the manifest when it installs', async () => {
    const added: string[] = [];
    let install: Promise<unknown> = Promise.resolve();
    const listeners: Record<string, (event: { waitUntil(work: Promise<unknown>): void }) => void> =
      {};
    runInNewContext(serviceWorker, {
      URL,
      Response,
      fetch: (url: string) =>
        Promise.resolve(
          url.endsWith('precache.json')
            ? new Response('[]')
            : new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
        ),
      self: {
        location: { href: `${ORIGIN}/app/sw.js?v=1.0.1`, origin: ORIGIN },
        addEventListener: (type: string, listener: (typeof listeners)[string]) => {
          listeners[type] = listener;
        },
        skipWaiting: () => Promise.resolve(),
      },
      caches: {
        open: () =>
          Promise.resolve({
            addAll: (paths: string[]) => {
              added.push(...paths.map((path) => new URL(path, `${ORIGIN}/app/sw.js`).pathname));
              return Promise.resolve();
            },
            put: () => Promise.resolve(),
          }),
      },
    });
    listeners.install?.({ waitUntil: (promise) => (install = promise) });
    await install;
    for (const path of SHELL_FILES) {
      expect(added, path).toContain(path);
    }
  });

  it('serves them from the kept copy, so the tab and the home screen show them offline', async () => {
    const worker = startWorker(() => Promise.reject(new TypeError('offline')));
    for (const path of SHELL_FILES) {
      worker.kept.set(`${ORIGIN}${path}`, new Response(`kept ${path}`));
    }
    for (const path of SHELL_FILES) {
      const answer = await worker.load(path);
      expect(answer, `${path} was left to the network`).toBeDefined();
      expect(await answer?.text()).toBe(`kept ${path}`);
    }
  });

  it('asks the network for one not kept yet, and keeps it', async () => {
    const worker = startWorker((url) =>
      Promise.resolve(new Response(`net ${new URL(url).pathname}`)),
    );
    expect(await (await worker.load('/app/icon-192.png'))?.text()).toBe('net /app/icon-192.png');
    await Promise.resolve();
    expect(worker.kept.has(`${ORIGIN}/app/icon-192.png`)).toBe(true);
  });

  it('leaves other files, and the server’s answers, to the browser', async () => {
    const worker = startWorker(() => Promise.resolve(new Response('net')));
    expect(await worker.load('/app/precache.json')).toBeUndefined();
    expect(await worker.load('/app/logo.svg?x=1')).toBeDefined();
  });
});

describe('the service worker and a new deploy', () => {
  it('keeps each build in a cache of its own and drops the last build’s on activation', async () => {
    const kept = new Set(['mk2-2.0.0', 'rk-1.0.0', 'rk-1.0.0+old', 'rk-1.0.0+new']);
    const listeners: Record<string, (event: { waitUntil(work: Promise<unknown>): void }) => void> =
      {};
    let work: Promise<unknown> = Promise.resolve();
    runInNewContext(serviceWorker, {
      URL,
      self: {
        location: { href: 'https://restorankasa.vercel.app/app/sw.js?v=1.0.0&b=new' },
        addEventListener: (type: string, listener: (typeof listeners)[string]) => {
          listeners[type] = listener;
        },
        clients: { claim: () => Promise.resolve() },
      },
      caches: {
        keys: () => Promise.resolve([...kept]),
        delete: (key: string) => Promise.resolve(kept.delete(key)),
      },
    });
    listeners.activate?.({ waitUntil: (promise) => (work = promise) });
    await work;
    expect([...kept]).toEqual(['mk2-2.0.0', 'rk-1.0.0+new']);
  });
});
