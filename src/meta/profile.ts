/**
 * Player profile: localStorage-backed, versioned, corruption-safe.
 * Pure helpers (levelUp, applyMatchResult, openBox...) return new profiles; the store persists them.
 */
import type { Difficulty } from '../ai/bot';
import {
  CHARACTERS,
  CHARACTER_IDS,
  defaultFormation,
  validateFormation,
  type CharacterId,
  type Formation,
  type Level,
} from '../engine';
import { BOX, DEV_CODE, DEV_CURRENCY, LEVEL_UP_COST, MATCH_GEM_REWARD, MATCH_REWARD, MAX_LEVEL, MIN_MOVES_FOR_REWARD, START_COINS, START_GEMS } from './economy';
import { defaultRng, randInt, weightedPick, type Rng } from './rng';

export const PROFILE_VERSION = 2;
const STORAGE_KEY = 'tactics12.profile';

export interface CharacterProgress {
  level: Level;
  cards: number;
}

export interface Profile {
  version: number;
  coins: number;
  /** Premium test currency used for level-ups. */
  gems: number;
  characters: Record<CharacterId, CharacterProgress>;
  formation: Formation;
  /** False until the user explicitly saves a formation in the editor. */
  formationSaved: boolean;
  stats: { wins: number; losses: number; draws: number };
  lastFreeBoxAt: number | null;
  difficulty: Difficulty;
  settings: Settings;
  onboarding: Onboarding;
  /** Developer account: unlimited currency, all characters at max level, free boxes. */
  dev: boolean;
}

export interface Settings {
  sound: boolean;
  haptics: boolean;
}

export interface Onboarding {
  /** The intro tutorial was completed or skipped. */
  tutorialSeen: boolean;
  /** The player made their first move with the in-game coach hints. */
  firstMoveDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = { sound: true, haptics: true };

export type MatchOutcome = 'win' | 'loss' | 'draw';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

// ---------------------------------------------------------------------------------------------
// Defaults / sanitizing
// ---------------------------------------------------------------------------------------------

export function levelsOf(p: Pick<Profile, 'characters'>): Record<CharacterId, Level> {
  const out = {} as Record<CharacterId, Level>;
  for (const id of CHARACTER_IDS) out[id] = p.characters[id]?.level ?? 1;
  return out;
}

export function createDefaultProfile(): Profile {
  const characters = {} as Record<CharacterId, CharacterProgress>;
  for (const id of CHARACTER_IDS) characters[id] = { level: 1, cards: 0 };
  return {
    version: PROFILE_VERSION,
    coins: START_COINS,
    gems: START_GEMS,
    characters,
    formation: defaultFormation(levelsOf({ characters })),
    formationSaved: false,
    stats: { wins: 0, losses: 0, draws: 0 },
    lastFreeBoxAt: null,
    difficulty: 'normal',
    settings: { ...DEFAULT_SETTINGS },
    onboarding: { tutorialSeen: false, firstMoveDone: false },
    dev: false,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonNegInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
const asLevel = (v: unknown): Level => (v === 2 || v === 3 ? v : 1);
const asBool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Formation slots carry the level, which must always mirror the profile. */
export function syncFormationLevels(f: Formation, levels: Record<CharacterId, Level>): Formation {
  return f.map((s) => ({ ...s, level: levels[s.character] ?? s.level }));
}

/** Migrations from older schema versions. Each step takes raw data of version N and returns N+1. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 -> v2: gems introduced (level-ups cost gems instead of coins).
  1: (raw) => ({ ...raw, version: 2, gems: START_GEMS }),
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
export function sanitizeProfile(input: unknown, now = Date.now()): Profile {
  const def = createDefaultProfile();
  if (!isObj(input)) return def;
  const raw = migrate(input);

  const characters = {} as Record<CharacterId, CharacterProgress>;
  const rawChars = isObj(raw.characters) ? raw.characters : {};
  for (const id of CHARACTER_IDS) {
    const c = rawChars[id];
    characters[id] = isObj(c) ? { level: asLevel(c.level), cards: nonNegInt(c.cards, 0) } : { level: 1, cards: 0 };
  }
  const levels = levelsOf({ characters });

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
        levels,
      );
      if (validateFormation(f).ok) {
        formation = f;
        formationOk = true;
      }
    } catch {
      /* fall through to default */
    }
  }
  if (!formationOk) {
    formation = defaultFormation(levels);
    formationSaved = false;
  }

