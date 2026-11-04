import { h, prefersReducedMotion, type Child } from '../dom';
import { icon } from '../icons';
import { isTopOverlay, overlayRoot, pushOverlay, registerForceClose, type OverlayHandle } from './overlay';

export interface SheetHandle {
  close(): void;
  readonly closed: Promise<void>;
  /** The sheet panel (role=dialog). */
  readonly el: HTMLElement;
}

export interface SheetOptions {
  /** Accessible name of the dialog. */
  label?: string;
  /** Extra class on the sheet panel (e.g. a tall detail sheet). */
  className?: string;
  /** Show a round close (X) button in the top-right corner. */
  closeButton?: boolean;
  /** Drag the handle / header area down to dismiss (touch and mouse). */
  draggable?: boolean;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Modal bottom sheet with a drag handle. Closes on scrim tap, Escape, hardware / browser back
 * (through the overlay stack the router consults) and, with `draggable`, a downward drag.
 * Focus moves into the sheet on open, stays trapped inside it on Tab, and returns to the element
 * that had it when the sheet closes. Motion follows the duration tokens, which are 0 under
 * `prefers-reduced-motion`.
 */
export function showBottomSheet(content: Child, opts: SheetOptions = {}): SheetHandle {
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));
  let done = false;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = () => {
    if (done) return;
    done = true;
    pop();
    unforce();
    document.removeEventListener('keydown', onKey, true);
    sheet.style.transform = '';
    scrim.classList.remove('is-in');
    window.setTimeout(() => scrim.remove(), prefersReducedMotion() ? 0 : 260);
    // Give focus back to what opened the sheet (if it is still on screen).
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    resolveClosed();
  };
  const closeBtn = opts.closeButton
    ? h('button', { class: 'icon-btn sheet__close', type: 'button', 'aria-label': '닫기', 'data-action': 'close-sheet', onclick: () => close() }, icon('close', 22))
    : null;
  // The header (handle + close) stays put while the content scrolls, and is the drag zone.
  const head = h('div', { class: `sheet__head${closeBtn ? ' has-close' : ''}` }, h('div', { class: 'sheet__handle', 'aria-hidden': 'true' }), closeBtn);
  const body = h('div', { class: 'sheet__content' }, content);
  const sheet = h(
    'div',
    { class: `sheet${opts.className ? ` ${opts.className}` : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label ?? '상세 정보', tabindex: '-1' },
    head,
    body,
  );
  const scrim = h('div', { class: 'scrim scrim--sheet' }, sheet);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
  const overlay: OverlayHandle = { requestClose: () => (close(), true), kind: 'sheet' };
  const pop = pushOverlay(overlay);
  const unforce = registerForceClose(close);

  const onKey = (e: KeyboardEvent) => {
    if (!isTopOverlay(overlay)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // Keep keyboard focus inside the modal sheet.
      const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === sheet)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);

  if (opts.draggable) installDragToClose(sheet, head, close);

  overlayRoot().appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('is-in'));
  // Focus the sheet itself (screen readers announce its label; Tab then enters the content).
  requestAnimationFrame(() => {
    if (!done) sheet.focus({ preventScroll: true });
  });
  return { close, closed, el: sheet };
}

/**
 * Drag-to-dismiss: a pointer that goes down on the sheet header (handle row) and moves downward
 * drags the sheet; letting go past 28% of its height or with a quick flick closes it, otherwise
 * it springs back. The scrolling content keeps native scrolling.
 */
function installDragToClose(sheet: HTMLElement, head: HTMLElement, close: () => void): void {
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let id: number | null = null;
  let dragging = false;
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    id = e.pointerId;
    // Capture right away: a fast drag leaves the slim header before the first move arrives.
    try {
      head.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    velocity = 0;
    dragging = false;
  });
  head.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dy = e.clientY - startY;
    if (!dragging) {
      if (dy < 6) return;
      dragging = true;
      sheet.classList.add('is-dragging');
    }
    const dt = Math.max(1, e.timeStamp - lastT);
    velocity = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
    sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
    e.preventDefault();
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('is-dragging');
    const dy = e.clientY - startY;
    if (dy > sheet.offsetHeight * 0.28 || velocity > 0.6) close();
    else sheet.style.transform = '';
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
}
