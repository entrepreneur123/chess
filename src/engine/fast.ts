/**
 * Lightweight mutable board for search (AI). Not part of GameState; never posted anywhere.
 * Moves are encoded as integers: (pieceIndex << 8) | toSquare.
 * Undo tokens: ((capturedIndex + 1) << 8) | fromSquare (+ bit 16 when the mover turned around).
 * Everything else a move changes (turn, chain move, absorbed abilities, storm clock and storm
 * kills) is pushed on an internal LIFO history so make/unmake stay exact.
 */
import { STORM_INTERVAL_PLIES, SUDDEN_DEATH_PLY } from './types';
import type { CharacterId, GameState, Move, PlayerId } from './types';
import { CHARACTERS, CHAR_BY_CODE, CHAR_CODE, CH_INSANER, abilityBit, absorbMaskOf } from './characters';
import { N_SQUARES, atTurnRow, genTargets, inStorm, posOf, sqOf } from './board';
import { pieceDir } from './rules';

export interface FastBoard {
  n: number;
  ids: string[];
  sq: Int16Array; // -1 = captured / killed
  owner: Uint8Array;
  ch: Uint8Array;
  lvl: Uint8Array;
  dir: Int8Array; // current forward direction per piece (+1 / -1)
  absorb: Uint16Array; // absorbed pattern bitmask per piece (see abilityBit)
  value: Int16Array; // base material value of each piece
  occ: Int8Array; // piece index or -1
  alive: Int16Array; // [count0, count1]
  material: Int16Array; // [mat0, mat1]
  turn: PlayerId;
  /** Piece index that must play a pending chain move, or -1. */
  bonus: number;
  /** Storm columns per side. */
  storm: number;
  /** Turn changes until the storm advances; -1 while inactive. */
  stormIn: number;
  /** Plies played (drives sudden death). */
  ply: number;
  /** Material difference (side 0 minus side 1) of a storm that swallowed both sides' last pieces. */
  wipe: number;
  /** LIFO scratch for make/unmake bookkeeping. */
  hist: Int32Array;
  histTop: number;
}

export function fastFromState(state: GameState): FastBoard {
  const n = state.pieces.length;
  const b: FastBoard = {
    n,
    ids: state.pieces.map((p) => p.id),
    sq: new Int16Array(n),
    owner: new Uint8Array(n),
    ch: new Uint8Array(n),
    lvl: new Uint8Array(n),
    dir: new Int8Array(n),
    absorb: new Uint16Array(n),
    value: new Int16Array(n),
    occ: new Int8Array(N_SQUARES).fill(-1),
    alive: new Int16Array(2),
    material: new Int16Array(2),
    turn: state.turn,
    bonus: -1,
    storm: state.storm,
    stormIn: state.stormIn ?? -1,
    ply: state.ply,
    wipe: 0,
    hist: new Int32Array(4096),
    histTop: 0,
  };
  state.pieces.forEach((p, i) => {
    const s = sqOf(p.pos);
    b.sq[i] = s;
    b.owner[i] = p.owner;
    b.ch[i] = CHAR_CODE[p.character];
    b.lvl[i] = p.level;
    b.dir[i] = pieceDir(p);
    b.absorb[i] = absorbMaskOf(p.absorbed);
    b.value[i] = CHARACTERS[p.character].value[p.level - 1];
    b.occ[s] = i;
    b.alive[p.owner]++;
    b.material[p.owner] += b.value[i];
    if (state.bonusPieceId === p.id) b.bonus = i;
  });
  return b;
}

/** Generate all legal moves for `side` into `out` starting at `n` (chain move: only that piece). */
export function fastGenMoves(b: FastBoard, side: number, out: Int32Array, n = 0): number {
  for (let i = 0; i < b.n; i++) {
    const s = b.sq[i];
    if (s < 0 || b.owner[i] !== side) continue;
    if (b.bonus >= 0 && i !== b.bonus) continue;
    const start = n;
    n = genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, out, n, false, b.dir[i], b.storm, b.absorb[i]);
    const hi = i << 8;
    for (let k = start; k < n; k++) out[k] |= hi;
  }
  return n;
}

const scratch = new Int32Array(128);

export function fastHasMoves(b: FastBoard, side: number): boolean {
  for (let i = 0; i < b.n; i++) {
    const s = b.sq[i];
    if (s < 0 || b.owner[i] !== side) continue;
    if (b.bonus >= 0 && i !== b.bonus) continue;
    if (genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, scratch, 0, false, b.dir[i], b.storm, b.absorb[i]) > 0) return true;
  }
  return false;
}

const SAD_CODE = CHAR_CODE.sad;
const FLIP_BIT = 1 << 16;

/** Remove a piece from the board (storm kill). */
function kill(b: FastBoard, i: number): void {
  const s = b.sq[i];
  b.hist[b.histTop++] = (i << 8) | s;
  b.occ[s] = -1;
  b.sq[i] = -1;
  b.alive[b.owner[i]]--;
  b.material[b.owner[i]] -= b.value[i];
}

/**
 * Hand the move to the other side: clears the chain move, ticks the storm (killing pieces in the
 * new storm columns) and activates the storm when a side is down to one piece. Pushes its own
 * undo record; `undoSwitch` reverses it.
 */
