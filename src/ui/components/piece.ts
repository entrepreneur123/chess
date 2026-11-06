import {
  AWAKEN_TURNS,
  CHARACTERS,
  getTargetsForPiece,
  type CharacterId,
  type GameState,
  type Level,
  type Piece,
  type PlayerId,
  type Rarity,
} from '../../engine';
import { VENOA_DIAG_LEVEL, VENOA_SHOT_MAX, VENOA_SHOT_MIN } from '../../engine/characters';
import { h } from '../dom';

export const RARITY_LABEL: Record<Rarity, string> = { common: '일반', rare: '희귀', epic: '영웅', legendary: '전설' };

/** Character concept titles shown with the illustrations (UI copy only). */
export const CONCEPT: Record<CharacterId, string> = { sad: '성기사', marki: '황소 전사', walk: '방패병', insaner: '꼬마 악마', brutile: '초록 마녀', michelle: '인형 소녀', picker: '사막의 카우보이', rakaeli: '타락 천사', rampid: '얼음 소년', larhen: '쌍단검 암살자', volkonov: '음유시인', verish: '관통 질주자', midos: '그림자 망령', hammont: '용광로 대장장이', venoa: '독늪 사냥꾼', glacia: '서리 마녀' };

/**
 * Neutral head-and-shoulders silhouette shown in place of an illustration that failed to load
 * (new characters ship before their art). Transparent around the figure, so the rarity-tinted
 * background of `img.is-art-missing` shows through; never the browser's broken-image icon.
 */
export const ART_SILHOUETTE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='xMidYMid slice'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23aab4d6' stop-opacity='.55'/%3E%3Cstop offset='1' stop-color='%23aab4d6' stop-opacity='.15'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='50' cy='38' r='17' fill='url(%23g)'/%3E%3Cpath d='M18 100 Q20 64 50 60 Q80 64 82 100Z' fill='url(%23g)'/%3E%3C/svg%3E";

/** A transformed-form illustration ("-awake-"): its base-form twin is the first fallback. */
const AWAKE_ART = /\/chars\/([a-z]+)-awake-(lv[123](?:-face)?)\.jpg/;

/**
 * Swap a failed illustration for a placeholder (idempotent). A missing transformed-form image
 * falls back to the base form with a crimson tint (`is-awake-fallback`), then to the silhouette.
 */
export function markArtMissing(img: HTMLImageElement): void {
  if (img.dataset.artMissing) return;
  const awake = AWAKE_ART.exec(img.src);
  if (awake && !img.dataset.awakeFallback) {
    img.dataset.awakeFallback = '1';
    img.classList.add('is-awake-fallback');
    img.removeAttribute('srcset');
    img.src = `./chars/${awake[1]}-${awake[2]}.jpg`;
    return;
  }
  img.dataset.artMissing = '1';
  img.classList.add('is-art-missing');
  img.removeAttribute('srcset');
  img.src = ART_SILHOUETTE;
}

