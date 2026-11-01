/**
 * Lightweight Canvas2D fallback board (flat, top-down) used when WebGL is unavailable.
 * Same palette, highlights, pieces, animations and API as the WebGL BoardView.
 * Player 0 (row 0) is at the bottom of the screen; col 0 at the left.
 */
import { BOARD_SIZE, ZONE_DEPTH } from '../engine/types';
import type { CharacterId, Move, Piece, PlayerId, Pos } from '../engine/types';
import type { BoardHighlights, IBoardView } from './types';
import { ANIM, BOARD_COLORS, CHARACTER_RARITY, RARITY_COLORS, RARITY_GLOW, TEAM_COLORS } from './palette';
import {
  clamp01,
  containerSize,
  easeInOutCubic,
  easeOutCubic,
  indexHighlights,
  paintBackdrop,
  posKey,
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

interface Layout {
  /** Board origin (top-left of the slab interior) in CSS px. */
  x0: number;
  y0: number;
  cell: number;
  pad: number;
}

interface Anim2D {
  start: number;
  duration: number;
  moveDur: number;
  moverId: string;
  from: Pos;
  to: Pos;
  jump: boolean;
  captured: Piece | null;
  captureStart: number;
  landed: boolean;
  capFired: boolean;
  burst: { a: number; v: number }[];
  piecesAfter: Piece[];
  resolve: () => void;
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
  private interactive = true;
  private anim: Anim2D | null = null;
  private rafId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private down: { id: number; x: number; y: number } | null = null;
  private backdrop: HTMLCanvasElement | null = null;
  private turn: PlayerId = 0;
  private tLand = -1;
  private landAt: Pos = { r: 0, c: 0 };
  private landOwner: PlayerId = 0;
  private tCap = -1;
  private capAt: Pos = { r: 0, c: 0 };
  private capOwner: PlayerId = 1;
  private capBurst: { a: number; v: number }[] = [];
  private tTurn = -1;
  private lastFrame = 0;

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
    this.pieces = clonePieces(pieces);
    this.requestRender();
  }

  animateMove(move: Move, piecesAfter: Piece[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishAnimation(false);
    const mover = this.pieces.find((p) => p.id === move.pieceId);
    if (!mover) {
      this.pieces = clonePieces(piecesAfter);
      this.requestRender();
      return Promise.resolve();
    }
    const captured = move.captureId ? (this.pieces.find((p) => p.id === move.captureId) ?? null) : null;
    const jump = mover.character === 'walk';
    const moveDur = jump ? ANIM.jump : slideDuration(move);
    const captureStart = captured ? moveDur * (jump ? 0.92 : 0.82) : moveDur;
    const duration = Math.max(moveDur + (jump ? ANIM.land : 40), captured ? captureStart + ANIM.capture + 40 : 0);
    const burst = Array.from({ length: 10 }, (_, i) => ({
      a: (i / 10) * Math.PI * 2 + Math.random() * 0.4,
      v: 0.8 + Math.random() * 0.5,
    }));
    return new Promise<void>((resolve) => {
      this.anim = {
        start: performance.now(),
        duration,
        moveDur,
        moverId: move.pieceId,
        from: { ...move.from },
        to: { ...move.to },
        jump,
        captured,
        captureStart,
        landed: false,
        capFired: false,
        burst,
        piecesAfter: clonePieces(piecesAfter),
        resolve,
      };
      this.requestRender();
    });
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
    this.buildBackdrop();
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.finishAnimation(false);
    this.disposed = true;
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
      (this.tCap >= 0 && now - this.tCap < ANIM.capture + 90) ||
      (this.tTurn >= 0 && now - this.tTurn < ANIM.turn)
    );
  }

  private readonly frame = (now: number): void => {
    this.rafId = 0;
    if (this.disposed) return;
    if (this.anim) this.tickAnim(now);
    const busy = !!this.anim || this.fxActive(now);
    if (!busy && this.pulsing && now - this.lastFrame < IDLE_FRAME_MS) {
      this.requestRender();
      return;
    }
    this.lastFrame = now;
    this.draw(now);
    if (busy || this.pulsing) this.requestRender();
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
      this.landAt = a.to;
      const m = this.pieces.find((p) => p.id === a.moverId);
      this.landOwner = m ? m.owner : 0;
    }
    if (a.captured && !a.capFired && t >= a.captureStart) {
      a.capFired = true;
      this.tCap = now;
      this.capAt = { ...a.captured.pos };
      this.capOwner = a.captured.owner;
      this.capBurst = a.burst;
    }
  }

  private finishAnimation(natural: boolean): void {
    const a = this.anim;
    if (!natural) {
      this.tLand = -1;
      this.tCap = -1;
      this.tTurn = -1;
    }
    if (!a) return;
    this.anim = null;
    this.pieces = a.piecesAfter;
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
    if (this.tCap >= 0) {
      const k = (now - this.tCap) / ANIM.shake;
      sx = shakeOffset(k, 0);
      sy = shakeOffset(k, 1);
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
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(tx + rad * 0.6, ty, tw - rad * 1.2, bw);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(tx + rad * 0.6, ty + tw - bw, tw - rad * 1.2, bw);
      }
    }

    this.drawZoneLines(now);

    // Overlays.
    const h = this.highlights;
    const sp = pulse01(now, 950);
    if (h.selected) {
      const x = this.cx(h.selected.c);
      const y = this.cy(h.selected.r);
      ctx.save();
      ctx.shadowColor = BOARD_COLORS.selected;
      ctx.shadowBlur = cell * (0.25 + 0.2 * sp);
      ctx.strokeStyle = BOARD_COLORS.selected;
      ctx.globalAlpha = 0.7 + 0.3 * sp;
      ctx.lineWidth = cell * 0.06;
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.44 + 0.03 * sp), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const p of h.moves ?? []) {
      const x = this.cx(p.c);
      const y = this.cy(p.r);
      const rr = cell * (0.4 + 0.05 * sp);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, hexAlpha(BOARD_COLORS.moveDot, 0.95));
      g.addColorStop(0.4, hexAlpha(BOARD_COLORS.moveDot, 0.85));
      g.addColorStop(0.55, hexAlpha(BOARD_COLORS.moveDot, 0.25));
      g.addColorStop(1, hexAlpha(BOARD_COLORS.moveDot, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    const cp = pulse01(now, 700);
    for (const p of h.captures ?? []) {
      ctx.save();
      ctx.shadowColor = BOARD_COLORS.capture;
      ctx.shadowBlur = cell * (0.2 + 0.2 * cp);
      ctx.strokeStyle = hexAlpha(BOARD_COLORS.capture, 0.9);
      ctx.lineWidth = cell * 0.07;
      ctx.beginPath();
      ctx.arc(this.cx(p.c), this.cy(p.r), cell * (0.455 + 0.03 * cp), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Pieces (back rows first so overlaps read naturally).
    const a = this.anim;
    const t = a ? now - a.start : 0;
    const list = [...this.pieces].sort((p, q) => q.pos.r - p.pos.r);
    let moverDraw: (() => void) | null = null;
    for (const p of list) {
      if (a && p.id === a.moverId) {
        const k = clamp01(t / a.moveDur);
        const e = easeInOutCubic(k);
        const x = this.cx(a.from.c + (a.to.c - a.from.c) * e);
        const y = this.cy(a.from.r + (a.to.r - a.from.r) * e);
        let lift = a.jump ? Math.sin(Math.PI * k) : 0.2 * Math.sin(Math.PI * k);
        let sxz = 1 + lift * 0.18;
        let syy = 1;
        if (a.jump && t > a.moveDur) {
          const sq = Math.sin(Math.PI * clamp01((t - a.moveDur) / ANIM.land));
          lift = 0;
          sxz = 1 + 0.1 * sq;
          syy = 1 - 0.14 * sq;
        }
        moverDraw = () => this.drawPiece(p, x, y, sxz, syy, 1, lift, now);
        continue;
      }
      if (a && a.captured && p.id === a.captured.id) {
        if (t < a.captureStart) {
          this.drawPiece(p, this.cx(p.pos.c), this.cy(p.pos.r), 1, 1, 1, 0, now);
        } else {
          const k = clamp01((t - a.captureStart) / ANIM.capture);
          const s = 1 - easeOutCubic(k);
          if (s > 0.01) this.drawPiece(p, this.cx(p.pos.c), this.cy(p.pos.r), s, s, 1 - k, 0, now);
        }
        continue;
      }
      const sel = posKey(p.pos) === this.hi.selected;
      const bob = sel ? 0.5 + 0.1 * Math.sin(now / 240) : 0;
      this.drawPiece(p, this.cx(p.pos.c), this.cy(p.pos.r), sel ? 1.05 : 1, sel ? 1.05 : 1, 1, bob, now);
    }
    if (moverDraw) moverDraw();

    this.drawFx(now);
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

  /** Landing pulse ring + capture flash / shockwave / particle burst. */
  private drawFx(now: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    if (this.tLand >= 0) {
      const k = (now - this.tLand) / ANIM.pulse;
      if (k >= 1) this.tLand = -1;
      else if (k >= 0) {
        ctx.save();
        ctx.globalAlpha = (1 - k) * (1 - k);
        ctx.strokeStyle = TEAM_COLORS[this.landOwner].glow;
        ctx.lineWidth = cell * 0.07;
        ctx.beginPath();
        ctx.arc(this.cx(this.landAt.c), this.cy(this.landAt.r), cell * (0.4 + 0.45 * easeOutCubic(k)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (this.tCap >= 0) {
      const el = now - this.tCap;
      const x = this.cx(this.capAt.c);
      const y = this.cy(this.capAt.r);
      const col = TEAM_COLORS[this.capOwner].glow;
      if (el / (ANIM.capture + 90) >= 1) {
        this.tCap = -1;
        return;
      }
      const kf = el / ANIM.flash;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (kf >= 0 && kf < 1) {
        const rr = cell * (0.4 + 0.9 * easeOutCubic(kf));
        const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, `rgba(255,255,255,${1 - kf})`);
        g.addColorStop(0.5, hexAlpha(col, 0.6 * (1 - kf)));
        g.addColorStop(1, hexAlpha(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      const ks = clamp01(el / (ANIM.capture + 90));
      ctx.strokeStyle = hexAlpha(col, 0.9 * (1 - ks));
      ctx.lineWidth = cell * 0.07 * (1 - ks * 0.5);
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.3 + 0.8 * easeOutCubic(ks)), 0, Math.PI * 2);
      ctx.stroke();
      const e = easeOutCubic(ks);
      ctx.fillStyle = hexAlpha(col, 1 - ks);
      for (const b of this.capBurst) {
        const d = e * cell * 0.7 * b.v;
        ctx.beginPath();
        ctx.arc(x + Math.cos(b.a) * d, y + Math.sin(b.a) * d, cell * 0.065 * (1 - ks * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Top-down game token: contact shadow, rarity glow ring, dark puck, rimmed glyph, gold pips. */
  private drawPiece(p: Piece, x: number, y: number, sx: number, sy: number, alpha: number, lift: number, _now: number): void {
    const ctx = this.ctx;
    const base = this.layout.cell;
    const u = base * sx;
    const team = TEAM_COLORS[p.owner];
    const rarity = CHARACTER_RARITY[p.character];
    ctx.save();
    ctx.globalAlpha = alpha;

    // Contact shadow (stays on the ground while the piece lifts).
    ctx.fillStyle = `rgba(0,0,0,${0.45 * alpha})`;
    ctx.beginPath();
    ctx.ellipse(x + u * 0.04, y + u * (0.07 + lift * 0.1), u * 0.42 * (1 - lift * 0.08), u * 0.38 * (1 - lift * 0.08), 0, 0, Math.PI * 2);
    ctx.fill();

    const yb = y - lift * base * 0.1;
    const rx = u * 0.42;
    const ry = base * sy * 0.42;
    // Dark puck.
    ctx.fillStyle = BOARD_COLORS.pieceBase;
    ctx.beginPath();
    ctx.ellipse(x, yb, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Rarity ring (glows).
    ctx.save();
    ctx.shadowColor = RARITY_COLORS[rarity];
    ctx.shadowBlur = base * (0.1 + 0.2 * RARITY_GLOW[rarity]);
    ctx.strokeStyle = RARITY_COLORS[rarity];
    ctx.lineWidth = u * 0.07;
    ctx.beginPath();
    ctx.ellipse(x, yb, rx * 0.97, ry * 0.97, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    this.drawGlyph(p.character, p.owner, p.level, x, yb - 0.1 * u, u * 1.12);

    // Level pips (gold) at the bottom of the puck.
    ctx.fillStyle = BOARD_COLORS.pip;
    const n = p.level;
    for (let i = 0; i < n; i++) {
      const px = x + (i - (n - 1) / 2) * u * 0.13;
      ctx.beginPath();
      ctx.arc(px, yb + (p.owner === 0 ? 0.3 : -0.3) * u, u * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    void team;
    ctx.restore();
  }

  /** Simple icons matching the 3D concepts: paladin (plume + sword), bull (horns), shield-bearer. */
  private drawGlyph(ch: CharacterId, owner: PlayerId, level: number, x: number, y: number, u: number): void {
    const ctx = this.ctx;
    const team = TEAM_COLORS[owner];
    const steel = '#C9D0DD';
    const steelDark = '#7B8599';
    const gold = '#F3C34F';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, u * 0.03);
    ctx.strokeStyle = 'rgba(10,14,28,0.75)';
    ctx.save();
    if (level === 3) {
      ctx.shadowColor = team.glow;
      ctx.shadowBlur = u * 0.22;
    }
    switch (ch) {
      case 'sad': {
        // Sword (left), helmet with plume, shoulders.
        ctx.fillStyle = level === 3 ? '#BFEFFF' : steel;
        const bl = u * (0.5 + 0.06 * level);
        roundRect(ctx, x - u * 0.34, y - bl * 0.75, u * 0.07, bl, u * 0.02);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = level >= 2 ? gold : steelDark;
        ctx.fillRect(x - u * 0.4, y + bl * 0.15, u * 0.19, u * 0.04);
        ctx.fillStyle = steel;
        roundRect(ctx, x - u * 0.2, y + u * 0.02, u * 0.4, u * 0.24, u * 0.07); // shoulders
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y - u * 0.08, u * 0.17, 0, Math.PI * 2); // helmet
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = steelDark;
        ctx.fillRect(x - u * 0.12, y - u * 0.1, u * 0.24, u * 0.04); // visor
        ctx.fillStyle = team.main; // plume
        ctx.beginPath();
        ctx.moveTo(x - u * 0.06, y - u * 0.23);
        ctx.quadraticCurveTo(x - u * 0.02, y - u * (0.42 + 0.05 * level), x + u * 0.1, y - u * 0.33);
        ctx.quadraticCurveTo(x + u * 0.05, y - u * 0.3, x + u * 0.07, y - u * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = team.dark;
        ctx.fillRect(x - u * 0.06, y + u * 0.2, u * 0.12, u * 0.14); // tabard
        break;
      }
      case 'marki': {
        // Bull head: wide curved horns, team scarf, nose ring from Lv2.
        const hl = u * (0.2 + 0.05 * level);
        ctx.fillStyle = '#F4ECD6';
        for (const sd of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x + sd * u * 0.1, y - u * 0.05);
          ctx.quadraticCurveTo(x + sd * u * 0.42, y - u * 0.02, x + sd * u * 0.36, y - hl - u * 0.1);
          ctx.quadraticCurveTo(x + sd * u * 0.27, y - u * 0.1, x + sd * u * 0.1, y - u * 0.18);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.fillStyle = '#8E5B3B';
        ctx.beginPath();
        ctx.ellipse(x, y + u * 0.02, u * 0.2, u * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#DDB38F';
        ctx.beginPath();
        ctx.ellipse(x, y + u * 0.14, u * 0.12, u * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = level === 3 ? team.glow : '#252A36';
        ctx.fillRect(x - u * 0.12, y - u * 0.04, u * 0.06, u * 0.045);
        ctx.fillRect(x + u * 0.06, y - u * 0.04, u * 0.06, u * 0.045);
        ctx.fillStyle = team.main; // scarf
        ctx.fillRect(x - u * 0.2, y + u * 0.22, u * 0.4, u * 0.07);
        if (level >= 2) {
          ctx.strokeStyle = gold;
          ctx.lineWidth = u * 0.025;
          ctx.beginPath();
          ctx.arc(x, y + u * 0.2, u * 0.04, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'walk': {
        // Tower shield with team chevron, helmet peeking above, spear on the side.
        ctx.strokeStyle = 'rgba(10,14,28,0.75)';
        ctx.fillStyle = '#8F6A44';
        ctx.fillRect(x + u * 0.27, y - u * 0.46, u * 0.03, u * 0.8); // spear
        ctx.fillStyle = steel;
        ctx.beginPath();
        ctx.moveTo(x + u * 0.285, y - u * (0.58 + 0.03 * level));
        ctx.lineTo(x + u * 0.33, y - u * 0.44);
        ctx.lineTo(x + u * 0.24, y - u * 0.44);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = steel; // helmet
        ctx.beginPath();
        ctx.arc(x, y - u * 0.18, u * 0.14, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = team.main; // crest
        if (level >= 2) ctx.fillRect(x - u * 0.03, y - u * 0.4, u * 0.06, u * 0.1);
        ctx.fillStyle = level === 1 ? '#8F6A44' : level === 2 ? '#B6BFD0' : '#7C89A6';
        ctx.strokeStyle = level === 3 ? gold : 'rgba(10,14,28,0.75)';
        ctx.lineWidth = u * (level === 3 ? 0.05 : 0.03);
        ctx.beginPath();
        ctx.moveTo(x - u * 0.24, y - u * 0.12);
        ctx.lineTo(x + u * 0.24, y - u * 0.12);
        ctx.lineTo(x + u * 0.24, y + u * 0.14);
        ctx.quadraticCurveTo(x + u * 0.2, y + u * 0.3, x, y + u * 0.36);
        ctx.quadraticCurveTo(x - u * 0.2, y + u * 0.3, x - u * 0.24, y + u * 0.14);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = team.main;
        ctx.lineWidth = u * 0.06;
        ctx.beginPath();
        ctx.moveTo(x - u * 0.13, y + u * 0.02);
        ctx.lineTo(x, y + u * 0.12);
        ctx.lineTo(x + u * 0.13, y + u * 0.02);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
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
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
