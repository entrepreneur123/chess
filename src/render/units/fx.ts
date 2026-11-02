/**
 * Per-unit FX templates (shared by every unit of a template, GPU animated from the library's
 * shared `time` uniform: no per-frame CPU work besides setting that value):
 *  - idle particles (Lv2 small glints / embers, Lv3 dense rising sparks),
 *  - Lv3 aura: ground rune + glow (quad; the rune ring rotates in the shader) and a vertical light
 *    shaft (open cone, soft edges, scrolling streaks) merged into ONE additive draw call.
 */
import * as THREE from 'three';
import type { ParticleLook } from './config';
import type { UnitUniforms } from './material';

const SPARK_VS = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform float uSize;
uniform vec3 uShape; // radius, height, speed
attribute vec4 seed;
varying float vFade;
varying float vTw;
void main() {
  float ph = fract(seed.x + uTime * uShape.z * (0.75 + 0.5 * seed.w));
  float a = seed.y * 6.2831 + uTime * (0.6 + seed.z) * (seed.w > 0.5 ? 1.0 : -1.0);
  float r = uShape.x * (0.55 + 0.45 * seed.z) * (1.0 - 0.35 * ph);
  vec3 p = vec3(cos(a) * r, 0.04 + ph * uShape.y * (0.7 + 0.3 * seed.w), sin(a) * r);
  vFade = sin(3.14159 * ph);
  vTw = 0.6 + 0.4 * sin(uTime * 9.0 + seed.y * 40.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.5 + 0.5 * seed.z) * (1.0 - 0.4 * ph) * uScale / -mv.z;
}`;

const SPARK_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
varying float vFade;
varying float vTw;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  // 4-point star glint on top of the soft dot.
  float star = max(0.0, 1.0 - abs(d.x) * 14.0) * max(0.0, 1.0 - abs(d.y) * 2.2) + max(0.0, 1.0 - abs(d.y) * 14.0) * max(0.0, 1.0 - abs(d.x) * 2.2);
  a = max(a * a, star * 0.8);
  vec3 c = mix(uColor, uCore, a * a);
  gl_FragColor = vec4(c * a * vFade * vTw, 1.0);
}`;

export function makeParticleMaterial(u: UnitUniforms, look: ParticleLook): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: u.time,
      uScale: u.pointScale,
      uSize: { value: look.size },
      uShape: { value: new THREE.Vector3(look.radius, look.height, look.speed) },
      uColor: { value: new THREE.Color(look.color) },
      uCore: { value: new THREE.Color(look.core) },
    },
    vertexShader: SPARK_VS,
    fragmentShader: SPARK_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Points geometry with `count` random seeds (positions are computed in the shader). */
export function makeParticleGeometry(count: number, seedBase: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const seeds = new Float32Array(count * 4);
  let s = seedBase * 9301 + 49297;
  const rnd = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < count; i++) {
    seeds[i * 4] = i / count + rnd() * 0.05;
    seeds[i * 4 + 1] = rnd();
    seeds[i * 4 + 2] = rnd();
    seeds[i * 4 + 3] = rnd();
  }
  g.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  // Dummy positions (required attribute); real positions come from the shader.
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 1.4);
  return g;
}

/**
 * Rune circle texture: R = rune lines (rings, glyph ticks, star), G = soft aura glow.
 * White-on-black data texture, read by the rune shader (rotates R only).
 */
