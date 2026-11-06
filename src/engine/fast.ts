/**
 * Lightweight mutable board for search (AI). Not part of GameState; never posted anywhere.
 * Moves are encoded as integers: (pieceIndex << 8) | toSquare.
 * Undo tokens: ((capturedIndex + 1) << 8) | fromSquare (+ bit 16 when the mover turned around).
 * Everything else a move changes (turn, chain move, absorbed abilities, storm clock and storm
 * kills) is pushed on an internal LIFO history so make/unmake stay exact.
 * Skill actions are encoded as SKILL_FLAG | (pieceIndex << 8) | anchorSquare: Brutile's wasteland
 * (anchor = the area's lowest corner), Rakaeli's transform (anchor = his own square; it sets
 * `awaken`, which counts down at the end of each of its owner's turns like `stun`) or Volkonov's
 * melody (anchor = his own square; it sets `buff` on every other piece of his side, counted down
 * the same way) or Midos's teleport (anchor = the free square he blinks to, see `fastBlinkFits`).
 * A move whose target is wasteland destroys the mover (WASTE_BIT in the undo token).
 * Picker's hop-through captures the enemies on its path too (a real Picker only: an Insaner's
 * absorbed Picker pattern is a plain slide), Michelle's backward moves lay doll
 * traps and a mover ending on an enemy trap is stunned: all of it is undone from the LIFO history.
 */
import { AWAKEN_TURNS, BOARD_SIZE, BUFF_TURNS, SKILL_UNLOCK_PLY, STORM_INTERVAL_PLIES, SUDDEN_DEATH_PLY, TRAPS_PER_MICHELLE, TRAP_STUN } from './types';
import type { CharacterId, GameState, Move, PlayerId, SkillAction } from './types';
import { CHARACTERS, CHAR_BY_CODE, CHAR_CODE, CH_BRUTILE, CH_INSANER, CH_MICHELLE, CH_MIDOS, CH_RAKAELI, CH_VOLKONOV, WASTE_SIZE, abilityBit, absorbMaskOf, absorbMerge, absorbWithout, keepsDirection } from './characters';
import { N_SQUARES, atTurnRow, canHop, genTargets, inStorm, posOf, sqOf, trapBit } from './board';
import { pieceDir } from './rules';

export interface FastBoard {
  n: number;
  ids: string[];
  sq: Int16Array; // -1 = captured / killed
  owner: Uint8Array;
  ch: Uint8Array;
  lvl: Uint8Array;
  dir: Int8Array; // current forward direction per piece (+1 / -1)
  absorb: Uint32Array; // absorbed patterns per piece (see abilityBit / absorbMerge; N_CHARS * 2 bits)
  stun: Int8Array; // doll-trap stun per piece (owner turns left to sit out, see Piece.stun)
  awaken: Int8Array; // Rakaeli's transform per piece (owner turns left, see Piece.awaken)
  buff: Int8Array; // Volkonov's melody on this piece (owner turns left, see Piece.buff)
  used: Uint8Array; // 1 once the piece has used its skill this match (Piece.skillUsed)
  value: Int16Array; // base material value of each piece
  occ: Int8Array; // piece index or -1
  alive: Int16Array; // [count0, count1]
  material: Int16Array; // [mat0, mat1]
  turn: PlayerId;
  /** Piece index that must play a pending chain move, or -1. */
  bonus: number;
  /** Storm step: columns per side (and, from STORM_ROWS_FROM, rows per end: `stormRows`). */
  storm: number;
  /** Turn changes until the storm advances; -1 while inactive. */
  stormIn: number;
  /** Plies played (drives sudden death). */
  ply: number;
  /**
   * Piece-count difference (side 0 minus side 1) right before the storm step that last killed
   * something: when that step swallowed both sides' last pieces, its sign decides the game (more
   * pieces wins, 0 = draw; rarity and grade do not count).
   */
  wipe: number;
  /** Wasteland flags per square. */
  waste: Uint8Array;
  /** Skill uses per side (a count; whether a piece may cast is `used`). */
  skills: Int8Array;
  /** Doll-trap masks per square (bit `trapBit(owner)`). */
  trap: Uint8Array;
  /** Traps laid so far per side (Michelle lays at most TRAPS_PER_MICHELLE). */
  trapsLaid: Int8Array;
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
    absorb: new Uint32Array(n),
    stun: new Int8Array(n),
    awaken: new Int8Array(n),
    buff: new Int8Array(n),
    used: new Uint8Array(n),
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
    waste: new Uint8Array(N_SQUARES),
    skills: Int8Array.from(state.skillsUsed ?? [0, 0]),
    trap: new Uint8Array(N_SQUARES),
    trapsLaid: Int8Array.from(state.trapsLaid ?? [0, 0]),
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
    b.stun[i] = p.stun ?? 0;
    b.awaken[i] = p.awaken ?? 0;
    b.buff[i] = p.buff ?? 0;
    b.used[i] = p.skillUsed ? 1 : 0;
    b.value[i] = CHARACTERS[p.character].value[p.level - 1];
    b.occ[s] = i;
    b.alive[p.owner]++;
    b.material[p.owner] += b.value[i];
    if (state.bonusPieceId === p.id) b.bonus = i;
  });
  for (const s of state.waste ?? []) b.waste[s] = 1;
  for (const t of state.traps ?? []) b.trap[t.sq] |= trapBit(t.owner);
  return b;
}

