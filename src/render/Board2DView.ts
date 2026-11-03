/**
 * Lightweight Canvas2D fallback board (flat, top-down) used when WebGL is unavailable.
 * Same palette, highlights, pieces, animations and API as the WebGL BoardView, and the same
 * "Dark Arena" look (arena.ts): the iron frame, the raised slate tiles and the field overlay are
 * painted once per size into a static layer; each frame draws that layer plus only the tiles whose
 * tint differs (highlights, storm, wasteland), markers (luminous sprites cached per size, blended
 * with 'lighter' like the WebGL additive markers), tokens and effects. Transparent canvas.
 * Player 0 (row 0) is at the bottom of the screen; col 0 at the left.
 *
 * Pieces are illustrated tokens: the character's face art (public/chars/<id>-lv<n>-face.jpg,
 * HTMLImageElement cached, neutral placeholder until loaded) in a team-coloured rim with gold star
 * pips, pre-rendered once per (character, level, team, size) into an offscreen canvas; the rarity
 * ring around it is drawn live (legendary = rotating rainbow, ~30 fps only while one is on board and
 * motion is allowed). Captures: the attacker slides to strike range, lunges, the strike lands
 * (onImpact) with the character's FX (sad holy slash + light beam, marki cracks + dust + heavy
 * shake, walk shield shock ring, insaner violet flames + soul stream), the victim flashes, shakes and
 * shatters, the attacker steps in. Enemy reach previews (tone 'enemy') are red.
 *
 * Brutile's wasteland (setWaste): cached per-square sprites (waste2d.ts) of scorched ground with
 * glowing green cracks that run on into neighbouring wasteland squares, a pulsing additive glow and
 * a poison bubble per square (~30 fps, static with reduced motion). setSkillPreview draws the
 * targeting overlay, animateSkill the cast (rune, green bolt, squares cracking open), wasted moves
 * dissolve the mover in green, and deadly move targets show a skull instead of the dot.
 */
import { BOARD_SIZE, ZONE_DEPTH } from '../engine/types';
import type { CharacterId, Level, Move, Piece, PlayerId, Pos } from '../engine/types';
import type { BoardHighlights, IBoardView, SkillPreview } from './types';
import { ANIM, BOARD_COLORS, CHARACTER_FX, CHARACTER_RARITY, RARITY_RING, TEAM_COLORS, WASTE_COLORS } from './palette';
import { STORM_COLORS } from './storm';
import { wasteMask } from './waste';
import { Waste2DSprites, wasteVariant } from './waste2d';
import {
  clamp01,
  containerSize,
  easeInOutCubic,
  easeOutCubic,
  faceUrl,
  hexToRgb,
  indexHighlights,
  mixRgb,
  posKey,
  prefersReducedMotion,
  pulse01,
  rgbToCss,
  shakeOffset,
  slideDuration,
  tileRgb,
} from './common';
import type { HighlightIndex } from './common';
import {
  FRAME_FIT,
  MARKER_QUAD,
  paintCaptureRing,
  paintFieldOverlay,
  paintFrame,
  paintGlowDot,
  paintSelectGlow,
  paintTile,
  tileOuterPath,
} from './arena';

const TAP_SLOP_PX = 14;
const MAX_PIXEL_RATIO = 2;
const IDLE_FRAME_MS = 32;
/** Storm removal: dissolve length (ms). */
const STORM_MS = 520;
/** Capture timeline (ms after the impact): recoil, death (shatter), attacker steps in. */
const HIT_MS = 140;
const DEATH_MS = 340;
const STEP_AT = 200;
const STEP_MS = 200;
const STRIKE_RANGE = 0.62;
const CHAIN_WINDOW_MS = 8000;
/** Capture FX length (ms). */
const FX_MS = 620;
/** Token radius and rarity ring radius (fractions of a cell). */
/** Token sprite size (fraction of a cell): the coin (r 0.385) + its edge and keyline. */
const TOKEN_SPRITE = 0.92;
const RING_R = 0.452;
/** Storm tile tint strength (matches the WebGL board). */
const STORM_TILE_ALPHA = 0.5;
/** Wasted move: the mover's toxic dissolve (ms). */
const WASTE_DIE_MS = 560;
/** Brutile's cast timeline (ms): bolt launch / travel, first crack, crack-open length, rune life. */
const SKILL_BOLT_AT = 190;
const SKILL_BOLT_MS = 250;
const SKILL_CRACK_AT = 430;
const SKILL_CRACK_MS = 300;
const SKILL_RUNE_MS = 1000;

interface Skill2D {
  start: number;
  casterId: string | null;
  from: { r: number; c: number };
  centre: { r: number; c: number };
  squares: { sq: number; at: number; fired: boolean }[];
  boltAt: number;
  duration: number;
  /** Bow of the bolt (signed, in cells) so it arcs sideways. */
  bow: number;
  shook: boolean;
  resolve: () => void;
}

interface Layout {
  /** Board origin (top-left of the slab interior) in CSS px. */
  x0: number;
  y0: number;
  cell: number;
  pad: number;
}

interface Anim2D {
  move: Move;
  start: number;
  duration: number;
  moveDur: number;
  moverId: string;
  character: CharacterId;
  from: Pos;
  to: Pos;
  /** End of the approach (fractional board coords): `to`, or strike range for captures. */
  strike: { r: number; c: number };
  jump: boolean;
  charge: boolean;
  chain: boolean;
  capture: boolean;
  captured: Piece | null;
  impactAt: number;
  impactFired: boolean;
  deathStart: number;
  stepStart: number;
  landed: boolean;
  /** The mover steps onto wasteland and dissolves there (absent from piecesAfter). */
  wasted: boolean;
  piecesAfter: Piece[];
  resolve: () => void;
}

/** Shared face images (the browser caches the files; one decode per session). */
const faceImages = new Map<string, HTMLImageElement>();
const faceWaiters = new Set<() => void>();