export function makeRuneTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    const cx = S / 2;
    // Aura (green channel).
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cx, S * 0.05, cx, cx, S * 0.5);
    g.addColorStop(0, 'rgba(0,255,0,1)');
    g.addColorStop(0.55, 'rgba(0,150,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // Rune lines (red channel).
    ctx.strokeStyle = 'rgb(255,0,0)';
    ctx.fillStyle = 'rgb(255,0,0)';
    const ring = (r: number, w: number): void => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(cx, cx, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(S * 0.46, 5);
    ring(S * 0.4, 2.5);
    ring(S * 0.24, 2.5);
    // Glyph ticks between the outer rings.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r0 = S * 0.41;
      const r1 = S * (i % 3 === 0 ? 0.455 : 0.44);
      ctx.lineWidth = i % 3 === 0 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1);
      ctx.stroke();
      if (i % 3 === 1) {
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * S * 0.43, cx + Math.sin(a) * S * 0.43, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Hexagram between the inner rings.
    ctx.lineWidth = 3;
    for (const off of [0, Math.PI / 3]) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = off + (i / 3) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * S * 0.39;
        const y = cx + Math.sin(a) * S * 0.39;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const AURA_VS = /* glsl */ `
attribute float aKind;
varying vec2 vUv;
varying float vKind;
varying float vFacing;
void main() {
  vUv = uv;
  vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

const AURA_FS = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform vec3 uRune;
uniform vec3 uAura;
uniform vec3 uTeam;
uniform vec3 uShaft;
uniform float uOpacity;
varying vec2 vUv;
varying float vKind;
varying float vFacing;
void main() {
  vec3 col;
  if (vKind < 0.5) {
    vec2 p = vUv - 0.5;
    float a = uTime * 0.35;
    vec2 q = vec2(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y) + 0.5;
    float rune = texture2D(uMap, q).r;
    float aura = texture2D(uMap, vUv).g;
    float pulse = 0.75 + 0.25 * sin(uTime * 2.6);
    float r = length(p) * 2.0;
    col = uRune * rune * (0.85 + 0.35 * pulse) + uAura * aura * 0.55 * pulse + uTeam * smoothstep(0.5, 0.0, r) * 0.25;
  } else {
    float h = vUv.y;
    float fade = pow(1.0 - h, 1.6) * smoothstep(0.0, 0.06, h);
    float edge = pow(vFacing, 1.8);
    float streak = 0.65 + 0.35 * sin(vUv.x * 6.2831 * 5.0 + h * 9.0 - uTime * 2.2) * sin(vUv.x * 6.2831 * 3.0 - uTime * 1.3);
    col = uShaft * fade * edge * streak * uOpacity * (0.85 + 0.15 * sin(uTime * 3.1));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export interface AuraLook {
  rune: string;
  aura: string;
  team: string;
  shaft: string;
  opacity: number;
}

export function makeAuraMaterial(u: UnitUniforms, map: THREE.Texture, look: AuraLook): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uTime: u.time,
      uRune: { value: new THREE.Color(look.rune) },
      uAura: { value: new THREE.Color(look.aura) },
      uTeam: { value: new THREE.Color(look.team) },
      uShaft: { value: new THREE.Color(look.shaft) },
      uOpacity: { value: look.opacity },
    },
    vertexShader: AURA_VS,
    fragmentShader: AURA_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** Ground quad (aKind 0, 1.32 wide at y=0.012) + open shaft cone (aKind 1) of `height`. */
export function makeAuraGeometry(height: number): THREE.BufferGeometry {
  const quad = new THREE.PlaneGeometry(1.32, 1.32).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
  const cone = new THREE.CylinderGeometry(0.5, 0.36, height, 20, 1, true).translate(0, height / 2, 0);
  const parts = [quad, cone];
  let vc = 0;
  let ic = 0;
  for (const g of parts) {
    vc += g.attributes.position.count;
    ic += (g.index as THREE.BufferAttribute).count;
  }
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 3);
  const uv = new Float32Array(vc * 2);
  const kind = new Float32Array(vc);
  const idx = new Uint16Array(ic);
  let vo = 0;
  let io = 0;
  parts.forEach((g, k) => {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, vo * 3);
    nor.set(g.attributes.normal.array as Float32Array, vo * 3);
    uv.set(g.attributes.uv.array as Float32Array, vo * 2);
    kind.fill(k, vo, vo + n);
    const gi = g.index as THREE.BufferAttribute;
    for (let i = 0; i < gi.count; i++) idx[io + i] = gi.getX(i) + vo;
    io += gi.count;
    vo += n;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