/** Point an illustration at a new image, clearing any placeholder state of the previous one. */
export function setArtSrc(img: HTMLImageElement, src: string): void {
  if (img.getAttribute('src') === src && !img.dataset.artMissing && !img.dataset.awakeFallback) return;
  delete img.dataset.artMissing;
  delete img.dataset.awakeFallback;
  img.classList.remove('is-art-missing', 'is-awake-fallback');
  img.src = src;
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

/** Face illustration URL for a character grade (`awake`: Rakaeli's transformed form). */
export function faceUrl(id: CharacterId, level: Level, awake = false): string {
  return `./chars/${id}${awake ? '-awake' : ''}-lv${level}-face.jpg`;
}

/** Full 3:4 card illustration URL for a character grade (`awake`: Rakaeli's transformed form). */
export function cardArtUrl(id: CharacterId, level: Level, awake = false): string {
  return `./chars/${id}${awake ? '-awake' : ''}-lv${level}.jpg`;
}

export function rarityChip(rarity: Rarity): HTMLElement {
  return h('span', { class: `chip chip--rarity rarity-${rarity}` }, RARITY_LABEL[rarity]);
}

export function levelBadge(level: Level, cls = ''): HTMLElement {
  return h('span', { class: `lv-badge ${cls}`, 'aria-label': `${level}성` }, `${level}성`);
}

/**
 * Round piece token: the character's face illustration inside a team-coloured rim, wrapped in the
 * rarity ring (white / orange / purple / rainbow), with a star-grade pip.
 */
export function pieceToken(
  character: CharacterId,
  level: Level,
  owner: PlayerId = 0,
  size: 'xs' | 'sm' | 'md' | 'lg' = 'md',
  awake = false,
): HTMLElement {
  const def = CHARACTERS[character];
  return h(
    'span',
    {
      class: `token token--${size} owner-${owner} rarity-${def.rarity}${awake ? ' is-awake' : ''}`,
      'aria-label': `${def.nameKo} ${level}성${awake ? ` · ${def.skill?.nameKo ?? ''}` : ''}`,
      role: 'img',
    },
    h('img', { class: 'token__art', src: faceUrl(character, level, awake), alt: '', decoding: 'async', draggable: 'false', onerror: artMissing }),
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
  opts: { kind?: 'face' | 'card'; size?: number; owner?: PlayerId; cls?: string; awake?: boolean } = {},
): HTMLElement {
  const def = CHARACTERS[character];
  const kind = opts.kind ?? 'face';
  const awake = !!opts.awake;
  const src = kind === 'face' ? faceUrl(character, level, awake) : cardArtUrl(character, level, awake);
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
  /** Targets only Volkonov's melody adds (a buffed diagram; empty otherwise). */
  extra: Set<string>;
  /** Venoa: squares her arrows reach (an enemy there is shot; she does not move). */
  shot: Set<string>;
  /** Glacia: her glide lanes (she slides until something stops her: drawn as a fading lane). */
  glide: Set<string>;
}

/** Diagram lanes for patterns an empty board cannot show (Venoa's shots, Glacia's glide). */
function specialOffsets(character: CharacterId, level: Level): { shot: { dr: number; dc: number }[]; glide: { dr: number; dc: number }[] } {
  const shot: { dr: number; dc: number }[] = [];
  const glide: { dr: number; dc: number }[] = [];
  if (character === 'venoa') {
    const lanes = level >= VENOA_DIAG_LEVEL ? [[1, 0], [1, -1], [1, 1]] : [[1, 0]];
    for (const [dr, dc] of lanes) for (let k = VENOA_SHOT_MIN; k <= VENOA_SHOT_MAX[level]; k++) shot.push({ dr: dr * k, dc: dc * k });
  }
  if (character === 'glacia') {
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = 1; k <= 3; k++) glide.push({ dr: dr * k, dc: dc * k });
  }
  return { shot, glide };
}

const patternCache = new Map<string, Pattern | null>();

/** Relative offsets (dr forward, dc) a lone piece reaches from `origin` on an empty board. */
function offsetsFrom(character: CharacterId, level: Level, origin: { r: number; c: number }, awake: boolean, buff: boolean): { dr: number; dc: number }[] {
  const piece: Piece = { id: `p0-${character}`, owner: 0, character, level, pos: origin, ...(awake ? { awaken: AWAKEN_TURNS } : {}), ...(buff ? { buff: 2 } : {}) };
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
  // Player 0 moves toward +r; the diagram draws forward as "up".
  return getTargetsForPiece(state, piece).map((m) => ({ dr: m.to.r - origin.r, dc: m.to.c - origin.c }));
}

function computePattern(character: CharacterId, level: Level, awake = false, buff = false): Pattern | null {
  const key = `${character}:${level}:${awake ? 1 : 0}:${buff ? 1 : 0}`;
  if (patternCache.has(key)) return patternCache.get(key)!;
  let result: Pattern | null = null;
  try {
    // Room for the longest reach of every pattern on 10 x 10: 6 rows ahead (Marki 3성 needs 5),
    // 3 behind (Sad / Insaner). Every pattern is left-right symmetric but 10 columns have no middle
    // square, so the reach is measured from both middle columns and merged: Larhen 3성 jumps 5 to
    // each side (column 4 leaves only 4 to the left, column 5 only 4 to the right).
    const seen = new Map<string, { dr: number; dc: number }>();
    const baseKeys = new Set<string>();
    for (const c of [4, 5]) {
      for (const x of offsetsFrom(character, level, { r: 3, c }, awake, false)) {
        seen.set(`${x.dr},${x.dc}`, x);
        baseKeys.add(`${x.dr},${x.dc}`);
      }
      if (buff) for (const x of offsetsFrom(character, level, { r: 3, c }, awake, true)) seen.set(`${x.dr},${x.dc}`, x);
    }
    // Glacia's glide ends wherever she is stopped: an empty board only shows its far ends, so the
    // diagram draws each glide lane instead; Venoa's arrows need a target, so they are added too.
    if (character === 'glacia') for (const [k, x] of seen) if (x.dr === 0 || x.dc === 0) seen.delete(k);
    const special = specialOffsets(character, level);
    for (const x of [...special.shot, ...special.glide]) seen.set(`${x.dr},${x.dc}`, x);
    const rel = [...seen.values()];
    const maxFwd = Math.max(0, ...rel.map((x) => x.dr));
    const maxBack = Math.max(0, ...rel.map((x) => -x.dr));
    const halfW = Math.max(1, ...rel.map((x) => Math.abs(x.dc)));
    const fwd = Math.max(maxFwd, 1);
    const back = maxBack;
    const rows = fwd + back + 1;
    const cols = halfW * 2 + 1;
    const o = { r: fwd, c: halfW };
    const cellOf = (x: { dr: number; dc: number }) => `${o.r - x.dr},${o.c + x.dc}`;
    result = {
      rows,
      cols,
      origin: o,
      targets: new Set(rel.map(cellOf)),
      back: new Set(rel.filter((x) => x.dr < 0 && x.dc === 0).map(cellOf)),
      extra: new Set(rel.filter((x) => !baseKeys.has(`${x.dr},${x.dc}`) && !special.shot.concat(special.glide).some((y) => y.dr === x.dr && y.dc === x.dc)).map(cellOf)),
      shot: new Set(special.shot.map(cellOf)),
      glide: new Set(special.glide.map(cellOf)),
    };
  } catch (e) {
    console.warn('movement pattern unavailable', e);
  }
  patternCache.set(key, result);
  return result;
}

/** Squares a character reaches from the diagram's open-board square (the collection's reach stat). */
export function movementReach(character: CharacterId, level: Level, awake = false): number {
  return computePattern(character, level, awake)?.targets.size ?? 0;
}

/** Rows x columns of a character's movement diagram (to size it into a fixed box). */
export function movementSpan(character: CharacterId, level: Level, awake = false, buff = false): { rows: number; cols: number } {
  const p = computePattern(character, level, awake, buff);
  return p ? { rows: p.rows, cols: p.cols } : { rows: 1, cols: 1 };
}

/**
 * Tiny CSS grid showing where a character can go from the center square. Forward is up. `awake`
 * draws Rakaeli's transformed ("타천") pattern instead (crimson, `is-awake`); `buff` adds the
 * squares Volkonov's melody gives (rose, `is-buff`).
 */
export function movementDiagram(character: CharacterId, level: Level, opts: { cell?: number; owner?: PlayerId; awake?: boolean; buff?: boolean } = {}): HTMLElement {
  const def = CHARACTERS[character];
  const awake = !!opts.awake && !!def.awakeDescKo;
  const buff = !!opts.buff;
  const p = computePattern(character, level, awake, buff);
  const cell = opts.cell ?? 9;
  // Picker's diagonals are hops (round landing pads in a chain), not slides.
  const hop = character === 'picker';
  const traps = character === 'michelle';
  const desc = awake ? `${def.skill?.nameKo ?? ''} ${def.awakeDescKo![level - 1]}` : def.descKo[level - 1];
  const wrap = h('div', {
    class: `move-diagram owner-${opts.owner ?? 0}${hop ? ' is-hop' : ''}${traps ? ' is-traps' : ''}${awake ? ' is-awake' : ''}`,
    role: 'img',
    'aria-label': `${def.nameKo} ${level}성 이동 범위: ${desc}${buff ? ' · 선율로 상하좌우 +1칸' : ''}`,
  });
  if (!p) return wrap;
  wrap.style.gridTemplateColumns = `repeat(${p.cols}, ${cell}px)`;
  wrap.style.gridAutoRows = `${cell}px`;
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const isOrigin = r === p.origin.r && c === p.origin.c;
      const isTarget = p.targets.has(`${r},${c}`);
      const isBack = traps && p.back.has(`${r},${c}`);
      const isBuff = p.extra.has(`${r},${c}`);
      const isShot = p.shot.has(`${r},${c}`);
      const isGlide = p.glide.has(`${r},${c}`);
      wrap.appendChild(
        h('span', { class: `md-cell${isOrigin ? ' is-origin' : ''}${isTarget ? ' is-target' : ''}${isBack ? ' is-back' : ''}${isBuff ? ' is-buff' : ''}${isShot ? ' is-shot' : ''}${isGlide ? ' is-glide' : ''}` }),
      );
    }
  }
  return wrap;
}
