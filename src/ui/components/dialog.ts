import { h, type Child } from '../dom';
import { overlayRoot, pushOverlay, registerForceClose } from './overlay';

export interface DialogAction<T> {
  label: string;
  value: T;
  variant?: 'text' | 'tonal' | 'filled' | 'danger';
  /** `data-action` on the button (tests and analytics address buttons by it). */
  action?: string;
}

export interface DialogOptions<T> {
  title: string;
  body?: Child;
  icon?: Child;
  actions: DialogAction<T>[];
  /** Value returned when dismissed via scrim/back. Omit to make the dialog non-dismissible. */
  dismissValue?: T;
  className?: string;
}

/** Material 3 basic dialog. Resolves with the chosen action's value. */
export function showDialog<T>(opts: DialogOptions<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    const close = (v: T) => {
      if (done) return;
      done = true;
      popOverlay();
      unforce();
      scrim.classList.remove('is-in');
      window.setTimeout(() => scrim.remove(), 200);
      resolve(v);
    };
    const dismissible = 'dismissValue' in opts;
    const actions = opts.actions.map((a) =>
      h(
        'button',
        { class: `btn btn--${a.variant ?? 'text'}`, type: 'button', 'data-action': a.action ?? null, onclick: () => close(a.value) },
        a.label,
      ),
    );
    const panel = h(
      'div',
      { class: `dialog ${opts.className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      opts.icon ? h('div', { class: 'dialog__icon' }, opts.icon) : null,
      h('h2', { class: 'dialog__title', id: titleId }, opts.title),
      opts.body ? h('div', { class: 'dialog__body' }, opts.body) : null,
      h('div', { class: 'dialog__actions' }, actions),
    );
    const scrim = h('div', { class: 'scrim' }, panel);
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim && dismissible) close(opts.dismissValue as T);
    });
    const popOverlay = pushOverlay({
      requestClose: () => {
        if (dismissible) close(opts.dismissValue as T);
        return dismissible;
      },
    });
    const unforce = registerForceClose(() => close((opts.dismissValue ?? opts.actions[0].value) as T));
    overlayRoot().appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add('is-in'));
    window.setTimeout(() => (actions[actions.length - 1] as HTMLButtonElement | undefined)?.focus({ preventScroll: true }), 50);
  });
}

export function confirmDialog(opts: {
  title: string;
  body?: Child;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return showDialog<boolean>({
    title: opts.title,
    body: opts.body,
    dismissValue: false,
    actions: [
      { label: opts.cancelLabel ?? '취소', value: false, variant: 'text' },
      { label: opts.confirmLabel, value: true, variant: opts.danger ? 'danger' : 'filled' },
    ],
  });
}
