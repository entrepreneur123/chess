import type { Difficulty } from '../ai/bot';
import { CHARACTERS, CHARACTER_IDS, STARTER_IDS, normalizeSquad, randomFormation, type CharacterId, type Formation, type Level } from '../engine';
import { BOT_LEGENDARY_CHANCE } from './economy';
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

/**
 * The bot mirrors the player's squad (same three characters), except that on normal/hard it may
 * bring a legendary (Insaner or Brutile) when the player has none: a preview of what boxes unlock.
 */
export function botSquad(difficulty: Difficulty, playerSquad: readonly CharacterId[], rng: Rng = defaultRng): CharacterId[] {
  const squad = normalizeSquad(playerSquad.length ? playerSquad : STARTER_IDS);
  const legends = CHARACTER_IDS.filter((id) => CHARACTERS[id].rarity === 'legendary');
  if (!squad.some((id) => legends.includes(id)) && rng() < BOT_LEGENDARY_CHANCE[difficulty]) {
    const k = Math.min(squad.length - 1, Math.floor(rng() * squad.length));
    squad[k] = legends[Math.min(legends.length - 1, Math.floor(rng() * legends.length))];
  }
  return squad;
}

export function createOpponent(
  difficulty: Difficulty,
  playerLevels: Record<CharacterId, Level>,
  rng: Rng = defaultRng,
  playerSquad: readonly CharacterId[] = STARTER_IDS,
): Opponent {
  const levels = botLevels(difficulty, playerLevels, rng);
  const squad = botSquad(difficulty, playerSquad, rng);
  return { name: pick(rng, BOT_NAMES), difficulty, levels, formation: randomFormation(rng, levels, squad) };
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };
