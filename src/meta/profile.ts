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
import { BOX, LEVEL_UP_COST, MATCH_REWARD, MAX_LEVEL, START_COINS } from './economy';
import { defaultRng, randInt, weightedPick, type Rng } from './rng';

export const PROFILE_VERSION = 1;
const STORAGE_KEY = 'tactics12.profile';

export interface CharacterProgress {
  level: Level;
  cards: number;
}

export interface Profile {
  version: number;
  coins: number;
  characters: Record<CharacterId, CharacterProgress>;
  formation: Formation;
  /** False until the user explicitly saves a formation in the editor. */
  formationSaved: boolean;
  stats: { wins: number; losses: number; draws: number };
  lastFreeBoxAt: number | null;
  difficulty: Difficulty;
}

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
    characters,
    formation: defaultFormation(levelsOf({ characters })),
    formationSaved: false,
    stats: { wins: 0, losses: 0, draws: 0 },
    lastFreeBoxAt: null,
    difficulty: 'normal',
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonNegInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
const asLevel = (v: unknown): Level => (v === 2 || v === 3 ? v : 1);

/** Formation slots carry the level, which must always mirror the profile. */
export function syncFormationLevels(f: Formation, levels: Record<CharacterId, Level>): Formation {
  return f.map((s) => ({ ...s, level: levels[s.character] ?? s.level }));
}

/** Migrations from older schema versions. Each step takes raw data of version N and returns N+1. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (raw) => ({ ...raw, version: 2, newField: ... }),
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
  return {
    version: PROFILE_VERSION,
    coins: nonNegInt(raw.coins, def.coins),
    characters,
    formation,
    formationSaved,
    stats: {
      wins: nonNegInt(stats.wins, 0),
      losses: nonNegInt(stats.losses, 0),
      draws: nonNegInt(stats.draws, 0),
    },
    lastFreeBoxAt: typeof raw.lastFreeBoxAt === 'number' && Number.isFinite(raw.lastFreeBoxAt) ? raw.lastFreeBoxAt : null,
    difficulty: DIFFICULTIES.includes(raw.difficulty as Difficulty) ? (raw.difficulty as Difficulty) : def.difficulty,
  };
}

// ---------------------------------------------------------------------------------------------
// Pure progression helpers
// ---------------------------------------------------------------------------------------------

export function levelUpCost(level: Level): { cards: number; coins: number } | null {
  return level >= MAX_LEVEL ? null : LEVEL_UP_COST[level as 1 | 2];
}

export type LevelUpCheck = { ok: true } | { ok: false; reason: 'max' | 'cards' | 'coins' };

export function canLevelUp(p: Profile, id: CharacterId): LevelUpCheck {
  const c = p.characters[id];
  const cost = levelUpCost(c.level);
  if (!cost) return { ok: false, reason: 'max' };
  if (c.cards < cost.cards) return { ok: false, reason: 'cards' };
  if (p.coins < cost.coins) return { ok: false, reason: 'coins' };
  return { ok: true };
}

export function levelUp(p: Profile, id: CharacterId): Profile {
  if (!canLevelUp(p, id).ok) return p;
  const c = p.characters[id];
  const cost = levelUpCost(c.level)!;
  const characters = { ...p.characters, [id]: { level: (c.level + 1) as Level, cards: c.cards - cost.cards } };
  return {
    ...p,
    coins: p.coins - cost.coins,
    characters,
    formation: syncFormationLevels(p.formation, levelsOf({ characters })),
  };
}

export function matchReward(outcome: MatchOutcome, difficulty: Difficulty): number {
  return outcome === 'win' ? MATCH_REWARD.win[difficulty] : outcome === 'draw' ? MATCH_REWARD.draw : MATCH_REWARD.loss;
}

export function applyMatchResult(p: Profile, outcome: MatchOutcome, difficulty: Difficulty): { profile: Profile; reward: number } {
  const reward = matchReward(outcome, difficulty);
  const stats = { ...p.stats };
  if (outcome === 'win') stats.wins++;
  else if (outcome === 'loss') stats.losses++;
  else stats.draws++;
  return { profile: { ...p, coins: p.coins + reward, stats }, reward };
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
  if (kind === 'free' && freeBoxRemainingMs(p, now) > 0) return { ok: false, reason: 'cooldown' };
  if (kind === 'basic' && p.coins < BOX.basicPrice) return { ok: false, reason: 'coins' };
  const drop = rollBox(rng);
  const c = p.characters[drop.character];
  return {
    ok: true,
    drop,
    profile: {
      ...p,
      coins: kind === 'basic' ? p.coins - BOX.basicPrice : p.coins,
      lastFreeBoxAt: kind === 'free' ? now : p.lastFreeBoxAt,
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
    return sanitizeProfile(JSON.parse(text));
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
