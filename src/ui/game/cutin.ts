/**
 * Illustration cut-in: a slanted banner with the character's full illustration that sweeps across
 * the board when a unit captures or uses its skill (mobile-RPG "skill cut-in"). Pure DOM + CSS
 * animation, pointer-events: none, removes itself; never delays the game flow.
 */
import { CHARACTERS, type CharacterId, type Level, type PlayerId } from '../../engine';
import { starsOf } from '../components/piece';
import { h } from '../dom';

export type CutInKind = 'capture' | 'skill' | 'chain';

/** Short shout shown as the subtitle (matches the voice line theme of each character). */
export const CUTIN_LINES: Record<CharacterId, Record<CutInKind, string[]>> = {
  sad: {
    capture: ['정의의 심판을!', '빛이여!', '물러서라!'],
    skill: ['빛이여, 길을 열어라!'],
    chain: ['빛이여!'],
  },
  marki: {
    capture: ['크아아!', '짓밟아주마!', '부숴버린다!'],
    skill: ['돌격!'],
    chain: ['크아아!'],
  },
  walk: {
    capture: ['방패로 막고, 친다!', '끝이다!'],
    skill: ['도약!'],
    chain: ['끝이다!'],
  },
  insaner: {
    capture: ['냠! 네 거 내 거!', '키히히히! 잡았다!', '장난 좀 쳐볼까?'],
    skill: ['그 힘, 내 거야!'],
    chain: ['한 번 더~!'],
  },
};

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
  /** Subtitle; defaults to a line from CUTIN_LINES. */
  line?: string;
}

let lineIdx = 0;

export function pickLine(character: CharacterId, kind: CutInKind): string {
  const lines = CUTIN_LINES[character][kind];
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
    h('div', { class: 'cutin__art' }, h('img', { src: cardUrl(spec.character, spec.level), alt: '', decoding: 'async', draggable: 'false' })),
    h(
      'div',
      { class: 'cutin__text' },
      h('span', { class: 'cutin__tag' }, label),
      h('span', { class: 'cutin__name' }, def.nameKo, h('span', { class: 'cutin__stars' }, starsOf(spec.level))),
      h('span', { class: 'cutin__line' }, spec.line ?? pickLine(spec.character, spec.kind)),
    ),
  );
}
