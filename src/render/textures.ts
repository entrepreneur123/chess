/** Procedural canvas textures for the WebGL board (no downloads, deterministic, tiny). */
import * as THREE from 'three';
import { BOARD_COLORS, TEAM_COLORS } from './palette';
import { hexToRgb, makeRng, paintBackdrop, rgbToCss } from './common';

function canvas(w: number, h: number): { cvs: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const cvs = document.createElement('canvas');
  cvs.width = w;
  cvs.height = h;
  return { cvs, ctx: cvs.getContext('2d') };
}

function toTexture(cvs: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cvs);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft white radial glow (alpha falloff). Tint via material color. */
export function makeGlowTexture(): THREE.CanvasTexture {
  const s = 128;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.62)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  return toTexture(cvs);
}

/** Glowing target dot: bright core + soft halo. */
export function makeDotTexture(): THREE.CanvasTexture {
  const s = 128;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.97)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.68, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  return toTexture(cvs);
}

/** Dark blob used as a contact shadow under each piece. */
export function makeBlobTexture(): THREE.CanvasTexture {
  const s = 64;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  return toTexture(cvs);
}

/** Vertical soft band (peak in the middle) used as the zone-line halo. */
export function makeBandTexture(): THREE.CanvasTexture {
  const { cvs, ctx } = canvas(4, 64);
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 64);
  }
  return toTexture(cvs);
}

/** Horizontal comet streak (bright head on the right, fading tail to the left). */
export function makeCometTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 16;
  const { cvs, ctx } = canvas(w, h);
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.92, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    const v = ctx.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.5, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }
  return toTexture(cvs);
}

/**
 * Tile top: near-white (multiplied by the per-instance color) with a soft pillow highlight, a
 * bevel catch-light on the top-left edges, a darker bottom-right edge and fine stone grain.
 */
export function makeTileTexture(): THREE.CanvasTexture {
  const s = 128;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) {
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.72);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0.20)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const rnd = makeRng(11);
    for (let i = 0; i < 700; i++) {
      const a = 0.02 + rnd() * 0.05;
      ctx.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.4})`;
      ctx.fillRect(rnd() * s, rnd() * s, 1 + (rnd() < 0.2 ? 1 : 0), 1);
    }
    // Bevel lines.
    const lw = 5;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(lw, s - lw * 2);
    ctx.lineTo(lw, lw);
    ctx.lineTo(s - lw * 2, lw);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.moveTo(lw * 2, s - lw);
    ctx.lineTo(s - lw, s - lw);
    ctx.lineTo(s - lw, lw * 2);
    ctx.stroke();
  }
  const tex = toTexture(cvs);
  tex.anisotropy = 4;
  return tex;
}

/** Slab top: deep slate stone (mottled noise + vignette) with an inlaid team-colored frame line. */
export function makeSlabTexture(slabSize: number, margin: number): THREE.CanvasTexture {
  const s = 512;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) {
    ctx.fillStyle = BOARD_COLORS.slab;
    ctx.fillRect(0, 0, s, s);
    const rnd = makeRng(23);
    // Mottled blotches.
    for (let i = 0; i < 140; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = 18 + rnd() * 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const light = rnd() < 0.5;
      g.addColorStop(0, light ? 'rgba(120,150,220,0.07)' : 'rgba(0,0,10,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 5200; i++) {
      const a = 0.03 + rnd() * 0.07;
      ctx.fillStyle = rnd() < 0.55 ? `rgba(150,175,235,${a})` : `rgba(0,0,0,${a * 1.5})`;
      ctx.fillRect(rnd() * s, rnd() * s, 1, 1);
    }
    // Frame line inlay: Red on the far side (canvas top), Blue on the near side.
    const m = (margin / slabSize) * s; // margin in px
    const inset = m * 0.5;
    const frame = (width: number, alpha: number, blur: number): void => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, rgbToCss(hexToRgb(TEAM_COLORS[1].glow), alpha));
      g.addColorStop(0.5, rgbToCss(hexToRgb(BOARD_COLORS.slabEdge), alpha * 0.8));
      g.addColorStop(1, rgbToCss(hexToRgb(TEAM_COLORS[0].glow), alpha));
      ctx.save();
      ctx.shadowColor = rgbToCss(hexToRgb(BOARD_COLORS.slabEdge), 0.5);
      ctx.shadowBlur = blur;
      ctx.strokeStyle = g;
      ctx.lineWidth = width;
      ctx.beginPath();
      const r = 7;
      const x0 = inset;
      const x1 = s - inset;
      ctx.moveTo(x0 + r, x0);
      ctx.arcTo(x1, x0, x1, x1, r);
      ctx.arcTo(x1, x1, x0, x1, r);
      ctx.arcTo(x0, x1, x0, x0, r);
      ctx.arcTo(x0, x0, x1, x0, r);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    };
    frame(m * 0.22, 0.85, 6);
    // Outer highlight edge + inner shadow next to the tiles.
    ctx.strokeStyle = 'rgba(160,185,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = m * 0.35;
    ctx.strokeRect(m * 0.9, m * 0.9, s - m * 1.8, s - m * 1.8);
    // Vignette.
    const v = ctx.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, s, s);
  }
  const tex = toTexture(cvs);
  tex.anisotropy = 4;
  return tex;
}

/** Full-screen arena backdrop (stretched over the viewport by scene.background). */
export function makeBackdropTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 384;
  const { cvs, ctx } = canvas(w, h);
  if (ctx) paintBackdrop(ctx, w, h);
  const tex = toTexture(cvs);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}
