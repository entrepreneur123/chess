/**
 * Shared engine contract. Every module (engine, AI, renderer, UI) depends on these types.
 * Do not change shapes without updating all consumers.
 *
 * Coordinate system (absolute, board-wide), with N = BOARD_SIZE (10) and Z = ZONE_DEPTH (2):
 *   r = row 0..N-1, c = column 0..N-1.
 *   Player 0 (you / "Blue") owns home rows 0..Z-1 and moves "forward" toward r = N-1 (+1).
 *   Player 1 (opponent / "Red") owns home rows N-Z..N-1 and moves "forward" toward r = 0 (-1).
 *   The renderer shows player 0 at the bottom of the screen.
 *
 * Every board-size assumption in the code base derives from these two constants (square indices
 * are r * BOARD_SIZE + c and must stay below 256: moves pack them into 8 bits).
 */

/** Rows and columns of the (square) board. */
export const BOARD_SIZE = 10;
/** Home-zone depth in rows: each player places pieces only within their own ZONE_DEPTH x BOARD_SIZE zone. */
export const ZONE_DEPTH = 2;
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
 * Storm ("자기장"): once active, every STORM_INTERVAL_PLIES turn changes (2 moves each) the
 * outermost left AND right columns become storm; from step STORM_ROWS_FROM on the outermost top AND
 * bottom rows close in too (see `stormRows`). A piece standing on a storm square is removed at
 * once; nothing may move into or through the storm.
 */
export const STORM_INTERVAL_PLIES = 4;
/**
 * Sudden death: the storm activates when either side is down to its last piece, or on its own once
 * this many plies were played: at the start of turn 20 (`turnNumber`: turn 20 starts at ply 38,
 * after 19 turns each). From then on it closes in every STORM_INTERVAL_PLIES = 4 plies = 2 turns.
 */
export const SUDDEN_DEATH_PLY = 38;
/**
 * Storm advances needed to swallow the whole board: each one closes a column on BOTH sides, so
 * ceil(BOARD_SIZE / 2) = 5 on 10 columns (after the 5th, columns 0..4 and 5..9 are all storm).
 */
export const STORM_FULL_STEPS = Math.ceil(BOARD_SIZE / 2);
/**
 * From this storm step on (3 columns per side), the storm also closes in from the top and bottom:
 * one row on each end at step 3, one more per later step (`stormRows`).
 */
export const STORM_ROWS_FROM = 3;
/** Rows swallowed at EACH end (top and bottom) by a storm of `storm` columns per side. */
export function stormRows(storm: number): number {
  return storm >= STORM_ROWS_FROM ? storm - STORM_ROWS_FROM + 1 : 0;
}
/**
 * Upper bound on the turn changes of a match: the storm starts at SUDDEN_DEATH_PLY at the latest
 * and swallows the board STORM_FULL_STEPS * STORM_INTERVAL_PLIES turn changes later, so
 * 38 + 5 * 4 = 58 plies (29 turns each). Only a level-3 Insaner's chain moves (an extra ply that is
 * not a turn change) can push `GameState.ply` past it, by one ply per chain move.
 */
export const MAX_MATCH_PLIES = SUDDEN_DEATH_PLY + STORM_FULL_STEPS * STORM_INTERVAL_PLIES;
/**
 * Brutile's skill "불모지" (wasteland) unlocks once both players have taken 3 turns (ply 6: turn 4 as
 * `turnNumber` counts it) and is forbidden once the storm has started to close in (storm >= 1).
 */
export const SKILL_UNLOCK_PLY = 6;
/**
 * How many times each skill character may use its skill per match. Use is tracked per piece
 * (`Piece.skillUsed`), so a squad with two skill characters (Brutile and Rakaeli) can cast both.
 */
export const SKILL_USES_PER_MATCH = 1;
/**
 * Rakaeli's skill "타천" (transform): `Piece.awaken` is set to this on cast and counts down at the
 * end of each of its owner's turns, the casting turn included, so he makes exactly
 * AWAKEN_TURNS - 1 = 2 transformed moves.
 */
export const AWAKEN_TURNS = 3;
/** Michelle's doll traps: the first this-many backward moves of a match each leave one. */
export const TRAPS_PER_MICHELLE = 3;
/**
 * A piece caught by an enemy doll trap gets this many "owner turns" of stun; the turn it was caught
 * in counts down at once (see `Piece.stun`), so it sits out exactly its owner's next turn.
 */
export const TRAP_STUN = 2;

