/**
 * Midos's "그림자 도약" (teleport) on the board, drawn as a light DOM layer over either board view
 * (WebGL or the 2D fallback) through `IBoardView.cellRect`, like Volkonov's melody, so neither
 * renderer needs a new effect:
 *  - the origin: a violet shadow implodes into a dark core (the ghost dissolves);
 *  - a faint shadow streak runs from the origin to the landing square;
 *  - the landing: a void-black burst with a violet rim, then three claw slashes rake across the
 *    square and a ring spreads.
 * The token jumps at BLINK_SWAP_MS (the caller syncs the board then) and stays drawn faded on the
 * landing square (`setDragging`, a "ghost" look) until the landing burst at BLINK_LAND_MS, which
 * waits for the skill cut-in (CUTIN_MS) to clear the middle of the board. Everything animates by
 * transform / opacity only (compositor); nothing stays running after the cast.
 */
import type { Pos } from '../../engine';
import type { IBoardView } from '../../render/types';
import { h, prefersReducedMotion } from '../dom';

/** When the token jumps to the landing square (ms), under the origin implosion. */
export const BLINK_SWAP_MS = 330;
/** When he lands for real (ms): the void burst and the claws, as the skill cut-in fades out. */
export const BLINK_LAND_MS = 950;
/** Whole effect (ms): the turn goes on afterwards. */
export const BLINK_FX_MS = BLINK_LAND_MS + 620;

/**
 * Play the teleport from `from` to `to`. `swap` is called once, at BLINK_SWAP_MS (at once with
 * reduced motion or when the board cannot place squares), to move the token on the board.
 * Resolves when the effect is over. Never throws.
 */
export function playBlinkFx(board: IBoardView | null, from: Pos, to: Pos, swap: () => void, pieceId?: string): Promise<void> {
  const a = board?.cellRect?.(from) ?? null;
  const b = board?.cellRect?.(to) ?? null;
  const safeSwap = () => {
    try {
      swap();
    } catch (e) {
      console.warn('blink swap failed', e);
    }
  };
  if (!a || !b || prefersReducedMotion()) {
    safeSwap();
    return Promise.resolve();
  }
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  const unit = a.width;
  const layer = h('div', { class: 'blink-fx', 'aria-hidden': 'true' });
  layer.style.setProperty('--u', `${unit}px`);
  layer.style.setProperty('--l', `${BLINK_LAND_MS}ms`);
  // Origin: the ghost folds into a dark core, with wisps pulled inward.
  layer.appendChild(h('span', { class: 'blink-fx__implode', style: `--x:${ax}px;--y:${ay}px` }));
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.4;
    const dx = Math.cos(ang) * unit * 0.95;
    const dy = Math.sin(ang) * unit * 0.95;
    layer.appendChild(h('span', { class: 'blink-fx__wisp', style: `--x:${ax}px;--y:${ay}px;--dx:${dx}px;--dy:${dy}px;--d:${i * 22}ms` }));
  }
  // The streak between the two squares (a rotated bar scaled along its length).
  const len = Math.hypot(bx - ax, by - ay);
  const rot = Math.atan2(by - ay, bx - ax);
  if (len > unit * 0.5) {
    layer.appendChild(h('span', { class: 'blink-fx__streak', style: `--x:${ax}px;--y:${ay}px;--len:${len}px;--rot:${rot}rad` }));
  }
  // Landing: a void burst, three claw slashes, a ring.
  layer.appendChild(h('span', { class: 'blink-fx__burst', style: `--x:${bx}px;--y:${by}px` }));
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * unit * 0.26;
    layer.appendChild(h('span', { class: 'blink-fx__claw', style: `--x:${bx + off * 0.6}px;--y:${by + off}px;--d:${BLINK_LAND_MS + 130 + i * 45}ms` }));
  }
  layer.appendChild(h('span', { class: 'blink-fx__ring', style: `--x:${bx}px;--y:${by}px` }));
  document.body.appendChild(layer);
  const unghost = () => {
    try {
      if (pieceId) board?.setDragging?.(null);
    } catch {
      /* the board may be gone */
    }
  };
  return new Promise((resolve) => {
    window.setTimeout(() => {
      safeSwap();
      // Drawn faded where he will land until the burst (a ghost still materialising).
      try {
        if (pieceId) board?.setDragging?.(pieceId);
      } catch {
        /* optional board API */
      }
    }, BLINK_SWAP_MS);
    window.setTimeout(unghost, BLINK_LAND_MS + 120);
    window.setTimeout(() => {
      unghost();
      layer.remove();
      resolve();
    }, BLINK_FX_MS);
  });
}
