/**
 * Unit material: one MeshStandardMaterial per (character, level, team) template; the whole unit
 * (textured body + procedural armour, weapons and trims) is ONE skinned draw call. Per-vertex data:
 *   uv     (vec2)  body texture coordinates (atlas; ignored by flat parts)
 *   color  (vec3)  albedo multiplier (flat colour, texture tint or shade of a team tone)
 *   aFx    (vec4)  x = emissive glow, y = metal (0..1), z = pattern id, w = colour mode
 * Colour modes: 0 flat colour, 1 texture x colour, 2 texture luminance x colour (recolour),
 *               3..7 team tone (main, light, dark, muted, deep) x colour.
 * The team tones are uniforms, so the geometry is shared by both teams.
 * Patterns: 0 none, 1 chain mail rings, 2 lava / rune cracks (emissive cellular), 3 travelling rune
 * bands, 4 flame flicker, 5 plate lames (horizontal grooves), 6 quilted diamonds, 7 filigree
 * (engraved glowing lines).
 * Texture alpha is (1 - emissive mask): glowing eyes of the imp, tinted by `eyeColor`.
 *
 * Cheap "metal" without an environment map: lower roughness + a view-space sky/ground gradient
 * reflection added as emission, so polished gear reads as metal under the board's lights.
 * Shared uniforms (time, spawn flash) come from the owning library; the dying variant adds a
 * noise dissolve with a hot edge.
 */
import * as THREE from 'three';

export interface UnitUniforms {
  /** Seconds (drives pulses, lava, runes, flames). */
  time: { value: number };
  /** Spawn flash 0..1 (all units of the view). */
  spawn: { value: number };
  /** Drawing-buffer px per world unit at distance 1 (point sprites). */
  pointScale: { value: number };
}

export const PATTERN = { none: 0, chain: 1, lava: 2, rune: 3, flame: 4, lames: 5, quilt: 6, filigree: 7 } as const;
/** Colour modes (aFx.w). */
export const MODE = { flat: 0, tex: 1, lum: 2, team: 3 } as const;

export interface UnitMaterialOptions {
  rim: string;
  rimStrength: number;
  glowColor: string;
  /** Pulse the glow (legendary units). */
  pulse: boolean;
  /** Colour of the lava/rune/flame patterns. */
  patternColor: string;
  /** Team tones: main, light, dark, muted, deep (sRGB hex). */
  team: [string, string, string, string, string];
  /** Emissive colour of the texture's emissive mask (eyes). */
  eyeColor: string;
  /** Replace green texture areas (outfit cloth) by the team colour (0..1). */
  teamKey: number;
  map: THREE.Texture | null;
  /** Death dissolve variant (own uniforms `dissolve`, `edge`). */
  dissolve?: boolean;
  /** Bind-space -> pattern-space scale (normalises the model to ~2.4 units tall). */
  patScale: number;
}

export interface DissolveUniforms {
  dissolve: { value: number };
  edge: { value: THREE.Color };
}

const NOISE = /* glsl */ `
float uHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float uNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(uHash(i), uHash(i + vec3(1,0,0)), f.x), mix(uHash(i + vec3(0,1,0)), uHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(uHash(i + vec3(0,0,1)), uHash(i + vec3(1,0,1)), f.x), mix(uHash(i + vec3(0,1,1)), uHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Cellular edge distance (F2 - F1), 3x3x3 search.
float uCells(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  float f1 = 8.0; float f2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(uHash(i + g), uHash(i + g + 17.1), uHash(i + g + 31.7));
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  return sqrt(f2) - sqrt(f1);
}`;

