/**
 * Board effects for the 2026-11-06 trio, drawn as a light DOM layer over either board view (WebGL
 * or the 2D fallback) through `IBoardView.cellRect`, like the melody and the teleport:
 *  - `playShotFx`: Venoa's poison arrow flying from her square to the target (the board then plays
 *    the hit itself, with her standing still);
 *  - `playKnockFx`: Hammont's hammer blow landing on a square: a molten shockwave, sparks flung
 *    in the push direction and (for a 3성 hit) a "기절" star burst;
 *  - `playFreezeFx`: Glacia's "빙결": a frost beam from her to the target, then an ice crystal
 *    bursting over it.
 * Everything animates by transform / opacity only (compositor) and removes itself; with reduced
 * motion, or when the board cannot place squares, each resolves at once.
 */
import type { Pos } from '../../engine';
import type { IBoardView } from '../../render/types';
import { h, prefersReducedMotion } from '../dom';

/** Arrow flight time (ms) before the hit. */
export const SHOT_FLIGHT_MS = 230;
/** The knock-back burst (ms); the pushed piece slides away under it. */
export const KNOCK_FX_MS = 520;
/** The freeze: the beam reaches the target at FREEZE_HIT_MS; the whole effect lasts FREEZE_FX_MS. */
export const FREEZE_HIT_MS = 300;
export const FREEZE_FX_MS = 900;

interface Centre {
  x: number;
  y: number;
  u: number;
}

function centre(board: IBoardView | null, p: Pos): Centre | null {
  const r = board?.cellRect?.(p) ?? null;
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, u: r.width } : null;
}

function layer(cls: string, unit: number): HTMLElement {
  const el = h('div', { class: `trio-fx ${cls}`, 'aria-hidden': 'true' });
  el.style.setProperty('--u', `${unit}px`);
  document.body.appendChild(el);
  return el;
}

function after(el: HTMLElement, ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      el.remove();
      resolve();
    }, ms);
  });
}

/** Venoa's arrow from `from` to `to`; resolves when it arrives (the trail fades on its own). */
export function playShotFx(board: IBoardView | null, from: Pos, to: Pos): Promise<void> {
  const a = centre(board, from);
  const b = centre(board, to);
  if (!a || !b || prefersReducedMotion()) return Promise.resolve();
  const el = layer('trio-fx--shot', a.u);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const rot = Math.atan2(b.y - a.y, b.x - a.x);
  el.appendChild(h('span', { class: 'shot-fx__trail', style: `--x:${a.x}px;--y:${a.y}px;--len:${len}px;--rot:${rot}rad` }));
  el.appendChild(h('span', { class: 'shot-fx__arrow', style: `--x:${a.x}px;--y:${a.y}px;--dx:${b.x - a.x}px;--dy:${b.y - a.y}px;--rot:${rot}rad` }));
  el.appendChild(h('span', { class: 'shot-fx__splash', style: `--x:${b.x}px;--y:${b.y}px` }));
  void after(el, SHOT_FLIGHT_MS + 520);
  return new Promise((resolve) => window.setTimeout(resolve, SHOT_FLIGHT_MS));
}

/** Hammont's blow on `at`, knocking toward `dir` (unit row / column steps); `stun` adds stars. */
export function playKnockFx(board: IBoardView | null, at: Pos, dir: { dr: number; dc: number }, stun: boolean): Promise<void> {
  const c = centre(board, at);
  if (!c || prefersReducedMotion()) return Promise.resolve();
  const el = layer('trio-fx--knock', c.u);
  el.appendChild(h('span', { class: 'knock-fx__ring', style: `--x:${c.x}px;--y:${c.y}px` }));
  // Screen y grows downward while board rows grow upward (player 0 at the bottom).
  const sx = dir.dc;
  const sy = -dir.dr;
  for (let i = 0; i < 7; i++) {
    const spread = (i - 3) * 0.32;
    const dx = (sx - sy * spread) * c.u * (0.9 + (i % 2) * 0.35);
    const dy = (sy + sx * spread) * c.u * (0.9 + (i % 2) * 0.35);
    el.appendChild(h('span', { class: 'knock-fx__spark', style: `--x:${c.x}px;--y:${c.y}px;--dx:${dx}px;--dy:${dy}px;--d:${i * 15}ms` }));
  }
  if (stun) el.appendChild(h('span', { class: 'knock-fx__stun', style: `--x:${c.x + sx * c.u}px;--y:${c.y + sy * c.u - c.u * 0.55}px` }, '★ ✦ ★'));
  return after(el, KNOCK_FX_MS);
}

/** Glacia's freeze from `from` onto `to`; resolves when the effect is over. */
export function playFreezeFx(board: IBoardView | null, from: Pos, to: Pos): Promise<void> {
  const a = centre(board, from);
  const b = centre(board, to);
  if (!a || !b || prefersReducedMotion()) return Promise.resolve();
  const el = layer('trio-fx--freeze', a.u);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const rot = Math.atan2(b.y - a.y, b.x - a.x);
  el.appendChild(h('span', { class: 'freeze-fx__beam', style: `--x:${a.x}px;--y:${a.y}px;--len:${len}px;--rot:${rot}rad` }));
  el.appendChild(h('span', { class: 'freeze-fx__crystal', style: `--x:${b.x}px;--y:${b.y}px` }));
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    el.appendChild(
      h('span', { class: 'freeze-fx__shard', style: `--x:${b.x}px;--y:${b.y}px;--dx:${Math.cos(ang) * b.u * 0.8}px;--dy:${Math.sin(ang) * b.u * 0.8}px;--a:${ang}rad` }),
    );
  }
  return after(el, FREEZE_FX_MS);
}
