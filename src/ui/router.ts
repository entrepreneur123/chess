/**
 * Tiny screen router. Mounts one screen at a time, disposes the previous one, and wires the
 * hardware/browser back button (Capacitor WebView fires popstate) through a single history
 * "guard" entry that is present whenever a non-root screen is shown.
 */
import { closeAllOverlays, closeTopOverlay } from './components/overlay';
import { clear } from './dom';

export interface Screen {
  el: HTMLElement;
  /** Called after the element is attached to the document. */
  mount?(): void;
  /** Free listeners, timers, workers, WebGL. Must be idempotent. */
  dispose?(): void;
  /** Hardware back. Default: go to the root (lobby). */
  onBack?(): void;
}

export interface ScreenParams {
  lobby: undefined;
  formation: undefined;
  collection: undefined;
  shop: undefined;
  matchmaking: { difficulty: import('../ai/bot').Difficulty };
  game: import('./screens/gameParams').GameParams;
}
export type ScreenName = keyof ScreenParams;

export type ScreenFactory<N extends ScreenName> = (router: Router, params: ScreenParams[N]) => Screen;

const ROOT: ScreenName = 'lobby';

export class Router {
  private current: { name: ScreenName; screen: Screen } | null = null;
  private guard = false;
  private suppressPops = 0;
  private factories: { [N in ScreenName]?: ScreenFactory<N> } = {};

  constructor(private readonly outlet: HTMLElement) {
    history.replaceState({ t12: 'root' }, '');
    window.addEventListener('popstate', this.onPopState);
  }

  register<N extends ScreenName>(name: N, factory: ScreenFactory<N>): this {
    (this.factories as Record<string, unknown>)[name] = factory;
    return this;
  }

  get currentName(): ScreenName | null {
    return this.current?.name ?? null;
  }

  navigate<N extends ScreenName>(name: N, ...params: ScreenParams[N] extends undefined ? [] : [ScreenParams[N]]): void {
    const factory = this.factories[name] as ScreenFactory<N> | undefined;
    if (!factory) throw new Error(`Unknown screen ${name}`);
    closeAllOverlays();
    if (this.current) {
      try {
        this.current.screen.dispose?.();
      } catch (e) {
        console.error(e);
      }
    }
    clear(this.outlet);
    const screen = factory(this, params[0] as ScreenParams[N]);
    this.current = { name, screen };
    screen.el.classList.add('screen');
    screen.el.dataset.screen = name;
    this.outlet.appendChild(screen.el);
    this.outlet.scrollTop = 0;
    screen.mount?.();
    this.syncGuard();
  }

  /** Go back to the lobby (root). */
  home(): void {
    this.navigate(ROOT);
  }

  private syncGuard(): void {
    const wantGuard = this.current?.name !== ROOT;
    if (wantGuard && !this.guard) {
      history.pushState({ t12: 'guard' }, '');
      this.guard = true;
    } else if (!wantGuard && this.guard) {
      // Consume the guard entry so the next back from the lobby leaves the app.
      this.guard = false;
      this.suppressPops++;
      history.back();
    }
  }

  private onPopState = (): void => {
    if (this.suppressPops > 0) {
      this.suppressPops--;
      return;
    }
    this.guard = false;
    if (closeTopOverlay()) {
      this.syncGuard();
      return;
    }
    const cur = this.current;
    if (!cur || cur.name === ROOT) return; // let the platform handle it (exit app)
    if (cur.screen.onBack) cur.screen.onBack();
    else this.home();
    // Screen may have stayed (e.g. resign dialog cancelled): restore the guard.
    if (this.current?.name !== ROOT) this.syncGuard();
  };

  dispose(): void {
    window.removeEventListener('popstate', this.onPopState);
    this.current?.screen.dispose?.();
    this.current = null;
  }
}
