/**
 * Character strike / skill effects of the 3D board. Every effect is ONE pre-allocated mesh with its
 * own small shader (no per-frame or per-move allocations; uniforms are rewritten in place), hidden
 * while idle and freed by dispose(). One capture plays at a time, so one instance of each is enough:
 *  - ground (2 slots): flat additive decal with modes: molten crack shockwave (marki), shield-shaped
 *    shock ring (walk), holy sigil (sad), violet flame ring (insaner) and a plain ring;
 *  - slash: camera-facing crescent sword arc that sweeps once (sad);
 *  - pillar: open light column, holy streaks (sad) or flickering flames (insaner);
 *  - soul: GPU particle stream flowing from a victim into the attacker (insaner absorption);
 *  - trail: ribbon that follows a moving point (walk leap arc, insaner chain dash);
 *  - glint: 4-point star sprite (sad's holy glint on move start).
 * Colours are linear THREE.Color uniforms; the fragment shaders encode to the output colour space.
 */
import * as THREE from 'three';

export const GROUND_MODE = { crack: 0, shield: 1, sigil: 2, flame: 3, ring: 4 } as const;
export type GroundMode = (typeof GROUND_MODE)[keyof typeof GROUND_MODE];

const NOISE_GLSL = /* glsl */ `
float hash1(float n) { return fract(sin(n) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = dot(i, vec2(1.0, 57.0));
  return mix(mix(hash1(n), hash1(n + 1.0), f.x), mix(hash1(n + 57.0), hash1(n + 58.0), f.x), f.y);
}`;

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GROUND_FS = /* glsl */ `
uniform float uMode;
uniform float uK;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uSeed;
varying vec2 vUv;
${NOISE_GLSL}
float sq2(float x) { return x * x; }
float sdShield(vec2 q) {
  float c1 = length(q - vec2(-0.63, 0.55)) - 1.25;
  float c2 = length(q - vec2(0.63, 0.55)) - 1.25;
  return max(max(c1, c2), q.y - 0.55);
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float k = clamp(uK, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - k, 3.0);
  float fade = 1.0 - k;
  float ang = atan(p.y, p.x);
  vec3 col = vec3(0.0);
  if (uMode < 0.5) {
    // Molten crack shockwave: fast ring, jagged radial lava cracks that linger, dusty core.
    float R = 0.12 + 0.82 * e;
    float ring = exp(-sq2((r - R) / (0.03 + 0.06 * k))) * fade;
    float a = (ang / 6.2831853 + 0.5) * 11.0 + uSeed;
    float cell = floor(a);
    float jag = 0.16 * sin(r * 23.0 + cell * 7.1) + 0.08 * sin(r * 57.0 + cell * 3.3);
    float wd = abs(fract(a) - 0.5 + jag) * 6.2831853 * r / 11.0;
    float len = (0.45 + 0.4 * hash1(cell + uSeed * 3.1)) * min(1.0, e * 1.8);
    float taper = smoothstep(len, len * 0.3, r);
    float crack = smoothstep(0.034 * taper + 0.006, 0.0, wd) * step(r, len) * pow(fade, 0.5);
    float halo = smoothstep(0.1, 0.0, wd) * step(r, len) * taper * 0.5 * fade;
    float core = smoothstep(R, 0.0, r) * 0.22 * fade * fade;
    col = uColor * (ring * 1.3 + crack * 2.2 + halo) + uColor2 * core;
  } else if (uMode < 1.5) {
    // Shield-shaped shock ring (its point at -y; BoardView turns it toward the strike) + an echo and a flash core.
    float s = 0.18 + 0.78 * e;
    float d = sdShield(p / s * 1.08) * s;
    float line = exp(-sq2(d / (0.025 + 0.03 * k))) * fade;
    float s2 = s * 0.62;
    float d2 = sdShield(p / s2 * 1.08) * s2;
    float echo = exp(-sq2(d2 / 0.02)) * fade * fade * 0.6;
    float fill = smoothstep(0.0, -0.25, d) * 0.22 * fade * fade;
    float flash = exp(-r * r / 0.03) * pow(fade, 3.0) * 1.4;
    col = uColor * (line * 1.6 + echo) + uColor2 * (fill + flash);
  } else if (uMode < 2.5) {
    // Holy sigil: twin rings and eight rotating rays.
    float R = 0.22 + 0.62 * e;
    float ring = exp(-sq2((r - R) / 0.022));
    float ring2 = exp(-sq2((r - R * 0.7) / 0.014)) * 0.7;
    float ra = abs(fract((ang + k * 1.4) / 6.2831853 * 8.0) - 0.5) * r * 6.2831853 / 8.0;
    float rays = smoothstep(0.03, 0.0, ra) * smoothstep(R * 1.05, 0.05, r) * 0.8;
    float glow = exp(-r * r / 0.05) * 0.5;
    col = (uColor * (ring + ring2 + glow) + uColor2 * rays) * fade;
  } else if (uMode < 3.5) {
    // Flame ring: flickering tongues licking outward from an expanding ring.
    float R = 0.18 + 0.6 * e;
    float n = vnoise(vec2(ang * 3.0 + uSeed, r * 7.0 - k * 9.0));
    float n2 = vnoise(vec2(ang * 7.0 - uSeed, r * 13.0 - k * 15.0));
    float t = r - R;
    float flame = smoothstep(0.05 + 0.3 * n * n2 + 0.08 * n, 0.0, t) * smoothstep(-0.1, 0.0, t);
    float inner = smoothstep(R, 0.0, r) * 0.18;
    col = (mix(uColor2, uColor, n) * flame * 1.7 + uColor * inner) * pow(fade, 0.7);
  } else {
    float R = 0.2 + 0.75 * e;
    col = uColor * exp(-sq2((r - R) / 0.04)) * fade;
  }
  col *= smoothstep(1.0, 0.92, r);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const SLASH_FS = /* glsl */ `
