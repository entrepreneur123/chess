/**
 * Storm ("자기장") overlay for the 3D board: the outermost LEFT and RIGHT columns that the storm has
 * consumed get an animated violet haze with magenta energy veins, ONE premultiplied draw call
 * (the floor haze slightly darkens the tiles and adds violet light; veins / wall / warning frame
 * are purely additive, alpha 0):
 *  - a floor sheet over the consumed tiles (scrolling noise + bright veins, brighter at the
 *    inner boundary),
 *  - a vertical energy wall at the boundary between consumed and safe columns (rising noise,
 *    crackling arcs, hot floor line, fading out towards the top),
 *  - a pulsing warning frame on the next column to be consumed (when nextIn <= 2).
 * The geometry is static (unit quads tagged by kind/side); the vertex shader places them from the
 * `uStorm` uniform, so a storm change costs one uniform write. Positions follow the board mapping of
 * BoardView (x = c - HALF_CELL with HALF_CELL = (BOARD_SIZE - 1) / 2: on 10 x 10, x = c - 4.5, column 0
 * spans x in [-5, -4], z = 4.5 - r).
 */
import * as THREE from 'three';
import { BOARD_SIZE, STORM_FULL_STEPS } from '../engine/types';

export const STORM_COLORS = {
  /** Deep purple field. */
  field: '#5A1BC8',
  /** Magenta veins / arcs / warning frame. */
  edge: '#FF3DF0',
  /** Hot core (floor line, vein cores). */
  core: '#FFC8FB',
  /** Tile tint inside the storm (deep purple-black under the haze). */
  tile: '#2A1244',
} as const;

const VS = /* glsl */ `
attribute float aKind;
uniform float uStorm;
uniform float uWall;
uniform float uFloorY;
varying vec2 vUv;
varying float vKind;
varying vec3 vWorld;
const float HALF = ${(BOARD_SIZE / 2).toFixed(1)};
void main() {
  vUv = uv;
  vKind = aKind;
  float side = mod(aKind, 2.0) < 0.5 ? -1.0 : 1.0;
  float kind = floor(aKind / 2.0 + 0.01);
  float xEdge = side * HALF;
  float xIn = side * (HALF - uStorm);
  vec3 p;
  if (kind < 0.5) {
    p = vec3(mix(xEdge, xIn, uv.x), uFloorY, mix(-HALF, HALF, uv.y));
  } else if (kind < 1.5) {
    p = vec3(xIn, uFloorY + uv.y * uWall, mix(-HALF, HALF, uv.x));
  } else {
    p = vec3(mix(xIn, side * (HALF - uStorm - 1.0), uv.x), uFloorY + 0.003, mix(-HALF, HALF, uv.y));
  }
  vWorld = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FS = /* glsl */ `
