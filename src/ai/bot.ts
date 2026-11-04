import type { GameState, Move, SkillAction } from '../engine/types';
import {
  N_SQUARES,
  fastFromState,
  fastGenMoves,
  fastHasMoves,
  fastMake,
  fastMoveToMove,
  fastPass,
  fastSkillToAction,
  fastUnmake,
  fastUnpass,
  genTargets,
  getLegalMoves,
  isLegalSkill,
  skillAnchors,
} from '../engine';
import type { FastBoard } from '../engine';
import { SKILL_FLAG, fastCanSkill, fastHopGain, fastSkillFits, fastSkillSize } from '../engine/fast';
import { CHARACTERS, CHAR_BY_CODE, CH_BRUTILE, CH_INSANER, CH_MARKI, CH_MICHELLE, CH_PICKER, CH_RAKAELI, CH_SAD, CH_WALK, N_CHARS } from '../engine/characters';
import { trapBit } from '../engine/board';
import { BOARD_SIZE, TRAPS_PER_MICHELLE } from '../engine/types';

/** Bot strength. `extreme` (극악) is the dungeon's top tier and the AI of the top arena. */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'extreme'];

/** What the bot plays: a move, or a skill (Brutile's wasteland, Rakaeli's transform). */
export type BotAction = Move | SkillAction;

export function isSkillAction(a: BotAction | null | undefined): a is SkillAction {
  return !!a && (a as SkillAction).kind === 'skill';
}

export interface ChooseMoveOptions {
  timeBudgetMs?: number;
  rng?: () => number;
}

/**
 * Absolute safety cap on thinking time, regardless of the requested budget. The shortest turn is
 * TURN_TIME_1_MS (20 s) and a timeout forfeits, so the bot stays far below it even on slow phones
 * (the deadline is checked every 1024 nodes and no new iteration starts past 55% of the budget).
 */
const HARD_CAP_MS = 1400;
/**
 * Strength per difficulty. THIS TABLE IS THE ONLY PLACE THE BOT IS TUNED (the owner tunes it):
 *  - easy:    mostly a heuristic picker (free captures, otherwise a random non-suicidal move, often
 *             leaving pieces hanging); sometimes a 1-ply search with a large random bias.
 *  - normal:  a 2-3 ply search with a moderate random bias and an occasional casual move.
 *  - hard:    iterative deepening to the full budget, tiny random bias, no deliberate blunders.
 *  - extreme: (극악) like hard with the largest budget (capped by HARD_CAP_MS), no random bias and
 *             more wasteland anchors considered at the root.
 */
interface Strength {
  budgetMs: number;
  /** Max iterative-deepening depth (a random +1 with `extraDepthChance`). */
  depth: number;
  extraDepthChance: number;
  /** Max random bonus per root move (score units: 100 = one material point). */
  jitter: number;
  /** Chance to play the heuristic easy move instead of searching. */
  casualChance: number;
  /** How many wasteland anchors are searched at the root. */
  skillCands: number;
}
const STRENGTH: Record<Difficulty, Strength> = {
  easy: { budgetMs: 60, depth: 1, extraDepthChance: 0, jitter: 90, casualChance: 0.65, skillCands: 2 },
  normal: { budgetMs: 350, depth: 2, extraDepthChance: 0.5, jitter: 25, casualChance: 0.08, skillCands: 6 },
  hard: { budgetMs: 1000, depth: 60 /* MAX_PLY - 4 */, extraDepthChance: 0, jitter: 4, casualChance: 0, skillCands: 10 },
  extreme: { budgetMs: 1350, depth: 60 /* MAX_PLY - 4 */, extraDepthChance: 0, jitter: 0, casualChance: 0, skillCands: 16 },
};

const WIN = 1_000_000;
const ADJ_WIN = 500_000; // won by adjudication (ply limit / stalemate)
const INF = 10_000_000;
const MAX_PLY = 64;
const MAX_MOVES = 128;
const UNIT = 100; // material unit
/** Eval bonus for holding an unused wasteland, by Brutile's level (index = level). */
const SKILL_POTENTIAL = [0, 15, 25, 35];
/**
 * Rakaeli's transform. An unused one is worth TRANSFORM_POTENTIAL (by level) while it can still be
 * cast; a transformed Rakaeli is worth AWAKE_BONUS per transformed move left, on top of the wider
 * reach the attack maps already credit. The potential is above the bonus of a fresh transform, so
 * casting only pays when the search finds captures or threats within the two transformed moves.
 */
