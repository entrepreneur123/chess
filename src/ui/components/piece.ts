import {
  CHARACTERS,
  getTargetsForPiece,
  type CharacterId,
  type GameState,
  type Level,
  type Piece,
  type PlayerId,
  type Rarity,
} from '../../engine';
import { getProfile } from '../../meta/profile';
import { h } from '../dom';
import { icon } from '../icons';

export const RARITY_LABEL: Record<Rarity, string> = { common: '일반', rare: '희귀', epic: '영웅', legendary: '전설' };

/** Character concept titles shown with the illustrations (UI copy only). */
export const CONCEPT: Record<CharacterId, string> = { sad: '성기사', marki: '황소 전사', walk: '방패병', insaner: '꼬마 악마', brutile: '초록 마녀' };

/** Star grade as filled stars, e.g. 2 -> "★★" (grades are called 1성 / 2성 / 3성). */
export function starsOf(level: Level): string {
  return '★'.repeat(level);
}

/** Face illustration URL for a character grade. */
export function faceUrl(id: CharacterId, level: Level): string {
  return `./chars/${id}-lv${level}-face.jpg`;
}

export function rarityChip(rarity: Rarity): HTMLElement {
  return h('span', { class: `chip chip--rarity rarity-${rarity}` }, RARITY_LABEL[rarity]);
}

export function levelBadge(level: Level, cls = ''): HTMLElement {
  return h('span', { class: `lv-badge ${cls}`, 'aria-label': `${level}성` }, `${level}성`);
}

/**
 * Round piece token: the character's face illustration inside a team-coloured rim, wrapped in the
 * rarity ring (white / orange / purple / rotating rainbow), with a star-grade pip.
 */
export function pieceToken(
  character: CharacterId,
  level: Level,
  owner: PlayerId = 0,
  size: 'xs' | 'sm' | 'md' | 'lg' = 'md',
): HTMLElement {
  const def = CHARACTERS[character];
  return h(
    'span',
    {
      class: `token token--${size} owner-${owner} rarity-${def.rarity}`,
      'aria-label': `${def.nameKo} ${level}성`,
      role: 'img',
    },
    h('img', { class: 'token__art', src: faceUrl(character, level), alt: '', decoding: 'async', draggable: 'false' }),
    size === 'xs' ? null : h('span', { class: 'token__lv', 'aria-hidden': 'true' }, starsOf(level)),
  );
}

/**
 * Illustrated character art (dark manhwa-style illustrations in public/chars).
 * `face` = round head-and-shoulders portrait, `card` = 3:4 full illustration.
 */
export function unitArt(
  character: CharacterId,
  level: Level,
  opts: { kind?: 'face' | 'card'; size?: number; owner?: PlayerId; cls?: string } = {},
): HTMLElement {
  const def = CHARACTERS[character];
  const kind = opts.kind ?? 'face';
  const src = kind === 'face' ? faceUrl(character, level) : `./chars/${character}-lv${level}.jpg`;
  return h(
    'span',
    {
      class: `unit-art unit-art--${kind} rarity-${def.rarity} tier-${level} owner-${opts.owner ?? 0} ${opts.cls ?? ''}`,
      style: opts.size ? `--art-size:${opts.size}px` : undefined,
      role: 'img',
      'aria-label': `${def.nameKo} ${level}성`,
    },
    h('img', { src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }),
    h('span', { class: 'unit-art__lv', 'aria-hidden': 'true' }, starsOf(level)),
  );
}

/**
 * Currency pill. The developer account has unlimited currency: the value renders as "∞" while the
 * accessible label keeps the real number.
 */
function currencyChip(kind: 'coin' | 'gem', amount: number, label: string): HTMLElement {
  const infinite = getProfile().dev;
  return h(
    'span',
    { class: `coin-chip${kind === 'gem' ? ' coin-chip--gem' : ''}${infinite ? ' is-infinite' : ''}`, 'aria-label': `${label} ${amount}` },
    icon(kind, 18),
    h('span', { class: 'coin-chip__value', 'aria-hidden': 'true' }, infinite ? '∞' : amount.toLocaleString('ko-KR')),
  );
}

export function gemChip(amount: number): HTMLElement {
  return currencyChip('gem', amount, '보석');
}

export function coinChip(amount: number, opts: { label?: string } = {}): HTMLElement {
  return currencyChip('coin', amount, opts.label ?? '코인');
}

// -----------------------------------------------------------------------------------------------
// Movement diagram (derived from the real engine rules so it can never drift)
// -----------------------------------------------------------------------------------------------

interface Pattern {
  rows: number;
  cols: number;
  origin: { r: number; c: number }; // in diagram coords, r = 0 is the top (forward)
  targets: Set<string>;
}

const patternCache = new Map<string, Pattern | null>();

function computePattern(character: CharacterId, level: Level): Pattern | null {
  const key = `${character}:${level}`;
  if (patternCache.has(key)) return patternCache.get(key)!;
  let result: Pattern | null = null;
  try {
    const origin = { r: 4, c: 6 };
    const piece: Piece = { id: `p0-${character}`, owner: 0, character, level, pos: origin };
    const state: GameState = {
      pieces: [piece],
      turn: 0,
      ply: 0,
      pliesSinceCapture: 0,
      consecutiveTimeouts: [0, 0],
      status: 'playing',
      winner: null,
      endReason: null,
      history: [],
      bonusPieceId: null,
      storm: 0,
      stormIn: null,
      waste: [],
      skillsUsed: [0, 0],
    };
    const moves = getTargetsForPiece(state, piece);
    // Player 0 moves toward +r; draw forward as "up".
    const rel = moves.map((m) => ({ dr: m.to.r - origin.r, dc: m.to.c - origin.c }));
    const maxFwd = Math.max(0, ...rel.map((x) => x.dr));
    const maxBack = Math.max(0, ...rel.map((x) => -x.dr));
    const halfW = Math.max(1, ...rel.map((x) => Math.abs(x.dc)));
    const fwd = Math.max(maxFwd, 1);
    const back = maxBack;
    const rows = fwd + back + 1;
    const cols = halfW * 2 + 1;
    const o = { r: fwd, c: halfW };
    result = { rows, cols, origin: o, targets: new Set(rel.map((x) => `${o.r - x.dr},${o.c + x.dc}`)) };
  } catch (e) {
    console.warn('movement pattern unavailable', e);
  }
  patternCache.set(key, result);
  return result;
}

/** Tiny CSS grid showing where a character can go from the center square. Forward is up. */
export function movementDiagram(character: CharacterId, level: Level, opts: { cell?: number; owner?: PlayerId } = {}): HTMLElement {
  const p = computePattern(character, level);
  const cell = opts.cell ?? 9;
  const wrap = h('div', {
    class: `move-diagram owner-${opts.owner ?? 0}`,
    role: 'img',
    'aria-label': `${CHARACTERS[character].nameKo} ${level}성 이동 범위: ${CHARACTERS[character].descKo[level - 1]}`,
  });
  if (!p) return wrap;
  wrap.style.gridTemplateColumns = `repeat(${p.cols}, ${cell}px)`;
  wrap.style.gridAutoRows = `${cell}px`;
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const isOrigin = r === p.origin.r && c === p.origin.c;
      const isTarget = p.targets.has(`${r},${c}`);
      wrap.appendChild(h('span', { class: `md-cell${isOrigin ? ' is-origin' : ''}${isTarget ? ' is-target' : ''}` }));
    }
  }
  return wrap;
}
