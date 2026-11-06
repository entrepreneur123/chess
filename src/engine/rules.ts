import { AWAKEN_TURNS, BUFF_TURNS, OFF_TURN_STUN, SKILL_UNLOCK_PLY, STORM_INTERVAL_PLIES, SUDDEN_DEATH_PLY, TRAPS_PER_MICHELLE, TRAP_STUN, TURN_TIME_1_MS, TURN_TIME_2_MS, TURN_TIME_MS } from './types';
import type { AbsorbedAbility, CharacterId, EndReason, Formation, GameState, HistoryEntry, Move, Piece, PlayerId, Pos, SkillAction, Trap } from './types';
import { BOARD_SIZE } from './types';
import { CHARACTERS, CHAR_CODE, GLACIA_FREEZE, HAMMONT_STUN_LEVEL, WASTE_SIZE, absorbMaskOf, effectiveValue, keepsDirection, skillKindOf } from './characters';
import { N_SQUARES, atTurnRow, canHop, formationToAbsolute, forwardDir, genTargets, inStorm, isOnBoard, posOf, sqOf, trapBit } from './board';
import { validateFormation } from './formation';

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function createGame(f0: Formation, f1: Formation, firstTurn: PlayerId = 0): GameState {
  const pieces: Piece[] = [];
  const fs: [Formation, Formation] = [f0, f1];
  for (const owner of [0, 1] as PlayerId[]) {
    const v = validateFormation(fs[owner]);
    if (!v.ok) throw new Error(`Invalid formation for player ${owner}: ${v.errors.join(' / ')}`);
    for (const slot of fs[owner]) {
      pieces.push({
        id: `p${owner}-${slot.character}`,
        owner,
        character: slot.character,
        level: slot.level,
        pos: formationToAbsolute(owner, slot),
      });
    }
  }
  const state: GameState = {
    pieces,
    turn: firstTurn,
    ply: 0,
    pliesSinceCapture: 0,
    consecutiveTimeouts: [0, 0],
    status: 'playing',
    winner: null,
    endReason: null,
    history: [],
    bonusPieceId: null,
    storm: 0,
    stormIn: null,
    waste: [],
    skillsUsed: [0, 0],
  };
  return settle(state);
}

export function getPieceAt(state: GameState, pos: Pos): Piece | undefined {
  return state.pieces.find((p) => p.pos.r === pos.r && p.pos.c === pos.c);
}

export function getPieceById(state: GameState, id: string): Piece | undefined {
  return state.pieces.find((p) => p.id === id);
}

/** Occupancy (piece index or -1) + owners array for a list of pieces. */
export function buildOccupancy(pieces: Piece[]): { occ: Int8Array; owners: Uint8Array } {
  const occ = new Int8Array(N_SQUARES).fill(-1);
  const owners = new Uint8Array(pieces.length);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    owners[i] = p.owner;
    if (isOnBoard(p.pos)) occ[sqOf(p.pos)] = i;
  }
  return { occ, owners };
}

const tmpTargets = new Int16Array(128);

/** Length-N_SQUARES wasteland flags for a state's `waste` list (shared scratch: read it before the next call). */
const wasteScratch = new Uint8Array(N_SQUARES);
let wasteScratchKey: number[] | null = null;
export function wasteFlags(waste: readonly number[] | undefined): Uint8Array | null {
  if (!waste || waste.length === 0) return null;
  if (wasteScratchKey !== waste) {
    wasteScratch.fill(0);
    for (const s of waste) wasteScratch[s] = 1;
    wasteScratchKey = waste as number[];
  }
  return wasteScratch;
}

/** Length-N_SQUARES doll-trap masks (bit `trapBit(owner)` per trap) for a state's `traps` (shared scratch). */
const trapScratch = new Uint8Array(N_SQUARES);
let trapScratchKey: readonly Trap[] | null = null;
export function trapFlags(traps: readonly Trap[] | undefined): Uint8Array | null {
  if (!traps || traps.length === 0) return null;
  if (trapScratchKey !== traps) {
    trapScratch.fill(0);
    for (const t of traps) trapScratch[t.sq] |= trapBit(t.owner);
    trapScratchKey = traps;
  }
  return trapScratch;
}

/** True while a doll trap holds the piece (no moves, no skill). */
export function isStunned(piece: Pick<Piece, 'stun'>): boolean {
  return (piece.stun ?? 0) > 0;
}

/** True while Rakaeli is transformed ("타천"): he moves with his transformed pattern. */
export function isAwake(piece: Pick<Piece, 'awaken'>): boolean {
  return (piece.awaken ?? 0) > 0;
}

/** True while Volkonov's "선율" buffs the piece (1 more square every orthogonal way). */
export function isBuffed(piece: Pick<Piece, 'buff'>): boolean {
  return (piece.buff ?? 0) > 0;
}

/** Is there a doll trap of `owner` on `pos`? */
export function trapAt(state: Pick<GameState, 'traps'>, pos: Pos, owner: PlayerId): boolean {
  const sq = sqOf(pos);
  return (state.traps ?? []).some((t) => t.sq === sq && t.owner === owner);
}

/** Doll traps `owner`'s Michelle can still lay this match. */
export function trapsLeft(state: Pick<GameState, 'trapsLaid'>, owner: PlayerId): number {
  return Math.max(0, TRAPS_PER_MICHELLE - (state.trapsLaid?.[owner] ?? 0));
}

