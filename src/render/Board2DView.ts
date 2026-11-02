/**
 * Lightweight Canvas2D fallback board (flat, top-down) used when WebGL is unavailable.
 * Same palette, highlights, pieces, animations and API as the WebGL BoardView.
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
 */
import { BOARD_SIZE, ZONE_DEPTH } from '../engine/types';
import type { CharacterId, Level, Move, Piece, PlayerId, Pos } from '../engine/types';
import type { BoardHighlights, IBoardView } from './types';
import { ANIM, BOARD_COLORS, CHARACTER_FX, CHARACTER_RARITY, RARITY_RING, TEAM_COLORS } from './palette';
import { STORM_COLORS } from './storm';
import {
  clamp01,
  containerSize,
  easeInOutCubic,
  easeOutCubic,
  faceUrl,
  indexHighlights,
  paintBackdrop,
  posKey,
  prefersReducedMotion,
  pulse01,
  rgbToCss,
  shakeOffset,
  slideDuration,
  tileRgb,
} from './common';
import type { HighlightIndex } from './common';

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
const TOKEN_R = 0.39;
const RING_R = 0.455;

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
  private backdrop: HTMLCanvasElement | null = null;
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
    const duration = capture ? Math.max(stepStart + STEP_MS, deathStart + DEATH_MS) + 20 : moveDur + (jump ? ANIM.land : 40);
    // Skill flavour on move start.
    this.trail.length = 0;
    const fx = CHARACTER_FX[ch];
    if (ch === 'sad') {
      this.tGlint = now;
      this.glintAt = { x: this.cx(mover.pos.c), y: this.cy(mover.pos.r) - this.layout.cell * 0.25 };
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
    const margin = Math.max(4, Math.min(w, h) * 0.012);
    const size = Math.max(10, Math.min(w, h) - margin * 2);
    const pad = size * 0.022;
    const cell = (size - pad * 2) / BOARD_SIZE;
    this.layout = { x0: (w - size) / 2 + pad, y0: (h - size) / 2 + pad, cell, pad };
    this.sprites.clear();
    this.buildBackdrop();
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
    this.backdrop = null;
    this.sprites.clear();
    this.canvas.remove();
    this.pieces = [];
    this.cellCb = null;
  }

  // ---------------------------------------------------------------- render loop

  private buildBackdrop(): void {
    const cvs = this.backdrop ?? document.createElement('canvas');
    cvs.width = Math.max(1, Math.round(this.cssW * this.dpr * 0.5));
    cvs.height = Math.max(1, Math.round(this.cssH * this.dpr * 0.5));
    const ctx = cvs.getContext('2d');
    if (ctx) paintBackdrop(ctx, cvs.width, cvs.height);
    this.backdrop = cvs;
  }

  private requestRender(): void {
    if (this.disposed || this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private get pulsing(): boolean {
    const h = this.highlights;
    return !!h.selected || (h.moves?.length ?? 0) > 0 || (h.captures?.length ?? 0) > 0;
  }

  private fxActive(now: number): boolean {
    return (
      (this.tLand >= 0 && now - this.tLand < ANIM.pulse) ||
      (this.tCap >= 0 && now - this.tCap < FX_MS + 300) ||
      (this.tShake >= 0 && now - this.tShake < this.shakeMs) ||
      (this.tGlint >= 0 && now - this.tGlint < 320) ||
      (this.tTurn >= 0 && now - this.tTurn < ANIM.turn) ||
      this.trail.length > 0 ||
      this.fading.length > 0
    );
  }

  private tShake = -1;

  private readonly frame = (now: number): void => {
    this.rafId = 0;
    if (this.disposed) return;
    if (this.anim) this.tickAnim(now);
    const busy = !!this.anim || this.fxActive(now);
    const ringLoop = this.hasLegendary && !this.reducedMotion && !document.hidden;
    const loop = this.pulsing || ringLoop || this.storm > 0 || (this.stormActive && this.stormNext !== null && this.stormNext <= 2);
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
      this.landColor = a.jump ? CHARACTER_FX.walk.primary : TEAM_COLORS[m ? m.owner : 0].glow;
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
    this.shakeAmp = a.character === 'marki' ? (this.reducedMotion ? 0.5 : 2.6) : a.character === 'walk' ? 1.5 : 1;
    this.shakeMs = a.character === 'marki' ? 260 : ANIM.shake;
    this.soulTo = a.character === 'insaner' ? a.moverId : null;
    if (a.character === 'insaner') this.lastCapture = { id: a.moverId, t: now };
  }

  private finishAnimation(natural: boolean): void {
    const a = this.anim;
    if (!natural) {
      this.tLand = -1;
      this.tCap = -1;
      this.tShake = -1;
      this.tTurn = -1;
      this.tGlint = -1;
      this.trail.length = 0;
    }
    if (!a) return;
    this.anim = null;
    this.collectStormVictims(a.piecesAfter, a.captured?.id ?? null);
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
    const { x0, y0, cell, pad } = this.layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    if (this.backdrop) ctx.drawImage(this.backdrop, 0, 0, this.cssW, this.cssH);
    else {
      ctx.fillStyle = BOARD_COLORS.background;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    // Camera micro-shake.
    let sx = 0;
    let sy = 0;
    if (this.tShake >= 0) {
      const k = (now - this.tShake) / this.shakeMs;
      sx = shakeOffset(k, 0) * this.shakeAmp;
      sy = shakeOffset(k, 1) * this.shakeAmp;
    }
    ctx.translate(sx, sy);
    const size = cell * BOARD_SIZE;

    // Slab: dark stone with a team-colored inlaid frame.
    ctx.save();
    ctx.shadowColor = 'rgba(60,90,255,0.35)';
    ctx.shadowBlur = pad * 5;
    ctx.fillStyle = BOARD_COLORS.slab;
    roundRect(ctx, x0 - pad, y0 - pad, size + pad * 2, size + pad * 2, pad * 1.6);
    ctx.fill();
    ctx.restore();
    const fg = ctx.createLinearGradient(0, y0 - pad, 0, y0 + size + pad);
    fg.addColorStop(0, TEAM_COLORS[1].glow);
    fg.addColorStop(0.5, BOARD_COLORS.slabEdge);
    fg.addColorStop(1, TEAM_COLORS[0].glow);
    ctx.strokeStyle = fg;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = Math.max(1, pad * 0.2);
    roundRect(ctx, x0 - pad * 0.55, y0 - pad * 0.55, size + pad * 1.1, size + pad * 1.1, pad);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Tiles with a bevel catch-light.
    const gap = Math.max(1.2, cell * 0.075);
    const rad = Math.max(1, cell * 0.09);
    const bw = Math.max(1, cell * 0.03);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const tx = x0 + c * cell + gap / 2;
        const ty = y0 + (BOARD_SIZE - 1 - r) * cell + gap / 2;
        const tw = cell - gap;
        ctx.fillStyle = rgbToCss(tileRgb(r, c, this.hi));
        roundRect(ctx, tx, ty, tw, tw, rad);
        ctx.fill();
        if (this.storm > 0 && this.stormColumn(c)) {
          ctx.fillStyle = hexAlpha(STORM_COLORS.tile, 0.62);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(tx + rad * 0.6, ty, tw - rad * 1.2, bw);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(tx + rad * 0.6, ty + tw - bw, tw - rad * 1.2, bw);
      }
    }

    this.drawZoneLines(now);
    this.drawStorm(now);

    // Overlays: own reach = white/cyan, an enemy's reach preview = red.
    const h = this.highlights;
    const enemy = this.hi.enemy;
    const selCol = enemy ? BOARD_COLORS.enemySelected : BOARD_COLORS.selected;
    const dotCol = enemy ? BOARD_COLORS.enemyMoveDot : BOARD_COLORS.moveDot;
    const sp = pulse01(now, 950);
    if (h.selected) {
      const x = this.cx(h.selected.c);
      const y = this.cy(h.selected.r);
      ctx.save();
      ctx.shadowColor = selCol;
      ctx.shadowBlur = cell * (0.25 + 0.2 * sp);
      ctx.strokeStyle = selCol;
      ctx.globalAlpha = 0.7 + 0.3 * sp;
      ctx.lineWidth = cell * 0.06;
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.47 + 0.03 * sp), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const p of h.moves ?? []) {
      const x = this.cx(p.c);
      const y = this.cy(p.r);
      const rr = cell * (0.4 + 0.05 * sp);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, hexAlpha(dotCol, 0.95));
      g.addColorStop(0.4, hexAlpha(dotCol, 0.85));
      g.addColorStop(0.55, hexAlpha(dotCol, 0.25));
      g.addColorStop(1, hexAlpha(dotCol, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }

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
        if (t < a.moveDur && (a.jump || a.chain || a.charge)) this.pushTrail(moverXY.x, moverXY.y, now);
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
      this.drawPiece(p, this.cx(p.pos.c), this.cy(p.pos.r), sel ? 1.05 : 1, sel ? 1.05 : 1, 1, bob, now);
    }
    // Capture targets sit on top of the threatened tokens.
    const cp = pulse01(now, 700);
    for (const p of h.captures ?? []) {
      ctx.save();
      ctx.shadowColor = BOARD_COLORS.capture;
      ctx.shadowBlur = cell * (0.2 + 0.2 * cp);
      ctx.strokeStyle = hexAlpha(BOARD_COLORS.capture, 0.95);
      ctx.lineWidth = cell * 0.075;
      ctx.beginPath();
      ctx.arc(this.cx(p.c), this.cy(p.r), cell * (0.47 + 0.03 * cp), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    this.drawTrail(now);
    if (moverDraw) moverDraw();
    this.drawStormGhosts(now);

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
        g.addColorStop(0, hexAlpha(STORM_COLORS.field, 0.3));
        g.addColorStop(1, hexAlpha(STORM_COLORS.edge, 0.42));
        ctx.fillStyle = g;
        ctx.fillRect(bx, y0, bw, size);
        // Drifting veins.
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = hexAlpha(STORM_COLORS.edge, 0.55);
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
        ctx.strokeStyle = hexAlpha(STORM_COLORS.core, 0.9);
        ctx.lineWidth = Math.max(2, cell * 0.08);
        ctx.beginPath();
        ctx.moveTo(xIn, y0);
        ctx.lineTo(xIn, y0 + size);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = hexAlpha(STORM_COLORS.edge, 0.8);
        ctx.lineWidth = Math.max(1, cell * 0.035);
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
      const col = TEAM_COLORS[id].glow;
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = cell * (0.3 + 0.5 * boost);
      ctx.strokeStyle = hexAlpha(col, Math.min(1, (active ? 0.95 : 0.45) + boost * 0.4));
      ctx.lineWidth = Math.max(1.5, cell * (0.05 + 0.04 * boost));
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + size, y);
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
    // Contact shadow (stays on the ground while the piece lifts).
    ctx.fillStyle = `rgba(0,0,0,${0.45 * alpha})`;
    ctx.beginPath();
    ctx.ellipse(x + u * 0.04, y + u * (0.07 + lift * 0.1), u * 0.43 * (1 - lift * 0.08), u * 0.4 * (1 - lift * 0.08), 0, 0, Math.PI * 2);
    ctx.fill();
    this.drawRarityRing(p.character, x, y, cell * RING_R * Math.min(sx, 1.15), now);
    const yb = y - lift * cell * 0.1;
    const d = cell * TOKEN_R * 2;
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
    const lw = cell * 0.065;
    ctx.save();
    // Dark keyline so a white ring still reads on light tiles.
    ctx.strokeStyle = 'rgba(4,6,14,0.55)';
    ctx.lineWidth = Math.max(1, cell * 0.022);
    ctx.beginPath();
    ctx.arc(x, y, rr - lw * 0.75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = lw;
    if (look.rainbow) {
      const rot = this.reducedMotion ? 0 : (now / 1000) * 1.4;
      ctx.shadowColor = `hsl(${Math.round((rot * 57.3) % 360)},100%,70%)`;
      ctx.shadowBlur = cell * 0.3;
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
      ctx.shadowBlur = cell * (0.06 + 0.28 * look.glowAmt);
      ctx.strokeStyle = look.core;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Illustrated coin for a look, pre-rendered at the current cell size (cached). */
  private tokenSprite(ch: CharacterId, level: Level, owner: PlayerId): HTMLCanvasElement {
    const S = Math.max(8, Math.round(this.layout.cell * TOKEN_R * 2 * this.dpr));
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

/** Paint an illustrated coin of size S: team rim, dark bevel, face art (or placeholder), stars. */
function paintToken(g: CanvasRenderingContext2D, S: number, img: HTMLImageElement | null, level: Level, owner: PlayerId): void {
  const team = TEAM_COLORS[owner];
  const c = S / 2;
  const R = S / 2;
  // Team rim, lit from the top-left.
  const rim = g.createLinearGradient(0, 0, S, S);
  rim.addColorStop(0, team.light);
  rim.addColorStop(0.45, team.main);
  rim.addColorStop(1, team.dark);
  g.fillStyle = rim;
  g.beginPath();
  g.arc(c, c, R * 0.985, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = R * 0.05;
  g.beginPath();
  g.arc(c, c, R * 0.9, Math.PI * 1.05, Math.PI * 1.55);
  g.stroke();
  g.fillStyle = '#05070F';
  g.beginPath();
  g.arc(c, c, R * 0.815, 0, Math.PI * 2);
  g.fill();
  // Face (clipped circle).
  g.save();
  g.beginPath();
  g.arc(c, c, R * 0.775, 0, Math.PI * 2);
  g.clip();
  if (img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const sw = Math.min(w, h) * 0.86;
    g.drawImage(img, (w - sw) / 2, (h - sw) / 2 - h * 0.02, sw, sw, c - R * 0.775, c - R * 0.775, R * 1.55, R * 1.55);
  } else {
    const pg = g.createRadialGradient(c, c * 0.8, 0, c, c, R * 0.8);
    pg.addColorStop(0, team.dark);
    pg.addColorStop(1, '#070A15');
    g.fillStyle = pg;
    g.fillRect(0, 0, S, S);
  }
  const vg = g.createRadialGradient(c, c, R * 0.45, c, c, R * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);
  g.restore();
  // Level stars on the lower rim.
  for (let i = 0; i < level; i++) {
    const a = Math.PI / 2 - (i - (level - 1) / 2) * 0.43;
    const sx = c + Math.cos(a) * R * 0.8;
    const sy = c + Math.sin(a) * R * 0.8;
    starPath(g, sx, sy, R * 0.15, R * 0.068);
    g.fillStyle = '#1A1200';
    g.lineWidth = R * 0.06;
    g.strokeStyle = '#1A1200';
    g.stroke();
    const sg = g.createLinearGradient(sx, sy - R * 0.15, sx, sy + R * 0.15);
    sg.addColorStop(0, '#FFF6D2');
    sg.addColorStop(0.55, BOARD_COLORS.pip);
    sg.addColorStop(1, '#E09A1C');
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
