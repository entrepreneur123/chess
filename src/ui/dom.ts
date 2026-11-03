/** Minimal DOM helpers (no framework). */

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

  /** rAF loop until disposed. */
  frameLoop(fn: (t: number) => void): void {
    let id = 0;
    const tick = (t: number) => {
      if (this.disposed) return;
      fn(t);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    this.add(() => cancelAnimationFrame(id));
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