  const stats = isObj(raw.stats) ? raw.stats : {};
  const settings = isObj(raw.settings) ? raw.settings : {};
  const onboarding = isObj(raw.onboarding) ? raw.onboarding : {};
  // Profiles saved before onboarding existed belong to players who already played: don't greet
  // them with the first-run tutorial / first-move coach marks.
  const veteran = !isObj(raw.onboarding) && (nonNegInt(stats.wins, 0) + nonNegInt(stats.losses, 0) + nonNegInt(stats.draws, 0) > 0);
  return {
    version: PROFILE_VERSION,
    coins: nonNegInt(raw.coins, def.coins),
    gems: nonNegInt(raw.gems, def.gems),
    characters,
    formation,
    formationSaved,
    stats: {
      wins: nonNegInt(stats.wins, 0),
      losses: nonNegInt(stats.losses, 0),
      draws: nonNegInt(stats.draws, 0),
    },
    // A timestamp in the future (device clock was ahead, then corrected) is clamped to now so the
    // free box is locked for at most one cooldown instead of until the clock catches up.
    lastFreeBoxAt:
      typeof raw.lastFreeBoxAt === 'number' && Number.isFinite(raw.lastFreeBoxAt) ? Math.min(raw.lastFreeBoxAt, now) : null,
    difficulty: DIFFICULTIES.includes(raw.difficulty as Difficulty) ? (raw.difficulty as Difficulty) : def.difficulty,
    settings: {
      sound: asBool(settings.sound, DEFAULT_SETTINGS.sound),
      haptics: asBool(settings.haptics, DEFAULT_SETTINGS.haptics),
    },
    onboarding: {
      tutorialSeen: asBool(onboarding.tutorialSeen, veteran),
      firstMoveDone: asBool(onboarding.firstMoveDone, veteran),
    },
    dev: raw.dev === true,
  };
}

/** Turns a profile into the developer account (idempotent) or back into a fresh normal account. */
export function setDevMode(p: Profile, on: boolean): Profile {
  if (!on) return { ...createDefaultProfile(), settings: p.settings, onboarding: { tutorialSeen: true, firstMoveDone: true } };
  const characters = {} as Record<CharacterId, CharacterProgress>;
  for (const id of CHARACTER_IDS) characters[id] = { level: MAX_LEVEL, cards: 99 };
  return {
    ...p,
    dev: true,
    coins: DEV_CURRENCY,
    gems: DEV_CURRENCY,
    characters,
    formation: syncFormationLevels(p.formation, levelsOf({ characters })),
    onboarding: { tutorialSeen: true, firstMoveDone: true },
  };
}