const TRANSFORM_POTENTIAL = [0, 20, 30, 40];
const AWAKE_BONUS = [0, 8, 12, 16];
/** Transform candidates need at least this score (see `transformScore`) to be searched at the root. */
const TRANSFORM_MIN_SCORE = 1;
/** Eval bonus per doll trap Michelle can still lay (they are laid by backing off, so modest). */
const TRAP_POTENTIAL = 8;
/** Eval bonus per own doll trap on the board within two squares of an enemy piece (area denial). */
const TRAP_NEAR_ENEMY = 6;
/** A stunned piece sits out its next turn: a share of its value (its threats are already gone). */
const STUN_PENALTY = 0.12;
/** Move-ordering penalty for ending on an enemy doll trap (the mover loses its next turn). */
const TRAP_LANDING_ORDER = -400;
/** Material worth (in UNIT) of each absorbable pattern bit: half of the pattern owner's value. */
const BIT_VALUE: number[] = [];
for (let bit = 0; bit < N_CHARS * 3; bit++) BIT_VALUE.push((CHARACTERS[CHAR_BY_CODE[(bit / 3) | 0]].value[bit % 3] * UNIT) / 2);
function absorbWorth(mask: number): number {
  let w = 0;
  for (let bit = 0; mask; bit++, mask >>= 1) if (mask & 1) w += BIT_VALUE[bit];
  return w;
}

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

// ---------------------------------------------------------------- evaluation

/** Last row / column index, and the board's centre line (4.5 on 10 x 10). */
const LAST = BOARD_SIZE - 1;
const MID = LAST / 2;

