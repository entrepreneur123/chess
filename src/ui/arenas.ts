import { APP_TAGLINE } from '../meta/economy';

/**
 * Arenas shown in the lobby showcase. Today there is one; score-based arenas will be appended
 * here later (the lobby already renders the "다음 전장" teaser from `nextArena`).
 */
export interface Arena {
  id: string;
  /** Display name (UI copy). */
  name: string;
  /** Short flavour line under the name. */
  tagline: string;
  /** Art under public/ (relative URL, works under `base: './'` and in the WebView). */
  art: string;
}

export const ARENAS: readonly Arena[] = [{ id: 'moonrune', name: '달빛 룬 투기장', tagline: APP_TAGLINE, art: './bg/match.webp' }];

/** The arena the player fights in now (score-based selection comes later). */
export function currentArena(): Arena {
  return ARENAS[0];
}

/** The next arena to unlock, or null while none is announced. */
export function nextArena(): Arena | null {
  return ARENAS[1] ?? null;
}
