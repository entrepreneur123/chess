/** DOM pieces of the in-game HUD (player bars, timer ring, turn pill, end-reason copy). */
import { CHARACTERS, type EndReason, type FormationSlot, type GameState, type PlayerId } from '../../engine';
import { PACING } from '../../meta/economy';
import { pieceToken } from '../components/piece';
import { h } from '../dom';
import type { ControllerSnapshot } from './GameController';

const RING_R = 18;
/** Last seconds of a turn: running out is an immediate forfeit, so the ring pulses red. */
export const CRITICAL_MS = 5_000;
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
    this.label = h('span', { class: 'ring__label' }, '');
    this.el = h('div', { class: `ring owner-${owner}`, role: 'timer', 'aria-label': '남은 시간' }, svg, this.label);
  }

  update(active: boolean, remainingMs: number, totalMs: number, paused: boolean): void {
    const secs = Math.ceil(remainingMs / 1000);
    const warn = active && remainingMs <= PACING.timerWarnMs;
    const critical = warn && !paused && remainingMs <= CRITICAL_MS;
    const state = `${active}|${warn}|${critical}|${paused}`;
    if (state !== this.lastState) {
      this.lastState = state;
      this.el.classList.toggle('is-active', active);
      this.el.classList.toggle('is-warn', warn);
      this.el.classList.toggle('is-critical', critical);
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
      const piece = state.pieces.find((p) => p.id === `p${owner}-${s.character}`);
      const alive = !!piece;
      // A transformed Rakaeli shows his transformed face.
      const t = pieceToken(s.character, s.level, owner, 'xs', !!piece?.awaken);
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

/** `bothWiped`: the storm swallowed the last pieces of both sides at once (decided by material). */
export function endReasonText(reason: EndReason | null, outcome: 'win' | 'loss' | 'draw', bothWiped = false): string {
  if (reason === 'storm' && bothWiped) {
    return `양쪽의 마지막 말이 동시에 자기장에 휩쓸려 사라진 전력으로 판정했습니다.${outcome === 'draw' ? ' 전력이 같습니다.' : ''}`;
  }
  switch (reason) {
    case 'elimination':
      return outcome === 'win' ? '상대의 말을 모두 잡았습니다.' : '내 말이 모두 잡혔습니다.';
    case 'storm':
      return outcome === 'win' ? '상대의 마지막 말이 자기장에 휩쓸렸습니다.' : '내 마지막 말이 자기장에 휩쓸렸습니다.';
    case 'timeoutForfeit':
      return outcome === 'win' ? '상대 시간 초과 · 몰수승' : '시간 초과 · 몰수패';
    case 'resign':
      return outcome === 'win' ? '상대가 기권했습니다.' : '기권했습니다.';
    case 'waste':
      return outcome === 'win' ? '상대의 마지막 말이 불모지에 닿아 소멸했습니다.' : '내 마지막 말이 불모지에 닿아 소멸했습니다.';
    case 'stalemate':
      return `양쪽 모두 움직일 수 없어 남은 전력으로 판정했습니다.${outcome === 'draw' ? ' 전력이 같습니다.' : ''}`;
    default:
      return '';
  }
}

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

