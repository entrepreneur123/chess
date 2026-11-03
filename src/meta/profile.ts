/**
 * Player profile: localStorage-backed, versioned, corruption-safe (schema v4).
 *
 * Progression (docs/design/progression.md, numbers in ./progression.ts):
 *  - `owned[id]` is the highest star owned (0 = locked). The three starters are always owned.
 *  - `grades[id]` is the star fielded, always between 1 and the owned star.
 *  - `tokens` buy star upgrades; `essence` unlocks characters in the shop.
 *  - `rating` moves only in 전장전 (ranked); the arena always follows it.
 *  - `dungeon.lastClaimDay` is the local day key of the last claimed dungeon reward.
 *
 * Security note: all of this lives in localStorage and can be edited by the user. Real PvP,
 * leaderboards or purchases need server-side authority first.
 */
import { CHARACTERS, CHARACTER_IDS, defaultFormation, isCharacterId, squadOf, validateFormation, type CharacterId, type Formation, type Level } from '../engine';
import {
  DUNGEON_LEVELS,
  DUNGEON_REWARD,
  ESSENCE_REWARD,
  STARTER_OWNED,
  UNLOCK_PRICE,
  arenaForRating,
  clampRating,
  dayKey,
  dungeonRewardAvailable,
  ratingDelta,
  shopPool,
  unlockArenaOf,
  upgradeCost,
  type ArenaId,
  type DungeonLevel,
  type MatchMode,
  type MatchResult,
} from './progression';
import type { Rng } from './rng';

export const PROFILE_VERSION = 4;
const STORAGE_KEY = 'tactics12.profile';

/** 0 = locked, otherwise the highest star owned. */
export type Owned = 0 | Level;

export interface Profile {
  version: number;
  owned: Record<CharacterId, Owned>;
  /** Star grade fielded for each character (1..owned; 1 for locked characters). */
  grades: Record<CharacterId, Level>;
  formation: Formation;
  /** False until the user explicitly saves a formation in the editor. */
  formationSaved: boolean;
  tokens: number;
  essence: number;
  rating: number;
  /** Highest rating ever reached (display only). */
  bestRating: number;
  dungeon: { lastClaimDay: string | null };
  /** Last chosen dungeon difficulty. */
  dungeonLevel: DungeonLevel;
  /** Wins, losses and draws over 전장전 + 견습전투 (the dungeon is not counted). */
  stats: { wins: number; losses: number; draws: number };
  settings: Settings;
  onboarding: Onboarding;
}

export type ViewSetting = 'tilt' | 'top';

export interface Settings {
  sound: boolean;
  /** Background music (also needs `sound`). */
  music: boolean;
  /** Character voice lines (AI voice actors); also needs `sound`. */
  voice: boolean;
  haptics: boolean;
  /** Board camera (kept for when the 3D arena returns; the board is top-down only for now). */
  view: ViewSetting;
}