/** Every piece a move captures, in path order (Picker's hop-through can take several). */
export function capturedIds(move: Pick<Move, 'captureId' | 'captureIds'>): string[] {
  if (move.captureIds && move.captureIds.length) return move.captureIds;
  return move.captureId ? [move.captureId] : [];
}

/**
 * Squares strictly between `from` and `to` of a straight move of two or more squares (orthogonal
 * or diagonal: Picker's hop-through, Verish's pierce), or [] otherwise.
 */
export function hopPath(from: Pos, to: Pos): Pos[] {
  const dr = to.r - from.r;
  const dc = to.c - from.c;
  const ar = Math.abs(dr);
  const ac = Math.abs(dc);
  if (!(ar === 0 || ac === 0 || ar === ac)) return [];
  const n = Math.max(ar, ac);
  if (n < 2) return [];
  const sr = Math.sign(dr);
  const sc = Math.sign(dc);
  const out: Pos[] = [];
  for (let k = 1; k < n; k++) out.push({ r: from.r + sr * k, c: from.c + sc * k });
  return out;
}

/**
 * Enemies a piece of `owner` passes on the way from `from` to `to`. Only a hop-through or a pierce
 * (a real Picker or Verish: absorbed patterns slide) can reach a square past pieces, so for any
 * LEGAL move of theirs these are exactly the pieces captured before landing.
 */
function hopVictims(pieces: Piece[], occ: Int8Array, owner: PlayerId, from: Pos, to: Pos): string[] {
  const out: string[] = [];
  for (const q of hopPath(from, to)) {
    const o = occ[sqOf(q)];
    if (o >= 0 && pieces[o].owner !== owner) out.push(pieces[o].id);
  }
  return out;
}

/** Current forward direction of a piece (forward-only movers turn around at the far edge). */
export function pieceDir(piece: Pick<Piece, 'owner' | 'dir'>): 1 | -1 {
  return piece.dir ?? forwardDir(piece.owner);
}

/**
 * Does this (character, level) tell forward from back? Sad, Insaner's own pattern, Picker and a
 * level-3 Brutile (every neighbour) are symmetric; Marki, Walk, Rakaeli and a level-1/2 Brutile are
 * not. Michelle always is: even where her reach is symmetric (3-star: 2 squares every way) her
 * doll traps come from BACKWARD moves only, so which way she faces still matters.
 */
function patternIsDirectional(character: CharacterId, level: number): boolean {
  switch (character) {
    case 'marki':
    case 'walk':
    case 'michelle':
    case 'rakaeli':
    case 'rampid':
    case 'verish':
    case 'midos':
    case 'venoa':
      return true;
    case 'brutile':
      return level < 3;
    // 1성 jumps to the forward diagonals only; from 2성 all four diagonals (symmetric).
    case 'larhen':
      return level < 2;
    default:
      return false;
  }
}

/** Empty-board scratch for `reachDependsOnDir` (an Insaner's absorbed patterns, cached by mask). */
const EMPTY_OCC = new Int8Array(N_SQUARES).fill(-1);
const dirScratch = [new Int16Array(256), new Int16Array(256)];
const insanerDirCache = new Map<number, boolean>();

/**
 * Does flipping forward change where an Insaner of `level` with absorb mask `absorb` can go? Asked
 * of the move generator on an empty board (the union of patterns can be symmetric even when an
 * absorbed one is not: his own orthogonal slides already cover Michelle's back steps).
 */
function reachDependsOnDir(level: number, absorb: number): boolean {
  const key = absorb * 4 + level;
  let v = insanerDirCache.get(key);
  if (v === undefined) {
    const mid = (BOARD_SIZE >> 1) * BOARD_SIZE + (BOARD_SIZE >> 1);
    const ch = CHAR_CODE.insaner;
    const n0 = genTargets(EMPTY_OCC, [], 0, ch, level, mid, dirScratch[0], 0, false, 1, 0, absorb);
    const n1 = genTargets(EMPTY_OCC, [], 0, ch, level, mid, dirScratch[1], 0, false, -1, 0, absorb);
    const a = dirScratch[0].slice(0, n0).sort();
    const b = dirScratch[1].slice(0, n1).sort();
    v = n0 !== n1 || a.some((x, i) => x !== b[i]);
    insanerDirCache.set(key, v);
  }
  return v;
}

/**
 * True when the piece's current movement depends on its forward direction (`pieceDir`), i.e. the
 * UI should show which way is forward. An Insaner is directional once what he has absorbed makes
 * his combined reach direction-dependent.
 */
export function isDirectional(piece: Pick<Piece, 'character' | 'level' | 'absorbed'>): boolean {
  if (piece.character === 'insaner') return !!piece.absorbed?.length && reachDependsOnDir(piece.level, absorbMaskOf(piece.absorbed));
  return patternIsDirectional(piece.character, piece.level);
}

/**
 * The piece's forward direction as the player sees the board: player 0 is always drawn at the
 * bottom (rows grow upward on screen, both renderers; the board never flips), so `dir` +1 is up.
 * The one helper every arrow (hand cards, roster chips, board tokens, toasts) goes through.
 */
export function screenArrow(piece: Pick<Piece, 'owner' | 'dir'>): 'up' | 'down' {
  return pieceDir(piece) === 1 ? 'up' : 'down';
}

