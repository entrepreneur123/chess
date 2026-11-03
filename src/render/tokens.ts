/**
 * Rarity rings and illustrated top-down tokens of the 3D board.
 *
 *  - Rarity ring: a flat glowing ring on the ground around every unit. ONE ShaderMaterial per
 *    rarity, shared by all units: common = clean white, rare = orange glow, epic = purple glow,
 *    legendary = rainbow hue sweeping around the ring with a rotating shimmer (driven by the shared
 *    `time` uniform; the board only re-renders it at a light rate while a legendary is on screen).
 *  - Token: a thick, chunky board-game coin seen from above: its edge (team-deep, milled) shows
 *    below the top face, a navy keyline runs around the whole silhouette, the top face has a
 *    team-colour rim lit from the top-left (light top, deep bottom, a specular arc), an inset bevel
 *    ring, the character's face illustration (public/chars/<id>-lv<n>-face.jpg) and 1..3 gold star
 *    pips with navy outlines on the lower rim. One material per piece (it carries the per-piece
 *    cross-fade / hit flash / dissolve uniforms) over a face texture shared per (character, level)
 *    and loaded lazily (sRGB, mipmaps, anisotropy).
 */
import * as THREE from 'three';
import type { CharacterId, Level, PlayerId, Rarity } from '../engine/types';
import { faceUrl } from './common';
import { BOARD_COLORS, RARITY_RING, TEAM_COLORS } from './palette';

/** Ring radius (world units, centre of the band) and the half width of the solid band. */
export const RING_RADIUS = 0.452;
const RING_HALF = 0.026;
/** Quad half size of the ring decal (band + glow). */
export const RING_QUAD = 0.62;

const RING_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RING_FS = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uGlowAmt;
uniform float uTime;
uniform float uRainbow;
varying vec2 vUv;
vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p) * ${RING_QUAD.toFixed(3)};
  float d = abs(r - ${RING_RADIUS.toFixed(3)});
  float aa = fwidth(r) * 1.2;
  float band = 1.0 - smoothstep(${RING_HALF.toFixed(3)} - aa, ${RING_HALF.toFixed(3)} + aa, d);
  float glow = exp(-pow(max(0.0, r - ${(RING_RADIUS + RING_HALF).toFixed(3)}) / 0.05, 2.0)) * uGlowAmt * step(${RING_RADIUS.toFixed(3)}, r);
  // Navy keylines on both sides of the band so every ring (even white) reads on the grass.
  float kd = abs(d - ${RING_HALF.toFixed(3)} - 0.006);
  float key = (1.0 - smoothstep(0.007, 0.007 + aa, kd)) * 0.8;
  vec3 core = uCore;
  vec3 g = uGlow;
  if (uRainbow > 0.5) {
    float a = atan(p.y, p.x) / 6.2831853;
    vec3 h = hue(fract(a - uTime * 0.22));
    core = mix(h, vec3(1.0), 0.28);
    g = h;
    float sh = pow(0.5 + 0.5 * cos((a + uTime * 0.45) * 6.2831853), 14.0);
    core += vec3(sh * 0.8);
    glow *= 0.85 + 0.3 * sh;
  }
  float aCore = band;
  // Keyline colour: navy-ink #1b2445 (linear).
  vec3 navy = vec3(0.0110, 0.0176, 0.0595);
  float aKey = key * (1.0 - band);
  vec3 col = core * aCore + navy * aKey + g * glow * (1.0 - aCore) * (1.0 - aKey);
  float alpha = max(aCore, aKey);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

/** Shared rarity ring materials (premultiplied: solid band + additive glow). */
export class RingMaterials {
  readonly time = { value: 0 };
  readonly geometry = new THREE.PlaneGeometry(RING_QUAD * 2, RING_QUAD * 2).rotateX(-Math.PI / 2);
  private readonly mats = new Map<Rarity, THREE.ShaderMaterial>();

