/**
 * Progression rules: currencies, star upgrades, rating, arenas, the essence shop and the daily
 * dungeon. Every number here comes from the owner's spec (docs/design/progression.md). This module
 * is pure (no storage, no DOM) so it can be unit-tested and later moved behind a server.
 *
 * Currencies
 *  - 토큰 (tokens, hexagonal token): spent on star upgrades 1성→2성→3성. Earned only from the daily
 *    dungeon reward.
 *  - 에센셜 (essence): spent in the essence shop to unlock characters. Earned from 전장전 and
 *    견습전투 (win 3 / draw 1 / loss 0), with no daily cap.
 */
import { CHARACTERS, CHARACTER_IDS, type CharacterId, type Level, type Rarity } from '../engine';
import { randInt, type Rng } from './rng';

// ---------------------------------------------------------------------------------------------
// Star upgrades (tokens)
// ---------------------------------------------------------------------------------------------

/** Tokens needed to go from `from` to `from + 1` stars, per rarity. */
export const UPGRADE_COST: Record<Rarity, { 1: number; 2: number }> = {
  common: { 1: 5, 2: 50 },
  rare: { 1: 10, 2: 100 },
  epic: { 1: 20, 2: 150 },
  legendary: { 1: 50, 2: 300 },
};

/** Token cost of the next star for `id` at `level`, or null at 3성 (max). */
export function upgradeCost(id: CharacterId, level: Level): number | null {
  if (level >= 3) return null;
  return UPGRADE_COST[CHARACTERS[id].rarity][level as 1 | 2];
}

// ---------------------------------------------------------------------------------------------
// Essence shop
// ---------------------------------------------------------------------------------------------

/** Essence price to unlock a character (it arrives at 1성). */
export const UNLOCK_PRICE: Record<Rarity, number> = { common: 30, rare: 50, epic: 100, legendary: 200 };

/** Essence per finished 전장전 / 견습전투 match. No daily cap. */
export const ESSENCE_REWARD = { win: 3, draw: 1, loss: 0 } as const;

// ---------------------------------------------------------------------------------------------
// Arenas and rating
// ---------------------------------------------------------------------------------------------

export type ArenaId = 'moonrune' | 'emberforge' | 'blightmire' | 'frostkeep' | 'madcrown' | 'apex';

export interface ArenaDef {
  id: ArenaId;
  /** 1-based arena number shown in the UI. */
  index: number;
  name: string;
  /** One-line concept (UI copy). */
  tagline: string;
  /** Inclusive rating range; `max` is null for the top (legend) arena. */
  min: number;
  max: number | null;
  /** Rating gained on a win / lost on a loss, inclusive random ranges. */
  win: readonly [number, number];
  loss: readonly [number, number];
  /** Characters this arena makes available in the essence shop (cumulative with lower arenas). */
  unlocks: readonly CharacterId[];
  /** Theme accent colour (UI chrome, badges). */
  accent: string;
  /** Lobby card art and in-match backdrop (relative URLs under public/). */
  card: string;
  backdrop: string;
  /** Music track id (public/audio/bgm/<id>.m4a), played by src/audio/music.ts. */
  bgm: string;
}

/**
 * The six arenas. Ranges and rating steps are the owner's numbers. "2000이상 전설" overlaps the
 * fifth range at exactly 2000, so 2000 stays in arena 5 and the legend arena starts at 2001.
 * Brutile unlocks in arena 2, Insaner in arena 3, Michelle in arena 4, Picker in arena 5 and
 * Rakaeli in arena 6. The three later commons arrive early, each in a fitting arena: Volkonov the
 * bard in arena 2, Larhen the assassin in arena 3 (the poison swamp) and Rampid the ice boy in
 * arena 4 (the frost keep). Verish, the second rare piercer, joins Picker in arena 5, and Midos,
 * the teleporting ghost (epic), joins Rakaeli at the apex. 2026-11-06: Hammont the forge smith
 * joins the ember forge (arena 2), Venoa the swamp archer the poison swamp (arena 3) and Glacia the
 * frost witch the frost keep (arena 4).
 */
