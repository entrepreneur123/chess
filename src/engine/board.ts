import { BOARD_SIZE, STORM_FULL_STEPS, ZONE_DEPTH, stormCols, stormRows } from './types';
import type { PlayerId, Pos } from './types';
import {
  CH_BRUTILE,
  CH_INSANER,
  CH_LARHEN,
  CH_GLACIA,
  CH_HAMMONT,
  CH_MARKI,
  CH_MICHELLE,
  CH_MIDOS,
  CH_PICKER,
  CH_RAKAELI,
  CH_RAMPID,
  CH_SAD,
  CH_VENOA,
  CH_VERISH,
  CH_VOLKONOV,
  GLACIA_DIAG,
  HAMMONT_RANGE,
  INSANER_RANGE,
  MARKI_RANGE,
  MARKI_SIDE_LEVEL,
  MICHELLE_FORWARD_RANGE,
  MICHELLE_RANGE,
  MIDOS_RANGE,
  N_CHARS,
  PICKER_RANGE,
  RAKAELI_AWAKE_DEPTH,
  RAKAELI_AWAKE_HALF,
  RAKAELI_BACK_LEVEL,
  RAKAELI_DEPTH,
  RAKAELI_HALF,
  RAMPID_RANGE,
  SAD_RANGE,
  VENOA_DIAG_LEVEL,
  VENOA_SHOT_MAX,
  VENOA_SHOT_MIN,
  VERISH_BACK,
  VERISH_FORWARD,
  VERISH_SIDE,
  VOLKONOV_RANGE,
  WALK_HALF,
  absorbedLevel,
} from './characters';

export const N_SQUARES = BOARD_SIZE * BOARD_SIZE;
// The fast generator packs a square into 8 bits (moves, undo tokens, storm-kill records).
if (N_SQUARES > 256) throw new Error('board too large: squares no longer fit in 8 bits');

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

/** Is the ABSOLUTE position inside `owner`'s ZONE_DEPTH x BOARD_SIZE home zone? */
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

/**
 * True when square (r, c) is swallowed by a storm at step `storm`: the outer `stormCols(storm)`
 * columns on each side and, from step STORM_ROWS_FROM, the outer `stormRows(storm)` rows at the top
 * and bottom (the end-game narrows to the middle 2 x 2, then the last step takes everything). The
 * open area is always a rectangle, so a straight path between two open squares stays open.
 */
export function inStorm(r: number, c: number, storm: number): boolean {
  if (storm <= 0) return false;
  const cols = stormCols(storm);
  if (c < cols || c >= BOARD_SIZE - cols) return true;
  const rows = stormRows(storm);
  return r < rows || r >= BOARD_SIZE - rows;
}

/** The storm step that first swallows square (r, c) (the middle 2 x 2 only goes at the last step). */
export function stormClosesAt(r: number, c: number): number {
  for (let s = 1; s < STORM_FULL_STEPS; s++) if (inStorm(r, c, s)) return s;
  return STORM_FULL_STEPS;
}

const ORTHO_DIRS = [1, 0, -1, 0, 0, 1, 0, -1];
const DIAG_DIRS = [1, 1, 1, -1, -1, 1, -1, -1];
const KING_DIRS = [...ORTHO_DIRS, ...DIAG_DIRS];
/** Each orthogonal direction on its own, in ORTHO_DIRS order (no per-call allocation). */
const ORTHO_ONE = [ORTHO_DIRS.slice(0, 2), ORTHO_DIRS.slice(2, 4), ORTHO_DIRS.slice(4, 6), ORTHO_DIRS.slice(6, 8)];
/** Marki 3-star's sideways step: left and right. */
const SIDE_DIRS = [0, 1, 0, -1];
/** Brutile 1-star: the two forward diagonals; 2-star adds one step straight back (by direction). */
const BRUTILE_DIRS: Record<number, [number[], number[], number[]]> = {
  1: [[], [1, -1, 1, 1], [1, -1, 1, 1, -1, 0]],
  [-1]: [[], [-1, -1, -1, 1], [-1, -1, -1, 1, 1, 0]],
};

