import { NO_CAPTURE_PLY_LIMIT } from '../engine/types';
import type { GameState, Move } from '../engine/types';
import {
  N_SQUARES,
  fastFromState,
  fastGenMoves,
  fastHasMoves,
  fastMake,
  fastMoveToMove,
  fastUnmake,
  genTargets,
  getLegalMoves,
} from '../engine';
import type { FastBoard } from '../engine';
import { CH_MARKI, CH_SAD, CH_WALK } from '../engine/characters';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface ChooseMoveOptions {
  timeBudgetMs?: number;
  rng?: () => number;
}

/** Absolute safety cap on thinking time, regardless of the requested budget. */
const HARD_CAP_MS = 1200;
const DEFAULT_BUDGET: Record<Difficulty, number> = { easy: 50, normal: 300, hard: 700 };

const WIN = 1_000_000;
const ADJ_WIN = 500_000; // won by adjudication (ply limit / stalemate)
const INF = 10_000_000;
const MAX_PLY = 64;
const MAX_MOVES = 64;
const UNIT = 100; // material unit

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

// ---------------------------------------------------------------- evaluation

const attackBuf = new Int32Array(MAX_MOVES);
/** attackCount[side*144 + sq], minAttacker[side*144+sq] */
const attackCount = new Int16Array(2 * N_SQUARES);
const minAttacker = new Int16Array(2 * N_SQUARES);
const touched: number[] = [];

function buildAttackMaps(b: FastBoard): number[] {
  // returns mobility per side as [m0, m1]
  for (const t of touched) {
    attackCount[t] = 0;
    minAttacker[t] = 0;
  }
  touched.length = 0;
  const mob = [0, 0];
  for (let i = 0; i < b.n; i++) {
    const s = b.sq[i];
    if (s < 0) continue;
    const side = b.owner[i];
    const n = genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, attackBuf, 0, true, b.dir[i]);
    const v = b.value[i];
    for (let k = 0; k < n; k++) {
      const t = attackBuf[k];
      const o = b.occ[t];
      if (o < 0 || b.owner[o] !== side) mob[side]++;
      const idx = side * N_SQUARES + t;
      if (attackCount[idx] === 0) {
        touched.push(idx);
        minAttacker[idx] = v;
      } else if (v < minAttacker[idx]) minAttacker[idx] = v;
      attackCount[idx]++;
    }
  }
  return mob;
}

/** Static evaluation from the point of view of `side` (the side to move). */
export function evaluate(b: FastBoard, side: number): number {
  const mob = buildAttackMaps(b);
  const score = [0, 0];
  for (let i = 0; i < b.n; i++) {
    const s = b.sq[i];
    if (s < 0) continue;
    const p = b.owner[i];
    const v = b.value[i] * UNIT;
    const r = (s / 12) | 0;
    const c = s - r * 12;
    let sc = v;
    const dir = b.dir[i];
    const room = dir > 0 ? 11 - r : r; // rows left in front of the piece (it turns around at 0)
    // Facing the enemy side is worth more than walking back home after a turn-around.
    const facingEnemy = dir === (p === 0 ? 1 : -1);
    const centerC = 5.5 - Math.abs(c - 5.5); // 0.5..5.5
    const ch = b.ch[i];
    if (ch === CH_SAD) {
      sc += centerC * 3 + (5.5 - Math.abs(r - 5.5)) * 2;
    } else if (ch === CH_MARKI) {
      if (!facingEnemy) sc -= v * 0.2;
      {
        // free squares straight ahead (blocked by ally = less potential)
        let free = 0;
        const dr = dir > 0 ? 12 : -12;
        for (let t = s + dr, k = 0; k < room; k++, t += dr) {
          const o = b.occ[t];
          if (o >= 0 && b.owner[o] === p) break;
          free++;
          if (o >= 0) break;
        }
        sc += Math.min(free, 6) * 4;
        if (free === 0) sc -= v * 0.15;
      }
    } else if (ch === CH_WALK) {
      if (!facingEnemy) sc -= v * 0.2;
      sc += centerC * 4 + Math.min(room, 6) * 2;
    }
    // safety
    const enemy = 1 - p;
    const att = attackCount[enemy * N_SQUARES + s];
    if (att > 0) {
      const def = attackCount[p * N_SQUARES + s];
      const minA = minAttacker[enemy * N_SQUARES + s] * UNIT;
      let loss = 0;
      if (def === 0) loss = v;
      else if (minA < v) loss = v - minA;
      if (loss > 0) sc -= loss * (p === side ? 0.2 : 0.55);
    }
    score[p] += sc;
  }
  score[0] += mob[0] * 3;
  score[1] += mob[1] * 3;
  return score[side] - score[1 - side];
}

