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
import { arenaById, arenaForRating, type ArenaId } from '../meta/progression';

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

/** The current arena's theme (lobby and tab screens). */
export function playHomeMusic(): void {
  playTrack(arenaForRating(getProfile().rating).bgm);
}

/** A specific arena's theme (a match). */
export function playArenaMusic(id: ArenaId): void {
  playTrack(arenaById(id).bgm);
}

/** Lower the music under voice lines and cut-ins. */
export function duck(on: boolean): void {
  call((m) => m.duckMusic?.(on));
}