function countTargets(occ: Int8Array, owners: Uint8Array, piece: Piece, storm: number, waste: Uint8Array | null, traps: Uint8Array | null): number {
  return genTargets(occ, owners, piece.owner, CHAR_CODE[piece.character], piece.level, sqOf(piece.pos), tmpTargets, 0, false, pieceDir(piece), storm, absorbMaskOf(piece.absorbed), waste, traps, isAwake(piece), isBuffed(piece));
}

function targetsWith(pieces: Piece[], occ: Int8Array, owners: Uint8Array, piece: Piece, storm: number, waste: Uint8Array | null, traps: Uint8Array | null): Move[] {
  const n = countTargets(occ, owners, piece, storm, waste, traps);
  // Only a real Picker hops through (an Insaner's absorbed Picker pattern is a plain slide).
  const hopper = canHop(CHAR_CODE[piece.character]);
  const moves: Move[] = [];
  for (let i = 0; i < n; i++) {
    const s = tmpTargets[i];
    const m: Move = { pieceId: piece.id, from: { r: piece.pos.r, c: piece.pos.c }, to: posOf(s) };
    const o = occ[s];
    if (o >= 0) m.captureId = pieces[o].id;
    // Venoa shoots whatever she hits from two squares or more away: she stays put.
    if (o >= 0 && piece.character === 'venoa' && isShot(m.from, m.to)) m.shot = true;
    // Hammont knocks the enemy he hits one square on (crushed when it cannot go).
    if (o >= 0 && piece.character === 'hammont') {
      const push = pushOutcome(occ, piece, m.from, m.to, storm, waste, traps);
      if (push) {
        delete m.captureId;
        m.push = { id: pieces[o].id, ...push };
      } else m.crush = true;
    }
    if (hopper) {
      const on = hopVictims(pieces, occ, piece.owner, m.from, m.to);
      if (on.length) {
        m.captureIds = m.captureId ? [...on, m.captureId] : on;
        m.captureId ??= on[0];
      }
    }
    moves.push(m);
  }
  return moves;
}

/** A Venoa target at a Chebyshev distance of 2 or more is a shot (adjacent ones she steps onto). */
export function isShot(from: Pos, to: Pos): boolean {
  return Math.max(Math.abs(to.r - from.r), Math.abs(to.c - from.c)) >= 2;
}

/**
 * Where Hammont's hit knocks the enemy on `to` (one more square in the direction from `from`), or
 * null when it cannot go there and is crushed: the edge, the storm, any piece, or wasteland. A
 * 3성 Hammont stuns it; landing on a doll trap of Hammont's side stuns it too.
 */
function pushOutcome(occ: Int8Array, mover: Piece, from: Pos, to: Pos, storm: number, waste: Uint8Array | null, traps: Uint8Array | null): { to: Pos; stunned?: true } | null {
  const r = to.r + Math.sign(to.r - from.r);
  const c = to.c + Math.sign(to.c - from.c);
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || inStorm(r, c, storm)) return null;
  const s = r * BOARD_SIZE + c;
  if (occ[s] >= 0 || (waste !== null && waste[s])) return null;
  const out: { to: Pos; stunned?: true } = { to: { r, c } };
  if (mover.level >= HAMMONT_STUN_LEVEL || (traps !== null && traps[s] & trapBit(mover.owner))) out.stunned = true;
  return out;
}

/**
 * Pseudo-moves for ANY piece regardless of whose turn it is (for previewing reach). A stunned piece
 * has none: it cannot act on its owner's next turn.
 */
export function getTargetsForPiece(state: GameState, piece: Piece): Move[] {
  if (isStunned(piece)) return [];
  const { occ, owners } = buildOccupancy(state.pieces);
  return targetsWith(state.pieces, occ, owners, piece, state.storm, wasteFlags(state.waste), trapFlags(state.traps));
}

/** True when moving to `to` touches wasteland (the mover is destroyed there). */
export function isWasteMove(state: Pick<GameState, 'waste'>, to: Pos): boolean {
  return state.waste.includes(sqOf(to));
}

/**
 * Legal moves of the side to move (optionally for a single piece). [] if the game has ended.
 * While a chain move is pending only the chaining piece may move.
 */
export function getLegalMoves(state: GameState, pieceId?: string): Move[] {
  if (state.status !== 'playing') return [];
  const { occ, owners } = buildOccupancy(state.pieces);
  const out: Move[] = [];
  for (const p of state.pieces) {
    if (p.owner !== state.turn) continue;
    if (pieceId !== undefined && p.id !== pieceId) continue;
    if (state.bonusPieceId !== null && p.id !== state.bonusPieceId) continue;
    if (isStunned(p)) continue;
    for (const m of targetsWith(state.pieces, occ, owners, p, state.storm, wasteFlags(state.waste), trapFlags(state.traps))) out.push(m);
  }
  return out;
}

/** Does `player` have a move? `ignoreStun` asks whether it would have one once its stuns wear off. */
function hasAnyMove(state: GameState, player: PlayerId, onlyPieceId: string | null = null, ignoreStun = false): boolean {
  const pieces = state.pieces;
  const { occ, owners } = buildOccupancy(pieces);
  const wf = wasteFlags(state.waste);
  const tf = trapFlags(state.traps);
  for (const p of pieces) {
    if (p.owner !== player) continue;
    if (onlyPieceId !== null && p.id !== onlyPieceId) continue;
    if (!ignoreStun && isStunned(p)) continue;
    if (countTargets(occ, owners, p, state.storm, wf, tf) > 0) return true;
  }
  return false;
}

const samePos = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;