/** Michelle: left, right and straight back (by direction); her forward slide (2-star on) is separate. */
const MICHELLE_DIRS: Record<number, number[]> = {
  1: [0, 1, 0, -1, -1, 0],
  [-1]: [0, 1, 0, -1, 1, 0],
};
const MICHELLE_FWD: Record<number, number[]> = { 1: [1, 0], [-1]: [-1, 0] };
/** Rampid's claw: straight forward and the two forward diagonals (by direction). */
const RAMPID_DIRS: Record<number, number[]> = {
  1: [1, -1, 1, 0, 1, 1],
  [-1]: [-1, -1, -1, 0, -1, 1],
};

/** Midos: straight forward, left and right (by direction); never back, never diagonal. */
const MIDOS_DIRS: Record<number, number[]> = {
  1: [1, 0, 0, -1, 0, 1],
  [-1]: [-1, 0, 0, -1, 0, 1],
};

/** Venoa's shot lanes: straight forward, then (from VENOA_DIAG_LEVEL) the two forward diagonals. */
const VENOA_LANES: Record<number, number[]> = {
  1: [1, 0, 1, -1, 1, 1],
  [-1]: [-1, 0, -1, -1, -1, 1],
};

/** Trap flag bit of `owner`'s doll traps in a per-square trap mask (bit 0 = player 0, bit 1 = player 1). */
export function trapBit(owner: number): number {
  return owner === 0 ? 1 : 2;
}

/**
 * True when a forward-only mover standing on row `r` with direction `dir` has no row ahead: it turns
 * around. Only the real board edge counts: storm rows are NOT an edge, so a piece facing them can
 * never reach a turn row and stays facing the storm.
 */
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
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || inStorm(nr, nc, storm)) break;
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

/**
 * Picker's hop-through along the four diagonals, up to `L` squares. He lands on every square on the
 * way, so nothing blocks him: enemies on the way are captured (their squares are emitted and the hop
 * goes on), his own pieces are hopped over (never a landing square). Edges and the storm end the
 * path before the square; wasteland ends it ON the square (he dies there, like a slide); the first
 * ENEMY doll trap ends it on the trap square (he may land there and is caught).
 */
function hop(
  occ: ArrayLike<number>,
  owners: ArrayLike<number>,
  owner: number,
  r: number,
  c: number,
  L: number,
  out: { [i: number]: number },
  n: number,
  includeAllies: boolean,
  storm: number,
  waste: ArrayLike<number> | null,
  traps: ArrayLike<number> | null,
): number {
  const enemyTrap = owner === 0 ? 2 : 1;
  for (let d = 0; d < 8; d += 2) {
    const dr = DIAG_DIRS[d];
    const dc = DIAG_DIRS[d + 1];
    let nr = r;
    let nc = c;
    for (let k = 0; k < L; k++) {
      nr += dr;
      nc += dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || inStorm(nr, nc, storm)) break;
      const s = nr * BOARD_SIZE + nc;
      const o = occ[s];
      if (o < 0 || includeAllies || owners[o] !== owner) out[n++] = s;
      if (waste !== null && waste[s]) break;
      if (traps !== null && traps[s] & enemyTrap) break;
    }
  }
  return n;
}

/**
 * Rakaeli: jump onto any square of the block `depth` rows ahead x columns c - half .. c + half (and,
 * with `back`, the square straight behind). Like Walk's jump nothing in between blocks him; rows
 * past the edge and storm columns are skipped; he may land on an enemy (capture), never on his own
 * piece. Wasteland and doll traps act on the landing square (handled by the caller, like Walk).
 */
function jumpBlock(
  occ: ArrayLike<number>,
  owners: ArrayLike<number>,
  owner: number,
  r: number,
  c: number,
  dir: number,
  depth: number,
  half: number,
  back: boolean,
  out: { [i: number]: number },
  n: number,
  includeAllies: boolean,
  storm: number,
): number {
  const c0 = c - half < 0 ? 0 : c - half;
  const c1 = c + half >= BOARD_SIZE ? BOARD_SIZE - 1 : c + half;
  for (let k = 1; k <= depth; k++) {
    const nr = r + dir * k;
    if (nr < 0 || nr >= BOARD_SIZE) break;
    const base = nr * BOARD_SIZE;
    for (let nc = c0; nc <= c1; nc++) {
      if (inStorm(nr, nc, storm)) continue;
      const s = base + nc;
      const o = occ[s];
      if (o < 0 || includeAllies || owners[o] !== owner) out[n++] = s;
    }
  }
  if (back) {
    const nr = r - dir;
    if (nr >= 0 && nr < BOARD_SIZE && !inStorm(nr, c, storm)) {
      const s = nr * BOARD_SIZE + c;
      const o = occ[s];
      if (o < 0 || includeAllies || owners[o] !== owner) out[n++] = s;
    }
  }
  return n;
}

