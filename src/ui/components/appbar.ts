import { h, type Child } from '../dom';
import { icon } from '../icons';

export function appBar(title: string, opts: { onBack?: () => void; trailing?: Child } = {}): HTMLElement {
  return h(
    'header',
    { class: 'appbar' },
    opts.onBack
      ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '뒤로', onclick: opts.onBack }, icon('back'))
      : null,
    h('h1', { class: 'appbar__title' }, title),
    h('div', { class: 'appbar__trailing' }, opts.trailing ?? null),
  );
}

/** The settings gear used in every top bar. */
export function settingsButton(onClick: () => void): HTMLElement {
  return h('button', { class: 'icon-btn', type: 'button', 'aria-label': '설정', 'data-action': 'settings', onclick: onClick }, icon('settings'));
}
