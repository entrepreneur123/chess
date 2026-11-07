import type { Difficulty } from '../../ai/bot';
import type { Formation, PlayerId } from '../../engine/types';
import type { ArenaId, DungeonLevel, MatchMode } from '../../meta/progression';

export interface GameParams {
  mode: MatchMode;
  /** Dungeon only: the chosen difficulty (also the bot strength). */
  dungeonLevel?: DungeonLevel;
  /** Bot strength. */
  difficulty: Difficulty;
  opponentName: string;
  /** The AI opponent's simulated display rating and its arena. */
  opponentRating: number;
  opponentArena: ArenaId;
  /** Arena whose theme (backdrop, music) the match uses. */
  themeArena: ArenaId;
  playerFormation: Formation;
  botFormation: Formation;
  /**
   * Who moves first (0 = the player, 1 = the bot): a coin flip per match, made by matchmaking so
   * the VS card can announce it. Absent: flipped by the game screen.
   */
  firstTurn?: PlayerId;
  /**
   * A real online PvP match (not built yet: every match today is against the AI). Only online
   * matches run the turn clock; matches against the AI (전장전, 견습전투, 던전) have no countdown
   * and pause while the menu is open (owner 2026-11-08).
   */
  online?: boolean;
  /** The guided first match (src/meta/tutorialMatch.ts): prepared position, scripted AI, coach card, no rating. */
  tutorial?: boolean;
}

/**
 * Online PvP rules (owner 2026-11-08): only a real user-vs-user match runs the turn clock and locks
 * resigning for the first 3 turns; a match against the AI has neither and pauses on the menu.
 */
export const isTimedMatch = (p: Pick<GameParams, 'online'>): boolean => p.online === true;

/** What starts a match (matchmaking params; "again" on the result screen reuses them). */
export interface MatchRequest {
  mode: MatchMode;
  dungeonLevel?: DungeonLevel;
}
