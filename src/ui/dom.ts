/** Minimal DOM helpers (no framework). */

/** Shortest wait of a paced loop (ms): never faster than a 60 Hz frame. */
const MIN_PACED_MS = 16;
/** Wait of a paced loop whose callback threw (ms). */
const PACED_IDLE_MS = 250;

export type Child = Node | string | number | null | undefined | false | Child[];
export type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'string') el.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replaceChildren(el: Element, ...children: Child[]): void {
  clear(el);
  append(el, children);
}

/** Collects cleanup work for a screen/component: listeners, timers, rAF loops, sub-disposers. */
export class Disposables {
  private fns: (() => void)[] = [];
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  add(fn: () => void): void {
    if (this.disposed) fn();
    else this.fns.push(fn);
  }

  listen<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void;
  listen<K extends keyof DocumentEventMap>(target: Document, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): void;
  listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void;
  listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.add(() => target.removeEventListener(type, fn, opts));
  }

  timeout(fn: () => void, ms: number): number {
    const id = window.setTimeout(fn, ms);
    this.add(() => window.clearTimeout(id));
    return id;
  }

  interval(fn: () => void, ms: number): number {
    const id = window.setInterval(fn, ms);
    this.add(() => window.clearInterval(id));
    return id;
  }

  /**
   * Self-paced timer loop until disposed: `fn` runs on the next task and then again after the
   * delay (ms) it returns (at least MIN_PACED_MS). Unlike a requestAnimationFrame loop it does not
   * wake the page on every display refresh (60–120 Hz), so a mostly static screen produces no
   * frames between updates. Returns `poke`, which runs `fn` at once and restarts the wait (call it
   * when the watched state changes, so the screen does not lag a whole delay behind).
   */
  pacedLoop(fn: () => number): () => void {
    let id = 0;
    const run = (): void => {
      id = 0;
      if (this.disposed) return;
      let next = PACED_IDLE_MS;
      try {
        next = fn();
      } finally {
        if (!this.disposed) id = window.setTimeout(run, Math.max(MIN_PACED_MS, next || 0));
      }
    };
    id = window.setTimeout(run, 0);
    this.add(() => {
      if (id) window.clearTimeout(id);
      id = 0;
    });
    return () => {
      if (this.disposed) return;
      if (id) window.clearTimeout(id);
      run();
    };
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.timeout(resolve, ms));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const fns = this.fns.splice(0).reverse();
    for (const fn of fns) {
      try {
        fn();
      } catch (e) {
        console.warn('dispose failed', e);
      }
    }
  }
}

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
