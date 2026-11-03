import { BOARD_SIZE, ZONE_DEPTH } from './types';
import type { PlayerId, Pos } from './types';
import { CH_BRUTILE, CH_INSANER, CH_MARKI, CH_SAD, INSANER_DIAG_LEVEL, INSANER_RANGE, MARKI_RANGE, N_CHARS, SAD_RANGE, WALK_HALF } from './characters';

export const N_SQUARES = BOARD_SIZE * BOARD_SIZE;

export function forwardDir(owner: PlayerId): 1 | -1 {
  return owner === 0 ? 1 : -1;
}

export function formationToAbsolute(owner: PlayerId, slot: { row: number; col: number }): Pos {
  if (owner === 0) return { r: slot.row, c: slot.col };
  return { r: BOARD_SIZE - 1 - slot.row, c: BOARD_SIZE - 1 - slot.col };
}

export function isOnBoard(pos: Pos): boolean {
  return (
    Number.isInteger(pos.r) &&
    Number.isInteger(pos.c) &&
    pos.r >= 0 &&
    pos.r < BOARD_SIZE &&
    pos.c >= 0 &&
    pos.c < BOARD_SIZE
  );
}

/** Is the ABSOLUTE position inside `owner`'s 3 x 12 home zone? */
export function isInZone(owner: PlayerId, pos: Pos): boolean {
  if (!isOnBoard(pos)) return false;
  return owner === 0 ? pos.r < ZONE_DEPTH : pos.r >= BOARD_SIZE - ZONE_DEPTH;
}

export function sqOf(pos: Pos): number {
  return pos.r * BOARD_SIZE + pos.c;
}

export function posOf(sq: number): Pos {
  const r = (sq / BOARD_SIZE) | 0;
  return { r, c: sq - r * BOARD_SIZE };
}

/** True when column `c` is swallowed by a storm of `storm` columns per side. */
export function inStorm(c: number, storm: number): boolean {
  return c < storm || c >= BOARD_SIZE - storm;
}

const ORTHO_DIRS = [1, 0, -1, 0, 0, 1, 0, -1];
const DIAG_DIRS = [1, 1, 1, -1, -1, 1, -1, -1];
const KING_DIRS = [...ORTHO_DIRS, ...DIAG_DIRS];
/** Brutile 1-star: the two forward diagonals; 2-star adds one step straight back (by direction). */
const BRUTILE_DIRS: Record<number, [number[], number[], number[]]> = {
  1: [[], [1, -1, 1, 1], [1, -1, 1, 1, -1, 0]],
  [-1]: [[], [-1, -1, -1, 1], [-1, -1, -1, 1, 1, 0]],
};

/** True when a forward-only mover standing on row `r` with direction `dir` has no row ahead: it turns around. */
export function atTurnRow(r: number, dir: number): boolean {
  const next = r + dir;
  return next < 0 || next >= BOARD_SIZE;
}

/**
 * Slide up to `L` squares along each (dr, dc) pair in `dirs`; blocked by pieces, edges and storm.
 * A wasteland square ends the slide ON it (the mover would be destroyed there).
 */
function slide(
  occ: ArrayLike<number>,
  owners: ArrayLike<number>,
  owner: number,
  r: number,
  c: number,
  dirs: number[],
  L: number,
  out: { [i: number]: number },
  n: number,
  includeAllies: boolean,
  storm: number,
  waste: ArrayLike<number> | null,
): number {
  for (let d = 0; d < dirs.length; d += 2) {
    const dr = dirs[d];
    const dc = dirs[d + 1];
    let nr = r;
    let nc = c;
    for (let k = 0; k < L; k++) {
      nr += dr;
      nc += dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || inStorm(nc, storm)) break;
      const s = nr * BOARD_SIZE + nc;
      const o = occ[s];
      if (o < 0) {
        out[n++] = s;
        if (waste !== null && waste[s]) break;
        continue;
      }
      if (includeAllies || owners[o] !== owner) out[n++] = s;
      break;
    }
  }
  return n;
}

