import type { Difficulty } from '../../ai/bot';
import type { Formation } from '../../engine/types';

export interface GameParams {
  difficulty: Difficulty;
  opponentName: string;
  playerFormation: Formation;
  botFormation: Formation;
}
