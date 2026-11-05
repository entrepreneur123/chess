/** DOM pieces of the in-game HUD (player bars, timer ring, turn pill, end-reason copy). */
import { CHARACTERS, isDirectional, screenArrow, stormRows, type EndReason, type FormationSlot, type GameState, type PlayerId } from '../../engine';
import { PACING } from '../../meta/economy';
import { pieceToken } from '../components/piece';
import { h } from '../dom';
import type { ControllerSnapshot } from './GameController';
import { dirChip, setArrow } from './hand';

/**
 * Storm status once it is active (HUD chip and field panel): what it has swallowed and when it
 * shrinks next, e.g. '자기장 · 좌우 3줄 · 위아래 1줄 소멸 · 2턴 후 축소'. Before the first shrink:
 * '자기장 활성 · 2턴 후 축소'. The shrink that first brings in the rows says so ('위아래도 축소').
 */
export function stormStatusText(storm: number, inTurns: number): string {
  if (storm <= 0) return `자기장 활성 · ${inTurns}턴 후 축소`;
  const rows = stormRows(storm);
  const gone = rows > 0 ? `좌우 ${storm}줄 · 위아래 ${rows}줄 소멸` : `좌우 ${storm}줄 소멸`;
  return `자기장 · ${gone} · ${inTurns}턴 후 ${rows === 0 && stormRows(storm + 1) > 0 ? '위아래도 축소' : '축소'}`;
}

const RING_R = 18;
/** Last seconds of a turn: running out is an immediate forfeit, so the ring pulses red. */
export const CRITICAL_MS = 5_000;
const RING_C = 2 * Math.PI * RING_R;
/** Arc the ring may shrink per redraw (SVG units; 1 unit ≈ 1 CSS px at the ring's 46 px size). */
const RING_STEP = 0.5;

/**
 * How long (ms) the HUD clock may wait before its next redraw while a turn of `totalMs` runs: the
 * arc then moves by about half a pixel per redraw (smooth to the eye), the number changes on time,
 * and the page draws ~5–12 frames a second for the clock instead of one per display refresh.
 */