/**
 * Larhen's jumps as (forward rows, columns) offsets by level: left / right 1 and the forward
 * diagonals; 2성 adds the backward diagonals (an H); 3성 makes the H a row taller at both ends.
 * Rows are multiplied by the piece's direction.
 */
const LARHEN_OFFSETS: number[][] = [
  [],
  [0, -1, 0, 1, 1, -1, 1, 1],
  [0, -1, 0, 1, 1, -1, 1, 1, -1, -1, -1, 1],
  [0, -1, 0, 1, 1, -1, 1, 1, -1, -1, -1, 1, 2, -1, 2, 1, -2, -1, -2, 1],
];

/**
 * Larhen: jump onto any square of his level's offsets. Nothing in between blocks him; off-board
 * and storm squares are skipped; he may land on an enemy (capture), never on his own piece.
 * Wasteland and doll traps act on the landing square (handled by the caller, like Walk).
 */
function jumpLarhen(
  occ: ArrayLike<number>,
  owners: ArrayLike<number>,
  owner: number,
  r: number,
  c: number,
  dir: number,
  level: number,
  out: { [i: number]: number },
  n: number,
  includeAllies: boolean,
  storm: number,
): number {
  const offs = LARHEN_OFFSETS[level];
  for (let k = 0; k < offs.length; k += 2) {
    const nr = r + offs[k] * dir;
    const nc = c + offs[k + 1];
    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || inStorm(nr, nc, storm)) continue;
    const s = nr * BOARD_SIZE + nc;
    const o = occ[s];
    if (o < 0 || includeAllies || owners[o] !== owner) out[n++] = s;
  }
  return n;
}

/**
 * Verish's pierce ("관통"): a slide up to `L` squares along (dr, dc) that captures and passes every
 * enemy on the way (each enemy square is a landing square too). Her own piece, wasteland, the board
 * edge and the storm stop her BEFORE the square (with `includeAllies` the ally square is still
 * emitted, as for every other slide). Doll traps do not stop her: only the landing square catches.
 */
function pierce(
  occ: ArrayLike<number>,
  owners: ArrayLike<number>,
  owner: number,
  r: number,
  c: number,
  dr: number,
  dc: number,
  L: number,
  out: { [i: number]: number },
  n: number,
  includeAllies: boolean,
  storm: number,
  waste: ArrayLike<number> | null,
): number {
  let nr = r;
  let nc = c;
  for (let k = 0; k < L; k++) {
    nr += dr;
    nc += dc;
    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || inStorm(nr, nc, storm)) break;
    const s = nr * BOARD_SIZE + nc;
    if (waste !== null && waste[s]) break;
    const o = occ[s];
    if (o >= 0 && owners[o] === owner) {
      if (includeAllies) out[n++] = s;
      break;
    }
    out[n++] = s;
  }
  return n;
}

/**
 * Verish's four lanes by level: forward, left, right and (3성) straight back, each with its length.
 * `piercing`: the real Verish (pierce); false = a plain slide (an Insaner's absorbed range).
 */
