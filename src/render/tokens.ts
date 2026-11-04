/**
 * Rarity rings and illustrated top-down tokens of the 3D board.
 *
 *  - Rarity ring: a flat glowing ring on the ground around every unit. ONE ShaderMaterial per
 *    rarity, shared by all units: common = clean white, rare = orange glow, epic = purple glow,
 *    legendary = rainbow hue sweeping around the ring with a rotating shimmer (driven by the shared
 *    `time` uniform; the board only re-renders it at a light rate while a legendary is on screen).
 *  - Token: a thick, chunky board-game coin seen from above: its edge (team-deep, milled) shows
 *    below the top face, a dark ink keyline runs around the whole silhouette, the top face has a
 *    team-colour rim lit from the top-left (light top, deep bottom, a specular arc), an inset bevel
 *    ring, the character's face illustration (public/chars/<id>-lv<n>-face.jpg) and 1..3 gold star
 *    pips with ink outlines on the lower rim. One material per piece (it carries the per-piece
 *    cross-fade / hit flash / dissolve uniforms) over a face texture shared per (character, level)
 *    and loaded lazily (sRGB, mipmaps, anisotropy).
 *  - Rakaeli's "타천" (awakenFx.ts): his coins also carry the transformed face slot
 *    (public/chars/rakaeli-awake-lv<n>-face.jpg). `uAwake` cross-fades to it; while it is loading or
 *    missing the base face is tinted crimson instead. `uBurn` draws the blindfold-burn band.
 */
