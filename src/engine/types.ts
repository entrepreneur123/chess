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
 * The storm's end-game (owner 2026-11-08): the columns close one per side per step until only the
 * middle 2 columns are open (STORM_MAX_COLS per side), the rows close one per end per step from
 * STORM_ROWS_FROM until only the middle 2 rows are open (STORM_MAX_ROWS per end), that 2 x 2 holds
 * for STORM_FINAL_HOLD_PLIES (5 turns), then the last step swallows the whole board.
 * On 10 x 10 the open area per step is: 1: 8x10, 2: 6x10, 3: 4x8, 4: 2x6, 5: 2x4, 6: 2x2, 7: none.
 */
export const STORM_MAX_COLS = BOARD_SIZE / 2 - 1;
export const STORM_MAX_ROWS = BOARD_SIZE / 2 - 1;
/**
 * From this storm step on (3 columns per side), the storm also closes in from the top and bottom:
 * one row on each end at step 3, one more per later step (`stormRows`).
 */
export const STORM_ROWS_FROM = 3;
/** Storm steps to swallow the whole board: the step after the rows reach STORM_MAX_ROWS (7 on 10 x 10). */
export const STORM_FULL_STEPS = STORM_ROWS_FROM + STORM_MAX_ROWS;
/** How long the last open 2 x 2 holds before the final step: 5 turns (10 turn changes). */
export const STORM_FINAL_HOLD_PLIES = 10;
/** Columns swallowed on EACH side (left and right) at storm step `storm`. */
export function stormCols(storm: number): number {
  if (storm >= STORM_FULL_STEPS) return BOARD_SIZE / 2;
  return Math.max(0, Math.min(storm, STORM_MAX_COLS));
}
/** Rows swallowed at EACH end (top and bottom) at storm step `storm`. */
export function stormRows(storm: number): number {
  if (storm >= STORM_FULL_STEPS) return BOARD_SIZE / 2;
  return storm >= STORM_ROWS_FROM ? Math.min(storm - STORM_ROWS_FROM + 1, STORM_MAX_ROWS) : 0;
}
/** Turn changes from storm step `storm` to the next one: STORM_INTERVAL_PLIES, the final 2 x 2 holds longer. */
export function stormIntervalAfter(storm: number): number {
  return storm === STORM_FULL_STEPS - 1 ? STORM_FINAL_HOLD_PLIES : STORM_INTERVAL_PLIES;
}
/**
 * Upper bound on the turn changes of a match: the storm starts at SUDDEN_DEATH_PLY at the latest,
 * steps every STORM_INTERVAL_PLIES up to the 2 x 2 and swallows it STORM_FINAL_HOLD_PLIES later:
 * 38 + 6 * 4 + 10 = 72 plies (36 turns each). Only a level-3 Insaner's chain moves (an extra ply
 * that is not a turn change) can push `GameState.ply` past it, by one ply per chain move.
 */
export const MAX_MATCH_PLIES = SUDDEN_DEATH_PLY + (STORM_FULL_STEPS - 1) * STORM_INTERVAL_PLIES + STORM_FINAL_HOLD_PLIES;
/**
 * Brutile's skill "불모지" (wasteland) unlocks once both players have taken 3 turns (ply 6: turn 4 as
 * `turnNumber` counts it) and is forbidden once the storm has started to close in (storm >= 1).
 */
export const SKILL_UNLOCK_PLY = 6;
/**
 * Resigning unlocks once both players have taken 3 turns (ply 6: turn 4 as `turnNumber` counts it):
 * owner 2026-11-08, "기권은 최소 3턴 지나고 부터", for real online PvP only (a match against the AI
 * can always be resigned or left). Enforced by the game screen (button, dialog, back navigation);
 * the engine's `resign` itself stays unconditional.
 */
export const RESIGN_UNLOCK_PLY = 6;
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
/**
 * Volkonov's skill "선율" (melody): every OTHER piece of his side on the board gets `Piece.buff` =
 * BUFF_TURNS[level] + 1 on cast. Like `awaken` it counts down at the end of each of its owner's
 * turns, the casting turn included, so the allies keep the buff for exactly BUFF_TURNS[level] of
 * their owner's turns (3 / 3 / 4 by grade).
 */
export const BUFF_TURNS = [0, 3, 3, 4] as const;
/**
 * Stun dealt on the OTHER side's turn (Glacia's "빙결", a 3성 Hammont's knock-back, and a piece
 * knocked onto an enemy doll trap): `Piece.stun` = 1, which the end of its owner's next turn counts
 * down to 0, so it sits out exactly that one turn (a trap caught on its own turn needs TRAP_STUN = 2
 * because its own turn end counts down at once).
 */
export const OFF_TURN_STUN = 1;

