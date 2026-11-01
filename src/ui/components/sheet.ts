import { h, type Child } from '../dom';
import { overlayRoot, pushOverlay, registerForceClose } from './overlay';

export interface SheetHandle {
  close(): void;
  readonly closed: Promise<void>;
}

/** Modal bottom sheet with drag handle. Closes on scrim tap / back. */
export function showBottomSheet(content: Child, opts: { label?: string } = {}): SheetHandle {
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    pop();
    unforce();
    scrim.classList.remove('is-in');
    window.setTimeout(() => scrim.remove(), 220);
    resolveClosed();
  };
  const sheet = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label ?? '상세 정보' },
    h('div', { class: 'sheet__handle', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet__content' }, content),
  );
  const scrim = h('div', { class: 'scrim scrim--sheet' }, sheet);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
  const pop = pushOverlay({ requestClose: () => (close(), true) });
  const unforce = registerForceClose(close);
  overlayRoot().appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('is-in'));
  return { close, closed };
}
