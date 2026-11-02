/**
 * Three.js WebGL board view: a premium "tactical fantasy arena" (12x12, procedural, render-on-demand).
 *
 * World mapping: x = c - 5.5 (col 0 at screen left), z = 5.5 - r (row 0 nearest the camera,
 * i.e. player 0 at the bottom of the screen), y = up. Tile tops are at y = TILE_TOP.
 *
 * Units are animated glTF characters (src/render/units, public/models/*.glb): one merged skinned
 * draw call each (body + procedural gear), AnimationMixer per piece (idle loop / run / jump /
 * attack / death) plus cloth/wing secondary motion, facing from Piece.dir with a smooth turn.
 * Per piece: ground decal (shadow + rarity glow) and puck (base + ring + level pips) are one draw
 * each; Lv2 adds idle particles, Lv3 a rotating rune and a light shaft. Moves kick up pooled dust,
 * captures throw spark streaks + a shockwave and dissolve the victim; new units pop in with a
 * flash. Until the models load (or if they fail) pieces show silhouettes.
 *
 * Storm (setStorm): consumed outer columns get the storm.ts energy field (one additive draw), their
 * tiles are dimmed, and pieces that vanish from the piece list while the storm is active (not a
 * move's capture) dissolve with a magenta storm edge instead of popping out.
 *
 * Performance notes: tiles are one InstancedMesh, overlays are InstancedMeshes, effects reuse
 * pre-allocated meshes (no per-frame / per-move allocations), one 1024 shadow map, pixel ratio
 * capped at 2. Frames are only requested while something is animating: moves/effects at full
 * rate, the selection pulse at ~30 fps, unit idle loops at ~24 fps (off with prefers-reduced-motion
 * or setIdleAnimation(false), paused while the tab is hidden).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOARD_SIZE, ZONE_DEPTH } from '../engine/types';
import type { Level, Move, Piece, PlayerId, Pos, Rarity } from '../engine/types';
import type { BoardHighlights, BoardViewMode, IBoardView } from './types';
import { UnitActor } from './units/actor';
import { loadUnitAssets, unitAssetsIfLoaded } from './units/assets';
import { LOOKS, MOVE_CLIP } from './units/config';
import { UnitLibrary } from './units/library';
import { DustPool, SparkPool } from './boardFx';
import { ANIM, BOARD_COLORS, CHARACTER_RARITY, RARITY_COLORS, RARITY_GLOW, TEAM_COLORS } from './palette';
import { STORM_COLORS, StormFx } from './storm';
import {
  clamp01,
  containerSize,
  easeInOutCubic,
  easeOutCubic,
  hexToRgb,
  indexHighlights,
  makeRng,
  mixRgb,
  posKey,
  pulse01,
  sameLook,
  shakeOffset,
  slideDuration,
  tileRgb,
} from './common';
import type { HighlightIndex } from './common';
import {
  makeBackdropTexture,
  makeBandTexture,
  makeBlobTexture,
  makeCometTexture,
  makeDotTexture,
  makeGlowTexture,
  makeSlabTexture,
  makeTileTexture,
} from './textures';

const HALF = (BOARD_SIZE - 1) / 2; // 5.5
const TILE_SIZE = 0.93;
const TILE_H = 0.09;
const TILE_TOP = TILE_H;
const SLAB_MARGIN = 0.34;
const SLAB_H = 0.4;
const SLAB_SIZE = BOARD_SIZE + SLAB_MARGIN * 2;
const OVERLAY_Y = TILE_TOP + 0.005;
const SELECT_LIFT = 0.12;
const TAP_SLOP_PX = 14;
/** Camera blend between the tilted arena view and the top-down view. */
const VIEW_TRANSITION_MS = 520;
const TILT_FOV = 34;
const TOP_FOV = 24;
const TOP_ELEVATION_DEG = 89;
const MAX_PIXEL_RATIO = 2;
const IDLE_FRAME_MS = 32; // idle pulse (selection / targets) is capped at ~30 fps
const IDLE_ANIM_FRAME_MS = 41; // unit idle loops alone run at ~24 fps
/** Attack clip length on the board (ms) and the victim's death clip length (ms). */
const ATTACK_MS = 440;
const DEATH_MS = 280;
/** Upper bound for a capture move (ms) so turns stay snappy. */
const MOVE_BUDGET_MS = 560;
/** Facing turn time (s) when a piece's forward direction changes / after a move. */
const TURN_S = 0.25;
/** Height of the puck top above the tile (models stand on it). */
const PUCK_TOP = 0.14;
/** Rows between the zone edge lines (world z of the line between home zone and no-man's land). */
const ZONE_LINE_Z: Record<PlayerId, number> = {
  0: HALF - (ZONE_DEPTH - 0.5),
  1: -(HALF - (ZONE_DEPTH - 0.5)),
};
const BURST_COUNT = 14;

const cellX = (c: number): number => c - HALF;
const cellZ = (r: number): number => HALF - r;

interface PieceVisual {
  piece: Piece;
  /** Positioned on the square (x/z); never lifted. Carries userData.pieceId. */
  root: THREE.Group;
  /** Lifted / bobbed / squashed part (puck + body). Origin sits on the tile top. */
  inner: THREE.Group;
  /** Animated glTF unit (null while the models load or if they failed: `body` is a silhouette). */
  actor: UnitActor | null;
  body: THREE.Object3D | null;
  /** Invisible tap target sized to the unit (the only thing the picker raycasts). */
  proxy: THREE.Mesh;
}

/** Yaw (radians, model faces +z at 0) for a piece's forward direction (+1 = toward row 11 = -z). */
const forwardYaw = (p: Piece): number => ((p.dir ?? (p.owner === 0 ? 1 : -1)) === 1 ? Math.PI : 0);

interface RunningAnim {
  start: number;
  duration: number;
  moveDur: number;
  mover: PieceVisual;
  from: THREE.Vector3;
  to: THREE.Vector3;
  jump: boolean;
  jumpHeight: number;
  landed: boolean;
  captured: PieceVisual | null;
  capturedOwner: PlayerId;
  capturedAt: THREE.Vector3;
  captureStart: number;
  capFired: boolean;
  deathMs: number;
  attackStart: number;
  attackFired: boolean;
  /** Next footstep dust time (ms since start). */
  nextDust: number;
  piecesAfter: Piece[];
  resolve: () => void;
}

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** Dust colours (sRGB hex numbers). */
const DUST = 0xc9b9a0;
const EMBER = 0xff7a2a;
const SPAWN_MS = 380;
/** Storm removal: dissolve length (ms), dust colour and tile tint. */
const STORM_MS = 520;
const STORM_DUST = 0x9a4bff;
const STORM_TILE = hexToRgb(STORM_COLORS.tile);
const STORM_TILE_STRENGTH = 0.62;

/** Adds a fresnel rim light (team light color) to a standard material's emissive term. */
function addRim(mat: THREE.MeshStandardMaterial, rimHex: string, strength: number, power = 2.3): void {
  const rim = new THREE.Color(rimHex);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rim };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += rimColor * (pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), ${power.toFixed(1)}) * ${strength.toFixed(2)});`,
      );
  };
  mat.customProgramCacheKey = () => `rim${power}-${strength}`;
}

/**
 * Ground decal under a piece in ONE draw: contact shadow (darkens, alpha) + rarity glow (adds),
 * premultiplied blending (src ONE, dst ONE_MINUS_SRC_ALPHA).
 */
function makeGroundDecalMaterial(blob: THREE.Texture, glow: THREE.Texture, color: string, glowAmt: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uBlob: { value: blob }, uGlow: { value: glow }, uColor: { value: new THREE.Color(color) }, uGlowAmt: { value: glowAmt } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uBlob; uniform sampler2D uGlow; uniform vec3 uColor; uniform float uGlowAmt; varying vec2 vUv;
      void main(){
        // Shadow blob: 1.12 wide, offset (+0.04, +0.06) inside the 1.5-wide decal.
        vec2 bu = (vUv - 0.5) * (1.5 / 1.12) + 0.5 - vec2(0.04, -0.06) / 1.12;
        float sh = texture2D(uBlob, clamp(bu, 0.0, 1.0)).a * 0.7 * step(0.0, bu.x) * step(bu.x, 1.0) * step(0.0, bu.y) * step(bu.y, 1.0);
        float g = texture2D(uGlow, vUv).a * uGlowAmt;
        gl_FragColor = vec4(uColor * g, sh);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/** Puck material: vertex colours + per-vertex emissive (x) and rim (y) from `aEmit`. */
function makePuckMaterial(rimHex: string): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05 });
  const rim = new THREE.Color(rimHex);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aEmit;\nvarying vec2 vEmit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = aEmit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nvarying vec2 vEmit;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vEmit.x;
        totalEmissiveRadiance += uRim * pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.0) * vEmit.y;`,
      );
  };
  mat.customProgramCacheKey = () => 'puck-v2';
  return mat;
}

/** Shared geometries & materials for every piece (one set per BoardView instance). */
class PieceKit {
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  readonly textures: THREE.Texture[] = [];

