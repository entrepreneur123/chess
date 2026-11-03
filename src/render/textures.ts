/** Procedural canvas textures for the WebGL board (no downloads, deterministic, tiny). */
import * as THREE from 'three';
import { BOARD_SIZE } from '../engine/types';
import { BOARD_COLORS, TEAM_COLORS } from './palette';
import { hexToRgb, makeRng, rgbToCss } from './common';
import {
  PLINTH_EXTENT,
  TILE_BEVEL,
  TILE_EDGE_SHADE,
  TILE_HIGHLIGHT,
  TILE_INSET,
  TILE_LIP,
  TILE_LIP_SHADE,
  TILE_LIP_X,
  TILE_RADIUS,
  paintCaptureMark,
  paintFieldOverlay,
  paintPlinth,
  paintSelectFrame,
} from './arena';

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

/**
 * Move target dot (tint via material colour): a soft white dot with a navy keyline and a dark drop
 * shadow below it, so it reads on the bright grass. Normal blending (the shadow stays dark when the
 * dot is tinted red for an enemy reach preview).
 */
export function makeDotTexture(): THREE.CanvasTexture {
  const s = 128;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) {
    const c = s / 2;
    const r = s * 0.18;
    // Drop shadow (offset down, soft).
    ctx.save();
    ctx.shadowColor = 'rgba(10,20,40,0.55)';
    ctx.shadowBlur = s * 0.05;
    ctx.shadowOffsetY = s * 0.035;
    ctx.fillStyle = 'rgba(27,36,69,0.9)';
    ctx.beginPath();
    ctx.arc(c, c, r + s * 0.014, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Soft white body, slightly cooler at the bottom, with a top-left catch light.
    const g = ctx.createLinearGradient(0, c - r, 0, c + r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(226,234,246,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(c - r * 0.3, c - r * 0.38, r * 0.34, r * 0.22, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = toTexture(cvs);
  tex.anisotropy = 4;
  return tex;
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

/** Cells -> texture pixels of the plinth texture (sharp on phones at DPR 2). */
const PLINTH_PX = 72;

/**
 * The stone plinth + field bed as one texture, and its world-space plane size / centre offset
 * (the plinth is taller than wide: the lip and the drop shadow hang below the field).
 */
export function makePlinthTexture(): { tex: THREE.CanvasTexture; width: number; depth: number; offsetZ: number } {
  const E = PLINTH_EXTENT;
  const width = BOARD_SIZE + E.side * 2;
  const depth = BOARD_SIZE + E.top + E.bottom;
  const w = Math.round(width * PLINTH_PX);
  const h = Math.round(depth * PLINTH_PX);
  const { cvs, ctx } = canvas(w, h);
  if (ctx) paintPlinth(ctx, PLINTH_PX, E.side * PLINTH_PX, E.top * PLINTH_PX);
  const tex = toTexture(cvs);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  // Plane centre relative to the field centre (world +z = screen down).
  const offsetZ = (E.bottom - E.top) / 2;
  return { tex, width, depth, offsetZ };
}

/** Field overlay (ambient occlusion along the frame + the centre path), exactly the 12x12 field. */
export function makeFieldOverlayTexture(): THREE.CanvasTexture {
  const s = 512;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) paintFieldOverlay(ctx, s / BOARD_SIZE, 0, 0);
  const tex = toTexture(cvs);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** Selection frame around a tile (white band, tint via material colour); quad = SELECT_QUAD cells. */
export const SELECT_QUAD = 1.25;
export function makeSelectFrameTexture(): THREE.CanvasTexture {
  const s = 160;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) paintSelectFrame(ctx, s / 2, s / 2, s / SELECT_QUAD, '#FFFFFF');
  const tex = toTexture(cvs);
  tex.anisotropy = 4;
  return tex;
}

/** Capture target brackets (white, tint via material colour); quad = SELECT_QUAD cells. */
export function makeCaptureMarkTexture(): THREE.CanvasTexture {
  const s = 160;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) paintCaptureMark(ctx, s / 2, s / 2, (s / SELECT_QUAD) * 0.94, '#FFFFFF');
  const tex = toTexture(cvs);
  tex.anisotropy = 4;
  return tex;
}

const TILE_VS = /* glsl */ `
varying vec2 vP;
varying vec3 vC;
void main() {
  vP = vec2(uv.x, 1.0 - uv.y); // cell space, y down (screen)
#ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
#else
  vC = vec3(1.0);
#endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const f = (x: number): string => x.toFixed(4);

/** Raised grass tile (mirrors arena.ts paintTile); output is sRGB, written as-is (no tone mapping). */
const TILE_FS = /* glsl */ `
varying vec2 vP;
varying vec3 vC;
float sdRR(vec2 p, vec2 c, vec2 hb, float r) {
  vec2 q = abs(p - c) - hb + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec3 toSRGB(vec3 l) {
  return mix(l * 12.92, 1.055 * pow(max(l, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), l));
}
void main() {
  vec2 p = vP;
  float aa = max(fwidth(p.x), fwidth(p.y)) * 0.8;
  float dOut = sdRR(p, vec2(0.5), vec2(${f(0.5 - TILE_INSET)}), ${f(TILE_RADIUS)});
  float a = 1.0 - smoothstep(-aa, aa, dOut);
  if (a <= 0.0) discard;
  vec2 tMin = vec2(${f(TILE_INSET)});
  vec2 tMax = vec2(${f(1 - TILE_INSET - TILE_LIP_X)}, ${f(1 - TILE_INSET - TILE_LIP)});
  vec2 tc = (tMin + tMax) * 0.5;
  vec2 th = (tMax - tMin) * 0.5;
  float rt = ${f(TILE_RADIUS * 0.92)};
  float inTop = 1.0 - smoothstep(-aa, aa, sdRR(p, tc, th, rt));
  float inHl = 1.0 - smoothstep(-aa, aa, sdRR(p, tc + vec2(${f(TILE_BEVEL)}), th, rt));
  float inDk = 1.0 - smoothstep(-aa, aa, sdRR(p, tc - vec2(${f(TILE_BEVEL * 0.8)}), th, rt));
  vec3 c = toSRGB(vC);
  vec3 lip = c * mix(${f(TILE_LIP_SHADE)}, ${f(TILE_LIP_SHADE * 0.88)}, smoothstep(0.8, 1.0, p.y));
  vec3 top = mix(c, vec3(1.0), ${f(TILE_HIGHLIGHT)} * (1.0 - inHl));
  top *= mix(${f(TILE_EDGE_SHADE)}, 1.0, inDk);
  gl_FragColor = vec4(mix(lip, top, inTop), a);
}`;

/** Instanced raised-tile material (per-instance colour = InstancedMesh.setColorAt). */
export function makeTileMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: TILE_VS,
    fragmentShader: TILE_FS,
    transparent: true,
    depthWrite: false,
  });
}
