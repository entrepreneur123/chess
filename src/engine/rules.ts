import { MAX_CONSECUTIVE_TIMEOUTS, NO_CAPTURE_PLY_LIMIT } from './types';
import type { Formation, GameState, HistoryEntry, Move, Piece, PlayerId, Pos } from './types';
import { CHAR_CODE, pieceValue } from './characters';
import { N_SQUARES, formationToAbsolute, genTargets, isOnBoard, posOf, sqOf } from './board';
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

const tmpTargets = new Int16Array(64);

function targetsWith(pieces: Piece[], occ: Int8Array, owners: Uint8Array, piece: Piece): Move[] {
  const n = genTargets(occ, owners, piece.owner, CHAR_CODE[piece.character], piece.level, sqOf(piece.pos), tmpTargets, 0);
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
  return targetsWith(state.pieces, occ, owners, piece);
}

/** Legal moves of the side to move (optionally for a single piece). [] if the game has ended. */
export function getLegalMoves(state: GameState, pieceId?: string): Move[] {
  if (state.status !== 'playing') return [];
  const { occ, owners } = buildOccupancy(state.pieces);
  const out: Move[] = [];
  for (const p of state.pieces) {
    if (p.owner !== state.turn) continue;
    if (pieceId !== undefined && p.id !== pieceId) continue;
    for (const m of targetsWith(state.pieces, occ, owners, p)) out.push(m);
  }
  return out;
}

function hasAnyMove(pieces: Piece[], player: PlayerId): boolean {
  const { occ, owners } = buildOccupancy(pieces);
  for (const p of pieces) {
    if (p.owner !== player) continue;
    if (genTargets(occ, owners, p.owner, CHAR_CODE[p.character], p.level, sqOf(p.pos), tmpTargets, 0) > 0) return true;
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
  for (const p of state.pieces) if (p.owner === player) s += pieceValue(p.character, p.level);
  return s;
}

/** Winner by material, or null for a draw. */
export function adjudicate(state: GameState): PlayerId | null {
  const a = materialScore(state, 0);
  const b = materialScore(state, 1);
  return a > b ? 0 : b > a ? 1 : null;
}

function end(state: GameState, winner: PlayerId | null, reason: GameState['endReason']): GameState {
  return { ...state, status: 'ended', winner, endReason: reason };
}

/**
 * Post-ply bookkeeping: elimination, ply-limit adjudication, and automatic passes when the
 * side to move has no legal moves (stalemate if neither side can move).
 * `state` must already be a fresh object owned by the caller.
 */
function settle(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  for (;;) {
    const has0 = state.pieces.some((p) => p.owner === 0);
    const has1 = state.pieces.some((p) => p.owner === 1);
    if (!has0 || !has1) return end(state, has0 ? 0 : has1 ? 1 : null, 'elimination');
    if (state.pliesSinceCapture >= NO_CAPTURE_PLY_LIMIT) return end(state, adjudicate(state), 'moveLimit');
    if (hasAnyMove(state.pieces, state.turn)) return state;
    if (!hasAnyMove(state.pieces, other(state.turn))) return end(state, adjudicate(state), 'stalemate');
    const entry: HistoryEntry = { kind: 'pass', player: state.turn, reason: 'noMoves' };
    state = {
      ...state,
      turn: other(state.turn),
      ply: state.ply + 1,
      pliesSinceCapture: state.pliesSinceCapture + 1,
      history: [...state.history, entry],
    };
  }
}

/** Pure: returns a new state. Throws if the game is over or the move is illegal. */
export function applyMove(state: GameState, move: Move): GameState {
  if (state.status !== 'playing') throw new Error('Game is already over');
  if (!move || !move.from || !move.to) throw new Error('Malformed move');
  const legal = getLegalMoves(state, move.pieceId).find((m) => samePos(m.from, move.from) && samePos(m.to, move.to));
  if (!legal) throw new Error(`Illegal move: ${JSON.stringify(move)}`);
  const player = state.turn;
  const pieces: Piece[] = [];
  for (const p of state.pieces) {
    if (legal.captureId && p.id === legal.captureId) continue;
    if (p.id === legal.pieceId) pieces.push({ ...p, pos: { r: legal.to.r, c: legal.to.c } });
    else pieces.push(p);
  }
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[player] = 0;
  const recorded: Move = { pieceId: legal.pieceId, from: { ...legal.from }, to: { ...legal.to } };
  if (legal.captureId) recorded.captureId = legal.captureId;
  return settle({
    ...state,
    pieces,
    turn: other(player),
    ply: state.ply + 1,
    pliesSinceCapture: legal.captureId ? 0 : state.pliesSinceCapture + 1,
    consecutiveTimeouts: ct,
    history: [...state.history, { kind: 'move', player, move: recorded }],
  });
}

/** The side to move ran out of time: pass the turn, or forfeit after MAX_CONSECUTIVE_TIMEOUTS. */
export function applyTimeout(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  const player = state.turn;
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[player] += 1;
  const next: GameState = {
    ...state,
    turn: other(player),
    ply: state.ply + 1,
    pliesSinceCapture: state.pliesSinceCapture + 1,
    consecutiveTimeouts: ct,
    history: [...state.history, { kind: 'pass', player, reason: 'timeout' }],
  };
  if (ct[player] >= MAX_CONSECUTIVE_TIMEOUTS) return end(next, other(player), 'timeoutForfeit');
  return settle(next);
}

export function resign(state: GameState, player: PlayerId): GameState {
  if (state.status !== 'playing') return state;
  return end({ ...state }, other(player), 'resign');
}