  readonly groundPlane: THREE.BufferGeometry;
  readonly burstBit: THREE.BufferGeometry;
  /** Loading / failure silhouette (capsule body + head) and the invisible pick proxy. */
  readonly capsule: THREE.BufferGeometry;
  readonly capsuleHead: THREE.BufferGeometry;
  readonly proxyGeo: THREE.BufferGeometry;
  readonly proxyMat: THREE.MeshBasicMaterial;
  readonly silhouette: Record<PlayerId, THREE.MeshStandardMaterial>;
  readonly puckMat: THREE.MeshStandardMaterial;
  private readonly decal = new Map<Rarity, THREE.ShaderMaterial>();
  private readonly pucks = new Map<string, THREE.BufferGeometry>();
  private readonly glowTex: THREE.Texture;
  private readonly blobTex: THREE.Texture;

  constructor() {
    const g = <T extends THREE.BufferGeometry>(geo: T): T => {
      this.geometries.push(geo);
      return geo;
    };
    const m = <T extends THREE.Material>(mat: T): T => {
      this.materials.push(mat);
      return mat;
    };

    this.groundPlane = g(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2));
    this.burstBit = g(new THREE.IcosahedronGeometry(0.095, 0));
    this.capsule = g(new THREE.CapsuleGeometry(0.2, 0.36, 6, 16).translate(0, 0.38, 0));
    this.capsuleHead = g(new THREE.SphereGeometry(0.17, 16, 12).translate(0, 0.84, 0));
    this.proxyGeo = g(new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0));
    this.proxyMat = m(new THREE.MeshBasicMaterial({ visible: false }));

    const sil = (id: PlayerId): THREE.MeshStandardMaterial => {
      const mat = m(
        new THREE.MeshStandardMaterial({ color: TEAM_COLORS[id].main, roughness: 0.5, metalness: 0.05, emissive: TEAM_COLORS[id].dark, emissiveIntensity: 0.25 }),
      );
      addRim(mat, TEAM_COLORS[id].light, 0.8, 2.2);
      return mat;
    };
    this.silhouette = { 0: sil(0), 1: sil(1) };
    this.glowTex = makeGlowTexture();
    this.blobTex = makeBlobTexture();
    this.textures.push(this.glowTex, this.blobTex);
    this.puckMat = m(makePuckMaterial('#B7C8F5'));
  }

  /** Contact shadow + rarity floor glow material (cached per rarity). */
  private decalMat(r: Rarity): THREE.ShaderMaterial {
    let mat = this.decal.get(r);
    if (!mat) {
      mat = makeGroundDecalMaterial(this.blobTex, this.glowTex, RARITY_COLORS[r], 0.12 + 0.5 * RARITY_GLOW[r]);
      this.materials.push(mat);
      this.decal.set(r, mat);
    }
    return mat;
  }

  /** Base puck + rarity ring + level pips merged into one vertex-coloured geometry. */
  private puck(r: Rarity, level: Level): THREE.BufferGeometry {
    const key = `${r}:${level}`;
    let geo = this.pucks.get(key);
    if (geo) return geo;
    const profile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.375, 0),
      new THREE.Vector2(0.4, 0.022),
      new THREE.Vector2(0.405, 0.085),
      new THREE.Vector2(0.38, 0.125),
      new THREE.Vector2(0.33, 0.14),
      new THREE.Vector2(0, 0.14),
    ];
    const parts: { geo: THREE.BufferGeometry; color: string; emit: number; rim: number }[] = [
      { geo: new THREE.LatheGeometry(profile, 32), color: BOARD_COLORS.pieceBase, emit: 0.12, rim: 0.9 },
      {
        geo: new THREE.TorusGeometry(0.41, 0.058, 8, 48).rotateX(Math.PI / 2).translate(0, 0.07, 0),
        color: RARITY_COLORS[r],
        emit: 0.5 + 1.0 * RARITY_GLOW[r],
        rim: 0,
      },
    ];
    // Level pips: gold gems on the puck lip facing the camera (+z), centered.
    const spread = 0.34;
    for (let i = 0; i < level; i++) {
      const a = (i - (level - 1) / 2) * spread;
      parts.push({
        geo: new THREE.SphereGeometry(0.063, 12, 8).translate(Math.sin(a) * 0.35, 0.145, Math.cos(a) * 0.35),
        color: BOARD_COLORS.pip,
        emit: 1.1,
        rim: 0,
      });
    }
    let vCount = 0;
    let iCount = 0;
    for (const p of parts) {
      vCount += p.geo.attributes.position.count;
      iCount += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const emit = new Float32Array(vCount * 2);
    const idx = new Uint16Array(iCount);
    let vo = 0;
    let io = 0;
    const c = new THREE.Color();
    for (const p of parts) {
      const P = p.geo.attributes.position;
      const N = p.geo.attributes.normal;
      c.set(p.color);
      for (let i = 0; i < P.count; i++) {
        pos.set([P.getX(i), P.getY(i), P.getZ(i)], (vo + i) * 3);
        nor.set([N.getX(i), N.getY(i), N.getZ(i)], (vo + i) * 3);
        col.set([c.r, c.g, c.b], (vo + i) * 3);
        emit[(vo + i) * 2] = p.emit;
        emit[(vo + i) * 2 + 1] = p.rim;
      }
      if (p.geo.index) {
        for (let k = 0; k < p.geo.index.count; k++) idx[io + k] = p.geo.index.getX(k) + vo;
        io += p.geo.index.count;
      } else {
        for (let k = 0; k < P.count; k++) idx[io + k] = vo + k;
        io += P.count;
      }
      vo += P.count;
      p.geo.dispose();
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aEmit', new THREE.BufferAttribute(emit, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.geometries.push(geo);
    this.pucks.set(key, geo);
    return geo;
  }

  build(p: Piece): { root: THREE.Group; inner: THREE.Group } {
    const root = new THREE.Group();
    root.userData.pieceId = p.id;
    const rar = CHARACTER_RARITY[p.character];

    // Contact shadow + rarity floor glow (ground level, never lifted): one decal draw.
    const decal = new THREE.Mesh(this.groundPlane, this.decalMat(rar));
    decal.position.y = TILE_TOP + 0.005;
    decal.renderOrder = 1;
    decal.raycast = () => undefined;
    root.add(decal);

    const inner = new THREE.Group();
    inner.position.y = TILE_TOP;
    root.add(inner);

    // Puck + rarity ring + level pips: one draw (+ one shadow draw).
    const puck = new THREE.Mesh(this.puck(rar, p.level), this.puckMat);
    puck.castShadow = false; // the decal already carries the contact shadow
    puck.receiveShadow = false;
    puck.raycast = () => undefined;
    inner.add(puck);
    return { root, inner };
  }

  /** Simple team-coloured capsule unit (models loading / failed to load). */
  silhouetteBody(owner: PlayerId): THREE.Group {
    const g = new THREE.Group();
    for (const geo of [this.capsule, this.capsuleHead]) {
      const me = new THREE.Mesh(geo, this.silhouette[owner]);
      me.castShadow = true;
      g.add(me);
    }
    return g;
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const t of this.textures) t.dispose();
    this.decal.clear();
    this.pucks.clear();
  }
}

export class BoardView implements IBoardView {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  private readonly kit = new PieceKit();
  private readonly ownGeometries: THREE.BufferGeometry[] = [];
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly ownTextures: THREE.Texture[] = [];

  private readonly tiles: THREE.InstancedMesh;
  private readonly moveDots: THREE.InstancedMesh;
  private readonly captureRings: THREE.InstancedMesh;
  private readonly captureGlow: THREE.InstancedMesh;
  private readonly selectRing: THREE.Mesh;
  private readonly selectGlow: THREE.Mesh;
  private readonly pieceLayer = new THREE.Group();
  private readonly fxLayer = new THREE.Group();

  // Effects (pre-allocated, reused).
  private readonly landRing: THREE.Mesh;
  private readonly landMat: THREE.MeshBasicMaterial;
  private readonly shockRing: THREE.Mesh;
  private readonly shockMat: THREE.MeshBasicMaterial;
  private readonly flash: THREE.Sprite;
  private readonly flashMat: THREE.SpriteMaterial;
  private readonly burst: THREE.InstancedMesh;
  private readonly burstMat: THREE.MeshBasicMaterial;
  private readonly burstDirs: THREE.Vector3[] = [];
  private readonly burstOrigin = new THREE.Vector3();
  private readonly zoneLine: Record<PlayerId, THREE.Mesh> = {} as Record<PlayerId, THREE.Mesh>;
  private readonly zoneHalo: Record<PlayerId, THREE.Mesh> = {} as Record<PlayerId, THREE.Mesh>;
  private readonly zoneLineMat: Record<PlayerId, THREE.MeshBasicMaterial> = {} as Record<PlayerId, THREE.MeshBasicMaterial>;
  private readonly zoneHaloMat: Record<PlayerId, THREE.MeshBasicMaterial> = {} as Record<PlayerId, THREE.MeshBasicMaterial>;
  private readonly comet: THREE.Mesh;
  private readonly cometMat: THREE.MeshBasicMaterial;
  private readonly stormFx: StormFx;
  /** Storm state (see setStorm). */
  private storm = 0;
  private stormNext: number | null = null;
  /** Pieces being taken by the storm (detached from `visuals`, dissolving) + their shared start. */
  private readonly fading: PieceVisual[] = [];
  private tStormFade = -1;
  private tLand = -1;
  private tCap = -1;
  private tShake = -1;
  private tTurn = -1;
  private turn: PlayerId = 0;
  private turnFxPlayer: PlayerId = 0;

  private readonly visuals = new Map<string, PieceVisual>();
  /** glTF unit factory (null until the models are loaded, or if loading failed). */
  private units: UnitLibrary | null = null;
  /** Point-sprite scale shared with the unit FX (drawing-buffer px per world unit at distance 1). */
  private readonly pointScale = { value: 600 };
  private readonly dust: DustPool;
  private readonly sparks: SparkPool;
  /** Spawn-in (match start / level change): start time and the visuals popping in. */
  private tSpawn = -1;
  private readonly spawning: PieceVisual[] = [];
  private lastFx = 0;
  /** Unit idle loops (breathing etc.) at ~24 fps; off for prefers-reduced-motion. */
  private idleAnim = true;
  private lastTick = 0;
  private readonly pickList: THREE.Object3D[] = [];
  private highlights: BoardHighlights = {};
  private hi: HighlightIndex = indexHighlights({});
  private placedMoves: Pos[] = [];
  private placedCaps: Pos[] = [];
  private selVisual: PieceVisual | null = null;
  private pulsing = false;
  private lastFrame = 0;

  private cellCb: ((pos: Pos) => void) | null = null;
  private interactive = true;
  private anim: RunningAnim | null = null;
  private rafId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private down: { id: number; x: number; y: number } | null = null;

  /**
   * Camera view: 0 = tilted 3D arena view, 1 = top-down. Animated between the two by
   * setViewMode (viewFrom -> viewTo over VIEW_TRANSITION_MS starting at tView).
   */
  private viewT = 0;
  private viewFrom = 0;
  private viewTo = 0;
  private tView = -1;
  private lastAspect = 1;
  private lastHeightPx = 1;