function genVerish(
  occ: ArrayLike<number>,
  owners: ArrayLike<number>,
  owner: number,
  r: number,
  c: number,
  dir: number,
  level: number,
  out: { [i: number]: number },
  n: number,
  includeAllies: boolean,
  storm: number,
  waste: ArrayLike<number> | null,
  piercing: boolean,
): number {
  const fwd = VERISH_FORWARD[level];
  const side = VERISH_SIDE[level];
  const back = VERISH_BACK[level];
  if (piercing) {
    n = pierce(occ, owners, owner, r, c, dir, 0, fwd, out, n, includeAllies, storm, waste);
    n = pierce(occ, owners, owner, r, c, 0, -1, side, out, n, includeAllies, storm, waste);
    n = pierce(occ, owners, owner, r, c, 0, 1, side, out, n, includeAllies, storm, waste);
    if (back > 0) n = pierce(occ, owners, owner, r, c, -dir, 0, back, out, n, includeAllies, storm, waste);
    return n;
  }
  const d = dir > 0 ? 0 : 1;
  n = slide(occ, owners, owner, r, c, VERISH_LANE[0][d], fwd, out, n, includeAllies, storm, waste);
  n = slide(occ, owners, owner, r, c, VERISH_LANE[1][d], side, out, n, includeAllies, storm, waste);
  n = slide(occ, owners, owner, r, c, VERISH_LANE[2][d], side, out, n, includeAllies, storm, waste);
  if (back > 0) n = slide(occ, owners, owner, r, c, VERISH_LANE[3][d], back, out, n, includeAllies, storm, waste);
  return n;
}
/** Verish's lanes as slide directions, per lane (forward, left, right, back) and direction (+1 / -1). */
const VERISH_LANE: number[][][] = [
  [[1, 0], [-1, 0]],
  [[0, -1], [0, -1]],
  [[0, 1], [0, 1]],
  [[-1, 0], [1, 0]],
];

/**
 * Venoa's "독화살": along each shot lane EVERY enemy between VENOA_SHOT_MIN and `max` squares away
 * is a target (with `includeAllies`, an ally there too: she covers it). The arrow flies over
 * pieces (owner rule 2026-11-07: "범위 안의 적은 항상 저격 가능"); only the edge and the storm end
 * a lane, and wasteland and doll traps do not stop it. Empty lane squares are not targets (she
 * does not walk there).
 */
function shoot(
  occ: ArrayLike<number>,
  owners: ArrayLike<number>,
  owner: number,
  r: number,
  c: number,
  dir: number,
  level: number,
  out: { [i: number]: number },
  n: number,
  includeAllies: boolean,
  storm: number,
): number {
  const lanes = VENOA_LANES[dir];
  const nl = level >= VENOA_DIAG_LEVEL ? lanes.length : 2;
  const max = VENOA_SHOT_MAX[level];
  for (let d = 0; d < nl; d += 2) {
    const dr = lanes[d];
    const dc = lanes[d + 1];
    let nr = r;
    let nc = c;
    for (let k = 1; k <= max; k++) {
      nr += dr;
      nc += dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || inStorm(nr, nc, storm)) break;
      const s = nr * BOARD_SIZE + nc;
      const o = occ[s];
      if (o >= 0 && k >= VENOA_SHOT_MIN && (includeAllies || owners[o] !== owner)) out[n++] = s;
    }
  }
  return n;
}

/**
 * Venoa's arrow range for the board overlay: the EMPTY squares of her lanes at a distance of
 * VENOA_SHOT_MIN..max, walked exactly as `shoot` walks them (the edge and the storm end a lane;
 * pieces, wasteland and traps do not). Occupied squares are left out: an enemy there is a shot
 * target, an ally is not shootable. Appends square indices to `out`, returns the new count.
 */
export function venoaShotRange(occ: ArrayLike<number>, r: number, c: number, dir: number, level: number, storm: number, out: { [i: number]: number }, n: number): number {
  const lanes = VENOA_LANES[dir];
  const nl = level >= VENOA_DIAG_LEVEL ? lanes.length : 2;
  const max = VENOA_SHOT_MAX[level];
  for (let d = 0; d < nl; d += 2) {
    let nr = r;
    let nc = c;
    for (let k = 1; k <= max; k++) {
      nr += lanes[d];
      nc += lanes[d + 1];
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || inStorm(nr, nc, storm)) break;
      const s = nr * BOARD_SIZE + nc;
      if (k >= VENOA_SHOT_MIN && occ[s] < 0) out[n++] = s;
    }
  }
  return n;
}

/** Set while `orthoReach` measures a pattern: Glacia's glide is not a reach (see there). */
let measuringReach = false;