import * as THREE from 'three';
import type { CharacterId, Level, PlayerId, Rarity } from '../engine/types';
import { faceUrl } from './common';
import { AWAKE_TINT, awakeFaceUrl, isRakaeli } from './awakenFx';
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
  // Soft glow around the band (the inner half is mostly under the coin) on the dark tiles.
  float glow = exp(-pow(max(0.0, d - ${RING_HALF.toFixed(3)}) / 0.05, 2.0)) * uGlowAmt * 0.85;
  // Thin dark keyline just inside the band (separates it from the coin's edge).
  float key = (1.0 - smoothstep(0.006, 0.006 + aa, abs(r - ${(RING_RADIUS - RING_HALF - 0.006).toFixed(3)}))) * 0.6;
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
  // Keyline colour: night-0 #070a12 (linear).
  vec3 ink = vec3(0.0021, 0.0030, 0.0060);
  float aKey = key * (1.0 - band);
  vec3 col = core * aCore + ink * aKey + g * glow * (1.0 - aCore) * (1.0 - aKey);
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
uniform sampler2D uAwakeMap;
uniform float uHasAwake;
uniform float uAwake;
uniform float uBurn;
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
  // Ink keyline: panel-lip #090d17 (linear).
  vec3 ink = vec3(0.0027, 0.0040, 0.0085);
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
  // Rakaeli transformed: cross-fade to the awake art, or tint the base face crimson without it.
  if (uAwake > 0.001) {
    vec3 aw;
    if (uHasAwake > 0.5) {
      aw = texture2D(uAwakeMap, pt * 0.5 * 0.8 + vec2(0.5, 0.49)).rgb;
    } else {
      float l = dot(face, vec3(0.2126, 0.7152, 0.0722));
      aw = mix(face * vec3(${g3(AWAKE_TINT[0])}, ${g3(AWAKE_TINT[1])}, ${g3(AWAKE_TINT[2])}), vec3(l * 1.25, l * 0.06, l * 0.1), 0.55) + vec3(0.03, 0.0, 0.012);
    }
    face = mix(face, aw, clamp(uAwake, 0.0, 1.0));
  }
  // Blindfold burning away: a white-hot band across the eyes, its crimson edge racing outward.
  if (uBurn > 0.0) {
    float bw = uBurn * 1.15;
    float by = abs(pt.y - 0.14);
    float band = (1.0 - smoothstep(0.09, 0.15, by)) * (1.0 - smoothstep(bw - 0.1, bw, abs(pt.x)));
    float bedge = band * smoothstep(bw - 0.32, bw - 0.03, abs(pt.x));
    float bfade = 1.0 - smoothstep(0.65, 1.0, uBurn);
    face = mix(face, vec3(1.0, 0.86, 0.72), band * 0.6 * bfade) + vec3(1.0, 0.16, 0.06) * bedge * 1.6 * bfade;
  }
  // Inset shading: the rim casts a soft shadow onto the top-left of the face.
  face *= 1.0 - 0.45 * smoothstep(0.56, 0.78, r) * (0.35 + 0.65 * lit);
  vec3 top = face;
  // Inset bevel ring (dark where the light can't reach, light on the lower right).
  vec3 bevel = mix(mix(uTeamLight, vec3(1.0), 0.25), ink * 2.0, lit);
  top = mix(top, bevel, smoothstep(0.775 - ar, 0.775 + ar, r));
  // Team rim, lit from the top-left: light top, main, deep bottom + a specular arc.
  vec3 rim = mix(uTeamDark, uTeam, smoothstep(0.1, 0.55, lit));
  rim = mix(rim, uTeamLight, smoothstep(0.6, 0.95, lit));
  float arc = smoothstep(0.035, 0.0, abs(r - 0.915)) * smoothstep(0.8, 0.98, lit);
  rim += vec3(0.75) * arc;
  top = mix(top, rim, smoothstep(0.815 - ar, 0.815 + ar, r));
  // Level stars on the lower rim (ink outline, gold with a light top).
  for (int i = 0; i < 3; i++) {
    if (float(i) >= uLevel) break;
    float a = -1.5708 + (float(i) - (uLevel - 1.0) * 0.5) * 0.42;
    vec2 c = vec2(cos(a), sin(a)) * 0.895;
    float d = sdStar5(pt - c, 0.14, 0.5);
    top = mix(top, ink, 1.0 - smoothstep(-ar, ar, d - 0.045));
    vec3 gcol = mix(uGold * vec3(0.95, 0.62, 0.2), mix(uGold, vec3(1.0, 0.98, 0.85), 0.5), clamp((pt.y - c.y) * 5.0 + 0.5, 0.0, 1.0));
    top = mix(top, gcol, 1.0 - smoothstep(-ar, ar, d));
  }
  col = mix(col, top, inTop);
  // Ink keyline around the whole coin (outside the silhouette).
  col = mix(ink, col, 1.0 - smoothstep(-aa, aa, dSil));
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
  /** Shared "no awake art" uniforms of every non-Rakaeli coin. */
  private readonly noAwake: Pick<FaceSlot, 'map' | 'has'> = { map: { value: null }, has: { value: 0 } };
  private disposed = false;

  constructor(maxAnisotropy: number, onLoad: () => void) {
    this.anisotropy = Math.max(1, Math.min(4, maxAnisotropy));
    this.onLoad = onLoad;
  }

  private slot(character: CharacterId, level: Level, awake = false): FaceSlot {
    const key = `${character}${awake ? '-awake' : ''}:${level}`;
    let s = this.faces.get(key);
    if (!s) {
      s = { map: { value: null }, has: { value: 0 }, requested: false, failedAt: -Infinity };
      this.faces.set(key, s);
    }
    return s;
  }

  /** Start loading a face texture (no-op if already requested). */
  load(character: CharacterId, level: Level): void {
    this.request(this.slot(character, level), faceUrl(character, level));
  }

  /** Start loading Rakaeli's transformed face (preloaded with his base face, so the swap is ready). */
  loadAwake(character: CharacterId, level: Level): void {
    if (isRakaeli({ character })) this.request(this.slot(character, level, true), awakeFaceUrl(level));
  }

  /** True once Rakaeli's transformed face of `level` is on the GPU (else the crimson tint shows). */
  hasAwake(character: CharacterId, level: Level): boolean {
    return this.faces.get(`${character}-awake:${level}`)?.has.value === 1;
  }

  private request(s: FaceSlot, url: string): void {
    if (s.requested || this.disposed || performance.now() - s.failedAt < FACE_RETRY_MS) return;
    s.requested = true;
    this.loader.load(
      url,
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
    const aw = isRakaeli({ character }) ? this.slot(character, level, true) : this.noAwake;
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
        uAwakeMap: aw.map,
        uHasAwake: aw.has,
        uAwake: { value: 0 },
        uBurn: { value: 0 },
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
