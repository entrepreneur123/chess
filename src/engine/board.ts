import { BOARD_SIZE, ZONE_DEPTH } from './types';
import type { PlayerId, Pos } from './types';
import { CH_MARKI, CH_SAD, MARKI_RANGE, SAD_RANGE, WALK_HALF } from './characters';

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

const SAD_DIRS = [1, 0, -1, 0, 0, 1, 0, -1];

/** True when a forward-only mover standing on row `r` with direction `dir` has no row ahead: it turns around. */
export function atTurnRow(r: number, dir: number): boolean {
  const next = r + dir;
  return next < 0 || next >= BOARD_SIZE;
}

/**
 * Core move generator shared by the public engine API and the AI.
 *
 * @param occ     length-144 array: -1 = empty, otherwise an index into `owners`
 * @param owners  owner of each piece index
 * @param includeAllies if true, squares occupied by allies are also emitted (attack/defence maps)
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
  /** Forward direction of this piece (+1 toward r=11). Defaults to the owner's base direction. */
  dir: number = owner === 0 ? 1 : -1,
): number {
  const r = (sq / BOARD_SIZE) | 0;
  const c = sq - r * BOARD_SIZE;
  if (ch === CH_SAD) {
    const L = SAD_RANGE[level];
    for (let d = 0; d < 8; d += 2) {
      const dr = SAD_DIRS[d];
      const dc = SAD_DIRS[d + 1];
      let nr = r;
      let nc = c;
      for (let k = 0; k < L; k++) {
        nr += dr;
        nc += dc;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
        const s = nr * BOARD_SIZE + nc;
        const o = occ[s];
        if (o < 0) {
          out[n++] = s;
          continue;
        }
        if (includeAllies || owners[o] !== owner) out[n++] = s;
        break;
      }
    }
    return n;
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
    const s = base + nc;
    const o = occ[s];
    if (o < 0 || includeAllies || owners[o] !== owner) out[n++] = s;
  }
  return n;
}
