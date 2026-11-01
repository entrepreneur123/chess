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
import { h } from '../dom';
import { icon } from '../icons';

export const RARITY_LABEL: Record<Rarity, string> = { common: '일반', rare: '희귀', epic: '영웅', legendary: '전설' };

/** One-letter glyph used on tokens. */
export function glyphOf(id: CharacterId): string {
  return CHARACTERS[id].nameKo.slice(0, 1);
}

export function rarityChip(rarity: Rarity): HTMLElement {
  return h('span', { class: `chip chip--rarity rarity-${rarity}` }, RARITY_LABEL[rarity]);
}

export function levelBadge(level: Level, cls = ''): HTMLElement {
  return h('span', { class: `lv-badge ${cls}`, 'aria-label': `레벨 ${level}` }, `Lv.${level}`);
}

/** Round piece token: player color fill, rarity ring, glyph and small level pip. */
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
      'aria-label': `${def.nameKo} 레벨 ${level}`,
      role: 'img',
    },
    h('span', { class: 'token__glyph' }, glyphOf(character)),
    size === 'xs' ? null : h('span', { class: 'token__lv' }, String(level)),
  );
}

export function gemChip(amount: number): HTMLElement {
  return h(
    'span',
    { class: 'coin-chip coin-chip--gem', 'aria-label': `보석 ${amount}` },
    icon('gem', 18),
    h('span', { class: 'coin-chip__value' }, amount.toLocaleString('ko-KR')),
  );
}

export function coinChip(amount: number, opts: { label?: string } = {}): HTMLElement {
  return h(
    'span',
    { class: 'coin-chip', 'aria-label': `${opts.label ?? '코인'} ${amount}` },
    icon('coin', 18),
    h('span', { class: 'coin-chip__value' }, amount.toLocaleString('ko-KR')),
  );
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
    'aria-label': `${CHARACTERS[character].nameKo} 레벨 ${level} 이동 범위: ${CHARACTERS[character].descKo[level - 1]}`,
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
