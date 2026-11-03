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
export const PIECES_PER_SIDE = 3; // a squad is any 3 distinct characters
/** Base time per turn. It shrinks as pieces are lost: see `turnTimeMsFor`. */
export const TURN_TIME_MS = 45_000;
/** Time per turn once either side is down to 2 pieces or fewer. */
export const TURN_TIME_2_MS = 40_000;
/** Time per turn once either side is down to 1 piece. */
export const TURN_TIME_1_MS = 20_000;
/**
 * Running out of turn time forfeits the match at once (no strikes). Kept as a constant (= 1) so
 * `consecutiveTimeouts` stays meaningful for consumers that still read it.
 */
export const MAX_CONSECUTIVE_TIMEOUTS = 1;
/**
 * Storm ("자기장"): once active, every STORM_INTERVAL_PLIES turn changes (3 moves each) the
 * outermost left AND right columns become storm. A piece standing in a storm column is removed at
 * once; nothing may move into or through the storm.
 */
export const STORM_INTERVAL_PLIES = 6;
/**
 * Sudden death: the storm activates when either side is down to its last piece, or on its own once
 * this many plies were played (40 turns each, see `turnNumber`: turn 41 starts at ply 80).
 * Together with STORM_INTERVAL_PLIES this bounds a match to SUDDEN_DEATH_PLY + 6 *
 * STORM_INTERVAL_PLIES = 116 plies (after 6 shrinks the storm has swallowed the whole board).
 */
export const SUDDEN_DEATH_PLY = 80;
/**
 * Brutile's skill "불모지" (wasteland) unlocks once both players have taken 3 turns (ply 6: turn 4 as
 * `turnNumber` counts it) and is forbidden once the storm has started to close in (storm >= 1).
 */
export const SKILL_UNLOCK_PLY = 6;
/** How many times a side may use its skill per match. */
export const SKILL_USES_PER_MATCH = 1;

export type PlayerId = 0 | 1;
export type CharacterId = 'sad' | 'marki' | 'walk' | 'insaner' | 'brutile';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type Level = 1 | 2 | 3;

export interface Pos {
  r: number;
  c: number;
}

/** A movement ability stolen from a captured piece (Insaner's passive). */
export interface AbsorbedAbility {
  character: CharacterId;
  level: Level;
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
  /**
   * Movement abilities absorbed from captured enemies (Insaner only). The piece moves with the
   * union of its own pattern and every absorbed pattern. Absent or empty for everyone else.
   */
  absorbed?: AbsorbedAbility[];
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
  /** Set on recorded moves: `to` was wasteland, so the mover was destroyed there. */
  wasted?: true;
}

/** Brutile's skill: lay a k x k wasteland whose lowest-row, lowest-column square is `anchor`. */
export interface SkillAction {
  kind: 'skill';
  pieceId: string;
  anchor: Pos;
}

export type EndReason =
  | 'elimination' // all enemy pieces captured
  | 'storm' // the last piece(s) of a side were swallowed by the storm (both at once: by material)
  | 'timeoutForfeit' // the side to move ran out of turn time: it loses at once
  | 'resign'
  | 'stalemate' // neither side has any legal move -> adjudicated by material
  /** @deprecated The match clock was removed; the engine never produces this any more. */
  | 'timeUp'
  | 'waste'; // the last piece of a side stepped onto wasteland

export type PassReason =
  | 'timeout'
  | 'noMoves'
  /** The player declined (or could not use) a chain move after a capture. */
  | 'bonusSkip';

export type HistoryEntry =
  | { kind: 'move'; player: PlayerId; move: Move }
  | { kind: 'pass'; player: PlayerId; reason: PassReason }
  /** The storm advanced to `storm` columns per side and removed the listed pieces. */
  | { kind: 'storm'; storm: number; killed: string[] }
  /** `pieceId` (Brutile) laid wasteland on `squares` (square indices r * 12 + c). */
  | { kind: 'skill'; player: PlayerId; pieceId: string; squares: number[] };

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
  /**
   * Chain move: after a Level-3 Insaner captures, the SAME player moves again, but only with that
   * piece (one extra move per turn). Null when no chain move is pending.
   */
  bonusPieceId: string | null;
  /** Columns swallowed by the storm on each side (0 = none; 2 = columns 0,1 and 10,11 are gone). */
  storm: number;
  /**
   * Turn changes until the storm advances next; null while the storm is not active yet. The storm
   * starts when a side is down to one piece or at SUDDEN_DEATH_PLY, whichever comes first.
   */
  stormIn: number | null;
  /**
   * Wasteland squares (r * 12 + c), sorted. A piece whose move touches wasteland (stops on it, or
   * slides into it: slides end there) is destroyed. Wasteland never holds a piece.
   */
  waste: number[];
  /** Skill uses so far per player. */
  skillsUsed: [number, number];
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
  /** Passive ability copy (UI only), if the character has one. */
  passiveKo?: string;
  /** Active skill (UI copy), if the character has one; `descKo` per level. */
  skill?: { nameKo: string; descKo: [string, string, string] };
}