/** Encoded skill action flag (see the file header). */
export const SKILL_FLAG = 1 << 20;

/** Does piece `i` have another piece of its side on the board (someone for Volkonov to buff)? */
function hasAlly(b: FastBoard, i: number): boolean {
  return b.alive[b.owner[i]] > 1;
}

/**
 * Can piece `i` cast its skill now (Brutile's wasteland, Rakaeli's transform, Volkonov's melody or
 * Midos's teleport: side to move, unlocked, not used by this piece, not transformed already, not
 * stunned, storm not closing; Volkonov needs an ally on the board)? Brutile and Midos still need a
 * free anchor (`fastSkillFits` / `fastBlinkFits`).
 */
export function fastCanSkill(b: FastBoard, i: number): boolean {
  const ch = b.ch[i];
  return (
    (ch === CH_BRUTILE || ch === CH_RAKAELI || ch === CH_MIDOS || (ch === CH_VOLKONOV && hasAlly(b, i))) &&
    b.sq[i] >= 0 &&
    b.stun[i] === 0 &&
    b.awaken[i] === 0 &&
    b.used[i] === 0 &&
    b.owner[i] === b.turn &&
    b.bonus < 0 &&
    b.storm === 0 &&
    b.ply >= SKILL_UNLOCK_PLY
  );
}

/**
 * Is the k x k area with lowest corner `anchor` on the board, free of pieces and out of the storm?
 * (Skills are forbidden once the storm has closed in at all, so the storm check is a safety net.)
 */
export function fastSkillFits(b: FastBoard, k: number, anchor: number): boolean {
  const r0 = (anchor / BOARD_SIZE) | 0;
  const c0 = anchor - r0 * BOARD_SIZE;
  if (r0 + k > BOARD_SIZE || c0 + k > BOARD_SIZE) return false;
  for (let r = r0; r < r0 + k; r++) for (let c = c0; c < c0 + k; c++) if (b.occ[r * BOARD_SIZE + c] >= 0 || inStorm(r, c, b.storm)) return false;
  return true;
}

/**
 * May a Midos of side `own` teleport to square `s`? No piece, no wasteland, no doll trap of the other
 * side, out of the storm. Mirrors `blinkAnchors` in rules.ts.
 */
export function fastBlinkFits(b: FastBoard, own: number, s: number): boolean {
  if (b.occ[s] >= 0 || b.waste[s] || b.trap[s] & trapBit(1 - own)) return false;
  const r = (s / BOARD_SIZE) | 0;
  return !inStorm(r, s - r * BOARD_SIZE, b.storm);
}

