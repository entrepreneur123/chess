/**
 * AI opponents. There is no online backend yet, so EVERY opponent is an AI and is labelled "AI"
 * in the UI. Matchmaking still simulates a rating band (docs/design/progression.md "Opponents"),
 * so a real server can later serve the same `Opponent` shape.
 *
 *  - 전장전 / 견습전투: a simulated rating near the player's (see `opponentRating`); the squad is
 *    drawn only from characters opened up to that rating's arena (the cumulative shop pool); the
 *    grades track the player's fielded grades (rounded average ± 1, clamped to 1–3); the AI
 *    strength is set by the opponent's arena (`ARENA_AI`).
 *  - 던전: fixed tiers per difficulty (easy / normal / hard as before; extreme = three 3성 with every
 *    legendary, at extreme strength).
 */
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
import { ARENA_AI, ARENA_DEFS, arenaById, arenaForRating, opponentRating, shopPool, type ArenaId, type DungeonLevel, type MatchMode } from './progression';
import { defaultRng, pick, randInt, type Rng } from './rng';

const BOT_NAMES = ['전략가 하늘', '체크메이트 민', '나이트 루나', '그림자 준', '북풍 서윤', '철벽 도윤', '번개 지호', '기사 하린'];
const DUNGEON_NAMES: Record<DungeonLevel, string> = { easy: '던전 수문장', normal: '던전 파수꾼', hard: '던전 군주', extreme: '심연의 지배자' };

export interface Opponent {
  /** Always an AI until an online backend exists (the UI says so). */
  isAI: true;
  name: string;
  difficulty: Difficulty;
  levels: Record<CharacterId, Level>;
  formation: Formation;
  /** Display rating (simulated). */
  rating: number;
  /** The arena that rating belongs to. */
  arena: ArenaId;
}

export type OpponentRequest =
  | {
      mode: 'ranked' | 'casual';
      rating: number;
      playerGrades: readonly Level[];
      /**
       * Developer mode only (the lobby's DEV arena picker): draw the opponent from this arena
       * instead (a rating inside it, its cumulative shop pool, its AI strength).
       */
      arena?: ArenaId;
    }
  | { mode: 'dungeon'; level: DungeonLevel };

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
 * The dungeon bot's three characters:
 *  - easy / normal: 3 distinct characters drawn uniformly from the whole roster (legendaries too);
 *  - hard: one legendary drawn at random, plus 2 distinct characters from the rest (a second
 *    legendary only by chance);
 *  - extreme: every legendary (Insaner and Brutile today) plus one other character.
 * `_playerSquad` is kept for call-site compatibility and ignored.
 */