const attackBuf = new Int32Array(MAX_MOVES);
/** attackCount[side * N_SQUARES + sq], minAttacker[side * N_SQUARES + sq] */
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
    // A stunned piece neither threatens nor defends anything on its owner's next turn.
    if (s < 0 || b.stun[i] > 0) continue;
    const side = b.owner[i];
    const n = genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, attackBuf, 0, true, b.dir[i], b.storm, b.absorb[i], b.waste, b.trap, b.awaken[i] > 0);
    const v = b.value[i];
    for (let k = 0; k < n; k++) {
      const t = attackBuf[k];
      if (b.waste[t]) continue; // suicide squares are neither mobility nor control
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
    const r = (s / BOARD_SIZE) | 0;
    const c = s - r * BOARD_SIZE;
    let sc = v;
    const dir = b.dir[i];
    const room = dir > 0 ? LAST - r : r; // rows left in front of the piece (it turns around at 0)
    // Facing the enemy side is worth more than walking back home after a turn-around.
    const facingEnemy = dir === (p === 0 ? 1 : -1);
    const centerC = MID - Math.abs(c - MID); // 0.5..4.5 on 10 columns
    const centerR = MID - Math.abs(r - MID);
    const ch = b.ch[i];
    if (ch === CH_SAD) {
      sc += centerC * 3 + centerR * 2;
    } else if (ch === CH_INSANER) {
      sc += centerC * 4 + centerR * 2 + absorbWorth(b.absorb[i]);
    } else if (ch === CH_MARKI) {
      if (!facingEnemy) sc -= v * 0.2;
      {
        // free squares straight ahead (blocked by ally = less potential)
        let free = 0;
        const dr = dir > 0 ? BOARD_SIZE : -BOARD_SIZE;
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
    } else if (ch === CH_BRUTILE) {
      // Weak mover (1-star only steps diagonally forward): keep her safe and central.
      if (!facingEnemy && b.lvl[i] === 1) sc -= v * 0.15;
      sc += centerC * 3 + Math.min(room, 6);
      // An unused wasteland is worth keeping until it wins something (before the storm closes in).
      if (b.storm === 0 && b.used[i] === 0) sc += SKILL_POTENTIAL[b.lvl[i]];
    } else if (ch === CH_MICHELLE) {
      // Sideways / backward mover: central files, and unspent traps are worth a little.
      sc += centerC * 3 + Math.min(room, 6);
      sc += (TRAPS_PER_MICHELLE - b.trapsLaid[p]) * TRAP_POTENTIAL;
    } else if (ch === CH_PICKER) {
      // Diagonal hopper: centre and room in front give him the most hop lanes.
      sc += centerC * 4 + centerR * 2;
    } else if (ch === CH_RAKAELI) {
      // Forward jumper like Walk; transformed he is worth more while it lasts.
      if (!facingEnemy) sc -= v * 0.2;
      sc += centerC * 4 + Math.min(room, 6) * 2;
      if (b.awaken[i] > 0) sc += AWAKE_BONUS[b.lvl[i]] * b.awaken[i];
      else if (b.storm === 0 && b.used[i] === 0) sc += TRANSFORM_POTENTIAL[b.lvl[i]];
    }
    if (b.stun[i] > 0) sc -= v * STUN_PENALTY;
    // storm: standing next to (or on) the columns that vanish next is a liability
    if (b.stormIn >= 0) {
      const dist = Math.min(c - b.storm, LAST - b.storm - c);
      const urgency = b.stormIn <= 2 ? 1 : 0.5;
      if (dist <= 0) sc -= v * 0.6 * urgency;
      else if (dist === 1) sc -= v * 0.25 * urgency;
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
  // Doll traps close to enemy pieces restrict where they can safely land.
  if (b.trapsLaid[0] > 0 || b.trapsLaid[1] > 0) {
    for (let t = 0; t < N_SQUARES; t++) {
      const m = b.trap[t];
      if (m === 0) continue;
      const tr = (t / BOARD_SIZE) | 0;
      const tc = t - tr * BOARD_SIZE;
      for (let i = 0; i < b.n; i++) {
        const q = b.sq[i];
        if (q < 0) continue;
        const enemyOf = 1 - b.owner[i];
        if (!(m & trapBit(enemyOf))) continue;
        const qr = (q / BOARD_SIZE) | 0;
        if (Math.abs(qr - tr) <= 2 && Math.abs(q - qr * BOARD_SIZE - tc) <= 2) score[enemyOf] += TRAP_NEAR_ENEMY;
      }
    }
  }
  return score[side] - score[1 - side];
}

function adjudicateScore(b: FastBoard, side: number, ply: number): number {
  const d = b.material[side] - b.material[1 - side];
  if (d > 0) return ADJ_WIN - ply;
  if (d < 0) return -ADJ_WIN + ply;
  return 0;
}

/** Both sides' last pieces were swallowed by the same storm: decided by the material lost. */
function wipeScore(b: FastBoard, side: number, ply: number): number {
  const d = side === 0 ? b.wipe : -b.wipe;
  return d > 0 ? ADJ_WIN - ply : d < 0 ? -ADJ_WIN + ply : 0;
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
    const to = mv & 255;
    const pi = mv >> 8;
    const cap = b.occ[to];
    const gain = (cap >= 0 ? b.value[cap] : 0) + fastHopGain(b, pi, to);
    if (b.waste[to]) scores[k] = gain > 0 ? gain * 100 - 10000 : -10000; // suicide: search last
    else if (gain > 0) scores[k] = 10000 + gain * 100 - b.value[pi];
    else scores[k] = mv === killer ? 5000 : 0;
    if (b.trap[to] & trapBit(1 - b.owner[pi])) scores[k] += TRAP_LANDING_ORDER;
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

function qsearch(ctx: SearchCtx, alpha: number, beta: number, ply: number, qd: number): number {
  checkTime(ctx);
  const b = ctx.b;
  const side = b.turn;
  if (b.alive[side] === 0) return b.alive[1 - side] === 0 ? wipeScore(b, side, ply) : -WIN + ply;
  if (b.alive[1 - side] === 0) return WIN - ply;
  const stand = evaluate(b, side);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (qd <= 0 || ply >= MAX_PLY) return alpha;
  const moves = ctx.moveBufs[ply];
  const scores = ctx.scoreBufs[ply];
  const all = fastGenMoves(b, side, moves, 0);
  let n = 0;
  for (let k = 0; k < all; k++) {
    const mv = moves[k];
    if (b.occ[mv & 255] >= 0 || fastHopGain(b, mv >> 8, mv & 255) > 0) moves[n++] = mv;
  }
  if (n === 0) return alpha;
  orderMoves(ctx, moves, scores, n, ply);
  for (let k = 0; k < n; k++) {
    const mv = moves[k];
    const undo = fastMake(b, mv);
    let v: number;
    try {
      // A chain move keeps the same side on move: no negation, same window.
      v = b.turn === side ? qsearch(ctx, alpha, beta, ply + 1, qd - 1) : -qsearch(ctx, -beta, -alpha, ply + 1, qd - 1);
    } finally {
      fastUnmake(b, mv, undo);
    }
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function negamax(ctx: SearchCtx, depth: number, alpha: number, beta: number, ply: number): number {
  checkTime(ctx);
  const b = ctx.b;
  const side = b.turn;
  if (b.alive[side] === 0) return b.alive[1 - side] === 0 ? wipeScore(b, side, ply) : -WIN + ply;
  if (b.alive[1 - side] === 0) return WIN - ply;
  if (depth <= 0 || ply >= MAX_PLY) return qsearch(ctx, alpha, beta, ply, 6);
  const moves = ctx.moveBufs[ply];
  const scores = ctx.scoreBufs[ply];
  const n = fastGenMoves(b, side, moves, 0);
  if (n === 0) {
    // No move (or a boxed-in chain move): the turn passes, exactly like the engine's auto-pass.
    // Stuns wear off, so it is only a stalemate when neither side could move even without them.
    if (b.bonus < 0 && !fastHasMoves(b, side, true) && !fastHasMoves(b, 1 - side, true)) return adjudicateScore(b, side, ply);
    fastPass(b);
    try {
      return -negamax(ctx, depth - 1, -beta, -alpha, ply + 1);
    } finally {
      fastUnpass(b);
    }
  }
  orderMoves(ctx, moves, scores, n, ply);
  let best = -INF;
  for (let k = 0; k < n; k++) {
    const mv = moves[k];
    const isCap = b.occ[mv & 255] >= 0 || fastHopGain(b, mv >> 8, mv & 255) > 0;
    const undo = fastMake(b, mv);
    let v: number;
    try {
      v = b.turn === side ? negamax(ctx, depth - 1, alpha, beta, ply + 1) : -negamax(ctx, depth - 1, -beta, -alpha, ply + 1);
    } finally {
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
  skills: number[],
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
    if (mv & SKILL_FLAG) return 0;
    const cap = b.occ[mv & 255];
    const gain = (cap >= 0 ? b.value[cap] : 0) + fastHopGain(b, mv >> 8, mv & 255);
    return gain > 0 ? 1000 + gain * 10 - b.value[mv >> 8] : 0;
  };
  moves.sort((a, c) => capScore(c) - capScore(a));
  // Wasteland candidates are searched like moves (only at the root); suicide moves go last.
  for (const sk of skills) moves.push(sk);
  moves.sort((a, c) => (b.waste[a & 255] && !(a & SKILL_FLAG) ? 1 : 0) - (b.waste[c & 255] && !(c & SKILL_FLAG) ? 1 : 0));
  const bonus = moves.map(() => Math.floor(rng() * (jitter + 1)));
  let result: RootResult = { move: moves[0], score: 0, depth: 0 };
  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INF;
    let bestIdx = -1;
    let completed = true;
    try {
      for (let k = 0; k < moves.length; k++) {
        const mv = moves[k];
        const undo = fastMake(b, mv);
        let v: number;
        try {
          v = b.turn === side ? negamax(ctx, depth - 1, alpha - bonus[k], INF, 1) : -negamax(ctx, depth - 1, -INF, -(alpha - bonus[k]), 1);
        } finally {
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

// ---------------------------------------------------------------- skills (Brutile, Rakaeli)

const transformBuf = new Int32Array(MAX_MOVES);
const transformBuf2 = new Int32Array(MAX_MOVES);

/**
 * How promising Rakaeli's transform is right now: enemies inside his transformed reach (a capture
 * on his first transformed move: 3 each) plus enemies one more transformed jump away from an empty
 * square of it (a threat within the two moves: 1 each). 0 = nothing to gain from casting now.
 */
function transformScore(b: FastBoard, i: number): number {
  const side = b.owner[i];
  const s = b.sq[i];
  const n = genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, transformBuf, 0, false, b.dir[i], b.storm, b.absorb[i], b.waste, b.trap, true);
  let score = 0;
  for (let k = 0; k < n; k++) {
    const t = transformBuf[k];
    if (b.waste[t]) continue;
    if (b.occ[t] >= 0) {
      score += 3;
      continue;
    }
    // A second transformed jump from t (the piece is lifted off s for it).
    b.occ[s] = -1;
    const m = genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], t, transformBuf2, 0, false, b.dir[i], b.storm, b.absorb[i], b.waste, b.trap, true);
    b.occ[s] = i;
    for (let q = 0; q < m; q++) if (b.occ[transformBuf2[q]] >= 0 && !b.waste[transformBuf2[q]]) score += 1;
  }
  return score;
}

/**
 * Up to `max` promising skill casts for the side to move, encoded as root moves: Brutile's
 * wasteland anchors and, when it can create captures or threats, Rakaeli's transform (anchor = his
 * own square; it does not count toward `max`). Wasteland areas are scored by how much enemy reach
 * they cover and how close they sit to enemy pieces (where they trap or block), minus the player's
 * own reach they would spoil. The best candidate comes first.
 */
function skillCandidates(b: FastBoard, max: number): number[] {
  const out: { mv: number; score: number }[] = [];
  for (let i = 0; i < b.n; i++) {
    if (!fastCanSkill(b, i)) continue;
    if (b.ch[i] === CH_RAKAELI) {
      const score = transformScore(b, i);
      if (score >= TRANSFORM_MIN_SCORE) out.push({ mv: SKILL_FLAG | (i << 8) | b.sq[i], score });
    } else for (const c of wasteCandidates(b, i, max)) out.push(c);
  }
  out.sort((x, y) => y.score - x.score);
  return out.map((x) => x.mv);
}

/** Up to `max` scored wasteland anchors for Brutile `caster` (see `skillCandidates`). */
function wasteCandidates(b: FastBoard, caster: number, max: number): { mv: number; score: number }[] {
  const side = b.turn;
  buildAttackMaps(b);
  const enemy = 1 - side;
  const k = fastSkillSize(b, caster);
  const cands: { mv: number; score: number }[] = [];
  for (let anchor = 0; anchor < N_SQUARES; anchor++) {
    if (!fastSkillFits(b, k, anchor)) continue;
    const r0 = (anchor / BOARD_SIZE) | 0;
    const c0 = anchor - r0 * BOARD_SIZE;
    let score = 0;
    for (let r = r0; r < r0 + k; r++) {
      for (let c = c0; c < c0 + k; c++) {
        const s = r * BOARD_SIZE + c;
        if (b.waste[s]) continue;
        score += attackCount[enemy * N_SQUARES + s] * 3 - attackCount[side * N_SQUARES + s] * 2;
        for (let i = 0; i < b.n; i++) {
          const q = b.sq[i];
          if (q < 0 || b.owner[i] !== enemy) continue;
          const qr = (q / BOARD_SIZE) | 0;
          if (Math.abs(qr - r) <= 1 && Math.abs(q - qr * BOARD_SIZE - c) <= 1) score += 2;
        }
      }
    }
    if (score > 0) cands.push({ mv: SKILL_FLAG | (caster << 8) | anchor, score });
  }
  cands.sort((x, y) => y.score - x.score);
  return cands.slice(0, max);
}

// ---------------------------------------------------------------- easy bot

function isAttackedBy(b: FastBoard, sq: number, attacker: number): boolean {
  for (let i = 0; i < b.n; i++) {
    const s = b.sq[i];
    if (s < 0 || b.owner[i] !== attacker || b.stun[i] > 0) continue;
    const n = genTargets(b.occ, b.owner, attacker, b.ch[i], b.lvl[i], s, attackBuf, 0, false, b.dir[i], b.storm, b.absorb[i], b.waste, b.trap, b.awaken[i] > 0);
    for (let k = 0; k < n; k++) if (attackBuf[k] === sq) return true;
  }
  return false;
}

function chooseEasy(b: FastBoard, rng: () => number, allowSkill = true): number {
  // Sometimes cast the most obvious skill (the best wasteland spot, or a promising transform).
  const sk = allowSkill ? skillCandidates(b, 1) : [];
  if (sk.length && rng() < 0.25) return sk[0];
  const side = b.turn;
  const buf = new Int32Array(MAX_MOVES);
  const n = fastGenMoves(b, side, buf, 0);
  // Never walk into wasteland unless nothing else is left.
  const all = Array.from(buf.subarray(0, n));
  const safeMoves = all.filter((mv) => !b.waste[mv & 255]);
  const moves = safeMoves.length ? safeMoves : all;
  const pick = (arr: number[]) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
  const safeAfter = (mv: number) => {
    const undo = fastMake(b, mv);
    const safe = !isAttackedBy(b, mv & 255, 1 - side);
    fastUnmake(b, mv, undo);
    return safe;
  };
  const gainOf = (mv: number) => {
    const cap = b.occ[mv & 255];
    return (cap >= 0 ? b.value[cap] : 0) + fastHopGain(b, mv >> 8, mv & 255);
  };
  const captures = moves.filter((mv) => gainOf(mv) > 0);
  if (captures.length) {
    const free = captures.filter((mv) => gainOf(mv) >= b.value[mv >> 8] || safeAfter(mv));
    if (free.length && rng() < 0.9) {
      free.sort((a, c) => gainOf(c) - gainOf(a));
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

/**
 * Pick an action for `state.turn`: a move or (with `allowSkill`, the default) a skill.
 * Returns null only if there is nothing to play (no legal move; the engine auto-passes).
 */
export function chooseAction(state: GameState, difficulty: Difficulty, opts: ChooseMoveOptions & { allowSkill?: boolean } = {}): BotAction | null {
  if (state.status !== 'playing') return null;
  const legal = getLegalMoves(state);
  if (legal.length === 0) {
    // No move at all, but the engine did not pass: the wasteland is the only thing left to play.
    if (opts.allowSkill === false) return null;
    const caster = state.pieces.find((p) => p.owner === state.turn && skillAnchors(state, p.id).length > 0);
    if (!caster) return null;
    const best = skillCandidates(fastFromState(state), 1);
    const b0 = fastFromState(state);
    return best.length ? fastSkillToAction(b0, best[0]) : { kind: 'skill', pieceId: caster.id, anchor: skillAnchors(state, caster.id)[0] };
  }
  const rng = opts.rng ?? Math.random;
  const st = STRENGTH[difficulty] ?? STRENGTH.normal;
  const budget = Math.max(1, Math.min(opts.timeBudgetMs ?? st.budgetMs, HARD_CAP_MS));
  const start = now();
  const b = fastFromState(state);
  const skills = opts.allowSkill === false ? [] : skillCandidates(b, st.skillCands);
  if (legal.length === 1 && skills.length === 0) return legal[0];
  let mv: number;
  if (st.casualChance > 0 && rng() < st.casualChance) {
    mv = chooseEasy(b, rng, opts.allowSkill !== false);
  } else {
    const depth = st.depth + (st.extraDepthChance > 0 && rng() < st.extraDepthChance ? 1 : 0);
    mv = searchRoot(b, skills, depth, start + budget, rng, st.jitter).move;
  }
  if (mv !== undefined && mv & SKILL_FLAG) {
    const action = fastSkillToAction(b, mv);
    if (isLegalSkill(state, action)) return action;
    return safeFirst(state, legal);
  }
  if (mv === undefined) return safeFirst(state, legal);
  const move = fastMoveToMove(b, mv);
  // Safety net: always return something the engine accepts.
  const ok = legal.find((m) => m.pieceId === move.pieceId && m.to.r === move.to.r && m.to.c === move.to.c);
  return ok ?? safeFirst(state, legal);
}

/** The first legal move that does not step onto wasteland (any move if all of them do). */
function safeFirst(state: GameState, legal: Move[]): Move {
  return legal.find((m) => !state.waste.includes(m.to.r * BOARD_SIZE + m.to.c)) ?? legal[0];
}

/** Pick a MOVE for `state.turn` (never the skill). Returns null only if there is no legal move. */
export function chooseMove(state: GameState, difficulty: Difficulty, opts: ChooseMoveOptions = {}): Move | null {
  const a = chooseAction(state, difficulty, { ...opts, allowSkill: false });
  return a && !isSkillAction(a) ? a : null;
}

/**
 * A cheap, always-legal action for the side to move, for when the real bot failed or ran late:
 * a quick easy-level pick, else the first move that does not step onto wasteland, else any move,
 * else the wasteland (the only thing left). Null only when nothing can be played at all.
 */
export function fallbackAction(state: GameState): BotAction | null {
  if (state.status !== 'playing') return null;
  try {
    const a = chooseAction(state, 'easy', { timeBudgetMs: 20 });
    if (a) return a;
  } catch {
    /* fall through to the plain picks */
  }
  const legal = getLegalMoves(state);
  if (legal.length) return safeFirst(state, legal);
  for (const p of state.pieces) {
    if (p.owner !== state.turn) continue;
    const anchors = skillAnchors(state, p.id);
    if (anchors.length) return { kind: 'skill', pieceId: p.id, anchor: anchors[0] };
  }
  return null;
}
