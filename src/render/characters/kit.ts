/**
 * Tiny procedural-modelling kit shared by the character builders.
 * Everything goes through two caches (geometries and materials) so that hundreds of
 * pieces can share GPU resources. Geometries are unit-sized and scaled per mesh.
 */
import * as THREE from 'three';
import type { PlayerId } from '../../engine/types';

export type V3 = readonly [number, number, number];

export interface Place {
  pos?: V3;
  rot?: V3;
  scale?: V3;
}

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

export interface TeamTones {
  main: string;
  dark: string;
  deep: string;
  light: string;
  glow: string;
}

/** Team accents (cloth, plumes, emblems). Kept local so the models do not depend on palette churn. */
export const TEAM: Record<PlayerId, TeamTones> = {
  0: { main: '#3D8BFF', dark: '#1F59C9', deep: '#173A8A', light: '#9CC6FF', glow: '#7CC0FF' },
  1: { main: '#FF4D4F', dark: '#BD2A30', deep: '#7C1B22', light: '#FFA5A6', glow: '#FF8A7E' },
};

/** Neutral materials palette: metal in greys, leather/fur in earth tones. */
export const C = {
  steel: '#BCC4D2',
  steelLight: '#E2E7F0',
  steelDark: '#707A8C',
  iron: '#4B5363',
  gold: '#F3C34F',
  goldDark: '#B98A2E',
  leather: '#6E4A33',
  leatherDark: '#47301F',
  wood: '#93704A',
  woodDark: '#6B4D30',
  skin: '#EFC3A0',
  bone: '#F4ECD6',
  hoof: '#2B2A32',
  fur: '#8E5B3B',
  furDark: '#6C4129',
  furLight: '#B58257',
  muzzle: '#DDB38F',
  dark: '#252A36',
  white: '#FFFFFF',
} as const;

// ---------------------------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

export function cachedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

function cachedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m as T;
}

export function disposeKit(): void {
  for (const g of geoCache.values()) g.dispose();
  for (const m of matCache.values()) m.dispose();
  geoCache.clear();
  matCache.clear();
}

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------

export interface MatOpts {
  metalness?: number;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  flat?: boolean;
}

export function std(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const { metalness = 0.05, roughness = 0.7, emissive, emissiveIntensity = 1, flat = true } = o;
  const key = `std:${color}:${metalness}:${roughness}:${emissive ?? ''}:${emissiveIntensity}:${flat}`;
  return cachedMat(key, () => {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness, flatShading: flat });
    if (emissive) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = emissiveIntensity;
    }
    return m;
  });
}

export const metal = (color: string, roughness = 0.36, flat = true) =>
  std(color, { metalness: 0.55, roughness, flat });
export const cloth = (color: string, flat = true) => std(color, { metalness: 0, roughness: 0.85, flat });
export const matte = (color: string, roughness = 0.8, flat = true) => std(color, { metalness: 0, roughness, flat });
/** Self-lit solid (glowing gems, blades, eyes). */
export const glow = (color: string, intensity = 1.4, flat = true) =>
  std(color, { metalness: 0, roughness: 0.4, emissive: color, emissiveIntensity: intensity, flat });

/** Additive translucent material for halos / aura rings. */
export function aura(color: string, opacity: number): THREE.MeshBasicMaterial {
  return cachedMat(
    `aura:${color}:${opacity}`,
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
  );
}

// ---------------------------------------------------------------------------------------------
// Mesh helpers
// ---------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: Place = {}, base?: V3): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  if (p.pos) m.position.set(p.pos[0], p.pos[1], p.pos[2]);
  if (p.rot) m.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
  const sx = (base?.[0] ?? 1) * (p.scale?.[0] ?? 1);
  const sy = (base?.[1] ?? 1) * (p.scale?.[1] ?? 1);
  const sz = (base?.[2] ?? 1) * (p.scale?.[2] ?? 1);
  m.scale.set(sx, sy, sz);
  parent.add(m);
  return m;
}

export function box(parent: THREE.Object3D, size: V3, mat: THREE.Material, p?: Place): THREE.Mesh {
  return put(parent, cachedGeo('box', () => new THREE.BoxGeometry(1, 1, 1)), mat, p, size);
}

/** Ellipsoid with radii (rx, ry, rz). Segment count adapts to size unless given. */
export function sphere(parent: THREE.Object3D, radii: V3 | number, mat: THREE.Material, p?: Place, seg?: [number, number]): THREE.Mesh {
  const r: V3 = typeof radii === 'number' ? [radii, radii, radii] : radii;
  const big = Math.max(r[0], r[1], r[2]);
  const s: [number, number] = seg ?? (big < 0.04 ? [6, 4] : big < 0.11 ? [8, 5] : [10, 6]);
  return put(parent, cachedGeo(`sph:${s[0]}:${s[1]}`, () => new THREE.SphereGeometry(1, s[0], s[1])), mat, p, r);
}

/** Upper half of a sphere (open bottom): helmets, domes. */
export function dome(parent: THREE.Object3D, radii: V3 | number, mat: THREE.Material, p?: Place, seg: [number, number] = [14, 6]): THREE.Mesh {
  const r: V3 = typeof radii === 'number' ? [radii, radii, radii] : radii;
  return put(
    parent,
    cachedGeo(`dome:${seg[0]}:${seg[1]}`, () => new THREE.SphereGeometry(1, seg[0], seg[1], 0, Math.PI * 2, 0, Math.PI / 2)),
    mat,
    p,
    r,
  );
}

export function cyl(parent: THREE.Object3D, rTop: number, rBottom: number, h: number, mat: THREE.Material, p?: Place, seg = 10): THREE.Mesh {
  return put(
    parent,
    cachedGeo(`cyl:${rTop}:${rBottom}:${seg}`, () => new THREE.CylinderGeometry(rTop, rBottom, 1, seg)),
    mat,
    p,
    [1, h, 1],
  );
}

export function cone(parent: THREE.Object3D, r: number, h: number, mat: THREE.Material, p?: Place, seg = 8): THREE.Mesh {
  return put(parent, cachedGeo(`cone:${seg}`, () => new THREE.ConeGeometry(1, 1, seg)), mat, p, [r, h, r]);
}

export function torus(parent: THREE.Object3D, R: number, r: number, mat: THREE.Material, p?: Place, seg: [number, number] = [4, 14]): THREE.Mesh {
  return put(parent, cachedGeo(`tor:${R}:${r}:${seg[0]}:${seg[1]}`, () => new THREE.TorusGeometry(R, r, seg[0], seg[1])), mat, p);
}

/** Tapered cylinder from point a (radius r0) to point b (radius r1). */
export function limb(parent: THREE.Object3D, a: V3, b: V3, r0: number, r1: number, mat: THREE.Material, seg = 6): THREE.Mesh {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const m = put(parent, cachedGeo(`limb:${r0}:${r1}:${seg}`, () => new THREE.CylinderGeometry(r1, r0, 1, seg)), mat, {}, [1, len, 1]);
  m.position.copy(va).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

/** Group whose +y axis points from a towards b (for swords, spears, horns...). Returns [group, length]. */
export function axis(parent: THREE.Object3D, a: V3, b: V3): [THREE.Group, number] {
  const va = new THREE.Vector3(...a);
  const dir = new THREE.Vector3(...b).sub(va);
  const len = dir.length();
  const g = new THREE.Group();
  g.position.copy(va);
  g.quaternion.setFromUnitVectors(UP, dir.normalize());
  parent.add(g);
  return [g, len];
}

/**
 * Smooth tapered tube along a Catmull-Rom path (horns, tails). `radii[i]` belongs to `points[i]`;
 * the part between normalised positions t0..t1 of the path is built (so a glowing tip can be a
 * separate mesh). Cached by `key`.
 */
export function taperedTube(
  parent: THREE.Object3D,
  key: string,
  points: ReadonlyArray<V3>,
  radii: ReadonlyArray<number>,
  mat: THREE.Material,
  opts: { t0?: number; t1?: number; steps?: number; radial?: number; mirror?: boolean } = {},
): THREE.Mesh {
  const { t0 = 0, t1 = 1, steps = 6, radial = 6, mirror = false } = opts;
  const geo = cachedGeo(`tube:${key}:${t0}:${t1}:${steps}:${radial}`, () => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    const frames = curve.computeFrenetFrames(steps * 4, false);
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = t0 + ((t1 - t0) * i) / steps;
      const fi = Math.min(frames.normals.length - 1, Math.round(t * (frames.normals.length - 1)));
      const c = curve.getPointAt(t);
      const u = t * (radii.length - 1);
      const a = Math.min(radii.length - 2, Math.floor(u));
      const r = radii[a] + (radii[a + 1] - radii[a]) * (u - a);
      const n = frames.normals[fi];
      const b = frames.binormals[fi];
      for (let j = 0; j < radial; j++) {
        const ang = (j / radial) * Math.PI * 2;
        const cs = Math.cos(ang) * r;
        const sn = Math.sin(ang) * r;
        pos.push(c.x + n.x * cs + b.x * sn, c.y + n.y * cs + b.y * sn, c.z + n.z * cs + b.z * sn);
      }
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j;
        const b2 = i * radial + ((j + 1) % radial);
        const c2 = (i + 1) * radial + j;
        const d = (i + 1) * radial + ((j + 1) % radial);
        idx.push(a, c2, b2, b2, c2, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  if (mirror) m.scale.x = -1;
  parent.add(m);
  return m;
}

/** Extruded 2D outline (drawn in XY, extruded along Z, centred on z = 0). */
export function extrude(
  parent: THREE.Object3D,
  key: string,
  outline: () => THREE.Shape,
  depth: number,
  mat: THREE.Material,
  p?: Place,
  bevel = 0.006,
): THREE.Mesh {
  const geo = cachedGeo(`ext:${key}:${depth}:${bevel}`, () => {
    const g = new THREE.ExtrudeGeometry(outline(), {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: 5,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  });
  return put(parent, geo, mat, p);
}

export function polygon(points: ReadonlyArray<readonly [number, number]>): THREE.Shape {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  return s;
}

/** Flat ring lying on the ground (aura / base ring): inner radius R - r, outer radius R + r. */
export function groundRing(parent: THREE.Object3D, R: number, r: number, mat: THREE.Material, y = 0.02): THREE.Mesh {
  const m = put(parent, cachedGeo(`ring:${R}:${r}`, () => new THREE.RingGeometry(R - r, R + r, 32, 1)), mat, {
    pos: [0, y, 0],
    rot: [-Math.PI / 2, 0, 0],
  });
  m.castShadow = false;
  return m;
}

export function triangleCount(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const g = m.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return Math.round(n);
}

export interface BuildCtx {
  level: 1 | 2 | 3;
  owner: PlayerId;
  team: TeamTones;
}