/** One movement pattern (a character at a level) from square (r, c). */
function genPattern(
  occ: ArrayLike<number>,
  owners: ArrayLike<number>,
  owner: number,
  ch: number,
  level: number,
  r: number,
  c: number,
  out: { [i: number]: number },
  n: number,
  includeAllies: boolean,
  dir: number,
  storm: number,
  waste: ArrayLike<number> | null,
): number {
  if (ch === CH_SAD) return slide(occ, owners, owner, r, c, ORTHO_DIRS, SAD_RANGE[level], out, n, includeAllies, storm, waste);
  if (ch === CH_INSANER) {
    n = slide(occ, owners, owner, r, c, ORTHO_DIRS, INSANER_RANGE[level], out, n, includeAllies, storm, waste);
    if (level >= INSANER_DIAG_LEVEL) n = slide(occ, owners, owner, r, c, DIAG_DIRS, INSANER_RANGE[level], out, n, includeAllies, storm, waste);
    return n;
  }
  if (ch === CH_BRUTILE) {
    const dirs = level >= 3 ? KING_DIRS : BRUTILE_DIRS[dir][level];
    return slide(occ, owners, owner, r, c, dirs, 1, out, n, includeAllies, storm, waste);
  }
  const dr = dir;
  if (ch === CH_MARKI) {
    const L = MARKI_RANGE[level];
    let nr = r;
    for (let k = 0; k < L; k++) {
      nr += dr;
      if (nr < 0 || nr >= BOARD_SIZE) break;
      const s = nr * BOARD_SIZE + c;
      const o = occ[s];
      if (o < 0) {
        out[n++] = s;
        if (waste !== null && waste[s]) break;
        continue;
      }
      if (includeAllies || owners[o] !== owner) out[n++] = s;
      break;
    }
    return n;
  }
  // walk: jump into the row directly in front
  const nr = r + dr;
  if (nr < 0 || nr >= BOARD_SIZE) return n;
  const w = WALK_HALF[level];
  const c0 = c - w < 0 ? 0 : c - w;
  const c1 = c + w >= BOARD_SIZE ? BOARD_SIZE - 1 : c + w;
  const base = nr * BOARD_SIZE;
  for (let nc = c0; nc <= c1; nc++) {
    if (inStorm(nc, storm)) continue;
    const s = base + nc;
    const o = occ[s];
    if (o < 0 || includeAllies || owners[o] !== owner) out[n++] = s;
  }
  return n;
}

// Dedupe scratch for pieces with absorbed patterns (a square may be reachable by two patterns).
const seenStamp = new Int32Array(N_SQUARES);
let stamp = 0;

/**
 * Core move generator shared by the public engine API and the AI.
 *
 * @param occ     length-144 array: -1 = empty, otherwise an index into `owners`
 * @param owners  owner of each piece index
 * @param includeAllies if true, squares occupied by allies are also emitted (attack/defence maps)
 * @param dir     forward direction of this piece (+1 toward r=11); defaults to the owner's base direction
 * @param storm   columns swallowed by the storm per side (blocked squares)
 * @param absorb  bitmask of absorbed (character, level) patterns, see `abilityBit`
 * @param waste   optional length-144 wasteland flags: slides end ON a wasteland square
 * @returns new write offset into `out`
 */
export function genTargets(
  occ: ArrayLike<number>,
  owners: ArrayLike<number>,
  owner: number,
  ch: number,
  level: number,
  sq: number,
  out: { [i: number]: number },
  n: number,
  includeAllies = false,
  dir: number = owner === 0 ? 1 : -1,
  storm = 0,
  absorb = 0,
  waste: ArrayLike<number> | null = null,
): number {
  const r = (sq / BOARD_SIZE) | 0;
  const c = sq - r * BOARD_SIZE;
  // The piece can never be in the storm itself (it would have been removed), but when the
  // caller passes a storm the origin must still be a legal square: nothing to do here.
  const start = n;
  n = genPattern(occ, owners, owner, ch, level, r, c, out, n, includeAllies, dir, storm, waste);
  if (absorb === 0) return n;
  stamp++;
  for (let k = start; k < n; k++) seenStamp[out[k]] = stamp;
  for (let bit = 0; bit < N_CHARS * 3; bit++) {
    if (!(absorb & (1 << bit))) continue;
    const ach = (bit / 3) | 0;
    const alvl = (bit % 3) + 1;
    if (ach === ch && alvl === level) continue;
    const from = n;
    n = genPattern(occ, owners, owner, ach, alvl, r, c, out, n, includeAllies, dir, storm, waste);
    // Compact: drop squares already emitted.
    let w = from;
    for (let k = from; k < n; k++) {
      const s = out[k];
      if (seenStamp[s] === stamp) continue;
      seenStamp[s] = stamp;
      out[w++] = s;
    }
    n = w;
  }
  return n;
}