  get(r: Rarity): THREE.ShaderMaterial {
    let m = this.mats.get(r);
    if (!m) {
      const look = RARITY_RING[r];
      m = new THREE.ShaderMaterial({
        uniforms: {
          uCore: { value: new THREE.Color(look.core) },
          uGlow: { value: new THREE.Color(look.glow) },
          uGlowAmt: { value: look.glowAmt },
          uRainbow: { value: look.rainbow ? 1 : 0 },
          uTime: this.time,
        },
        vertexShader: RING_VS,
        fragmentShader: RING_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        polygonOffset: true,
        polygonOffsetFactor: -1.5,
        polygonOffsetUnits: -1.5,
      });
      this.mats.set(r, m);
    }
    return m;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}

const TOKEN_VS = RING_VS;

/** Coin geometry (world units, top-down quad space, +y = screen up). */
const COIN_R = 0.385;
/** Top face centre (lifted) and the edge's lowest disc centre: the coin's thickness on screen. */
const COIN_TOP_Y = 0.024;
const COIN_EDGE_Y = -0.046;
const COIN_KEY = 0.022;
const g3 = (x: number): string => x.toFixed(4);

const TOKEN_FS = /* glsl */ `
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3 uTeam;
uniform vec3 uTeamLight;
uniform vec3 uTeamDark;
uniform vec3 uGold;
uniform float uLevel;
uniform float uOpacity;
uniform float uFlash;
uniform float uDissolve;
uniform vec3 uEdge;
varying vec2 vUv;
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // Quad space in world units (1 x 1 quad), +y = screen up.
  vec2 q = vUv - 0.5;
  float aa = fwidth(q.x) * 1.1;
  // Silhouette: the top disc swept down to the edge disc (a vertical capsule), plus a keyline.
  vec2 qs = vec2(q.x, q.y - clamp(q.y, ${g3(COIN_EDGE_Y)}, ${g3(COIN_TOP_Y)}));
  float dSil = length(qs) - ${g3(COIN_R)};
  float cover = 1.0 - smoothstep(${g3(COIN_KEY)} - aa, ${g3(COIN_KEY)} + aa, dSil);
  if (cover <= 0.0) discard;
  vec2 pt = (q - vec2(0.0, ${g3(COIN_TOP_Y)})) / ${g3(COIN_R)};
  float r = length(pt);
  float ar = aa / ${g3(COIN_R)};
  vec3 navy = vec3(0.0110, 0.0176, 0.0595);
  // Coin edge (thickness): deep team colour, darker toward the bottom, fine milling.
  float mill = 0.92 + 0.08 * sin(asin(clamp(q.x / ${g3(COIN_R)}, -1.0, 1.0)) * 34.0);
  float ey = clamp((q.y - ${g3(COIN_EDGE_Y - COIN_R)}) / ${g3(COIN_TOP_Y - COIN_EDGE_Y + 0.12)}, 0.0, 1.0);
  vec3 edge = mix(uTeamDark * 0.55, uTeamDark * 1.05, ey) * mill;
  vec3 col = edge;
  // Top face.
  float inTop = 1.0 - smoothstep(1.0 - ar, 1.0 + ar, r);
  vec2 dir = pt / max(r, 1e-4);
  float lit = clamp(0.5 + 0.5 * dot(dir, normalize(vec2(-0.55, 0.83))), 0.0, 1.0);
  // Face illustration (or a team-tinted placeholder while it loads).
  vec3 face;
  if (uHasMap > 0.5) {
    face = texture2D(uMap, pt * 0.5 * 0.8 + vec2(0.5, 0.49)).rgb;
  } else {
    face = mix(uTeamDark * 0.6, uTeamDark * 0.18, smoothstep(0.0, 0.85, length(pt - vec2(0.0, 0.15))));
  }
  // Inset shading: the rim casts a soft shadow onto the top-left of the face.
  face *= 1.0 - 0.45 * smoothstep(0.56, 0.78, r) * (0.35 + 0.65 * lit);
  vec3 top = face;
  // Inset bevel ring (dark where the light can't reach, light on the lower right).
  vec3 bevel = mix(mix(uTeamLight, vec3(1.0), 0.25), navy * 2.0, lit);
  top = mix(top, bevel, smoothstep(0.775 - ar, 0.775 + ar, r));
  // Team rim, lit from the top-left: light top, main, deep bottom + a specular arc.
  vec3 rim = mix(uTeamDark, uTeam, smoothstep(0.1, 0.55, lit));
  rim = mix(rim, uTeamLight, smoothstep(0.6, 0.95, lit));
  float arc = smoothstep(0.035, 0.0, abs(r - 0.915)) * smoothstep(0.8, 0.98, lit);
  rim += vec3(0.75) * arc;
  top = mix(top, rim, smoothstep(0.815 - ar, 0.815 + ar, r));
  // Level stars on the lower rim (navy outline, gold with a light top).
  for (int i = 0; i < 3; i++) {
    if (float(i) >= uLevel) break;
    float a = -1.5708 + (float(i) - (uLevel - 1.0) * 0.5) * 0.42;
    vec2 c = vec2(cos(a), sin(a)) * 0.895;
    float d = sdStar5(pt - c, 0.14, 0.5);
    top = mix(top, navy, 1.0 - smoothstep(-ar, ar, d - 0.045));
    vec3 gcol = mix(uGold * vec3(0.95, 0.62, 0.2), mix(uGold, vec3(1.0, 0.98, 0.85), 0.5), clamp((pt.y - c.y) * 5.0 + 0.5, 0.0, 1.0));
    top = mix(top, gcol, 1.0 - smoothstep(-ar, ar, d));
  }
  col = mix(col, top, inTop);
  // Navy keyline around the whole coin (outside the silhouette).
  col = mix(navy, col, 1.0 - smoothstep(-aa, aa, dSil));
  col = mix(col, vec3(1.0), uFlash);
  float alpha = uOpacity * cover;
  if (uDissolve > 0.0) {
    float n = vnoise(pt * 4.0 + 3.0) * 0.65 + vnoise(pt * 11.0) * 0.35;
    float th = uDissolve * 1.12 - 0.04;
    if (n < th) discard;
    float e2 = 1.0 - smoothstep(0.0, 0.09, n - th);
    col += uEdge * e2 * 2.2;
  }
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

interface FaceSlot {
  map: { value: THREE.Texture | null };
  has: { value: number };
  requested: boolean;
  /** Time of the last failed load (a missing face keeps the team placeholder; retried later). */
  failedAt: number;
}

/** Wait before retrying a face that failed to load (missing file / offline). */
const FACE_RETRY_MS = 15_000;

/** Token geometry/materials + lazily loaded face textures (one set per BoardView). */
export class TokenKit {
  /** Coin quad lying flat (uv up = world -z = screen up in the top-down view); the shader cuts it. */
  readonly geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly faces = new Map<string, FaceSlot>();
  private readonly textures: THREE.Texture[] = [];
  private readonly loader = new THREE.TextureLoader();
  private readonly anisotropy: number;
  private readonly onLoad: () => void;
  private readonly gold = new THREE.Color(BOARD_COLORS.pip);
  private disposed = false;

  constructor(maxAnisotropy: number, onLoad: () => void) {
    this.anisotropy = Math.max(1, Math.min(4, maxAnisotropy));
    this.onLoad = onLoad;
  }

  private slot(character: CharacterId, level: Level): FaceSlot {
    const key = `${character}:${level}`;
    let s = this.faces.get(key);
    if (!s) {
      s = { map: { value: null }, has: { value: 0 }, requested: false, failedAt: -Infinity };
      this.faces.set(key, s);
    }
    return s;
  }

  /** Start loading a face texture (no-op if already requested). */
  load(character: CharacterId, level: Level): void {
    const s = this.slot(character, level);
    if (s.requested || this.disposed || performance.now() - s.failedAt < FACE_RETRY_MS) return;
    s.requested = true;
    this.loader.load(
      faceUrl(character, level),
      (tex) => {
        if (this.disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.anisotropy;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        this.textures.push(tex);
        s.map.value = tex;
        s.has.value = 1;
        this.onLoad();
      },
      undefined,
      () => {
        // Keep the team placeholder; a later piece / view switch retries after FACE_RETRY_MS.
        s.requested = false;
        s.failedAt = performance.now();
      },
    );
  }

  /** New per-piece token material (dispose it with the piece). */
  material(character: CharacterId, level: Level, owner: PlayerId): THREE.ShaderMaterial {
    const s = this.slot(character, level);
    const t = TEAM_COLORS[owner];
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: s.map,
        uHasMap: s.has,
        uTeam: { value: new THREE.Color(t.main) },
        uTeamLight: { value: new THREE.Color(t.light) },
        uTeamDark: { value: new THREE.Color(t.dark) },
        uGold: { value: this.gold },
        uLevel: { value: level },
        uOpacity: { value: 1 },
        uFlash: { value: 0 },
        uDissolve: { value: 0 },
        uEdge: { value: new THREE.Color(t.glow) },
      },
      vertexShader: TOKEN_VS,
      fragmentShader: TOKEN_FS,
      transparent: true,
      depthWrite: false,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.geometry.dispose();
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
    this.faces.clear();
  }
}