/**
 * Glacia's "빙판 활주": along each orthogonal direction she glides until the next square is the
 * edge, the storm or any piece, and must stop only there (one landing square per direction, at
 * least one square away); she never captures by gliding. Wasteland ends the glide ON it (she dies
 * there, like any slide).
 */
function glide(
  occ: ArrayLike<number>,
  r: number,
  c: number,
  out: { [i: number]: number },
  n: number,
  storm: number,
  waste: ArrayLike<number> | null,
): number {
  for (let d = 0; d < 8; d += 2) {
    const dr = ORTHO_DIRS[d];
    const dc = ORTHO_DIRS[d + 1];
    let nr = r;
    let nc = c;
    let last = -1;
    for (;;) {
      const tr = nr + dr;
      const tc = nc + dc;
      if (tr < 0 || tr >= BOARD_SIZE || tc < 0 || tc >= BOARD_SIZE || inStorm(tr, tc, storm)) break;
      const s = tr * BOARD_SIZE + tc;
      if (occ[s] >= 0) break;
      nr = tr;
      nc = tc;
      last = s;
      if (waste !== null && waste[s]) break;
    }
    if (last >= 0) out[n++] = last;
  }
  return n;
}

/**
 * True when a piece of character code `ch` captures every enemy on the straight path of a move:
 * Picker's hop-through ("콩콩", diagonals) and Verish's pierce ("관통", her lanes). Only the real
 * characters do: an Insaner that absorbed their pattern gets the RANGE as a plain slide.
 */