  // Camera shake basis (computed in fitCamera).
  private readonly camBase = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private pxWorld = 0.01;
  private shaking = false;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_TOP);
  private readonly pickNdc = new THREE.Vector2();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpC = new THREE.Color();

  constructor(container: HTMLElement) {
    this.container = container;
    // Throws if WebGL is unavailable -> createBoardView falls back to 2D.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    const gl = this.renderer.getContext();
    if (!gl) throw new Error('WebGL context unavailable');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setClearColor(BOARD_COLORS.background, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r18x; radius softens
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';
    (canvas.style as CSSStyleDeclaration & { webkitTapHighlightColor?: string }).webkitTapHighlightColor =
      'transparent';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(canvas);

    const glowTex = makeGlowTexture();
    this.ownTextures.push(glowTex);
    try {
      this.idleAnim = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      this.idleAnim = true;
    }

    const backdrop = makeBackdropTexture();
    this.ownTextures.push(backdrop);
    this.scene.background = backdrop;

    this.buildLights();
    this.buildBoard(glowTex);

    this.tiles = this.buildTiles();
    const overlays = this.buildOverlays(glowTex);
    this.moveDots = overlays.dots;
    this.captureRings = overlays.rings;
    this.captureGlow = overlays.ringGlow;
    this.selectRing = overlays.select;
    this.selectGlow = overlays.selectGlow;

    const zl = this.buildZoneLines();
    this.comet = zl.comet;
    this.cometMat = zl.cometMat;
    this.stormFx = new StormFx(OVERLAY_Y + 0.004);
    this.scene.add(this.stormFx.mesh);

    const fx = this.buildFx(glowTex);
    this.landRing = fx.landRing;
    this.landMat = fx.landMat;
    this.shockRing = fx.shockRing;
    this.shockMat = fx.shockMat;
    this.flash = fx.flash;
    this.flashMat = fx.flashMat;
    this.burst = fx.burst;
    this.burstMat = fx.burstMat;
    this.dust = new DustPool(160, this.pointScale);
    this.sparks = new SparkPool(40);
    this.fxLayer.add(this.dust.points, this.sparks.mesh);

    this.scene.add(this.pieceLayer, this.fxLayer);
    this.applyHighlights();
    this.applyZoneLines(0);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    this.initUnits();
  }

  /** Use the cached unit models, or load them; pieces show silhouettes until they arrive. */
  private initUnits(): void {
    const ready = unitAssetsIfLoaded();
    if (ready) {
      this.units = new UnitLibrary(ready, this.pointScale);
      return;
    }
    loadUnitAssets().then(
      (assets) => {
        if (this.disposed) return;
        this.units = new UnitLibrary(assets, this.pointScale);
        this.rebuildBodies();
      },
      (err: unknown) => {
        console.warn('[render] unit models failed to load, using silhouettes:', err);
      },
    );
  }

  // ---------------------------------------------------------------- scene setup

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xdbe6ff, 0x34406a, 2.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.9);
    sun.position.set(-5, 14, 8);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera;
    s.left = -8.5;
    s.right = 8.5;
    s.top = 8.5;
    s.bottom = -8.5;
    s.near = 4;
    s.far = 30;
    sun.shadow.radius = 3;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
  }

  private buildBoard(glowTex: THREE.Texture): void {
    // Raised rounded stone slab with an inlaid team-colored frame.
    const slabGeo = new RoundedBoxGeometry(SLAB_SIZE, SLAB_H, SLAB_SIZE, 3, 0.2);
    slabGeo.translate(0, -SLAB_H / 2 + 0.001, 0);
    const slabTex = makeSlabTexture(SLAB_SIZE, SLAB_MARGIN);
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: slabTex, roughness: 0.8 });
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.receiveShadow = true;
    this.scene.add(slab);
    this.ownGeometries.push(slabGeo);
    this.ownMaterials.push(slabMat);
    this.ownTextures.push(slabTex);

    // Under-glow: a faint cool halo that lifts the slab off the dark backdrop.
    const ugGeo = new THREE.PlaneGeometry(SLAB_SIZE * 1.5, SLAB_SIZE * 1.5).rotateX(-Math.PI / 2);
    const ugMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: '#3f5fe0',
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ug = new THREE.Mesh(ugGeo, ugMat);
    ug.position.y = -SLAB_H - 0.02;
    ug.renderOrder = -2;
    this.scene.add(ug);
    this.ownGeometries.push(ugGeo);
    this.ownMaterials.push(ugMat);
  }

  private buildTiles(): THREE.InstancedMesh {
    const geo = new RoundedBoxGeometry(TILE_SIZE, TILE_H, TILE_SIZE, 2, 0.05);
    geo.translate(0, TILE_H / 2, 0);
    const tex = makeTileTexture();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.82, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, BOARD_SIZE * BOARD_SIZE);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        this.tmpM.makeTranslation(cellX(c), 0, cellZ(r));
        mesh.setMatrixAt(r * BOARD_SIZE + c, this.tmpM);
        mesh.setColorAt(r * BOARD_SIZE + c, this.tmpC.set(0xffffff));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.ownGeometries.push(geo);
    this.ownMaterials.push(mat);
    this.ownTextures.push(tex);
    return mesh;
  }

  private buildOverlays(glowTex: THREE.Texture): {
    dots: THREE.InstancedMesh;
    rings: THREE.InstancedMesh;
    ringGlow: THREE.InstancedMesh;
    select: THREE.Mesh;
    selectGlow: THREE.Mesh;
  } {
    const n = BOARD_SIZE * BOARD_SIZE;
    const mat = (
      color: string,
      opacity: number,
      additive: boolean,
      map: THREE.Texture | null = null,
    ): THREE.MeshBasicMaterial => {
      const mm = new THREE.MeshBasicMaterial({
        color,
        map,
        transparent: true,
        opacity,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.ownMaterials.push(mm);
      return mm;
    };

    const dotTex = makeDotTexture();
    this.ownTextures.push(dotTex);
    const dotGeo = new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2);
    const dots = new THREE.InstancedMesh(dotGeo, mat(BOARD_COLORS.moveDot, BOARD_COLORS.moveDotAlpha, true, dotTex), n);
    dots.count = 0;
    dots.renderOrder = 2;
    dots.frustumCulled = false;

    const ringGeo = new THREE.RingGeometry(0.41, 0.5, 40).rotateX(-Math.PI / 2);
    const rings = new THREE.InstancedMesh(ringGeo, mat(BOARD_COLORS.capture, 0.95, false), n);
    rings.count = 0;
    rings.renderOrder = 3;
    rings.frustumCulled = false;

    const glowGeo = new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2);
    const ringGlow = new THREE.InstancedMesh(glowGeo, mat(BOARD_COLORS.capture, 0.7, true, glowTex), n);
    ringGlow.count = 0;
    ringGlow.renderOrder = 2;
    ringGlow.frustumCulled = false;

    const selGeo = new THREE.RingGeometry(0.43, 0.5, 44).rotateX(-Math.PI / 2);
    const select = new THREE.Mesh(selGeo, mat(BOARD_COLORS.selected, 1, true));
    select.visible = false;
    select.renderOrder = 3;
    const selectGlow = new THREE.Mesh(glowGeo, mat(BOARD_COLORS.selected, 0.6, true, glowTex));
    selectGlow.visible = false;
    selectGlow.renderOrder = 2;

    this.ownGeometries.push(dotGeo, ringGeo, glowGeo, selGeo);
    this.scene.add(dots, rings, ringGlow, select, selectGlow);
    return { dots, rings, ringGlow, select, selectGlow };
  }

  /** Glowing home-zone edge lines (one per team) + a comet used for the turn sweep. */
  private buildZoneLines(): { comet: THREE.Mesh; cometMat: THREE.MeshBasicMaterial } {
    const bandTex = makeBandTexture();
    const cometTex = makeCometTexture();
    this.ownTextures.push(bandTex, cometTex);
    const lineGeo = new THREE.PlaneGeometry(BOARD_SIZE - 0.1, 0.09).rotateX(-Math.PI / 2);
    const haloGeo = new THREE.PlaneGeometry(BOARD_SIZE + 0.1, 1.0).rotateX(-Math.PI / 2);
    const cometGeo = new THREE.PlaneGeometry(3.2, 0.34).rotateX(-Math.PI / 2);
    this.ownGeometries.push(lineGeo, haloGeo, cometGeo);
    const add = (id: PlayerId): void => {
      const color = TEAM_COLORS[id].glow;
      const base = {
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      };
      const lineMat = new THREE.MeshBasicMaterial({ ...base, opacity: 0.8 });
      const haloMat = new THREE.MeshBasicMaterial({ ...base, map: bandTex, opacity: 0.35 });
      this.ownMaterials.push(lineMat, haloMat);
      const line = new THREE.Mesh(lineGeo, lineMat);
      const halo = new THREE.Mesh(haloGeo, haloMat);
      line.position.set(0, OVERLAY_Y + 0.001, ZONE_LINE_Z[id]);
      halo.position.set(0, OVERLAY_Y, ZONE_LINE_Z[id]);
      line.renderOrder = 4;
      halo.renderOrder = 3;
      this.scene.add(halo, line);
      this.zoneLine[id] = line;
      this.zoneHalo[id] = halo;
      this.zoneLineMat[id] = lineMat;
      this.zoneHaloMat[id] = haloMat;
    };
    add(0);
    add(1);
    const cometMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      map: cometTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.ownMaterials.push(cometMat);
    const comet = new THREE.Mesh(cometGeo, cometMat);
    comet.visible = false;
    comet.renderOrder = 5;
    this.scene.add(comet);
    return { comet, cometMat };
  }

  private buildFx(glowTex: THREE.Texture): {
    landRing: THREE.Mesh;
    landMat: THREE.MeshBasicMaterial;
    shockRing: THREE.Mesh;
    shockMat: THREE.MeshBasicMaterial;
    flash: THREE.Sprite;
    flashMat: THREE.SpriteMaterial;
    burst: THREE.InstancedMesh;
    burstMat: THREE.MeshBasicMaterial;
  } {
    const ringGeo = new THREE.RingGeometry(0.4, 0.5, 48).rotateX(-Math.PI / 2);
    this.ownGeometries.push(ringGeo);
    const ringMat = (): THREE.MeshBasicMaterial => {
      const mm = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      this.ownMaterials.push(mm);
      return mm;
    };
    const landMat = ringMat();
    const landRing = new THREE.Mesh(ringGeo, landMat);
    landRing.visible = false;
    landRing.renderOrder = 5;
    const shockMat = ringMat();
    const shockRing = new THREE.Mesh(ringGeo, shockMat);
    shockRing.visible = false;
    shockRing.renderOrder = 5;

    const flashMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.ownMaterials.push(flashMat);
    const flash = new THREE.Sprite(flashMat);
    flash.visible = false;
    flash.renderOrder = 10;

    const burstMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ownMaterials.push(burstMat);
    const burst = new THREE.InstancedMesh(this.kit.burstBit, burstMat, BURST_COUNT);
    burst.visible = false;
    burst.frustumCulled = false;
    burst.renderOrder = 9;
    const rnd = makeRng(5);
    for (let i = 0; i < BURST_COUNT; i++) {
      const a = (i / BURST_COUNT) * Math.PI * 2 + rnd() * 0.4;
      this.burstDirs.push(
        new THREE.Vector3(Math.cos(a), 0.9 + rnd() * 0.9, Math.sin(a)).multiplyScalar(0.9 + rnd() * 0.5),
      );
    }
    this.fxLayer.add(landRing, shockRing, flash, burst);
    return { landRing, landMat, shockRing, shockMat, flash, flashMat, burst, burstMat };
  }

  // ---------------------------------------------------------------- public API

  setPieces(pieces: Piece[]): void {
    if (this.disposed) return;
    this.finishAnimation(false);
    this.syncPieces(pieces, true);
    this.requestRender();
  }

  animateMove(move: Move, piecesAfter: Piece[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishAnimation(false);
    const mover = this.visuals.get(move.pieceId) ?? null;
    if (!mover) {
      this.syncPieces(piecesAfter);
      this.requestRender();
      return Promise.resolve();
    }

    // Detach the captured piece from tracking: it lives only for the effect.
    let captured: PieceVisual | null = null;
    let capturedOwner: PlayerId = mover.piece.owner === 0 ? 1 : 0;
    const capturedAt = new THREE.Vector3(cellX(move.to.c), 0, cellZ(move.to.r));
    if (move.captureId) {
      const cv = this.visuals.get(move.captureId);
      if (cv) {
        this.visuals.delete(move.captureId);
        captured = cv;
        capturedOwner = cv.piece.owner;
        capturedAt.copy(cv.root.position);
        cv.root.traverse((o) => {
          o.castShadow = false;
        });
      }
    }

    const jump = mover.piece.character === 'walk';
    const moveDur = jump ? ANIM.jump : slideDuration(move);
    const captureStart = captured ? moveDur * (jump ? 0.85 : 0.8) : moveDur;
    // Keep every move (capture included) inside ~560 ms: the death clip absorbs the difference.
    const deathMs = Math.max(200, Math.min(DEATH_MS, MOVE_BUDGET_MS - captureStart));
    const duration = Math.max(moveDur + (jump ? ANIM.land : 40), captured ? captureStart + deathMs : 0);
    const from = mover.root.position.clone();
    from.y = 0;
    const to = new THREE.Vector3(cellX(move.to.c), 0, cellZ(move.to.r));
    const dist = Math.hypot(move.to.r - move.from.r, move.to.c - move.from.c);

    // Unit animation: face the travel direction, run / jump, strike so the impact frame lands on
    // the capture, the victim turns to the attacker and plays its death.
    const actor = mover.actor;
    let attackStart = Infinity;
    if (actor) {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      if (dx * dx + dz * dz > 1e-6) actor.face(Math.atan2(dx, dz), 0.12);
      const clip = MOVE_CLIP[mover.piece.character];
      if (clip === 'jump' && actor.has('jump')) {
        actor.play('jump', { once: true, fade: 0.06, timeScale: actor.clipDuration('jump') / ((moveDur + ANIM.land) / 1000) });
      } else {
        actor.play('run', { fade: 0.08, timeScale: 1.55 });
      }
      if (captured && actor.has('attack')) {
        const lead = LOOKS[mover.piece.character].impact * ATTACK_MS;
        attackStart = Math.max(0, captureStart - lead);
      }
    }
    if (captured?.actor) {
      const dx = from.x - capturedAt.x;
      const dz = from.z - capturedAt.z;
      if (dx * dx + dz * dz > 1e-6) captured.actor.face(Math.atan2(dx, dz), 0.15);
    }

    return new Promise<void>((resolve) => {
      this.anim = {
        start: performance.now(),
        duration,
        moveDur,
        mover,
        from,
        to,
        jump,
        // The jump clip already lifts the body: a lower arc keeps the unit on screen.
        jumpHeight: (0.7 + Math.min(dist, 6) * 0.12) * (actor?.has('jump') ? 0.6 : 1),
        landed: false,
        captured,
        capturedOwner,
        capturedAt,
        captureStart,
        capFired: false,
        deathMs,
        attackStart,
        attackFired: false,
        nextDust: 0,
        piecesAfter,
        resolve,
      };
      this.requestRender();
    });
  }

  setHighlights(h: BoardHighlights): void {
    if (this.disposed) return;
    this.highlights = h;
    this.hi = indexHighlights(h);
    this.applyHighlights();
    this.requestRender();
  }

  onCellClick(cb: (pos: Pos) => void): void {
    this.cellCb = cb;
  }

  setInteractive(enabled: boolean): void {
    this.interactive = enabled;
    if (!enabled) this.down = null;
    this.renderer.domElement.style.cursor = enabled ? 'pointer' : 'default';
  }

  /**
   * Optional extra (not part of IBoardView): the side to move changed. Brightens that side's
   * home-zone edge line and plays a short light sweep along it.
   */
  setTurn(player: 0 | 1): void {
    if (this.disposed) return;
    this.turn = player;
    this.turnFxPlayer = player;
    this.tTurn = performance.now();
    this.applyZoneLines(0);
    this.requestRender();
  }

  /** Optional extra: enable/disable the units' idle loops (battery saver). */
  setIdleAnimation(enabled: boolean): void {
    this.idleAnim = enabled;
    this.requestRender();
  }

  /**
   * Storm state: `storm` columns consumed per side (0 = none), `nextIn` plies until the next shrink
   * (null = inactive). Consumed columns get the energy field and dimmed tiles; with nextIn <= 2 the
   * next columns pulse a warning frame. Storm tiles stay tappable (the engine rejects moves there).
   */
  setStorm(storm: number, nextIn: number | null): void {
    if (this.disposed) return;
    this.storm = Math.max(0, Math.min(6, Math.floor(storm)));
    this.stormNext = nextIn;
    this.stormFx.set(this.storm, nextIn);
    this.applyHighlights();
    this.requestRender();
  }

  /** True while the storm rule is in play (anything vanishing near the edges is a storm removal). */
  private get stormActive(): boolean {
    return this.storm > 0 || this.stormNext !== null;
  }

  /** Column inside the storm, or the next band to be consumed (vanish detection tolerates call order). */
  private stormColumn(c: number, slack = 0): boolean {
    const n = this.storm + slack;
    return c < n || c >= BOARD_SIZE - n;
  }

  resize(): void {
    if (this.disposed) return;
    const { w, h } = containerSize(this.container);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h, false);
    this.lastAspect = w / h;
    this.lastHeightPx = h;
    this.refitCamera();
    this.requestRender();
  }

  /**
   * Switch between the tilted arena camera and the top-down camera. Animated unless
   * `animate` is false (or reduced motion is preferred). Safe to call repeatedly.
   */
  setViewMode(mode: BoardViewMode, animate = true): void {
    if (this.disposed) return;
    const to = mode === 'top' ? 1 : 0;
    if (to === this.viewTo && (this.tView >= 0 || this.viewT === to)) return;
    this.viewTo = to;
    if (!animate || !this.idleAnim) {
      this.viewT = to;
      this.tView = -1;
      this.refitCamera();
      this.requestRender();
      return;
    }
    this.viewFrom = this.viewT;
    this.tView = performance.now();
    this.requestRender();
  }

  getViewMode(): BoardViewMode {
    return this.viewTo === 1 ? 'top' : 'tilt';
  }

  /** Fit the camera for the current size and view blend; refresh the point-sprite scale. */
  private refitCamera(): void {
    this.fitCamera(this.lastAspect, this.lastHeightPx);
    // Spark point sizes: drawing-buffer px per world unit at distance 1.
    this.pointScale.value =
      (this.lastHeightPx * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }

  /** Advance the view transition; returns true while it is still running. */
  private tickView(now: number): boolean {
    if (this.tView < 0) return false;
    const k = Math.min(1, (now - this.tView) / VIEW_TRANSITION_MS);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
    this.viewT = this.viewFrom + (this.viewTo - this.viewFrom) * e;
    if (k >= 1) {
      this.viewT = this.viewTo;
      this.tView = -1;
    }
    this.refitCamera();
    return this.tView >= 0;
  }

  /** Render stats for diagnostics (draw calls / triangles of the last frame). */
  getRenderInfo(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.finishAnimation(false);
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const v of this.visuals.values()) v.actor?.dispose();
    this.visuals.clear();
    for (const v of this.fading) v.actor?.dispose();
    this.fading.length = 0;
    this.pieceLayer.clear();
    this.stormFx.dispose();
    this.units?.dispose();
    this.units = null;
    this.dust.dispose();
    this.sparks.dispose();
    this.kit.dispose();
    for (const g of this.ownGeometries) g.dispose();
    for (const m of this.ownMaterials) m.dispose();
    for (const t of this.ownTextures) t.dispose();
    this.tiles.dispose();
    this.moveDots.dispose();
    this.captureRings.dispose();
    this.captureGlow.dispose();
    this.burst.dispose();
    this.scene.background = null;
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.cellCb = null;
  }

  // ---------------------------------------------------------------- pieces

  /**
   * Sync the visuals to `pieces`. With `dissolve`, pieces that vanished while the storm is active
   * and stood in (or next to) a storm column are taken by the storm (dissolve) instead of popping.
   */
  private syncPieces(pieces: Piece[], dissolve = false): void {
    const seen = new Set<string>();
    for (const p of pieces) {
      seen.add(p.id);
      let v = this.visuals.get(p.id);
      if (v && !sameLook(v.piece, p)) {
        this.removeVisual(v);
        v = undefined;
      }
      let fresh = false;
      if (!v) {
        v = this.createVisual(p);
        this.visuals.set(p.id, v);
        this.pieceLayer.add(v.root);
        fresh = true;
      } else if (v.actor) {
        // Forward direction changed (turn-around at the far edge) or a move ended: turn smoothly.
        v.actor.face(forwardYaw(p), TURN_S);
      }
      v.piece = { ...p, pos: { ...p.pos } };
      v.inner.scale.set(1, 1, 1);
      v.root.position.set(cellX(p.pos.c), 0, cellZ(p.pos.r));
      if (fresh && this.idleAnim) this.startSpawn(v);
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.visuals.delete(id);
        if (dissolve && this.stormActive && this.stormColumn(v.piece.pos.c, 1) && v.actor && this.units) this.startStormFade(v);
        else this.removeVisual(v);
      }
    }
    this.applyLift();
  }

  /** The storm takes a piece: death clip + magenta dissolve, sparks and a purple dust ring. */
  private startStormFade(v: PieceVisual): void {
    const act = v.actor;
    if (!act || !this.units) {
      this.removeVisual(v);
      return;
    }
    const now = performance.now();
    v.root.traverse((o) => {
      o.castShadow = false;
    });
    v.inner.position.y = TILE_TOP;
    v.inner.scale.set(1, 1, 1);
    act.play('death', { once: true, hold: true, fade: 0.05, timeScale: act.clipDuration('death') / (STORM_MS / 1000) });
    act.setDying(this.units.dyingMaterial(v.piece, 'storm'));
    const p = v.root.position;
    this.sparks.burst(p.x, 0.8, p.z, 18, 3.2, STORM_COLORS.edge, (now + v.piece.pos.c * 13) % 97);
    this.dust.ring(p.x, TILE_TOP + 0.05, p.z, 10, 1.6, 0.5, 0.7, STORM_DUST, 0.2);
    this.flashMat.color.set('#ffffff').lerp(this.tmpC.set(STORM_COLORS.edge), 0.5);
    this.flash.position.set(p.x, 0.55, p.z);
    this.flash.visible = true;
    this.tCap = Math.max(this.tCap, now); // reuse the flash timeline (shock ring / burst stay hidden)
    this.fading.push(v);
    this.tStormFade = now;
    this.requestRender();
  }

  private createVisual(p: Piece): PieceVisual {
    const b = this.kit.build(p);
    const proxy = new THREE.Mesh(this.kit.proxyGeo, this.kit.proxyMat);
    proxy.userData.pieceId = p.id;
    b.inner.add(proxy);
    const v: PieceVisual = { piece: p, root: b.root, inner: b.inner, actor: null, body: null, proxy };
    this.attachBody(v, p);
    return v;
  }

  /** (Re)create the unit body of a visual: animated glTF actor, or a silhouette fallback. */
  private attachBody(v: PieceVisual, p: Piece): void {
    if (v.body) v.inner.remove(v.body);
    v.actor?.dispose();
    v.actor = null;
    let height = 0.95;
    if (this.units) {
      try {
        v.actor = this.units.createActor(p);
        v.actor.face(forwardYaw(p), 0);
        v.body = v.actor.object;
        height = v.actor.height;
      } catch (err) {
        console.warn('[render] unit build failed, using a silhouette:', err);
        v.actor = null;
      }
    }
    if (!v.actor) {
      v.body = this.kit.silhouetteBody(p.owner);
      v.body.scale.setScalar(LOOKS[p.character].levels[p.level].scale);
    }
    const body = v.body;
    if (body) {
      body.position.y = PUCK_TOP - 0.01;
      v.inner.add(body);
    }
    v.proxy.scale.set(0.42, PUCK_TOP + height, 0.42);
  }

  /** Swap every silhouette for its glTF unit once the models are ready. */
  private rebuildBodies(): void {
    for (const v of this.visuals.values()) {
      if (v.actor) continue;
      this.attachBody(v, v.piece);
      if (this.idleAnim) this.startSpawn(v);
    }
    this.requestRender();
  }

  private removeVisual(v: PieceVisual): void {
    this.pieceLayer.remove(v.root);
    v.actor?.dispose(); // geometry/materials are shared templates -> freed by the library
    v.actor = null;
  }

  /** Raise the selected piece slightly so the selection reads at a glance. */
  private applyLift(): void {
    this.selVisual = null;
    for (const v of this.visuals.values()) {
      const sel = posKey(v.piece.pos) === this.hi.selected;
      if (sel) this.selVisual = v;
      v.inner.position.y = TILE_TOP + (sel ? SELECT_LIFT : 0);
    }
  }

  // ---------------------------------------------------------------- highlights

  private applyHighlights(): void {
    const hi = this.hi;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        let rgb = tileRgb(r, c, hi);
        if (this.storm > 0 && this.stormColumn(c)) rgb = mixRgb(rgb, STORM_TILE, STORM_TILE_STRENGTH);
        this.tmpC.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
        this.tiles.setColorAt(r * BOARD_SIZE + c, this.tmpC);
      }
    }
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;

    const clean = (list: Pos[] | undefined): Pos[] =>
      (list ?? []).filter((p) => p.r >= 0 && p.r < BOARD_SIZE && p.c >= 0 && p.c < BOARD_SIZE);
    this.placedMoves = clean(this.highlights.moves);
    this.placedCaps = clean(this.highlights.captures);
    this.placeInstances(this.moveDots, this.placedMoves, 1);
    this.placeInstances(this.captureRings, this.placedCaps, 1);
    this.placeInstances(this.captureGlow, this.placedCaps, 1);

    const sel = this.highlights.selected;
    this.selectRing.visible = !!sel;
    this.selectGlow.visible = !!sel;
    if (sel) {
      this.selectRing.position.set(cellX(sel.c), OVERLAY_Y + 0.001, cellZ(sel.r));
      this.selectGlow.position.set(cellX(sel.c), OVERLAY_Y, cellZ(sel.r));
    }
    if (!this.anim) this.applyLift();
    this.pulsing = !!sel || this.placedMoves.length > 0 || this.placedCaps.length > 0;
  }

  private placeInstances(mesh: THREE.InstancedMesh, list: Pos[], scale: number): void {
    this.tmpS.set(scale, scale, scale);
    for (let i = 0; i < list.length; i++) {
      this.tmpV.set(cellX(list[i].c), OVERLAY_Y, cellZ(list[i].r));
      this.tmpM.compose(this.tmpV, this.tmpQ.identity(), this.tmpS);
      mesh.setMatrixAt(i, this.tmpM);
    }
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Idle pulse: selection ring, move dots, capture rings, selected-piece bob. No allocations. */
  private updatePulse(now: number): void {
    if (!this.pulsing) return;
    const s = pulse01(now, 950);
    if (this.selectRing.visible) {
      const k = 1 + 0.09 * s;
      this.selectRing.scale.set(k, 1, k);
      (this.selectRing.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.3 * s;
      this.selectGlow.scale.set(0.9 + 0.2 * s, 1, 0.9 + 0.2 * s);
      (this.selectGlow.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.35 * s;
    }
    if (this.placedMoves.length > 0) {
      (this.moveDots.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.3 * s;
      this.placeInstances(this.moveDots, this.placedMoves, 0.88 + 0.2 * s);
    }
    if (this.placedCaps.length > 0) {
      const sc = pulse01(now, 700);
      (this.captureGlow.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * sc;
      this.placeInstances(this.captureRings, this.placedCaps, 0.94 + 0.13 * sc);
      this.placeInstances(this.captureGlow, this.placedCaps, 0.85 + 0.25 * sc);
    }
    if (this.selVisual && !this.anim) {
      this.selVisual.inner.position.y = TILE_TOP + SELECT_LIFT + 0.04 * Math.sin(now / 240);
    }
  }

  // ---------------------------------------------------------------- zone lines / turn

  /** Set zone line brightness; `boost` (0..1) adds the turn-change flare for the mover's line. */
  private applyZoneLines(boost: number): void {
    for (const id of [0, 1] as const) {
      const active = id === this.turn;
      const b = active && id === this.turnFxPlayer ? boost : 0;
      this.zoneLineMat[id].opacity = Math.min(1, (active ? 0.9 : 0.42) + b * 0.5);
      this.zoneHaloMat[id].opacity = Math.min(1, (active ? 0.42 : 0.16) + b * 0.55);
      this.zoneHalo[id].scale.set(1, 1, 1 + b * 0.7);
      this.zoneLine[id].scale.set(1, 1, 1 + b * 1.4);
    }
  }

  // ---------------------------------------------------------------- camera

  /**
   * Fixed tilt, auto-fit distance + recentre so the whole slab (and piece tops) fits the
   * viewport. Portrait uses a steeper elevation and a tiny side margin so the board spans
   * nearly the full width while keeping a readable 3D perspective.
   */
  private fitCamera(aspect: number, heightPx: number): void {
    const cam = this.camera;
    cam.aspect = aspect;
    const portrait = aspect < 0.8;
    const tiltDeg = portrait ? (aspect < 0.7 ? 58 : 56) : aspect < 1.2 ? 56 : 52;
    // Top-down: almost straight down (89deg keeps lookAt well-defined with +y up) and a narrower
    // field of view so units look the same anywhere on the board.
    const t = this.viewT;
    const elevDeg = tiltDeg + (TOP_ELEVATION_DEG - tiltDeg) * t;
    cam.fov = TILT_FOV + (TOP_FOV - TILT_FOV) * t;
    cam.updateProjectionMatrix();
    const elev = THREE.MathUtils.degToRad(elevDeg);
    const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
    const e = SLAB_SIZE / 2;
    const pts: THREE.Vector3[] = [];
    for (const x of [-e, e]) {
      for (const z of [-e, e]) {
        pts.push(new THREE.Vector3(x, -SLAB_H, z), new THREE.Vector3(x, 0, z));
      }
    }
    // Tallest piece on the far row (only matters for the tilted view).
    const topY = 1.95 * (1 - t) + 0.4 * t;
    pts.push(new THREE.Vector3(-HALF, topY, -HALF), new THREE.Vector3(HALF, topY, -HALF));
    const marginX = portrait ? 0.985 : 0.92;
    const marginY = portrait ? 0.95 : 0.92;
    const target = new THREE.Vector3(0, 0, 0);
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    const measure = (d: number): { minX: number; maxX: number; minY: number; maxY: number } => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        this.tmpV.copy(p).project(cam);
        minX = Math.min(minX, this.tmpV.x);
        maxX = Math.max(maxX, this.tmpV.x);
        minY = Math.min(minY, this.tmpV.y);
        maxY = Math.max(maxY, this.tmpV.y);
      }
      return { minX, maxX, minY, maxY };
    };

    let d = 30;
    for (let iter = 0; iter < 4; iter++) {
      let lo = 4;
      let hi = 250;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const b = measure(mid);
        const fits = (b.maxX - b.minX) / 2 <= marginX && (b.maxY - b.minY) / 2 <= marginY;
        if (fits) hi = mid;
        else lo = mid;
      }
      d = hi;
      const b = measure(d);
      const cx = (b.maxX + b.minX) / 2;
      const cy = (b.maxY + b.minY) / 2;
      if (Math.abs(cx) < 1e-4 && Math.abs(cy) < 1e-4) break;
      // Shift target in the camera plane by the NDC offset converted to world units.
      const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d;
      const halfW = halfH * aspect;
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      target.addScaledVector(right, cx * halfW).addScaledVector(up, cy * halfH);
    }
    measure(d);
    cam.near = Math.max(0.5, d - 20);
    cam.far = d + 20;
    cam.updateProjectionMatrix();

    // Remember the rest pose + screen basis for the camera micro-shake.
    this.camBase.copy(cam.position);
    this.camRight.setFromMatrixColumn(cam.matrixWorld, 0);
    this.camUp.setFromMatrixColumn(cam.matrixWorld, 1);
    this.pxWorld = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d) / Math.max(1, heightPx);
    this.shaking = false;
  }

  // ---------------------------------------------------------------- rendering

  private requestRender(): void {
    if (this.disposed || this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.rafId = 0;
    if (this.disposed) return;
    const animating = this.tickAnimation(now);
    const viewMoving = this.tickView(now);
    const fxActive = this.updateFx(now) || viewMoving;
    let unitsBusy = false;
    let haveActors = false;
    for (const v of this.visuals.values()) {
      if (!v.actor) continue;
      haveActors = true;
      if (v.actor.busy) unitsBusy = true;
    }
    const capturedActor = this.anim?.captured?.actor ?? null;
    const busy = animating || fxActive || unitsBusy;
    const idleLoop = this.idleAnim && haveActors && !document.hidden;
    const stormLoop = this.stormFx.active && !document.hidden;
    if (!busy && (this.pulsing || idleLoop || stormLoop)) {
      const cap = this.pulsing ? IDLE_FRAME_MS : IDLE_ANIM_FRAME_MS;
      if (now - this.lastFrame < cap) {
        this.requestRender(); // idle pulse / idle loops are throttled; skip drawing this tick
        return;
      }
    }
    // Unit animation clock (clamped so a long pause never makes the mixers jump).
    const dt = this.lastTick > 0 ? Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000)) : 0;
    this.lastTick = now;
    if (haveActors || capturedActor || this.fading.length > 0) {
      const step = busy || this.idleAnim ? dt : 0;
      for (const v of this.visuals.values()) v.actor?.update(step);
      capturedActor?.update(dt);
      for (const v of this.fading) v.actor?.update(dt);
      this.units?.update(now / 1000);
    }
    if (stormLoop) this.stormFx.update(now / 1000);
    this.lastFrame = now;
    this.updatePulse(now);
    this.renderer.render(this.scene, this.camera);
    if (busy || this.pulsing || idleLoop || stormLoop) this.requestRender();
    else this.lastTick = 0;
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      this.lastTick = 0;
    } else {
      this.requestRender();
    }
  };

  /** Advance the running animation; returns true if more frames are needed. */
  private tickAnimation(now: number): boolean {
    const a = this.anim;
    if (!a) return false;
    const t = now - a.start;
    if (t >= a.duration) {
      this.finishAnimation(true);
      return false;
    }
    const root = a.mover.root;
    const inner = a.mover.inner;
    const k = clamp01(t / a.moveDur);
    const e = easeInOutCubic(k);
    root.position.lerpVectors(a.from, a.to, e);
    if (a.jump) {
      let sy = 1 + 0.14 * Math.sin(Math.PI * k); // stretch mid-air
      let sxz = 1 - 0.07 * Math.sin(Math.PI * k);
      if (t > a.moveDur) {
        // Landing squash.
        const kk = clamp01((t - a.moveDur) / ANIM.land);
        const sq = Math.sin(Math.PI * kk);
        sy = 1 - 0.22 * sq;
        sxz = 1 + 0.13 * sq;
        inner.position.y = TILE_TOP;
      } else {
        inner.position.y = TILE_TOP + Math.sin(Math.PI * k) * a.jumpHeight;
        if (k < 0.12) {
          // Anticipation squat.
          const q = 1 - k / 0.12;
          sy -= 0.12 * q;
          sxz += 0.07 * q;
        }
      }
      inner.scale.set(sxz, sy, sxz);
    } else {
      inner.position.y = TILE_TOP + 0.045 * Math.sin(Math.PI * k);
    }
    if (t < a.moveDur && t >= a.nextDust) this.footstep(a, t);
    if (!a.landed && t >= a.moveDur) {
      a.landed = true;
      this.startLandFx(a.to, TEAM_COLORS[a.mover.piece.owner].glow, now);
      const big = a.jump || a.mover.piece.character === 'marki';
      this.dust.ring(a.to.x, TILE_TOP + 0.04, a.to.z, a.jump ? 12 : 6, a.jump ? 1.8 : 1.0, big ? 0.55 : 0.38, 0.6, DUST, k);
      if (a.mover.actor && !a.captured && !a.jump) a.mover.actor.idle(0.12);
    }
    if (!a.attackFired && t >= a.attackStart && a.mover.actor) {
      a.attackFired = true;
      const act = a.mover.actor;
      act.play('attack', { once: true, fade: 0.06, timeScale: act.clipDuration('attack') / (ATTACK_MS / 1000) });
    }
    if (a.captured && t >= a.captureStart) {
      const cv = a.captured;
      if (!a.capFired) {
        a.capFired = true;
        this.startCaptureFx(a.capturedAt, a.capturedOwner, now);
        const mp = a.mover.piece;
        const hit = LOOKS[mp.character].levels[mp.level].glow;
        this.sparks.burst(a.capturedAt.x, 0.85, a.capturedAt.z, 22 + mp.level * 6, 3.6 + mp.level * 0.5, hit, now % 97);
        this.dust.ring(a.capturedAt.x, TILE_TOP + 0.05, a.capturedAt.z, 10, 2.1, 0.5, 0.65, DUST, 0.3);
        const act = cv.actor;
        if (act) {
          act.play('death', { once: true, hold: true, fade: 0.05, timeScale: act.clipDuration('death') / (a.deathMs / 1000) });
          if (this.units) act.setDying(this.units.dyingMaterial(cv.piece));
        }
      }
      // Knock-back (death clip) while the body dissolves from a hot edge; silhouettes shrink.
      const ck = clamp01((t - a.captureStart) / a.deathMs);
      if (cv.actor && this.units) {
        this.units.setDissolve(clamp01((ck - 0.12) / 0.88));
      } else {
        const sk = clamp01((ck - 0.45) / 0.55);
        cv.root.scale.setScalar(Math.max(0.001, 1 - easeOutCubic(sk)));
      }
      cv.root.position.y = 0.08 * easeOutCubic(ck);
    }
    return true;
  }

  private startLandFx(at: THREE.Vector3, hex: string, now: number): void {
    this.tLand = now;
    this.landMat.color.set(hex).lerp(this.tmpC.set('#ffffff'), 0.45);
    this.landRing.position.set(at.x, OVERLAY_Y + 0.002, at.z);
    this.landRing.visible = true;
  }

  /** Footstep / hoof dust behind a running unit. */
  private footstep(a: RunningAnim, t: number): void {
    const bull = a.mover.piece.character === 'marki';
    a.nextDust = t + (a.jump ? 1e9 : bull ? 50 : 70);
    const p = a.mover.root.position;
    let dx = a.to.x - a.from.x;
    let dz = a.to.z - a.from.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const y = TILE_TOP + 0.03;
    if (a.jump) {
      this.dust.ring(p.x, y, p.z, 7, 1.1, 0.36, 0.5, DUST, 0);
      return;
    }
    const side = ((t / 70) | 0) % 2 === 0 ? 1 : -1;
    const lx = -dz * side * (bull ? 0.24 : 0.12);
    const lz = dx * side * (bull ? 0.24 : 0.12);
    const back = bull ? 0.35 : 0.12;
    this.dust.emit(p.x - dx * back + lx, y, p.z - dz * back + lz, -dx * 0.5 + lx, 0.35, -dz * 0.5 + lz, bull ? 0.6 : 0.36, bull ? 0.65 : 0.5, DUST);
    if (bull) {
      this.dust.emit(p.x - dx * back - lx, y, p.z - dz * back - lz, -dx * 0.5 - lx, 0.45, -dz * 0.5 - lz, 0.55, 0.6, DUST);
      if (a.mover.piece.level === 3) this.dust.emit(p.x - dx * back, y + 0.1, p.z - dz * back, -dx * 0.3, 0.9, -dz * 0.3, 0.2, 0.55, EMBER);
    }
  }

  /** Spawn-in for freshly created units: scale pop + white emissive flash (shared uniform). */
  private startSpawn(v: PieceVisual): void {
    if (!v.actor) return;
    if (this.tSpawn < 0) {
      this.tSpawn = performance.now();
      this.spawning.length = 0;
    }
    v.inner.scale.setScalar(0.001);
    this.spawning.push(v);
  }

  private startCaptureFx(at: THREE.Vector3, owner: PlayerId, now: number): void {
    this.tCap = now;
    this.tShake = now;
    const col = TEAM_COLORS[owner].glow;
    this.shockMat.color.set('#ffffff').lerp(this.tmpC.set(col), 0.8);
    this.shockRing.position.set(at.x, OVERLAY_Y + 0.003, at.z);
    this.shockRing.visible = true;
    this.flashMat.color.set('#ffffff').lerp(this.tmpC.set(col), 0.35);
    this.flash.position.set(at.x, 0.55, at.z);
    this.flash.visible = true;
    this.burstMat.color.set(TEAM_COLORS[owner].glow).lerp(this.tmpC.set('#ffffff'), 0.25);
    this.burstOrigin.set(at.x, 0.4, at.z);
    this.burst.visible = true;
  }

  /** Advance one-shot effects (landing pulse, capture flash/burst, shake, turn sweep). */
  private updateFx(now: number): boolean {
    let active = false;
    const dt = this.lastFx > 0 ? Math.min(0.05, Math.max(0, (now - this.lastFx) / 1000)) : 1 / 60;
    this.lastFx = now;
    if (this.dust.update(dt)) active = true;
    if (this.sparks.update(dt)) active = true;

    if (this.tSpawn >= 0) {
      const el = now - this.tSpawn;
      let done = true;
      for (const v of this.spawning) {
        const delay = (v.piece.pos.c + (v.piece.owner === 0 ? v.piece.pos.r : 11 - v.piece.pos.r)) * 14;
        const k = clamp01((el - delay) / SPAWN_MS);
        if (k < 1) done = false;
        v.inner.scale.setScalar(Math.max(0.001, easeOutBack(k)));
      }
      if (this.units) this.units.uniforms.spawn.value = el < 650 ? Math.pow(1 - el / 650, 1.4) * 1.1 : 0;
      if (done && el >= 650) {
        for (const v of this.spawning) v.inner.scale.set(1, 1, 1);
        this.spawning.length = 0;
        this.tSpawn = -1;
        if (this.units) this.units.uniforms.spawn.value = 0;
      } else {
        active = true;
      }
    }

    if (this.tStormFade >= 0) {
      const k = (now - this.tStormFade) / STORM_MS;
      if (k >= 1) {
        for (const v of this.fading) this.removeVisual(v);
        this.fading.length = 0;
        this.tStormFade = -1;
        this.units?.setDissolve(0, 'storm');
      } else {
        active = true;
        const kk = Math.max(0, k);
        this.units?.setDissolve(clamp01((kk - 0.1) / 0.9), 'storm');
        for (const v of this.fading) v.root.position.y = 0.16 * easeOutCubic(kk);
      }
    }

    if (this.tLand >= 0) {
      const k = (now - this.tLand) / ANIM.pulse;
      if (k >= 1) {
        this.tLand = -1;
        this.landRing.visible = false;
      } else {
        active = true;
        const kk = Math.max(0, k);
        const s = 0.85 + 1.15 * easeOutCubic(kk);
        this.landRing.scale.set(s, 1, s);
        this.landMat.opacity = Math.min(1, 1.1 * (1 - kk) * (1 - kk));
      }
    }

    if (this.tCap >= 0) {
      const el = now - this.tCap;
      const kf = el / ANIM.flash;
      if (kf >= 1) {
        this.flash.visible = false;
      } else {
        active = true;
        const kk = Math.max(0, kf);
        const s = 0.5 + 1.9 * easeOutCubic(kk);
        this.flash.scale.set(s, s, 1);
        this.flashMat.opacity = 1 - kk;
      }
      const ks = el / (ANIM.capture + 90);
      if (ks >= 1) {
        this.shockRing.visible = false;
        this.burst.visible = false;
        this.tCap = -1;
      } else {
        active = true;
        const kk = Math.max(0, ks);
        const e = easeOutCubic(kk);
        const sr = 0.6 + 2.0 * e;
        this.shockRing.scale.set(sr, 1, sr);
        this.shockMat.opacity = 0.9 * (1 - kk);
        this.updateBurst(kk);
      }
    }

    if (this.tShake >= 0) {
      const k = (now - this.tShake) / ANIM.shake;
      if (k >= 1) {
        this.tShake = -1;
        if (this.shaking) {
          this.camera.position.copy(this.camBase);
          this.shaking = false;
        }
      } else {
        active = true;
        const kk = Math.max(0, k);
        const ox = shakeOffset(kk, 0) * this.pxWorld;
        const oy = shakeOffset(kk, 1) * this.pxWorld;
        this.camera.position
          .copy(this.camBase)
          .addScaledVector(this.camRight, ox)
          .addScaledVector(this.camUp, oy);
        this.shaking = true;
      }
    }

    if (this.tTurn >= 0) {
      const k = (now - this.tTurn) / ANIM.turn;
      if (k >= 1) {
        this.tTurn = -1;
        this.comet.visible = false;
        this.applyZoneLines(0);
      } else {
        active = true;
        const kk = Math.max(0, k);
        const boost = Math.sin(Math.PI * kk);
        this.applyZoneLines(boost);
        const id = this.turnFxPlayer;
        const e = easeInOutCubic(kk);
        const x0 = -HALF - 1.8;
        const x1 = HALF + 1.8;
        const dirX = id === 0 ? 1 : -1;
        this.comet.visible = true;
        this.comet.scale.x = dirX;
        this.comet.position.set(dirX > 0 ? x0 + (x1 - x0) * e : x1 + (x0 - x1) * e, OVERLAY_Y + 0.003, ZONE_LINE_Z[id]);
        this.cometMat.color.set(TEAM_COLORS[id].light);
        this.cometMat.opacity = Math.sin(Math.PI * kk);
      }
    }
    return active;
  }

  private updateBurst(k: number): void {
    const e = easeOutCubic(k);
    const b = this.burstOrigin;
    for (let i = 0; i < BURST_COUNT; i++) {
      const d = this.burstDirs[i];
      this.tmpV.set(b.x + d.x * e * 0.8, b.y + d.y * e * 0.6 - k * k * 0.5, b.z + d.z * e * 0.8);
      const s = 1 - k * 0.7;
      this.tmpM.makeScale(s, s, s).setPosition(this.tmpV);
      this.burst.setMatrixAt(i, this.tmpM);
    }
    this.burst.instanceMatrix.needsUpdate = true;
    this.burstMat.opacity = 1 - k;
  }

  /** Jump the running animation (if any) to its end state and resolve it. */
  private finishAnimation(natural: boolean): void {
    const a = this.anim;
    if (!natural) this.clearFx();
    if (!a) return;
    this.anim = null;
    a.mover.inner.scale.set(1, 1, 1);
    if (a.captured) this.removeVisual(a.captured);
    if (a.mover.actor) {
      if (!natural) a.mover.actor.face(a.mover.actor.facing, 0);
      a.mover.actor.idle(natural ? 0.2 : 0);
    }
    this.syncPieces(a.piecesAfter, true);
    this.requestRender();
    a.resolve();
  }

  /** Hide all one-shot effects immediately (state is reset, e.g. by setPieces mid-animation). */
  private clearFx(): void {
    this.tLand = -1;
    this.tCap = -1;
    this.tShake = -1;
    this.tTurn = -1;
    this.landRing.visible = false;
    this.shockRing.visible = false;
    this.flash.visible = false;
    this.burst.visible = false;
    this.comet.visible = false;
    this.dust.clear();
    this.sparks.clear();
    this.units?.setDissolve(0);
    if (this.tSpawn >= 0) {
      for (const v of this.spawning) v.inner.scale.set(1, 1, 1);
      this.spawning.length = 0;
      this.tSpawn = -1;
      if (this.units) this.units.uniforms.spawn.value = 0;
    }
    if (this.shaking) {
      this.camera.position.copy(this.camBase);
      this.shaking = false;
    }
    this.applyZoneLines(0);
  }

  // ---------------------------------------------------------------- input

  private readonly onPointerDown = (ev: PointerEvent): void => {
    if (!this.interactive || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    this.down = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
  };

  private readonly onPointerUp = (ev: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!d || d.id !== ev.pointerId || !this.interactive || !this.cellCb) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > TAP_SLOP_PX) return;
    const pos = this.pick(ev.clientX, ev.clientY);
    if (pos) this.cellCb(pos);
  };

  private readonly onPointerCancel = (): void => {
    this.down = null;
  };

  private readonly onContextMenu = (ev: Event): void => {
    ev.preventDefault();
  };

  private readonly onContextLost = (ev: Event): void => {
    ev.preventDefault(); // allow restoration
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    // No frames are guaranteed until the context comes back (it may never): settle any running
    // move animation now so the game (which awaits animateMove) cannot stall in 'animating'.
    this.finishAnimation(false);
  };

  private readonly onContextRestored = (): void => {
    this.requestRender();
  };

  /**
   * Screen point -> board square. Forgiving: tapping a piece's body selects its square, except
   * when the plane hit is itself a highlighted move/capture target (so tall pieces never hide
   * a destination square behind them).
   */
  private pick(clientX: number, clientY: number): Pos | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pickNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pickNdc, this.camera);

    let planePos: Pos | null = null;
    const hit = this.raycaster.ray.intersectPlane(this.pickPlane, this.tmpV);
    if (hit) {
      const c = Math.round(hit.x + HALF);
      const r = Math.round(HALF - hit.z);
      const edge = HALF + 0.5 + SLAB_MARGIN * 0.6;
      if (Math.abs(hit.x) <= edge && Math.abs(hit.z) <= edge) {
        planePos = { r: Math.min(BOARD_SIZE - 1, Math.max(0, r)), c: Math.min(BOARD_SIZE - 1, Math.max(0, c)) };
      }
    }
    if (planePos) {
      const k = posKey(planePos);
      if (this.hi.moves.has(k) || this.hi.captures.has(k)) return planePos;
    }

    // Then the unit actually drawn under the finger (front-most along the ray): a tall unit in
    // front of another piece's square takes the tap, matching what the player sees. Only close
    // to its own square, so a unit never steals a tap meant for a square far behind it.
    this.pieceLayer.updateMatrixWorld(); // proxies may not have been rendered since the last sync
    this.pickList.length = 0;
    for (const v of this.visuals.values()) this.pickList.push(v.proxy);
    const hits = this.raycaster.intersectObjects(this.pickList, false);
    this.pickList.length = 0;
    for (const h of hits) {
      const id = h.object.userData.pieceId as string | undefined;
      const v = id ? this.visuals.get(id) : undefined;
      if (!v) continue;
      if (hit) {
        // A tap on the head reaches the ground `height * slope` behind the unit (camera tilt);
        // anything further away is a tap meant for another square.
        const dir = this.raycaster.ray.direction;
        const slope = Math.hypot(dir.x, dir.z) / Math.max(0.05, Math.abs(dir.y));
        const d = Math.hypot(hit.x - v.root.position.x, hit.z - v.root.position.z);
        if (d > 0.6 + v.proxy.scale.y * slope * 1.05) continue;
      }
      return { ...v.piece.pos };
    }
    return planePos;
  }
}