/** Wasteland side length for piece `i`. */
export function fastSkillSize(b: FastBoard, i: number): number {
  return WASTE_SIZE[b.lvl[i]];
}

/**
 * Generate all legal moves for `side` into `out` starting at `n` (chain move: only that piece;
 * stunned pieces have none).
 */
export function fastGenMoves(b: FastBoard, side: number, out: Int32Array, n = 0): number {
  for (let i = 0; i < b.n; i++) {
    const s = b.sq[i];
    if (s < 0 || b.owner[i] !== side || b.stun[i] > 0) continue;
    if (b.bonus >= 0 && i !== b.bonus) continue;
    const start = n;
    n = genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, out, n, false, b.dir[i], b.storm, b.absorb[i], b.waste, b.trap, b.awaken[i] > 0, b.buff[i] > 0);
    const hi = i << 8;
    for (let k = start; k < n; k++) out[k] |= hi;
  }
  return n;
}

const scratch = new Int32Array(128);

/** Does `side` have a move? `ignoreStun`: would it have one once its stuns wear off. */
export function fastHasMoves(b: FastBoard, side: number, ignoreStun = false): boolean {
  for (let i = 0; i < b.n; i++) {
    const s = b.sq[i];
    if (s < 0 || b.owner[i] !== side) continue;
    if (!ignoreStun && b.stun[i] > 0) continue;
    if (b.bonus >= 0 && i !== b.bonus) continue;
    if (genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, scratch, 0, false, b.dir[i], b.storm, b.absorb[i], b.waste, b.trap, b.awaken[i] > 0, b.buff[i] > 0) > 0) return true;
  }
  return false;
}

/**
 * Engine rule 'immobile': the side to move LOSES when it has no legal action, i.e. no move and no
 * castable skill even once its doll-trap stuns wear off (a stun alone only passes). A boxed-in chain
 * move just lapses: never a loss. Mirrors `settle` / `sideCanCast(.., ignoreStun)` in rules.ts.
 */
export function fastImmobile(b: FastBoard): boolean {
  if (b.bonus >= 0 || fastHasMoves(b, b.turn, true)) return false;
  // Could a skill piece cast once its stun wears off? (Skills are sealed once the storm closes in.)
  if (b.storm === 0 && b.ply >= SKILL_UNLOCK_PLY) {
    for (let i = 0; i < b.n; i++) {
      if (b.sq[i] < 0 || b.owner[i] !== b.turn || b.used[i] !== 0 || b.awaken[i] !== 0) continue;
      if (b.ch[i] === CH_RAKAELI || (b.ch[i] === CH_VOLKONOV && hasAlly(b, i))) return false;
      if (b.ch[i] === CH_MIDOS) {
        for (let a = 0; a < BOARD_SIZE * BOARD_SIZE; a++) if (fastBlinkFits(b, b.turn, a)) return false;
      }
      if (b.ch[i] === CH_BRUTILE) {
        const k = WASTE_SIZE[b.lvl[i]];
        for (let a = 0; a < BOARD_SIZE * BOARD_SIZE; a++) if (fastSkillFits(b, k, a)) return false;
      }
    }
  }
  return true;
}


/**
 * Straight path of a move of two or more squares (orthogonal or diagonal): its length and the
 * square-index step, or 0 when the move is not such a path. Picker's hops are diagonal, Verish's
 * pierces orthogonal; both capture every enemy strictly between `from` and `to`.
 */
