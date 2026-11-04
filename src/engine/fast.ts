/**
 * Lightweight mutable board for search (AI). Not part of GameState; never posted anywhere.
 * Moves are encoded as integers: (pieceIndex << 8) | toSquare.
 * Undo tokens: ((capturedIndex + 1) << 8) | fromSquare (+ bit 16 when the mover turned around).
 * Everything else a move changes (turn, chain move, absorbed abilities, storm clock and storm
 * kills) is pushed on an internal LIFO history so make/unmake stay exact.
 * Skill actions (Brutile's wasteland) are encoded as SKILL_FLAG | (pieceIndex << 8) | anchorSquare.
 * A move whose target is wasteland destroys the mover (WASTE_BIT in the undo token).
 * Picker's hop-through captures the enemies on its path too, Michelle's backward moves lay doll
 * traps and a mover ending on an enemy trap is stunned: all of it is undone from the LIFO history.
 */
import { BOARD_SIZE, SKILL_UNLOCK_PLY, SKILL_USES_PER_MATCH, STORM_INTERVAL_PLIES, SUDDEN_DEATH_PLY, TRAPS_PER_MICHELLE, TRAP_STUN } from './types';
import type { CharacterId, GameState, Move, PlayerId, SkillAction } from './types';
import { CHARACTERS, CHAR_BY_CODE, CHAR_CODE, CH_BRUTILE, CH_INSANER, CH_MICHELLE, WASTE_SIZE, abilityBit, absorbMaskOf, keepsDirection } from './characters';
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
  absorb: Uint32Array; // absorbed pattern bitmask per piece (see abilityBit; N_CHARS * 3 bits)
  stun: Int8Array; // doll-trap stun per piece (owner turns left to sit out, see Piece.stun)
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
  /** Wasteland flags per square. */
  waste: Uint8Array;
  /** Skill uses per side. */
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

/** Can piece `i` lay its wasteland now (side to move, unlocked, not used up, storm not closing)? */
export function fastCanSkill(b: FastBoard, i: number): boolean {
  return (
    b.ch[i] === CH_BRUTILE &&
    b.sq[i] >= 0 &&
    b.stun[i] === 0 &&
    b.owner[i] === b.turn &&
    b.bonus < 0 &&
    b.storm === 0 &&
    b.ply >= SKILL_UNLOCK_PLY &&
    b.skills[b.owner[i]] < SKILL_USES_PER_MATCH
  );
}

/** Is the k x k area with lowest corner `anchor` on the board and free of pieces? */
export function fastSkillFits(b: FastBoard, k: number, anchor: number): boolean {
  const r0 = (anchor / BOARD_SIZE) | 0;
  const c0 = anchor - r0 * BOARD_SIZE;
  if (r0 + k > BOARD_SIZE || c0 + k > BOARD_SIZE) return false;
  for (let r = r0; r < r0 + k; r++) for (let c = c0; c < c0 + k; c++) if (b.occ[r * BOARD_SIZE + c] >= 0) return false;
  return true;
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
    n = genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, out, n, false, b.dir[i], b.storm, b.absorb[i], b.waste, b.trap);
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
    if (genTargets(b.occ, b.owner, side, b.ch[i], b.lvl[i], s, scratch, 0, false, b.dir[i], b.storm, b.absorb[i], b.waste, b.trap) > 0) return true;
  }
  return false;
}

/**
 * Material (base values) of the enemies piece `pi` would hop onto on the way to `to` (Picker's
 * hop-through; 0 for every other move). Only valid for a legal move, before it is made.
 */
