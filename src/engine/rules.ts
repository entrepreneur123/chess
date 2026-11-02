import { MAX_CONSECUTIVE_TIMEOUTS, STORM_INTERVAL_PLIES, SUDDEN_DEATH_PLY, TURN_TIME_1_MS, TURN_TIME_2_MS, TURN_TIME_MS } from './types';
import type { AbsorbedAbility, Formation, GameState, HistoryEntry, Move, PassReason, Piece, PlayerId, Pos } from './types';
import { CHAR_CODE, absorbMaskOf, effectiveValue } from './characters';
import { N_SQUARES, atTurnRow, formationToAbsolute, forwardDir, genTargets, inStorm, isOnBoard, posOf, sqOf } from './board';
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

/** Current forward direction of a piece (forward-only movers turn around at the far edge). */
export function pieceDir(piece: Pick<Piece, 'owner' | 'dir'>): 1 | -1 {
  return piece.dir ?? forwardDir(piece.owner);
}

function countTargets(occ: Int8Array, owners: Uint8Array, piece: Piece, storm: number): number {
  return genTargets(occ, owners, piece.owner, CHAR_CODE[piece.character], piece.level, sqOf(piece.pos), tmpTargets, 0, false, pieceDir(piece), storm, absorbMaskOf(piece.absorbed));
}

function targetsWith(pieces: Piece[], occ: Int8Array, owners: Uint8Array, piece: Piece, storm: number): Move[] {
  const n = countTargets(occ, owners, piece, storm);
  const moves: Move[] = [];
  for (let i = 0; i < n; i++) {
    const s = tmpTargets[i];
    const m: Move = { pieceId: piece.id, from: { r: piece.pos.r, c: piece.pos.c }, to: posOf(s) };
    const o = occ[s];
    if (o >= 0) m.captureId = pieces[o].id;
    moves.push(m);
  }
  return moves;
}

/** Pseudo-moves for ANY piece regardless of whose turn it is (for previewing reach). */
export function getTargetsForPiece(state: GameState, piece: Piece): Move[] {
  const { occ, owners } = buildOccupancy(state.pieces);
  return targetsWith(state.pieces, occ, owners, piece, state.storm);
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
    for (const m of targetsWith(state.pieces, occ, owners, p, state.storm)) out.push(m);
  }
  return out;
}

