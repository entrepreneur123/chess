/**
 * Player profile: localStorage-backed, versioned, corruption-safe.
 * There is no economy: every character is available at every star grade, and the player simply
 * picks which grade (1성 / 2성 / 3성) to field for each character in the character screen.
 */
import type { Difficulty } from '../ai/bot';
import { CHARACTER_IDS, defaultFormation, squadOf, validateFormation, type CharacterId, type Formation, type Level } from '../engine';

export const PROFILE_VERSION = 3;
const STORAGE_KEY = 'tactics12.profile';

export interface Profile {
  version: number;
  /** Star grade fielded for each character (chosen freely in the character screen). */
  grades: Record<CharacterId, Level>;
  formation: Formation;
  /** False until the user explicitly saves a formation in the editor. */
  formationSaved: boolean;
  stats: { wins: number; losses: number; draws: number };
  difficulty: Difficulty;
  settings: Settings;
  onboarding: Onboarding;
}

export type ViewSetting = 'tilt' | 'top';

export interface Settings {
  sound: boolean;
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

export const DEFAULT_SETTINGS: Settings = { sound: true, voice: true, haptics: true, view: 'tilt' };
/** Grade a character is fielded at until the player picks another. */
export const DEFAULT_GRADE: Level = 1;

export type MatchOutcome = 'win' | 'loss' | 'draw';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

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

export function createDefaultProfile(): Profile {
  const grades = {} as Record<CharacterId, Level>;
  for (const id of CHARACTER_IDS) grades[id] = DEFAULT_GRADE;
  return {
    version: PROFILE_VERSION,
    grades,
    formation: defaultFormation(grades),
    formationSaved: false,
    stats: { wins: 0, losses: 0, draws: 0 },
    difficulty: 'normal',
    settings: { ...DEFAULT_SETTINGS },
    onboarding: { tutorialSeen: false, firstMoveDone: false },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonNegInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(v)) : fallback;
const asLevel = (v: unknown): Level => (v === 2 || v === 3 ? v : 1);
const asBool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Formation slots carry the grade, which must always mirror the profile. */
export function syncFormationLevels(f: Formation, levels: Record<CharacterId, Level>): Formation {
  return f.map((s) => ({ ...s, level: levels[s.character] ?? s.level }));
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

  const grades = {} as Record<CharacterId, Level>;
  const rawGrades = isObj(raw.grades) ? raw.grades : {};
  for (const id of CHARACTER_IDS) grades[id] = rawGrades[id] === undefined ? DEFAULT_GRADE : asLevel(rawGrades[id]);

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
      if (validateFormation(f).ok) {
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
  // Profiles saved before onboarding existed belong to players who already played: don't greet
  // them with the first-run tutorial / first-move coach marks.
  const veteran = !isObj(raw.onboarding) && (nonNegInt(stats.wins, 0) + nonNegInt(stats.losses, 0) + nonNegInt(stats.draws, 0) > 0);
  return {
    version: PROFILE_VERSION,
    grades,
    formation,
    formationSaved,
    stats: {
      wins: nonNegInt(stats.wins, 0),
      losses: nonNegInt(stats.losses, 0),
      draws: nonNegInt(stats.draws, 0),
    },
    difficulty: DIFFICULTIES.includes(raw.difficulty as Difficulty) ? (raw.difficulty as Difficulty) : def.difficulty,
    settings: {
      sound: asBool(settings.sound, DEFAULT_SETTINGS.sound),
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
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** Field `id` at star grade `grade` (the formation follows). */
export function setGrade(p: Profile, id: CharacterId, grade: Level): Profile {
  if (p.grades[id] === grade) return p;
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
