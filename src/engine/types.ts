/**
 * Shared engine contract. Every module (engine, AI, renderer, UI) depends on these types.
 * Do not change shapes without updating all consumers.
 *
 * Coordinate system (absolute, board-wide):
 *   r = row 0..11, c = column 0..11.
 *   Player 0 (you / "Blue") owns home rows 0..2 and moves "forward" toward r = 11 (+1).
 *   Player 1 (opponent / "Red") owns home rows 9..11 and moves "forward" toward r = 0 (-1).
 *   The renderer shows player 0 at the bottom of the screen.
 */

export const BOARD_SIZE = 12;
export const ZONE_DEPTH = 3; // each player places pieces only within their own 3 x 12 home zone
export const PIECES_PER_SIDE = 3;
export const TURN_TIME_MS = 60_000; // 1 minute per turn
/** Plies (half-moves, passes included) without any capture before the game is adjudicated. */
export const NO_CAPTURE_PLY_LIMIT = 60;
/** A player who times out this many turns in a row forfeits (anti-AFK). */
export const MAX_CONSECUTIVE_TIMEOUTS = 3;

export type PlayerId = 0 | 1;
export type CharacterId = 'sad' | 'marki' | 'walk';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type Level = 1 | 2 | 3;

export interface Pos {
  r: number;
  c: number;
}

export interface Piece {
  /** Stable unique id for the whole game, e.g. "p0-sad". Used by the renderer to track meshes. */
  id: string;
  owner: PlayerId;
  character: CharacterId;
  level: Level;
  pos: Pos;
  /**
   * Forward direction (+1 toward r=11, -1 toward r=0). Defaults to forwardDir(owner).
   * Forward-only movers (marki, walk) turn around when they reach the last row they can advance to,
   * so they are never stuck at the far edge. Renderers should face the piece by this value.
   */
  dir?: 1 | -1;
}

/**
 * Formation slot in LOCAL coordinates of its owner:
 *   row 0 = owner's back rank, row 2 = front of the zone; col 0 = owner's left.
 *   For player 0: absolute = { r: row, c: col }.
 *   For player 1 (rotated 180deg like a real chess board): absolute = { r: 11 - row, c: 11 - col }.
 */
export interface FormationSlot {
  character: CharacterId;
  level: Level;
  row: number; // 0..2
  col: number; // 0..11
}

/** Exactly PIECES_PER_SIDE slots, distinct characters, distinct squares, all inside the zone. */
export type Formation = FormationSlot[];

export interface Move {
  pieceId: string;
  from: Pos;
  to: Pos;
  /** Id of the enemy piece captured on `to`, if any. */
  captureId?: string;
}

export type EndReason =
  | 'elimination' // all enemy pieces captured
  | 'timeoutForfeit' // MAX_CONSECUTIVE_TIMEOUTS reached
  | 'resign'
  | 'moveLimit' // NO_CAPTURE_PLY_LIMIT reached -> adjudicated by material
  | 'stalemate'; // neither side has any legal move -> adjudicated by material

export type HistoryEntry =
  | { kind: 'move'; player: PlayerId; move: Move }
  | { kind: 'pass'; player: PlayerId; reason: 'timeout' | 'noMoves' };

export interface GameState {
  pieces: Piece[]; // only pieces still on the board
  turn: PlayerId;
  ply: number; // number of half-moves/passes played so far
  pliesSinceCapture: number;
  consecutiveTimeouts: [number, number];
  status: 'playing' | 'ended';
  winner: PlayerId | null; // null + status 'ended' = draw
  endReason: EndReason | null;
  history: HistoryEntry[];
}

export interface CharacterDef {
  id: CharacterId;
  nameKo: string; // display name, e.g. "사드"
  nameEn: string; // e.g. "Sad"
  rarity: Rarity;
  /** Short Korean description per level, index 0 = level 1. */
  descKo: [string, string, string];
  /** Material value used by AI and adjudication, per level. */
  value: [number, number, number];
}