function pathOf(from: number, to: number): number {
  const fr = (from / BOARD_SIZE) | 0;
  const tr = (to / BOARD_SIZE) | 0;
  const dr = tr - fr;
  const dc = to - tr * BOARD_SIZE - (from - fr * BOARD_SIZE);
  const ar = dr < 0 ? -dr : dr;
  const ac = dc < 0 ? -dc : dc;
  if (!(ar === 0 || ac === 0 || ar === ac)) return 0;
  const len = ar > ac ? ar : ac;
  return len >= 2 ? len : 0;
}
function stepOf(from: number, to: number): number {
  const fr = (from / BOARD_SIZE) | 0;
  const tr = (to / BOARD_SIZE) | 0;
  const dc = to - tr * BOARD_SIZE - (from - fr * BOARD_SIZE);
  return (tr > fr ? BOARD_SIZE : tr < fr ? -BOARD_SIZE : 0) + (dc > 0 ? 1 : dc < 0 ? -1 : 0);
}

/**
 * Material (base values) of the enemies piece `pi` would pass on the way to `to` (Picker's
 * hop-through, Verish's pierce; 0 for every other move). Only valid for a legal move, before it is made.
 */
export function fastHopGain(b: FastBoard, pi: number, to: number): number {
  if (!canHop(b.ch[pi])) return 0;
  const from = b.sq[pi];
  const len = pathOf(from, to);
  if (len === 0) return 0;
  const step = stepOf(from, to);
  const own = b.owner[pi];
  let gain = 0;
  for (let k = 1, s = from + step; k < len; k++, s += step) {
    const o = b.occ[s];
    if (o >= 0 && b.owner[o] !== own) gain += b.value[o];
  }
  return gain;
}

const FLIP_BIT = 1 << 16;
const WASTE_BIT = 1 << 17;

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
 * Hand the move to the other side: clears the chain move, ticks the storm (killing pieces on the
 * new storm squares: columns, and rows from step 3) and activates the storm when a side is down to one piece. Pushes its own
 * undo record; `undoSwitch` reverses it.
 */