export function isLegalMove(state: GameState, move: Move): boolean {
  if (!move || !move.from || !move.to) return false;
  return getLegalMoves(state, move.pieceId).some((m) => samePos(m.from, move.from) && samePos(m.to, move.to));
}

export function materialScore(state: GameState, player: PlayerId): number {
  let s = 0;
  for (const p of state.pieces) if (p.owner === player) s += effectiveValue(p.character, p.level, p.absorbed);
  return s;
}

/** Winner by material, or null for a draw. */
export function adjudicate(state: GameState): PlayerId | null {
  const a = materialScore(state, 0);
  const b = materialScore(state, 1);
  return a > b ? 0 : b > a ? 1 : null;
}

/**
 * Winner when one storm step removes the last pieces of both sides: the side that lost more pieces
 * in it (= had more left right before it), or null (a draw) on equal counts. Only the number of
 * pieces counts, never their rarity, grade or absorbed abilities.
 */
export function wipeWinner(before: readonly Piece[], killed: readonly string[]): PlayerId | null {
  let n0 = 0;
  let n1 = 0;
  for (const p of before) {
    if (!killed.includes(p.id)) continue;
    if (p.owner === 0) n0++;
    else n1++;
  }
  return n0 > n1 ? 0 : n1 > n0 ? 1 : null;
}

function countPieces(pieces: Piece[], player: PlayerId): number {
  let n = 0;
  for (const p of pieces) if (p.owner === player) n++;
  return n;
}

/**
 * Time allowed for the current turn: TURN_TIME_MS (45 s) normally, TURN_TIME_2_MS (40 s) once
 * either side is down to two pieces, TURN_TIME_1_MS (20 s) once either side is down to one.
 */
export function turnTimeMsFor(state: Pick<GameState, 'pieces'>): number {
  const m = Math.min(countPieces(state.pieces, 0), countPieces(state.pieces, 1));
  return m <= 1 ? TURN_TIME_1_MS : m <= 2 ? TURN_TIME_2_MS : TURN_TIME_MS;
}

function end(state: GameState, winner: PlayerId | null, reason: GameState['endReason']): GameState {
  return { ...state, status: 'ended', winner, endReason: reason };
}

/**
 * Hand the move to the other player: appends `entry`, bumps the ply, clears any chain move and
 * ticks the storm clock (which may advance the storm and remove pieces).
 */
function switchTurn(state: GameState, entry: HistoryEntry, pliesSinceCapture: number): GameState {
  let next: GameState = {
    ...state,
    pieces: countDownTurnEnd(state.pieces, state.turn),
    turn: other(state.turn),
    ply: state.ply + 1,
    pliesSinceCapture,
    bonusPieceId: null,
    history: [...state.history, entry],
  };
  // A side that just lost its last piece decides the game (see `settle`): the storm does not tick.
  const alive0 = countPieces(next.pieces, 0);
  const alive1 = countPieces(next.pieces, 1);
  if (next.stormIn !== null && alive0 > 0 && alive1 > 0) {
    const left = next.stormIn - 1;
    if (left > 0) next = { ...next, stormIn: left };
    else {
      const storm = next.storm + 1;
      const killed: string[] = [];
      const pieces = next.pieces.filter((p) => {
        if (!inStorm(p.pos.r, p.pos.c, storm)) return true;
        killed.push(p.id);
        return false;
      });
      next = { ...next, storm, stormIn: STORM_INTERVAL_PLIES, pieces, history: [...next.history, { kind: 'storm', storm, killed }] };
      const left0 = countPieces(pieces, 0);
      const left1 = countPieces(pieces, 1);
      // The storm (columns, and rows from step 3) swallowed the last pieces of BOTH sides at once:
      // the side that had more pieces left wins, equal counts are a draw (rarity and grade do not
      // count). Every piece of both sides was on the board right before this step, so that is
      // simply who lost more pieces in it.
      if (left0 === 0 && left1 === 0) return end(next, wipeWinner(state.pieces, killed), 'storm');
      if (left0 === 0 || left1 === 0) return end(next, left0 > 0 ? 0 : 1, 'storm');
    }
  }
  return next;
}

/**
 * The turn of `player` ends: each of its stunned pieces has one owner turn less to sit out, a
 * transformed Rakaeli one transformed turn less and a buffed piece one buffed turn less (a stun
 * pauses neither).
 */
function countDownTurnEnd(pieces: Piece[], player: PlayerId): Piece[] {
  if (!pieces.some((p) => p.owner === player && (p.stun || p.awaken || p.buff))) return pieces;
  return pieces.map((p) => {
    if (p.owner !== player || !(p.stun || p.awaken || p.buff)) return p;
    const q: Piece = { ...p };
    if (p.buff) {
      if (p.buff > 1) q.buff = p.buff - 1;
      else delete q.buff;
    }
    if (p.stun) {
      if (p.stun > 1) q.stun = p.stun - 1;
      else delete q.stun;
    }
    if (p.awaken) {
      if (p.awaken > 1) q.awaken = p.awaken - 1;
      else delete q.awaken;
    }
    return q;
  });
}