export type PlayerId = 0 | 1;
/** What an active skill does: lay wasteland (Brutile) or transform (Rakaeli). */
export type SkillKind = 'waste' | 'transform';
export type CharacterId = 'sad' | 'marki' | 'walk' | 'insaner' | 'brutile' | 'michelle' | 'picker' | 'rakaeli';
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
   * Forward direction (+1 toward r = BOARD_SIZE - 1, -1 toward r = 0). Defaults to forwardDir(owner).
   * Forward-only movers (marki, walk) turn around when they reach the last row they can advance to,
   * so they are never stuck at the far edge. Renderers should face the piece by this value.
   */
  dir?: 1 | -1;
  /**
   * Movement abilities absorbed from captured enemies (Insaner only). The piece moves with the
   * union of its own pattern and every absorbed pattern's RANGE, never the victim's traits or
   * skills: an absorbed Picker pattern is a plain diagonal slide (no hop-through), Michelle's traps,
   * Brutile's wasteland and Rakaeli's transform stay with them. Absent or empty for everyone else.
   */
  absorbed?: AbsorbedAbility[];
  /**
   * Doll-trap stun (Michelle's trait). While > 0 the piece generates no moves and cannot cast.
   * Set to TRAP_STUN when it ends a move on an enemy trap; every time its OWNER's turn ends it
   * counts down by one, so it sits out exactly its owner's next turn. Absent / 0 = free.
   */
  stun?: number;
  /**
   * Rakaeli's transform ("타천"). While > 0 he moves with his transformed pattern. Set to
   * AWAKEN_TURNS on cast; like `stun` it counts down by one at the end of each of its OWNER's turns
   * (the casting turn included), so it reads 2 right after the cast and equals the transformed
   * moves left. Deleted when it reaches 0. A stun does not pause it; the storm does not end it.
   */
  awaken?: number;
  /** This piece has used its active skill this match (once per skill character). */
  skillUsed?: true;
}

/** A doll trap Michelle left on square `sq` (r * BOARD_SIZE + c). It never disappears during a match. */
export interface Trap {
  sq: number;
  owner: PlayerId;
}

/**
 * Formation slot in LOCAL coordinates of its owner:
 *   row 0 = owner's back rank, row ZONE_DEPTH - 1 = front of the zone; col 0 = owner's left.
 *   For player 0: absolute = { r: row, c: col }.
 *   For player 1 (rotated 180deg like a real chess board):
 *   absolute = { r: BOARD_SIZE - 1 - row, c: BOARD_SIZE - 1 - col }.
 */
export interface FormationSlot {
  character: CharacterId;
  level: Level;
  row: number; // 0..ZONE_DEPTH-1
  col: number; // 0..BOARD_SIZE-1
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
  /**
   * Picker's hop-through (a real Picker only, never an Insaner that absorbed his pattern): every
   * enemy captured by this move in path order (the ones hopped onto on
   * the way, then the one on `to`). Only set when something was captured on the way; `captureId`
   * is then the piece on `to`, or the first piece hopped onto when `to` was empty, so `captureId`
   * stays the "is this a capture" flag for every consumer. See `capturedIds`.
   */
  captureIds?: string[];
  /** Set on recorded moves: Michelle moved backward and left a doll trap on `from`. */
  trap?: true;
  /** Set on recorded moves: the mover ended on an enemy doll trap and is stunned. */
  stunned?: true;
}

/**
 * An active skill. Brutile: lay a k x k wasteland whose lowest-row, lowest-column square is
 * `anchor`. Rakaeli: transform; `anchor` is his own square (the only legal anchor).
 */
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
  | 'bonusSkip'
  /** Every piece that could move is held by a doll trap (it would have a move otherwise). */
  | 'stunned';

export type HistoryEntry =
  | { kind: 'move'; player: PlayerId; move: Move }
  | { kind: 'pass'; player: PlayerId; reason: PassReason }
  /** The storm advanced to step `storm` (columns per side, rows via `stormRows`) and removed the listed pieces. */
  | { kind: 'storm'; storm: number; killed: string[] }
  /**
   * `pieceId` (Brutile) laid wasteland on `squares` (square indices r * BOARD_SIZE + c), or
   * (`transform: true`, squares empty) `pieceId` (Rakaeli) transformed.
   */
  | { kind: 'skill'; player: PlayerId; pieceId: string; squares: number[]; transform?: true };

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
  /**
   * Storm step: columns swallowed on each side (0 = none; 2 = columns 0,1 and 8,9 are gone on 10
   * columns). From step STORM_ROWS_FROM the top and bottom rows go too: `stormRows(storm)` per end.
   */
  storm: number;
  /**
   * Turn changes until the storm advances next; null while the storm is not active yet. The storm
   * starts when a side is down to one piece or at SUDDEN_DEATH_PLY, whichever comes first.
   */
  stormIn: number | null;
  /**
   * Wasteland squares (r * BOARD_SIZE + c), sorted. A piece whose move touches wasteland (stops on it, or
   * slides into it: slides end there) is destroyed. Wasteland never holds a piece.
   */
  waste: number[];
  /**
   * Skill uses so far per player (UI and stats). Whether a piece may still cast is tracked per
   * piece (`Piece.skillUsed`).
   */
  skillsUsed: [number, number];
  /** Michelle's doll traps on the board (sorted by square, then owner). Absent = none. */
  traps?: Trap[];
  /** Backward moves that laid a trap so far, per player (at most TRAPS_PER_MICHELLE). */
  trapsLaid?: [number, number];
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
  /**
   * Active skill, if the character has one: `kind` says what it does (Brutile's wasteland or
   * Rakaeli's transform); `nameKo` / `descKo` (per level) are UI copy.
   */
  skill?: { kind: SkillKind; nameKo: string; descKo: [string, string, string] };
  /** Transformed-form movement copy per level (Rakaeli's "타천"), index 0 = level 1. */
  awakeDescKo?: [string, string, string];
  /** Always-on trait (UI copy), e.g. Michelle's doll trap or Picker's hop-through. */
  trait?: { nameKo: string; descKo: string };
}
