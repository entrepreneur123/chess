/**
 * Rarity rings and illustrated top-down tokens of the 3D board.
 *
 *  - Rarity ring: a flat glowing ring on the ground around every unit. ONE ShaderMaterial per
 *    rarity, shared by all units: common = clean white, rare = orange glow, epic = purple glow,
 *    legendary = rainbow hue sweeping around the ring with a rotating shimmer (driven by the shared
 *    `time` uniform; the board only re-renders it at a light rate while a legendary is on screen).
 *  - Token: round board-game coin lying on the puck, showing the character's face illustration
 *    (public/chars/<id>-lv<n>-face.jpg) inside a team-coloured rim with 1..3 gold star pips. One
 *    material per piece (it carries the per-piece cross-fade / hit flash / dissolve uniforms) over a
 *    face texture shared per (character, level) and loaded lazily (sRGB, mipmaps, anisotropy).
 */
import * as THREE from 'three';
import type { CharacterId, Level, PlayerId, Rarity } from '../engine/types';
import { faceUrl } from './common';
import { BOARD_COLORS, RARITY_RING, TEAM_COLORS } from './palette';

/** Ring radius (world units, centre of the band) and the half width of the solid band. */
export const RING_RADIUS = 0.447;
const RING_HALF = 0.024;
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
  float glow = exp(-pow(d / 0.075, 2.0)) * uGlowAmt;
  // Thin dark keyline just inside the band so a white ring still reads on light tiles.
  float key = (1.0 - smoothstep(0.006, 0.006 + aa, abs(r - (${(RING_RADIUS - RING_HALF - 0.008).toFixed(3)})))) * 0.55;
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
  float aCore = band * 0.96;
  vec3 col = core * aCore + g * glow * (1.0 - aCore);
  float alpha = max(aCore, key * (1.0 - band));
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
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float aa = fwidth(r) * 1.25;
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  if (disc <= 0.0) discard;
  // Face illustration (or a team-tinted placeholder while it loads), vignetted toward the rim.
  vec3 face;
  if (uHasMap > 0.5) {
    face = texture2D(uMap, p * 0.5 * 0.86 + vec2(0.5, 0.52)).rgb;
  } else {
    face = mix(uTeamDark * 0.55, vec3(0.02, 0.025, 0.05), smoothstep(0.0, 0.85, length(p - vec2(0.0, 0.15))));
  }
  face *= 1.0 - 0.38 * smoothstep(0.5, 0.8, r);
  vec3 col = face;
  // Dark bevel, team rim (lit from the top-left), outer dark edge.
  col = mix(col, vec3(0.012, 0.016, 0.035), smoothstep(0.775 - aa, 0.775 + aa, r));
  float lit = clamp(0.5 + 0.5 * dot(normalize(p + 1e-5), normalize(vec2(-0.55, 0.83))), 0.0, 1.0);
  vec3 rim = mix(uTeamDark, mix(uTeam, uTeamLight, 0.55), lit);
  float spec = pow(lit, 10.0) * 0.7;
  float band = smoothstep(0.815 - aa, 0.815 + aa, r);
  col = mix(col, rim + spec, band);
  col = mix(col, uTeamDark * 0.35, smoothstep(0.955 - aa, 0.955 + aa, r));
  // Level stars on the lower rim.
  for (int i = 0; i < 3; i++) {
    if (float(i) >= uLevel) break;
    float a = -1.5708 + (float(i) - (uLevel - 1.0) * 0.5) * 0.43;
    vec2 c = vec2(cos(a), sin(a)) * 0.8;
    float d = sdStar5(p - c, 0.135, 0.5);
    col = mix(col, vec3(0.03, 0.02, 0.0), 1.0 - smoothstep(-aa, aa, d - 0.035));
    vec3 g = mix(uGold, vec3(1.0, 0.97, 0.85), clamp((p.y - c.y) * 5.0 + 0.4, 0.0, 1.0));
    col = mix(col, g, 1.0 - smoothstep(-aa, aa, d));
  }
  col = mix(col, vec3(1.0), uFlash);
  float alpha = uOpacity * disc;
  if (uDissolve > 0.0) {
    float n = vnoise(p * 4.0 + 3.0) * 0.65 + vnoise(p * 11.0) * 0.35;
    float th = uDissolve * 1.12 - 0.04;
    if (n < th) discard;
    float edge = 1.0 - smoothstep(0.0, 0.09, n - th);
    col += uEdge * edge * 2.2;
  }
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

interface FaceSlot {
  map: { value: THREE.Texture | null };
  has: { value: number };
  requested: boolean;
}

/** Token geometry/materials + lazily loaded face textures (one set per BoardView). */
export class TokenKit {
  /** Coin face: a disc lying flat (uv up = world -z = screen up in the top-down view). */
  readonly geometry = new THREE.CircleGeometry(0.41, 56).rotateX(-Math.PI / 2);
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
      s = { map: { value: null }, has: { value: 0 }, requested: false };
      this.faces.set(key, s);
    }
    return s;
  }

  /** Start loading a face texture (no-op if already requested). */
  load(character: CharacterId, level: Level): void {
    const s = this.slot(character, level);
    if (s.requested || this.disposed) return;
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
        s.requested = false; // keep the placeholder; a later view switch retries
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