/**
 * Post-ply bookkeeping: elimination (by capture or storm), storm activation (one piece left or
 * sudden death), chain moves that cannot be played, and what happens when the side to move has no
 * legal action (no move and no castable skill):
 *  - only its doll-trap stuns hold it (it would have a move without them): it passes ('stunned');
 *  - otherwise it cannot act at all and LOSES at once ('immobile'). Owner rule: a side must act
 *    every turn, e.g. a Walk or Marki facing a storm row it can never turn around at, or a piece
 *    boxed in by its own pieces and the board edge.
 * A pending chain move that cannot be played just lapses ('bonusSkip'), never a loss.
 * `state` must already be a fresh object owned by the caller.
 */
function settle(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  for (;;) {
    const n0 = countPieces(state.pieces, 0);
    const n1 = countPieces(state.pieces, 1);
    if (n0 === 0 || n1 === 0) return end(state, n0 > 0 ? 0 : n1 > 0 ? 1 : null, eliminationReason(state, n0 === 0 && n1 === 0 ? null : n0 === 0 ? 0 : 1));
    if (state.stormIn === null && (n0 <= 1 || n1 <= 1 || state.ply >= SUDDEN_DEATH_PLY)) state = { ...state, stormIn: STORM_INTERVAL_PLIES };
    if (state.bonusPieceId !== null) {
      if (hasAnyMove(state, state.turn, state.bonusPieceId)) return state;
      // The chaining piece is boxed in: the chain move lapses.
      state = switchTurn(state, { kind: 'pass', player: state.turn, reason: 'bonusSkip' }, state.pliesSinceCapture + 1);
      continue;
    }
    // A side that cannot move but can still cast a skill (lay its wasteland, or transform) is not
    // passed: casting is its turn.
    if (hasAnyMove(state, state.turn) || sideCanCast(state, state.turn)) return state;
    // Stuns wear off, so the game is only stuck when neither side could act even without them.
    const selfLater = hasAnyMove(state, state.turn, null, true) || sideCanCast(state, state.turn, true);
    if (!selfLater) return end(state, other(state.turn), 'immobile');
    state = switchTurn(state, { kind: 'pass', player: state.turn, reason: 'stunned' }, state.pliesSinceCapture + 1);
  }
}

/**
 * Why a side has no pieces left after the last action (storm eliminations end the game inside
 * `switchTurn`): its last piece stepped onto wasteland, or it was captured.
 */
function eliminationReason(state: GameState, loser: PlayerId | null): EndReason {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const e = state.history[i];
    if (e.kind === 'storm') continue;
    return e.kind === 'move' && e.move.wasted && (loser === null || e.player === loser) ? 'waste' : 'elimination';
  }
  return 'elimination';
}

/** Current turn, counted per player: both players' first moves are turn 1, the next pair turn 2... */
export function turnNumber(state: Pick<GameState, 'ply'>): number {
  return Math.floor(state.ply / 2) + 1;
}

/** Plies left before sudden death starts the storm; null once the storm is active (or the game ended). */
export function suddenDeathIn(state: Pick<GameState, 'ply' | 'stormIn' | 'status'>): number | null {
  if (state.status !== 'playing' || state.stormIn !== null) return null;
  return Math.max(0, SUDDEN_DEATH_PLY - state.ply);
}

/** Union of absorbed abilities (deduplicated, never including the holder's own pattern). */
function absorbInto(holder: Piece, victim: Piece): AbsorbedAbility[] {
  const out: AbsorbedAbility[] = [...(holder.absorbed ?? [])];
  const add = (a: AbsorbedAbility) => {
    if (a.character === holder.character && a.level === holder.level) return;
    if (out.some((x) => x.character === a.character && x.level === a.level)) return;
    out.push({ character: a.character, level: a.level });
  };
  add({ character: victim.character, level: victim.level });
  for (const a of victim.absorbed ?? []) add(a);
  return out;
}

