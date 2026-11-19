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
  return { kept, navigate };
}

describe('the service worker and the QR menu', () => {
  it('keeps the guest menu page apart from the app it keeps for offline use', async () => {
    let online = true;
    const worker = startWorker((url) =>
      online
        ? Promise.resolve(
            new Response(new URL(url).pathname.endsWith('menu.html') ? 'menu' : 'app'),
          )
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
