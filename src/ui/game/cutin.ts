/**
 * Illustration cut-in: a slanted banner with the character's full illustration that sweeps across
 * the board when a unit captures or uses its skill (mobile-RPG "skill cut-in"). Pure DOM + CSS
 * animation, pointer-events: none, removes itself; never delays the game flow.
 */
import { CHARACTERS, type CharacterId, type Level, type PlayerId } from '../../engine';
import { VOICE_CLIPS, VOICE_TEXT } from '../../audio/voiceManifest';
import { artMissing, starsOf } from '../components/piece';
import { h } from '../dom';

export type CutInKind = 'capture' | 'skill' | 'chain';

/** Caption lines per character and cut-in kind: the texts of the matching voice clips. */
function linesFor(character: CharacterId, kind: CutInKind): string[] {
  // A character without recorded voices yet (no manifest entry) still gets a caption: its name.
  const clips = (VOICE_CLIPS as Partial<typeof VOICE_CLIPS>)[character];
  const out = (clips?.[kind] ?? clips?.capture ?? []).map((rel) => VOICE_TEXT[rel]).filter(Boolean);
  return out.length ? out : [CHARACTERS[character].nameKo];
}

export const CUTIN_MS = 1250;

export function cardUrl(id: CharacterId, level: Level): string {
  return `./chars/${id}-lv${level}.jpg`;
}

/** Warm the browser cache so the first cut-in does not pop in half-loaded. */
export function preloadCutIns(units: { character: CharacterId; level: Level }[]): void {
  if (typeof Image === 'undefined') return;
  for (const u of units) {
    const img = new Image();
    img.decoding = 'async';
    img.src = cardUrl(u.character, u.level);
  }
}

export interface CutInSpec {
  character: CharacterId;
  level: Level;
  owner: PlayerId;
  kind: CutInKind;
  /** Subtitle (the voice line actually spoken); defaults to one of the character's lines. */
  line?: string;
}

let lineIdx = 0;

export function pickLine(character: CharacterId, kind: CutInKind): string {
  const lines = linesFor(character, kind);
  return lines[lineIdx++ % lines.length];
}

/** Build the cut-in element (caller appends it to the FX layer and removes it after CUTIN_MS). */
export function cutInEl(spec: CutInSpec): HTMLElement {
  const def = CHARACTERS[spec.character];
  const label = spec.kind === 'capture' ? '격파' : spec.kind === 'chain' ? '연쇄' : '스킬';
  return h(
    'div',
    {
      class: `cutin cutin--${spec.kind} owner-${spec.owner} rarity-${def.rarity} char-${spec.character}`,
      'aria-hidden': 'true',
    },
    h('div', { class: 'cutin__band' }),
    h('div', { class: 'cutin__lines' }),
    h('div', { class: 'cutin__art' }, h('img', { src: cardUrl(spec.character, spec.level), alt: '', decoding: 'async', draggable: 'false', onerror: artMissing })),
    h(
      'div',
      { class: 'cutin__text' },
      h('span', { class: 'cutin__tag' }, label),
      h('span', { class: 'cutin__name' }, def.nameKo, h('span', { class: 'cutin__stars' }, starsOf(spec.level))),
      h('span', { class: 'cutin__line' }, spec.line ?? pickLine(spec.character, spec.kind)),
    ),
  );
}