/** Pure: returns a new state. Throws if the game is over or the move is illegal. */
export function applyMove(state: GameState, move: Move): GameState {
  if (state.status !== 'playing') throw new Error('Game is already over');
  if (!move || !move.from || !move.to) throw new Error('Malformed move');
  const legal = getLegalMoves(state, move.pieceId).find((m) => samePos(m.from, move.from) && samePos(m.to, move.to));
  if (!legal) throw new Error(`Illegal move: ${JSON.stringify(move)}`);
  const player = state.turn;
  const mover = state.pieces.find((p) => p.id === legal.pieceId)!;
  // Everything the move captures: the piece on `to`, plus every enemy Picker hops onto on the way.
  const victimIds = capturedIds(legal);
  const victims = victimIds.map((id) => state.pieces.find((p) => p.id === id)!);
  // Touching wasteland destroys the mover (wasteland never holds a piece). A hop still takes the
  // enemies it landed on before reaching the wasteland square.
  // A shot leaves the shooter where she stands: no wasteland, trap, turn-around or stun for her.
  const shot = !!legal.shot;
  const wasted = !shot && isWasteMove(state, legal.to);
  const d = pieceDir(mover);
  // Michelle's doll trap: her first TRAPS_PER_MICHELLE backward moves leave one on `from`.
  const laysTrap = mover.character === 'michelle' && !shot && !wasted && (legal.to.r - legal.from.r) * d < 0 && trapsLeft(state, player) > 0;
  // Ending a move on an ENEMY doll trap stuns the mover (its own side's traps never catch it).
  const caught = !shot && !wasted && trapAt(state, legal.to, other(player));
  const pieces: Piece[] = [];
  for (const p of state.pieces) {
    if (victimIds.includes(p.id)) continue;
    if (p.id === legal.pieceId && wasted) continue;
    if (legal.push && p.id === legal.push.id) {
      // Knocked back by Hammont (stunned at 3성 or on a trap of his side).
      const knocked: Piece = { ...p, pos: { r: legal.push.to.r, c: legal.push.to.c } };
      if (legal.push.stunned) knocked.stun = Math.max(p.stun ?? 0, OFF_TURN_STUN);
      pieces.push(knocked);
      continue;
    }
    if (p.id === legal.pieceId && shot) {
      pieces.push(p);
      continue;
    }
    if (p.id === legal.pieceId) {
      const moved: Piece = { ...p, pos: { r: legal.to.r, c: legal.to.c } };
      // Forward-only movers turn around when they reach the last row in their direction.
      if (!keepsDirection(CHAR_CODE[p.character]) && atTurnRow(moved.pos.r, d)) moved.dir = d === 1 ? -1 : 1;
      // Insaner steals the movement pattern of whatever it captures (every victim of a hop).
      if (p.character === 'insaner' && victims.length) {
        let holder: Piece = moved;
        for (const v of victims) holder = { ...holder, absorbed: absorbInto(holder, v) };
        moved.absorbed = holder.absorbed;
      }
      if (caught) moved.stun = TRAP_STUN;
      pieces.push(moved);
    } else pieces.push(p);
  }
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[player] = 0;
  const recorded: Move = { pieceId: legal.pieceId, from: { ...legal.from }, to: { ...legal.to } };
  if (legal.captureId) recorded.captureId = legal.captureId;
  if (legal.captureIds) recorded.captureIds = [...legal.captureIds];
  if (wasted) recorded.wasted = true;
  if (laysTrap) recorded.trap = true;
  if (caught) recorded.stunned = true;
  if (shot) recorded.shot = true;
  if (legal.push) recorded.push = { id: legal.push.id, to: { ...legal.push.to }, ...(legal.push.stunned ? { stunned: true as const } : {}) };
  if (legal.crush) recorded.crush = true;
  const entry: HistoryEntry = { kind: 'move', player, move: recorded };
  const psc = victims.length ? 0 : state.pliesSinceCapture + 1;
  const base: GameState = { ...state, pieces, consecutiveTimeouts: ct };
  if (laysTrap) {
    const sq = sqOf(legal.from);
    const traps = state.traps ?? [];
    base.traps = traps.some((t) => t.sq === sq && t.owner === player)
      ? traps
      : [...traps, { sq, owner: player }].sort((a, b) => a.sq - b.sq || a.owner - b.owner);
    const laid: [number, number] = [state.trapsLaid?.[0] ?? 0, state.trapsLaid?.[1] ?? 0];
    laid[player] += 1;
    base.trapsLaid = laid;
  }
  // Chain move: a Level-3 Insaner that captures moves once more (one extra move per turn; a
  // multi-capture is still one capture). A doll trap that catches it ends the turn instead.
  if (victims.length && mover.character === 'insaner' && mover.level === 3 && state.bonusPieceId === null && !caught && !wasted) {
    return settle({ ...base, ply: state.ply + 1, pliesSinceCapture: psc, bonusPieceId: mover.id, history: [...state.history, entry] });
  }
  return settle(switchTurn(base, entry, psc));
}

/** Squares (r * BOARD_SIZE + c) of a k x k wasteland whose lowest-row, lowest-column square is `anchor`. */
export function wasteArea(level: number, anchor: Pos): number[] {
  const k = WASTE_SIZE[level] ?? 1;
  const out: number[] = [];
  for (let r = anchor.r; r < anchor.r + k; r++) for (let c = anchor.c; c < anchor.c + k; c++) out.push(r * BOARD_SIZE + c);
  return out;
}

/**
 * Why a skill cannot be cast now; 'active' = Rakaeli is transformed already; 'alone' = Volkonov has
 * no other piece left to play his melody for.
 */
export type SkillBlock = 'noSkill' | 'notYourTurn' | 'chain' | 'notYet' | 'used' | 'active' | 'storm' | 'alone' | 'noTarget' | 'stunned' | 'ended';

/**
 * Why `pieceId` cannot use its skill right now, or null when it can. Every skill (Brutile's
 * wasteland, Rakaeli's transform) unlocks at SKILL_UNLOCK_PLY (each side has played 3 turns), may
 * be used once per match by each skill character (`Piece.skillUsed`), is forbidden during a chain
 * move, while stunned and once the storm has started closing in (storm >= 1). A transformed
 * Rakaeli cannot cast again ('active').
 */
export function skillBlock(state: GameState, pieceId: string): SkillBlock | null {
  if (state.status !== 'playing') return 'ended';
  const p = state.pieces.find((x) => x.id === pieceId);
  if (!p || !CHARACTERS[p.character].skill) return 'noSkill';
  if (p.owner !== state.turn) return 'notYourTurn';
  if (state.bonusPieceId !== null) return 'chain';
  if (isAwake(p)) return 'active';
  if (state.storm > 0) return 'storm';
  if (p.skillUsed) return 'used';
  if (state.ply < SKILL_UNLOCK_PLY) return 'notYet';
  if (skillKindOf(p.character) === 'buff' && !state.pieces.some((q) => q.owner === p.owner && q.id !== p.id)) return 'alone';
  if (skillKindOf(p.character) === 'freeze' && freezeAnchors(state, p).length === 0) return 'noTarget';
  // Checked last: 'stunned' means the skill would be usable once the doll trap lets go.
  if (isStunned(p)) return 'stunned';
  return null;
}

