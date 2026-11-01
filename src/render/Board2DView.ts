/**
 * Lightweight Canvas2D fallback board (flat, top-down) used when WebGL is unavailable.
 * Same palette, highlights, pieces, animations and API as the WebGL BoardView.
 * Player 0 (row 0) is at the bottom of the screen; col 0 at the left.
 */
import { BOARD_SIZE } from '../engine/types';
import type { CharacterId, Move, Piece, PlayerId, Pos } from '../engine/types';
import type { BoardHighlights, IBoardView } from './types';
import { ANIM, BOARD_COLORS, CHARACTER_RARITY, RARITY_COLORS, TEAM_COLORS } from './palette';
import {
  clamp01,
  containerSize,
  easeInOutCubic,
  easeOutCubic,
  indexHighlights,
  posKey,
  rgbToCss,
  slideDuration,
  tileRgb,
} from './common';
import type { HighlightIndex } from './common';

const TAP_SLOP_PX = 14;
const MAX_PIXEL_RATIO = 2;

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
    this.finishAnimation();
    this.pieces = clonePieces(pieces);
    this.requestRender();
  }

  animateMove(move: Move, piecesAfter: Piece[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishAnimation();
    const mover = this.pieces.find((p) => p.id === move.pieceId);
    if (!mover) {
      this.pieces = clonePieces(piecesAfter);
      this.requestRender();
      return Promise.resolve();
    }
    const captured = move.captureId ? (this.pieces.find((p) => p.id === move.captureId) ?? null) : null;
    const jump = mover.character === 'walk';
    const moveDur = jump ? ANIM.jump : slideDuration(move);
    const captureStart = captured ? moveDur * 0.62 : moveDur;
    const duration = captured ? Math.max(moveDur, captureStart + ANIM.capture + 80) : moveDur;
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

  resize(): void {
    if (this.disposed) return;
    const { w, h } = containerSize(this.container);
    this.cssW = w;
    this.cssH = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    const margin = Math.max(8, Math.min(w, h) * 0.03);
    const size = Math.max(10, Math.min(w, h) - margin * 2);
    const pad = size * 0.022;
    const cell = (size - pad * 2) / BOARD_SIZE;
    this.layout = { x0: (w - size) / 2 + pad, y0: (h - size) / 2 + pad, cell, pad };
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.finishAnimation();
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
    this.canvas.remove();
    this.pieces = [];
    this.cellCb = null;
  }

  // ---------------------------------------------------------------- render loop

  private requestRender(): void {
    if (this.disposed || this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.rafId = 0;
    if (this.disposed) return;
    if (this.anim && now - this.anim.start >= this.anim.duration) this.finishAnimation();
    this.draw(now);
    if (this.anim) this.requestRender();
  };

  private finishAnimation(): void {
    const a = this.anim;
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
    const size = cell * BOARD_SIZE;

    // Slab with soft shadow.
    ctx.save();
    ctx.shadowColor = 'rgba(32,33,36,0.22)';
    ctx.shadowBlur = pad * 3;
    ctx.shadowOffsetY = pad * 0.8;
    ctx.fillStyle = BOARD_COLORS.gap;
    roundRect(ctx, x0 - pad, y0 - pad, size + pad * 2, size + pad * 2, pad * 1.6);
    ctx.fill();
    ctx.restore();

    // Tiles.
    const gap = Math.max(1, cell * 0.07);
    const rad = Math.max(1, cell * 0.08);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        ctx.fillStyle = rgbToCss(tileRgb(r, c, this.hi));
        roundRect(ctx, x0 + c * cell + gap / 2, y0 + (BOARD_SIZE - 1 - r) * cell + gap / 2, cell - gap, cell - gap, rad);
        ctx.fill();
      }
    }

    // Overlays.
    const h = this.highlights;
    if (h.selected) {
      ctx.strokeStyle = BOARD_COLORS.selected;
      ctx.lineWidth = cell * 0.065;
      ctx.beginPath();
      ctx.arc(this.cx(h.selected.c), this.cy(h.selected.r), cell * 0.43, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = hexAlpha(BOARD_COLORS.moveDot, BOARD_COLORS.moveDotAlpha);
    for (const p of h.moves ?? []) {
      ctx.beginPath();
      ctx.arc(this.cx(p.c), this.cy(p.r), cell * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = hexAlpha(BOARD_COLORS.capture, 0.9);
    ctx.lineWidth = cell * 0.085;
    for (const p of h.captures ?? []) {
      ctx.beginPath();
      ctx.arc(this.cx(p.c), this.cy(p.r), cell * 0.405, 0, Math.PI * 2);
      ctx.stroke();
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
        const lift = a.jump ? Math.sin(Math.PI * k) : 0;
        moverDraw = () => this.drawPiece(p, x, y, 1 + lift * 0.22, 1, lift);
        continue;
      }
      if (a && a.captured && p.id === a.captured.id) {
        if (t < a.captureStart) {
          this.drawPiece(p, this.cx(p.pos.c), this.cy(p.pos.r), 1, 1, 0);
        } else {
          const k = clamp01((t - a.captureStart) / ANIM.capture);
          const s = 1 - easeOutCubic(k);
          if (s > 0.01) this.drawPiece(p, this.cx(p.pos.c), this.cy(p.pos.r), s, 1 - k, 0);
          this.drawBurst(a, p, clamp01((t - a.captureStart) / (ANIM.capture + 80)));
        }
        continue;
      }
      const lifted = posKey(p.pos) === this.hi.selected;
      this.drawPiece(p, this.cx(p.pos.c), this.cy(p.pos.r), lifted ? 1.06 : 1, 1, lifted ? 0.35 : 0);
    }
    if (moverDraw) moverDraw();
  }

  private drawBurst(a: Anim2D, p: Piece, k: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const x = this.cx(p.pos.c);
    const y = this.cy(p.pos.r);
    const e = easeOutCubic(k);
    ctx.fillStyle = hexAlpha(TEAM_COLORS[p.owner].main, 1 - k);
    for (const b of a.burst) {
      const d = e * cell * 0.62 * b.v;
      ctx.beginPath();
      ctx.arc(x + Math.cos(b.a) * d, y + Math.sin(b.a) * d, cell * 0.055 * (1 - k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Flat top-down token: base disc + rarity ring + level pips + character glyph. */
  private drawPiece(p: Piece, x: number, y: number, scale: number, alpha: number, lift: number): void {
    const ctx = this.ctx;
    const u = this.layout.cell * scale;
    const team = TEAM_COLORS[p.owner];
    ctx.save();
    ctx.globalAlpha = alpha;

    // Drop shadow (offset grows with lift for the jump).
    ctx.fillStyle = 'rgba(32,33,36,0.18)';
    ctx.beginPath();
    ctx.ellipse(x + u * (0.03 + lift * 0.08), y + u * (0.06 + lift * 0.14), u * 0.42, u * 0.39, 0, 0, Math.PI * 2);
    ctx.fill();

    const yb = y - lift * u * 0.08;
    // Base + rarity ring.
    ctx.fillStyle = BOARD_COLORS.pieceBase;
    ctx.beginPath();
    ctx.arc(x, yb, u * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = RARITY_COLORS[CHARACTER_RARITY[p.character]];
    ctx.lineWidth = u * 0.06;
    ctx.beginPath();
    ctx.arc(x, yb, u * 0.405, 0, Math.PI * 2);
    ctx.stroke();

    this.drawGlyph(p.character, p.owner, x, yb + (p.owner === 0 ? -0.045 : 0.045) * u, u * 1.12);

    // Level pips at the bottom of the base.
    ctx.fillStyle = team.dark;
    const n = p.level;
    for (let i = 0; i < n; i++) {
      const px = x + (i - (n - 1) / 2) * u * 0.115;
      ctx.beginPath();
      ctx.arc(px, yb + (p.owner === 0 ? 0.3 : -0.3) * u, u * 0.042, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawGlyph(ch: CharacterId, owner: PlayerId, x: number, y: number, u: number): void {
    const ctx = this.ctx;
    const team = TEAM_COLORS[owner];
    ctx.fillStyle = team.main;
    switch (ch) {
      case 'sad': {
        // Plus-shaped crown on an octagonal tower.
        ctx.fillStyle = team.dark;
        polygon(ctx, x, y, u * 0.2, 8, Math.PI / 8);
        ctx.fill();
        ctx.fillStyle = team.main;
        const l = u * 0.27;
        const w = u * 0.085;
        roundRect(ctx, x - l, y - w, l * 2, w * 2, w * 0.5);
        ctx.fill();
        roundRect(ctx, x - w, y - l, w * 2, l * 2, w * 0.5);
        ctx.fill();
        break;
      }
      case 'marki': {
        // Arrowhead pointing in the forward direction (up for player 0, down for player 1).
        const f = owner === 0 ? -1 : 1;
        ctx.beginPath();
        const yc = y - f * u * 0.02;
        ctx.moveTo(x, yc + f * u * 0.24);
        ctx.lineTo(x + u * 0.19, yc + f * u * 0.0);
        ctx.lineTo(x + u * 0.065, yc + f * u * 0.0);
        ctx.lineTo(x + u * 0.065, yc - f * u * 0.17);
        ctx.lineTo(x - u * 0.065, yc - f * u * 0.17);
        ctx.lineTo(x - u * 0.065, yc + f * u * 0.0);
        ctx.lineTo(x - u * 0.19, yc + f * u * 0.0);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'walk': {
        // Orb with a halo ring.
        ctx.strokeStyle = team.light;
        ctx.lineWidth = u * 0.045;
        ctx.beginPath();
        ctx.ellipse(x, y, u * 0.31, u * 0.25, -0.15, 0, Math.PI * 2);
        ctx.stroke();
        const g = ctx.createRadialGradient(x - u * 0.07, y - u * 0.08, u * 0.02, x, y, u * 0.21);
        g.addColorStop(0, team.light);
        g.addColorStop(0.45, team.main);
        g.addColorStop(1, team.dark);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, u * 0.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
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

function polygon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
