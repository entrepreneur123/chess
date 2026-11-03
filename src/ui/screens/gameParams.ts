import type { Difficulty } from '../../ai/bot';
import type { Formation } from '../../engine/types';
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
}

/** What starts a match (matchmaking params; "again" on the result screen reuses them). */
export interface MatchRequest {
  mode: MatchMode;
  dungeonLevel?: DungeonLevel;
}
