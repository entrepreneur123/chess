/**
 * Pooled, allocation-free board effects for the 3D view:
 *  - DustPool: soft dust / ember puffs (one Points draw call while any puff is alive) for
 *    footsteps, hoof clouds, jump landings and impact rings;
 *  - SparkPool: additive velocity-aligned streaks (one instanced draw call) for hit sparks.
 * Both are CPU-simulated in place (typed arrays, scratch objects), hidden when idle, and freed by
 * dispose().
 */
import * as THREE from 'three';

const DUST_VS = /* glsl */ `
uniform float uScale;
attribute vec2 aData;  // age01, size
attribute vec3 aColor;
varying float vAge;
varying vec3 vColor;
void main() {
  vAge = aData.x;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float grow = 0.7 + 1.1 * sqrt(aData.x);
  gl_PointSize = aData.x >= 1.0 ? 0.0 : aData.y * grow * uScale / -mv.z;
}`;

const DUST_FS = /* glsl */ `
varying float vAge;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.2, r) * pow(1.0 - vAge, 1.3) * 0.85;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export class DustPool {
  readonly points: THREE.Points;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly data: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly n: number;
  private next = 0;
  private alive = 0;
  private readonly tmpC = new THREE.Color();

  constructor(count: number, pointScale: { value: number }) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.data = new Float32Array(count * 2);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    for (let i = 0; i < count; i++) this.data[i * 2] = 1;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aData', new THREE.BufferAttribute(this.data, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: pointScale },
      vertexShader: DUST_VS,
      fragmentShader: DUST_FS,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.visible = false;
  }

  /** Spawn one puff. `color` is an sRGB hex number. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.data[i * 2] = 0;
    this.data[i * 2 + 1] = size;
    this.life[i] = life;
    this.tmpC.setHex(color);
    this.col[i * 3] = this.tmpC.r;
    this.col[i * 3 + 1] = this.tmpC.g;
    this.col[i * 3 + 2] = this.tmpC.b;
    this.points.visible = true;
    this.alive = 1;
  }

  /** Radial ring of puffs on the ground. */
  ring(x: number, y: number, z: number, count: number, speed: number, size: number, life: number, color: number, phase = 0): void {
    for (let k = 0; k < count; k++) {
      const a = phase + (k / count) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.emit(x + c * 0.12, y, z + s * 0.12, c * speed, 0.12 + 0.1 * ((k * 7) % 3), s * speed, size, life, color);
    }
  }

  /** Advance; returns true while puffs are alive. */
  update(dt: number): boolean {
    if (!this.alive) return false;
    let any = 0;
    const drag = Math.exp(-dt * 3.2);
    for (let i = 0; i < this.n; i++) {
      const age = this.data[i * 2];
      if (age >= 1) continue;
      const na = Math.min(1, age + dt / Math.max(0.05, this.life[i]));
      this.data[i * 2] = na;
      if (na < 1) any = 1;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + 0.08 * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aData as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    this.alive = any;
    if (!any) this.points.visible = false;
    return any === 1;
  }

  clear(): void {
    for (let i = 0; i < this.n; i++) this.data[i * 2] = 1;
    this.alive = 0;
    this.points.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

export class SparkPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly base: THREE.Color[] = [];
  private readonly n: number;
  private next = 0;
  private alive = false;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(count: number) {
    this.n = count;
    this.p = new Float32Array(count * 3);
    this.v = new Float32Array(count * 3);
    this.age = new Float32Array(count).fill(1);
    this.life = new Float32Array(count).fill(1);
    for (let i = 0; i < count; i++) this.base.push(new THREE.Color());
    // Unit streak along -y (the tail trails behind the head at the origin).
    this.geo = new THREE.BoxGeometry(0.06, 1, 0.06).translate(0, -0.5, 0);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    for (let i = 0; i < count; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.c.setRGB(0, 0, 0));
    }
  }

  /** Burst of `count` streaks from a point (deterministic spread, hot core -> `color`). */
  burst(x: number, y: number, z: number, count: number, speed: number, color: string, seed: number): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const h1 = Math.sin((k + 1) * 12.9898 + seed * 78.233) * 43758.5453;
      const h2 = Math.sin((k + 1) * 39.3468 + seed * 11.135) * 24634.6345;
      const r1 = h1 - Math.floor(h1);
      const r2 = h2 - Math.floor(h2);
      const a = (k / count) * Math.PI * 2 + r1 * 0.6;
      const el = 0.25 + r2 * 0.95;
      const sp = speed * (0.6 + 0.7 * r1);
      this.p[i * 3] = x;
      this.p[i * 3 + 1] = y;
      this.p[i * 3 + 2] = z;
      this.v[i * 3] = Math.cos(a) * Math.cos(el) * sp;
      this.v[i * 3 + 1] = Math.sin(el) * sp;
      this.v[i * 3 + 2] = Math.sin(a) * Math.cos(el) * sp;
      this.age[i] = 0;
      this.life[i] = 0.28 + 0.22 * r2;
      this.base[i].set(color);
    }
    this.alive = true;
    this.mesh.visible = true;
  }

  update(dt: number): boolean {
    if (!this.alive) return false;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= 1) continue;
      const a = Math.min(1, this.age[i] + dt / this.life[i]);
      this.age[i] = a;
      if (a >= 1) {
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      any = true;
      this.v[i * 3 + 1] -= 9.0 * dt;
      const drag = Math.exp(-dt * 2.0);
      this.v[i * 3] *= drag;
      this.v[i * 3 + 2] *= drag;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] = Math.max(0.1, this.p[i * 3 + 1] + this.v[i * 3 + 1] * dt);
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.d.set(this.v[i * 3], this.v[i * 3 + 1], this.v[i * 3 + 2]);
      const sp = this.d.length();
      if (sp > 1e-4) this.q.setFromUnitVectors(this.up, this.d.multiplyScalar(1 / sp));
      const w = 1 - a * 0.6;
      this.s.set(w, Math.min(0.55, 0.05 + sp * 0.07), w);
      this.t.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      this.m.compose(this.t, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      // Hot white core cooling to the burst colour, fading out (additive -> darker = fainter).
      const f = (1 - a) * (1 - a);
      this.c.setRGB(1, 1, 1).lerp(this.base[i], Math.min(1, a * 2.2)).multiplyScalar(f * 2.2);
      this.mesh.setColorAt(i, this.c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.alive = any;
    if (!any) this.mesh.visible = false;
    return any;
  }

  clear(): void {
    for (let i = 0; i < this.n; i++) {
      this.age[i] = 1;
      this.mesh.setMatrixAt(i, this.zero);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive = false;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
