import type { Difficulty } from '../ai/bot';
import {
  BOARD_SIZE,
  CHARACTERS,
  CHARACTER_IDS,
  PIECES_PER_SIDE,
  STARTER_IDS,
  validateFormation,
  randomFormation,
  type CharacterId,
  type Formation,
  type FormationSlot,
  type Level,
} from '../engine';
import { defaultRng, pick, type Rng } from './rng';

const BOT_NAMES = ['전략가 하늘', '체크메이트 민', '나이트 루나', '그림자 준', '북풍 서윤', '철벽 도윤', '번개 지호', '기사 하린'];

export interface Opponent {
  name: string;
  difficulty: Difficulty;
  levels: Record<CharacterId, Level>;
  formation: Formation;
}

/** Characters with the legendary rarity (Insaner, Brutile). */
export const LEGENDARY_IDS: CharacterId[] = CHARACTER_IDS.filter((id) => CHARACTERS[id].rarity === 'legendary');

/** `n` distinct ids drawn uniformly from `pool` (partial Fisher-Yates; `pool` is not modified). */
function drawDistinct(rng: Rng, pool: readonly CharacterId[], n: number): CharacterId[] {
  const a = [...pool];
  const out: CharacterId[] = [];
  for (let i = 0; i < n && a.length > 0; i++) {
    const k = Math.min(a.length - 1, Math.floor(rng() * a.length));
    out.push(a.splice(k, 1)[0]);
  }
  return out;
}

/**
 * The bot's three characters. It no longer mirrors the player:
 *  - easy / normal: 3 distinct characters drawn uniformly from the whole roster (legendaries too);
 *  - hard: one legendary drawn at random, plus 2 distinct characters from the rest (a second
 *    legendary only by chance).
 * `_playerSquad` is kept for call-site compatibility and ignored.
 */
export function botSquad(difficulty: Difficulty, _playerSquad: readonly CharacterId[] = STARTER_IDS, rng: Rng = defaultRng): CharacterId[] {
  if (difficulty === 'hard' && LEGENDARY_IDS.length > 0) {
    const legend = LEGENDARY_IDS[Math.min(LEGENDARY_IDS.length - 1, Math.floor(rng() * LEGENDARY_IDS.length))];
    const rest = drawDistinct(
      rng,
      CHARACTER_IDS.filter((id) => id !== legend),
      PIECES_PER_SIDE - 1,
    );
    // Shuffle the legendary into a random slot so the squad order carries no information.
    const squad = [...rest];
    squad.splice(Math.min(squad.length, Math.floor(rng() * (squad.length + 1))), 0, legend);
    return squad;
  }
  return drawDistinct(rng, CHARACTER_IDS, PIECES_PER_SIDE);
}

/**
 * Star grades of the bot's squad:
 *  - easy:   every character 2성
 *  - normal: one random member 3성, the other two 2성
 *  - hard:   every character 3성
 * Characters outside the squad get 2성 (they are never fielded).
 * `_playerLevels` is kept for call-site compatibility and ignored.
 */
export function botLevels(
  difficulty: Difficulty,
  _playerLevels?: Partial<Record<CharacterId, Level>>,
  rng: Rng = defaultRng,
  squad: readonly CharacterId[] = STARTER_IDS,
): Record<CharacterId, Level> {
  const out = {} as Record<CharacterId, Level>;
  for (const id of CHARACTER_IDS) out[id] = difficulty === 'hard' ? 3 : 2;
  if (difficulty === 'normal' && squad.length > 0) {
    out[squad[Math.min(squad.length - 1, Math.floor(rng() * squad.length))]] = 3;
  }
  return out;
}

/**
 * Preferred home-zone rows (local: 0 = back rank, 2 = front) per character for a sensible but
 * varied bot set-up: forward movers start up front, Brutile (a weak mover with a skill worth
 * keeping) stays back.
 */
const PREFERRED_ROWS: Record<CharacterId, number[]> = {
  sad: [1, 2],
  marki: [2],
  walk: [1, 2],
  insaner: [1, 2],
  brutile: [0, 1],
};
/** Columns the bot prefers (away from the edges, which the storm swallows first). */
const MIN_COL = 2;
const MAX_COL = BOARD_SIZE - 3;

/** A varied formation with every piece on a preferred row and away from the board edges. */
function placedFormation(rng: Rng, squad: readonly CharacterId[], levels: Record<CharacterId, Level>): Formation {
  const used = new Set<string>();
  const out: FormationSlot[] = [];
  for (const id of squad) {
    for (let tries = 0; tries < 50; tries++) {
      const rows = PREFERRED_ROWS[id];
      const row = rows[Math.min(rows.length - 1, Math.floor(rng() * rows.length))];
      const col = MIN_COL + Math.min(MAX_COL - MIN_COL, Math.floor(rng() * (MAX_COL - MIN_COL + 1)));
      const key = `${row},${col}`;
      if (used.has(key)) continue;
      used.add(key);
      out.push({ character: id, level: levels[id], row, col });
      break;
    }
  }
  return out;
}

/** Bot formation: fully random on easy, sensible-but-varied on normal / hard. Always valid. */
export function botFormation(difficulty: Difficulty, squad: readonly CharacterId[], levels: Record<CharacterId, Level>, rng: Rng = defaultRng): Formation {
  if (difficulty !== 'easy') {
    const f = placedFormation(rng, squad, levels);
    if (validateFormation(f).ok) return f;
  }
  return randomFormation(rng, levels, squad);
}

/** A bot opponent for `difficulty`. The player's levels and squad no longer influence the bot. */
export function createOpponent(
  difficulty: Difficulty,
  _playerLevels?: Partial<Record<CharacterId, Level>>,
  rng: Rng = defaultRng,
  _playerSquad: readonly CharacterId[] = STARTER_IDS,
): Opponent {
  const squad = botSquad(difficulty, _playerSquad, rng);
  const levels = botLevels(difficulty, _playerLevels, rng, squad);
  return { name: pick(rng, BOT_NAMES), difficulty, levels, formation: botFormation(difficulty, squad, levels, rng) };
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };
