/**
 * Illustration cut-in: a slanted banner with the character's full illustration that sweeps across
 * the board when a unit captures or uses its skill (mobile-RPG "skill cut-in"). Pure DOM + CSS
 * animation, pointer-events: none, removes itself; never delays the game flow.
 */
import { CHARACTERS, type CharacterId, type Level, type PlayerId } from '../../engine';
import { VOICE_CLIPS, VOICE_TEXT } from '../../audio/voiceManifest';
import { artMissing, cardArtUrl, faceUrl, starsOf } from '../components/piece';
import { h } from '../dom';

export type CutInKind = 'capture' | 'skill' | 'chain';

/**
 * Caption lines per character and cut-in kind: the texts of the matching voice clips (a
 * transformed Rakaeli's capture prefers his transformed-form lines).
 */
function linesFor(character: CharacterId, kind: CutInKind, awake = false): string[] {
  // A character without recorded voices yet (no manifest entry) still gets a caption: its name.
  const clips = (VOICE_CLIPS as Partial<Record<CharacterId, Partial<Record<string, readonly string[]>>>>)[character];
  const own = awake && kind === 'capture' ? clips?.['awake-capture'] : undefined;
  const out = (own?.length ? own : (clips?.[kind] ?? clips?.capture ?? [])).map((rel) => VOICE_TEXT[rel]).filter(Boolean);
  return out.length ? out : [CHARACTERS[character].nameKo];
}

export const CUTIN_MS = 1250;

export function cardUrl(id: CharacterId, level: Level, awake = false): string {
  return cardArtUrl(id, level, awake);
}

/**
 * Warm the browser cache so the first cut-in does not pop in half-loaded (a character that can
 * transform also gets its transformed art, which the transform cut-in and his hand card use).
 */
export function preloadCutIns(units: { character: CharacterId; level: Level }[]): void {
  if (typeof Image === 'undefined') return;
  for (const u of units) {
    const urls = [cardUrl(u.character, u.level)];
    if (CHARACTERS[u.character].awakeDescKo) urls.push(cardUrl(u.character, u.level, true), faceUrl(u.character, u.level, true));
    for (const src of urls) {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  }
}

export interface CutInSpec {
  character: CharacterId;
  level: Level;
  owner: PlayerId;
  kind: CutInKind;
  /** Subtitle (the voice line actually spoken); defaults to one of the character's lines. */
  line?: string;
  /** Rakaeli transformed (or transforming): the transformed art, crimson styling. */
  awake?: boolean;
}

let lineIdx = 0;

export function pickLine(character: CharacterId, kind: CutInKind, awake = false): string {
  const lines = linesFor(character, kind, awake);
  return lines[lineIdx++ % lines.length];
}

/** Build the cut-in element (caller appends it to the FX layer and removes it after CUTIN_MS). */
export function cutInEl(spec: CutInSpec): HTMLElement {
  const def = CHARACTERS[spec.character];
  const awake = !!spec.awake && !!def.awakeDescKo;
  // The transform, melody and teleport cut-ins name the skill itself ("타천", "선율", "그림자 도약")
  // instead of the generic "스킬" tag.
  const label =
    spec.kind === 'capture'
      ? '격파'
      : spec.kind === 'chain'
        ? '연쇄'
        : (awake && def.skill?.kind === 'transform') || (spec.kind === 'skill' && (def.skill?.kind === 'buff' || def.skill?.kind === 'blink' || def.skill?.kind === 'freeze'))
          ? def.skill!.nameKo
          : '스킬';
  return h(
    'div',
    {
      class: `cutin cutin--${spec.kind} owner-${spec.owner} rarity-${def.rarity} char-${spec.character}${awake ? ' is-awake' : ''}`,
      'aria-hidden': 'true',
    },
    h('div', { class: 'cutin__band' }),
    h('div', { class: 'cutin__lines' }),
    h('div', { class: 'cutin__art' }, h('img', { src: cardUrl(spec.character, spec.level, awake), alt: '', decoding: 'async', draggable: 'false', onerror: artMissing })),
    h(
      'div',
      { class: 'cutin__text' },
      h('span', { class: 'cutin__tag' }, label),
      h('span', { class: 'cutin__name' }, def.nameKo, h('span', { class: 'cutin__stars' }, starsOf(spec.level))),
      h('span', { class: 'cutin__line' }, spec.line ?? pickLine(spec.character, spec.kind, awake)),
    ),
  );
}
