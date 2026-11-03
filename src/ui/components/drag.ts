/**
 * Drag-and-drop primitives shared by the match board and the formation editor:
 *  - trackPointerDrag: turns one pointerdown into a drag once the pointer travels past a small
 *    threshold (a shorter press stays a tap, handled by the page as before). Pointer capture keeps
 *    the drag alive outside the source element; pointercancel, lost capture, window blur and the
 *    page going to the background cancel it. Moves are coalesced to one callback per frame.
 *  - DragGhost: the lifted token that follows the finger (a fixed element moved by transform only)
 *    and flies back / settles when the drag ends.
 */
import { prefersReducedMotion } from '../dom';

/** Travel (CSS px) after which a press becomes a drag. Below the boards' 14 px tap slop. */
export const DRAG_THRESHOLD_PX = 9;

export interface DragCallbacks {
  /**
   * The pointer moved past the threshold at (x, y). Return false to not drag after all (the
   * gesture is then left alone: no capture, no callbacks).
   */
  start(x: number, y: number): boolean;
  /** Latest pointer position while dragging, at most once per animation frame. */
  move(x: number, y: number): void;
  /** Released while dragging. */
  drop(x: number, y: number): void;
  /** The drag was aborted: pointercancel, lost capture, window blur, page hidden, or cancel(). */
  cancel(): void;
}

export interface DragTracker {
  /** True once the threshold was passed and start() accepted the drag (until it ends). */
  readonly dragging: boolean;
  /** Abort the gesture; calls cancel() when dragging. Idempotent. */
  cancel(): void;
}

/** Swallow the click a browser may synthesize right after a drag ends over a button. */
export function suppressNextClick(ms = 400): void {
  if (typeof window === 'undefined') return;
  let timer = 0;
  const done = () => {
    window.removeEventListener('click', block, true);
    window.clearTimeout(timer);
  };
  const block = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  window.addEventListener('click', block, true);
  timer = window.setTimeout(done, ms);
}

/**
 * Follow the pointer of `down` until it is released. `captureEl` receives the pointer capture once
 * the drag starts; it must stay in the document for the whole drag (re-rendered nodes would lose
 * the capture and cancel the drag).
 */
export function trackPointerDrag(down: PointerEvent, captureEl: Element, cb: DragCallbacks, threshold = DRAG_THRESHOLD_PX): DragTracker {
  const id = down.pointerId;
  const x0 = down.clientX;
  const y0 = down.clientY;
  let state: 'pending' | 'dragging' | 'done' = 'pending';
  let x = x0;
  let y = y0;
  let raf = 0;

  const flush = () => {
    raf = 0;
    if (state === 'dragging') cb.move(x, y);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('blur', abort);
    document.removeEventListener('visibilitychange', onVisibility);
    captureEl.removeEventListener('lostpointercapture', onLost);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    try {
      if (captureEl.hasPointerCapture(id)) captureEl.releasePointerCapture(id);
    } catch {
      /* the element may be gone */
    }
  };
  const end = (how: 'drop' | 'cancel') => {
    const was = state;
    state = 'done';
    cleanup();
    if (was !== 'dragging') return;
    suppressNextClick();
    if (how === 'drop') cb.drop(x, y);
    else cb.cancel();
  };
  function onMove(e: PointerEvent): void {
    if (e.pointerId !== id || state === 'done') return;
    x = e.clientX;
    y = e.clientY;
    if (state === 'pending') {
      if (Math.hypot(x - x0, y - y0) < threshold) return;
      state = 'dragging';
      if (!cb.start(x, y)) {
        state = 'done';
        cleanup();
        return;
      }
      try {
        captureEl.setPointerCapture(id);
      } catch {
        /* capture is a convenience: window listeners still see the pointer */
      }
    }
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function onUp(e: PointerEvent): void {
    if (e.pointerId !== id) return;
    x = e.clientX;
    y = e.clientY;
    end('drop');
  }
  function onCancel(e: PointerEvent): void {
    if (e.pointerId === id) end('cancel');
  }
  function onLost(e: Event): void {
    // The event bubbles: a child (e.g. the board canvas holding the implicit touch capture)
    // handing the pointer over to captureEl must not cancel the drag.
    if (e.target === captureEl && (e as PointerEvent).pointerId === id && state === 'dragging') end('cancel');
  }
  function onVisibility(): void {
    if (document.hidden) end('cancel');
  }
  function abort(): void {
    end('cancel');
  }

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', abort);
  document.addEventListener('visibilitychange', onVisibility);
  captureEl.addEventListener('lostpointercapture', onLost);

  return {
    get dragging() {
      return state === 'dragging';
    },
    cancel: abort,
  };
}

export interface DragGhostOptions {
  /** Diameter of the ghost token (CSS px). */
  size: number;
  /** How far above the pointer the ghost's centre floats (CSS px), so the finger never hides it. */
  lift: number;
  cls?: string;
}

/** The lifted token that follows the pointer. One transform write per follow(). */
export class DragGhost {
  readonly el: HTMLElement;
  private readonly size: number;
  private readonly lift: number;
  private gone = false;
  private overState = false;

  constructor(art: HTMLElement, opts: DragGhostOptions) {
    this.size = opts.size;
    this.lift = opts.lift;
    const inner = document.createElement('span');
    inner.className = 'drag-ghost__inner';
    inner.appendChild(art);
    this.el = document.createElement('div');
    this.el.className = `drag-ghost${opts.cls ? ` ${opts.cls}` : ''}`;
    this.el.setAttribute('aria-hidden', 'true');
    this.el.style.width = `${this.size}px`;
    this.el.style.height = `${this.size}px`;
    this.el.appendChild(inner);
    document.body.appendChild(this.el);
  }

  /** Centre the ghost `lift` px above the pointer at (x, y). */
  follow(x: number, y: number): void {
    if (this.gone) return;
    this.el.style.transform = `translate3d(${x - this.size / 2}px, ${y - this.size / 2 - this.lift}px, 0)`;
  }

  /** Highlight state: the pointer is over a legal drop target (class toggled only on change). */
  setOver(over: boolean): void {
    if (over === this.overState || this.gone) return;
    this.overState = over;
    this.el.classList.toggle('is-over', over);
  }

  /**
   * Fly to centre (x, y) shrinking to `toSize` px, then remove. `fade` also fades it out (a drop:
   * the board's own piece takes over). Instant under prefers-reduced-motion.
   */
  settle(x: number, y: number, toSize: number, opts: { ms?: number; fade?: boolean } = {}): Promise<void> {
    if (this.gone) return Promise.resolve();
    const ms = opts.ms ?? 200;
    if (prefersReducedMotion() || ms <= 0) {
      this.remove();
      return Promise.resolve();
    }
    const k = Math.max(0.1, toSize / this.size);
    this.el.classList.add('is-settling');
    this.el.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.25, 1)${opts.fade ? `, opacity ${ms}ms ease-in` : ''}`;
    this.el.style.transform = `translate3d(${x - this.size / 2}px, ${y - this.size / 2}px, 0) scale(${k})`;
    if (opts.fade) this.el.style.opacity = '0';
    return new Promise((resolve) => {
      window.setTimeout(() => {
        this.remove();
        resolve();
      }, ms + 20);
    });
  }

  remove(): void {
    if (this.gone) return;
    this.gone = true;
    this.el.remove();
  }
}
