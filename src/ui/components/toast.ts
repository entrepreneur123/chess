import { h } from '../dom';
import { overlayRoot } from './overlay';

let host: HTMLElement | null = null;

function getHost(): HTMLElement {
  if (!host || !host.isConnected) {
    host = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    overlayRoot().appendChild(host);
  }
  return host;
}

export type ToastTone = 'neutral' | 'warn' | 'success';

/** Material "snackbar" style toast. Stacks at most 2; newest wins. */
export function toast(message: string, opts: { duration?: number; tone?: ToastTone } = {}): void {
  const el = h('div', { class: `toast toast--${opts.tone ?? 'neutral'}` }, message);
  const hostEl = getHost();
  while (hostEl.children.length >= 2) hostEl.firstElementChild?.remove();
  hostEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  window.setTimeout(() => {
    el.classList.remove('is-in');
    el.classList.add('is-out');
    window.setTimeout(() => el.remove(), 250);
  }, opts.duration ?? 2200);
}

export function clearToasts(): void {
  if (host) host.innerHTML = '';
}