export function canHop(ch: number): boolean {
  return ch === CH_PICKER || ch === CH_VERISH;
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
  traps: ArrayLike<number> | null,
  awake: boolean,
): number {
  if (ch === CH_SAD) return slide(occ, owners, owner, r, c, ORTHO_DIRS, SAD_RANGE[level], out, n, includeAllies, storm, waste);
  // Insaner: orthogonal slides only at every grade (owner nerf, 2026-11-04: no diagonal at 3성);
  // absorbed patterns are added by the caller, and 3성 keeps the once-per-turn chain move.
  if (ch === CH_INSANER) return slide(occ, owners, owner, r, c, ORTHO_DIRS, INSANER_RANGE[level], out, n, includeAllies, storm, waste);
  if (ch === CH_BRUTILE) {
    const dirs = level >= 3 ? KING_DIRS : BRUTILE_DIRS[dir][level];
    return slide(occ, owners, owner, r, c, dirs, 1, out, n, includeAllies, storm, waste);
  }
  if (ch === CH_MICHELLE) {
    n = slide(occ, owners, owner, r, c, MICHELLE_DIRS[dir], MICHELLE_RANGE[level], out, n, includeAllies, storm, waste);
    const fwd = MICHELLE_FORWARD_RANGE[level];
    if (fwd > 0) n = slide(occ, owners, owner, r, c, MICHELLE_FWD[dir], fwd, out, n, includeAllies, storm, waste);
    return n;
  }
  if (ch === CH_PICKER) return hop(occ, owners, owner, r, c, PICKER_RANGE[level], out, n, includeAllies, storm, waste, traps);
  if (ch === CH_VOLKONOV) return slide(occ, owners, owner, r, c, ORTHO_DIRS, VOLKONOV_RANGE[level], out, n, includeAllies, storm, waste);
  if (ch === CH_RAMPID) return slide(occ, owners, owner, r, c, RAMPID_DIRS[dir], RAMPID_RANGE[level], out, n, includeAllies, storm, waste);
  if (ch === CH_HAMMONT) return slide(occ, owners, owner, r, c, ORTHO_DIRS, HAMMONT_RANGE[level], out, n, includeAllies, storm, waste);
  if (ch === CH_VENOA) {
    n = slide(occ, owners, owner, r, c, ORTHO_DIRS, 1, out, n, includeAllies, storm, waste);
    return shoot(occ, owners, owner, r, c, dir, level, out, n, includeAllies, storm);
  }
  if (ch === CH_GLACIA) {
    if (!measuringReach) n = glide(occ, r, c, out, n, storm, waste);
    return slide(occ, owners, owner, r, c, DIAG_DIRS, GLACIA_DIAG[level], out, n, includeAllies, storm, waste);
  }
  if (ch === CH_MIDOS) return slide(occ, owners, owner, r, c, MIDOS_DIRS[dir], MIDOS_RANGE[level], out, n, includeAllies, storm, waste);
  if (ch === CH_LARHEN) return jumpLarhen(occ, owners, owner, r, c, dir, level, out, n, includeAllies, storm);
  if (ch === CH_VERISH) return genVerish(occ, owners, owner, r, c, dir, level, out, n, includeAllies, storm, waste, true);
  if (ch === CH_RAKAELI) {
    const depth = awake ? RAKAELI_AWAKE_DEPTH[level] : RAKAELI_DEPTH[level];
    const half = awake ? RAKAELI_AWAKE_HALF[level] : RAKAELI_HALF[level];
    return jumpBlock(occ, owners, owner, r, c, dir, depth, half, level >= RAKAELI_BACK_LEVEL, out, n, includeAllies, storm);
  }
  const dr = dir;
  if (ch === CH_MARKI) {
    const L = MARKI_RANGE[level];
    let nr = r;
    for (let k = 0; k < L; k++) {
      nr += dr;
      if (nr < 0 || nr >= BOARD_SIZE || inStorm(nr, c, storm)) break;
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
    // 3-star: a plain 1-square step left or right (not tied to the forward direction).
    if (level >= MARKI_SIDE_LEVEL) n = slide(occ, owners, owner, r, c, SIDE_DIRS, 1, out, n, includeAllies, storm, waste);
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
    if (inStorm(nr, nc, storm)) continue;
    const s = base + nc;
    const o = occ[s];
    if (o < 0 || includeAllies || owners[o] !== owner) out[n++] = s;
  }
  return n;
}

// Dedupe scratch for pieces with absorbed patterns (a square may be reachable by two patterns).
const seenStamp = new Int32Array(N_SQUARES);
let stamp = 0;

/** Drop from out[from..n) every square already stamped in this call (and stamp the rest); new n. */
function compactNew(out: { [i: number]: number }, from: number, n: number): number {
  let w = from;
  for (let k = from; k < n; k++) {
    const s = out[k];
    if (seenStamp[s] === stamp) continue;
    seenStamp[s] = stamp;
    out[w++] = s;
  }
  return w;
}

/** Empty board (no pieces) for measuring a pattern's reach. */
const EMPTY_OCC = new Int8Array(N_SQUARES).fill(-1);
const reachScratch = new Int16Array(256);
const reachCache = new Map<number, Int8Array>();

/**
 * How far piece pattern (ch, level, dir, awake, absorbed patterns) reaches along each orthogonal
 * direction on an EMPTY board without storm: the farthest square straight up / down / right / left
 * among its targets (0 when it has none that way), in ORTHO_DIRS order (+row, -row, +col, -col).
 * Measured from a square at the opposite edge so the board never cuts it short. Cached.
 */
export function orthoReach(ch: number, level: number, dir: number, awake: boolean, absorb: number): Int8Array {
  const key = (((absorb * 16 + ch) * 4 + level) * 2 + (dir > 0 ? 1 : 0)) * 2 + (awake ? 1 : 0);
  let reach = reachCache.get(key);
  if (reach) return reach;
  reach = new Int8Array(4);
  const mid = BOARD_SIZE >> 1;
  // Glacia's glide crosses the whole board but is not a step she can shorten: it does not count as
  // reach, so the melody gives her (or an Insaner who absorbed her) a plain 1-square slide there.
  measuringReach = true;
  try {
    for (let d = 0; d < 4; d++) {
      const dr = ORTHO_DIRS[d * 2];
      const dc = ORTHO_DIRS[d * 2 + 1];
      // Origin at the far side of this direction: the whole board lies ahead of it.
      const r = dr > 0 ? 0 : dr < 0 ? BOARD_SIZE - 1 : mid;
      const c = dc > 0 ? 0 : dc < 0 ? BOARD_SIZE - 1 : mid;
      const n = genTargets(EMPTY_OCC, [], 0, ch, level, r * BOARD_SIZE + c, reachScratch, 0, false, dir, 0, absorb, null, null, awake);
      let best = 0;
      for (let k = 0; k < n; k++) {
        const s = reachScratch[k];
        const tr = (s / BOARD_SIZE) | 0;
        const tc = s - tr * BOARD_SIZE;
        const dist = dr !== 0 ? (tc === c ? (tr - r) * dr : 0) : tr === r ? (tc - c) * dc : 0;
        if (dist > best) best = dist;
      }
      reach[d] = best;
    }
  } finally {
    measuringReach = false;
  }
  reachCache.set(key, reach);
  return reach;
}

/**
 * Core move generator shared by the public engine API and the AI.
 *
 * @param occ     length-N_SQUARES array: -1 = empty, otherwise an index into `owners`
 * @param owners  owner of each piece index
 * @param includeAllies if true, squares occupied by allies are also emitted (attack/defence maps)
 * @param dir     forward direction of this piece (+1 toward r = BOARD_SIZE - 1); defaults to the owner's base direction
 * @param storm   storm step (blocked squares, see `inStorm`: outer columns, from step 3 outer rows too)
 * @param absorb  bitmask of absorbed (character, level) patterns, see `abilityBit`: their movement
 *                range only (Picker's absorbed pattern slides, it does not hop)
 * @param waste   optional length-N_SQUARES wasteland flags: slides end ON a wasteland square
 * @param traps   optional length-N_SQUARES doll-trap masks (see `trapBit`): a real Picker's hop stops on an enemy trap
 * @param awake   the piece is transformed (Rakaeli's "타천", `Piece.awaken` > 0): its OWN pattern is
 *                the transformed one. Absorbed patterns are always base patterns.
 * @param buff    Volkonov's "선율" is on the piece (`Piece.buff` > 0): see `orthoReach`; the extra
 *                squares come last in `out`.
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
  traps: ArrayLike<number> | null = null,
  awake = false,
  buff = false,
): number {
  const r = (sq / BOARD_SIZE) | 0;
  const c = sq - r * BOARD_SIZE;
  // The piece can never be in the storm itself (it would have been removed), but when the
  // caller passes a storm the origin must still be a legal square: nothing to do here.
  const start = n;
  // Measured first: orthoReach runs the generator itself (it must not run between the dedupe
  // stamp below and its last use).
  const reach = buff ? orthoReach(ch, level, dir, awake, absorb) : null;
  n = genPattern(occ, owners, owner, ch, level, r, c, out, n, includeAllies, dir, storm, waste, traps, awake);
  if (absorb === 0 && reach === null) return n;
  stamp++;
  for (let k = start; k < n; k++) seenStamp[out[k]] = stamp;
  for (let ach = 0; absorb !== 0 && ach < N_CHARS; ach++) {
    const alvl = absorbedLevel(absorb, ach);
    if (alvl === 0) continue;
    if (ach === ch && alvl === level) continue;
    const from = n;
    // Only the movement RANGE is absorbed, never a trait: Picker's pattern becomes a plain diagonal
    // slide (blocked by pieces, captures on the landing square only, ends on wasteland).
    n =
      ach === CH_PICKER
        ? slide(occ, owners, owner, r, c, DIAG_DIRS, PICKER_RANGE[alvl], out, n, includeAllies, storm, waste)
        : ach === CH_VERISH
          ? genVerish(occ, owners, owner, r, c, dir, alvl, out, n, includeAllies, storm, waste, false)
          : ach === CH_VENOA
            ? slide(occ, owners, owner, r, c, ORTHO_DIRS, 1, out, n, includeAllies, storm, waste)
          : genPattern(occ, owners, owner, ach, alvl, r, c, out, n, includeAllies, dir, storm, waste, traps, false);
    n = compactNew(out, from, n);
  }
  if (reach !== null) {
    // Volkonov's "선율": one square further than the pattern reaches along each orthogonal
    // direction (1 where it reaches nowhere that way), as a plain slide from the piece: blocked by
    // pieces, capturing on the blocking enemy, ending on wasteland, stopped by edges and storm.
    // Appended last, so a buffed list is the unbuffed list plus the extra squares (the bot relies
    // on this, see melodyScore).
    for (let d = 0; d < 4; d++) {
      const from = n;
      n = slide(occ, owners, owner, r, c, ORTHO_ONE[d], reach[d] + 1, out, n, includeAllies, storm, waste);
      n = compactNew(out, from, n);
    }
  }
  return n;
}
