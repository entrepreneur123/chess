/**
 * Tab navigation through the Router with a tiny fake DOM/history (tests run in the node
 * environment): tabs swap in place, the bar follows the tab screens only, history keeps a
 * single guard entry so back from any tab returns to the lobby, and `beforeLeave` can veto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/backdrops', () => ({ installBackdrops: () => {} }));
vi.mock('../src/ui/components/press', () => ({ installPressFx: () => {} }));
vi.mock('../src/ui/components/toast', () => ({ clearToasts: () => {} }));
vi.mock('../src/ui/components/overlay', () => ({ closeAllOverlays: () => {}, closeTopOverlay: () => false }));

import { TABS, isTabScreen } from '../src/ui/nav';
import { Router, type Screen, type ScreenName, type TabChrome } from '../src/ui/router';

class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  classes = new Set<string>();
  dataset: Record<string, string> = {};
  scrollTop = 0;
  classList = {
    add: (...c: string[]) => c.forEach((x) => this.classes.add(x)),
    remove: (...c: string[]) => c.forEach((x) => this.classes.delete(x)),
    contains: (c: string) => this.classes.has(c),
  };
  get firstChild(): FakeEl | null {
    return this.children[0] ?? null;
  }
  appendChild(c: FakeEl): FakeEl {
    c.parent?.removeChild(c);
    c.parent = this;
    this.children.push(c);
    return c;
  }
  removeChild(c: FakeEl): FakeEl {
    this.children = this.children.filter((x) => x !== c);
    c.parent = null;
    return c;
  }
}

function installFakeBrowser() {
  const listeners = new Map<string, Set<() => void>>();
  const entries: unknown[] = [null];
  let index = 0;
  const fire = (type: string) => listeners.get(type)?.forEach((l) => l());
  const history = {
    get length() {
      return index + 1;
    },
    replaceState: (s: unknown) => void (entries[index] = s),
    pushState: (s: unknown) => {
      entries.splice(index + 1);
      entries.push(s);
      index++;
    },
    back: () => {
      if (index === 0) return;
      index--;
      queueMicrotask(() => fire('popstate'));
    },
  };
  const win = {
    addEventListener: (t: string, l: () => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(l);
    },
    removeEventListener: (t: string, l: () => void) => listeners.get(t)?.delete(l),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('history', history);
  return { history };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(opts: { formationLeave?: () => boolean | Promise<boolean> } = {}) {
  const { history } = installFakeBrowser();
  const outlet = new FakeEl();
  const router = new Router(outlet as unknown as HTMLElement);
  const disposed: ScreenName[] = [];
  const make = (name: ScreenName, extra: Partial<Screen> = {}) => () => ({ el: new FakeEl() as unknown as HTMLElement, dispose: () => disposed.push(name), ...extra });
  router
    .register('lobby', make('lobby'))
    .register('collection', make('collection'))
    .register('shop', make('shop'))
    .register('arenas', make('arenas'))
    .register('formation', make('formation', opts.formationLeave ? { beforeLeave: opts.formationLeave } : {}))
    .register('matchmaking', make('matchmaking'));
  const bar = new FakeEl();
  let active: ScreenName | null = null;
  const chrome: TabChrome = { el: bar as unknown as HTMLElement, tabs: TABS.map((t) => t.name), setActive: (n) => void (active = n) };
  router.useTabBar(chrome);
  const shown = () => outlet.children.map((c) => (c === bar ? 'tabbar' : c.dataset.screen));
  return { router, history, outlet, bar, shown, disposed, active: () => active };
}

describe('tab model', () => {
  it('has Battle (the lobby) in the centre, raised: 상점 · 캐릭터 · 대전 · 진형 · 전장', () => {
    expect(TABS.map((t) => t.label)).toEqual(['상점', '캐릭터', '대전', '진형', '전장']);
    expect(TABS[2]).toMatchObject({ name: 'lobby', main: true });
    expect(TABS.filter((t) => t.main)).toHaveLength(1);
    expect(isTabScreen('formation')).toBe(true);
    expect(isTabScreen('shop')).toBe(true);
    expect(isTabScreen('arenas')).toBe(true);
    expect(isTabScreen('game')).toBe(false);
  });
});

describe('Router tab navigation', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it('shows the tab bar under tab screens and highlights the active tab', async () => {
    const t = setup();
    t.router.home();
    expect(t.shown()).toEqual(['lobby', 'tabbar']);
    expect(t.active()).toBe('lobby');
    expect(t.history.length).toBe(1);
    await t.router.switchTab('collection');
    expect(t.shown()).toEqual(['collection', 'tabbar']);
    expect(t.active()).toBe('collection');
    expect(t.outlet.children[0].classes.has('has-tabbar')).toBe(true);
    expect(t.outlet.children[0].classes.has('screen--tab')).toBe(true);
    expect(t.disposed).toEqual(['lobby']);
  });

  it('keeps one history guard across tabs, so back from any tab returns to the lobby', async () => {
    const t = setup();
    t.router.home();
    await t.router.switchTab('collection');
    expect(t.history.length).toBe(2);
    await t.router.switchTab('formation');
    expect(t.history.length).toBe(2);
    t.history.back();
    await flush();
    expect(t.router.currentName).toBe('lobby');
    expect(t.shown()).toEqual(['lobby', 'tabbar']);
    expect(t.history.length).toBe(1);
  });

  it('switching to the Battle tab consumes the guard (back then leaves the app)', async () => {
    const t = setup();
    t.router.home();
    await t.router.switchTab('formation');
    await t.router.switchTab('lobby');
    await flush();
    expect(t.router.currentName).toBe('lobby');
    expect(t.history.length).toBe(1);
  });

  it('beforeLeave can veto a tab switch (unsaved formation)', async () => {
    let allow = false;
    const t = setup({ formationLeave: () => Promise.resolve(allow) });
    t.router.home();
    await t.router.switchTab('formation');
    await t.router.switchTab('collection');
    expect(t.router.currentName).toBe('formation');
    allow = true;
    await t.router.switchTab('collection');
    expect(t.router.currentName).toBe('collection');
  });

  it('pushed screens (matchmaking) have no tab bar', async () => {
    const t = setup();
    t.router.home();
    t.router.navigate('matchmaking', { mode: 'ranked' });
    expect(t.shown()).toEqual(['matchmaking']);
    expect(t.outlet.children[0].classes.has('has-tabbar')).toBe(false);
  });

  it('re-selecting the current tab does nothing', async () => {
    const t = setup();
    t.router.home();
    await t.router.switchTab('lobby');
    expect(t.disposed).toEqual([]);
  });
});