export function fastHopGain(b: FastBoard, pi: number, to: number): number {
  if (!canHop(b.ch[pi], b.absorb[pi])) return 0;
  const from = b.sq[pi];
  const fr = (from / BOARD_SIZE) | 0;
  const tr = (to / BOARD_SIZE) | 0;
  const dr = tr - fr;
  const dc = to - tr * BOARD_SIZE - (from - fr * BOARD_SIZE);
  const len = dr < 0 ? -dr : dr;
  if (len < 2 || len !== (dc < 0 ? -dc : dc)) return 0;
  const step = (dr > 0 ? BOARD_SIZE : -BOARD_SIZE) + (dc > 0 ? 1 : -1);
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
 * Hand the move to the other side: clears the chain move, ticks the storm (killing pieces in the
 * new storm columns) and activates the storm when a side is down to one piece. Pushes its own
 * undo record; `undoSwitch` reverses it.
 */
function switchSide(b: FastBoard): void {
  const oldBonus = b.bonus;
  const oldStorm = b.storm;
  const oldStormIn = b.stormIn;
  // The side whose turn ends: each of its stunned pieces has one owner turn less to sit out.
  let stunMask = 0;
  for (let i = 0; i < b.n; i++) {
    if (b.stun[i] > 0 && b.owner[i] === b.turn) {
      b.stun[i]--;
      stunMask |= 1 << i;
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
  h[b.histTop++] = stunMask;
}

function undoSwitch(b: FastBoard): void {
  const h = b.hist;
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
  // Picker's hop-through: every enemy on the squares between `from` and `to` is captured first.
  let gain = 0;
  let hopN = 0;
  if (canHop(b.ch[pi], b.absorb[pi])) {
    const fr = (from / BOARD_SIZE) | 0;
    const tr = (to / BOARD_SIZE) | 0;
    const dr = tr - fr;
    const dc = to - tr * BOARD_SIZE - (from - fr * BOARD_SIZE);
    const len = dr < 0 ? -dr : dr;
    if (len >= 2 && len === (dc < 0 ? -dc : dc)) {
      const step = (dr > 0 ? BOARD_SIZE : -BOARD_SIZE) + (dc > 0 ? 1 : -1);
      for (let k = 1, s = from + step; k < len; k++, s += step) {
        const o = b.occ[s];
        if (o < 0 || b.owner[o] === own) continue;
        gain |= abilityBit(b.ch[o], b.lvl[o]) | b.absorb[o];
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
    gain |= abilityBit(b.ch[cap], b.lvl[cap]) | b.absorb[cap];
    b.sq[cap] = -1;
    b.alive[b.owner[cap]]--;
    b.material[b.owner[cap]] -= b.value[cap];
  }
  b.occ[from] = -1;
  b.occ[to] = pi;
  b.sq[pi] = to;
  let undo = ((cap + 1) << 8) | from;
  if (!keepsDirection(b.ch[pi]) && atTurnRow((to / 12) | 0, b.dir[pi])) {
    b.dir[pi] = -b.dir[pi];
    undo |= FLIP_BIT;
  }
  // Michelle's backward move leaves a doll trap on `from` (her first TRAPS_PER_MICHELLE ones).
  if (b.ch[pi] === CH_MICHELLE && ((((to / 12) | 0) - ((from / 12) | 0)) * b.dir[pi] < 0) && b.trapsLaid[own] < TRAPS_PER_MICHELLE) {
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
    b.absorb[pi] |= gain;
    b.absorb[pi] &= ~abilityBit(b.ch[pi], b.lvl[pi]);
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

/** Lay piece `pi`'s wasteland at the encoded anchor (the turn passes). Caller checked legality. */
function makeSkill(b: FastBoard, mv: number): number {
  const pi = (mv >> 8) & 255;
  const anchor = mv & 255;
  const k = WASTE_SIZE[b.lvl[pi]];
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
  b.skills[b.owner[pi]]++;
  h[b.histTop++] = b.owner[pi];
  b.ply++;
  switchSide(b);
  return 0;
}

function unmakeSkill(b: FastBoard): void {
  undoSwitch(b);
  b.ply--;
  const h = b.hist;
  const side = h[--b.histTop];
  b.skills[side]--;
  const added = h[--b.histTop];
  for (let k = 0; k < added; k++) b.waste[h[--b.histTop]] = 0;
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
    const fr = (from / BOARD_SIZE) | 0;
    const tr = (to / BOARD_SIZE) | 0;
    const len = Math.abs(tr - fr);
    const step = (tr > fr ? BOARD_SIZE : -BOARD_SIZE) + ((to % BOARD_SIZE) > (from % BOARD_SIZE) ? 1 : -1);
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
