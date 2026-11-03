/**
 * Brutile's wasteland ("불모지") for the WebGL board, all pre-allocated and instanced:
 *  - waste: ONE InstancedMesh of full-cell decals (scorched ground, sickly green glowing cracks,
 *    bubbling poison, faint miasma). Cracks / noise use WORLD coordinates so neighbouring squares
 *    join into one patch; each instance carries a 4-bit neighbour mask so only the outer boundary
 *    gets the ragged toxic rim. `aOpen` (0..1) drives the crack-open reveal of animateSkill;
 *  - ghost: ONE InstancedMesh for the skill targeting overlay (anchors = subtle green tint, preview =
 *    bright green ghost of the wasteland with an outline around the area, red + hatching if invalid);
 *  - marks: ONE InstancedMesh of skull danger marks on deadly move targets;
 *  - beam: green black-magic bolt along a quadratic curve (vertex-shader bent strip);
 *  - rune: witch rune circle (hexagram + glyph ring over a black-purple smoke disc) under a caster.
 * One shared `uTime` uniform; the board re-renders it at <= ~30 fps (or never with reduced motion).
 * Positions follow BoardView: x = c - 5.5, z = 5.5 - r, plane uv.y grows toward +r (screen up).
 */
import * as THREE from 'three';
import { BOARD_SIZE } from '../engine/types';
import { WASTE_COLORS } from './palette';

const N = BOARD_SIZE * BOARD_SIZE;
const HALF = (BOARD_SIZE - 1) / 2;

const NOISE = /* glsl */ `
float sq2(float x) { return x * x; }
float hash1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash1(i), hash1(i + vec2(1.0, 0.0)), f.x), mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Voronoi: x = distance to the nearest cell edge, y = cell id hash.
vec2 voronoi(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + hash2(n + g) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + hash2(n + g) - f;
      vec2 dr = r - mr;
      if (dot(dr, dr) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(dr)));
    }
  }
  return vec2(md, hash1(n + mg));
}
// Distance from the cell centre frame p (-0.5..0.5) to the sides WITHOUT a wasteland neighbour.
float openEdge(vec2 p, float mask) {
  float m = floor(mask + 0.5); // interpolated varyings are not exact integers
  float d = 9.0;
  if (mod(m, 2.0) < 0.5) d = min(d, 0.5 - p.x);
  if (mod(floor(m / 2.0 + 0.01), 2.0) < 0.5) d = min(d, 0.5 + p.x);
  if (mod(floor(m / 4.0 + 0.01), 2.0) < 0.5) d = min(d, 0.5 - p.y);
  if (mod(floor(m / 8.0 + 0.01), 2.0) < 0.5) d = min(d, 0.5 + p.y);
  return d;
}`;