uniform float uTime;
uniform float uStorm;
uniform float uWarn;
uniform vec3 uField;
uniform vec3 uEdge;
uniform vec3 uCore;
varying vec2 vUv;
varying float vKind;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 x) {
  vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float kind = floor(vKind / 2.0 + 0.01);
  float side = mod(vKind, 2.0) < 0.5 ? -1.0 : 1.0;
  vec3 col = vec3(0.0);
  if (kind < 0.5) {
    // Floor: drifting field + bright veins, brighter near the inner boundary, a slow sweep along z.
    vec2 q = vWorld.xz * 1.5 + vec2(uTime * 0.22 * side, -uTime * 0.35);
    float n = noise(q) * 0.65 + noise(q * 2.3 + 7.0) * 0.35;
    float n2 = noise(vWorld.xz * 3.5 - vec2(0.0, uTime * 1.1));
    float vein = smoothstep(0.08, 0.0, abs(n - 0.5)) * (0.55 + 0.45 * n2);
    float inner = pow(vUv.x, 2.2);
    float sw = (fract(vUv.y * 0.5 - uTime * 0.12) - 0.5) * 7.0; // pow() of a negative base is undefined
    float sweep = exp(-sw * sw) * 0.3;
    // Violet haze over the dark tiles (a light veil darkens, the field colour adds light) + veins
    // and a brighter inner boundary.
    float a = 0.22 + 0.1 * n + 0.08 * inner;
    col = uField * (0.16 + 0.26 * n) + uEdge * vein * 0.3 + uEdge * inner * 0.24 + uCore * sweep * (0.25 + 0.6 * n);
    gl_FragColor = vec4(col, a);
    return;
  } else if (kind < 1.5) {
    // Wall: rising noise, crackling arcs, hot floor line, soft top fade. Hidden while uStorm = 0.
    float h = vUv.y;
    float fade = pow(1.0 - h, 1.9) * step(0.5, uStorm);
    vec2 q = vec2(vWorld.z * 1.8, h * 3.2 - uTime * 0.9);
    float n = noise(q) * 0.6 + noise(q * 2.7 + 3.0) * 0.4;
    float arc = sin(vWorld.z * 7.0 + uTime * 6.0 + n * 7.0) * sin(h * 11.0 - uTime * 2.3 + n * 4.0);
    float bolt = smoothstep(0.82, 1.0, abs(arc)) * (0.5 + 0.5 * noise(vec2(uTime * 3.0, vWorld.z * 0.7)));
    float base = smoothstep(0.1, 0.0, h);
    col = uField * fade * (0.3 + 0.45 * n) + uEdge * fade * bolt * 1.1 + uCore * base * 0.75 + uEdge * base * 0.5;
  } else {
    // Warning frame on the next column: pulsing edges, faint pulsing fill, scrolling hazard ticks.
    float pulse = 0.5 + 0.5 * sin(uTime * 7.0);
    float ex = max(smoothstep(0.12, 0.0, vUv.x), smoothstep(0.88, 1.0, vUv.x));
    float ez = max(smoothstep(0.012, 0.0, vUv.y), smoothstep(0.988, 1.0, vUv.y));
    float ticks = step(0.5, fract(vUv.y * 18.0 - uTime * 1.5)) * smoothstep(0.75, 1.0, vUv.x);
    col = (uEdge * (0.06 + 0.12 * pulse) + uEdge * max(ex, ez) * (0.55 + 0.6 * pulse) + uCore * ticks * 0.2 * pulse) * uWarn;
  }
  gl_FragColor = vec4(col, 0.0);
}`;

export class StormFx {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private storm = 0;
  private warn = false;

  constructor(floorY: number, wallHeight = 2.3) {
    // Six unit quads: floor L/R (aKind 0/1), wall L/R (2/3), warning strip L/R (4/5).
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 6; k++) {
      const kind = Math.floor(k / 2);
      // Walls need more segments along z for the arcs to look right from the camera's angle.
      const g = kind === 1 ? new THREE.PlaneGeometry(1, 1, 24, 6) : new THREE.PlaneGeometry(1, 1, 1, 8);
      const n = g.attributes.position.count;
      g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(k), 1));
      parts.push(g);
    }
    let vc = 0;
    let ic = 0;
    for (const g of parts) {
      vc += g.attributes.position.count;
      ic += (g.index as THREE.BufferAttribute).count;
    }
    const pos = new Float32Array(vc * 3);
    const uv = new Float32Array(vc * 2);
    const kind = new Float32Array(vc);
    const idx = new Uint16Array(ic);
    let vo = 0;
    let io = 0;
    for (const g of parts) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array as Float32Array, vo * 3);
      uv.set(g.attributes.uv.array as Float32Array, vo * 2);
      kind.set(g.attributes.aKind.array as Float32Array, vo);
      const gi = g.index as THREE.BufferAttribute;
      for (let i = 0; i < gi.count; i++) idx[io + i] = gi.getX(i) + vo;
      io += gi.count;
      vo += n;
      g.dispose();
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 10);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uStorm: { value: 0 },
        uWarn: { value: 0 },
        uWall: { value: wallHeight },
        uFloorY: { value: floorY },
        uField: { value: new THREE.Color(STORM_COLORS.field) },
        uEdge: { value: new THREE.Color(STORM_COLORS.edge) },
        uCore: { value: new THREE.Color(STORM_COLORS.core) },
      },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      // Premultiplied: the floor writes alpha (haze), the wall / warning frame alpha 0 (= additive).
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    // Over the ground decals / rarity rings (2), under the coins (4) even when depth-sorting would
    // put this board-wide mesh after a corner token.
    this.mesh.renderOrder = 3.5;
    this.mesh.visible = false;
    this.mesh.raycast = () => undefined;
  }

  /** `storm` = consumed columns per side; `nextIn` = plies until the next shrink (null = inactive). */
  set(storm: number, nextIn: number | null): void {
    this.storm = Math.max(0, Math.min(STORM_FULL_STEPS, Math.floor(storm)));
    this.warn = nextIn !== null && nextIn <= 2 && this.storm < STORM_FULL_STEPS;
    this.mat.uniforms.uStorm.value = this.storm;
    this.mat.uniforms.uWarn.value = this.warn ? 1 : 0;
    this.mesh.visible = this.storm > 0 || this.warn;
  }

  /** True while the overlay is visible (it animates every frame). */
  get active(): boolean {
    return this.mesh.visible;
  }

  /** Columns consumed per side. */
  get columns(): number {
    return this.storm;
  }

  update(timeSec: number): void {
    this.mat.uniforms.uTime.value = timeSec;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
