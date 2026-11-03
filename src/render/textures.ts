/** Procedural canvas textures for the WebGL board (no downloads, deterministic, tiny). */
import * as THREE from 'three';
import { BOARD_SIZE } from '../engine/types';
import { BOARD_COLORS, TEAM_COLORS } from './palette';
import { hexToRgb, makeRng, rgbToCss } from './common';
import type { RGB } from './common';
import {
  FRAME_EXTENT,
  MARKER_QUAD,
  TILE_BEVEL,
  TILE_EDGE_SHADE,
  TILE_FACE_GRAD,
  TILE_HIGHLIGHT,
  TILE_INSET,
  TILE_LIP,
  TILE_LIP_SHADE,
  TILE_LIP_X,
  TILE_RADIUS,
  paintCaptureRing,
  paintFieldOverlay,
  paintFrame,
  paintGlowDot,
  paintSelectGlow,
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
 * Luminous move-target dot in its own colour (white-hot core, soft halo; arena.ts paintGlowDot).
 * Additive blending; the plane is MARKER_QUAD.dot cells wide.
 */
export function makeDotTexture(color: RGB): THREE.CanvasTexture {
  const s = 128;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) paintGlowDot(ctx, s / 2, s / 2, s / 2, color);
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

/** Cells -> texture pixels of the frame texture (sharp on phones at DPR 2). */
const FRAME_PX = 72;

/**
 * The iron frame + field well as one texture, and its world-space plane size / centre offset
 * (the frame is taller than wide: the lip and the shadow hang below the field).
 */
export function makeFrameTexture(): { tex: THREE.CanvasTexture; width: number; depth: number; offsetZ: number } {
  const E = FRAME_EXTENT;
  const width = BOARD_SIZE + E.side * 2;
  const depth = BOARD_SIZE + E.top + E.bottom;
  const w = Math.round(width * FRAME_PX);
  const h = Math.round(depth * FRAME_PX);
  const { cvs, ctx } = canvas(w, h);
  if (ctx) paintFrame(ctx, FRAME_PX, E.side * FRAME_PX, E.top * FRAME_PX);
  const tex = toTexture(cvs);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  // Plane centre relative to the field centre (world +z = screen down).
  const offsetZ = (E.bottom - E.top) / 2;
  return { tex, width, depth, offsetZ };
}

/** Field overlay (ambient occlusion along the frame), exactly the 12x12 field. */
export function makeFieldOverlayTexture(): THREE.CanvasTexture {
  const s = 512;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) paintFieldOverlay(ctx, s / BOARD_SIZE, 0, 0);
  const tex = toTexture(cvs);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** Glowing selection frame in its own colour (additive); quad = MARKER_QUAD.select cells. */
export function makeSelectGlowTexture(color: RGB): THREE.CanvasTexture {
  const s = 160;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) paintSelectGlow(ctx, s / 2, s / 2, s / MARKER_QUAD.select, color);
  return toTexture(cvs);
}

/** Glowing capture ring in its own colour (normal blend); quad = MARKER_QUAD.capture cells. */
export function makeCaptureRingTexture(color: RGB): THREE.CanvasTexture {
  const s = 160;
  const { cvs, ctx } = canvas(s, s);
  if (ctx) paintCaptureRing(ctx, s / 2, s / 2, s / MARKER_QUAD.capture, color);
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

/** Raised slate tile (mirrors arena.ts paintTile); output is sRGB, written as-is (no tone mapping). */
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
  vec3 lip = c * ${f(TILE_LIP_SHADE)};
  // Top face: lighter toward the top-left (diagonal gradient across the face, as paintTile).
  vec2 fq = clamp((p - tMin) / (tMax - tMin), 0.0, 1.0);
  float fk = 1.0 + ${f(TILE_FACE_GRAD)} - ${f(2 * TILE_FACE_GRAD)} * (fq.x + fq.y) * 0.5;
  vec3 face = fk > 1.0 ? mix(c, vec3(1.0), fk - 1.0) : c * fk;
  vec3 top = mix(face, vec3(1.0), ${f(TILE_HIGHLIGHT)} * (1.0 - inHl));
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