export function botSquad(difficulty: Difficulty, _playerSquad: readonly CharacterId[] = STARTER_IDS, rng: Rng = defaultRng): CharacterId[] {
  if (difficulty === 'extreme' && LEGENDARY_IDS.length > 0) {
    // 극악 fields every legendary. A self-play check (8 games, 극악 vs 어려움 search with random
    // squads) showed the stronger search alone is not measurably stronger, so the squad is.
    const legends = LEGENDARY_IDS.slice(0, PIECES_PER_SIDE);
    const rest = drawDistinct(
      rng,
      CHARACTER_IDS.filter((id) => !legends.includes(id)),
      PIECES_PER_SIDE - legends.length,
    );
    const squad = [...rest];
    for (const l of legends) squad.splice(Math.min(squad.length, Math.floor(rng() * (squad.length + 1))), 0, l);
    return squad;
  }
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
 * Star grades of the dungeon bot's squad:
 *  - easy:          every character 2성
 *  - normal:        one random member 3성, the other two 2성
 *  - hard, extreme: every character 3성
 * Characters outside the squad get 2성 (they are never fielded).
 */
export function botLevels(
  difficulty: Difficulty,
  _playerLevels?: Partial<Record<CharacterId, Level>>,
  rng: Rng = defaultRng,
  squad: readonly CharacterId[] = STARTER_IDS,
): Record<CharacterId, Level> {
  const out = {} as Record<CharacterId, Level>;
  for (const id of CHARACTER_IDS) out[id] = difficulty === 'hard' || difficulty === 'extreme' ? 3 : 2;
  if (difficulty === 'normal' && squad.length > 0) {
    out[squad[Math.min(squad.length - 1, Math.floor(rng() * squad.length))]] = 3;
  }
  return out;
}

/** The centre the AI's grades are drawn around: the player's fielded grades, averaged and rounded. */
export function aiGradeCenter(playerGrades: readonly Level[]): Level {
  if (playerGrades.length === 0) return 1;
  const avg = playerGrades.reduce((s, g) => s + g, 0) / playerGrades.length;
  return Math.max(1, Math.min(3, Math.round(avg))) as Level;
}

/**
 * Preferred home-zone rows (local: 0 = back rank, ZONE_DEPTH - 1 = 1 = front) per character for a
 * sensible but varied bot set-up: forward movers start up front, Brutile (a weak mover with a
 * skill worth keeping) stays back, Michelle starts up front so her backward moves can lay traps.
 */
const PREFERRED_ROWS: Record<CharacterId, number[]> = {
  sad: [0, 1],
  marki: [1],
  walk: [0, 1],
  insaner: [0, 1],
  brutile: [0],
  // Michelle's traps come from backward moves: start up front so she has room to step back.
  michelle: [1],
  // Picker hops diagonally through anything: either row keeps both forward diagonals open.
  picker: [0, 1],
  // Rakaeli jumps forward (a 2-3 row block once transformed): either row.
  rakaeli: [0, 1],
  // Rampid's claw reaches forward only: up front.
  rampid: [1],
  // Larhen jumps sideways and diagonally: either row.
  larhen: [0, 1],
  // Volkonov is support (his melody needs no position): behind.
  volkonov: [0],
  // Verish pierces forward and sideways: either row.
  verish: [0, 1],
  // Midos slides forward and sideways and can teleport anywhere: either row.
  midos: [0, 1],
  // Hammont brawls up front; Venoa shoots from the back row; Glacia glides out from either.
  hammont: [1],
  venoa: [0],
  glacia: [0, 1],
};
/**
 * Columns the bot prefers: away from the two outer columns per side, which the storm swallows
 * first (columns 2..7 on 10 columns).
 */
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

/** Bot formation: fully random on easy, sensible-but-varied above. Always valid. */
export function botFormation(difficulty: Difficulty, squad: readonly CharacterId[], levels: Record<CharacterId, Level>, rng: Rng = defaultRng): Formation {
  if (difficulty !== 'easy') {
    const f = placedFormation(rng, squad, levels);
    if (validateFormation(f).ok) return f;
  }
  return randomFormation(rng, levels, squad);
}

/**
 * A display rating for a dungeon tier: a rating from the first arena whose AI plays at that
 * strength (the top arena is open-ended, so its first 200 points are used).
 */
function dungeonRating(level: DungeonLevel, rng: Rng): number {
  const a = ARENA_DEFS.find((x) => ARENA_AI[x.id] === level) ?? ARENA_DEFS[0];
  return randInt(rng, a.min, a.max ?? a.min + 200);
}

/** A random rating inside an arena (the open-ended top arena uses its first 300 points). */
export function ratingInArena(id: ArenaId, rng: Rng): number {
  const a = arenaById(id);
  return randInt(rng, a.min, a.max ?? a.min + 300);
}

/** An AI opponent for a mode (see the module comment). */
export function createOpponent(req: OpponentRequest, rng: Rng = defaultRng): Opponent {
  if (req.mode === 'dungeon') {
    const difficulty: Difficulty = req.level;
    const squad = botSquad(difficulty, STARTER_IDS, rng);
    const levels = botLevels(difficulty, undefined, rng, squad);
    const rating = dungeonRating(req.level, rng);
    return {
      isAI: true,
      name: DUNGEON_NAMES[req.level],
      difficulty,
      levels,
      formation: botFormation(difficulty, squad, levels, rng),
      rating,
      arena: arenaForRating(rating).id,
    };
  }
  const rating = req.arena ? ratingInArena(req.arena, rng) : opponentRating(req.mode, req.rating, rng);
  const arena = arenaForRating(rating);
  const difficulty: Difficulty = ARENA_AI[arena.id];
  const squad = drawDistinct(rng, shopPool(arena), PIECES_PER_SIDE);
  const center = aiGradeCenter(req.playerGrades);
  const levels = {} as Record<CharacterId, Level>;
  for (const id of CHARACTER_IDS) levels[id] = center;
  for (const id of squad) levels[id] = Math.max(1, Math.min(3, center + randInt(rng, -1, 1))) as Level;
  return { isAI: true, name: pick(rng, BOT_NAMES), difficulty, levels, formation: botFormation(difficulty, squad, levels, rng), rating, arena: arena.id };
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움', extreme: '극악' };

/** Which arena's theme (art, music) a match uses: the opponent's for casual, the player's otherwise. */
export function matchArenaId(mode: MatchMode, playerRating: number, opponentArena: ArenaId): ArenaId {
  return mode === 'casual' ? opponentArena : arenaForRating(playerRating).id;
}