export function clockRedrawMs(remainingMs: number, totalMs: number): number {
  const arcStep = Math.min(250, Math.max(40, (totalMs * RING_STEP) / RING_C));
  // The label (and the last-seconds tick sound) changes when ceil(remaining / 1000) drops.
  const toNextSecond = remainingMs - (Math.ceil(remainingMs / 1000) - 1) * 1000;
  return remainingMs > 0 ? Math.min(arcStep, toNextSecond + 2) : arcStep;
}

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

  update(active: boolean, remainingMs: number, totalMs: number): void {
    const secs = Math.ceil(remainingMs / 1000);
    const warn = active && remainingMs <= PACING.timerWarnMs;
    const critical = warn && remainingMs <= CRITICAL_MS;
    const state = `${active}|${warn}|${critical}`;
    if (state !== this.lastState) {
      this.lastState = state;
      this.el.classList.toggle('is-active', active);
      this.el.classList.toggle('is-warn', warn);
      this.el.classList.toggle('is-critical', critical);
    }
    const frac = active ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 1;
    // Called on every HUD clock tick: only touch the style when the (rounded) value changes.
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

export interface RosterView {
  el: HTMLElement;
  /** Patch captured / transformed / direction state; only touches chips whose state changed. */
  update(state: GameState): void;
}

/**
 * The opponent's lineup as tiny coins in the top bar. Built once; a capture greys a chip out, a
 * transform swaps its face and a direction-dependent piece carries a tiny forward chevron that
 * turns over when the piece turns around (the same chip as the hand cards).
 */
export function createRoster(slots: readonly FormationSlot[], owner: PlayerId): RosterView {
  const chips = slots.map((s) => {
    const dir = dirChip(`roster-chip__dir owner-${owner}`);
    const el = h('span', { class: 'roster-chip', title: CHARACTERS[s.character].nameKo }, pieceToken(s.character, s.level, owner, 'xs'), dir);
    return { slot: s, el, dir, key: '' };
  });
  const el = h('div', { class: 'pbar__roster', 'aria-label': '남은 기물' }, chips.map((c) => c.el));
  return {
    el,
    update(state) {
      for (const c of chips) {
        const piece = state.pieces.find((p) => p.id === `p${owner}-${c.slot.character}`);
        const awake = !!piece?.awaken;
        const arrow = piece && isDirectional(piece) ? screenArrow(piece) : null;
        const buffed = !!piece?.buff;
        const key = `${!!piece}|${awake}|${arrow}|${piece?.buff ?? 0}`;
        if (key === c.key) continue;
        const first = !c.key;
        const prevAwake = c.key.split('|')[1] === 'true';
        c.key = key;
        c.el.classList.toggle('is-captured', !piece);
        c.el.classList.toggle('is-buffed', buffed);
        c.el.title = `${CHARACTERS[c.slot.character].nameKo}${buffed ? ` · 선율 ${piece!.buff}턴` : ''}`;
        // A transformed Rakaeli shows his transformed face.
        if (awake !== prevAwake) c.el.replaceChild(pieceToken(c.slot.character, c.slot.level, owner, 'xs', awake), c.el.firstChild!);
        setArrow(c.dir, arrow, !first);
      }
    },
  };
}

export function turnPillContent(snap: ControllerSnapshot): { text: string; cls: string } {
  if (snap.phase === 'ended') return { text: '대전 종료', cls: 'is-ended' };
  const mine = snap.state.turn === 0;
  const chain = snap.state.bonusPieceId !== null;
  if (snap.phase === 'botThinking') return chain ? { text: '상대 연쇄 이동 중', cls: 'is-bot is-thinking is-bonus' } : { text: '상대가 생각 중', cls: 'is-bot is-thinking' };
  if (snap.phase === 'animating') return mine ? { text: chain ? '연쇄 이동' : '내 차례', cls: 'is-me' } : { text: '상대 차례', cls: 'is-bot' };
  return chain ? { text: '연쇄 이동!', cls: 'is-me is-bonus' } : { text: '내 차례', cls: 'is-me' };
}

/**
 * `bothWiped`: the storm swallowed the last pieces of both sides at once (the side that had more
 * pieces left wins; equal counts are a draw).
 */
export function endReasonText(reason: EndReason | null, outcome: 'win' | 'loss' | 'draw', bothWiped = false): string {
  if (reason === 'storm' && bothWiped) {
    return outcome === 'draw' ? '양쪽 마지막 말이 동시에 자기장에 휩쓸려, 남은 말 수가 같아 무승부' : '양쪽 마지막 말이 동시에 자기장에 휩쓸려, 남은 말이 많은 쪽이 승리';
  }
  switch (reason) {
    case 'elimination':
      return outcome === 'win' ? '상대의 말을 모두 잡았습니다.' : '내 말이 모두 잡혔습니다.';
    case 'storm':
      return outcome === 'win' ? '상대의 마지막 말이 자기장에 휩쓸렸습니다.' : '내 마지막 말이 자기장에 휩쓸렸습니다.';
    case 'immobile':
      return outcome === 'win' ? '상대가 더 이상 움직일 수 없어 승리' : '더 이상 움직일 수 없어 패배 (매 턴 반드시 움직여야 해요)';
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

/**
 * Pieces each side lost to the storm step that ended the match by swallowing both sides' last
 * pieces ([player 0, player 1]), or null when the match did not end that way.
 */
export function wipeCounts(state: GameState): [number, number] | null {
  if (state.endReason !== 'storm' || state.pieces.length > 0) return null;
  for (let i = state.history.length - 1; i >= 0; i--) {
    const e = state.history[i];
    if (e.kind !== 'storm') continue;
    const n: [number, number] = [0, 0];
    for (const id of e.killed) n[id.startsWith('p0-') ? 0 : 1]++;
    return n;
  }
  return null;
}

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

