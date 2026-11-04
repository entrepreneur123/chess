import { h } from '../dom';
import { overlayRoot, topOverlayKind } from './overlay';

let host: HTMLElement | null = null;
/** Second host above the scrims, used while a bottom sheet is open (it would hide the toast). */
let topHost: HTMLElement | null = null;

interface LiveToast {
  el: HTMLElement;
  message: string;
  hideTimer: number;
  removeTimer: number;
}
const live: LiveToast[] = [];

function getHost(): HTMLElement {
  if (topOverlayKind() === 'sheet') {
    if (!topHost || !topHost.isConnected) {
      topHost = h('div', { class: 'toast-host toast-host--top', role: 'status', 'aria-live': 'polite' });
      overlayRoot().appendChild(topHost);
    }
    return topHost;
  }
  if (!host || !host.isConnected) {
    host = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    // Insert first so every scrim/dialog appended later paints above toasts.
    const root = overlayRoot();
    root.insertBefore(host, root.firstChild);
  }
  return host;
}

export type ToastTone = 'neutral' | 'warn' | 'success';

function drop(t: LiveToast, animate: boolean): void {
  const i = live.indexOf(t);
  if (i >= 0) live.splice(i, 1);
  window.clearTimeout(t.hideTimer);
  window.clearTimeout(t.removeTimer);
  if (!animate) {
    t.el.remove();
    return;
  }
  t.el.classList.remove('is-in');
  t.el.classList.add('is-out');
  t.removeTimer = window.setTimeout(() => t.el.remove(), 250);
}

/**
 * Material "snackbar" style toast. Stacks at most 2; newest wins. An identical message that is
 * already on screen is not duplicated: its timer is simply extended (with a subtle bump).
 */
export function toast(message: string, opts: { duration?: number; tone?: ToastTone } = {}): void {
  const duration = opts.duration ?? 2200;
  const same = live.find((t) => t.message === message);
  if (same) {
    window.clearTimeout(same.hideTimer);
    same.hideTimer = window.setTimeout(() => drop(same, true), duration);
    same.el.classList.remove('is-bump');
    void same.el.offsetWidth; // restart the bump animation
    same.el.classList.add('is-bump');
    return;
  }
  const el = h('div', { class: `toast toast--${opts.tone ?? 'neutral'}` }, message);
  const hostEl = getHost();
  while (live.length >= 2) drop(live[0], false);
  hostEl.appendChild(el);
  const t: LiveToast = { el, message, hideTimer: 0, removeTimer: 0 };
  t.hideTimer = window.setTimeout(() => drop(t, true), duration);
  live.push(t);
  requestAnimationFrame(() => el.classList.add('is-in'));
}

/** Remove every toast immediately (screen change, result dialog...). */
export function clearToasts(): void {
  for (const t of live.slice()) drop(t, false);
  if (host) host.textContent = '';
  if (topHost) topHost.textContent = '';
}
