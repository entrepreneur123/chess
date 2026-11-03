/**
 * The in-game "hand": my three piece cards under the board (art, stars, a mini move diagram and
 * Brutile's skill readiness; a captured piece's card is greyed out). Tapping a card selects that
 * piece exactly like tapping it on the board: it goes through `GameController.tapCell` with the
 * piece's square, so selection, toggling and the bot-turn reach preview behave identically.
 *
 * The model functions are pure (tested in tests/hand.test.ts); `createHand` builds the DOM once
 * and only patches classes / labels when a card's state changes.
 */
import {
  CHARACTERS,
  getPieceById,
  skillBlock,
  skillUnlockIn,
  type CharacterId,
  type FormationSlot,
  type GameState,
  type Level,
  type PlayerId,
} from '../../engine';
import { movementDiagram, movementSpan, starsOf } from '../components/piece';
import { h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { ControllerSnapshot } from './GameController';

export type SkillReadiness = 'ready' | 'locked' | 'used' | 'sealed';

export interface HandCardModel {
  pieceId: string;
  character: CharacterId;
  level: Level;
  alive: boolean;
  selected: boolean;
  /** Only for characters with an active skill (Brutile). */
  skill: { state: SkillReadiness; label: string } | null;
}

export const pieceIdOf = (owner: PlayerId, character: CharacterId): string => `p${owner}-${character}`;

/**
 * Skill readiness for the card badge, independent of whose turn it is (the badge must not flicker
 * every turn): "ready" means the owner can cast it on its own turn.
 */
export function skillReadiness(state: GameState, pieceId: string): HandCardModel['skill'] {
  const p = getPieceById(state, pieceId);
  if (!p || !CHARACTERS[p.character].skill) return null;
  const asOwner: GameState = { ...state, turn: p.owner, bonusPieceId: state.turn === p.owner ? state.bonusPieceId : null };
  switch (skillBlock(asOwner, pieceId)) {
    case null:
      return { state: 'ready', label: '스킬 준비' };
    case 'notYet':
      return { state: 'locked', label: `${Math.max(1, skillUnlockIn(state))}턴 후` };
    case 'chain':
      return { state: 'locked', label: '연쇄 중' };
    case 'used':
      return { state: 'used', label: '사용함' };
    case 'storm':
      return { state: 'sealed', label: '봉인' };
    default:
      return null;
  }
}

export function handModel(slots: readonly FormationSlot[], owner: PlayerId, snap: Pick<ControllerSnapshot, 'state' | 'selection'>): HandCardModel[] {
  return slots.map((s) => {
    const pieceId = pieceIdOf(owner, s.character);
    const p = getPieceById(snap.state, pieceId);
    return {
      pieceId,
      character: s.character,
      level: p?.level ?? s.level,
      alive: !!p,
      selected: !!p && snap.selection?.pieceId === pieceId,
      skill: p ? skillReadiness(snap.state, pieceId) : null,
    };
  });
}

/**
 * Select a piece from its hand card: the same controller path as a board tap on its square.
 * Returns false (and does nothing) when the piece is no longer on the board.
 */
export function selectFromHand(ctrl: { readonly state: GameState; tapCell(pos: { r: number; c: number }): void }, pieceId: string): boolean {
  const p = getPieceById(ctrl.state, pieceId);
  if (!p) return false;
  ctrl.tapCell(p.pos);
  return true;
}

// -----------------------------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------------------------

const DIAGRAM_BOX = 34;

function diagramFor(character: CharacterId, level: Level): HTMLElement {
  const { rows, cols } = movementSpan(character, level);
  const cell = Math.max(3, Math.min(6, Math.floor(DIAGRAM_BOX / Math.max(rows, cols))));
  return movementDiagram(character, level, { cell });
}

export interface HandView {
  el: HTMLElement;
  update(cards: HandCardModel[]): void;
}

export function createHand(slots: readonly FormationSlot[], owner: PlayerId, onTap: (pieceId: string) => void): HandView {
  const cards = slots.map((s) => {
    const def = CHARACTERS[s.character];
    const pieceId = pieceIdOf(owner, s.character);
    const skillText = h('span', { class: 'hand-card__skill-text' });
    const skill = def.skill ? h('span', { class: 'hand-card__skill' }, icon('magic', 12), skillText) : null;
    const el = h(
      'button',
      {
        class: `hand-card rarity-${def.rarity}`,
        type: 'button',
        'data-action': 'hand-card',
        'data-piece': pieceId,
        'data-character': s.character,
        'aria-pressed': 'false',
        'data-sfx': 'none',
        onclick: () => onTap(pieceId),
      },
      h('img', { class: 'hand-card__art', src: `./chars/${s.character}-lv${s.level}.jpg`, alt: '', decoding: 'async', draggable: 'false' }),
      h('span', { class: 'hand-card__shade', 'aria-hidden': 'true' }),
      h('span', { class: 'hand-card__md', 'aria-hidden': 'true' }, diagramFor(s.character, s.level)),
      h(
        'span',
        { class: 'hand-card__foot' },
        skill,
        h('span', { class: 'hand-card__stars', 'aria-hidden': 'true' }, starsOf(s.level)),
        h('span', { class: 'hand-card__name' }, def.nameKo),
      ),
      h('span', { class: 'hand-card__ko', 'aria-hidden': 'true' }, icon('close', 16), '격파'),
    );
    return { el, skill, skillText, key: '' };
  });
  const el = h('div', { class: 'hand', role: 'group', 'aria-label': '내 말' }, cards.map((c) => c.el));
  return {
    el,
    update(models) {
      models.forEach((m, i) => {
        const c = cards[i];
        if (!c) return;
        const key = `${m.alive}|${m.selected}|${m.skill?.state}|${m.skill?.label}`;
        if (key === c.key) return;
        c.key = key;
        c.el.classList.toggle('is-dead', !m.alive);
        c.el.classList.toggle('is-selected', m.selected);
        c.el.setAttribute('aria-pressed', String(m.selected));
        if (m.alive) c.el.removeAttribute('aria-disabled');
        else c.el.setAttribute('aria-disabled', 'true');
        if (c.skill) {
          c.skill.hidden = !m.skill;
          c.skill.className = `hand-card__skill${m.skill ? ` is-${m.skill.state}` : ''}`;
          if (m.skill) replaceChildren(c.skillText, m.skill.label);
        }
        const name = CHARACTERS[m.character].nameKo;
        c.el.setAttribute('aria-label', `${name} ${m.level}성${m.alive ? '' : ' · 격파됨'}${m.skill ? ` · 스킬 ${m.skill.label}` : ''}`);
      });
    },
  };
}
