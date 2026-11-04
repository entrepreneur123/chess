/**
 * Guarded adapter to the background-music module (src/audio/music.ts, owned by another module).
 * `import.meta.glob` resolves to an empty map when that file does not exist, so the app builds and
 * runs without it; every call then silently does nothing. When it exists it is loaded lazily on
 * first use, off the critical path.
 *
 * Contract (docs/design/progression.md "Music module contract"):
 *   setMusicTrack(id | null), setMusicEnabled(on), duckMusic(on).
 */
import { getProfile, subscribeProfile } from '../meta/profile';
import { arenaById, type ArenaId } from '../meta/progression';

/**
 * The lobby/home theme (public/audio/bgm/lobby.m4a). Mirrors LOBBY_TRACK in src/audio/music.ts
 * (this adapter must not import that module statically, see above).
 */
export const HOME_TRACK = 'lobby';

interface MusicModule {
  setMusicTrack?: (id: string | null) => void;
  setMusicEnabled?: (on: boolean) => void;
  duckMusic?: (on: boolean) => void;
}

const loaders = import.meta.glob<MusicModule>('../audio/music.ts');
const loader = Object.values(loaders)[0] as (() => Promise<MusicModule>) | undefined;
let mod: Promise<MusicModule | null> | null = null;

function music(): Promise<MusicModule | null> {
  if (!mod) mod = loader ? loader().then((m) => m, () => null) : Promise.resolve(null);
  return mod;
}

function call(fn: (m: MusicModule) => void): void {
  void music().then((m) => {
    if (!m) return;
    try {
      fn(m);
    } catch {
      /* music must never break the game */
    }
  });
}

let wanted: string | null = null;
let enabledSynced: boolean | null = null;
let installed = false;

const musicOn = () => {
  const s = getProfile().settings;
  return s.sound && s.music;
};

function syncEnabled(): void {
  const on = musicOn();
  if (on === enabledSynced) return;
  enabledSynced = on;
  call((m) => m.setMusicEnabled?.(on));
}

/** Follow the settings (sound && music) from now on. Idempotent. */
export function installMusic(): void {
  if (installed) return;
  installed = true;
  syncEnabled();
  subscribeProfile(syncEnabled);
}

/** Crossfade to a track (the module ignores a repeat of the current one). */
export function playTrack(id: string | null): void {
  installMusic();
  if (id === wanted) return;
  wanted = id;
  call((m) => m.setMusicTrack?.(id));
}

/**
 * The lobby/home theme, on the lobby and every tab screen (shop, collection, formation, arenas).
 * It differs from every arena's battle track, so returning from a match crossfades home.
 */
export function playHomeMusic(): void {
  playTrack(HOME_TRACK);
}

/**
 * A specific arena's battle theme: from the matchmaking VS card on, and through the match and its
 * result panel.
 */
export function playArenaMusic(id: ArenaId): void {
  playTrack(arenaById(id).bgm);
}

/** Lower the music under voice lines and cut-ins. */
export function duck(on: boolean): void {
  call((m) => m.duckMusic?.(on));
}
