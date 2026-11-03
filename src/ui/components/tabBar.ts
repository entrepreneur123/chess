/**
 * Persistent bottom tab bar for the top-level screens (캐릭터 · 대전 · 진형). The router owns
 * the single instance: it is appended under every tab screen and hidden on the others, so it
 * never re-animates or flickers between tabs.
 */
import { haptic, sfx } from '../../audio/sfx';
import { h } from '../dom';
import { icon } from '../icons';
import { TABS } from '../nav';
import type { ScreenName, TabChrome } from '../router';

export function createTabBar(onSelect: (name: ScreenName) => void): TabChrome {
  const buttons = new Map<ScreenName, HTMLButtonElement>();
  const el = h(
    'nav',
    { class: 'tabbar', 'aria-label': '메인 메뉴' },
    TABS.map((t) => {
      const b = h(
        'button',
        {
          class: `tab${t.main ? ' tab--main' : ''}`,
          type: 'button',
          'data-nav': t.name,
          'data-sfx': 'none',
          onclick: () => {
            if (b.getAttribute('aria-current') === 'page') return;
            sfx('page');
            haptic('light');
            onSelect(t.name);
          },
        },
        h('span', { class: 'tab__icon' }, icon(t.icon, t.main ? 30 : 26)),
        h('span', { class: 'tab__label' }, t.label),
      );
      buttons.set(t.name, b);
      return b;
    }),
  );
  return {
    el,
    tabs: TABS.map((t) => t.name),
    setActive(name) {
      for (const [n, b] of buttons) {
        if (n === name) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      }
    },
  };
}