float sq2(float x) { return x * x; }
uniform float uK;
uniform vec3 uColor;
uniform vec3 uCore;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  // The arc runs clockwise from ~150deg down to ~-65deg; s is the position along it (0..1).
  float s = (2.6 - ang) / 3.75;
  float head = uK * 1.45;
  float vis = smoothstep(head - 0.8, head, s) * step(s, head) * step(0.0, s) * step(s, 1.0);
  float mid = sin(clamp(s, 0.0, 1.0) * 3.14159);
  float th = 0.05 + 0.2 * mid;
  float d = r - 0.8;
  float blade = smoothstep(th, 0.0, abs(d + th * 0.6)) * step(d, 0.02);
  float edge = exp(-sq2(d / 0.018)) * (0.4 + mid);
  float fade = 1.0 - smoothstep(0.55, 1.0, uK);
  vec3 col = uColor * blade * 1.3 + uCore * edge * 1.6;
  gl_FragColor = vec4(col * vis * fade, 1.0);
  #include <colorspace_fragment>
}`;

const PILLAR_VS = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

const PILLAR_FS = /* glsl */ `
uniform float uK;
uniform float uT;
uniform float uFlame;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform vec3 uCore;
varying vec2 vUv;
varying float vFacing;
${NOISE_GLSL}
void main() {
  float h = vUv.y;
  float top = smoothstep(0.0, 0.22, uK) * 1.05;
  float vis = smoothstep(top, top - 0.3, h);
  float fade = 1.0 - smoothstep(0.35, 1.0, uK);
  float edge = pow(vFacing, 1.4);
  vec3 col;
  if (uFlame > 0.5) {
    float n = vnoise(vec2(vUv.x * 12.0, h * 6.0 - uT * 7.0));
    float n2 = vnoise(vec2(vUv.x * 23.0 + 3.0, h * 11.0 - uT * 11.0));
    float f = smoothstep(0.25, 0.9, n * 0.65 + n2 * 0.5 + (1.0 - h) * 0.35);
    col = mix(uColor2, uColor, h + 0.3 * n) * f * 1.8;
  } else {
    float streak = 0.55 + 0.45 * sin(vUv.x * 6.2831853 * 7.0 + h * 10.0 - uT * 16.0);
    col = mix(uColor, uCore, edge * 0.7) * (0.6 + 0.6 * streak);
  }
  col *= edge * vis * fade * pow(1.0 - h, 1.1);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const SOUL_VS = /* glsl */ `
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uT;
uniform float uScale;
attribute vec4 aSeed; // delay (s), phase, spread, size
varying float vA;
varying float vS;
void main() {
  float tt = (uT - aSeed.x) / 0.55;
  float s = clamp(tt, 0.0, 1.0);
  vec3 mid = (uFrom + uTo) * 0.5 + vec3(0.0, 1.1 + aSeed.z * 0.6, 0.0);
  vec3 p = mix(mix(uFrom, mid, s), mix(mid, uTo, s), s);
  float w = sin(s * 3.14159) * 0.28 * (0.4 + aSeed.z);
  float ph = aSeed.y * 6.2831853 + s * 10.0;
  p += vec3(cos(ph), 0.6 * sin(ph * 0.8), sin(ph)) * w;
  vA = (tt > 0.0 && tt < 1.0) ? pow(sin(s * 3.14159), 0.6) : 0.0;
  vS = s;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = vA <= 0.0 ? 0.0 : aSeed.w * (1.0 - 0.45 * s) * uScale / -mv.z;
}`;

const SOUL_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
varying float vA;
varying float vS;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  vec3 col = mix(uColor, uCore, a * a * (1.0 - vS * 0.5));
  gl_FragColor = vec4(col * a * vA * 1.4, 1.0);
  #include <colorspace_fragment>
}`;

const TRAIL_VS = /* glsl */ `
attribute float aAlpha;
attribute float aSide;
varying float vA;
varying float vSide;
void main() {
  vA = aAlpha;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const TRAIL_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
varying float vA;
varying float vSide;
void main() {
  float x = abs(vSide * 2.0 - 1.0);
  float soft = 1.0 - x * x;
  vec3 col = mix(uColor, uCore, pow(soft, 4.0) * vA);
  gl_FragColor = vec4(col * soft * vA, 1.0);
  #include <colorspace_fragment>
}`;

const SOUL_COUNT = 40;
const TRAIL_N = 28;

/** Additive, no depth write: the common base of every effect material. */
function fxMaterial(params: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    ...params,
  });
}

/** 4-point star glint (white, alpha) used by the glint sprite. */
function makeStarTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (ctx) {
    const h = S / 2;
    const g = ctx.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#fff';
    for (const rot of [0, Math.PI / 2]) {
      ctx.save();
      ctx.translate(h, h);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(-h, 0);
      ctx.quadraticCurveTo(0, -S * 0.035, h, 0);
      ctx.quadraticCurveTo(0, S * 0.035, -h, 0);
      ctx.fill();
      ctx.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Timed {
  t0: number;
  dur: number;
}

export class StrikeFx {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];

  private readonly grounds: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: Timed }[] = [];
  private readonly slashMesh: THREE.Mesh;
  private readonly slashMat: THREE.ShaderMaterial;
  private readonly slashT: Timed = { t0: -1, dur: 1 };
  private slashRoll = 0;
  private readonly pillarMesh: THREE.Mesh;
  private readonly pillarMat: THREE.ShaderMaterial;
  private readonly pillarT: Timed = { t0: -1, dur: 1 };
  private readonly soulPoints: THREE.Points;
  private readonly soulMat: THREE.ShaderMaterial;
  private readonly soulT: Timed = { t0: -1, dur: 1 };
  private readonly glintSprite: THREE.Sprite;
  private readonly glintMat: THREE.SpriteMaterial;
  private readonly glintT: Timed = { t0: -1, dur: 1 };
  private glintSize = 1;

  // Trail ribbon: samples (oldest first), their timestamps, the GPU buffers.
  private readonly trailMesh: THREE.Mesh;
  private readonly trailMat: THREE.ShaderMaterial;
  private readonly trailGeo: THREE.BufferGeometry;
  private readonly trailPos: Float32Array;
  private readonly trailAlpha: Float32Array;
  private readonly trailPts = new Float32Array(TRAIL_N * 3);
  private readonly trailTimes = new Float32Array(TRAIL_N);
  private trailCount = 0;
  private trailLive = false;
  private trailWidth = 0.3;
  private trailLife = 260;
  private readonly trailAxis = new THREE.Vector3(1, 0, 0);
  private readonly tmpV = new THREE.Vector3();

  constructor(pointScale: { value: number }) {
    // Ground decals (2 slots: impact + secondary/aura).
    const groundGeo = this.geo(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    for (let i = 0; i < 2; i++) {
      const mat = this.mat(
        fxMaterial({
          uniforms: {
            uMode: { value: 0 },
            uK: { value: 0 },
            uColor: { value: new THREE.Color() },
            uColor2: { value: new THREE.Color() },
            uSeed: { value: 0 },
          },
          vertexShader: QUAD_VS,
          fragmentShader: GROUND_FS,
          polygonOffset: true,
          polygonOffsetFactor: -5,
          polygonOffsetUnits: -5,
        }),
      );
      const mesh = new THREE.Mesh(groundGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.grounds.push({ mesh, mat, t: { t0: -1, dur: 1 } });
    }

    // Sword slash (camera-facing quad).
    this.slashMat = this.mat(
      fxMaterial({
        uniforms: { uK: { value: 0 }, uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() } },
        vertexShader: QUAD_VS,
        fragmentShader: SLASH_FS,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.slashMesh = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1, 1)), this.slashMat);
    this.slashMesh.visible = false;
    this.slashMesh.renderOrder = 11;
    this.slashMesh.frustumCulled = false;
    this.group.add(this.slashMesh);

    // Light / flame pillar (open cone).
    this.pillarMat = this.mat(
      fxMaterial({
        uniforms: {
          uK: { value: 0 },
          uT: { value: 0 },
          uFlame: { value: 0 },
          uColor: { value: new THREE.Color() },
          uColor2: { value: new THREE.Color() },
          uCore: { value: new THREE.Color() },
        },
        vertexShader: PILLAR_VS,
        fragmentShader: PILLAR_FS,
        side: THREE.DoubleSide,
      }),
    );
    this.pillarMesh = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.34, 0.5, 3, 28, 1, true).translate(0, 1.5, 0)), this.pillarMat);
    this.pillarMesh.visible = false;
    this.pillarMesh.renderOrder = 7;
    this.pillarMesh.frustumCulled = false;
    this.group.add(this.pillarMesh);

    // Soul stream (GPU points).
    const soulGeo = new THREE.BufferGeometry();
    const seeds = new Float32Array(SOUL_COUNT * 4);
    for (let i = 0; i < SOUL_COUNT; i++) {
      const h = (n: number): number => {
        const v = Math.sin((i + 1) * n) * 43758.5453;
        return v - Math.floor(v);
      };
      seeds[i * 4] = (i / SOUL_COUNT) * 0.34 + h(12.9898) * 0.04;
      seeds[i * 4 + 1] = h(78.233);
      seeds[i * 4 + 2] = h(39.425);
      seeds[i * 4 + 3] = 0.12 + 0.12 * h(11.135);
    }
    soulGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    soulGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SOUL_COUNT * 3), 3));
    soulGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    this.geometries.push(soulGeo);
    this.soulMat = this.mat(
      fxMaterial({
        uniforms: {
          uFrom: { value: new THREE.Vector3() },
          uTo: { value: new THREE.Vector3() },
          uT: { value: 0 },
          uScale: pointScale,
          uColor: { value: new THREE.Color() },
          uCore: { value: new THREE.Color() },
        },
        vertexShader: SOUL_VS,
        fragmentShader: SOUL_FS,
      }),
    );
    this.soulPoints = new THREE.Points(soulGeo, this.soulMat);
    this.soulPoints.visible = false;
    this.soulPoints.renderOrder = 10;
    this.soulPoints.frustumCulled = false;
    this.group.add(this.soulPoints);

    // Trail ribbon.
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this.trailAlpha = new Float32Array(TRAIL_N * 2);
    const side = new Float32Array(TRAIL_N * 2);
    for (let i = 0; i < TRAIL_N; i++) side[i * 2 + 1] = 1;
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.trailGeo.setIndex(idx);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.trailAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.trailGeo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.trailGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    this.geometries.push(this.trailGeo);
    this.trailMat = this.mat(
      fxMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() } },
        vertexShader: TRAIL_VS,
        fragmentShader: TRAIL_FS,
        side: THREE.DoubleSide,
      }),
    );
    this.trailMesh = new THREE.Mesh(this.trailGeo, this.trailMat);
    this.trailMesh.visible = false;
    this.trailMesh.renderOrder = 8;
    this.trailMesh.frustumCulled = false;
    this.group.add(this.trailMesh);

    // Glint sprite.
    const starTex = makeStarTexture();
    this.textures.push(starTex);
    this.glintMat = this.mat(
      new THREE.SpriteMaterial({
        map: starTex,
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.glintSprite = new THREE.Sprite(this.glintMat);
    this.glintSprite.visible = false;
    this.glintSprite.renderOrder = 12;
    this.group.add(this.glintSprite);
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /**
   * Ground decal in `slot` (0 = impact, 1 = secondary / aura): `radius` in world units, `yaw`
   * turns the shield mode's point toward a direction (radians, see BoardView).
   */
  ground(slot: 0 | 1, mode: GroundMode, x: number, y: number, z: number, radius: number, color: string, color2: string, durMs: number, now: number, yaw = 0): void {
    const g = this.grounds[slot];
    g.t.t0 = now;
    g.t.dur = durMs;
    const u = g.mat.uniforms;
    u.uMode.value = mode;
    u.uK.value = 0;
    (u.uColor.value as THREE.Color).set(color);
    (u.uColor2.value as THREE.Color).set(color2);
    u.uSeed.value = (now * 0.0137) % 7;
    g.mesh.position.set(x, y, z);
    g.mesh.scale.set(radius * 2, 1, radius * 2);
    g.mesh.rotation.set(0, yaw, 0);
    g.mesh.visible = true;
  }

  /** Crescent sword slash at a point (camera-facing, diagonal); `flip` mirrors the sweep. */
  slash(x: number, y: number, z: number, size: number, color: string, core: string, flip: boolean, now: number): void {
    this.slashT.t0 = now;
    this.slashT.dur = 380;
    (this.slashMat.uniforms.uColor.value as THREE.Color).set(color);
    (this.slashMat.uniforms.uCore.value as THREE.Color).set(core);
    this.slashMat.uniforms.uK.value = 0;
    this.slashMesh.position.set(x, y, z);
    this.slashMesh.scale.set(flip ? -size : size, size, 1);
    this.slashRoll = flip ? 0.35 : -0.35;
    this.slashMesh.visible = true;
  }

  /** Light column (`flame` = flickering fire variant) rising at a point. */
  pillar(x: number, y: number, z: number, color: string, color2: string, core: string, flame: boolean, durMs: number, now: number): void {
    this.pillarT.t0 = now;
    this.pillarT.dur = durMs;
    const u = this.pillarMat.uniforms;
    (u.uColor.value as THREE.Color).set(color);
    (u.uColor2.value as THREE.Color).set(color2);
    (u.uCore.value as THREE.Color).set(core);
    u.uFlame.value = flame ? 1 : 0;
    u.uK.value = 0;
    this.pillarMesh.position.set(x, y, z);
    this.pillarMesh.visible = true;
  }

  /** Soul particles flowing from `from` into the target (keep it updated with setSoulTarget). */
  soul(fx: number, fy: number, fz: number, color: string, core: string, now: number): void {
    this.soulT.t0 = now;
    this.soulT.dur = 900;
    const u = this.soulMat.uniforms;
    (u.uFrom.value as THREE.Vector3).set(fx, fy, fz);
    (u.uColor.value as THREE.Color).set(color);
    (u.uCore.value as THREE.Color).set(core);
    u.uT.value = 0;
    this.soulPoints.visible = true;
  }

  setSoulTarget(x: number, y: number, z: number): void {
    (this.soulMat.uniforms.uTo.value as THREE.Vector3).set(x, y, z);
  }

  /** Star glint sprite popping at a point. */
  glint(x: number, y: number, z: number, size: number, color: string, durMs: number, now: number): void {
    this.glintT.t0 = now;
    this.glintT.dur = durMs;
    this.glintSize = size;
    this.glintMat.color.set(color);
    this.glintSprite.position.set(x, y, z);
    this.glintSprite.visible = true;
  }

  /**
   * Start a ribbon trail. `dirX/dirZ` = travel direction, `camDir` = camera forward: the ribbon is
   * spread across both so it faces the camera.
   */
  trailStart(color: string, core: string, width: number, lifeMs: number, dirX: number, dirZ: number, camDir: THREE.Vector3): void {
    (this.trailMat.uniforms.uColor.value as THREE.Color).set(color);
    (this.trailMat.uniforms.uCore.value as THREE.Color).set(core);
    this.trailWidth = width;
    this.trailLife = lifeMs;
    this.trailCount = 0;
    this.trailLive = true;
    this.tmpV.set(dirX, 0, dirZ);
    if (this.tmpV.lengthSq() < 1e-6) this.tmpV.set(0, 0, -1);
    this.trailAxis.crossVectors(this.tmpV, camDir);
    if (this.trailAxis.lengthSq() < 1e-6) this.trailAxis.set(1, 0, 0);
    this.trailAxis.normalize();
  }

  trailPush(x: number, y: number, z: number, now: number): void {
    if (!this.trailLive) return;
    if (this.trailCount === TRAIL_N) {
      this.trailPts.copyWithin(0, 3);
      this.trailTimes.copyWithin(0, 1);
      this.trailCount--;
    }
    const i = this.trailCount++;
    this.trailPts[i * 3] = x;
    this.trailPts[i * 3 + 1] = y;
    this.trailPts[i * 3 + 2] = z;
    this.trailTimes[i] = now;
  }

  /** Stop feeding the trail (it fades out on its own). */
  trailEnd(): void {
    this.trailLive = false;
  }

  /** Advance every effect; `camera` orients the slash. Returns true while anything is visible. */
  update(now: number, camera: THREE.Camera): boolean {
    let active = false;
    for (const g of this.grounds) {
      if (!g.mesh.visible) continue;
      const k = (now - g.t.t0) / g.t.dur;
      if (k >= 1) g.mesh.visible = false;
      else {
        g.mat.uniforms.uK.value = Math.max(0, k);
        active = true;
      }
    }
    if (this.slashMesh.visible) {
      const k = (now - this.slashT.t0) / this.slashT.dur;
      if (k >= 1) this.slashMesh.visible = false;
      else {
        this.slashMat.uniforms.uK.value = Math.max(0, k);
        this.slashMesh.quaternion.copy(camera.quaternion);
        this.slashMesh.rotateZ(this.slashRoll);
        active = true;
      }
    }
    if (this.pillarMesh.visible) {
      const el = now - this.pillarT.t0;
      const k = el / this.pillarT.dur;
      if (k >= 1) this.pillarMesh.visible = false;
      else {
        const kk = Math.max(0, k);
        this.pillarMat.uniforms.uK.value = kk;
        this.pillarMat.uniforms.uT.value = el / 1000;
        const w = 1.1 - 0.6 * kk;
        this.pillarMesh.scale.set(w, 1, w);
        active = true;
      }
    }
    if (this.soulPoints.visible) {
      const el = now - this.soulT.t0;
      if (el >= this.soulT.dur) this.soulPoints.visible = false;
      else {
        this.soulMat.uniforms.uT.value = Math.max(0, el / 1000);
        active = true;
      }
    }
    if (this.glintSprite.visible) {
      const k = (now - this.glintT.t0) / this.glintT.dur;
      if (k >= 1) this.glintSprite.visible = false;
      else {
        const kk = Math.max(0, k);
        const s = this.glintSize * Math.sin(Math.PI * Math.min(1, kk * 1.25)) + 0.001;
        this.glintSprite.scale.set(s, s, 1);
        this.glintMat.rotation = kk * 1.2;
        this.glintMat.opacity = 1 - kk * kk;
        active = true;
      }
    }
    if (this.trailCount > 0) {
      active = this.updateTrail(now) || active;
    }
    return active;
  }

  private updateTrail(now: number): boolean {
    // Drop samples that fully faded (oldest first).
    let drop = 0;
    while (drop < this.trailCount && now - this.trailTimes[drop] >= this.trailLife) drop++;
    if (drop > 0) {
      this.trailPts.copyWithin(0, drop * 3, this.trailCount * 3);
      this.trailTimes.copyWithin(0, drop, this.trailCount);
      this.trailCount -= drop;
    }
    const n = this.trailCount;
    if (n < 2) {
      this.trailMesh.visible = false;
      if (n === 0 || !this.trailLive) this.trailCount = this.trailLive ? n : 0;
      return this.trailLive;
    }
    const ax = this.trailAxis;
    for (let i = 0; i < TRAIL_N; i++) {
      const j = Math.min(i, n - 1);
      const px = this.trailPts[j * 3];
      const py = this.trailPts[j * 3 + 1];
      const pz = this.trailPts[j * 3 + 2];
      const age = Math.min(1, (now - this.trailTimes[j]) / this.trailLife);
      const along = n > 1 ? j / (n - 1) : 1;
      const a = i < n ? (1 - age) * (0.25 + 0.75 * along) : 0;
      const w = this.trailWidth * (0.35 + 0.65 * along) * (1 - age * 0.5) * 0.5;
      const o = i * 6;
      this.trailPos[o] = px - ax.x * w;
      this.trailPos[o + 1] = py - ax.y * w;
      this.trailPos[o + 2] = pz - ax.z * w;
      this.trailPos[o + 3] = px + ax.x * w;
      this.trailPos[o + 4] = py + ax.y * w;
      this.trailPos[o + 5] = pz + ax.z * w;
      this.trailAlpha[i * 2] = a;
      this.trailAlpha[i * 2 + 1] = a;
    }
    (this.trailGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.trailGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    this.trailGeo.setDrawRange(0, (n - 1) * 6);
    this.trailMesh.visible = true;
    return true;
  }

  /** Hide everything immediately. */
  clear(): void {
    for (const g of this.grounds) g.mesh.visible = false;
    this.slashMesh.visible = false;
    this.pillarMesh.visible = false;
    this.soulPoints.visible = false;
    this.glintSprite.visible = false;
    this.trailMesh.visible = false;
    this.trailCount = 0;
    this.trailLive = false;
  }

  dispose(): void {
    this.clear();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.group.clear();
  }
}