function adjudicateScore(b: FastBoard, side: number, ply: number): number {
  const d = b.material[side] - b.material[1 - side];
  if (d > 0) return ADJ_WIN - ply;
  if (d < 0) return -ADJ_WIN + ply;
  return 0;
}

// ---------------------------------------------------------------- search

class TimeUp extends Error {}

interface SearchCtx {
  b: FastBoard;
  deadline: number;
  nodes: number;
  moveBufs: Int32Array[];
  scoreBufs: Int32Array[];
  killers: Int32Array; // per ply
}

function makeCtx(b: FastBoard, deadline: number): SearchCtx {
  const moveBufs: Int32Array[] = [];
  const scoreBufs: Int32Array[] = [];
  for (let i = 0; i <= MAX_PLY + 8; i++) {
    moveBufs.push(new Int32Array(MAX_MOVES));
    scoreBufs.push(new Int32Array(MAX_MOVES));
  }
  return { b, deadline, nodes: 0, moveBufs, scoreBufs, killers: new Int32Array(MAX_PLY + 8).fill(-1) };
}

function checkTime(ctx: SearchCtx) {
  if ((++ctx.nodes & 1023) === 0 && now() > ctx.deadline) throw new TimeUp();
}

/** Fill scores for ordering: captures by MVV-LVA, then killer move. */
function orderMoves(ctx: SearchCtx, moves: Int32Array, scores: Int32Array, n: number, ply: number) {
  const b = ctx.b;
  const killer = ctx.killers[ply];
  for (let k = 0; k < n; k++) {
    const mv = moves[k];
    const cap = b.occ[mv & 255];
    if (cap >= 0) scores[k] = 10000 + b.value[cap] * 100 - b.value[mv >> 8];
    else scores[k] = mv === killer ? 5000 : 0;
  }
  // insertion sort (n is small)
  for (let i = 1; i < n; i++) {
    const m = moves[i];
    const s = scores[i];
    let j = i - 1;
    while (j >= 0 && scores[j] < s) {
      moves[j + 1] = moves[j];
      scores[j + 1] = scores[j];
      j--;
    }
    moves[j + 1] = m;
    scores[j + 1] = s;
  }
}