export type PlayerId = 0 | 1;
/**
 * What an active skill does: lay wasteland (Brutile), transform (Rakaeli), buff allies (Volkonov) or
 * teleport the caster to a free square (Midos's "그림자 도약") or freeze an enemy in range (Glacia's
 * "빙결": it sits out its owner's next turn).
 */
export type SkillKind = 'waste' | 'transform' | 'buff' | 'blink' | 'freeze';
export type CharacterId = 'sad' | 'marki' | 'walk' | 'insaner' | 'brutile' | 'michelle' | 'picker' | 'rakaeli' | 'rampid' | 'larhen' | 'volkonov' | 'verish' | 'midos' | 'hammont' | 'venoa' | 'glacia';
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
  /**
   * Volkonov's "선율" buff on this piece: while > 0 it moves 1 square further in each of the four
   * orthogonal directions (a direction it cannot move in at all gives 1 square), as a slide. Set to
   * BUFF_TURNS[caster level] + 1 on cast and counted down at the end of each of its OWNER's turns
   * (the casting turn included), so it reads the buffed turns left. Deleted at 0. Never absorbed.
   */
  buff?: number;
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
   * Picker's hop-through and Verish's pierce (the real characters only, never an Insaner that
   * absorbed their pattern): every enemy captured by this move in path order (the ones passed on
   * the way, then the one on `to`). Only set when something was captured on the way; `captureId`
   * is then the piece on `to`, or the first piece hopped onto when `to` was empty, so `captureId`
   * stays the "is this a capture" flag for every consumer. See `capturedIds`.
   */
  captureIds?: string[];
  /** Set on recorded moves: Michelle moved backward and left a doll trap on `from`. */
  trap?: true;
  /** Set on recorded moves: the mover ended on an enemy doll trap and is stunned. */
  stunned?: true;
  /**
   * Venoa's "독화살" (a real Venoa only): the move is a shot. `to` is the victim's square, the
   * mover stays on `from` and `captureId` is the victim.
   */
  shot?: true;
  /**
   * Hammont's "해머 강타" (a real Hammont only): the enemy on `to` is not captured but knocked one
   * square further in the move's direction, to `push.to` (`stunned`: it sits out its owner's next
   * turn). When nothing can take it there (the edge, the storm, any piece, wasteland) it is crushed
   * instead: no `push`, `captureId` is the victim and `crush` is set.
   */
  push?: { id: string; to: Pos; stunned?: true };
  crush?: true;
}

/**
 * An active skill. Brutile: lay a k x k wasteland whose lowest-row, lowest-column square is
 * `anchor`. Rakaeli (transform) and Volkonov (ally buff): `anchor` is his own square (the only
 * legal anchor). Midos (teleport): `anchor` is the free square he blinks to. Glacia (freeze): `anchor`
 * is the enemy piece's square.
 */
export interface SkillAction {
  kind: 'skill';
  pieceId: string;
  anchor: Pos;
}

export type EndReason =
  | 'elimination' // all enemy pieces captured
  | 'storm' // the last piece(s) of a side were swallowed by the storm (both at once: more pieces wins, equal = draw)
  /**
   * Owner rule "you must act every turn": the side to move had no legal action (no move and no
   * castable skill, even once its doll-trap stuns wear off): it loses, at any point of the match.
   */
  | 'immobile'
  | 'timeoutForfeit' // the side to move ran out of turn time: it loses at once
  | 'resign'
  /** @deprecated Unreachable since 'immobile' (the side to move loses first); kept for old saves. */
  | 'stalemate'
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
   * (`transform: true`, squares empty) `pieceId` (Rakaeli) transformed, or (`buffed`: the ally ids,
   * squares empty) `pieceId` (Volkonov) played his melody, or (`blink`, squares empty) `pieceId`
   * (Midos) teleported from square `blink.from` to `blink.to` (`turned`: he landed on the far edge
   * and now faces the other way), or (`frozen`: the enemy id, squares empty) `pieceId` (Glacia)
   * froze it.
   */
  | { kind: 'skill'; player: PlayerId; pieceId: string; squares: number[]; transform?: true; buffed?: string[]; blink?: { from: number; to: number; turned?: true }; frozen?: string };

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
   * Active skill, if the character has one: `kind` says what it does (Brutile's wasteland,
   * Rakaeli's transform or Volkonov's ally buff); `nameKo` / `descKo` (per level) are UI copy.
   */
  skill?: { kind: SkillKind; nameKo: string; descKo: [string, string, string] };
  /** Transformed-form movement copy per level (Rakaeli's "타천"), index 0 = level 1. */
  awakeDescKo?: [string, string, string];
  /** Always-on trait (UI copy), e.g. Michelle's doll trap or Picker's hop-through. */
  trait?: { nameKo: string; descKo: string };
}
