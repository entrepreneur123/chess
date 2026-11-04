/**
 * The in-game "hand": my three piece cards under the board (art, stars, a mini move diagram and
 * the skill readiness of Brutile / Rakaeli; while Rakaeli is transformed his card shows the
 * transformed art, pattern and "타천 · N"; Michelle's doll traps left; a "속박 · 1턴" band while a doll trap holds
 * the piece, which cannot be selected then; a captured piece's card is greyed out). Tapping a card selects that
 * piece exactly like tapping it on the board: it goes through `GameController.tapCell` with the
 * piece's square, so selection, toggling and the bot-turn reach preview behave identically.
 *
 * The model functions are pure (tested in tests/hand.test.ts); `createHand` builds the DOM once
 * and only patches classes / labels when a card's state changes.
 */
import {
  CHARACTERS,
  getPieceById,
  isAwake,
  isStunned,
  skillBlock,
  skillUnlockIn,
  trapsLeft,
  type CharacterId,
  type FormationSlot,
  type GameState,
  type Level,
  type PlayerId,
} from '../../engine';
import { artMissing, cardArtUrl, movementDiagram, movementSpan, setArtSrc, starsOf } from '../components/piece';
import { h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { ControllerSnapshot } from './GameController';

/** `active`: Rakaeli is transformed right now (the label counts his transformed moves left). */
export type SkillReadiness = 'ready' | 'locked' | 'used' | 'sealed' | 'active';

export interface HandCardModel {
  pieceId: string;
  character: CharacterId;
  level: Level;
  alive: boolean;
  selected: boolean;
  /** Only for characters with an active skill (Brutile, Rakaeli). */
  skill: { state: SkillReadiness; label: string } | null;
  /** Rakaeli's transformed moves left (Piece.awaken; 0 = base form). */
  awaken: number;
  /** A doll trap holds the piece: it sits out its next turn and its card cannot be selected. */
  stunned: boolean;
  /** Michelle only: doll traps she can still lay this match (null for everyone else). */
  traps: number | null;
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
  // Transformed: the badge counts the transformed moves left, whatever else is going on.
  if (isAwake(p)) return { state: 'active', label: `${CHARACTERS[p.character].skill!.nameKo} · ${p.awaken}` };
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
    case 'stunned':
      return { state: 'locked', label: '속박' };
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
      stunned: !!p && isStunned(p),
      awaken: p?.awaken ?? 0,
      traps: s.character === 'michelle' && p ? trapsLeft(snap.state, owner) : null,
    };
  });
}

/**
 * Select a piece from its hand card: the same controller path as a board tap on its square.
 * Returns false (and does nothing) when the piece is no longer on the board, or while a doll trap
 * holds it (a stunned card cannot be selected).
 */
export function selectFromHand(ctrl: { readonly state: GameState; tapCell(pos: { r: number; c: number }): void }, pieceId: string): boolean {
  const p = getPieceById(ctrl.state, pieceId);
  if (!p || isStunned(p)) return false;
  ctrl.tapCell(p.pos);
  return true;
}

// -----------------------------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------------------------

const DIAGRAM_BOX = 34;

function diagramFor(character: CharacterId, level: Level, awake = false): HTMLElement {
  const { rows, cols } = movementSpan(character, level, awake);
  const cell = Math.max(3, Math.min(6, Math.floor(DIAGRAM_BOX / Math.max(rows, cols))));
  return movementDiagram(character, level, { cell, awake });
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
    // Michelle: doll traps left ("함정 2"), a tiny doll glyph per trap.
    const trapText = h('span', { class: 'hand-card__trap-text' });
    const trap = s.character === 'michelle' ? h('span', { class: 'hand-card__trap', 'aria-hidden': 'true' }, h('span', { class: 'hand-card__doll' }), trapText) : null;
    const stun = h('span', { class: 'hand-card__stun', 'aria-hidden': 'true', hidden: true }, icon('lock', 12), '속박 · 1턴');
    const art = h('img', { class: 'hand-card__art', src: cardArtUrl(s.character, s.level), alt: '', decoding: 'async', draggable: 'false', onerror: artMissing }) as HTMLImageElement;
    const md = h('span', { class: 'hand-card__md', 'aria-hidden': 'true' }, diagramFor(s.character, s.level));
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
      art,
      h('span', { class: 'hand-card__shade', 'aria-hidden': 'true' }),
      md,
      stun,
      h(
        'span',
        { class: 'hand-card__foot' },
        skill,
        trap,
        h('span', { class: 'hand-card__stars', 'aria-hidden': 'true' }, starsOf(s.level)),
        h('span', { class: 'hand-card__name' }, def.nameKo),
      ),
      h('span', { class: 'hand-card__ko', 'aria-hidden': 'true' }, icon('close', 16), '격파'),
    );
    return { el, art, md, skill, skillText, trap, trapText, stun, key: '', awake: false };
  });
  const el = h('div', { class: 'hand', role: 'group', 'aria-label': '내 말' }, cards.map((c) => c.el));
  return {
    el,
    update(models) {
      models.forEach((m, i) => {
        const c = cards[i];
        if (!c) return;
        const key = `${m.alive}|${m.selected}|${m.skill?.state}|${m.skill?.label}|${m.stunned}|${m.traps}|${m.awaken}`;
        if (key === c.key) return;
        c.key = key;
        // Rakaeli's transform swaps the card to the transformed art and pattern (and back).
        const awake = m.alive && m.awaken > 0;
        if (awake !== c.awake) {
          c.awake = awake;
          c.el.classList.toggle('is-awake', awake);
          setArtSrc(c.art, cardArtUrl(m.character, m.level, awake));
          replaceChildren(c.md, diagramFor(m.character, m.level, awake));
        }
        c.el.classList.toggle('is-dead', !m.alive);
        c.el.classList.toggle('is-selected', m.selected);
        c.el.classList.toggle('is-stunned', m.stunned);
        c.el.setAttribute('aria-pressed', String(m.selected));
        if (m.alive && !m.stunned) c.el.removeAttribute('aria-disabled');
        else c.el.setAttribute('aria-disabled', 'true');
        c.stun.hidden = !m.stunned;
        if (c.trap) {
          c.trap.hidden = m.traps === null;
          c.trap.classList.toggle('is-empty', m.traps === 0);
          replaceChildren(c.trapText, h('span', { class: 'hand-card__trap-label' }, '함정 '), m.traps === null ? '' : String(m.traps));
        }
        if (c.skill) {
          c.skill.hidden = !m.skill;
          c.skill.className = `hand-card__skill${m.skill ? ` is-${m.skill.state}` : ''}`;
          if (m.skill) replaceChildren(c.skillText, m.skill.label);
        }
        const name = CHARACTERS[m.character].nameKo;
        c.el.setAttribute(
          'aria-label',
          `${name} ${m.level}성${m.alive ? '' : ' · 격파됨'}${m.stunned ? ' · 속박 1턴' : ''}${m.traps !== null ? ` · 함정 ${m.traps}개 남음` : ''}${m.skill ? (m.skill.state === 'active' ? ` · 타천 이동 ${m.awaken}번 남음` : ` · 스킬 ${m.skill.label}`) : ''}`,
        );
      });
    },
  };
}
