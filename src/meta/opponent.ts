import type { Difficulty } from '../ai/bot';
import { CHARACTER_IDS, randomFormation, type CharacterId, type Formation, type Level } from '../engine';
import { defaultRng, pick, type Rng } from './rng';

const BOT_NAMES = ['전략가 하늘', '체크메이트 민', '나이트 루나', '그림자 준', '북풍 서윤', '철벽 도윤', '번개 지호', '기사 하린'];

export interface Opponent {
  name: string;
  difficulty: Difficulty;
  levels: Record<CharacterId, Level>;
  formation: Formation;
}

/**
 * Bot character levels for a difficulty, relative to the player's levels.
 *  - easy:   all L1
 *  - normal: mostly the player's levels (each character has a 25% chance to be one level lower)
 *  - hard:   player's levels + 1, capped at 3
 */
export function botLevels(
  difficulty: Difficulty,
  playerLevels: Record<CharacterId, Level>,
  rng: Rng = defaultRng,
): Record<CharacterId, Level> {
  const out = {} as Record<CharacterId, Level>;
  for (const id of CHARACTER_IDS) {
    const pl = playerLevels[id] ?? 1;
    let lv: number;
    if (difficulty === 'easy') lv = 1;
    else if (difficulty === 'hard') lv = pl + 1;
    else lv = rng() < 0.25 ? pl - 1 : pl;
    out[id] = Math.min(3, Math.max(1, lv)) as Level;
  }
  return out;
}

export function createOpponent(
  difficulty: Difficulty,
  playerLevels: Record<CharacterId, Level>,
  rng: Rng = defaultRng,
): Opponent {
  const levels = botLevels(difficulty, playerLevels, rng);
  return { name: pick(rng, BOT_NAMES), difficulty, levels, formation: randomFormation(rng, levels) };
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };
