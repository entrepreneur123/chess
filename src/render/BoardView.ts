/**
 * Three.js WebGL board view: a premium "tactical fantasy arena" (12x12, procedural, render-on-demand).
 *
 * World mapping: x = c - 5.5 (col 0 at screen left), z = 5.5 - r (row 0 nearest the camera,
 * i.e. player 0 at the bottom of the screen), y = up. Tile tops are at y = TILE_TOP.
 *
 * Performance notes: tiles are one InstancedMesh, overlays are InstancedMeshes, effects reuse
 * pre-allocated meshes (no per-frame / per-move allocations), one 1024 shadow map, pixel ratio
 * capped at 2. Frames are only requested while something is animating (the idle pulse of a
 * selection runs at ~30 fps and stops as soon as nothing is selected).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOARD_SIZE, ZONE_DEPTH } from '../engine/types';
import type { CharacterId, Move, Piece, PlayerId, Pos, Rarity } from '../engine/types';
import type { BoardHighlights, IBoardView } from './types';
import {
  buildBatchedCharacterModel,
  createBatchMaterials,
  disposeBatchMaterials,
  disposeCharacterCache,
  type BatchMaterials,
} from './characters';
import { ANIM, BOARD_COLORS, CHARACTER_RARITY, RARITY_COLORS, RARITY_GLOW, TEAM_COLORS } from './palette';
import {
  clamp01,
  containerSize,
  easeInOutCubic,
  easeOutCubic,
  indexHighlights,
  makeRng,
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
const MAX_PIXEL_RATIO = 2;
const IDLE_FRAME_MS = 32; // idle pulse (selection / targets) is capped at ~30 fps
/** Uniform scale of each character model on the board (tile = 1 unit; the bull is long, so smaller). */
const MODEL_SCALE: Record<CharacterId, number> = { sad: 1.08, marki: 0.92, walk: 1.06 };
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
}

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
  captured: THREE.Group | null;
  capturedOwner: PlayerId;
  capturedAt: THREE.Vector3;
  captureStart: number;
  capFired: boolean;
  capturedMaterials: THREE.Material[];
  piecesAfter: Piece[];
  resolve: () => void;
}

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

/** Shared geometries & materials for every piece (one set per BoardView instance). */
class PieceKit {
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  readonly textures: THREE.Texture[] = [];

  readonly base: THREE.BufferGeometry;
  readonly rarityRing: THREE.BufferGeometry;
  readonly pip: THREE.BufferGeometry;
  readonly groundPlane: THREE.BufferGeometry;
  readonly burstBit: THREE.BufferGeometry;

  /** Per-team shared materials for the merged character models (rim-lit in the team's light tone). */
  readonly batch: Record<PlayerId, BatchMaterials>;
  private readonly models = new Map<string, THREE.Group>();
  readonly rarity: Record<Rarity, THREE.MeshStandardMaterial>;
  readonly rarityHalo: Record<Rarity, THREE.MeshBasicMaterial>;
  readonly baseMat: THREE.MeshStandardMaterial;
  readonly pipMat: THREE.MeshStandardMaterial;
  readonly blobMat: THREE.MeshBasicMaterial;

  constructor() {
    const g = <T extends THREE.BufferGeometry>(geo: T): T => {
      this.geometries.push(geo);
      return geo;
    };
    const m = <T extends THREE.Material>(mat: T): T => {
      this.materials.push(mat);
      return mat;
    };

    // Base puck: soft lathe profile (radius ~0.43 so units fill their square).
    const baseProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.375, 0),
      new THREE.Vector2(0.4, 0.022),
      new THREE.Vector2(0.405, 0.085),
      new THREE.Vector2(0.38, 0.125),
      new THREE.Vector2(0.33, 0.14),
      new THREE.Vector2(0, 0.14),
    ];
    this.base = g(new THREE.LatheGeometry(baseProfile, 32));
    this.rarityRing = g(new THREE.TorusGeometry(0.41, 0.058, 8, 48).rotateX(Math.PI / 2).translate(0, 0.07, 0));
    this.pip = g(new THREE.SphereGeometry(0.063, 12, 8));
    this.groundPlane = g(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));

    this.burstBit = g(new THREE.IcosahedronGeometry(0.095, 0));

    const std = (color: string, roughness: number, emissive?: string, ei = 0): THREE.MeshStandardMaterial =>
      m(new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05, emissive: emissive ?? '#000000', emissiveIntensity: ei }));

    const mk = (id: PlayerId): BatchMaterials =>
      createBatchMaterials((mat) => addRim(mat, TEAM_COLORS[id].light, 0.55, 2.4));
    this.batch = { 0: mk(0), 1: mk(1) };

    const glowTex = makeGlowTexture();
    const blobTex = makeBlobTexture();
    this.textures.push(glowTex, blobTex);
    const ring = (r: Rarity): THREE.MeshStandardMaterial => {
      const k = RARITY_GLOW[r];
      return std(RARITY_COLORS[r], 0.35, RARITY_COLORS[r], 0.5 + 1.0 * k);
    };
    const halo = (r: Rarity): THREE.MeshBasicMaterial =>
      m(
        new THREE.MeshBasicMaterial({
          map: glowTex,
          color: RARITY_COLORS[r],
          transparent: true,
          opacity: 0.12 + 0.5 * RARITY_GLOW[r],
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
    this.rarity = { common: ring('common'), rare: ring('rare'), epic: ring('epic'), legendary: ring('legendary') };
    this.rarityHalo = { common: halo('common'), rare: halo('rare'), epic: halo('epic'), legendary: halo('legendary') };
    this.baseMat = std(BOARD_COLORS.pieceBase, 0.4, BOARD_COLORS.pieceBase, 0.12);
    addRim(this.baseMat, '#B7C8F5', 0.9, 2.0);
    this.pipMat = std(BOARD_COLORS.pip, 0.3, BOARD_COLORS.pip, 1.1);
    this.blobMat = m(
      new THREE.MeshBasicMaterial({
        map: blobTex,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
  }

  build(p: Piece): { root: THREE.Group; inner: THREE.Group } {
    const root = new THREE.Group();
    root.userData.pieceId = p.id;
    const noPick = (me: THREE.Mesh): void => {
      me.raycast = () => undefined;
    };

    // Contact shadow blob + rarity floor halo (ground level, never lifted).
    const blob = new THREE.Mesh(this.groundPlane, this.blobMat);
    blob.scale.set(1.12, 1, 1.12);
    blob.position.set(0.04, TILE_TOP + 0.004, 0.06);
    blob.renderOrder = 1;
    noPick(blob);
    root.add(blob);
    const rar = CHARACTER_RARITY[p.character];
    const halo = new THREE.Mesh(this.groundPlane, this.rarityHalo[rar]);
    halo.scale.set(1.5, 1, 1.5);
    halo.position.y = TILE_TOP + 0.006;
    halo.renderOrder = 1;
    noPick(halo);
    root.add(halo);

    const inner = new THREE.Group();
    inner.position.y = TILE_TOP;
    root.add(inner);

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh => {
      const me = new THREE.Mesh(geo, mat);
      me.castShadow = true;
      me.receiveShadow = false;
      parent.add(me);
      return me;
    };

    mesh(this.base, this.baseMat, inner);
    mesh(this.rarityRing, this.rarity[rar], inner).castShadow = false;

    // Level pips: gold gems on the puck lip facing the camera (+z), centered.
    const n = p.level;
    const spread = 0.34; // radians between pips
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * spread;
      const pip = mesh(this.pip, this.pipMat, inner);
      pip.castShadow = false;
      pip.position.set(Math.sin(a) * 0.35, 0.145, Math.cos(a) * 0.35);
    }

    // Character model (faces +z). Player 0 moves toward -z (away from the camera) and player 1
    // toward +z (facing the camera), so player 0's body is turned around.
    const body = this.model(p.character, p.level, p.owner).clone(true);
    body.rotation.y = p.owner === 0 ? Math.PI : 0;
    body.scale.setScalar(MODEL_SCALE[p.character]);
    body.position.y = PUCK_TOP - 0.01;
    inner.add(body);
    return { root, inner };
  }

  /** Merged (<= 4 meshes) template per character/level/owner, built lazily and cached. */
  private model(ch: CharacterId, level: Piece['level'], owner: PlayerId): THREE.Group {
    const key = `${ch}:${level}:${owner}`;
    let tpl = this.models.get(key);
    if (!tpl) {
      tpl = buildBatchedCharacterModel({ character: ch, level, owner }, this.batch[owner]);
      this.models.set(key, tpl);
    }
    return tpl;
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const t of this.textures) t.dispose();
    for (const m of this.models.values()) {
      m.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
    }
    this.models.clear();
    disposeBatchMaterials(this.batch[0]);
    disposeBatchMaterials(this.batch[1]);
    disposeCharacterCache();
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
  private tLand = -1;
  private tCap = -1;
  private tShake = -1;
  private tTurn = -1;
  private turn: PlayerId = 0;
  private turnFxPlayer: PlayerId = 0;

  private readonly visuals = new Map<string, PieceVisual>();
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

    const fx = this.buildFx(glowTex);
    this.landRing = fx.landRing;
    this.landMat = fx.landMat;
    this.shockRing = fx.shockRing;
    this.shockMat = fx.shockMat;
    this.flash = fx.flash;
    this.flashMat = fx.flashMat;
    this.burst = fx.burst;
    this.burstMat = fx.burstMat;

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
    this.resize();
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
    this.syncPieces(pieces);
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
    let captured: THREE.Group | null = null;
    let capturedOwner: PlayerId = mover.piece.owner === 0 ? 1 : 0;
    const capturedMaterials: THREE.Material[] = [];
    const capturedAt = new THREE.Vector3(cellX(move.to.c), 0, cellZ(move.to.r));
    if (move.captureId) {
      const cv = this.visuals.get(move.captureId);
      if (cv) {
        this.visuals.delete(move.captureId);
        captured = cv.root;
        capturedOwner = cv.piece.owner;
        capturedAt.copy(cv.root.position);
        captured.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const mat = (o.material as THREE.Material).clone();
            mat.transparent = true;
            o.material = mat;
            o.castShadow = false;
            capturedMaterials.push(mat);
          }
        });
      }
    }

    const jump = mover.piece.character === 'walk';
    const moveDur = jump ? ANIM.jump : slideDuration(move);
    const captureStart = captured ? moveDur * (jump ? 0.92 : 0.82) : moveDur;
    const duration = Math.max(
      moveDur + (jump ? ANIM.land : 40),
      captured ? captureStart + ANIM.capture + 40 : 0,
    );
    const from = mover.root.position.clone();
    from.y = 0;
    const to = new THREE.Vector3(cellX(move.to.c), 0, cellZ(move.to.r));
    const dist = Math.hypot(move.to.r - move.from.r, move.to.c - move.from.c);

    return new Promise<void>((resolve) => {
      this.anim = {
        start: performance.now(),
        duration,
        moveDur,
        mover,
        from,
        to,
        jump,
        jumpHeight: 0.7 + Math.min(dist, 6) * 0.12,
        landed: false,
        captured,
        capturedOwner,
        capturedAt,
        captureStart,
        capFired: false,
        capturedMaterials,
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

  resize(): void {
    if (this.disposed) return;
    const { w, h } = containerSize(this.container);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h, false);
    this.fitCamera(w / h, h);
    this.requestRender();
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
    this.visuals.clear();
    this.pieceLayer.clear();
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

  private syncPieces(pieces: Piece[]): void {
    const seen = new Set<string>();
    for (const p of pieces) {
      seen.add(p.id);
      let v = this.visuals.get(p.id);
      if (v && !sameLook(v.piece, p)) {
        this.pieceLayer.remove(v.root);
        v = undefined;
      }
      if (!v) {
        const b = this.kit.build(p);
        v = { piece: p, root: b.root, inner: b.inner };
        this.visuals.set(p.id, v);
        this.pieceLayer.add(v.root);
      }
      v.piece = { ...p, pos: { ...p.pos } };
      v.inner.scale.set(1, 1, 1);
      v.root.position.set(cellX(p.pos.c), 0, cellZ(p.pos.r));
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.pieceLayer.remove(v.root); // geometry/materials are shared -> nothing to dispose
        this.visuals.delete(id);
      }
    }
    this.applyLift();
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
        const [cr, cg, cb] = tileRgb(r, c, hi);
        this.tmpC.setRGB(cr, cg, cb, THREE.SRGBColorSpace);
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
    const elevDeg = portrait ? (aspect < 0.7 ? 58 : 56) : aspect < 1.2 ? 56 : 52;
    cam.fov = portrait ? 34 : 34;
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
    // Tallest piece on the far row.
    pts.push(new THREE.Vector3(-HALF, 1.5, -HALF), new THREE.Vector3(HALF, 1.5, -HALF));
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
    const fxActive = this.updateFx(now);
    const busy = animating || fxActive;
    if (!busy && this.pulsing && now - this.lastFrame < IDLE_FRAME_MS) {
      this.requestRender(); // idle pulse is throttled to ~30 fps; skip drawing this tick
      return;
    }
    this.lastFrame = now;
    this.updatePulse(now);
    this.renderer.render(this.scene, this.camera);
    if (busy || this.pulsing) this.requestRender();
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
    if (!a.landed && t >= a.moveDur) {
      a.landed = true;
      this.startLandFx(a.to, TEAM_COLORS[a.mover.piece.owner].glow, now);
    }
    if (a.captured && t >= a.captureStart) {
      if (!a.capFired) {
        a.capFired = true;
        this.startCaptureFx(a.capturedAt, a.capturedOwner, now);
      }
      const ck = clamp01((t - a.captureStart) / ANIM.capture);
      const s = 1 - easeOutCubic(ck);
      a.captured.scale.setScalar(Math.max(0.001, s));
      a.captured.position.y = 0.15 * easeOutCubic(ck);
      for (const m of a.capturedMaterials) m.opacity = 1 - ck;
    }
    return true;
  }

  private startLandFx(at: THREE.Vector3, hex: string, now: number): void {
    this.tLand = now;
    this.landMat.color.set(hex).lerp(this.tmpC.set('#ffffff'), 0.45);
    this.landRing.position.set(at.x, OVERLAY_Y + 0.002, at.z);
    this.landRing.visible = true;
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
    if (a.captured) {
      this.pieceLayer.remove(a.captured);
      for (const m of a.capturedMaterials) m.dispose();
    }
    this.syncPieces(a.piecesAfter);
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
      for (const v of this.visuals.values()) {
        if (posKey(v.piece.pos) === k) return planePos; // a piece standing on the tapped square
      }
    }

    // Otherwise forgive taps on a tall piece body, but only close to its own square so a tall
    // piece never steals the tap meant for an empty square far behind it.
    const hits = this.raycaster.intersectObject(this.pieceLayer, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.pieceId === undefined) o = o.parent;
      const id = o?.userData.pieceId as string | undefined;
      const v = id ? this.visuals.get(id) : undefined;
      if (!v) continue;
      if (hit) {
        const d = Math.hypot(hit.x - v.root.position.x, hit.z - v.root.position.z);
        if (d > 0.85) continue;
      }
      return { ...v.piece.pos };
    }
    return planePos;
  }
}