export function makeUnitMaterial(
  u: UnitUniforms,
  opts: UnitMaterialOptions,
  dissolve?: DissolveUniforms,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  if (opts.map) mat.map = opts.map;
  const rim = new THREE.Color(opts.rim);
  const glowColor = new THREE.Color(opts.glowColor);
  const patColor = new THREE.Color(opts.patternColor);
  const eyeColor = new THREE.Color(opts.eyeColor);
  const tones = opts.team.map((c) => new THREE.Color(c));
  const pulse = opts.pulse ? 1 : 0;
  const dis = !!opts.dissolve && !!dissolve;
  const hasMap = !!opts.map;
  if (dis) {
    mat.transparent = true;
    mat.depthWrite = true;
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uGlowColor = { value: glowColor };
    shader.uniforms.uPatColor = { value: patColor };
    shader.uniforms.uEyeColor = { value: eyeColor };
    shader.uniforms.uTeam = { value: tones };
    shader.uniforms.uTeamKey = { value: opts.teamKey };
    shader.uniforms.uTime = u.time;
    shader.uniforms.uSpawn = u.spawn;
    shader.uniforms.uPatScale = { value: opts.patScale };
    if (dis && dissolve) {
      shader.uniforms.uDissolve = dissolve.dissolve;
      shader.uniforms.uEdge = dissolve.edge;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFx;\nuniform float uPatScale;\nvarying vec4 vFx;\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFx = aFx;\nvBind = position * uPatScale;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uRim; uniform vec3 uGlowColor; uniform vec3 uPatColor; uniform vec3 uEyeColor; uniform float uTime; uniform float uSpawn;
uniform vec3 uTeam[5]; uniform float uTeamKey;
${dis ? 'uniform float uDissolve; uniform vec3 uEdge;' : ''}
varying vec4 vFx; varying vec3 vBind;
${NOISE}`,
      )
      .replace(
        '#include <map_fragment>',
        `float mode = floor(vFx.w + 0.5);
float eyeMask = 0.0;
${
  hasMap
    ? `if (mode > 0.5 && mode < 2.5) {
  vec4 texel = texture2D(map, vMapUv);
  eyeMask = 1.0 - texel.a;
  float lumT = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
  vec3 tc = mode < 1.5 ? texel.rgb : vec3(lumT * 2.4);
  if (uTeamKey > 0.0 && mode < 1.5) {
    // Outfit cloth: green areas become the team colour (keeps the painted shading).
    float green = smoothstep(0.012, 0.06, texel.g - max(texel.r, texel.b));
    tc = mix(tc, uTeam[0] * clamp(lumT * 4.2, 0.25, 1.6), green * uTeamKey);
  }
  diffuseColor.rgb *= tc;
}`
    : ''
}
if (mode > 2.5) {
  int ti = int(mode - 3.0);
  vec3 tone = ti == 0 ? uTeam[0] : ti == 1 ? uTeam[1] : ti == 2 ? uTeam[2] : ti == 3 ? uTeam[3] : uTeam[4];
  diffuseColor.rgb *= tone;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float pat = floor(vFx.z + 0.5);
float patGlow = 0.0;
if (pat == 1.0) {
  // Chain mail: staggered rings (dark gaps) in bind space.
  vec2 q = vec2(vBind.x + vBind.z, vBind.y * 1.6) * 30.0;
  q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
  float d = length(fract(q) - 0.5);
  float ring = smoothstep(0.2, 0.32, d) * (1.0 - smoothstep(0.38, 0.5, d));
  diffuseColor.rgb *= 0.4 + 0.8 * ring;
} else if (pat == 2.0) {
  // Lava / rune cracks: cellular edges glow, crust darkens around them.
  float c = uCells(vBind * 6.5 + vec3(0.0, uTime * 0.12, 0.0));
  float crack = 1.0 - smoothstep(0.03, 0.12, c);
  float heat = 0.7 + 0.3 * sin(uTime * 2.3 + vBind.z * 3.0 + vBind.y * 2.0);
  diffuseColor.rgb *= 1.0 - 0.6 * crack;
  patGlow = crack * heat;
} else if (pat == 3.0) {
  // Rune bands travelling along the blade / plate.
  float b = 0.55 + 0.45 * sin(vBind.y * 14.0 + vBind.z * 14.0 - uTime * 3.0);
  patGlow = b;
} else if (pat == 4.0) {
  float n = uNoise(vBind * 6.0 + vec3(0.0, -uTime * 3.5, 0.0));
  patGlow = 0.65 + 0.7 * n;
} else if (pat == 5.0) {
  // Plate lames: horizontal grooves with a bright lip.
  float f = fract(vBind.y * 7.0);
  diffuseColor.rgb *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.07, f)) + 0.18 * smoothstep(0.08, 0.16, f) * (1.0 - smoothstep(0.16, 0.3, f));
} else if (pat == 6.0) {
  // Quilted padding: diamond seams.
  vec2 q = vec2(vBind.x + vBind.z * 0.7 + vBind.y, vBind.x + vBind.z * 0.7 - vBind.y) * 9.0;
  vec2 f = abs(fract(q) - 0.5);
  float seam = 1.0 - smoothstep(0.0, 0.08, min(0.5 - f.x, 0.5 - f.y));
  diffuseColor.rgb *= 1.0 - 0.45 * seam;
} else if (pat == 7.0) {
  // Filigree: thin engraved lines that catch the glow colour.
  // Filigree: flowing engraved scroll lines.
  float w = vBind.y * 16.0 + sin(vBind.x * 13.0 + vBind.z * 9.0) * 1.6 + sin(vBind.z * 21.0) * 0.4;
  float line = 1.0 - smoothstep(0.0, 0.16, abs(sin(w)));
  diffuseColor.rgb *= 1.0 - 0.25 * line;
  patGlow = line;
}
${
  dis
    ? `float dn = uNoise(vBind * 7.0) * 0.75 + uNoise(vBind * 19.0) * 0.25;
if (dn < uDissolve) discard;
float dEdge = 1.0 - smoothstep(0.0, 0.09, dn - uDissolve);
diffuseColor.a *= 1.0 - smoothstep(0.75, 1.0, uDissolve);`
    : ''
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, vFx.y);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = vFx.y * 0.7;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
vec3 nV = normalize(normal);
vec3 vV = normalize(vViewPosition);
float fres = pow(1.0 - saturate(dot(nV, vV)), 2.6);
totalEmissiveRadiance += uRim * fres * ${opts.rimStrength.toFixed(2)};
// Fake environment reflection for metal: view-space sky/ground gradient + a soft horizon band.
vec3 rv = reflect(-vV, nV);
float sky = smoothstep(-0.35, 0.75, rv.y);
float bandY = (rv.y - 0.32) * 5.0;
float band = exp(-bandY * bandY);
vec3 env = mix(vec3(0.10, 0.09, 0.12), vec3(0.85, 0.9, 1.0), sky) + vec3(1.0, 0.96, 0.9) * band * 0.9;
totalEmissiveRadiance += diffuseColor.rgb * env * vFx.y * 0.85;
float gp = ${pulse ? '0.75 + 0.25 * sin(uTime * 4.2 + vBind.y * 2.0)' : '1.0'};
totalEmissiveRadiance += (diffuseColor.rgb * 0.9 + uGlowColor * 0.45) * vFx.x * gp;
totalEmissiveRadiance += uPatColor * patGlow * (pat == 3.0 ? vFx.x + 0.6 : pat == 4.0 ? 0.55 : pat == 7.0 ? 0.25 + vFx.x : 1.4);
totalEmissiveRadiance += uEyeColor * eyeMask * 2.2;
totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * uSpawn * (0.55 + 1.6 * fres);
${dis ? 'totalEmissiveRadiance += uEdge * (dEdge * 3.0 + smoothstep(0.0, 0.25, uDissolve) * (1.0 - smoothstep(0.25, 0.6, uDissolve)) * 1.2);' : ''}`,
      );
  };
  mat.customProgramCacheKey = () =>
    `unit3-${pulse}-${opts.rimStrength.toFixed(2)}-${dis ? 'dis' : 'live'}-${hasMap ? 'map' : 'flat'}`;
  return mat;
}