export const ARENA_DEFS: readonly ArenaDef[] = [
  {
    id: 'moonrune', index: 1, name: '달빛 룬 투기장', tagline: '달빛 아래 첫 결투',
    min: 0, max: 300, win: [29, 31], loss: [5, 7], unlocks: ['sad', 'marki', 'walk'],
    accent: '#8cc2ff', card: './arenas/moonrune/card.webp', backdrop: './arenas/moonrune/bg.webp', bgm: 'moonrune',
  },
  {
    id: 'emberforge', index: 2, name: '잿불 대장간', tagline: '용암이 흐르는 쇠의 전장',
    min: 301, max: 600, win: [25, 29], loss: [10, 14], unlocks: ['brutile', 'volkonov', 'hammont'],
    accent: '#ff9a4d', card: './arenas/emberforge/card.webp', backdrop: './arenas/emberforge/bg.webp', bgm: 'emberforge',
  },
  {
    id: 'blightmire', index: 3, name: '독초 늪 신전', tagline: '저주받은 안개의 성소',
    min: 601, max: 1000, win: [20, 22], loss: [15, 17], unlocks: ['insaner', 'larhen', 'venoa'],
    accent: '#7cff5a', card: './arenas/blightmire/card.webp', backdrop: './arenas/blightmire/bg.webp', bgm: 'blightmire',
  },
  {
    id: 'frostkeep', index: 4, name: '서리 성채', tagline: '오로라 아래 얼어붙은 요새',
    min: 1001, max: 1500, win: [18, 22], loss: [17, 20], unlocks: ['michelle', 'rampid', 'glacia'],
    accent: '#9fe8ff', card: './arenas/frostkeep/card.webp', backdrop: './arenas/frostkeep/bg.webp', bgm: 'frostkeep',
  },
  {
    id: 'madcrown', index: 5, name: '광기의 왕좌', tagline: '부서진 사슬과 보랏빛 불꽃',
    min: 1501, max: 2000, win: [15, 17], loss: [19, 21], unlocks: ['picker', 'verish'],
    accent: '#c06cff', card: './arenas/madcrown/card.webp', backdrop: './arenas/madcrown/bg.webp', bgm: 'madcrown',
  },
  {
    id: 'apex', index: 6, name: '천공의 정점', tagline: '전설만이 오르는 하늘의 전장',
    min: 2001, max: null, win: [14, 16], loss: [20, 22], unlocks: ['rakaeli', 'midos'],
    accent: '#f2c14e', card: './arenas/apex/card.webp', backdrop: './arenas/apex/bg.webp', bgm: 'apex',
  },
];

/** Normalises any number into a valid rating (non-negative integer). */
export function clampRating(r: number): number {
  return Number.isFinite(r) ? Math.max(0, Math.floor(r)) : 0;
}

/** The arena a rating belongs to. Demotion is automatic: the arena always follows the rating. */
export function arenaForRating(rating: number): ArenaDef {
  const r = clampRating(rating);
  for (let i = ARENA_DEFS.length - 1; i >= 0; i--) if (r >= ARENA_DEFS[i].min) return ARENA_DEFS[i];
  return ARENA_DEFS[0];
}

export function arenaById(id: ArenaId): ArenaDef {
  return ARENA_DEFS.find((a) => a.id === id) ?? ARENA_DEFS[0];
}

/** The next arena up, or null in the top arena. */
export function nextArenaOf(a: ArenaDef): ArenaDef | null {
  return ARENA_DEFS[a.index] ?? null;
}

export type MatchResult = 'win' | 'loss' | 'draw';

/**
 * Rating change for a 전장전 result, rolled in the range of the arena the player was in when the
 * match started. A draw does not move the rating. The result never goes below 0.
 */
export function ratingDelta(rating: number, result: MatchResult, rng: Rng): number {
  const a = arenaForRating(rating);
  if (result === 'draw') return 0;
  if (result === 'win') return randInt(rng, a.win[0], a.win[1]);
  const loss = randInt(rng, a.loss[0], a.loss[1]);
  return -Math.min(loss, clampRating(rating));
}

