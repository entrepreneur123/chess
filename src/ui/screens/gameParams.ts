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
}

/** What starts a match (matchmaking params; "again" on the result screen reuses them). */
export interface MatchRequest {
  mode: MatchMode;
  dungeonLevel?: DungeonLevel;
}