/** `?dev=<code>` unlocks the developer account, `?dev=off` leaves it. Returns the (possibly updated) profile. */
export function applyDevQuery(p: Profile, search: string): Profile {
  let v: string | null = null;
  try {
    v = new URLSearchParams(search).get('dev');
  } catch {
    return p;
  }
  if (v === DEV_CODE) return p.dev ? p : setDevMode(p, true);
  if (v === 'off' && p.dev) return setDevMode(p, false);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Pure progression helpers
// ---------------------------------------------------------------------------------------------

export function levelUpCost(level: Level): { cards: number; gems: number } | null {
  return level >= MAX_LEVEL ? null : LEVEL_UP_COST[level as 1 | 2];
}

export type LevelUpCheck = { ok: true } | { ok: false; reason: 'max' | 'cards' | 'gems' };

export function canLevelUp(p: Profile, id: CharacterId): LevelUpCheck {
  const c = p.characters[id];
  const cost = levelUpCost(c.level);
  if (!cost) return { ok: false, reason: 'max' };
  if (p.dev) return { ok: true };
  if (c.cards < cost.cards) return { ok: false, reason: 'cards' };
  if (p.gems < cost.gems) return { ok: false, reason: 'gems' };
  return { ok: true };
}

export function levelUp(p: Profile, id: CharacterId): Profile {
  if (!canLevelUp(p, id).ok) return p;
  const c = p.characters[id];
  const cost = levelUpCost(c.level)!;
  const characters = { ...p.characters, [id]: { level: (c.level + 1) as Level, cards: p.dev ? c.cards : c.cards - cost.cards } };
  return {
    ...p,
    gems: p.dev ? p.gems : p.gems - cost.gems,
    characters,
    formation: syncFormationLevels(p.formation, levelsOf({ characters })),
  };
}

/** `humanMoves`: moves the player actually made this match (losses/draws below the minimum pay 0). */
export function matchReward(outcome: MatchOutcome, difficulty: Difficulty, humanMoves = Infinity): number {
  if (outcome !== 'win' && humanMoves < MIN_MOVES_FOR_REWARD) return 0;
  return outcome === 'win' ? MATCH_REWARD.win[difficulty] : outcome === 'draw' ? MATCH_REWARD.draw : MATCH_REWARD.loss;
}

export function applyMatchResult(
  p: Profile,
  outcome: MatchOutcome,
  difficulty: Difficulty,
  humanMoves = Infinity,
): { profile: Profile; reward: number; gemReward: number } {
  const reward = matchReward(outcome, difficulty, humanMoves);
  const gemReward = outcome === 'win' ? MATCH_GEM_REWARD[difficulty] : 0;
  const stats = { ...p.stats };
  if (outcome === 'win') stats.wins++;
  else if (outcome === 'loss') stats.losses++;
  else stats.draws++;
  if (p.dev) return { profile: { ...p, stats }, reward, gemReward };
  return { profile: { ...p, coins: p.coins + reward, gems: p.gems + gemReward, stats }, reward, gemReward };
}

/** Test-only gem grant (no billing exists). Amount must be positive. */
export function grantGems(p: Profile, amount: number): Profile {
  if (!Number.isFinite(amount) || amount <= 0 || p.dev) return p;
  return { ...p, gems: p.gems + Math.floor(amount) };
}

export function freeBoxRemainingMs(p: Profile, now = Date.now()): number {
  if (p.lastFreeBoxAt === null) return 0;
  // If the device clock went backwards, don't lock the user out for longer than one cooldown.
  const elapsed = Math.max(0, now - p.lastFreeBoxAt);
  return Math.max(0, BOX.freeCooldownMs - elapsed);
}

export interface BoxDrop {
  character: CharacterId;
  amount: number;
}

export function rollBox(rng: Rng = defaultRng): BoxDrop {
  const pool = CHARACTER_IDS.map((id) => ({ item: id, weight: BOX.rarityWeights[CHARACTERS[id].rarity] ?? 0 }));
  // Rarity weight is split evenly among characters sharing the rarity.
  const counts: Record<string, number> = {};
  for (const id of CHARACTER_IDS) counts[CHARACTERS[id].rarity] = (counts[CHARACTERS[id].rarity] ?? 0) + 1;
  for (const x of pool) x.weight /= counts[CHARACTERS[x.item].rarity];
  const character = weightedPick(rng, pool) ?? CHARACTER_IDS[0];
  return { character, amount: randInt(rng, BOX.amountMin, BOX.amountMax) };
}

export type BoxKind = 'free' | 'basic';
export type OpenBoxResult = { ok: true; profile: Profile; drop: BoxDrop } | { ok: false; reason: 'coins' | 'cooldown' };

export function openBox(p: Profile, kind: BoxKind, rng: Rng = defaultRng, now = Date.now()): OpenBoxResult {
  if (kind === 'free' && !p.dev && freeBoxRemainingMs(p, now) > 0) return { ok: false, reason: 'cooldown' };
  if (kind === 'basic' && !p.dev && p.coins < BOX.basicPrice) return { ok: false, reason: 'coins' };
  const drop = rollBox(rng);
  const c = p.characters[drop.character];
  return {
    ok: true,
    drop,
    profile: {
      ...p,
      coins: kind === 'basic' && !p.dev ? p.coins - BOX.basicPrice : p.coins,
      lastFreeBoxAt: kind === 'free' && !p.dev ? now : p.lastFreeBoxAt,
      characters: { ...p.characters, [drop.character]: { ...c, cards: c.cards + drop.amount } },
    },
  };
}

export function levelUpsAvailable(p: Profile): CharacterId[] {
  return CHARACTER_IDS.filter((id) => canLevelUp(p, id).ok);
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
    // Persist the clamped free-box timestamp, otherwise every launch would re-clamp to "now"
    // and the box would stay locked until the device clock reached the stored future time.
    if (isObj(raw) && typeof raw.lastFreeBoxAt === 'number' && raw.lastFreeBoxAt !== p.lastFreeBoxAt) {
      persistProfile(p, storage);
    }
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
  if (!current) {
    current = loadProfile();
    if (typeof location !== 'undefined') {
      const next = applyDevQuery(current, location.search);
      if (next !== current) setProfile(next);
    }
  }
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
