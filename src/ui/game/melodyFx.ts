/**
 * Volkonov's "선율" on the board, drawn as a light DOM layer over either board view (WebGL or the 2D
 * fallback) through `IBoardView.cellRect`, so neither renderer needs a new effect:
 *  - `createBuffBadges`: a rose "♪ N" badge on the corner of every buffed piece's square (the
 *    buffed turns left), re-placed whenever the board settles and hidden while pieces animate;
 *  - `playMelodyFx`: the cast: rose and gold notes rise from Volkonov and fly to each ally, whose
 *    square answers with a soft rose ring.
 * Every animation moves by transform / opacity only (compositor), and nothing runs between casts.
 */
import type { Piece, Pos } from '../../engine';
import type { IBoardView } from '../../render/types';
import { h, prefersReducedMotion } from '../dom';

/** How long the cast effect plays before the turn goes on (ms). */
export const MELODY_FX_MS = 1150;

export interface BuffBadges {
  el: HTMLElement;
  /** Place a badge on every buffed piece of `pieces` (none while `hidden`). */
  update(board: IBoardView | null, pieces: readonly Piece[], hidden: boolean): void;
  dispose(): void;
}

export function createBuffBadges(): BuffBadges {
  const el = h('div', { class: 'buff-layer', 'aria-hidden': 'true' });
  const badges = new Map<string, { el: HTMLElement; text: HTMLElement; key: string }>();
  document.body.appendChild(el);
  return {
    el,
    update(board, pieces, hidden) {
      const live = new Set<string>();
      if (!hidden && board?.cellRect) {
        for (const p of pieces) {
          if (!p.buff || p.buff <= 0) continue;
          const rect = board.cellRect(p.pos);
          if (!rect) continue;
          live.add(p.id);
          let b = badges.get(p.id);
          if (!b) {
            const text = h('b', null);
            const node = h('span', { class: `buff-badge owner-${p.owner}` }, h('i', { class: 'buff-badge__note' }, '♪'), text);
            el.appendChild(node);
            b = { el: node, text, key: '' };
            badges.set(p.id, b);
          }
          // Top-right corner of the square, scaled with the cell.
          const size = Math.max(14, Math.round(rect.width * 0.36));
          const key = `${Math.round(rect.left)}|${Math.round(rect.top)}|${size}|${p.buff}`;
          if (key !== b.key) {
            b.key = key;
            b.text.textContent = String(p.buff);
            b.el.style.setProperty('--bb', `${size}px`);
            b.el.style.transform = `translate(${Math.round(rect.left + rect.width - size * 0.72)}px, ${Math.round(rect.top - size * 0.28)}px)`;
          }
        }
      }
      for (const [id, b] of badges) {
        if (live.has(id)) continue;
        b.el.remove();
        badges.delete(id);
      }
    },
    dispose() {
      el.remove();
      badges.clear();
    },
  };
}

/**
 * The cast effect: notes from `caster` to every square in `allies`, then a ring on each. Resolves
 * after MELODY_FX_MS (at once with reduced motion or when the board cannot place squares).
 */
export function playMelodyFx(board: IBoardView | null, caster: Pos, allies: readonly Pos[]): Promise<void> {
  const from = board?.cellRect?.(caster) ?? null;
  if (!from || prefersReducedMotion()) return Promise.resolve();
  const layer = h('div', { class: 'melody-fx', 'aria-hidden': 'true' });
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const unit = from.width;
  layer.style.setProperty('--u', `${unit}px`);
  // A rose pulse under Volkonov.
  layer.appendChild(h('span', { class: 'melody-fx__pulse', style: `transform: translate(${cx}px, ${cy}px)` }));
  // Notes rising around him.
  const glyphs = ['♪', '♫', '♪', '♬', '♪', '♫'];
  glyphs.forEach((g, i) => {
    const a = (i / glyphs.length) * Math.PI * 2;
    const dx = Math.cos(a) * unit * 0.9;
    const dy = -unit * (0.8 + (i % 3) * 0.25);
    layer.appendChild(
      h('span', { class: `melody-fx__note${i % 2 ? ' is-gold' : ''}`, style: `--x:${cx}px;--y:${cy}px;--dx:${dx}px;--dy:${dy}px;--d:${i * 50}ms` }, g),
    );
  });
  // A note flying to each ally, and a ring answering on its square.
  allies.forEach((pos, i) => {
    const r = board?.cellRect?.(pos);
    if (!r) return;
    const tx = r.left + r.width / 2;
    const ty = r.top + r.height / 2;
    layer.appendChild(h('span', { class: 'melody-fx__fly', style: `--x:${cx}px;--y:${cy}px;--dx:${tx - cx}px;--dy:${ty - cy}px;--d:${180 + i * 90}ms` }, '♪'));
    layer.appendChild(h('span', { class: 'melody-fx__ring', style: `--x:${tx}px;--y:${ty}px;--d:${560 + i * 90}ms` }));
  });
  document.body.appendChild(layer);
  return new Promise((resolve) => {
    window.setTimeout(() => {
      layer.remove();
      resolve();
    }, MELODY_FX_MS);
  });
}