/** Characters available in the essence shop for an arena: everything unlocked up to and including it. */
export function shopPool(arena: ArenaDef): CharacterId[] {
  const out: CharacterId[] = [];
  for (const a of ARENA_DEFS) {
    if (a.index > arena.index) break;
    for (const id of a.unlocks) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The arena that first offers `id`, or null when no arena offers it yet. */
export function unlockArenaOf(id: CharacterId): ArenaDef | null {
  return ARENA_DEFS.find((a) => a.unlocks.includes(id)) ?? null;
}

/** Characters every new player owns (arena 1's roster), at 1성. */
export const STARTER_OWNED: readonly CharacterId[] = ARENA_DEFS[0].unlocks;

/** Sanity: every character is either a starter or reachable through some arena. */
export const UNREACHABLE: readonly CharacterId[] = CHARACTER_IDS.filter((id) => !unlockArenaOf(id));

// ---------------------------------------------------------------------------------------------
// Daily dungeon (tokens)
// ---------------------------------------------------------------------------------------------

export type DungeonLevel = 'easy' | 'normal' | 'hard' | 'extreme';

export const DUNGEON_LEVELS: readonly DungeonLevel[] = ['easy', 'normal', 'hard', 'extreme'];

export const DUNGEON_LABEL: Record<DungeonLevel, string> = { easy: '쉬움', normal: '보통', hard: '어려움', extreme: '극악' };

/** Tokens for the day's first dungeon win, per difficulty. */
export const DUNGEON_REWARD: Record<DungeonLevel, number> = { easy: 5, normal: 10, hard: 15, extreme: 20 };

/**
 * Local calendar day key (YYYY-MM-DD in the device's time zone). The reward resets at local
 * midnight. Device time can be changed by the player; a server clock is needed before this
 * matters competitively.
 */
export function dayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Whether today's dungeon reward is still available. Only a WIN claims it; a loss or draw leaves
 * the chance untouched, as the owner specified.
 */
export function dungeonRewardAvailable(lastClaimDay: string | null, now: Date = new Date()): boolean {
  return lastClaimDay !== dayKey(now);
}

// ---------------------------------------------------------------------------------------------
// Modes and simulated matchmaking (lead defaults, tunable; see the spec's "Opponents")
// ---------------------------------------------------------------------------------------------

/** 전장전 (ranked), 견습전투 (casual) or the daily 던전 (dungeon). */
export type MatchMode = 'ranked' | 'casual' | 'dungeon';

export const MODE_LABEL: Record<MatchMode, string> = { ranked: '전장전', casual: '견습전투', dungeon: '던전' };

/** Bot strength names (the same set as `Difficulty` in src/ai/bot.ts). */
export type AiStrength = 'easy' | 'normal' | 'hard' | 'extreme';

/**
 * Half-width of the simulated opponent rating band. Ranked stays inside the player's arena;
 * casual uses a wider band and may cross arena borders. (lead default: about ±60 / ±150)
 */
export const OPPONENT_BAND: Record<'ranked' | 'casual', number> = { ranked: 60, casual: 150 };

/** AI strength per arena (lead default: 1 easy, 2–3 normal, 4–5 hard, 6 extreme). */
export const ARENA_AI: Record<ArenaId, AiStrength> = {
  moonrune: 'easy',
  emberforge: 'normal',
  blightmire: 'normal',
  frostkeep: 'hard',
  madcrown: 'hard',
  apex: 'extreme',
};

/**
 * A simulated opponent rating for 전장전 / 견습전투. Ranked: the player's rating ± the ranked band,
 * clamped to the player's arena. Casual: ± the wider band, only floored at 0.
 */
export function opponentRating(mode: 'ranked' | 'casual', rating: number, rng: Rng): number {
  const r = clampRating(rating);
  const band = OPPONENT_BAND[mode];
  let lo = Math.max(0, r - band);
  let hi = r + band;
  if (mode === 'ranked') {
    const a = arenaForRating(r);
    lo = Math.max(lo, a.min);
    hi = a.max === null ? hi : Math.min(hi, a.max);
  }
  return randInt(rng, lo, Math.max(lo, hi));
}

/** Where a rating sits in its arena: progress (0..1) toward the next arena and points still needed. */
export function arenaProgress(rating: number): { arena: ArenaDef; next: ArenaDef | null; progress: number; toNext: number } {
  const r = clampRating(rating);
  const arena = arenaForRating(r);
  const next = nextArenaOf(arena);
  if (!next) return { arena, next, progress: 1, toNext: 0 };
  const span = next.min - arena.min;
  return { arena, next, progress: Math.max(0, Math.min(1, (r - arena.min) / span)), toNext: Math.max(0, next.min - r) };
}

/** "301–600" / "2001+" (UI copy for an arena's rating range). */
export function arenaRangeLabel(a: ArenaDef): string {
  return a.max === null ? `${a.min}+` : `${a.min}–${a.max}`;
}
