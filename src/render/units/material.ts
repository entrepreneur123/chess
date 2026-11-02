/**
 * Unit material: one MeshStandardMaterial per (character, level, team) template, driven by
 * per-vertex data so a whole unit (body + gear + glowing trim) stays ONE draw call:
 *   color  (vec3)  baked albedo (atlas sampled per vertex + per-level palette remap)
 *   aFx    (vec4)  x = emissive glow strength, y = metal (0..1), z = pattern id, w = spare
 * Pattern ids: 0 none, 1 chain mail (ring pattern), 2 lava cracks (emissive cellular noise),
 * 3 rune/engraving (scrolling emissive bands), 4 flame (flickering emissive gradient).
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

export const PATTERN = { none: 0, chain: 1, lava: 2, rune: 3, flame: 4 } as const;

export interface UnitMaterialOptions {
  rim: string;
  rimStrength: number;
  glowColor: string;
  /** Pulse the glow (legendary units). */
  pulse: boolean;
  /** Colour of the lava/rune/flame patterns. */
  patternColor: string;
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
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.66, metalness: 0 });
  const rim = new THREE.Color(opts.rim);
  const glowColor = new THREE.Color(opts.glowColor);
  const patColor = new THREE.Color(opts.patternColor);
  const pulse = opts.pulse ? 1 : 0;
  const dis = !!opts.dissolve && !!dissolve;
  if (dis) {
    mat.transparent = true;
    mat.depthWrite = true;
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uGlowColor = { value: glowColor };
    shader.uniforms.uPatColor = { value: patColor };
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
uniform vec3 uRim; uniform vec3 uGlowColor; uniform vec3 uPatColor; uniform float uTime; uniform float uSpawn;
${dis ? 'uniform float uDissolve; uniform vec3 uEdge;' : ''}
varying vec4 vFx; varying vec3 vBind;
${NOISE}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float pat = floor(vFx.z + 0.5);
float patGlow = 0.0;
if (pat == 1.0) {
  // Chain mail: staggered rings (dark gaps) in bind space.
  vec2 q = vec2(vBind.x * 1.0 + vBind.z * 1.0, vBind.y * 1.6) * 26.0;
  q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
  float d = length(fract(q) - 0.5);
  float ring = smoothstep(0.2, 0.32, d) * (1.0 - smoothstep(0.38, 0.5, d));
  diffuseColor.rgb *= 0.45 + 0.75 * ring;
} else if (pat == 2.0) {
  // Lava cracks: cellular edges glow, crust darkens around them.
  float c = uCells(vBind * 2.2 + vec3(0.0, uTime * 0.05, 0.0));
  float crack = 1.0 - smoothstep(0.02, 0.11, c);
  float heat = 0.7 + 0.3 * sin(uTime * 2.3 + vBind.z * 3.0 + vBind.y * 2.0);
  diffuseColor.rgb *= 1.0 - 0.6 * crack;
  patGlow = crack * heat;
} else if (pat == 3.0) {
  // Rune / engraving: bright travelling bands.
  float b = 0.55 + 0.45 * sin(vBind.y * 14.0 + vBind.z * 14.0 - uTime * 3.0);
  patGlow = b;
} else if (pat == 4.0) {
  float n = uNoise(vBind * 6.0 + vec3(0.0, -uTime * 3.5, 0.0));
  patGlow = 0.65 + 0.7 * n;
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
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, vFx.y);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = vFx.y * 0.45;',
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
float band = exp(-pow((rv.y - 0.32) * 5.0, 2.0));
vec3 env = mix(vec3(0.10, 0.09, 0.12), vec3(0.85, 0.9, 1.0), sky) + vec3(1.0, 0.96, 0.9) * band * 0.9;
totalEmissiveRadiance += diffuseColor.rgb * env * vFx.y * 0.85;
float gp = ${pulse ? '0.75 + 0.25 * sin(uTime * 4.2 + vBind.y * 2.0)' : '1.0'};
totalEmissiveRadiance += (diffuseColor.rgb * 0.9 + uGlowColor * 0.45) * vFx.x * gp;
totalEmissiveRadiance += uPatColor * patGlow * (pat == 3.0 ? vFx.x + 0.6 : pat == 4.0 ? 0.55 : 1.4);
totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * uSpawn * (0.55 + 1.6 * fres);
${dis ? 'totalEmissiveRadiance += uEdge * (dEdge * 3.0 + smoothstep(0.0, 0.25, uDissolve) * (1.0 - smoothstep(0.25, 0.6, uDissolve)) * 1.2);' : ''}`,
      );
  };
  mat.customProgramCacheKey = () =>
    `unit2-${pulse}-${opts.rimStrength.toFixed(2)}-${dis ? 'dis' : 'live'}`;
  return mat;
}