function qsearch(ctx: SearchCtx, alpha: number, beta: number, ply: number, psc: number, qd: number): number {
  checkTime(ctx);
  const b = ctx.b;
  const side = b.turn;
  if (b.alive[side] === 0) return -WIN + ply;
  if (psc >= NO_CAPTURE_PLY_LIMIT) return adjudicateScore(b, side, ply);
  const stand = evaluate(b, side);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (qd <= 0 || ply >= MAX_PLY) return alpha;
  const moves = ctx.moveBufs[ply];
  const scores = ctx.scoreBufs[ply];
  const all = fastGenMoves(b, side, moves, 0);
  let n = 0;
  for (let k = 0; k < all; k++) if (b.occ[moves[k] & 255] >= 0) moves[n++] = moves[k];
  if (n === 0) return alpha;
  orderMoves(ctx, moves, scores, n, ply);
  for (let k = 0; k < n; k++) {
    const mv = moves[k];
    const undo = fastMake(b, mv);
    b.turn = (1 - side) as 0 | 1;
    let v: number;
    try {
      v = -qsearch(ctx, -beta, -alpha, ply + 1, 0, qd - 1);
    } finally {
      b.turn = side as 0 | 1;
      fastUnmake(b, mv, undo);
    }
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function negamax(ctx: SearchCtx, depth: number, alpha: number, beta: number, ply: number, psc: number): number {
  checkTime(ctx);
  const b = ctx.b;
  const side = b.turn;
  if (b.alive[side] === 0) return -WIN + ply;
  if (psc >= NO_CAPTURE_PLY_LIMIT) return adjudicateScore(b, side, ply);
  if (depth <= 0 || ply >= MAX_PLY) return qsearch(ctx, alpha, beta, ply, psc, 6);
  const moves = ctx.moveBufs[ply];
  const scores = ctx.scoreBufs[ply];
  const n = fastGenMoves(b, side, moves, 0);
  if (n === 0) {
    if (!fastHasMoves(b, 1 - side)) return adjudicateScore(b, side, ply);
    b.turn = (1 - side) as 0 | 1;
    try {
      return -negamax(ctx, depth - 1, -beta, -alpha, ply + 1, psc + 1);
    } finally {
      b.turn = side as 0 | 1;
    }
  }
  orderMoves(ctx, moves, scores, n, ply);
  let best = -INF;
  for (let k = 0; k < n; k++) {
    const mv = moves[k];
    const isCap = b.occ[mv & 255] >= 0;
    const undo = fastMake(b, mv);
    b.turn = (1 - side) as 0 | 1;
    let v: number;
    try {
      v = -negamax(ctx, depth - 1, -beta, -alpha, ply + 1, isCap ? 0 : psc + 1);
    } finally {
      b.turn = side as 0 | 1;
      fastUnmake(b, mv, undo);
    }
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) {
      if (!isCap) ctx.killers[ply] = mv;
      break;
    }
  }
  return best;
}

interface RootResult {
  move: number;
  score: number;
  depth: number;
}

/**
 * Iterative deepening at the root. `bonus[i]` is a small random preference per root move
 * (added to its score) so equal positions don't always produce the same game.
 */
function searchRoot(
  b: FastBoard,
  psc: number,
  maxDepth: number,
  deadline: number,
  rng: () => number,
  jitter: number,
): RootResult {
  const startT = now();
  const ctx = makeCtx(b, deadline);
  const side = b.turn;
  const rootMoves = new Int32Array(MAX_MOVES);
  const n = fastGenMoves(b, side, rootMoves, 0);
  const moves = Array.from(rootMoves.subarray(0, n));
  // shuffle then stable-sort captures first (MVV-LVA)
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }
  const capScore = (mv: number) => {
    const cap = b.occ[mv & 255];
    return cap >= 0 ? 1000 + b.value[cap] * 10 - b.value[mv >> 8] : 0;
  };
  moves.sort((a, c) => capScore(c) - capScore(a));
  const bonus = moves.map(() => Math.floor(rng() * (jitter + 1)));
  let result: RootResult = { move: moves[0], score: 0, depth: 0 };
  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INF;
    let bestIdx = -1;
    let completed = true;
    try {
      for (let k = 0; k < moves.length; k++) {
        const mv = moves[k];
        const isCap = b.occ[mv & 255] >= 0;
        const undo = fastMake(b, mv);
        b.turn = (1 - side) as 0 | 1;
        let v: number;
        try {
          v = -negamax(ctx, depth - 1, -INF, -(alpha - bonus[k]), 1, isCap ? 0 : psc + 1);
        } finally {
          b.turn = side as 0 | 1;
          fastUnmake(b, mv, undo);
        }
        const total = v + bonus[k];
        if (total > alpha) {
          alpha = total;
          bestIdx = k;
        }
      }
    } catch (e) {
      if (!(e instanceof TimeUp)) throw e;
      completed = false;
    }
    if (bestIdx >= 0 && (completed || bestIdx !== 0 || result.depth === 0)) {
      // A partially searched iteration is only trusted if its best beat the previous best (searched first).
      result = { move: moves[bestIdx], score: alpha, depth };
      const [m] = moves.splice(bestIdx, 1);
      const [bb] = bonus.splice(bestIdx, 1);
      moves.unshift(m);
      bonus.unshift(bb);
    }
    if (!completed) break;
    if (alpha >= WIN - MAX_PLY) break; // forced win found
    // Don't start an iteration we almost certainly can't finish.
    const t = now();
    if (t > deadline || t - startT > (deadline - startT) * 0.55) break;
  }
  return result;
}

