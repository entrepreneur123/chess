/**
 * Small procedural add-ons for the glTF units: Lv3 aura (ground glow + GPU-animated rising sparks),
 * the paladin's halo sprite and team plume geometry. Everything animates from one shared `uTime`
 * uniform, so no per-frame CPU work besides setting that value.
 */
import * as THREE from 'three';

/** Shared time uniform (seconds) for unit shaders. */
export const unitTime = { value: 0 };
/** Shared point-size scale (drawing-buffer px per world unit at distance 1). */
export const unitPointScale = { value: 600 };

const SPARK_VS = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform float uSize;
attribute vec4 seed;
varying float vFade;
void main() {
  float ph = fract(seed.x + uTime * (0.35 + 0.25 * seed.w));
  float a = seed.y * 6.2831 + uTime * (0.9 + seed.z);
  float r = 0.28 + 0.22 * seed.z + 0.08 * ph;
  vec3 p = vec3(cos(a) * r, 0.05 + ph * (1.15 + 0.35 * seed.w), sin(a) * r);
  vFade = sin(3.14159 * ph);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.55 + 0.45 * seed.z) * uScale / -mv.z;
}`;

const SPARK_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
varying float vFade;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  vec3 c = mix(uColor, uCore, a * a);
  gl_FragColor = vec4(c * a * vFade, 1.0);
}`;

export function makeSparkMaterial(color: string, core: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: unitTime,
      uScale: unitPointScale,
      uSize: { value: 0.11 },
      uColor: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(core) },
    },
    vertexShader: SPARK_VS,
    fragmentShader: SPARK_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Points geometry with `count` random seeds (positions are computed in the shader). */
export function makeSparkGeometry(count: number, seedBase: number): THREE.BufferGeometry {
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
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 1.2);
  return g;
}

/** Golden spiked halo (canvas texture) for the legendary paladin. */
export function makeHaloTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (ctx) {
    const cx = S / 2;
    const glow = ctx.createRadialGradient(cx, cx, S * 0.18, cx, cx, S * 0.5);
    glow.addColorStop(0, 'rgba(255,214,110,0)');
    glow.addColorStop(0.45, 'rgba(255,214,110,0.55)');
    glow.addColorStop(1, 'rgba(255,214,110,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#FFE7A0';
    const spikes = 14;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? S * 0.47 : S * 0.33;
      const x = cx + Math.cos(a) * r;
      const y = cx + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cx, S * 0.29, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cx, S * 0.31, 0, Math.PI * 2);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Tapered, slightly flattened plume (helmet crest) along a curve that starts at `root` and sweeps
 * backwards (-z) and down. `size` is in the model's own units. UVs point into a vertical strip
 * [u, v0..v1] of the atlas (a team-tinted cell), so the plume shares the unit's single material.
 */
export function makePlumeGeometry(
  root: THREE.Vector3,
  size: number,
  u: number,
  v0: number,
  v1: number,
): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector3(0, -0.06, 0.1),
    new THREE.Vector3(0, 0.1, 0.0),
    new THREE.Vector3(0, 0.15, -0.2),
    new THREE.Vector3(0, 0.04, -0.42),
    new THREE.Vector3(0, -0.2, -0.56),
  ].map((p) => p.multiplyScalar(size).add(root));
  const curve = new THREE.CatmullRomCurve3(pts);
  const seg = 20;
  const radial = 8;
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const center = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, center);
    const r = size * 0.17 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.6) * (1 - 0.5 * t) + size * 0.008;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(center);
      v.x *= 0.75 * r;
      v.y *= r;
      v.z *= r;
      v.add(center);
      pos.setXYZ(k, v.x, v.y, v.z);
      uv.setXY(k, u, v0 + (v1 - v0) * (0.2 + 0.7 * t));
    }
  }
  g.computeVertexNormals();
  // Close the root with a cap-less tuck: the first ring sits inside the helmet.
  return g;
}