function hasAnyMove(pieces: Piece[], player: PlayerId, storm: number, onlyPieceId: string | null = null): boolean {
  const { occ, owners } = buildOccupancy(pieces);
  for (const p of pieces) {
    if (p.owner !== player) continue;
    if (onlyPieceId !== null && p.id !== onlyPieceId) continue;
    if (countTargets(occ, owners, p, storm) > 0) return true;
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

function countPieces(pieces: Piece[], player: PlayerId): number {
  let n = 0;
  for (const p of pieces) if (p.owner === player) n++;
  return n;
}

/**
 * Time allowed for the current turn: 60 s normally, 40 s once either side is down to two pieces,
 * 20 s once either side is down to one.
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
    turn: other(state.turn),
    ply: state.ply + 1,
    pliesSinceCapture,
    bonusPieceId: null,
    history: [...state.history, entry],
  };
  if (next.stormIn !== null) {
    const left = next.stormIn - 1;
    if (left > 0) next = { ...next, stormIn: left };
    else {
      const storm = next.storm + 1;
      const killed: string[] = [];
      const pieces = next.pieces.filter((p) => {
        if (!inStorm(p.pos.c, storm)) return true;
        killed.push(p.id);
        return false;
      });
      next = { ...next, storm, stormIn: STORM_INTERVAL_PLIES, pieces, history: [...next.history, { kind: 'storm', storm, killed }] };
      // The storm swallowed the last pieces of BOTH sides at once: decided by what was lost.
      if (pieces.length === 0 && killed.length > 0) {
        const gone = state.pieces.filter((p) => killed.includes(p.id));
        return end(next, adjudicate({ ...next, pieces: gone }), 'storm');
      }
    }
  }
  return next;
}

/**
 * Post-ply bookkeeping: elimination (by capture or storm), storm activation (one piece left or
 * sudden death), chain moves that cannot be played, and automatic passes when the side to move has
 * no legal moves (stalemate if neither side can move).
 * `state` must already be a fresh object owned by the caller.
 */
function settle(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  for (;;) {
    const n0 = countPieces(state.pieces, 0);
    const n1 = countPieces(state.pieces, 1);
    if (n0 === 0 || n1 === 0) {
      const last = state.history[state.history.length - 1];
      return end(state, n0 > 0 ? 0 : n1 > 0 ? 1 : null, last?.kind === 'storm' ? 'storm' : 'elimination');
    }
    if (state.stormIn === null && (n0 <= 1 || n1 <= 1 || state.ply >= SUDDEN_DEATH_PLY)) state = { ...state, stormIn: STORM_INTERVAL_PLIES };
    if (state.bonusPieceId !== null) {
      if (hasAnyMove(state.pieces, state.turn, state.storm, state.bonusPieceId)) return state;
      // The chaining piece is boxed in: the chain move lapses.
      state = switchTurn(state, { kind: 'pass', player: state.turn, reason: 'bonusSkip' }, state.pliesSinceCapture + 1);
      continue;
    }
    if (hasAnyMove(state.pieces, state.turn, state.storm)) return state;
    if (!hasAnyMove(state.pieces, other(state.turn), state.storm)) return end(state, adjudicate(state), 'stalemate');
    state = switchTurn(state, { kind: 'pass', player: state.turn, reason: 'noMoves' }, state.pliesSinceCapture + 1);
  }
}

/** Plies left before sudden death starts the storm; null once the storm is active (or the game ended). */
export function suddenDeathIn(state: Pick<GameState, 'ply' | 'stormIn' | 'status'>): number | null {
  if (state.status !== 'playing' || state.stormIn !== null) return null;
  return Math.max(0, SUDDEN_DEATH_PLY - state.ply);
}

/** The match clock (MATCH_TIME_MS) ran out: the game is decided by remaining material. */
export function applyTimeUp(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  return end({ ...state, bonusPieceId: null }, adjudicate(state), 'timeUp');
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
  const victim = legal.captureId ? state.pieces.find((p) => p.id === legal.captureId) : undefined;
  const pieces: Piece[] = [];
  let moved: Piece | null = null;
  for (const p of state.pieces) {
    if (victim && p.id === victim.id) continue;
    if (p.id === legal.pieceId) {
      moved = { ...p, pos: { r: legal.to.r, c: legal.to.c } };
      // Forward-only movers turn around when they reach the last row in their direction.
      if (p.character !== 'sad') {
        const d = pieceDir(p);
        if (atTurnRow(moved.pos.r, d)) moved.dir = d === 1 ? -1 : 1;
      }
      // Insaner steals the movement pattern of whatever it captures.
      if (p.character === 'insaner' && victim) moved.absorbed = absorbInto(p, victim);
      pieces.push(moved);
    } else pieces.push(p);
  }
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[player] = 0;
  const recorded: Move = { pieceId: legal.pieceId, from: { ...legal.from }, to: { ...legal.to } };
  if (legal.captureId) recorded.captureId = legal.captureId;
  const entry: HistoryEntry = { kind: 'move', player, move: recorded };
  const psc = legal.captureId ? 0 : state.pliesSinceCapture + 1;
  const base: GameState = { ...state, pieces, consecutiveTimeouts: ct };
  // Chain move: a Level-3 Insaner that captures moves once more (one extra move per turn).
  if (victim && mover.character === 'insaner' && mover.level === 3 && state.bonusPieceId === null) {
    return settle({ ...base, ply: state.ply + 1, pliesSinceCapture: psc, bonusPieceId: mover.id, history: [...state.history, entry] });
  }
  return settle(switchTurn(base, entry, psc));
}

/** The player declines the pending chain move. No-op when none is pending. */
export function skipBonus(state: GameState): GameState {
  if (state.status !== 'playing' || state.bonusPieceId === null) return state;
  return settle(switchTurn(state, { kind: 'pass', player: state.turn, reason: 'bonusSkip' }, state.pliesSinceCapture + 1));
}

/** The side to move ran out of time: pass the turn, or forfeit after MAX_CONSECUTIVE_TIMEOUTS. */
export function applyTimeout(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  // Letting a chain move lapse is not a timeout strike: the player already moved this turn.
  if (state.bonusPieceId !== null) return skipBonus(state);
  const player = state.turn;
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[player] += 1;
  const reason: PassReason = 'timeout';
  const next = switchTurn({ ...state, consecutiveTimeouts: ct }, { kind: 'pass', player, reason }, state.pliesSinceCapture + 1);
  if (ct[player] >= MAX_CONSECUTIVE_TIMEOUTS) return end(next, other(player), 'timeoutForfeit');
  return settle(next);
}

export function resign(state: GameState, player: PlayerId): GameState {
  if (state.status !== 'playing') return state;
  return end({ ...state }, other(player), 'resign');
}
