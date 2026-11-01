import { h } from '../dom';

/** CSS-drawn treasure chest (shop cards, box opening, tutorial). Styling lives in shop.css. */
export function chestArt(kind: 'free' | 'basic', cls = ''): HTMLElement {
  return h(
    'div',
    { class: `chest chest--${kind} ${cls}`.trim(), 'aria-hidden': 'true' },
    h('span', { class: 'chest__glow' }),
    h('span', { class: 'chest__body' }),
    h('span', { class: 'chest__lid' }),
    h('span', { class: 'chest__band' }),
    h('span', { class: 'chest__lock' }),
  );
}