function switchSide(b: FastBoard): void {
  const oldBonus = b.bonus;
  const oldStorm = b.storm;
  const oldStormIn = b.stormIn;
  b.bonus = -1;
  b.turn = (1 - b.turn) as PlayerId;
  let killed = 0;
  const oldWipe = b.wipe;
  if (b.stormIn > 0) {
    b.stormIn--;
    if (b.stormIn === 0) {
      b.storm++;
      b.stormIn = STORM_INTERVAL_PLIES;
      for (let i = 0; i < b.n; i++) {
        const s = b.sq[i];
        if (s < 0) continue;
        if (inStorm(s % 12, b.storm)) {
          if (killed === 0) b.wipe = b.material[0] - b.material[1];
          kill(b, i);
          killed++;
        }
      }
    }
  }
  if (b.stormIn < 0 && (b.alive[0] <= 1 || b.alive[1] <= 1 || b.ply >= SUDDEN_DEATH_PLY) && b.alive[0] > 0 && b.alive[1] > 0) b.stormIn = STORM_INTERVAL_PLIES;
  const h = b.hist;
  h[b.histTop++] = oldWipe;
  h[b.histTop++] = killed;
  h[b.histTop++] = oldStormIn;
  h[b.histTop++] = oldStorm;
  h[b.histTop++] = oldBonus;
}

function undoSwitch(b: FastBoard): void {
  const h = b.hist;
  b.bonus = h[--b.histTop];
  b.storm = h[--b.histTop];
  b.stormIn = h[--b.histTop];
  const killed = h[--b.histTop];
  b.wipe = h[--b.histTop];
  for (let k = 0; k < killed; k++) {
    const rec = h[--b.histTop];
    const i = rec >> 8;
    const s = rec & 255;
    b.sq[i] = s;
    b.occ[s] = i;
    b.alive[b.owner[i]]++;
    b.material[b.owner[i]] += b.value[i];
  }
  b.turn = (1 - b.turn) as PlayerId;
}

/**
 * Applies a move for the side to move, including the turn change (unless the mover earns a chain
 * move), absorption, storm clock and storm kills. Returns an undo token for `fastUnmake`.
 */
export function fastMake(b: FastBoard, mv: number): number {
  const pi = mv >> 8;
  const to = mv & 255;
  const from = b.sq[pi];
  const cap = b.occ[to];
  if (cap >= 0) {
    b.sq[cap] = -1;
    b.alive[b.owner[cap]]--;
    b.material[b.owner[cap]] -= b.value[cap];
  }
  b.occ[from] = -1;
  b.occ[to] = pi;
  b.sq[pi] = to;
  let undo = ((cap + 1) << 8) | from;
  if (b.ch[pi] !== SAD_CODE && atTurnRow((to / 12) | 0, b.dir[pi])) {
    b.dir[pi] = -b.dir[pi];
    undo |= FLIP_BIT;
  }
  const oldAbsorb = b.absorb[pi];
  const oldBonus = b.bonus;
  const oldStormIn = b.stormIn;
  b.ply++;
  let chained = 0;
  if (cap >= 0 && b.ch[pi] === CH_INSANER) {
    b.absorb[pi] |= abilityBit(b.ch[cap], b.lvl[cap]) | b.absorb[cap];
    b.absorb[pi] &= ~abilityBit(b.ch[pi], b.lvl[pi]);
    if (b.lvl[pi] === 3 && b.bonus < 0 && b.alive[1 - b.turn] > 0) {
      b.bonus = pi;
      chained = 1;
      // The engine activates the storm right after the capture, before the chain move is played.
      if (b.stormIn < 0 && (b.alive[0] <= 1 || b.alive[1] <= 1 || b.ply >= SUDDEN_DEATH_PLY)) b.stormIn = STORM_INTERVAL_PLIES;
    }
  }
  if (!chained) switchSide(b);
  const h = b.hist;
  h[b.histTop++] = oldStormIn;
  h[b.histTop++] = oldAbsorb;
  h[b.histTop++] = oldBonus;
  h[b.histTop++] = chained;
  return undo;
}

export function fastUnmake(b: FastBoard, mv: number, undo: number): void {
  const h = b.hist;
  const chained = h[--b.histTop];
  const oldBonus = h[--b.histTop];
  const oldAbsorb = h[--b.histTop];
  const oldStormIn = h[--b.histTop];
  if (!chained) undoSwitch(b);
  b.ply--;
  b.bonus = oldBonus;
  b.stormIn = oldStormIn;
  const pi = mv >> 8;
  const to = mv & 255;
  const from = undo & 255;
  const cap = ((undo & 0xffff) >> 8) - 1;
  b.absorb[pi] = oldAbsorb;
  if (undo & FLIP_BIT) b.dir[pi] = -b.dir[pi];
  b.sq[pi] = from;
  b.occ[from] = pi;
  if (cap >= 0) {
    b.occ[to] = cap;
    b.sq[cap] = to;
    b.alive[b.owner[cap]]++;
    b.material[b.owner[cap]] += b.value[cap];
  } else {
    b.occ[to] = -1;
  }
}

/** The side to move passes (no legal move / chain move declined). Reverse with `fastUnpass`. */
export function fastPass(b: FastBoard): void {
  b.ply++;
  switchSide(b);
}

export function fastUnpass(b: FastBoard): void {
  undoSwitch(b);
  b.ply--;
}

/** Convert an encoded move (before it is made) into an engine Move. */
export function fastMoveToMove(b: FastBoard, mv: number): Move {
  const pi = mv >> 8;
  const to = mv & 255;
  const m: Move = { pieceId: b.ids[pi], from: posOf(b.sq[pi]), to: posOf(to) };
  const cap = b.occ[to];
  if (cap >= 0) m.captureId = b.ids[cap];
  return m;
}

export function fastCharacter(b: FastBoard, pi: number): CharacterId {
  return CHAR_BY_CODE[b.ch[pi]];
}
