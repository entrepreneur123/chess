/**
 * Lightweight mutable board for search (AI). Not part of GameState; never posted anywhere.
 * Moves are encoded as integers: (pieceIndex << 8) | toSquare.
 * Undo tokens: ((capturedIndex + 1) << 8) | fromSquare.
 */
import type { CharacterId, GameState, Move, PlayerId } from './types';
import { CHARACTERS, CHAR_CODE } from './characters';
import { N_SQUARES, genTargets, posOf, sqOf } from './board';

export interface FastBoard {
  n: number;
  ids: string[];
  sq: Int16Array; // -1 = captured
  owner: Uint8Array;
  ch: Uint8Array;
  lvl: Uint8Array;
  value: Int16Array; // material value of each piece
  occ: Int8Array; // piece index or -1
  alive: Int16Array; // [count0, count1]
  material: Int16Array; // [mat0, mat1]
  turn: PlayerId;
}

const CHAR_BY_CODE: CharacterId[] = ['sad', 'marki', 'walk'];

export function fastFromState(state: GameState): FastBoard {
  const n = state.pieces.length;
  const b: FastBoard = {
    n,
    ids: state.pieces.map((p) => p.id),
    sq: new Int16Array(n),
    owner: new Uint8Array(n),
    ch: new Uint8Array(n),
    lvl: new Uint8Array(n),
    value: new Int16Array(n),
    occ: new Int8Array(N_SQUARES).fill(-1),
    alive: new Int16Array(2),
    material: new Int16Array(2),
    turn: state.turn,
  };
  state.pieces.forEach((p, i) => {
    const s = sqOf(p.pos);
    b.sq[i] = s;
    b.owner[i] = p.owner;
    b.ch[i] = CHAR_CODE[p.character];
    b.lvl[i] = p.level;
    b.value[i] = CHARACTERS[p.character].value[p.level - 1];
    b.occ[s] = i;
    b.alive[p.owner]++;
    b.material[p.owner] += b.value[i];
  });
  return b;
}

/** Generate all pseudo-legal (= legal) moves for `side` into `out` starting at `n`. */
export function fastGenMoves(b: FastBoard, side: number, out: Int32Array, n = 0): number {
  for (let i = 0; i < b.n; i++) {
    const s = b.sq[i];
    if (s < 0 || b.owner[i] !== side) continue;
    const start = n;
    n = genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, out, n);
    const hi = i << 8;
    for (let k = start; k < n; k++) out[k] |= hi;
  }
  return n;
}

const scratch = new Int32Array(64);

export function fastHasMoves(b: FastBoard, side: number): boolean {
  for (let i = 0; i < b.n; i++) {
    const s = b.sq[i];
    if (s < 0 || b.owner[i] !== side) continue;
    if (genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, scratch, 0) > 0) return true;
  }
  return false;
}

/** Applies a move (does not flip turn). Returns an undo token. */
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
  return ((cap + 1) << 8) | from;
}

export function fastUnmake(b: FastBoard, mv: number, undo: number): void {
  const pi = mv >> 8;
  const to = mv & 255;
  const from = undo & 255;
  const cap = (undo >> 8) - 1;
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