export interface Onboarding {
  /** The intro tutorial was completed or skipped. */
  tutorialSeen: boolean;
  /** The player made their first move with the in-game coach hints. */
  firstMoveDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = { sound: true, music: true, voice: true, haptics: true, view: 'tilt' };
/** Grade a character is fielded at until the player picks another. */
export const DEFAULT_GRADE: Level = 1;
export const DEFAULT_DUNGEON_LEVEL: DungeonLevel = 'easy';

export type MatchOutcome = MatchResult;

// ---------------------------------------------------------------------------------------------
// Defaults / sanitizing
// ---------------------------------------------------------------------------------------------

/** The characters currently fielded (formation order). */
export function squadOfProfile(p: Pick<Profile, 'formation'>): CharacterId[] {
  return squadOf(p.formation);
}

/** Chosen grade per character. */
export function levelsOf(p: Pick<Profile, 'grades'>): Record<CharacterId, Level> {
  const out = {} as Record<CharacterId, Level>;
  for (const id of CHARACTER_IDS) out[id] = p.grades[id] ?? DEFAULT_GRADE;
  return out;
}

export const isOwned = (p: Pick<Profile, 'owned'>, id: CharacterId): boolean => (p.owned[id] ?? 0) > 0;

/** Owned characters, roster order. */
export function ownedIds(p: Pick<Profile, 'owned'>): CharacterId[] {
  return CHARACTER_IDS.filter((id) => isOwned(p, id));
}

function starterOwned(): Record<CharacterId, Owned> {
  const owned = {} as Record<CharacterId, Owned>;
  for (const id of CHARACTER_IDS) owned[id] = STARTER_OWNED.includes(id) ? 1 : 0;
  return owned;
}

function allGrades(level: Level): Record<CharacterId, Level> {
  const grades = {} as Record<CharacterId, Level>;
  for (const id of CHARACTER_IDS) grades[id] = level;
  return grades;
}

export function createDefaultProfile(): Profile {
  const grades = allGrades(DEFAULT_GRADE);
  return {
    version: PROFILE_VERSION,
    owned: starterOwned(),
    grades,
    formation: defaultFormation(grades),
    formationSaved: false,
    tokens: 0,
    essence: 0,
    rating: 0,
    bestRating: 0,
    dungeon: { lastClaimDay: null },
    dungeonLevel: DEFAULT_DUNGEON_LEVEL,
    stats: { wins: 0, losses: 0, draws: 0 },
    settings: { ...DEFAULT_SETTINGS },
    onboarding: { tutorialSeen: false, firstMoveDone: false },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonNegInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(v)) : fallback;
const asLevel = (v: unknown): Level => (v === 2 || v === 3 ? v : 1);
const asOwned = (v: unknown): Owned => (v === 1 || v === 2 || v === 3 ? v : 0);
const asBool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Formation slots carry the grade, which must always mirror the profile. */
export function syncFormationLevels(f: Formation, levels: Record<CharacterId, Level>): Formation {
  return f.map((s) => ({ ...s, level: levels[s.character] ?? s.level }));
}

/** A formation is usable only with owned characters, each at a grade it owns. */
export function formationAllowed(f: Formation, owned: Record<CharacterId, Owned>): boolean {
  return validateFormation(f).ok && f.every((s) => isCharacterId(s.character) && owned[s.character] > 0 && s.level <= owned[s.character]);
}

/** Migrations from older schema versions. Each step takes raw data of version N and returns N+1. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 -> v2: gems introduced.
  1: (raw) => ({ ...raw, version: 2 }),
  // v2 -> v3: the economy (coins, gems, boxes, cards, level-ups, dev account) is gone. The level a
  // character had reached becomes its chosen grade.
  2: (raw) => {
    const grades: Record<string, Level> = {};
    const chars = isObj(raw.characters) ? raw.characters : {};
    for (const id of CHARACTER_IDS) {
      const c = chars[id];
      grades[id] = isObj(c) ? asLevel(c.level) : DEFAULT_GRADE;
    }
    const { coins: _c, gems: _g, characters: _ch, lastFreeBoxAt: _b, dev: _d, ...rest } = raw;
    return { ...rest, version: 3, grades };
  },
  // v3 -> v4: progression arrives. Pre-release, so it is a reset: the three starters are owned at
  // 1성, every grade is 1, tokens / essence / rating start at 0. The formation keeps its squares
  // only if every piece is owned (sanitizing falls back to the default otherwise). The old bot
  // difficulty becomes the preselected dungeon difficulty.
  3: (raw) => {
    const { difficulty, ...rest } = raw;
    const formation = Array.isArray(raw.formation) ? raw.formation.filter(isObj).map((s) => ({ ...s, level: 1 })) : raw.formation;
    return {
      ...rest,
      version: 4,
      owned: starterOwned(),
      grades: allGrades(1),
      formation,
      tokens: 0,
      essence: 0,
      rating: 0,
      bestRating: 0,
      dungeon: { lastClaimDay: null },
      dungeonLevel: DUNGEON_LEVELS.includes(difficulty as DungeonLevel) ? difficulty : DEFAULT_DUNGEON_LEVEL,
    };
  },
};

function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let data = raw;
  let v = typeof data.version === 'number' ? data.version : 0;
  if (v === 0) v = 1; // pre-versioned data is treated as v1 and sanitized field by field
  while (v < PROFILE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break;
    data = step(data);
    v += 1;
  }
  return data;
}

/** Turns arbitrary (possibly corrupt) data into a valid profile. Never throws. */
export function sanitizeProfile(input: unknown): Profile {
  const def = createDefaultProfile();
  if (!isObj(input)) return def;
  let raw: Record<string, unknown>;
  try {
    raw = migrate(input);
  } catch {
    return def;
  }

  // Ownership: the starters are always owned (a squad needs three characters).
  const owned = {} as Record<CharacterId, Owned>;
  const rawOwned = isObj(raw.owned) ? raw.owned : {};
  for (const id of CHARACTER_IDS) {
    const o = asOwned(rawOwned[id]);
    owned[id] = STARTER_OWNED.includes(id) ? (Math.max(1, o) as Owned) : o;
  }

  // Fielded grades never exceed the owned star.
  const grades = {} as Record<CharacterId, Level>;
  const rawGrades = isObj(raw.grades) ? raw.grades : {};
  for (const id of CHARACTER_IDS) {
    const g = rawGrades[id] === undefined ? DEFAULT_GRADE : asLevel(rawGrades[id]);
    grades[id] = Math.min(g, Math.max(1, owned[id])) as Level;
  }

  let formation = def.formation;
  let formationSaved = raw.formationSaved === true;
  let formationOk = false;
  if (Array.isArray(raw.formation)) {
    try {
      const f = syncFormationLevels(
        raw.formation.filter(isObj).map((s) => ({
          character: s.character as CharacterId,
          level: asLevel(s.level),
          row: Number(s.row),
          col: Number(s.col),
        })),
        grades,
      );
      if (formationAllowed(f, owned)) {
        formation = f;
        formationOk = true;
      }
    } catch {
      /* fall through to default */
    }
  }
  if (!formationOk) {
    formation = defaultFormation(grades);
    formationSaved = false;
  }

  const stats = isObj(raw.stats) ? raw.stats : {};
  const settings = isObj(raw.settings) ? raw.settings : {};
  const onboarding = isObj(raw.onboarding) ? raw.onboarding : {};
  const dungeon = isObj(raw.dungeon) ? raw.dungeon : {};
  const rating = clampRating(nonNegInt(raw.rating, 0));
  // Profiles saved before onboarding existed belong to players who already played: don't greet
  // them with the first-run tutorial / first-move coach marks.
  const veteran = !isObj(raw.onboarding) && (nonNegInt(stats.wins, 0) + nonNegInt(stats.losses, 0) + nonNegInt(stats.draws, 0) > 0);
  return {
    version: PROFILE_VERSION,
    owned,
    grades,
    formation,
    formationSaved,
    tokens: nonNegInt(raw.tokens, 0),
    essence: nonNegInt(raw.essence, 0),
    rating,
    bestRating: Math.max(rating, clampRating(nonNegInt(raw.bestRating, 0))),
    dungeon: { lastClaimDay: typeof dungeon.lastClaimDay === 'string' && DAY_RE.test(dungeon.lastClaimDay) ? dungeon.lastClaimDay : null },
    dungeonLevel: DUNGEON_LEVELS.includes(raw.dungeonLevel as DungeonLevel) ? (raw.dungeonLevel as DungeonLevel) : DEFAULT_DUNGEON_LEVEL,
    stats: {
      wins: nonNegInt(stats.wins, 0),
      losses: nonNegInt(stats.losses, 0),
      draws: nonNegInt(stats.draws, 0),
    },
    settings: {
      sound: asBool(settings.sound, DEFAULT_SETTINGS.sound),
      music: asBool(settings.music, DEFAULT_SETTINGS.music),
      voice: asBool(settings.voice, DEFAULT_SETTINGS.voice),
      haptics: asBool(settings.haptics, DEFAULT_SETTINGS.haptics),
      view: settings.view === 'top' ? 'top' : 'tilt',
    },
    onboarding: {
      tutorialSeen: asBool(onboarding.tutorialSeen, veteran),
      firstMoveDone: asBool(onboarding.firstMoveDone, veteran),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Pure actions
// ---------------------------------------------------------------------------------------------

/** Field `id` at star grade `grade` (the formation follows). Grades above the owned star are refused. */
export function setGrade(p: Profile, id: CharacterId, grade: Level): Profile {
  if (p.grades[id] === grade || grade > p.owned[id] || grade < 1) return p;
  const grades = { ...p.grades, [id]: grade };
  return { ...p, grades, formation: syncFormationLevels(p.formation, grades) };
}

/** Records the outcome in the stats. */
export function applyMatchResult(p: Profile, outcome: MatchOutcome): Profile {
  const stats = { ...p.stats };
  if (outcome === 'win') stats.wins++;
  else if (outcome === 'loss') stats.losses++;
  else stats.draws++;
  return { ...p, stats };
}

export type BuyRefusal = 'owned' | 'arena' | 'essence' | 'unavailable';
export type UpgradeRefusal = 'locked' | 'max' | 'tokens';
export interface ActionResult<R extends string> {
  ok: boolean;
  profile: Profile;
  reason?: R;
}

/** Essence price to unlock `id`. */
export const priceOf = (id: CharacterId): number => UNLOCK_PRICE[CHARACTERS[id].rarity];

/** Characters the shop offers right now (opened up to the current arena and not owned yet). */
export function buyableIds(p: Profile): CharacterId[] {
  return shopPool(arenaForRating(p.rating)).filter((id) => !isOwned(p, id));
}

/** Why `id` cannot be bought now, or null if it can. */
export function buyBlocker(p: Profile, id: CharacterId): BuyRefusal | null {
  if (!isCharacterId(id)) return 'unavailable';
  if (isOwned(p, id)) return 'owned';
  if (!unlockArenaOf(id)) return 'unavailable';
  if (!shopPool(arenaForRating(p.rating)).includes(id)) return 'arena';
  if (p.essence < priceOf(id)) return 'essence';
  return null;
}

/** Unlock `id` with essence. It arrives at 1성. Never goes negative. */
export function buyCharacter(p: Profile, id: CharacterId): ActionResult<BuyRefusal> {
  const reason = buyBlocker(p, id);
  if (reason) return { ok: false, profile: p, reason };
  return {
    ok: true,
    profile: { ...p, essence: p.essence - priceOf(id), owned: { ...p.owned, [id]: 1 }, grades: { ...p.grades, [id]: 1 } },
  };
}

/** Why `id` cannot be upgraded now, or null if it can. */
export function upgradeBlocker(p: Profile, id: CharacterId): UpgradeRefusal | null {
  const o = p.owned[id] ?? 0;
  if (o < 1) return 'locked';
  const cost = upgradeCost(id, o);
  if (cost === null) return 'max';
  if (p.tokens < cost) return 'tokens';
  return null;
}

/**
 * Raise `id` one star with tokens. The new star is fielded right away (the player can still pick
 * a lower one). Never goes negative.
 */
export function upgradeCharacter(p: Profile, id: CharacterId): ActionResult<UpgradeRefusal> {
  const reason = upgradeBlocker(p, id);
  if (reason) return { ok: false, profile: p, reason };
  const from = p.owned[id] as Level;
  const cost = upgradeCost(id, from) as number;
  const to = (from + 1) as Level;
  const grades = { ...p.grades, [id]: to };
  return {
    ok: true,
    profile: { ...p, tokens: p.tokens - cost, owned: { ...p.owned, [id]: to }, grades, formation: syncFormationLevels(p.formation, grades) },
  };
}

export interface SettleInput {
  mode: MatchMode;
  result: MatchResult;
  /** Required for the dungeon (falls back to the profile's last choice). */
  dungeonLevel?: DungeonLevel;
  rng: Rng;
  now: Date;
}

export interface MatchSummary {
  mode: MatchMode;
  result: MatchResult;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  arenaBefore: ArenaId;
  arenaAfter: ArenaId;
  promoted: boolean;
  demoted: boolean;
  essenceGained: number;
  tokensGained: number;
  /** Dungeon only: today's reward had already been claimed before this match. */
  dungeonAlreadyClaimed: boolean;
  dungeonLevel: DungeonLevel | null;
  /** Characters a promotion just made available in the shop (not owned yet). */
  newShopCharacters: CharacterId[];
}

/**
 * Applies a finished match to the profile:
 *  - ranked: rating ± (the starting arena's range, never below 0), essence 3 / 1 / 0, stats;
 *  - casual: essence and stats, no rating change;
 *  - dungeon: the day's token reward on the first WIN of the local day; no rating, essence or
 *    stats. A loss or draw changes nothing.
 */
export function settleMatch(p: Profile, input: SettleInput): { profile: Profile; summary: MatchSummary } {
  const { mode, result, rng, now } = input;
  const before = clampRating(p.rating);
  const arenaBefore = arenaForRating(before);
  let next: Profile = p;
  let delta = 0;
  let essence = 0;
  let tokens = 0;
  let alreadyClaimed = false;
  const level = mode === 'dungeon' ? (input.dungeonLevel ?? p.dungeonLevel) : null;

  if (mode === 'dungeon') {
    alreadyClaimed = !dungeonRewardAvailable(p.dungeon.lastClaimDay, now);
    if (result === 'win' && !alreadyClaimed && level) {
      tokens = DUNGEON_REWARD[level];
      next = { ...next, tokens: next.tokens + tokens, dungeon: { lastClaimDay: dayKey(now) } };
    }
    if (level && next.dungeonLevel !== level) next = { ...next, dungeonLevel: level };
  } else {
    if (mode === 'ranked') delta = ratingDelta(before, result, rng);
    essence = ESSENCE_REWARD[result];
    next = applyMatchResult(next, result);
    const rating = clampRating(before + delta);
    next = { ...next, rating, bestRating: Math.max(next.bestRating, rating), essence: next.essence + essence };
  }

  const after = clampRating(next.rating);
  const arenaAfter = arenaForRating(after);
  const poolBefore = shopPool(arenaBefore);
  const newShopCharacters =
    arenaAfter.index > arenaBefore.index ? shopPool(arenaAfter).filter((id) => !poolBefore.includes(id) && !isOwned(next, id)) : [];
  return {
    profile: next,
    summary: {
      mode,
      result,
      ratingBefore: before,
      ratingAfter: after,
      ratingDelta: after - before,
      arenaBefore: arenaBefore.id,
      arenaAfter: arenaAfter.id,
      promoted: arenaAfter.index > arenaBefore.index,
      demoted: arenaAfter.index < arenaBefore.index,
      essenceGained: essence,
      tokensGained: tokens,
      dungeonAlreadyClaimed: alreadyClaimed,
      dungeonLevel: level,
      newShopCharacters,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadProfile(storage: KeyValueStorage | null = browserStorage()): Profile {
  if (!storage) return createDefaultProfile();
  let text: string | null = null;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return createDefaultProfile();
  }
  if (!text) return createDefaultProfile();
  try {
    const raw: unknown = JSON.parse(text);
    const p = sanitizeProfile(raw);
    // Persist migrations right away so old fields (coins, boxes...) leave storage for good. Data
    // from a NEWER build (an app downgrade) is used as far as it is understood but not overwritten,
    // so upgrading again does not lose what this build cannot read.
    if (isObj(raw) && !(typeof raw.version === 'number' && raw.version >= PROFILE_VERSION)) persistProfile(p, storage);
    return p;
  } catch {
    return createDefaultProfile();
  }
}

export function persistProfile(p: Profile, storage: KeyValueStorage | null = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* quota / private mode: keep in memory only */
  }
}

type Listener = (p: Profile) => void;
let current: Profile | null = null;
const listeners = new Set<Listener>();

export function getProfile(): Profile {
  if (!current) current = loadProfile();
  return current;
}

export function setProfile(p: Profile): void {
  current = p;
  persistProfile(p);
  for (const l of listeners) l(p);
}

export function updateProfile(fn: (p: Profile) => Profile): Profile {
  const next = fn(getProfile());
  if (next !== current) setProfile(next);
  return next;
}

export function subscribeProfile(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