/** Turns (of the side to move) until the skill unlocks; 0 once unlocked. */
export function skillUnlockIn(state: Pick<GameState, 'ply'>): number {
  return Math.max(0, Math.ceil((SKILL_UNLOCK_PLY - state.ply) / 2));
}

/**
 * Could `player` cast a skill on its turn (ignoring whose turn it is now)? Every skill piece counts
 * (a squad may field Brutile and Rakaeli). `ignoreStun`: could it once a doll trap lets the caster go.
 */
function sideCanCast(state: GameState, player: PlayerId, ignoreStun = false): boolean {
  if (state.bonusPieceId !== null) return false;
  let asPlayer: GameState | null = null;
  for (const p of state.pieces) {
    if (p.owner !== player || !CHARACTERS[p.character].skill) continue;
    asPlayer ??= { ...state, turn: player };
    const block = skillBlock(asPlayer, p.id);
    if (block !== null && !(ignoreStun && block === 'stunned')) continue;
    // A transform or a melody is always castable when unblocked (its anchor is his own square); a
    // wasteland needs a free area and a teleport a free square.
    const kind = skillKindOf(p.character);
    // (A freeze with nobody in range is blocked as 'noTarget' already.)
    if (kind === 'waste' ? freeAnchors(state, p.level).length > 0 : kind === 'blink' ? blinkAnchors(state, p.owner).length > 0 : true) return true;
  }
  return false;
}

/**
 * Valid anchors for `pieceId`'s skill: for Brutile's wasteland every corner whose whole area is on
 * the board, free of pieces and out of the storm; for Midos's teleport every free square (see
 * `blinkAnchors`); for Rakaeli's transform and Volkonov's melody his own square only.
 */
export function skillAnchors(state: GameState, pieceId: string): Pos[] {
  if (skillBlock(state, pieceId) !== null) return [];
  const p = state.pieces.find((x) => x.id === pieceId)!;
  const kind = skillKindOf(p.character);
  if (kind === 'waste') return freeAnchors(state, p.level);
  if (kind === 'blink') return blinkAnchors(state, p.owner);
  if (kind === 'freeze') return freezeAnchors(state, p);
  return [{ r: p.pos.r, c: p.pos.c }];
}

/**
 * Enemies Glacia's "빙결" can freeze: within GLACIA_FREEZE[level] squares of her (Chebyshev
 * distance: rows and columns both), not stunned already. Board order (by square).
 */
export function freezeAnchors(state: Pick<GameState, 'pieces'>, caster: Pick<Piece, 'owner' | 'pos' | 'level'>): Pos[] {
  const R = GLACIA_FREEZE[caster.level];
  return state.pieces
    .filter((q) => q.owner !== caster.owner && !isStunned(q) && Math.max(Math.abs(q.pos.r - caster.pos.r), Math.abs(q.pos.c - caster.pos.c)) <= R)
    .map((q) => ({ r: q.pos.r, c: q.pos.c }))
    .sort((a, b) => sqOf(a) - sqOf(b));
}

/**
 * Squares a Midos of `owner` may teleport to ("그림자 도약": "비어있는 칸"): no piece, no wasteland
 * (he would die there), no doll trap of the OTHER side (traps are visible to both players, so a
 * teleport onto one would only ever be a misclick) and out of the storm (a safety net: skills are
 * sealed once it closes in). His own side's traps never catch him, so they are fine. Board order.
 */
export function blinkAnchors(state: Pick<GameState, 'pieces' | 'waste' | 'traps' | 'storm'>, owner: PlayerId): Pos[] {
  const blocked = new Uint8Array(N_SQUARES);
  for (const q of state.pieces) blocked[sqOf(q.pos)] = 1;
  for (const s of state.waste) blocked[s] = 1;
  for (const t of state.traps ?? []) if (t.owner !== owner) blocked[t.sq] = 1;
  const out: Pos[] = [];
  for (let s = 0; s < N_SQUARES; s++) {
    if (blocked[s]) continue;
    const pos = posOf(s);
    if (inStorm(pos.r, pos.c, state.storm)) continue;
    out.push(pos);
  }
  return out;
}

function freeAnchors(state: GameState, level: number): Pos[] {
  const k = WASTE_SIZE[level];
  const occupied = new Uint8Array(N_SQUARES);
  for (const q of state.pieces) occupied[sqOf(q.pos)] = 1;
  // Storm squares are never a target (skills are forbidden once it closes in: a safety net).
  if (state.storm > 0) for (let s = 0; s < N_SQUARES; s++) if (inStorm((s / BOARD_SIZE) | 0, s % BOARD_SIZE, state.storm)) occupied[s] = 1;
  const out: Pos[] = [];
  for (let r = 0; r + k <= BOARD_SIZE; r++) {
    for (let c = 0; c + k <= BOARD_SIZE; c++) {
      let ok = true;
      for (let dr = 0; dr < k && ok; dr++) for (let dc = 0; dc < k && ok; dc++) if (occupied[(r + dr) * BOARD_SIZE + c + dc]) ok = false;
      if (ok) out.push({ r, c });
    }
  }
  return out;
}

export function isLegalSkill(state: GameState, action: SkillAction): boolean {
  if (!action || action.kind !== 'skill' || !action.anchor) return false;
  return skillAnchors(state, action.pieceId).some((a) => samePos(a, action.anchor));
}

