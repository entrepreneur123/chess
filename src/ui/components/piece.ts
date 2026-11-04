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

export const RARITY_LABEL: Record<Rarity, string> = { common: '일반', rare: '희귀', epic: '영웅', legendary: '전설' };

/** Character concept titles shown with the illustrations (UI copy only). */
export const CONCEPT: Record<CharacterId, string> = { sad: '성기사', marki: '황소 전사', walk: '방패병', insaner: '꼬마 악마', brutile: '초록 마녀', michelle: '인형 소녀', picker: '사막의 카우보이' };

/**
 * Neutral head-and-shoulders silhouette shown in place of an illustration that failed to load
 * (new characters ship before their art). Transparent around the figure, so the rarity-tinted
 * background of `img.is-art-missing` shows through; never the browser's broken-image icon.
 */
export const ART_SILHOUETTE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='xMidYMid slice'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23aab4d6' stop-opacity='.55'/%3E%3Cstop offset='1' stop-color='%23aab4d6' stop-opacity='.15'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='50' cy='38' r='17' fill='url(%23g)'/%3E%3Cpath d='M18 100 Q20 64 50 60 Q80 64 82 100Z' fill='url(%23g)'/%3E%3C/svg%3E";

/** Swap a failed illustration for the silhouette placeholder (idempotent). */
export function markArtMissing(img: HTMLImageElement): void {
  if (img.dataset.artMissing) return;
  img.dataset.artMissing = '1';
  img.classList.add('is-art-missing');
  img.removeAttribute('srcset');
  img.src = ART_SILHOUETTE;
}

/** `onerror` handler for illustration <img> elements (see `markArtMissing`). */
export function artMissing(e: Event): void {
  if (e.currentTarget instanceof HTMLImageElement) markArtMissing(e.currentTarget);
}

/**
 * App-wide fallback: any illustration under public/chars that fails to load (including ones not
 * built with `artMissing`) becomes the silhouette. Error events do not bubble, so this listens in
 * the capture phase. Install once at startup.
 */
export function installArtFallback(doc: Document = document): void {
  doc.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t instanceof HTMLImageElement && /\/chars\//.test(t.src)) markArtMissing(t);
    },
    true,
  );
}

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
    h('img', { class: 'token__art', src: faceUrl(character, level), alt: '', decoding: 'async', draggable: 'false', onerror: artMissing }),
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
    h('img', { src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', onerror: artMissing }),
    h('span', { class: 'unit-art__lv', 'aria-hidden': 'true' }, starsOf(level)),
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
  /** Targets straight behind the piece (Michelle lays her doll traps by moving there). */
  back: Set<string>;
}

const patternCache = new Map<string, Pattern | null>();

function computePattern(character: CharacterId, level: Level): Pattern | null {
  const key = `${character}:${level}`;
  if (patternCache.has(key)) return patternCache.get(key)!;
  let result: Pattern | null = null;
  try {
    // Room for the longest reach of every pattern on 10 x 10: 6 rows ahead (Marki 3성), 3 behind
    // (Sad / Insaner), 4 to each side (Walk 3성's 9-wide landing row).
    const origin = { r: 3, c: 4 };
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
    result = {
      rows,
      cols,
      origin: o,
      targets: new Set(rel.map((x) => `${o.r - x.dr},${o.c + x.dc}`)),
      back: new Set(rel.filter((x) => x.dr < 0 && x.dc === 0).map((x) => `${o.r - x.dr},${o.c + x.dc}`)),
    };
  } catch (e) {
    console.warn('movement pattern unavailable', e);
  }
  patternCache.set(key, result);
  return result;
}

/** Rows x columns of a character's movement diagram (to size it into a fixed box). */
export function movementSpan(character: CharacterId, level: Level): { rows: number; cols: number } {
  const p = computePattern(character, level);
  return p ? { rows: p.rows, cols: p.cols } : { rows: 1, cols: 1 };
}

/** Tiny CSS grid showing where a character can go from the center square. Forward is up. */
export function movementDiagram(character: CharacterId, level: Level, opts: { cell?: number; owner?: PlayerId } = {}): HTMLElement {
  const p = computePattern(character, level);
  const cell = opts.cell ?? 9;
  // Picker's diagonals are hops (round landing pads in a chain), not slides.
  const hop = character === 'picker';
  const traps = character === 'michelle';
  const wrap = h('div', {
    class: `move-diagram owner-${opts.owner ?? 0}${hop ? ' is-hop' : ''}${traps ? ' is-traps' : ''}`,
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
      const isBack = traps && p.back.has(`${r},${c}`);
      wrap.appendChild(h('span', { class: `md-cell${isOrigin ? ' is-origin' : ''}${isTarget ? ' is-target' : ''}${isBack ? ' is-back' : ''}` }));
    }
  }
  return wrap;
}