function faceImage(character: CharacterId, level: Level): HTMLImageElement | null {
  const url = faceUrl(character, level);
  let img = faceImages.get(url);
  if (!img) {
    if (typeof Image === 'undefined') return null;
    img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      for (const w of faceWaiters) w();
    };
    img.src = url;
    faceImages.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export class Board2DView implements IBoardView {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private pieces: Piece[] = [];
  private highlights: BoardHighlights = {};
  private hi: HighlightIndex = indexHighlights({});
  private layout: Layout = { x0: 0, y0: 0, cell: 1, pad: 0 };
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private cellCb: ((pos: Pos) => void) | null = null;
  private impactCb: ((move: Move) => void) | null = null;
  private interactive = true;
  private anim: Anim2D | null = null;
  private rafId = 0;
  private disposed = false;
  private disposing = false;
  private resizeObserver: ResizeObserver | null = null;
  private down: { id: number; x: number; y: number } | null = null;
  /** Static board layer (frame, base slate tiles, field overlay) at device pixels, rebuilt on resize. */
  private boardLayer: HTMLCanvasElement | null = null;
  private turn: PlayerId = 0;
  private tLand = -1;
  private landAt: { r: number; c: number } = { r: 0, c: 0 };
  private landColor = '#ffffff';
  /** Capture FX: start, kind, place, strike direction (screen), seeds, soul target id. */
  private tCap = -1;
  private capKind: CharacterId = 'sad';
  private capAt: { r: number; c: number } = { r: 0, c: 0 };
  private capDir = { x: 0, y: -1 };
  private capBurst: { a: number; v: number }[] = [];
  private soulTo: string | null = null;
  private shakeAmp = 1;
  private shakeMs: number = ANIM.shake;
  /** Skill FX: sad glint (start + place), mover trail (screen points, newest last). */
  private tGlint = -1;
  private glintAt = { x: 0, y: 0 };
  private glintColor = '#ffffff';
  private readonly trail: { x: number; y: number; t: number }[] = [];
  private trailColor = '#ffffff';
  private lastCapture: { id: string; t: number } | null = null;
  private tTurn = -1;
  private lastFrame = 0;
  /** Storm state (see setStorm) and the pieces it is taking (ghosts drawn while they dissolve). */
  private storm = 0;
  private stormNext: number | null = null;
  private readonly fading: { piece: Piece; start: number }[] = [];
  private readonly reducedMotion = prefersReducedMotion();
  private hasLegendary = false;
  /** Pre-rendered tokens keyed by look + pixel size. */
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  /** Wasteland squares, their reveal (< 1 only while the cast cracks them open), sprites. */
  private readonly waste = new Set<number>();
  private readonly wasteOpen = new Map<number, number>();
  private readonly wasteSprites = new Waste2DSprites();
  /** Skill targeting overlay and the running cast. */
  private anchors: number[] = [];
  private preview: SkillPreview | null = null;
  private previewSet = new Set<number>();
  private skill: Skill2D | null = null;
  /** Bolt-impact flash at the area centre (start time) and cast sparks. */
  private tSkillHit = -1;
  private readonly skillSparks: { x: number; y: number; a: number; v: number; t0: number }[] = [];
  private readonly onFaceLoaded = (): void => {
    this.sprites.clear();
    this.requestRender();
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D unavailable');
    this.ctx = ctx;
    const st = this.canvas.style;
    st.display = 'block';
    st.width = '100%';
    st.height = '100%';
    st.touchAction = 'none';
    st.userSelect = 'none';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(this.canvas);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    faceWaiters.add(this.onFaceLoaded);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    this.resize();
  }

  // ---------------------------------------------------------------- public API

  setPieces(pieces: Piece[]): void {
    if (this.disposed) return;
    this.finishAnimation(false);
    this.collectStormVictims(pieces, null);
    this.setPieceList(clonePieces(pieces));
    this.requestRender();
  }

  private setPieceList(list: Piece[]): void {
    this.pieces = list;
    this.hasLegendary = list.some((p) => CHARACTER_RARITY[p.character] === 'legendary');
  }

  /**
   * Storm state: `storm` columns consumed per side (0 = none), `nextIn` plies until the next shrink
   * (null = inactive). Storm columns get a purple field, a glowing boundary line and dimmed tiles;
   * with nextIn <= 2 the next columns pulse a warning frame.
   */
  setStorm(storm: number, nextIn: number | null): void {
    if (this.disposed) return;
    this.storm = Math.max(0, Math.min(6, Math.floor(storm)));
    this.stormNext = nextIn;
    this.requestRender();
  }

  /** Wasteland squares (r * 12 + c, full list). */
  setWaste(squares: number[]): void {
    if (this.disposed) return;
    const next = squares.filter((q) => Number.isInteger(q) && q >= 0 && q < BOARD_SIZE * BOARD_SIZE);
    for (const q of [...this.wasteOpen.keys()]) if (!next.includes(q)) this.wasteOpen.delete(q);
    this.waste.clear();
    for (const q of next) this.waste.add(q);
    this.requestRender();
  }

  /** Skill targeting: anchors get a subtle green tint, the preview area a green (or red) ghost. */
  setSkillPreview(anchors: number[] | null, preview: SkillPreview | null): void {
    if (this.disposed) return;
    this.anchors = anchors ? [...anchors] : [];
    this.preview = preview ? { squares: [...preview.squares], valid: preview.valid } : null;
    this.previewSet = new Set(this.preview?.squares ?? []);
    this.requestRender();
  }

  /**
   * Brutile lays wasteland: rune + flare on the caster, a green bolt to the area, the squares crack
   * open one after another, small shake. Always resolves (also when cut short or disposed).
   */
  animateSkill(caster: string, squares: number[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishAnimation(false);
    const list = [...new Set(squares)].filter((q) => Number.isInteger(q) && q >= 0 && q < BOARD_SIZE * BOARD_SIZE);
    if (list.length === 0) return Promise.resolve();
    const now = performance.now();
    const cp = this.pieces.find((p) => p.id === caster) ?? null;
    const centre = { r: 0, c: 0 };
    for (const q of list) {
      centre.r += Math.floor(q / BOARD_SIZE) / list.length;
      centre.c += (q % BOARD_SIZE) / list.length;
    }
    const from = cp ? { ...cp.pos } : { ...centre };
    const cells = list.map((q) => {
      const r = Math.floor(q / BOARD_SIZE);
      const c = q % BOARD_SIZE;
      return { q, d: Math.hypot(r - centre.r, c - centre.c) + 0.01 * Math.hypot(r - from.r, c - from.c) };
    });
    cells.sort((a, b) => a.d - b.d);
    const crackAt = cp ? SKILL_CRACK_AT : 120;
    const stagger = cells.length > 1 ? Math.min(75, 380 / (cells.length - 1)) : 0;
    for (const c of cells) {
      if (!this.waste.has(c.q)) this.wasteOpen.set(c.q, 0);
      this.waste.add(c.q);
    }
    const dc = centre.c - from.c;
    return new Promise<void>((resolve) => {
      this.skill = {
        start: now,
        casterId: cp ? cp.id : null,
        from,
        centre,
        squares: cells.map((c, i) => ({ sq: c.q, at: crackAt + i * stagger, fired: false })),
        boltAt: cp ? SKILL_BOLT_AT : 0,
        duration: crackAt + stagger * (cells.length - 1) + SKILL_CRACK_MS + 40,
        bow: Math.min(1.6, 0.35 * Math.hypot(centre.r - from.r, dc)) * (dc >= 0 ? 1 : -1),
        shook: false,
        resolve,
      };
      this.requestRender();
    });
  }

  private tickSkill(now: number): void {
    const s = this.skill;
    if (!s) return;
    const t = now - s.start;
    if (t >= s.duration) {
      this.finishSkill();
      return;
    }
    for (const q of s.squares) {
      const k = (t - q.at) / SKILL_CRACK_MS;
      if (k < 0) continue;
      if (this.wasteOpen.has(q.sq)) this.wasteOpen.set(q.sq, easeOutCubic(clamp01(k)));
      if (!q.fired) {
        q.fired = true;
        const x = this.cx(q.sq % BOARD_SIZE);
        const y = this.cy(Math.floor(q.sq / BOARD_SIZE));
        for (let i = 0; i < 7; i++) this.skillSparks.push({ x, y, a: i * 0.9 + q.sq * 0.37, v: 0.7 + 0.3 * Math.sin(q.sq + i * 2.1), t0: now });
        if (!s.shook) {
          s.shook = true;
          this.tSkillHit = now;
          this.tShake = now;
          this.shakeAmp = this.reducedMotion ? 0 : 1.7;
          this.shakeMs = 240;
        }
      }
    }
  }

  /** End the cast now (natural end or cut short): every square fully open. */
  private finishSkill(): void {
    const s = this.skill;
    if (!s) return;
    this.skill = null;
    for (const q of s.squares) this.wasteOpen.delete(q.sq);
    this.requestRender();
    s.resolve();
  }

  private get stormActive(): boolean {
    return this.storm > 0 || this.stormNext !== null;
  }

  private stormColumn(c: number, slack = 0): boolean {
    const n = this.storm + slack;
    return c < n || c >= BOARD_SIZE - n;
  }

  /** Pieces missing from `next` (other than `skipId`) that stood near the storm edge dissolve. */
  private collectStormVictims(next: Piece[], skipId: string | null): void {
    if (!this.stormActive) return;
    const seen = new Set(next.map((p) => p.id));
    const now = performance.now();
    for (const p of this.pieces) {
      if (seen.has(p.id) || p.id === skipId || !this.stormColumn(p.pos.c, 1)) continue;
      this.fading.push({ piece: { ...p, pos: { ...p.pos } }, start: now });
    }
  }

  animateMove(move: Move, piecesAfter: Piece[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishAnimation(false);
    const mover = this.pieces.find((p) => p.id === move.pieceId);
    if (!mover) {
      this.setPieceList(clonePieces(piecesAfter));
      this.requestRender();
      if (move.captureId) this.emitImpact(move);
      return Promise.resolve();
    }
    const now = performance.now();
    const ch = mover.character;
    const chain = ch === 'insaner' && this.lastCapture?.id === move.pieceId && now - this.lastCapture.t < CHAIN_WINDOW_MS;
    this.lastCapture = null;
    const captured = move.captureId ? (this.pieces.find((p) => p.id === move.captureId) ?? null) : null;
    const capture = !!move.captureId;
    const wasted = !!move.wasted && !capture;
    const jump = ch === 'walk';
    const moveDur = jump ? ANIM.jump : slideDuration(move);
    const dr = move.to.r - move.from.r;
    const dc = move.to.c - move.from.c;
    const dist = Math.hypot(dr, dc);
    const f = capture && dist > 1e-6 ? Math.max(0, (dist - STRIKE_RANGE) / dist) : 1;
    const strike = { r: move.from.r + dr * f, c: move.from.c + dc * f };
    const impactAt = capture ? moveDur + (jump ? 90 : 60) : Infinity;
    const deathStart = impactAt + HIT_MS;
    const stepStart = impactAt + STEP_AT;
    const duration = capture
      ? Math.max(stepStart + STEP_MS, deathStart + DEATH_MS) + 20
      : wasted
        ? moveDur + WASTE_DIE_MS + 30
        : moveDur + (jump ? ANIM.land : 40);
    // Skill flavour on move start.
    this.trail.length = 0;
    const fx = CHARACTER_FX[ch];
    if (ch === 'sad' || ch === 'brutile') {
      this.tGlint = now;
      this.glintAt = { x: this.cx(mover.pos.c), y: this.cy(mover.pos.r) - this.layout.cell * (ch === 'sad' ? 0.25 : 0) };
      this.glintColor = fx.primary;
    } else if (chain) {
      this.tGlint = now;
      this.glintAt = { x: this.cx(mover.pos.c), y: this.cy(mover.pos.r) };
      this.glintColor = '#FF4FE8';
    }
    this.trailColor = chain ? '#D04BFF' : ch === 'marki' ? '#FFE2B0' : fx.primary;
    return new Promise<void>((resolve) => {
      this.anim = {
        move,
        start: now,
        duration,
        moveDur,
        moverId: move.pieceId,
        character: ch,
        from: { ...move.from },
        to: { ...move.to },
        strike,
        jump,
        charge: ch === 'marki' && dist >= 2,
        chain,
        capture,
        captured,
        impactAt,
        impactFired: false,
        deathStart,
        stepStart,
        landed: false,
        wasted,
        piecesAfter: clonePieces(piecesAfter),
        resolve,
      };
      this.requestRender();
    });
  }

  /** Register the strike-impact listener (called once per capturing move, at the impact frame). */
  onImpact(cb: (move: Move) => void): void {
    this.impactCb = cb;
  }

  private emitImpact(move: Move): void {
    try {
      this.impactCb?.(move);
    } catch (err) {
      console.error('[render] onImpact listener failed:', err);
    }
  }

  setHighlights(h: BoardHighlights): void {
    if (this.disposed) return;
    this.highlights = h;
    this.hi = indexHighlights(h);
    this.requestRender();
  }

  onCellClick(cb: (pos: Pos) => void): void {
    this.cellCb = cb;
  }

  setInteractive(enabled: boolean): void {
    this.interactive = enabled;
    if (!enabled) this.down = null;
    this.canvas.style.cursor = enabled ? 'pointer' : 'default';
  }

  /** Optional extra (not part of IBoardView): the side to move changed; sweeps its zone line. */
  setTurn(player: 0 | 1): void {
    if (this.disposed) return;
    this.turn = player;
    this.tTurn = performance.now();
    this.requestRender();
  }

  resize(): void {
    if (this.disposed) return;
    const { w, h } = containerSize(this.container);
    this.cssW = w;
    this.cssH = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    // Same framing as the WebGL board: the iron frame (+ its lip) fills the limiting side.
    const F = FRAME_FIT;
    const spanX = BOARD_SIZE + F.side * 2;
    const topE = F.top;
    const botE = F.bottom;
    const cell = Math.max(1, Math.min((w * 0.985) / spanX, (h * 0.975) / (BOARD_SIZE + topE + botE)));
    const size = cell * BOARD_SIZE;
    const pad = F.side * cell;
    this.layout = { x0: (w - size) / 2, y0: (h - (BOARD_SIZE + topE + botE) * cell) / 2 + topE * cell, cell, pad };
    this.sprites.clear();
    this.wasteSprites.clear();
    this.buildBoardLayer();
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposing = true;
    this.finishAnimation(false);
    this.disposed = true;
    this.impactCb = null;
    faceWaiters.delete(this.onFaceLoaded);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.boardLayer = null;
    this.sprites.clear();
    this.wasteSprites.clear();
    this.canvas.remove();
    this.pieces = [];
    this.cellCb = null;
  }

  // ---------------------------------------------------------------- render loop

  /**
   * Paint the static arena once per size (arena.ts): iron frame + field well, the 144 raised slate
   * tiles in their base colours (home tints included) and the field overlay (frame AO).
   * Per frame only highlight / storm / wasteland tints are drawn over it.
   */
  private buildBoardLayer(): void {
    const cvs = this.boardLayer ?? document.createElement('canvas');
    const d = this.dpr;
    cvs.width = Math.max(1, Math.round(this.cssW * d));
    cvs.height = Math.max(1, Math.round(this.cssH * d));
    const g = cvs.getContext('2d');
    if (g) {
      const { x0, y0, cell } = this.layout;
      const s = cell * d;
      const ox = x0 * d;
      const oy = y0 * d;
      g.clearRect(0, 0, cvs.width, cvs.height);
      paintFrame(g, s, ox, oy);
      const base = indexHighlights({});
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) paintTile(g, ox + c * s, oy + (BOARD_SIZE - 1 - r) * s, s, tileRgb(r, c, base));
      }
      paintFieldOverlay(g, s, ox, oy);
    }
    this.boardLayer = cvs;
  }

  private requestRender(): void {
    if (this.disposed || this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private get pulsing(): boolean {
    const h = this.highlights;
    return !!h.selected || (h.moves?.length ?? 0) > 0 || (h.captures?.length ?? 0) > 0 || (h.deadly?.length ?? 0) > 0;
  }

  private fxActive(now: number): boolean {
    return (
      (this.tLand >= 0 && now - this.tLand < ANIM.pulse) ||
      (this.tCap >= 0 && now - this.tCap < FX_MS + 300) ||
      (this.tShake >= 0 && now - this.tShake < this.shakeMs) ||
      (this.tGlint >= 0 && now - this.tGlint < 320) ||
      (this.tTurn >= 0 && now - this.tTurn < ANIM.turn) ||
      this.trail.length > 0 ||
      this.fading.length > 0 ||
      (this.tSkillHit >= 0 && now - this.tSkillHit < 520) ||
      this.skillSparks.length > 0
    );
  }

  private tShake = -1;

  private readonly frame = (now: number): void => {
    this.rafId = 0;
    if (this.disposed) return;
    if (this.anim) this.tickAnim(now);
    this.tickSkill(now);
    const busy = !!this.anim || !!this.skill || this.fxActive(now);
    const ringLoop = this.hasLegendary && !this.reducedMotion && !document.hidden;
    // Wasteland glow / bubbles and the targeting ghost breathe at <= ~30 fps (static if reduced motion).
    const wasteLoop = !this.reducedMotion && !document.hidden && (this.waste.size > 0 || this.anchors.length > 0 || this.preview !== null);
    const loop = this.pulsing || ringLoop || wasteLoop || this.storm > 0 || (this.stormActive && this.stormNext !== null && this.stormNext <= 2);
    if (!busy && loop && now - this.lastFrame < IDLE_FRAME_MS) {
      this.requestRender();
      return;
    }
    this.lastFrame = now;
    this.draw(now);
    if (busy || loop) this.requestRender();
  };

  private tickAnim(now: number): void {
    const a = this.anim;
    if (!a) return;
    const t = now - a.start;
    if (t >= a.duration) {
      this.finishAnimation(true);
      return;
    }
    if (!a.landed && t >= a.moveDur) {
      a.landed = true;
      this.tLand = now;
      this.landAt = { ...a.strike };
      const m = this.pieces.find((p) => p.id === a.moverId);
      this.landColor = a.wasted ? WASTE_COLORS.glow : a.jump ? CHARACTER_FX.walk.primary : TEAM_COLORS[m ? m.owner : 0].glow;
    }
    if (a.capture && !a.impactFired && t >= a.impactAt) {
      a.impactFired = true;
      this.startImpact(a, now);
      this.emitImpact(a.move);
    }
  }

  private startImpact(a: Anim2D, now: number): void {
    this.tCap = now;
    this.tShake = now;
    this.capKind = a.character;
    this.capAt = a.captured ? { ...a.captured.pos } : { ...a.to };
    const dc = a.to.c - a.from.c;
    const dr = a.to.r - a.from.r;
    const l = Math.hypot(dc, dr) || 1;
    this.capDir = { x: dc / l, y: -dr / l };
    this.capBurst = Array.from({ length: 12 }, (_, i) => ({
      a: (i / 12) * Math.PI * 2 + Math.sin(now + i * 7.3) * 0.35,
      v: 0.8 + 0.5 * (0.5 + 0.5 * Math.sin(now * 0.37 + i * 3.1)),
    }));
    this.shakeAmp =
      a.character === 'marki' ? (this.reducedMotion ? 0.5 : 2.6) : a.character === 'walk' ? 1.5 : a.character === 'brutile' ? (this.reducedMotion ? 0.6 : 1.6) : 1;
    this.shakeMs = a.character === 'marki' ? 260 : ANIM.shake;
    this.soulTo = a.character === 'insaner' ? a.moverId : null;
    if (a.character === 'insaner') this.lastCapture = { id: a.moverId, t: now };
  }

  private finishAnimation(natural: boolean): void {
    this.finishSkill();
    const a = this.anim;
    if (!natural) {
      this.tLand = -1;
      this.tCap = -1;
      this.tShake = -1;
      this.tTurn = -1;
      this.tGlint = -1;
      this.tSkillHit = -1;
      this.trail.length = 0;
      this.skillSparks.length = 0;
    }
    if (!a) return;
    this.anim = null;
    // A mover destroyed on the wasteland already dissolved: never a storm ghost too.
    this.collectStormVictims(a.piecesAfter, a.wasted ? a.moverId : (a.captured?.id ?? null));
    this.setPieceList(a.piecesAfter);
    if (a.capture && !a.impactFired) {
      a.impactFired = true;
      if (!this.disposing) this.emitImpact(a.move);
    }
    this.requestRender();
    a.resolve();
  }

  // ---------------------------------------------------------------- drawing

  private cx(c: number): number {
    return this.layout.x0 + (c + 0.5) * this.layout.cell;
  }

  private cy(r: number): number {
    return this.layout.y0 + (BOARD_SIZE - 1 - r + 0.5) * this.layout.cell;
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Transparent canvas: the page's dark backdrop shows around the frame.
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    // Camera micro-shake.
    let sx = 0;
    let sy = 0;
    if (this.tShake >= 0) {
      const k = (now - this.tShake) / this.shakeMs;
      sx = shakeOffset(k, 0) * this.shakeAmp;
      sy = shakeOffset(k, 1) * this.shakeAmp;
    }
    ctx.translate(sx, sy);

    // Static arena (frame, slate tiles, field overlay), then only the tiles whose tint differs.
    if (this.boardLayer) ctx.drawImage(this.boardLayer, 0, 0, this.cssW, this.cssH);
    const hi = this.hi;
    const zone = hi.zone;
    const tinted = (k: number, r: number): boolean =>
      hi.selected === k || hi.last.has(k) || hi.captures.has(k) || (hi.enemy && hi.moves.has(k)) || (zone !== null && r >= zone[0] && r <= zone[1]);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const k = r * BOARD_SIZE + c;
        const storm = this.storm > 0 && this.stormColumn(c);
        const wk = this.wasteK(k);
        const tint = tinted(k, r);
        if (!storm && wk <= 0 && !tint) continue;
        const tx = x0 + c * cell;
        const ty = y0 + (BOARD_SIZE - 1 - r) * cell;
        if (tint) paintTile(ctx, tx, ty, cell, tileRgb(r, c, hi));
        tileOuterPath(ctx, tx, ty, cell);
        if (storm) {
          ctx.fillStyle = hexAlpha(STORM_COLORS.tile, STORM_TILE_ALPHA);
          ctx.fill();
        }
        if (wk > 0) {
          ctx.fillStyle = hexAlpha(WASTE_COLORS.tile, 0.85 * wk);
          ctx.fill();
        }
      }
    }

    this.drawWaste(now);
    this.drawZoneLines(now);
    this.drawStorm(now);
    this.drawSkillPreview(now);

    // Overlays: own reach = ice-cyan glow, an enemy's reach preview = red glow (additive sprites).
    const h = this.highlights;
    const enemy = this.hi.enemy;
    const selCol = enemy ? BOARD_COLORS.enemySelected : BOARD_COLORS.selected;
    const dotCol = enemy ? BOARD_COLORS.enemyMoveDot : BOARD_COLORS.moveDot;
    const sp = pulse01(now, 950);
    if (h.selected) {
      const x = this.cx(h.selected.c);
      const y = this.cy(h.selected.r);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // Soft halo under the coin + the glowing frame hugging the tile.
      const gr = cell * (0.585 + 0.13 * sp);
      const g = ctx.createRadialGradient(x, y, 0, x, y, gr);
      g.addColorStop(0, hexAlpha(selCol, 0.3 + 0.3 * sp));
      g.addColorStop(0.2, hexAlpha(selCol, 0.19 + 0.19 * sp));
      g.addColorStop(0.5, hexAlpha(selCol, 0.05 + 0.05 * sp));
      g.addColorStop(1, hexAlpha(selCol, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - gr, y - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 0.75 + 0.25 * sp;
      this.drawMarker('select', selCol, x, y, cell * (1 + 0.03 * sp));
      ctx.restore();
    }
    const deadly = new Set((h.deadly ?? []).map(posKey));
    for (const p of h.deadly ?? []) {
      // Moving there is suicide: a skull instead of the dot.
      const d = cell * (0.95 + 0.06 * sp);
      const S = Math.max(8, Math.round(cell * 0.95 * this.dpr));
      ctx.globalAlpha = 0.85 + 0.15 * sp;
      ctx.drawImage(this.wasteSprites.skullMark(S), this.cx(p.c) - d / 2, this.cy(p.r) - d / 2, d, d);
      ctx.globalAlpha = 1;
    }
    // Move targets: luminous glow dots (white-hot core, soft halo), breathing like the WebGL ones.
    if ((h.moves?.length ?? 0) > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.95 * (0.72 + 0.28 * sp);
      const ds = cell * (0.9 + 0.16 * sp);
      for (const p of h.moves ?? []) {
        if (deadly.has(posKey(p))) continue;
        this.drawMarker('dot', dotCol, this.cx(p.c), this.cy(p.r), ds);
      }
      ctx.restore();
    }

    const sk = this.skill;
    if (sk && sk.casterId) this.drawRune(this.cx(sk.from.c), this.cy(sk.from.r), cell * 1.15, (now - sk.start) / SKILL_RUNE_MS, (now - sk.start) * 0.0016);
    // Pieces (back rows first so overlaps read naturally).
    const a = this.anim;
    const t = a ? now - a.start : 0;
    const list = [...this.pieces].sort((p, q) => q.pos.r - p.pos.r);
    let moverDraw: (() => void) | null = null;
    let moverXY = { x: 0, y: 0 };
    for (const p of list) {
      if (a && p.id === a.moverId) {
        const k = clamp01(t / a.moveDur);
        const e = easeInOutCubic(k);
        let fr = a.from.r + (a.strike.r - a.from.r) * e;
        let fc = a.from.c + (a.strike.c - a.from.c) * e;
        if (a.capture) {
          const l = Math.hypot(a.to.r - a.from.r, a.to.c - a.from.c) || 1;
          const lunge = 0.16 * bump(a.impactAt - 110, a.impactAt + 150, t);
          fr += ((a.to.r - a.from.r) / l) * lunge;
          fc += ((a.to.c - a.from.c) / l) * lunge;
          if (t >= a.stepStart) {
            const ks = easeInOutCubic(clamp01((t - a.stepStart) / STEP_MS));
            fr = a.strike.r + (a.to.r - a.strike.r) * ks;
            fc = a.strike.c + (a.to.c - a.strike.c) * ks;
          }
        }
        const x = this.cx(fc);
        const y = this.cy(fr);
        let lift = a.jump ? Math.sin(Math.PI * k) : 0.2 * Math.sin(Math.PI * k);
        let sxz = 1 + lift * 0.18;
        let syy = 1;
        if (a.jump && t > a.moveDur) {
          const sq = Math.sin(Math.PI * clamp01((t - a.moveDur) / ANIM.land));
          lift = 0;
          sxz = 1 + 0.1 * sq;
          syy = 1 - 0.14 * sq;
        }
        const pop = 1 + 0.14 * bump(a.impactAt - 90, a.impactAt + 170, t);
        moverXY = { x, y: y - lift * cell * 0.1 };
        if (t < a.moveDur && (a.jump || a.chain || a.charge || a.character === 'brutile')) this.pushTrail(moverXY.x, moverXY.y, now);
        if (a.wasted && t >= a.moveDur) {
          const tx = this.cx(a.to.c);
          const ty = this.cy(a.to.r);
          moverDraw = () => this.drawWastedPiece(p, tx, ty, t - a.moveDur, now);
          continue;
        }
        moverDraw = () => this.drawPiece(p, x, y, sxz * pop, syy * pop, 1, lift, now);
        continue;
      }
      if (a && a.captured && p.id === a.captured.id) {
        const x = this.cx(p.pos.c);
        const y = this.cy(p.pos.r);
        if (t < a.impactAt) {
          this.drawPiece(p, x, y, 1, 1, 1, 0, now);
        } else {
          this.drawVictim(p, x, y, t - a.impactAt, t, a, now);
        }
        continue;
      }
      const sel = posKey(p.pos) === this.hi.selected;
      const bob = sel ? 0.5 + 0.1 * Math.sin(now / 240) : 0;
      let sc = sel ? 1.05 : 1;
      let flash = 0;
      if (sk && p.id === sk.casterId) {
        const tk = now - sk.start;
        sc *= 1 + 0.2 * bump(0, 420, tk) + 0.08 * bump(sk.boltAt, sk.boltAt + 260, tk);
        flash = 0.4 * Math.max(0, 1 - tk / 260);
      }
      this.drawPiece(p, this.cx(p.pos.c), this.cy(p.pos.r), sc, sc, 1, bob, now, flash);
    }
    // Capture targets sit on top of the threatened tokens.
    const cp = pulse01(now, 700);
    for (const p of h.captures ?? []) this.drawMarker('capture', BOARD_COLORS.capture, this.cx(p.c), this.cy(p.r), cell * (0.96 + 0.07 * cp));
    this.drawTrail(now);
    if (moverDraw) moverDraw();
    this.drawStormGhosts(now);
    this.drawSkillFx(now);

    this.drawFx(now, a ? moverXY : null);
  }

  /** Victim of a strike: white hit flash + shake, then it swells, burns away and shatters. */
  private drawVictim(p: Piece, x: number, y: number, tk: number, t: number, a: Anim2D, now: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const l = Math.hypot(this.capDir.x, this.capDir.y) || 1;
    const kb = 0.26 * cell * easeOutCubic(clamp01(tk / (HIT_MS + DEATH_MS)));
    const shake = tk < HIT_MS ? Math.sin(tk * 0.11) * cell * 0.05 * (1 - tk / HIT_MS) : 0;
    const vx = x + (this.capDir.x / l) * kb - (this.capDir.y / l) * shake;
    const vy = y + (this.capDir.y / l) * kb + (this.capDir.x / l) * shake;
    const ck = clamp01((t - a.deathStart) / DEATH_MS);
    const s = 1 + 0.15 * easeOutCubic(ck);
    if (ck < 1) this.drawPiece(p, vx, vy, s, s, 1 - ck * ck, 0, now, Math.max(0, 1 - tk / 160) * 0.85);
    if (ck > 0) {
      // Shards flying out in the attacker's FX colour.
      const fx = CHARACTER_FX[a.character];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexAlpha(fx.primary, 0.9 * (1 - ck));
      for (let i = 0; i < 9; i++) {
        const ang = i * 0.7 + i * i * 0.13;
        const d = cell * (0.15 + 0.5 * easeOutCubic(ck)) * (0.7 + 0.3 * ((i * 5) % 3));
        const px = vx + Math.cos(ang) * d;
        const py = vy + Math.sin(ang) * d;
        const r = cell * 0.07 * (1 - ck * 0.6);
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(ang) * r * 1.6, py + Math.sin(ang) * r * 1.6);
        ctx.lineTo(px + Math.cos(ang + 2.2) * r, py + Math.sin(ang + 2.2) * r);
        ctx.lineTo(px + Math.cos(ang - 2.2) * r, py + Math.sin(ang - 2.2) * r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private pushTrail(x: number, y: number, now: number): void {
    const last = this.trail[this.trail.length - 1];
    if (last && Math.hypot(last.x - x, last.y - y) < 1) return;
    this.trail.push({ x, y, t: now });
    if (this.trail.length > 24) this.trail.shift();
  }

  /** Fading ribbon behind a leaping / charging / chaining mover. */
  private drawTrail(now: number): void {
    const tr = this.trail;
    while (tr.length > 0 && now - tr[0].t > 280) tr.shift();
    if (tr.length < 2) return;
    const ctx = this.ctx;
    const cell = this.layout.cell;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const k = 1 - (now - tr[i].t) / 280;
      if (k <= 0) continue;
      ctx.strokeStyle = hexAlpha(this.trailColor, 0.55 * k);
      ctx.lineWidth = cell * 0.3 * k * (i / tr.length);
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
      ctx.lineTo(tr[i].x, tr[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Storm field over the consumed columns, crackling boundary line, warning frame on the next column. */
  private drawStorm(now: number): void {
    if (this.storm <= 0 && !(this.stormActive && this.stormNext !== null && this.stormNext <= 2)) return;
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    const size = cell * BOARD_SIZE;
    const t = now / 1000;
    const warn = this.stormActive && this.stormNext !== null && this.stormNext <= 2 && this.storm < 6;
    ctx.save();
    for (const side of [-1, 1] as const) {
      // Consumed band: [x0, xIn] on the left, [xIn, x0 + size] on the right.
      const xIn = side < 0 ? x0 + this.storm * cell : x0 + size - this.storm * cell;
      if (this.storm > 0) {
        const bx = side < 0 ? x0 : xIn;
        const bw = this.storm * cell;
        const g = ctx.createLinearGradient(side < 0 ? x0 : x0 + size, 0, xIn, 0);
        // Purple haze over the grass (as the WebGL storm floor), brighter toward the boundary.
        g.addColorStop(0, hexAlpha(STORM_COLORS.field, 0.42));
        g.addColorStop(1, hexAlpha(STORM_COLORS.field, 0.55));
        ctx.fillStyle = g;
        ctx.fillRect(bx, y0, bw, size);
        // Drifting veins.
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = hexAlpha(STORM_COLORS.edge, 0.35);
        ctx.lineWidth = Math.max(1, cell * 0.04);
        for (let k = 0; k < this.storm * 2; k++) {
          const ph = t * 0.6 + k * 1.7;
          ctx.beginPath();
          for (let i = 0; i <= 12; i++) {
            const yy = y0 + (i / 12) * size;
            const xx = bx + bw * (0.5 + 0.42 * Math.sin(ph + i * 0.9 + k) * Math.cos(t * 0.8 + i * 0.5 + k * 2.1));
            if (i === 0) ctx.moveTo(xx, yy);
            else ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        }
        // Boundary wall: glowing line + crackling arcs.
        ctx.shadowColor = STORM_COLORS.edge;
        ctx.shadowBlur = cell * 0.5;
        ctx.strokeStyle = hexAlpha(STORM_COLORS.core, 0.75);
        ctx.lineWidth = Math.max(2, cell * 0.06);
        ctx.beginPath();
        ctx.moveTo(xIn, y0);
        ctx.lineTo(xIn, y0 + size);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = hexAlpha(STORM_COLORS.edge, 0.55);
        ctx.lineWidth = Math.max(1, cell * 0.03);
        for (let k = 0; k < 2; k++) {
          ctx.beginPath();
          for (let i = 0; i <= 24; i++) {
            const yy = y0 + (i / 24) * size;
            const xx = xIn + side * cell * 0.3 * Math.sin(i * 2.3 + t * (7 + k * 3) + k * 4) * Math.sin(i * 0.7 - t * 2);
            if (i === 0) ctx.moveTo(xx, yy);
            else ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      if (warn) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 7);
        const wx = side < 0 ? xIn : xIn - cell;
        ctx.fillStyle = hexAlpha(STORM_COLORS.edge, 0.1 + 0.18 * pulse);
        ctx.fillRect(wx, y0, cell, size);
        ctx.strokeStyle = hexAlpha(STORM_COLORS.edge, 0.55 + 0.45 * pulse);
        ctx.lineWidth = Math.max(1.5, cell * 0.06);
        ctx.strokeRect(wx + ctx.lineWidth / 2, y0 + ctx.lineWidth / 2, cell - ctx.lineWidth, size - ctx.lineWidth);
      }
    }
    ctx.restore();
  }

  /** Pieces the storm is taking: shrink + fade with an expanding magenta ring, then forget them. */
  private drawStormGhosts(now: number): void {
    if (this.fading.length === 0) return;
    const ctx = this.ctx;
    const cell = this.layout.cell;
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      const k = clamp01((now - f.start) / STORM_MS);
      if (k >= 1) {
        this.fading.splice(i, 1);
        continue;
      }
      const x = this.cx(f.piece.pos.c);
      const y = this.cy(f.piece.pos.r);
      const s = 1 - easeOutCubic(k) * 0.9;
      this.drawPiece(f.piece, x, y - k * cell * 0.3, s, s, 1 - k * k, 0, now);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = hexAlpha(STORM_COLORS.edge, 0.9 * (1 - k));
      ctx.lineWidth = cell * 0.07 * (1 - k * 0.5);
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.25 + 0.6 * easeOutCubic(k)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(STORM_COLORS.core, 0.8 * (1 - k));
      for (let b = 0; b < 8; b++) {
        const a = (b / 8) * Math.PI * 2 + k * 2;
        const d = easeOutCubic(k) * cell * 0.55;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d - k * cell * 0.2, cell * 0.05 * (1 - k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Reveal of a wasteland square: 0 = none .. 1 = fully cracked open. */
  private wasteK(sq: number): number {
    return this.waste.has(sq) ? (this.wasteOpen.get(sq) ?? 1) : 0;
  }

  /** Wasteland squares: cached ground sprite, pulsing additive crack glow, one poison bubble each. */
  private drawWaste(now: number): void {
    if (this.waste.size === 0) return;
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    const S = Math.max(8, Math.round(cell * this.dpr));
    const t = this.reducedMotion ? 0 : now / 1000;
    for (const sq of this.waste) {
      const r = Math.floor(sq / BOARD_SIZE);
      const c = sq % BOARD_SIZE;
      const k = this.wasteK(sq);
      if (k <= 0) continue;
      const x = x0 + c * cell;
      const y = y0 + (BOARD_SIZE - 1 - r) * cell;
      const v = wasteVariant(sq);
      const m = wasteMask(this.waste, sq);
      const mx = x + cell / 2;
      const my = y + cell / 2;
      ctx.save();
      if (k < 1) {
        // Cracking open from the centre outward.
        ctx.beginPath();
        ctx.arc(mx, my, cell * 0.78 * k, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.drawImage(this.wasteSprites.ground(v, m, S), x, y, cell, cell);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.reducedMotion ? 0.45 : 0.3 + 0.32 * (0.5 + 0.5 * Math.sin(t * 2.2 + sq * 1.7));
      ctx.drawImage(this.wasteSprites.glow(v, m, S), x, y, cell, cell);
      ctx.globalAlpha = 1;
      if (!this.reducedMotion) {
        // One poison bubble per square: grows, glints, pops.
        const h = ((sq * 2246822519) >>> 0) / 4294967296;
        const ph = (t * 0.45 + h * 7) % 1;
        if (ph < 0.9) {
          const bx = x + cell * (0.25 + 0.5 * ((h * 13.7) % 1));
          const by = y + cell * (0.25 + 0.5 * ((h * 7.3) % 1));
          const br = cell * (0.03 + 0.07 * ph);
          ctx.fillStyle = hexAlpha(WASTE_COLORS.miasma, 0.55);
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = hexAlpha(WASTE_COLORS.glow, 0.7);
          ctx.lineWidth = Math.max(0.6, cell * 0.018);
          ctx.stroke();
          ctx.fillStyle = hexAlpha(WASTE_COLORS.core, 0.8);
          ctx.beginPath();
          ctx.arc(bx - br * 0.35, by - br * 0.35, br * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      if (k < 1) {
        // Reveal front + poison eruption.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = hexAlpha(WASTE_COLORS.glow, 0.9 * (1 - k));
        ctx.lineWidth = cell * 0.06;
        ctx.beginPath();
        ctx.arc(mx, my, cell * 0.78 * k, 0, Math.PI * 2);
        ctx.stroke();
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, cell * 0.6);
        g.addColorStop(0, hexAlpha(WASTE_COLORS.core, 0.9 * Math.sin(Math.PI * k)));
        g.addColorStop(0.4, hexAlpha(WASTE_COLORS.glow, 0.6 * Math.sin(Math.PI * k)));
        g.addColorStop(1, hexAlpha(WASTE_COLORS.glow, 0));
        ctx.fillStyle = g;
        ctx.fillRect(mx - cell * 0.6, my - cell * 0.6, cell * 1.2, cell * 1.2);
        ctx.restore();
      }
    }
  }

  /** Skill targeting overlay: anchors tinted, the preview area a green (red if invalid) ghost. */
  private drawSkillPreview(now: number): void {
    if (this.anchors.length === 0 && !this.preview) return;
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    const pulse = this.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin((now / 1000) * 4.2);
    const at = (sq: number): { x: number; y: number } => ({ x: x0 + (sq % BOARD_SIZE) * cell, y: y0 + (BOARD_SIZE - 1 - Math.floor(sq / BOARD_SIZE)) * cell });
    ctx.save();
    const inset = cell * 0.1;
    for (const sq of this.anchors) {
      if (this.previewSet.has(sq)) continue;
      const { x, y } = at(sq);
      ctx.fillStyle = hexAlpha(WASTE_COLORS.anchor, 0.07);
      ctx.fillRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
      ctx.strokeStyle = hexAlpha(WASTE_COLORS.anchor, 0.32 + 0.14 * pulse);
      ctx.lineWidth = Math.max(1, cell * 0.04);
      roundRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, cell * 0.12);
      ctx.stroke();
    }
    const pv = this.preview;
    if (pv) {
      const col = pv.valid ? WASTE_COLORS.ghost : WASTE_COLORS.invalid;
      const S = Math.max(8, Math.round(cell * this.dpr));
      for (const sq of this.previewSet) {
        const { x, y } = at(sq);
        // Dark cursed-earth ghost (reads on the grass), cracks / hatching on top.
        ctx.fillStyle = hexAlpha(WASTE_COLORS.ground, 0.5 + 0.1 * pulse);
        ctx.fillRect(x, y, cell, cell);
        if (pv.valid) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.6 + 0.3 * pulse;
          ctx.drawImage(this.wasteSprites.glow(wasteVariant(sq), wasteMask(this.previewSet, sq), S), x, y, cell, cell);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        } else {
          // Forbidden: red diagonal hatching.
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cell, cell);
          ctx.clip();
          ctx.strokeStyle = hexAlpha(col, 0.45);
          ctx.lineWidth = cell * 0.08;
          for (let i = -1; i <= 3; i++) {
            ctx.beginPath();
            ctx.moveTo(x + (i - 1) * cell * 0.33, y + cell);
            ctx.lineTo(x + (i + 2) * cell * 0.33, y);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
      // Outline around the whole area (sides without a preview neighbour).
      ctx.strokeStyle = hexAlpha(col, 0.75 + 0.25 * pulse);
      ctx.lineWidth = Math.max(1.5, cell * 0.07);
      ctx.lineCap = 'round';
      ctx.shadowColor = col;
      ctx.shadowBlur = cell * 0.3;
      ctx.beginPath();
      for (const sq of this.previewSet) {
        const { x, y } = at(sq);
        const m = wasteMask(this.previewSet, sq);
        const seg = (ax: number, ay: number, bx: number, by: number): void => {
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        };
        if (!(m & 1)) seg(x + cell, y, x + cell, y + cell);
        if (!(m & 2)) seg(x, y, x, y + cell);
        if (!(m & 4)) seg(x, y, x + cell, y);
        if (!(m & 8)) seg(x, y + cell, x + cell, y + cell);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Witch rune circle (rings, glyph ticks, hexagram over a black-purple disc) at (x, y). */
  private drawRune(x: number, y: number, R: number, k: number, rot: number): void {
    if (k >= 1) return;
    const ctx = this.ctx;
    const f = clamp01(k / 0.14) * (1 - clamp01((k - 0.62) / 0.38));
    if (f <= 0) return;
    const r = R * (0.72 + 0.28 * easeOutCubic(Math.min(1, k * 2.2)));
    ctx.save();
    ctx.globalAlpha = f;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexAlpha(WASTE_COLORS.curse, 0.55));
    g.addColorStop(0.75, hexAlpha(WASTE_COLORS.curse, 0.35));
    g.addColorStop(1, hexAlpha(WASTE_COLORS.curse, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = WASTE_COLORS.glow;
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.74, 0, Math.PI * 2);
    ctx.stroke();
    // Glyph ticks between the rings.
    ctx.lineWidth = Math.max(1, r * 0.05);
    for (let i = 0; i < 20; i++) {
      const a0 = rot + (i / 20) * Math.PI * 2;
      const len = 0.25 + 0.4 * ((i * 7) % 5) / 5;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.83, a0, a0 + (Math.PI * 2 * len) / 20);
      ctx.stroke();
    }
    // Hexagram, counter-rotating.
    ctx.lineWidth = Math.max(1, r * 0.03);
    for (const off of [0, Math.PI]) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = -rot * 1.6 + off + (i / 3) * Math.PI * 2 - Math.PI / 2;
        const px = x + Math.cos(a) * r * 0.72;
        const py = y + Math.sin(a) * r * 0.72;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Cast effects over the pieces: caster flash, the green bolt, the impact flash, sparks. */
  private drawSkillFx(now: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const s = this.skill;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (s && s.casterId) {
      const t = now - s.start;
      const fx0 = this.cx(s.from.c);
      const fy0 = this.cy(s.from.r);
      // Caster flare.
      const kf = t / 260;
      if (kf < 1) {
        const rr = cell * (0.5 + 0.9 * easeOutCubic(kf));
        const g = ctx.createRadialGradient(fx0, fy0, 0, fx0, fy0, rr);
        g.addColorStop(0, hexAlpha(WASTE_COLORS.core, 0.9 * (1 - kf)));
        g.addColorStop(0.45, hexAlpha(WASTE_COLORS.glow, 0.6 * (1 - kf)));
        g.addColorStop(1, hexAlpha(WASTE_COLORS.glow, 0));
        ctx.fillStyle = g;
        ctx.fillRect(fx0 - rr, fy0 - rr, rr * 2, rr * 2);
      }
      // Bolt along a sideways-bowed quadratic curve, jittered like lightning.
      const kb = (t - s.boltAt) / SKILL_BOLT_MS;
      if (kb >= 0) {
        const head = easeOutCubic(clamp01(kb));
        const tail = Math.pow(clamp01((t - s.boltAt - SKILL_BOLT_MS * 0.75) / 300), 2);
        if (tail < 1) {
          const tx = this.cx(s.centre.c);
          const ty = this.cy(s.centre.r);
          const dx = tx - fx0;
          const dy = ty - fy0;
          const len = Math.hypot(dx, dy) || 1;
          const bx = (fx0 + tx) / 2 + (dy / len) * s.bow * cell;
          const by = (fy0 + ty) / 2 - (dx / len) * s.bow * cell;
          const N = 22;
          const pts: { x: number; y: number }[] = [];
          for (let i = 0; i <= N; i++) {
            const u = tail + (head - tail) * (i / N);
            const ox = (1 - u) * (1 - u) * fx0 + 2 * (1 - u) * u * bx + u * u * tx;
            const oy = (1 - u) * (1 - u) * fy0 + 2 * (1 - u) * u * by + u * u * ty;
            const j = (Math.sin(u * 37 + t * 0.05) * 0.6 + Math.sin(u * 91 - t * 0.09) * 0.4) * cell * 0.12 * Math.sin(Math.PI * u);
            pts.push({ x: ox - (dy / len) * j, y: oy + (dx / len) * j });
          }
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (const [w, col] of [
            [0.3, hexAlpha(WASTE_COLORS.glow, 0.25)],
            [0.12, hexAlpha(WASTE_COLORS.glow, 0.85)],
            [0.04, hexAlpha(WASTE_COLORS.core, 1)],
          ] as const) {
            ctx.strokeStyle = col;
            ctx.lineWidth = cell * w;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
          const hp = pts[pts.length - 1];
          const hg = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, cell * 0.35);
          hg.addColorStop(0, hexAlpha(WASTE_COLORS.core, 0.9));
          hg.addColorStop(1, hexAlpha(WASTE_COLORS.glow, 0));
          ctx.fillStyle = hg;
          ctx.fillRect(hp.x - cell * 0.35, hp.y - cell * 0.35, cell * 0.7, cell * 0.7);
        }
      }
    }
    // Bolt impact: green flash + shock ring at the area centre.
    if (this.tSkillHit >= 0) {
      const k = (now - this.tSkillHit) / 520;
      if (k >= 1) this.tSkillHit = -1;
      else if (s) {
        const x = this.cx(s.centre.c);
        const y = this.cy(s.centre.r);
        const e = easeOutCubic(k);
        const g = ctx.createRadialGradient(x, y, 0, x, y, cell * (0.6 + 1.2 * e));
        g.addColorStop(0, hexAlpha(WASTE_COLORS.core, 0.8 * (1 - k)));
        g.addColorStop(0.5, hexAlpha(WASTE_COLORS.glow, 0.45 * (1 - k)));
        g.addColorStop(1, hexAlpha(WASTE_COLORS.glow, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.6 + 1.2 * e), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexAlpha(WASTE_COLORS.glow, 0.85 * (1 - k));
        ctx.lineWidth = cell * 0.07;
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.4 + 1.6 * e), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Poison sparks thrown up by each cracking square.
    for (let i = this.skillSparks.length - 1; i >= 0; i--) {
      const p = this.skillSparks[i];
      const k = (now - p.t0) / 420;
      if (k >= 1) {
        this.skillSparks.splice(i, 1);
        continue;
      }
      const d = cell * (0.1 + 0.55 * easeOutCubic(k)) * p.v;
      ctx.fillStyle = hexAlpha(i % 3 === 0 ? WASTE_COLORS.core : WASTE_COLORS.glow, 0.95 * (1 - k));
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(p.a) * d, p.y + Math.sin(p.a) * d - k * cell * 0.15, cell * 0.045 * (1 - k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A mover destroyed on wasteland: shudders, burns away from a green edge, toxic bubbles rise. */
  private drawWastedPiece(p: Piece, x: number, y: number, tk: number, now: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const k = clamp01(tk / WASTE_DIE_MS);
    const shake = tk < 220 ? Math.sin(tk * 0.09) * cell * 0.04 * (1 - tk / 220) : 0;
    const sc = 1 - 0.25 * easeOutCubic(k);
    if (k < 1) this.drawPiece(p, x + shake, y + k * cell * 0.05, sc, sc, 1 - k * k, 0, now, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Green burn glow over the token, strongest mid-way.
    const gk = Math.sin(Math.PI * Math.min(1, k * 1.2));
    const g = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.55);
    g.addColorStop(0, hexAlpha(WASTE_COLORS.glow, 0.55 * gk));
    g.addColorStop(0.7, hexAlpha(WASTE_COLORS.miasma, 0.35 * gk));
    g.addColorStop(1, hexAlpha(WASTE_COLORS.miasma, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - cell * 0.55, y - cell * 0.55, cell * 1.1, cell * 1.1);
    // Flame ring licking out + rising bubbles.
    ctx.strokeStyle = hexAlpha(WASTE_COLORS.glow, 0.85 * (1 - k));
    ctx.lineWidth = cell * 0.06;
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const rr = cell * (0.3 + 0.35 * easeOutCubic(k)) + Math.abs(Math.sin(a * 5 + tk * 0.02)) * cell * 0.12 * (1 - k);
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.stroke();
    for (let b = 0; b < 6; b++) {
      const ph = (tk / 600 + b / 6) % 1;
      const bx = x + Math.cos(b * 2.4) * cell * 0.28;
      const by = y + Math.sin(b * 2.4) * cell * 0.2 - ph * cell * 0.5;
      ctx.fillStyle = hexAlpha(b % 2 ? WASTE_COLORS.core : WASTE_COLORS.glow, 0.8 * (1 - ph) * (1 - k * 0.5));
      ctx.beginPath();
      ctx.arc(bx, by, cell * 0.04 * (1 + ph), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Glowing home-zone edge lines; the side to move is brighter and sweeps on turn change. */
  private drawZoneLines(now: number): void {
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    const size = cell * BOARD_SIZE;
    const sweepK = this.tTurn >= 0 ? (now - this.tTurn) / ANIM.turn : 2;
    for (const id of [0, 1] as const) {
      const rowEdge = id === 0 ? ZONE_DEPTH : BOARD_SIZE - ZONE_DEPTH; // line between rows
      const y = y0 + (BOARD_SIZE - rowEdge) * cell;
      const active = id === this.turn;
      const boost = active && sweepK >= 0 && sweepK < 1 ? Math.sin(Math.PI * sweepK) : 0;
      // Thin glowing team line + a soft halo band (as the WebGL zone line / halo), additive.
      const col = TEAM_COLORS[id].glow;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hh = cell * 0.5 * (1 + boost * 0.7);
      const hg = ctx.createLinearGradient(0, y - hh, 0, y + hh);
      const ha = Math.min(1, (active ? 0.36 : 0.16) + boost * 0.55);
      hg.addColorStop(0, hexAlpha(col, 0));
      hg.addColorStop(0.5, hexAlpha(col, ha));
      hg.addColorStop(1, hexAlpha(col, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(x0 + cell * 0.05, y - hh, size - cell * 0.1, hh * 2);
      ctx.strokeStyle = hexAlpha(col, Math.min(1, (active ? 0.9 : 0.5) + boost * 0.5));
      ctx.lineWidth = Math.max(1.2, cell * (0.055 + 0.04 * boost));
      ctx.beginPath();
      ctx.moveTo(x0 + cell * 0.05, y);
      ctx.lineTo(x0 + size - cell * 0.05, y);
      ctx.stroke();
      if (active && sweepK >= 0 && sweepK < 1) {
        const e = easeInOutCubic(sweepK);
        const hx = id === 0 ? x0 + size * e : x0 + size * (1 - e);
        const dir = id === 0 ? -1 : 1;
        const g = ctx.createLinearGradient(hx, 0, hx + dir * cell * 3, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = Math.max(2, cell * 0.1);
        ctx.beginPath();
        ctx.moveTo(hx, y);
        ctx.lineTo(hx + dir * cell * 3, y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Landing ring, sad's glint and the character's strike FX (+ the insaner soul stream). */
  private drawFx(now: number, moverXY: { x: number; y: number } | null): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    if (this.tLand >= 0) {
      const k = (now - this.tLand) / ANIM.pulse;
      if (k >= 1) this.tLand = -1;
      else if (k >= 0) {
        ctx.save();
        ctx.globalAlpha = (1 - k) * (1 - k);
        ctx.strokeStyle = this.landColor;
        ctx.lineWidth = cell * 0.07;
        ctx.beginPath();
        ctx.arc(this.cx(this.landAt.c), this.cy(this.landAt.r), cell * (0.4 + 0.45 * easeOutCubic(k)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (this.tGlint >= 0) {
      const k = (now - this.tGlint) / 320;
      if (k >= 1) this.tGlint = -1;
      else if (k >= 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k * k;
        drawGlint(ctx, this.glintAt.x, this.glintAt.y, cell * 0.65 * Math.sin(Math.PI * Math.min(1, k * 1.25)), k * 1.2, this.glintColor);
        ctx.restore();
      }
    }
    if (this.tCap < 0) return;
    const el = now - this.tCap;
    if (el >= FX_MS + 300) {
      this.tCap = -1;
      this.soulTo = null;
      return;
    }
    const x = this.cx(this.capAt.c);
    const y = this.cy(this.capAt.r);
    const fx = CHARACTER_FX[this.capKind];
    const k = clamp01(el / FX_MS);
    const e = easeOutCubic(k);
    const fade = 1 - k;
    const dir = this.capDir;
    ctx.save();
    if (this.capKind === 'marki' && k < 1) {
      // Dust clouds (normal blending, behind the glow).
      for (const b of this.capBurst) {
        const d = cell * (0.25 + 0.7 * e) * b.v;
        ctx.fillStyle = `rgba(201,185,160,${0.32 * fade})`;
        ctx.beginPath();
        ctx.arc(x + Math.cos(b.a) * d, y + Math.sin(b.a) * d * 0.8, cell * (0.12 + 0.18 * e), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    // Impact flash.
    const kf = el / ANIM.flash;
    if (kf < 1) {
      const rr = cell * (0.45 + 1.0 * easeOutCubic(kf));
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, `rgba(255,255,255,${1 - kf})`);
      g.addColorStop(0.45, hexAlpha(this.capKind === 'walk' ? fx.secondary : fx.primary, 0.7 * (1 - kf)));
      g.addColorStop(1, hexAlpha(fx.primary, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    if (k < 1) {
      switch (this.capKind) {
        case 'sad': {
          // Light beam rising up the screen + a sweeping crescent slash + a holy sigil ring.
          const bw = cell * 0.55 * (1.1 - 0.5 * k);
          const bh = cell * 2.2 * Math.min(1, k * 4);
          const g = ctx.createLinearGradient(0, y, 0, y - bh);
          g.addColorStop(0, hexAlpha(fx.secondary, 0.75 * fade));
          g.addColorStop(1, hexAlpha(fx.primary, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - bw / 2, y - bh, bw, bh);
          const sk = clamp01(el / 300);
          if (sk < 1) {
            const flip = dir.x < 0 ? -1 : 1;
            const a0 = -2.4;
            const head = a0 + 3.4 * easeOutCubic(sk);
            ctx.strokeStyle = hexAlpha(fx.primary, 0.95 * (1 - sk));
            ctx.shadowColor = fx.primary;
            ctx.shadowBlur = cell * 0.3;
            ctx.lineCap = 'round';
            for (let i = 0; i < 3; i++) {
              ctx.lineWidth = cell * (0.16 - i * 0.05);
              ctx.strokeStyle = i === 2 ? hexAlpha('#FFFFFF', 1 - sk) : hexAlpha(fx.primary, 0.9 * (1 - sk));
              ctx.beginPath();
              ctx.ellipse(x, y, cell * 0.62, cell * 0.62, 0, flip > 0 ? Math.max(a0, head - 1.8) : Math.PI - head, flip > 0 ? head : Math.PI - Math.max(a0, head - 1.8), flip < 0);
              ctx.stroke();
            }
            ctx.shadowBlur = 0;
          }
          ctx.strokeStyle = hexAlpha(fx.primary, 0.8 * fade);
          ctx.lineWidth = cell * 0.05;
          ctx.beginPath();
          ctx.arc(x, y, cell * (0.3 + 0.6 * e), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'marki': {
          // Molten ground cracks radiating out.
          ctx.strokeStyle = hexAlpha(fx.primary, Math.min(1, 1.4 * fade));
          ctx.lineWidth = Math.max(1, cell * 0.05);
          ctx.lineJoin = 'round';
          for (const b of this.capBurst) {
            const len = cell * (0.4 + 0.9 * b.v) * Math.min(1, e * 1.7);
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (let s = 1; s <= 4; s++) {
              const d = (len * s) / 4;
              const j = Math.sin(b.a * 13 + s * 2.1) * cell * 0.08;
              ctx.lineTo(x + Math.cos(b.a) * d - Math.sin(b.a) * j, y + Math.sin(b.a) * d + Math.cos(b.a) * j);
            }
            ctx.stroke();
          }
          break;
        }
        case 'walk': {
          // Shield-shaped shock ring pointing along the strike + an echo.
          const ang = Math.atan2(dir.y, dir.x) + Math.PI / 2;
          for (const [sc, al] of [
            [0.25 + 0.95 * e, 1],
            [0.15 + 0.6 * e, 0.55],
          ] as const) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(ang);
            ctx.scale(cell * sc, cell * sc);
            shieldPath(ctx);
            ctx.restore();
            ctx.strokeStyle = hexAlpha(fx.primary, al * fade);
            ctx.shadowColor = fx.secondary;
            ctx.shadowBlur = cell * 0.25;
            ctx.lineWidth = cell * 0.07;
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
          break;
        }
        case 'brutile': {
          // Curse blast: green poison flame ring over black-purple smoke + toxic cracks.
          ctx.globalCompositeOperation = 'source-over';
          for (const b of this.capBurst) {
            const d = cell * (0.2 + 0.6 * e) * b.v;
            ctx.fillStyle = hexAlpha(WASTE_COLORS.curse, 0.35 * fade);
            ctx.beginPath();
            ctx.arc(x + Math.cos(b.a) * d, y + Math.sin(b.a) * d, cell * (0.12 + 0.16 * e), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = hexAlpha(fx.primary, Math.min(1, 1.3 * fade));
          ctx.lineWidth = Math.max(1, cell * 0.045);
          ctx.lineJoin = 'round';
          for (const b of this.capBurst) {
            const len = cell * (0.35 + 0.7 * b.v) * Math.min(1, e * 1.7);
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (let st = 1; st <= 4; st++) {
              const d = (len * st) / 4;
              const j = Math.sin(b.a * 11 + st * 2.7) * cell * 0.08;
              ctx.lineTo(x + Math.cos(b.a) * d - Math.sin(b.a) * j, y + Math.sin(b.a) * d + Math.cos(b.a) * j);
            }
            ctx.stroke();
          }
          const R = cell * (0.25 + 0.6 * e);
          for (let layer = 0; layer < 2; layer++) {
            ctx.beginPath();
            for (let i = 0; i <= 36; i++) {
              const a = (i / 36) * Math.PI * 2;
              const fl = Math.abs(Math.sin(a * 6 + el * 0.022 + layer * 1.3)) * cell * 0.24 * fade;
              const rr = R + fl;
              if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
              else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            }
            ctx.closePath();
            ctx.strokeStyle = hexAlpha(layer === 0 ? fx.primary : fx.core, 0.85 * fade);
            ctx.lineWidth = cell * (0.08 - layer * 0.04);
            ctx.stroke();
          }
          break;
        }
        case 'insaner': {
          // Violet / crimson flame ring.
          const R = cell * (0.25 + 0.6 * e);
          for (let layer = 0; layer < 2; layer++) {
            ctx.beginPath();
            for (let i = 0; i <= 36; i++) {
              const a = (i / 36) * Math.PI * 2;
              const fl = Math.abs(Math.sin(a * 5 + el * 0.02 + layer * 1.7)) * cell * 0.22 * fade;
              const rr = R + fl;
              if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
              else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            }
            ctx.closePath();
            ctx.strokeStyle = hexAlpha(layer === 0 ? fx.primary : fx.secondary, 0.85 * fade);
            ctx.lineWidth = cell * (0.08 - layer * 0.03);
            ctx.stroke();
          }
          break;
        }
      }
      // Shock ring + debris.
      ctx.strokeStyle = hexAlpha(fx.primary, 0.85 * fade);
      ctx.lineWidth = cell * 0.06 * (1 - k * 0.5);
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.3 + 0.85 * e), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(fx.primary, fade);
      for (const b of this.capBurst) {
        const d = e * cell * 0.75 * b.v;
        ctx.beginPath();
        ctx.arc(x + Math.cos(b.a) * d, y + Math.sin(b.a) * d, cell * 0.06 * (1 - k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Soul stream: wisps flowing from the victim into the imp.
    if (this.soulTo) {
      let tx = moverXY?.x ?? NaN;
      let ty = moverXY?.y ?? NaN;
      if (!moverXY) {
        const m = this.pieces.find((p) => p.id === this.soulTo);
        if (m) {
          tx = this.cx(m.pos.c);
          ty = this.cy(m.pos.r);
        }
      }
      if (Number.isFinite(tx)) {
        const mx = (x + tx) / 2;
        const my = (y + ty) / 2 - cell * 0.9;
        for (let i = 0; i < 18; i++) {
          const s = (el / 1000 - i * 0.02) / 0.5;
          if (s <= 0 || s >= 1) continue;
          const w = Math.sin(s * Math.PI) * cell * 0.2 * Math.sin(i * 2.3 + s * 9);
          const px = (1 - s) * (1 - s) * x + 2 * (1 - s) * s * mx + s * s * tx + w;
          const py = (1 - s) * (1 - s) * y + 2 * (1 - s) * s * my + s * s * ty;
          const a = Math.pow(Math.sin(s * Math.PI), 0.6);
          const g = ctx.createRadialGradient(px, py, 0, px, py, cell * 0.12);
          g.addColorStop(0, `rgba(255,230,255,${a})`);
          g.addColorStop(0.4, hexAlpha('#B65CFF', 0.8 * a));
          g.addColorStop(1, hexAlpha('#B65CFF', 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, cell * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /**
   * Top-down token: contact shadow, rarity ring on the ground, then the pre-rendered illustrated
   * coin (face art, team rim, star pips). `flash` whitens it (hit).
   */
  private drawPiece(p: Piece, x: number, y: number, sx: number, sy: number, alpha: number, lift: number, now: number, flash = 0): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const u = cell * sx;
    ctx.save();
    ctx.globalAlpha = alpha;
    // Soft contact shadow (stays on the ground and spreads while the piece lifts).
    const sg = 1 + lift * 0.12;
    ctx.fillStyle = `rgba(4,6,12,${(0.55 - lift * 0.1) * alpha})`;
    ctx.beginPath();
    ctx.ellipse(x + u * 0.04, y + u * 0.07, u * 0.42 * sg, u * 0.4 * sg, 0, 0, Math.PI * 2);
    ctx.fill();
    this.drawRarityRing(p.character, x, y, cell * RING_R * Math.min(sx, 1.15), now);
    const yb = y - lift * cell * 0.12;
    const d = cell * TOKEN_SPRITE;
    ctx.drawImage(this.tokenSprite(p.character, p.level, p.owner), x - (d * sx) / 2, yb - (d * sy) / 2, d * sx, d * sy);
    if (flash > 0) {
      ctx.globalAlpha = alpha * flash;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x, yb, (d * sx) / 2, (d * sy) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Rarity ring: white / orange / purple glow, legendary = rotating rainbow. */
  private drawRarityRing(ch: CharacterId, x: number, y: number, rr: number, now: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const look = RARITY_RING[CHARACTER_RARITY[ch]];
    const lw = cell * 0.052;
    ctx.save();
    // Thin dark keyline under the band (separates it from the coin edge and the tile).
    ctx.strokeStyle = 'rgba(4,6,12,0.55)';
    ctx.lineWidth = lw + Math.max(1, cell * 0.022);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = lw;
    if (look.rainbow) {
      const rot = this.reducedMotion ? 0 : (now / 1000) * 1.4;
      ctx.shadowColor = `hsl(${Math.round((rot * 57.3) % 360)},100%,70%)`;
      ctx.shadowBlur = cell * 0.26;
      const cg = (ctx as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
      if (cg) {
        const g = cg.call(ctx, rot, x, y);
        for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,72%)`);
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        for (let i = 0; i < 12; i++) {
          ctx.strokeStyle = `hsl(${i * 30},100%,72%)`;
          ctx.beginPath();
          ctx.arc(x, y, rr, rot + (i / 12) * Math.PI * 2, rot + ((i + 1.08) / 12) * Math.PI * 2);
          ctx.stroke();
        }
      }
      // Rotating shimmer.
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(x, y, rr, -rot * 1.3, -rot * 1.3 + 0.5);
      ctx.stroke();
    } else {
      ctx.shadowColor = look.glow;
      ctx.shadowBlur = cell * (0.05 + 0.3 * look.glowAmt);
      ctx.strokeStyle = look.core;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draw a marker sprite (arena.ts painters, cached per kind / colour / cell size) centred at
   * (x, y) for a cell of `size` px. Blending is the caller's (dots / selection: 'lighter').
   */
  private drawMarker(kind: keyof typeof MARKER_QUAD, color: string, x: number, y: number, size: number): void {
    const q = MARKER_QUAD[kind];
    const cellPx = Math.max(4, Math.round(this.layout.cell * this.dpr));
    const key = `m:${kind}:${color}:${cellPx}`;
    let c = this.sprites.get(key);
    if (!c) {
      const S = Math.max(8, Math.ceil(cellPx * q));
      c = document.createElement('canvas');
      c.width = S;
      c.height = S;
      const g = c.getContext('2d');
      if (g) {
        const rgb = hexToRgb(color);
        if (kind === 'dot') paintGlowDot(g, S / 2, S / 2, S / 2, rgb);
        else if (kind === 'select') paintSelectGlow(g, S / 2, S / 2, S / q, rgb);
        else paintCaptureRing(g, S / 2, S / 2, S / q, rgb);
      }
      this.sprites.set(key, c);
    }
    const d = size * q;
    this.ctx.drawImage(c, x - d / 2, y - d / 2, d, d);
  }

  /** Illustrated coin for a look, pre-rendered at the current cell size (cached). */
  private tokenSprite(ch: CharacterId, level: Level, owner: PlayerId): HTMLCanvasElement {
    const S = Math.max(8, Math.round(this.layout.cell * TOKEN_SPRITE * this.dpr));
    const img = faceImage(ch, level);
    const key = `${ch}:${level}:${owner}:${S}:${img ? 1 : 0}`;
    let c = this.sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    if (g) paintToken(g, S, img, level, owner);
    this.sprites.set(key, c);
    return c;
  }

  // ---------------------------------------------------------------- input

  private readonly onPointerDown = (ev: PointerEvent): void => {
    if (!this.interactive || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    this.down = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
  };

  private readonly onPointerUp = (ev: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!d || d.id !== ev.pointerId || !this.interactive || !this.cellCb) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > TAP_SLOP_PX) return;
    const rect = this.canvas.getBoundingClientRect();
    const { x0, y0, cell, pad } = this.layout;
    const x = ev.clientX - rect.left - x0;
    const y = ev.clientY - rect.top - y0;
    const size = cell * BOARD_SIZE;
    const tol = pad * 0.8;
    if (x < -tol || y < -tol || x > size + tol || y > size + tol) return;
    const c = Math.min(BOARD_SIZE - 1, Math.max(0, Math.floor(x / cell)));
    const r = Math.min(BOARD_SIZE - 1, Math.max(0, BOARD_SIZE - 1 - Math.floor(y / cell)));
    this.cellCb({ r, c });
  };

  private readonly onPointerCancel = (): void => {
    this.down = null;
  };

  private readonly onContextMenu = (ev: Event): void => {
    ev.preventDefault();
  };
}

/**
 * Paint a chunky illustrated coin into an S x S sprite covering TOKEN_SPRITE of a cell (mirrors the
 * WebGL token shader in tokens.ts): navy keyline, team-deep milled edge below the top face, team rim
 * lit from the top-left with a specular arc, inset bevel ring, face art, gold star pips.
 */
function paintToken(g: CanvasRenderingContext2D, S: number, img: HTMLImageElement | null, level: Level, owner: PlayerId): void {
  const team = TEAM_COLORS[owner];
  const u = S / TOKEN_SPRITE; // px per cell
  const c = S / 2;
  const R = 0.385 * u;
  const ty = c - 0.024 * u;
  const ey = c + 0.046 * u;
  const key = 0.022 * u;
  const dark = hexToRgb(team.dark);
  const capsule = (rad: number): void => {
    g.beginPath();
    g.arc(c, ty, rad, Math.PI, 0);
    g.lineTo(c + rad, ey);
    g.arc(c, ey, rad, 0, Math.PI);
    g.closePath();
  };
  // Keyline + coin edge (thickness), darker toward the bottom.
  g.fillStyle = '#090D17';
  capsule(R + key);
  g.fill();
  const eg = g.createLinearGradient(0, ty, 0, ey + R);
  eg.addColorStop(0, rgbToCss(dark));
  eg.addColorStop(1, rgbToCss(mixRgb(dark, [0, 0, 0], 0.3)));
  g.fillStyle = eg;
  capsule(R);
  g.fill();
  // Team rim, lit from the top-left.
  const rim = g.createLinearGradient(c - R * 0.6, ty - R * 0.8, c + R * 0.6, ty + R * 0.8);
  rim.addColorStop(0, team.light);
  rim.addColorStop(0.45, team.main);
  rim.addColorStop(1, team.dark);
  g.fillStyle = rim;
  g.beginPath();
  g.arc(c, ty, R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = R * 0.06;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(c, ty, R * 0.915, Math.PI * 1.08, Math.PI * 1.45);
  g.stroke();
  // Inset bevel ring: shadowed top-left, light lower-right.
  const bv = g.createLinearGradient(c - R * 0.6, ty - R * 0.8, c + R * 0.6, ty + R * 0.8);
  bv.addColorStop(0, '#0E1530');
  bv.addColorStop(0.55, rgbToCss(mixRgb(dark, [0, 0, 0], 0.4)));
  bv.addColorStop(1, rgbToCss(mixRgb(hexToRgb(team.light), [1, 1, 1], 0.3)));
  g.fillStyle = bv;
  g.beginPath();
  g.arc(c, ty, R * 0.815, 0, Math.PI * 2);
  g.fill();
  // Face (clipped circle) with the rim's soft inset shadow on its top-left.
  const fr = R * 0.775;
  g.save();
  g.beginPath();
  g.arc(c, ty, fr, 0, Math.PI * 2);
  g.clip();
  if (img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const sw = Math.min(w, h) * 0.8;
    g.drawImage(img, (w - sw) / 2, (h - sw) / 2 + h * 0.01, sw, sw, c - fr, ty - fr, fr * 2, fr * 2);
  } else {
    const pg = g.createRadialGradient(c, ty - R * 0.15, 0, c, ty, R * 0.8);
    pg.addColorStop(0, team.dark);
    pg.addColorStop(1, '#101833');
    g.fillStyle = pg;
    g.fillRect(0, 0, S, S);
  }
  const vg = g.createRadialGradient(c + fr * 0.12, ty + fr * 0.16, fr * 0.6, c, ty, fr * 1.05);
  vg.addColorStop(0, 'rgba(10,14,30,0)');
  vg.addColorStop(1, 'rgba(10,14,30,0.5)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);
  g.restore();
  // Level stars on the lower rim.
  for (let i = 0; i < level; i++) {
    const a = Math.PI / 2 - (i - (level - 1) / 2) * 0.42;
    const sx = c + Math.cos(a) * R * 0.895;
    const sy = ty + Math.sin(a) * R * 0.895;
    starPath(g, sx, sy, R * 0.15, R * 0.07);
    g.lineJoin = 'round';
    g.lineWidth = R * 0.08;
    g.strokeStyle = '#090D17';
    g.stroke();
    const sg = g.createLinearGradient(sx, sy - R * 0.15, sx, sy + R * 0.15);
    sg.addColorStop(0, '#FFF6D2');
    sg.addColorStop(0.55, BOARD_COLORS.pip);
    sg.addColorStop(1, '#E08A10');
    g.fillStyle = sg;
    g.fill();
  }
}

function starPath(g: CanvasRenderingContext2D, x: number, y: number, ro: number, ri: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? ro : ri;
    if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}

/** Heater-shield outline in unit space (point toward -y before rotation). */
function shieldPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(-0.55, 0.5);
  g.lineTo(0.55, 0.5);
  g.lineTo(0.55, 0.05);
  g.quadraticCurveTo(0.5, -0.45, 0, -0.7);
  g.quadraticCurveTo(-0.5, -0.45, -0.55, 0.05);
  g.closePath();
}

/** 4-point star glint. */
function drawGlint(g: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number, color: string): void {
  if (size <= 0) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, size);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.3, hexAlpha(color, 0.6));
  gr.addColorStop(1, hexAlpha(color, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, size, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  for (const off of [0, Math.PI / 2]) {
    const a = rot + off;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const w = size * 0.07;
    g.beginPath();
    g.moveTo(x + ca * size, y + sa * size);
    g.lineTo(x - sa * w, y + ca * w);
    g.lineTo(x - ca * size, y - sa * size);
    g.lineTo(x + sa * w, y - ca * w);
    g.closePath();
    g.fill();
  }
}

/** 0..1..0 bump over [a, b]. */
function bump(a: number, b: number, x: number): number {
  return x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a));
}

function clonePieces(pieces: Piece[]): Piece[] {
  return pieces.map((p) => ({ ...p, pos: { ...p.pos } }));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, alpha))})`;
}
