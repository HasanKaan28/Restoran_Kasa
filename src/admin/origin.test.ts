import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { OPERATOR_PAGE, isSharedOrigin, leaveSharedOrigin } from './origin';

describe('the yönetim page on a shared origin', () => {
  it('knows GitHub Pages user sites share one origin, and its own addresses do not', () => {
    expect(isSharedOrigin('hasankaan28.github.io')).toBe(true);
    expect(isSharedOrigin('HasanKaan28.GitHub.io')).toBe(true);
    expect(isSharedOrigin('restorankasa.vercel.app')).toBe(false);
    expect(isSharedOrigin('localhost')).toBe(false);
    expect(isSharedOrigin('github.io.example.com')).toBe(false);
  });

  it('drops a kept seller session and goes to its own address, the hash along', () => {
    const replace = vi.fn();
    const removeItem = vi.fn();
    const left = leaveSharedOrigin(
      { hostname: 'hasankaan28.github.io', hash: '#access_token=x', replace },
      { removeItem },
    );
    expect(left).toBe(true);
    expect(removeItem).toHaveBeenCalledWith('rk.operator');
    expect(replace).toHaveBeenCalledWith(`${OPERATOR_PAGE}#access_token=x`);
    expect(OPERATOR_PAGE).toMatch(/^https:\/\/restorankasa\.vercel\.app\//);
  });

  it('stays on its own address and touches nothing', () => {
    const replace = vi.fn();
    const removeItem = vi.fn();
    expect(
      leaveSharedOrigin({ hostname: 'restorankasa.vercel.app', hash: '', replace }, { removeItem }),
    ).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('leaves before the seller’s client is made, so no session is ever kept there', () => {
    const main = readFileSync('src/admin/main.tsx', 'utf8');
    const leave = main.indexOf('leaveSharedOrigin(');
    expect(leave).toBeGreaterThan(-1);
    expect(leave).toBeLessThan(main.indexOf('operatorClient('));
  });
});