const CELL_VS = /* glsl */ `
attribute float aA;
attribute float aB;
varying vec2 vUv;
varying vec2 vW;
varying float vA;
varying float vB;
void main() {
  vUv = uv;
  vA = aA;
  vB = aB;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = vec2(wp.x, -wp.z);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/** aA = neighbour mask, aB = reveal (0..1). Premultiplied output. */
const WASTE_FS = /* glsl */ `
uniform float uTime;
uniform vec3 uGround;
uniform vec3 uGround2;
uniform vec3 uGlow;
uniform vec3 uCore;
uniform vec3 uMiasma;
varying vec2 vUv;
varying vec2 vW;
varying float vA;
varying float vB;
${NOISE}
void main() {
  vec2 p = vUv - 0.5;
  float open = clamp(vB, 0.0, 1.0);
  float dEdge = openEdge(p, vA);
  float rag = 0.025 + 0.11 * vnoise(vW * 5.0) + 0.045 * vnoise(vW * 16.0 + 4.0);
  float inside = smoothstep(rag, rag + 0.018, dEdge);
  // Reveal: the ground cracks open from the square's centre outward.
  float len = length(p) + 0.12 * vnoise(vW * 9.0 + 2.0);
  float R = open * 1.08;
  float rev = smoothstep(R, R - 0.1, len);
  float revealing = step(open, 0.999);
  float front = exp(-sq2((len - R) / 0.045)) * revealing * step(0.001, open);
  // Ground: charred, ashy, darker toward the rim, with pale ash specks.
  float g1 = vnoise(vW * 2.2);
  float g2 = vnoise(vW * 9.0 + 3.0);
  vec3 ground = mix(uGround, uGround2, g1 * 0.8 + g2 * 0.2) * (0.75 + 0.5 * g2);
  ground += vec3(0.05, 0.05, 0.04) * step(0.94, hash1(floor(vW * 38.0))) * g1;
  ground *= mix(0.5, 1.0, smoothstep(0.0, 0.18, dEdge - rag));
  // Glowing crack network (warped voronoi edges) + fine dead (dark) cracks.
  vec2 q = vW * 1.75 + 0.38 * vec2(vnoise(vW * 3.1), vnoise(vW * 3.1 + 5.2));
  vec2 v = voronoi(q);
  float crack = 1.0 - smoothstep(0.012, 0.038, v.x);
  float halo = exp(-v.x * v.x / 0.0032);
  vec2 v2 = voronoi(vW * 5.5 + 11.0);
  float fine = 1.0 - smoothstep(0.0, 0.035, v2.x);
  float pulse = 0.62 + 0.38 * sin(uTime * 2.2 + v.y * 6.2831853);
  float flow = 0.7 + 0.3 * sin(vnoise(q * 1.6) * 11.0 - uTime * 2.4);
  ground *= 1.0 - fine * 0.6;
  // Poison pools: some crack cells are filled with bubbling toxic sludge.
  float pool = step(0.87, v.y) * smoothstep(0.03, 0.1, v.x);
  float sl = vnoise(vW * 6.0 + vec2(uTime * 0.25, -uTime * 0.2));
  vec3 sludge = uMiasma * (0.07 + 0.2 * sl);
  ground = mix(ground, sludge, pool * 0.9);
  // Bubbles (inside pools): grow, glint, pop.
  vec2 bq = vW * 4.2;
  vec2 bi = floor(bq);
  vec2 bf = fract(bq) - 0.5;
  float bh = hash1(bi + 17.0);
  vec2 bo = (hash2(bi + 3.0) - 0.5) * 0.45;
  float ph = fract(uTime * 0.45 + bh * 7.0);
  float br = 0.08 + 0.2 * ph;
  float bd = length(bf - bo);
  float has = step(0.3, bh) * pool;
  float alive = smoothstep(1.0, 0.88, ph);
  float body = has * smoothstep(br, br - 0.06, bd) * alive;
  float ring = has * smoothstep(0.05, 0.0, abs(bd - br)) * alive;
  float spec = has * smoothstep(br * 0.4, 0.0, length(bf - bo - vec2(-0.35, 0.35) * br)) * alive;
  float popR = has * smoothstep(0.88, 1.0, ph) * exp(-sq2((bd - br * 1.25) / 0.035));
  // Miasma: slow drifting green haze in patches.
  float mi = vnoise(vW * 1.2 + vec2(uTime * 0.11, -uTime * 0.08)) * vnoise(vW * 2.4 - vec2(uTime * 0.07, uTime * 0.12) + 9.0);
  mi = smoothstep(0.12, 0.45, mi);
  float a = inside * rev;
  vec3 emit = uGlow * (halo * 0.6 + crack * 1.1) * pulse * flow + uCore * crack * 0.75 * pulse;
  emit += uGlow * pool * (0.1 + 0.12 * sl) + uMiasma * body * 0.7 + uGlow * ring * 0.55 + uCore * spec * 0.9 + uGlow * popR * 0.8;
  emit += uMiasma * mi * 0.2;
  vec3 col = ground * 0.95 * a + emit * a;
  // Toxic rim along the ragged outer boundary + a faint glow bleeding onto the neighbouring tile.
  float rim = exp(-sq2((dEdge - rag - 0.012) / 0.014)) * rev;
  float bleed = (1.0 - inside) * exp(-max(0.0, rag - dEdge) / 0.035) * 0.22 * smoothstep(0.0, 0.05, dEdge) * rev;
  col += uGlow * (rim * (0.5 + 0.4 * pulse) + bleed * (0.6 + 0.4 * mi));
  // Reveal front and the poison eruption at the centre while the square opens.
  float erupt = sin(3.14159 * open) * revealing;
  col += (uGlow * 1.4 + uCore * 0.8) * front * inside;
  col += (uGlow + uCore * 0.6) * exp(-dot(p, p) / 0.05) * erupt * 1.3;
  float alpha = 0.95 * a;
  if (alpha < 0.002 && dot(col, col) < 1e-5) discard;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

/** aA = neighbour mask (preview only), aB = kind (0 anchor, 1 preview). Premultiplied output. */
const GHOST_FS = /* glsl */ `
uniform float uTime;
uniform vec3 uAnchor;
uniform vec3 uPreview;
uniform float uInvalid;
uniform vec3 uCurseDark;
varying vec2 vUv;
varying vec2 vW;
varying float vA;
varying float vB;
${NOISE}
void main() {
  vec2 p = vUv - 0.5;
  float pulse = 0.5 + 0.5 * sin(uTime * 4.2);
  if (vB < 0.5) {
    // Anchor: a soft plum rounded-square inner frame + a faint darkening (reads on the grass
    // without washing it out).
    vec2 ap = abs(p);
    float d = length(max(ap - vec2(0.3), 0.0)) - 0.1;
    float frame = smoothstep(0.03, 0.012, abs(d + 0.02));
    float a = 0.035 + frame * (0.3 + 0.12 * pulse);
    gl_FragColor = vec4(uAnchor * a, a);
  } else {
    float dEdge = openEdge(p, vA);
    float line = smoothstep(0.045, 0.02, dEdge);
    float inner = exp(-dEdge / 0.12);
    vec2 q = vW * 2.4 + 0.42 * vec2(vnoise(vW * 3.7), vnoise(vW * 3.7 + 5.2));
    vec2 v = voronoi(q);
    float crack = 1.0 - smoothstep(0.01, 0.05, v.x);
    float pat = mix(crack, step(0.55, fract((vW.x + vW.y) * 3.2 - uTime * 0.6)) * 0.55, uInvalid);
    // Dark cursed-earth ghost (darkens the grass) with bright cracks and a glowing outline.
    float a = 0.5 + 0.1 * pulse;
    vec3 col = uCurseDark * a + uPreview * (pat * (0.6 + 0.35 * pulse) + inner * 0.12 + line * (0.95 + 0.4 * pulse));
    gl_FragColor = vec4(col, a);
  }
  #include <colorspace_fragment>
}`;

const BEAM_VS = /* glsl */ `
uniform vec3 uFrom;
uniform vec3 uCtrl;
uniform vec3 uTo;
uniform float uWidth;
uniform float uLift;
varying vec2 vUv;
void main() {
  float s = uv.x;
  float side = uv.y * 2.0 - 1.0;
  vec3 a = mix(uFrom, uCtrl, s);
  vec3 b = mix(uCtrl, uTo, s);
  vec3 P = mix(a, b, s);
  vec3 T = b - a;
  T = length(T) > 1e-5 ? normalize(T) : vec3(1.0, 0.0, 0.0);
  vec3 Nn = normalize(vec3(-T.z, 0.0, T.x));
  P.y += uLift * sin(3.14159 * s);
  vUv = vec2(s, side);
  gl_Position = projectionMatrix * viewMatrix * vec4(P + Nn * side * uWidth * 0.5, 1.0);
}`;

const BEAM_FS = /* glsl */ `
uniform float uHead;
uniform float uTail;
uniform float uT;
uniform vec3 uColor;
uniform vec3 uCore;
varying vec2 vUv;
${NOISE}
void main() {
  float s = vUv.x;
  float y = vUv.y;
  float vis = smoothstep(uTail, uTail + 0.18, s) * smoothstep(uHead + 0.02, uHead - 0.05, s);
  if (vis <= 0.0) discard;
  float j = (vnoise(vec2(s * 13.0 - uT * 9.0, uT * 3.0)) - 0.5) * 0.75 + (vnoise(vec2(s * 41.0 + uT * 15.0, 1.3)) - 0.5) * 0.3;
  float d = abs(y - j);
  float core = smoothstep(0.14, 0.0, d);
  float glow = exp(-d * d / 0.1);
  float j2 = (vnoise(vec2(s * 23.0 + 5.0 - uT * 12.0, uT * 2.0)) - 0.5) * 1.3;
  float arc2 = smoothstep(0.08, 0.0, abs(y - j2)) * 0.55;
  float blobs = pow(0.5 + 0.5 * sin(s * 26.0 - uT * 28.0), 6.0);
  float head = exp(-sq2((s - uHead) / 0.06));
  vec3 col = uColor * (glow * 0.75 + arc2 + blobs * glow * 0.7 + head * 1.4) + uCore * (core * 1.3 + head * glow);
  col *= vis * smoothstep(1.0, 0.6, abs(y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const RUNE_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RUNE_FS = /* glsl */ `
uniform float uK;
uniform float uRot;
uniform vec3 uColor;
uniform vec3 uCore;
uniform vec3 uCurse;
varying vec2 vUv;
float h1(float n) { return fract(sin(n * 91.7) * 43758.5453); }
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
void main() {
  float k = clamp(uK, 0.0, 1.0);
  float f = smoothstep(0.0, 0.14, k) * (1.0 - smoothstep(0.62, 1.0, k));
  float grow = 0.72 + 0.28 * (1.0 - pow(1.0 - min(1.0, k * 2.2), 3.0));
  vec2 p = (vUv - 0.5) * 2.0 / grow;
  float r = length(p);
  vec2 pr = rot(uRot) * p;
  float ring1 = smoothstep(0.03, 0.0, abs(r - 0.92));
  float ring2 = smoothstep(0.02, 0.0, abs(r - 0.74));
  float a = atan(pr.y, pr.x) / 6.2831853 + 0.5;
  float seg = fract(a * 20.0);
  float id = floor(a * 20.0);
  float glyph = step(abs(r - 0.83), 0.022 + 0.035 * h1(id)) * step(0.18, seg) * step(seg, 0.18 + 0.55 * h1(id + 7.0));
  vec2 pt = rot(-uRot * 1.6) * p;
  float hex = smoothstep(0.024, 0.0, abs(sdTri(pt, 0.62))) + smoothstep(0.024, 0.0, abs(sdTri(-pt, 0.62)));
  hex *= step(r, 0.76);
  float centre = exp(-r * r / 0.06);
  float disc = smoothstep(1.02, 0.6, r);
  vec3 col = uCurse * 0.3 * disc + uColor * (ring1 * 1.3 + ring2 * 1.1 + glyph * 1.0 + hex * 1.0 + centre * 0.5) + uCore * ring1 * 0.25;
  float alpha = 0.55 * disc;
  gl_FragColor = vec4(col * f, alpha * f);
  #include <colorspace_fragment>
}`;

/** Premultiplied alpha blending (dark ground + additive glow in one draw). */
const PREMUL = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
} as const;

/** Canvas skull danger mark (bone skull on a dark red disc with a red-green glow ring). */
export function makeSkullTexture(): THREE.CanvasTexture {
  const S = 128;
  const cvs = document.createElement('canvas');
  cvs.width = S;
  cvs.height = S;
  const g = cvs.getContext('2d');
  if (g) paintSkullMark(g, S / 2, S / 2, S / 2);
  const t = new THREE.CanvasTexture(cvs);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

/** Paint the deadly-target mark centred at (x, y), radius R (shared with the 2D board). */
export function paintSkullMark(g: CanvasRenderingContext2D, x: number, y: number, R: number): void {
  g.save();
  // Outer glow: green toxic haze into red.
  const halo = g.createRadialGradient(x, y, R * 0.35, x, y, R);
  halo.addColorStop(0, 'rgba(255,60,60,0.75)');
  halo.addColorStop(0.62, 'rgba(255,60,60,0.35)');
  halo.addColorStop(1, 'rgba(98,255,46,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(x, y, R, 0, Math.PI * 2);
  g.fill();
  // Disc + red danger ring.
  g.fillStyle = 'rgba(28,4,6,0.94)';
  g.beginPath();
  g.arc(x, y, R * 0.66, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = R * 0.1;
  g.strokeStyle = WASTE_COLORS.danger;
  g.stroke();
  // Skull.
  const s = R * 0.44;
  const bone = g.createLinearGradient(x, y - s, x, y + s);
  bone.addColorStop(0, '#FFFFF4');
  bone.addColorStop(1, '#D9D2B8');
  g.fillStyle = bone;
  g.beginPath();
  g.arc(x, y - s * 0.12, s * 0.82, Math.PI * 0.92, Math.PI * 2.08);
  g.lineTo(x + s * 0.5, y + s * 0.5);
  g.lineTo(x + s * 0.5, y + s * 0.82);
  g.lineTo(x - s * 0.5, y + s * 0.82);
  g.lineTo(x - s * 0.5, y + s * 0.5);
  g.closePath();
  g.fill();
  // Eye sockets with a toxic green glint, nose, teeth.
  g.fillStyle = '#1A0406';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(x + sx * s * 0.34, y - s * 0.08, s * 0.24, s * 0.27, sx * 0.25, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = WASTE_COLORS.glow;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(x + sx * s * 0.34, y - s * 0.06, s * 0.08, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#1A0406';
  g.beginPath();
  g.moveTo(x, y + s * 0.16);
  g.lineTo(x - s * 0.1, y + s * 0.36);
  g.lineTo(x + s * 0.1, y + s * 0.36);
  g.closePath();
  g.fill();
  g.lineWidth = Math.max(1, s * 0.08);
  g.strokeStyle = '#1A0406';
  for (const tx of [-0.22, 0, 0.22]) {
    g.beginPath();
    g.moveTo(x + tx * s, y + s * 0.56);
    g.lineTo(x + tx * s, y + s * 0.82);
    g.stroke();
  }
  g.restore();
}

/** Neighbour mask of square `sq` within `set` (1 = +c, 2 = -c, 4 = +r, 8 = -r). */
export function wasteMask(set: Set<number>, sq: number): number {
  const r = Math.floor(sq / BOARD_SIZE);
  const c = sq % BOARD_SIZE;
  let m = 0;
  if (c + 1 < BOARD_SIZE && set.has(sq + 1)) m |= 1;
  if (c - 1 >= 0 && set.has(sq - 1)) m |= 2;
  if (r + 1 < BOARD_SIZE && set.has(sq + BOARD_SIZE)) m |= 4;
  if (r - 1 >= 0 && set.has(sq - BOARD_SIZE)) m |= 8;
  return m;
}

const validSquare = (sq: number): boolean => Number.isInteger(sq) && sq >= 0 && sq < N;

interface CellLayer {
  mesh: THREE.InstancedMesh;
  a: THREE.InstancedBufferAttribute;
  b: THREE.InstancedBufferAttribute;
}

export class WasteFx {
  readonly group = new THREE.Group();
  readonly time = { value: 0 };
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly texs: THREE.Texture[] = [];
  private readonly waste: CellLayer;
  private readonly ghost: CellLayer;
  private readonly ghostMat: THREE.ShaderMaterial;
  private readonly marks: THREE.InstancedMesh;
  private readonly marksMat: THREE.MeshBasicMaterial;
  private readonly beam: THREE.Mesh;
  private readonly beamMat: THREE.ShaderMaterial;
  private readonly rune: THREE.Mesh;
  private readonly runeMat: THREE.ShaderMaterial;
  /** Wasteland squares in instance order, their set and the per-square reveal state (0..1). */
  private list: number[] = [];
  private readonly set = new Set<number>();
  private readonly open = new Float32Array(N).fill(1);
  private markList: number[] = [];
  private readonly y: number;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpS = new THREE.Vector3();

  constructor(y: number) {
    this.y = y;
    const uniforms = {
      uTime: this.time,
      uGround: { value: new THREE.Color(WASTE_COLORS.ground) },
      uGround2: { value: new THREE.Color(WASTE_COLORS.groundEdge) },
      uGlow: { value: new THREE.Color(WASTE_COLORS.glow) },
      uCore: { value: new THREE.Color(WASTE_COLORS.core) },
      uMiasma: { value: new THREE.Color(WASTE_COLORS.miasma) },
    };
    const wasteMat = this.mat(
      new THREE.ShaderMaterial({ uniforms, vertexShader: CELL_VS, fragmentShader: WASTE_FS, ...PREMUL, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    this.waste = this.cellLayer(wasteMat, 1);
    this.ghostMat = this.mat(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.time,
          uAnchor: { value: new THREE.Color(WASTE_COLORS.anchor) },
          uPreview: { value: new THREE.Color(WASTE_COLORS.ghost) },
          uInvalid: { value: 0 },
          uCurseDark: { value: new THREE.Color(WASTE_COLORS.ground) },
        },
        vertexShader: CELL_VS,
        fragmentShader: GHOST_FS,
        ...PREMUL,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.ghost = this.cellLayer(this.ghostMat, 2);
    this.ghost.mesh.position.y = 0.0015;

    const skull = makeSkullTexture();
    this.texs.push(skull);
    this.marksMat = this.mat(
      new THREE.MeshBasicMaterial({
        map: skull,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    const markGeo = this.geo(new THREE.PlaneGeometry(0.98, 0.98).rotateX(-Math.PI / 2));
    this.marks = new THREE.InstancedMesh(markGeo, this.marksMat, N);
    this.marks.count = 0;
    this.marks.renderOrder = 3;
    this.marks.frustumCulled = false;
    this.marks.raycast = () => undefined;
    this.marks.position.y = 0.003;

    this.beamMat = this.mat(
      new THREE.ShaderMaterial({
        uniforms: {
          uFrom: { value: new THREE.Vector3() },
          uCtrl: { value: new THREE.Vector3() },
          uTo: { value: new THREE.Vector3() },
          uWidth: { value: 0.62 },
          uLift: { value: 0.5 },
          uHead: { value: 0 },
          uTail: { value: 0 },
          uT: { value: 0 },
          uColor: { value: new THREE.Color(WASTE_COLORS.glow) },
          uCore: { value: new THREE.Color(WASTE_COLORS.core) },
        },
        vertexShader: BEAM_VS,
        fragmentShader: BEAM_FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.beam = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1, 1, 48, 1)), this.beamMat);
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 11;
    this.beam.raycast = () => undefined;

    this.runeMat = this.mat(
      new THREE.ShaderMaterial({
        uniforms: {
          uK: { value: 0 },
          uRot: { value: 0 },
          uColor: { value: new THREE.Color(WASTE_COLORS.glow) },
          uCore: { value: new THREE.Color(WASTE_COLORS.core) },
          uCurse: { value: new THREE.Color(WASTE_COLORS.curse) },
        },
        vertexShader: RUNE_VS,
        fragmentShader: RUNE_FS,
        ...PREMUL,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.rune = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), this.runeMat);
    this.rune.visible = false;
    this.rune.renderOrder = 3;
    this.rune.raycast = () => undefined;

    this.group.add(this.waste.mesh, this.ghost.mesh, this.marks, this.beam, this.rune);
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  /** Full-cell instanced quad layer with two per-instance floats (aA, aB). */
  private cellLayer(mat: THREE.Material, order: number): CellLayer {
    const geo = this.geo(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const a = new THREE.InstancedBufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage);
    const b = new THREE.InstancedBufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aA', a);
    geo.setAttribute('aB', b);
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.count = 0;
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.raycast = () => undefined;
    return { mesh, a, b };
  }

  private place(mesh: THREE.InstancedMesh, i: number, sq: number, scale = 1): void {
    const r = Math.floor(sq / BOARD_SIZE);
    const c = sq % BOARD_SIZE;
    this.tmpV.set(c - HALF, this.y, HALF - r);
    this.tmpS.set(scale, 1, scale);
    this.tmpM.compose(this.tmpV, this.tmpQ.identity(), this.tmpS);
    mesh.setMatrixAt(i, this.tmpM);
  }

  /** Persistent wasteland squares (full list). Squares new to the list appear fully open. */
  setWaste(squares: readonly number[]): void {
    const next = [...new Set(squares.filter(validSquare))].sort((x, y) => x - y);
    for (const sq of this.set) if (!next.includes(sq)) this.open[sq] = 1;
    this.set.clear();
    for (const sq of next) this.set.add(sq);
    this.list = next;
    const L = this.waste;
    for (let i = 0; i < next.length; i++) {
      const sq = next[i];
      this.place(L.mesh, i, sq);
      L.a.setX(i, wasteMask(this.set, sq));
      L.b.setX(i, this.open[sq]);
    }
    L.mesh.count = next.length;
    L.mesh.instanceMatrix.needsUpdate = true;
    L.a.needsUpdate = true;
    L.b.needsUpdate = true;
  }

  /** Add squares that will crack open (reveal 0) — used by the cast animation. */
  addClosed(squares: readonly number[]): void {
    const add = squares.filter((sq) => validSquare(sq) && !this.set.has(sq));
    for (const sq of add) this.open[sq] = 0;
    if (add.length > 0) this.setWaste([...this.list, ...add]);
  }

  /** Reveal progress (0..1) of one square. */
  setOpen(sq: number, k: number): void {
    if (!this.set.has(sq)) return;
    const v = Math.max(0, Math.min(1, k));
    if (this.open[sq] === v) return;
    this.open[sq] = v;
    const i = this.list.indexOf(sq);
    if (i >= 0) {
      this.waste.b.setX(i, v);
      this.waste.b.needsUpdate = true;
    }
  }

  has(sq: number): boolean {
    return this.set.has(sq);
  }

  /** Reveal of a square: 0 = not wasteland (or not cracked open yet) .. 1 = fully open. */
  openOf(sq: number): number {
    return this.set.has(sq) ? this.open[sq] : 0;
  }

  get squares(): readonly number[] {
    return this.list;
  }

  /** Skill targeting overlay (null clears). */
  setPreview(anchors: readonly number[] | null, preview: { squares: number[]; valid: boolean } | null): void {
    const G = this.ghost;
    let n = 0;
    const prev = new Set((preview?.squares ?? []).filter(validSquare));
    for (const sq of anchors ?? []) {
      if (!validSquare(sq) || prev.has(sq)) continue;
      this.place(G.mesh, n, sq);
      G.a.setX(n, 0);
      G.b.setX(n, 0);
      n++;
    }
    for (const sq of prev) {
      this.place(G.mesh, n, sq);
      G.a.setX(n, wasteMask(prev, sq));
      G.b.setX(n, 1);
      n++;
    }
    const valid = preview?.valid !== false;
    this.ghostMat.uniforms.uInvalid.value = valid ? 0 : 1;
    (this.ghostMat.uniforms.uPreview.value as THREE.Color).set(valid ? WASTE_COLORS.ghost : WASTE_COLORS.invalid);
    G.mesh.count = n;
    G.mesh.instanceMatrix.needsUpdate = true;
    G.a.needsUpdate = true;
    G.b.needsUpdate = true;
  }

  /** Skull danger marks on these squares. */
  setDeadly(squares: readonly number[]): void {
    this.markList = squares.filter(validSquare);
    this.placeMarks(1);
  }

  private placeMarks(scale: number): void {
    for (let i = 0; i < this.markList.length; i++) this.place(this.marks, i, this.markList[i], scale);
    this.marks.count = this.markList.length;
    this.marks.instanceMatrix.needsUpdate = true;
  }

  /** Green curse bolt along from -> ctrl -> to (world xz at height y; `lift` arcs it up mid-way). */
  beamShow(fx: number, fz: number, cx: number, cz: number, tx: number, tz: number, y: number, lift: number): void {
    const u = this.beamMat.uniforms;
    (u.uFrom.value as THREE.Vector3).set(fx, y, fz);
    (u.uCtrl.value as THREE.Vector3).set(cx, y, cz);
    (u.uTo.value as THREE.Vector3).set(tx, y, tz);
    u.uLift.value = lift;
    u.uHead.value = 0;
    u.uTail.value = 0;
    this.beam.visible = true;
  }

  /** Bolt progress: head / tail along the curve (0..1), `t` = seconds (flicker clock). */
  beamUpdate(head: number, tail: number, t: number): void {
    const u = this.beamMat.uniforms;
    u.uHead.value = head;
    u.uTail.value = tail;
    u.uT.value = t;
    if (tail >= 1) this.beam.visible = false;
  }

  /** Rune circle under a caster: world position, diameter, life progress k (0..1) and rotation. */
  runeShow(x: number, z: number, size: number): void {
    this.rune.position.set(x, this.y + 0.004, z);
    this.rune.scale.set(size, 1, size);
    this.runeMat.uniforms.uK.value = 0;
    this.rune.visible = true;
  }

  runeUpdate(k: number, rot: number): void {
    this.runeMat.uniforms.uK.value = k;
    this.runeMat.uniforms.uRot.value = rot;
    if (k >= 1) this.rune.visible = false;
  }

  /** Hide the one-shot cast effects and finish every pending reveal. */
  clearCast(): void {
    this.beam.visible = false;
    this.rune.visible = false;
    for (const sq of this.list) this.setOpen(sq, 1);
  }

  /** True while something on the board animates with the shared clock (waste / ghost / marks). */
  get animated(): boolean {
    return this.waste.mesh.count > 0 || this.ghost.mesh.count > 0 || this.marks.count > 0;
  }

  /** Advance the shared clock; `pulse` (0..1) breathes the danger marks. */
  update(timeSec: number, pulse: number): void {
    this.time.value = timeSec;
    if (this.markList.length > 0) {
      this.placeMarks(0.92 + 0.12 * pulse);
      this.marksMat.opacity = 0.82 + 0.18 * pulse;
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.waste.mesh.dispose();
    this.ghost.mesh.dispose();
    this.marks.dispose();
    this.group.clear();
  }
}
