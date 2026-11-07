/**
 * The in-game "hand": my three piece cards under the board (art, stars, a mini move diagram and
 * the skill readiness of Brutile / Rakaeli; while Rakaeli is transformed his card shows the
 * transformed art, pattern and "타천 · N"; Michelle's doll traps left; a rose "선율 · N턴" band (and the extra
 * squares in the move diagram) while Volkonov's melody buffs the piece; a "속박 · 1턴" band while a doll trap holds
 * the piece, which cannot be selected then; a captured piece's card is greyed out; a small chevron chip
 * next to the stars shows a direction-dependent piece's forward direction on screen and flips, with
 * the move diagram, when it turns around at the far edge). Tapping a card selects that
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
  showsDirection,
  screenArrow,
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
  /** Volkonov's melody: buffed turns left on this piece (Piece.buff; 0 = none). */
  buff: number;
  /** A doll trap holds the piece: it sits out its next turn and its card cannot be selected. */
  stunned: boolean;
  /** Michelle only: doll traps she can still lay this match (null for everyone else). */
  traps: number | null;
  /**
   * Forward direction on screen for a piece whose facing matters (`showsDirection`: direction-
   * dependent pieces and every Insaner), null for symmetric movers and captured pieces. It flips
   * when the piece turns around at the far edge.
   */
  arrow: 'up' | 'down' | null;
}

/** Screen-reader copy of a direction chip. */
export const arrowLabel = (arrow: 'up' | 'down'): string => `전진 방향: ${arrow === 'up' ? '위' : '아래'}`;

/**
 * The direction chip: a small chevron in a pill. Built once; `setArrow` flips it in place (CSS
 * rotates the chevron, with a short flip when it changes) so callers never rebuild it.
 */
export function dirChip(cls = ''): HTMLElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('class', 'dir-chip__glyph');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  // An up-pointing chevron; "down" is the same glyph turned over.
  path.setAttribute('d', 'M2.6 7.8 6 4.4l3.4 3.4');
  svg.appendChild(path);
  return h('span', { class: `dir-chip${cls ? ` ${cls}` : ''}`, role: 'img', hidden: true }, svg);
}

/**
 * Point a `dirChip` up / down (null hides it). `animate`: play the flip (a turn-around just
 * happened); the first call and reduced motion never animate.
 */
export function setArrow(chip: HTMLElement, arrow: 'up' | 'down' | null, animate: boolean): void {
  const prev = chip.dataset.dir ?? '';
  const next = arrow ?? '';
  if (prev === next) return;
  chip.hidden = !arrow;
  if (!arrow) {
    delete chip.dataset.dir;
    chip.removeAttribute('aria-label');
    return;
  }
  chip.dataset.dir = arrow;
  chip.setAttribute('aria-label', arrowLabel(arrow));
  if (animate && prev) {
    chip.classList.remove('is-flip');
    void chip.offsetWidth;
    chip.classList.add('is-flip');
  }
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
    case 'alone':
      return { state: 'sealed', label: '아군 없음' };
    case 'noTarget':
      return { state: 'locked', label: '대상 없음' };
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
      buff: p?.buff ?? 0,
      traps: s.character === 'michelle' && p ? trapsLeft(snap.state, owner) : null,
      arrow: p && showsDirection(p) ? screenArrow(p) : null,
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

function diagramFor(character: CharacterId, level: Level, awake = false, buff = false): HTMLElement {
  const { rows, cols } = movementSpan(character, level, awake, buff);
  const cell = Math.max(3, Math.min(6, Math.floor(DIAGRAM_BOX / Math.max(rows, cols))));
  return movementDiagram(character, level, { cell, awake, buff });
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
    // Volkonov's melody on this piece: a rose band with the buffed turns left.
    const buffText = h('span', { class: 'hand-card__buff-text' });
    const buff = h('span', { class: 'hand-card__buff', 'aria-hidden': 'true', hidden: true }, icon('music', 12), buffText);
    const art = h('img', { class: 'hand-card__art', src: cardArtUrl(s.character, s.level), alt: '', decoding: 'async', draggable: 'false', onerror: artMissing }) as HTMLImageElement;
    const md = h('span', { class: 'hand-card__md', 'aria-hidden': 'true' }, diagramFor(s.character, s.level));
    const dir = dirChip('hand-card__dir');
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
      buff,
      h(
        'span',
        { class: 'hand-card__foot' },
        skill,
        trap,
        h('span', { class: 'hand-card__meta' }, h('span', { class: 'hand-card__stars', 'aria-hidden': 'true' }, starsOf(s.level)), dir),
        h('span', { class: 'hand-card__name' }, def.nameKo),
      ),
      h('span', { class: 'hand-card__ko', 'aria-hidden': 'true' }, icon('close', 16), '격파'),
    );
    return { el, art, md, dir, skill, skillText, trap, trapText, stun, buff, buffText, key: '', awake: false, buffed: false };
  });
  const el = h('div', { class: 'hand', role: 'group', 'aria-label': '내 말' }, cards.map((c) => c.el));
  return {
    el,
    update(models) {
      models.forEach((m, i) => {
        const c = cards[i];
        if (!c) return;
        const key = `${m.alive}|${m.selected}|${m.skill?.state}|${m.skill?.label}|${m.stunned}|${m.traps}|${m.awaken}|${m.buff}|${m.arrow}`;
        if (key === c.key) return;
        const first = !c.key;
        c.key = key;
        setArrow(c.dir, m.arrow, !first);
        // The move diagram is drawn forward-up; a piece heading down the screen shows it turned over.
        c.el.classList.toggle('is-dir-down', m.arrow === 'down');
        // Rakaeli's transform swaps the card to the transformed art and pattern (and back).
        const awake = m.alive && m.awaken > 0;
        const buffed = m.alive && m.buff > 0;
        if (awake !== c.awake || buffed !== c.buffed) {
          if (awake !== c.awake) setArtSrc(c.art, cardArtUrl(m.character, m.level, awake));
          c.awake = awake;
          c.buffed = buffed;
          c.el.classList.toggle('is-awake', awake);
          c.el.classList.toggle('is-buffed', buffed);
          replaceChildren(c.md, diagramFor(m.character, m.level, awake, buffed));
        }
        c.buff.hidden = !buffed;
        if (buffed) replaceChildren(c.buffText, `선율 · ${m.buff}턴`);
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
          `${name} ${m.level}성${m.alive ? '' : ' · 격파됨'}${m.arrow ? ` · ${arrowLabel(m.arrow)}` : ''}${m.stunned ? ' · 속박 1턴' : ''}${m.buff > 0 ? ` · 선율 ${m.buff}턴 남음` : ''}${m.traps !== null ? ` · 함정 ${m.traps}개 남음` : ''}${m.skill ? (m.skill.state === 'active' ? ` · 타천 이동 ${m.awaken}번 남음` : ` · 스킬 ${m.skill.label}`) : ''}`,
        );
      });
    },
  };
}