/**
 * Pure: the skill is the player's action for the turn. Brutile lays its wasteland; Rakaeli
 * transforms (`awaken` = AWAKEN_TURNS, which the turn change at once counts down to 2); Volkonov
 * buffs every other piece of his side (`buff` = BUFF_TURNS[level] + 1, counted down the same way);
 * Midos teleports to the anchor (no capture; landing on the far edge turns him around like a move).
 * Either way the caster's `skillUsed` is set. Throws if illegal.
 */
export function applySkill(state: GameState, action: SkillAction): GameState {
  if (!isLegalSkill(state, action)) throw new Error(`Illegal skill: ${JSON.stringify(action)}`);
  const p = state.pieces.find((x) => x.id === action.pieceId)!;
  const kind = skillKindOf(p.character);
  if (kind === 'blink') return applyBlink(state, p, action.anchor);
  if (kind === 'freeze') return applyFreeze(state, p, action.anchor);
  const transform = kind === 'transform';
  const buffs = kind === 'buff';
  const squares = kind === 'waste' ? wasteArea(p.level, action.anchor) : [];
  const waste = kind === 'waste' ? [...new Set([...state.waste, ...squares])].sort((a, b) => a - b) : state.waste;
  const buffed: string[] = [];
  const pieces = state.pieces.map((x) => {
    if (x.id === p.id) return transform ? { ...x, skillUsed: true as const, awaken: AWAKEN_TURNS } : { ...x, skillUsed: true as const };
    if (buffs && x.owner === p.owner) {
      buffed.push(x.id);
      return { ...x, buff: BUFF_TURNS[p.level] + 1 };
    }
    return x;
  });
  const used: [number, number] = [state.skillsUsed[0], state.skillsUsed[1]];
  used[p.owner] += 1;
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[p.owner] = 0;
  const entry: HistoryEntry = transform
    ? { kind: 'skill', player: p.owner, pieceId: p.id, squares: [], transform: true }
    : buffs
      ? { kind: 'skill', player: p.owner, pieceId: p.id, squares: [], buffed }
      : { kind: 'skill', player: p.owner, pieceId: p.id, squares };
  return settle(switchTurn({ ...state, pieces, waste, skillsUsed: used, consecutiveTimeouts: ct }, entry, state.pliesSinceCapture + 1));
}

/** Midos's "그림자 도약": `p` teleports to the free square `to` (legality checked by the caller). */
function applyBlink(state: GameState, p: Piece, to: Pos): GameState {
  const d = pieceDir(p);
  const turned = !keepsDirection(CHAR_CODE[p.character]) && atTurnRow(to.r, d);
  const pieces = state.pieces.map((x) => {
    if (x.id !== p.id) return x;
    const moved: Piece = { ...x, pos: { r: to.r, c: to.c }, skillUsed: true as const };
    if (turned) moved.dir = d === 1 ? -1 : 1;
    return moved;
  });
  const used: [number, number] = [state.skillsUsed[0], state.skillsUsed[1]];
  used[p.owner] += 1;
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[p.owner] = 0;
  const blink: { from: number; to: number; turned?: true } = { from: sqOf(p.pos), to: sqOf(to) };
  if (turned) blink.turned = true;
  const entry: HistoryEntry = { kind: 'skill', player: p.owner, pieceId: p.id, squares: [], blink };
  return settle(switchTurn({ ...state, pieces, skillsUsed: used, consecutiveTimeouts: ct }, entry, state.pliesSinceCapture + 1));
}

/** Glacia's "빙결": the enemy on `at` sits out its owner's next turn (legality checked by the caller). */
function applyFreeze(state: GameState, p: Piece, at: Pos): GameState {
  const target = state.pieces.find((q) => q.pos.r === at.r && q.pos.c === at.c)!;
  const pieces = state.pieces.map((x) => {
    if (x.id === p.id) return { ...x, skillUsed: true as const };
    if (x.id === target.id) return { ...x, stun: Math.max(x.stun ?? 0, OFF_TURN_STUN) };
    return x;
  });
  const used: [number, number] = [state.skillsUsed[0], state.skillsUsed[1]];
  used[p.owner] += 1;
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[p.owner] = 0;
  const entry: HistoryEntry = { kind: 'skill', player: p.owner, pieceId: p.id, squares: [], frozen: target.id };
  return settle(switchTurn({ ...state, pieces, skillsUsed: used, consecutiveTimeouts: ct }, entry, state.pliesSinceCapture + 1));
}

/** The player declines the pending chain move. No-op when none is pending. */
export function skipBonus(state: GameState): GameState {
  if (state.status !== 'playing' || state.bonusPieceId === null) return state;
  return settle(switchTurn(state, { kind: 'pass', player: state.turn, reason: 'bonusSkip' }, state.pliesSinceCapture + 1));
}

/**
 * The side to move ran out of turn time: it forfeits at once ('timeoutForfeit'). Exception: letting
 * a pending chain move lapse is not a forfeit (the player already moved this turn), it just skips it.
 */
export function applyTimeout(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  if (state.bonusPieceId !== null) return skipBonus(state);
  const player = state.turn;
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[player] += 1;
  const entry: HistoryEntry = { kind: 'pass', player, reason: 'timeout' };
  return end({ ...state, consecutiveTimeouts: ct, history: [...state.history, entry] }, other(player), 'timeoutForfeit');
}

export function resign(state: GameState, player: PlayerId): GameState {
  if (state.status !== 'playing') return state;
  return end({ ...state }, other(player), 'resign');
}
