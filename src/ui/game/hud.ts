/** DOM pieces of the in-game HUD (player bars, timer ring, turn pill, piece info card). */
import { CHARACTERS, type EndReason, type FormationSlot, type GameState, type Piece, type PlayerId } from '../../engine';
import { PACING } from '../../meta/economy';
import { movementDiagram, pieceToken, rarityChip, unitArt } from '../components/piece';
import { h } from '../dom';
import { icon } from '../icons';
import type { ControllerSnapshot } from './GameController';

const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;

export class TimerRing {
  readonly el: HTMLElement;
  private arc: SVGCircleElement;
  private label: HTMLElement;
  private lastText: string | null = null;
  private lastState = '';
  private lastOffset = '';

  constructor(owner: PlayerId) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 44 44');
    svg.setAttribute('class', 'ring__svg');
    svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS(ns, 'circle');
    track.setAttribute('cx', '22');
    track.setAttribute('cy', '22');
    track.setAttribute('r', String(RING_R));
    track.setAttribute('class', 'ring__track');
    this.arc = document.createElementNS(ns, 'circle');
    this.arc.setAttribute('cx', '22');
    this.arc.setAttribute('cy', '22');
    this.arc.setAttribute('r', String(RING_R));
    this.arc.setAttribute('class', 'ring__arc');
    this.arc.style.strokeDasharray = String(RING_C);
    svg.append(track, this.arc);
    this.label = h('span', { class: 'ring__label' }, '60');
    this.el = h('div', { class: `ring owner-${owner}`, role: 'timer', 'aria-label': '남은 시간' }, svg, this.label);
  }

  update(active: boolean, remainingMs: number, totalMs: number, paused: boolean): void {
    const secs = Math.ceil(remainingMs / 1000);
    const warn = active && remainingMs <= PACING.timerWarnMs;
    const state = `${active}|${warn}|${paused}`;
    if (state !== this.lastState) {
      this.lastState = state;
      this.el.classList.toggle('is-active', active);
      this.el.classList.toggle('is-warn', warn);
      this.el.classList.toggle('is-paused', paused);
    }
    const frac = active ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 1;
    // Called every frame: only touch the style when the (rounded) value changes.
    const offset = (RING_C * (1 - frac)).toFixed(2);
    if (offset !== this.lastOffset) {
      this.lastOffset = offset;
      this.arc.style.strokeDashoffset = offset;
    }
    const text = active ? String(secs) : '';
    if (text !== this.lastText) {
      this.lastText = text;
      this.label.textContent = text;
      this.el.setAttribute('aria-label', active ? `남은 시간 ${secs}초` : '대기 중');
    }
  }
}

export function rosterChips(slots: FormationSlot[], owner: PlayerId, state: GameState): HTMLElement {
  return h(
    'div',
    { class: 'pbar__roster', 'aria-label': '남은 기물' },
    slots.map((s) => {
      const alive = state.pieces.some((p) => p.id === `p${owner}-${s.character}`);
      const t = pieceToken(s.character, s.level, owner, 'xs');
      return h('span', { class: `roster-chip${alive ? '' : ' is-captured'}`, title: CHARACTERS[s.character].nameKo }, t);
    }),
  );
}

export function turnPillContent(snap: ControllerSnapshot): { text: string; cls: string } {
  if (snap.phase === 'ended') return { text: '대전 종료', cls: 'is-ended' };
  if (snap.paused) return { text: '일시정지', cls: 'is-paused' };
  const mine = snap.state.turn === 0;
  const chain = snap.state.bonusPieceId !== null;
  if (snap.phase === 'botThinking') return chain ? { text: '상대 연쇄 이동 중', cls: 'is-bot is-thinking is-bonus' } : { text: '상대가 생각 중', cls: 'is-bot is-thinking' };
  if (snap.phase === 'animating') return mine ? { text: chain ? '연쇄 이동' : '내 차례', cls: 'is-me' } : { text: '상대 차례', cls: 'is-bot' };
  return chain ? { text: '연쇄 이동!', cls: 'is-me is-bonus' } : { text: '내 차례', cls: 'is-me' };
}