// ---------------------------------------------------------------- easy bot

function isAttackedBy(b: FastBoard, sq: number, attacker: number): boolean {
  for (let i = 0; i < b.n; i++) {
    const s = b.sq[i];
    if (s < 0 || b.owner[i] !== attacker) continue;
    const n = genTargets(b.occ, b.owner, attacker, b.ch[i], b.lvl[i], s, attackBuf, 0, false, b.dir[i]);
    for (let k = 0; k < n; k++) if (attackBuf[k] === sq) return true;
  }
  return false;
}

function chooseEasy(b: FastBoard, rng: () => number): number {
  const side = b.turn;
  const buf = new Int32Array(MAX_MOVES);
  const n = fastGenMoves(b, side, buf, 0);
  const moves = Array.from(buf.subarray(0, n));
  const pick = (arr: number[]) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
  const safeAfter = (mv: number) => {
    const undo = fastMake(b, mv);
    const safe = !isAttackedBy(b, mv & 255, 1 - side);
    fastUnmake(b, mv, undo);
    return safe;
  };
  const captures = moves.filter((mv) => b.occ[mv & 255] >= 0);
  if (captures.length) {
    const free = captures.filter(
      (mv) => b.value[b.occ[mv & 255]] >= b.value[mv >> 8] || safeAfter(mv),
    );
    if (free.length && rng() < 0.9) {
      free.sort((a, c) => b.value[b.occ[c & 255]] - b.value[b.occ[a & 255]]);
      return free[0];
    }
    if (rng() < 0.4) return pick(captures);
  }
  if (rng() < 0.5) {
    const safe = moves.filter(safeAfter);
    if (safe.length) return pick(safe);
  }
  return pick(moves);
}

// ---------------------------------------------------------------- public API

/** Pick a move for `state.turn`. Returns null only if there is no legal move (or the game ended). */
export function chooseMove(state: GameState, difficulty: Difficulty, opts: ChooseMoveOptions = {}): Move | null {
  if (state.status !== 'playing') return null;
  const legal = getLegalMoves(state);
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];
  const rng = opts.rng ?? Math.random;
  const budget = Math.max(1, Math.min(opts.timeBudgetMs ?? DEFAULT_BUDGET[difficulty], HARD_CAP_MS));
  const start = now();
  const b = fastFromState(state);
  let mv: number;
  if (difficulty === 'easy') {
    mv = chooseEasy(b, rng);
  } else if (difficulty === 'normal') {
    mv = searchRoot(b, state.pliesSinceCapture, 2 + (rng() < 0.5 ? 1 : 0), start + budget, rng, 25).move;
  } else {
    mv = searchRoot(b, state.pliesSinceCapture, MAX_PLY - 4, start + budget, rng, 4).move;
  }
  const move = fastMoveToMove(b, mv);
  // Safety net: always return something the engine accepts.
  const ok = legal.find(
    (m) => m.pieceId === move.pieceId && m.to.r === move.to.r && m.to.c === move.to.c,
  );
  return ok ?? legal[0];
}