function switchSide(b: FastBoard): void {
  const oldBonus = b.bonus;
  const oldStorm = b.storm;
  const oldStormIn = b.stormIn;
  // The side whose turn ends: each of its stunned pieces has one owner turn less to sit out, a
  // transformed Rakaeli one transformed turn less and a buffed piece one buffed turn less.
  let stunMask = 0;
  let awakenMask = 0;
  let buffMask = 0;
  for (let i = 0; i < b.n; i++) {
    if (b.owner[i] !== b.turn) continue;
    if (b.stun[i] > 0) {
      b.stun[i]--;
      stunMask |= 1 << i;
    }
    if (b.awaken[i] > 0) {
      b.awaken[i]--;
      awakenMask |= 1 << i;
    }
    if (b.buff[i] > 0) {
      b.buff[i]--;
      buffMask |= 1 << i;
    }
  }
  b.bonus = -1;
  b.turn = (1 - b.turn) as PlayerId;
  let killed = 0;
  const oldWipe = b.wipe;
  // Like the engine: a side that just lost its last piece ends the game, the storm does not tick.
  if (b.stormIn > 0 && b.alive[0] > 0 && b.alive[1] > 0) {
    b.stormIn--;
    if (b.stormIn === 0) {
      b.storm++;
      b.stormIn = STORM_INTERVAL_PLIES;
      for (let i = 0; i < b.n; i++) {
        const s = b.sq[i];
        if (s < 0) continue;
        const r = (s / BOARD_SIZE) | 0;
        if (inStorm(r, s - r * BOARD_SIZE, b.storm)) {
          if (killed === 0) b.wipe = b.alive[0] - b.alive[1];
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
  h[b.histTop++] = stunMask;
  h[b.histTop++] = awakenMask;
  h[b.histTop++] = buffMask;
}

function undoSwitch(b: FastBoard): void {
  const h = b.hist;
  let buffMask = h[--b.histTop];
  let awakenMask = h[--b.histTop];
  let stunMask = h[--b.histTop];
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
  for (let i = 0; stunMask !== 0; i++, stunMask >>>= 1) if (stunMask & 1) b.stun[i]++;
  for (let i = 0; awakenMask !== 0; i++, awakenMask >>>= 1) if (awakenMask & 1) b.awaken[i]++;
  for (let i = 0; buffMask !== 0; i++, buffMask >>>= 1) if (buffMask & 1) b.buff[i]++;
}

/**
 * Applies a move for the side to move, including the turn change (unless the mover earns a chain
 * move), absorption, hop-through captures, doll traps and stuns, storm clock and storm kills.
 * Returns an undo token for `fastUnmake`.
 */
export function fastMake(b: FastBoard, mv: number): number {
  if (mv & SKILL_FLAG) return makeSkill(b, mv);
  const pi = (mv >> 8) & 255;
  const to = mv & 255;
  const from = b.sq[pi];
  const own = b.owner[pi];
  const h = b.hist;
  // Picker's hop-through / Verish's pierce (the real ones only): every enemy between `from` and `to` is captured first.
  let gain = 0;
  let hopN = 0;
  if (canHop(b.ch[pi])) {
    const len = pathOf(from, to);
    if (len > 0) {
      const step = stepOf(from, to);
      for (let k = 1, s = from + step; k < len; k++, s += step) {
        const o = b.occ[s];
        if (o < 0 || b.owner[o] === own) continue;
        gain = absorbMerge(gain, absorbMerge(abilityBit(b.ch[o], b.lvl[o]), b.absorb[o]));
        kill(b, o);
        hopN++;
      }
    }
  }
  h[b.histTop++] = hopN;
  if (b.waste[to]) {
    // Touching wasteland: the mover is destroyed on arrival.
    h[b.histTop++] = -1;
    h[b.histTop++] = 0;
    b.occ[from] = -1;
    b.sq[pi] = -1;
    b.alive[own]--;
    b.material[own] -= b.value[pi];
    const oldBonus = b.bonus;
    const oldStormIn = b.stormIn;
    b.ply++;
    switchSide(b);
    h[b.histTop++] = oldStormIn;
    h[b.histTop++] = b.absorb[pi];
    h[b.histTop++] = oldBonus;
    h[b.histTop++] = 0;
    return WASTE_BIT | from;
  }
  const cap = b.occ[to];
  if (cap >= 0) {
    gain = absorbMerge(gain, absorbMerge(abilityBit(b.ch[cap], b.lvl[cap]), b.absorb[cap]));
    b.sq[cap] = -1;
    b.alive[b.owner[cap]]--;
    b.material[b.owner[cap]] -= b.value[cap];
  }
  b.occ[from] = -1;
  b.occ[to] = pi;
  b.sq[pi] = to;
  let undo = ((cap + 1) << 8) | from;
  // "Backward" is judged with the direction the piece had BEFORE this move (a move that reaches the
  // far edge turns the piece around afterwards).
  const d0 = b.dir[pi];
  if (!keepsDirection(b.ch[pi]) && atTurnRow((to / BOARD_SIZE) | 0, b.dir[pi])) {
    b.dir[pi] = -b.dir[pi];
    undo |= FLIP_BIT;
  }
  // Michelle's backward move leaves a doll trap on `from` (her first TRAPS_PER_MICHELLE ones).
  if (b.ch[pi] === CH_MICHELLE && ((((to / BOARD_SIZE) | 0) - ((from / BOARD_SIZE) | 0)) * d0 < 0) && b.trapsLaid[own] < TRAPS_PER_MICHELLE) {
    h[b.histTop++] = (from << 8) | b.trap[from];
    b.trap[from] |= trapBit(own);
    b.trapsLaid[own]++;
  } else h[b.histTop++] = -1;
  // Ending on an enemy doll trap: stunned for its owner's next turn.
  const caught = (b.trap[to] & trapBit(1 - own)) !== 0;
  if (caught) b.stun[pi] = TRAP_STUN;
  h[b.histTop++] = caught ? 1 : 0;
  const oldAbsorb = b.absorb[pi];
  const oldBonus = b.bonus;
  const oldStormIn = b.stormIn;
  b.ply++;
  let chained = 0;
  if ((cap >= 0 || hopN > 0) && b.ch[pi] === CH_INSANER) {
    b.absorb[pi] = absorbWithout(absorbMerge(b.absorb[pi], gain), b.ch[pi], b.lvl[pi]);
    if (b.lvl[pi] === 3 && b.bonus < 0 && b.alive[1 - b.turn] > 0 && !caught) {
      b.bonus = pi;
      chained = 1;
      // The engine activates the storm right after the capture, before the chain move is played.
      if (b.stormIn < 0 && (b.alive[0] <= 1 || b.alive[1] <= 1 || b.ply >= SUDDEN_DEATH_PLY)) b.stormIn = STORM_INTERVAL_PLIES;
    }
  }
  if (!chained) switchSide(b);
  h[b.histTop++] = oldStormIn;
  h[b.histTop++] = oldAbsorb;
  h[b.histTop++] = oldBonus;
  h[b.histTop++] = chained;
  return undo;
}

/** Undo the trap / stun / hop-capture record `fastMake` pushed before the turn change. */
function undoMoveExtras(b: FastBoard, pi: number): void {
  const h = b.hist;
  if (h[--b.histTop]) b.stun[pi] = 0;
  const trapRec = h[--b.histTop];
  if (trapRec >= 0) {
    b.trap[trapRec >> 8] = trapRec & 255;
    b.trapsLaid[b.owner[pi]]--;
  }
  const hopN = h[--b.histTop];
  for (let k = 0; k < hopN; k++) {
    const rec = h[--b.histTop];
    const i = rec >> 8;
    const s = rec & 255;
    b.sq[i] = s;
    b.occ[s] = i;
    b.alive[b.owner[i]]++;
    b.material[b.owner[i]] += b.value[i];
  }
}

export function fastUnmake(b: FastBoard, mv: number, undo: number): void {
  if (mv & SKILL_FLAG) {
    unmakeSkill(b);
    return;
  }
  const h = b.hist;
  const chained = h[--b.histTop];
  const oldBonus = h[--b.histTop];
  const oldAbsorb = h[--b.histTop];
  const oldStormIn = h[--b.histTop];
  if (!chained) undoSwitch(b);
  b.ply--;
  b.bonus = oldBonus;
  b.stormIn = oldStormIn;
  const pi = (mv >> 8) & 255;
  const to = mv & 255;
  const from = undo & 255;
  if (undo & WASTE_BIT) {
    b.sq[pi] = from;
    b.occ[from] = pi;
    b.alive[b.owner[pi]]++;
    b.material[b.owner[pi]] += b.value[pi];
    undoMoveExtras(b, pi);
    return;
  }
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
  undoMoveExtras(b, pi);
}

/**
 * Cast piece `pi`'s skill (the turn passes): Brutile lays its wasteland at the encoded anchor,
 * Rakaeli transforms, Volkonov buffs every other piece of his side, Midos teleports to the anchor
 * (turning around on the far edge, like a move). Caller checked legality.
 */
function makeSkill(b: FastBoard, mv: number): number {
  const pi = (mv >> 8) & 255;
  const anchor = mv & 255;
  const h = b.hist;
  if (b.ch[pi] === CH_RAKAELI) {
    b.awaken[pi] = AWAKEN_TURNS;
    h[b.histTop++] = 0; // no wasteland squares
  } else if (b.ch[pi] === CH_VOLKONOV) {
    // His allies' buff was 0 before: each side has one Volkonov, and he casts once per match.
    let mask = 0;
    for (let i = 0; i < b.n; i++) {
      if (i === pi || b.sq[i] < 0 || b.owner[i] !== b.owner[pi]) continue;
      b.buff[i] = BUFF_TURNS[b.lvl[pi]] + 1;
      mask |= 1 << i;
    }
    h[b.histTop++] = mask;
    h[b.histTop++] = 0; // no wasteland squares
  } else if (b.ch[pi] === CH_MIDOS) {
    const from = b.sq[pi];
    let rec = from;
    b.occ[from] = -1;
    b.occ[anchor] = pi;
    b.sq[pi] = anchor;
    if (!keepsDirection(b.ch[pi]) && atTurnRow((anchor / BOARD_SIZE) | 0, b.dir[pi])) {
      b.dir[pi] = -b.dir[pi];
      rec |= FLIP_BIT;
    }
    h[b.histTop++] = rec;
    h[b.histTop++] = 0; // no wasteland squares
  } else layWaste(b, WASTE_SIZE[b.lvl[pi]], anchor);
  b.used[pi] = 1;
  b.skills[b.owner[pi]]++;
  h[b.histTop++] = pi;
  b.ply++;
  switchSide(b);
  return 0;
}

/** Flag the k x k wasteland with lowest corner `anchor`; pushes the new squares and their count. */
function layWaste(b: FastBoard, k: number, anchor: number): void {
  const r0 = (anchor / BOARD_SIZE) | 0;
  const c0 = anchor - r0 * BOARD_SIZE;
  const h = b.hist;
  let added = 0;
  for (let r = r0; r < r0 + k; r++) {
    for (let c = c0; c < c0 + k; c++) {
      const s = r * BOARD_SIZE + c;
      if (b.waste[s]) continue;
      b.waste[s] = 1;
      h[b.histTop++] = s;
      added++;
    }
  }
  h[b.histTop++] = added;
}

function unmakeSkill(b: FastBoard): void {
  undoSwitch(b);
  b.ply--;
  const h = b.hist;
  const pi = h[--b.histTop];
  b.skills[b.owner[pi]]--;
  b.used[pi] = 0;
  // A transform can only be cast untransformed: the cast is undone back to 0.
  if (b.ch[pi] === CH_RAKAELI) b.awaken[pi] = 0;
  const added = h[--b.histTop];
  for (let k = 0; k < added; k++) b.waste[h[--b.histTop]] = 0;
  if (b.ch[pi] === CH_VOLKONOV) {
    for (let i = 0, mask = h[--b.histTop]; mask !== 0; i++, mask >>>= 1) if (mask & 1) b.buff[i] = 0;
  } else if (b.ch[pi] === CH_MIDOS) {
    const rec = h[--b.histTop];
    const from = rec & 255;
    if (rec & FLIP_BIT) b.dir[pi] = -b.dir[pi];
    b.occ[b.sq[pi]] = -1;
    b.occ[from] = pi;
    b.sq[pi] = from;
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

/** Convert an encoded skill action into an engine SkillAction. */
export function fastSkillToAction(b: FastBoard, mv: number): SkillAction {
  return { kind: 'skill', pieceId: b.ids[(mv >> 8) & 255], anchor: posOf(mv & 255) };
}

/** Convert an encoded move (before it is made) into an engine Move. */
export function fastMoveToMove(b: FastBoard, mv: number): Move {
  const pi = (mv >> 8) & 255;
  const to = mv & 255;
  const m: Move = { pieceId: b.ids[pi], from: posOf(b.sq[pi]), to: posOf(to) };
  const cap = b.occ[to];
  if (cap >= 0) m.captureId = b.ids[cap];
  if (fastHopGain(b, pi, to) > 0) {
    const from = b.sq[pi];
    const len = pathOf(from, to);
    const step = stepOf(from, to);
    const on: string[] = [];
    for (let k = 1, s = from + step; k < len; k++, s += step) {
      const o = b.occ[s];
      if (o >= 0 && b.owner[o] !== b.owner[pi]) on.push(b.ids[o]);
    }
    m.captureIds = m.captureId ? [...on, m.captureId] : on;
    m.captureId ??= on[0];
  }
  return m;
}

export function fastCharacter(b: FastBoard, pi: number): CharacterId {
  return CHAR_BY_CODE[b.ch[pi]];
}