export function pieceInfoCard(piece: Piece, snap: ControllerSnapshot, onClose: () => void): HTMLElement {
  const def = CHARACTERS[piece.character];
  const sel = snap.selection;
  const n = sel?.moves.length ?? 0;
  const caps = sel?.moves.filter((m) => m.captureId).length ?? 0;
  const mine = piece.owner === 0;
  const status = sel?.actionable
    ? n === 0
      ? '지금은 움직일 수 있는 칸이 없어요'
      : `이동 가능 ${n}칸${caps ? ` · 잡기 ${caps}` : ''} — 하이라이트된 칸을 탭하세요`
    : mine
      ? '이동 범위 미리보기 · 내 차례에 움직일 수 있어요'
      : `상대 말 이동 범위${caps ? ` · 내 말 ${caps}개가 위협받는 중` : ''}`;
  return h(
    'div',
    { class: `info-card owner-${piece.owner}`, role: 'region', 'aria-label': `${def.nameKo} 정보`, 'data-piece': piece.id },
    h(
      'div',
      { class: 'info-card__row' },
      unitArt(piece.character, piece.level, { size: 52, owner: piece.owner }),
      h(
        'div',
        { class: 'info-card__main' },
        h(
          'div',
          { class: 'info-card__head' },
          h('span', { class: 'info-card__name' }, def.nameKo),
          rarityChip(def.rarity),
          h('span', { class: 'lv-text' }, `Lv.${piece.level}`),
          h('span', { class: `chip chip--side side-${piece.owner}` }, mine ? '내 말' : '상대 말'),
        ),
        h('div', { class: 'info-card__desc' }, def.descKo[piece.level - 1]),
        piece.absorbed?.length
          ? h(
              'div',
              { class: 'info-card__absorbed', 'aria-label': '흡수한 능력' },
              icon('magic', 14),
              piece.absorbed.map((a) => h('span', { class: `chip chip--absorb rarity-${CHARACTERS[a.character].rarity}` }, `${CHARACTERS[a.character].nameKo} Lv.${a.level}`)),
            )
          : def.passiveKo
            ? h('div', { class: 'info-card__passive' }, icon('magic', 14), def.passiveKo)
            : null,
      ),
      h('div', { class: 'info-card__diagram' }, movementDiagram(piece.character, piece.level, { cell: 7, owner: piece.owner })),
      h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': '닫기', onclick: onClose }, icon('close', 20)),
    ),
    h('div', { class: `info-card__status${sel?.actionable ? ' is-actionable' : ''}` }, status),
  );
}

export function endReasonText(reason: EndReason | null, outcome: 'win' | 'loss' | 'draw'): string {
  switch (reason) {
    case 'elimination':
      return outcome === 'win' ? '상대의 말을 모두 잡았습니다.' : '내 말이 모두 잡혔습니다.';
    case 'storm':
      return outcome === 'win' ? '상대의 마지막 말이 자기장에 휩쓸렸습니다.' : outcome === 'loss' ? '내 마지막 말이 자기장에 휩쓸렸습니다.' : '양쪽의 마지막 말이 동시에 자기장에 휩쓸렸습니다.';
    case 'timeoutForfeit':
      return outcome === 'win' ? '상대가 3회 연속 시간을 초과해 기권 처리되었습니다.' : '3회 연속 시간을 초과해 기권 처리되었습니다.';
    case 'resign':
      return outcome === 'win' ? '상대가 기권했습니다.' : '기권했습니다.';
    case 'moveLimit':
      return `60수 동안 잡기가 없어 남은 전력으로 판정했습니다.${outcome === 'draw' ? ' 전력이 같습니다.' : ''}`;
    case 'stalemate':
      return `양쪽 모두 움직일 수 없어 남은 전력으로 판정했습니다.${outcome === 'draw' ? ' 전력이 같습니다.' : ''}`;
    default:
      return '';
  }
}

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

