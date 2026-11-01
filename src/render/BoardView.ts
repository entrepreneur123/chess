/**
 * Three.js WebGL board view (12x12, Material-style, procedural, render-on-demand).
 *
 * World mapping: x = c - 5.5 (col 0 at screen left), z = 5.5 - r (row 0 nearest the camera,
 * i.e. player 0 at the bottom of the screen), y = up. Tile tops are at y = TILE_TOP.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOARD_SIZE } from '../engine/types';
import type { CharacterId, Move, Piece, PlayerId, Pos, Rarity } from '../engine/types';
import type { BoardHighlights, IBoardView } from './types';
import { ANIM, BOARD_COLORS, CHARACTER_RARITY, RARITY_COLORS, TEAM_COLORS } from './palette';
import {
  clamp01,
  containerSize,
  easeInOutCubic,
  easeOutCubic,
  indexHighlights,
  posKey,
  sameLook,
  slideDuration,
  tileRgb,
} from './common';
import type { HighlightIndex } from './common';

const HALF = (BOARD_SIZE - 1) / 2; // 5.5
const TILE_SIZE = 0.93;
const TILE_H = 0.07;
const TILE_TOP = TILE_H;
const SLAB_MARGIN = 0.32;
const SLAB_H = 0.34;
const SLAB_SIZE = BOARD_SIZE + SLAB_MARGIN * 2;
const OVERLAY_Y = TILE_TOP + 0.004;
const SELECT_LIFT = 0.1;
const TAP_SLOP_PX = 14;
const MAX_PIXEL_RATIO = 2;

const cellX = (c: number): number => c - HALF;
const cellZ = (r: number): number => HALF - r;

interface PieceVisual {
  piece: Piece;
  root: THREE.Group;
}

interface Burst {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  dirs: THREE.Vector3[];
  origin: THREE.Vector3;
}

interface RunningAnim {
  start: number;
  duration: number;
  moveDur: number;
  mover: PieceVisual | null;
  from: THREE.Vector3;
  to: THREE.Vector3;
  jump: boolean;
  jumpHeight: number;
  captured: THREE.Group | null;
  capturedOwner: PlayerId;
  captureStart: number;
  capturedMaterials: THREE.Material[];
  burst: Burst | null;
  piecesAfter: Piece[];
  resolve: () => void;
}

/** Shared geometries & materials for every piece (one set per BoardView instance). */
class PieceKit {
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];

  readonly base: THREE.BufferGeometry;
  readonly rarityRing: THREE.BufferGeometry;
  readonly pip: THREE.BufferGeometry;
  // sad
  readonly sadPillar: THREE.BufferGeometry;
  readonly sadCap: THREE.BufferGeometry;
  readonly sadArm: THREE.BufferGeometry;
  // marki
  readonly markiShaft: THREE.BufferGeometry;
  readonly markiCollar: THREE.BufferGeometry;
  readonly markiTip: THREE.BufferGeometry;
  readonly markiChevron: THREE.BufferGeometry;
  // walk
  readonly walkNeck: THREE.BufferGeometry;
  readonly walkOrb: THREE.BufferGeometry;
  readonly walkHalo: THREE.BufferGeometry;
  readonly burstBit: THREE.BufferGeometry;

  readonly team: Record<PlayerId, THREE.MeshStandardMaterial>;
  readonly teamDark: Record<PlayerId, THREE.MeshStandardMaterial>;
  readonly teamLight: Record<PlayerId, THREE.MeshStandardMaterial>;
  readonly rarity: Record<Rarity, THREE.MeshStandardMaterial>;
  readonly baseMat: THREE.MeshStandardMaterial;
  readonly accentMat: THREE.MeshStandardMaterial;

  constructor() {
    const g = <T extends THREE.BufferGeometry>(geo: T): T => {
      this.geometries.push(geo);
      return geo;
    };
    const m = <T extends THREE.Material>(mat: T): T => {
      this.materials.push(mat);
      return mat;
    };

    // Base puck: soft lathe profile.
    const baseProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.36, 0),
      new THREE.Vector2(0.385, 0.02),
      new THREE.Vector2(0.39, 0.075),
      new THREE.Vector2(0.37, 0.11),
      new THREE.Vector2(0.33, 0.125),
      new THREE.Vector2(0, 0.125),
    ];
    this.base = g(new THREE.LatheGeometry(baseProfile, 28));
    this.rarityRing = g(new THREE.TorusGeometry(0.392, 0.03, 8, 40).rotateX(Math.PI / 2).translate(0, 0.05, 0));
    this.pip = g(new THREE.SphereGeometry(0.045, 10, 6).scale(1, 0.6, 1));

    // sad: sturdy octagonal tower with a plus-shaped crown.
    this.sadPillar = g(new THREE.CylinderGeometry(0.2, 0.25, 0.42, 8).translate(0, 0.125 + 0.21, 0));
    this.sadCap = g(new THREE.CylinderGeometry(0.27, 0.22, 0.08, 8).translate(0, 0.585, 0));
    this.sadArm = g(new RoundedBoxGeometry(0.58, 0.15, 0.19, 2, 0.04).translate(0, 0.7, 0));

    // marki: spear leaning toward its forward direction (built pointing toward -z, i.e. +r).
    this.markiShaft = g(new THREE.CylinderGeometry(0.075, 0.1, 0.5, 8).translate(0, 0.25, 0));
    this.markiCollar = g(new THREE.CylinderGeometry(0.16, 0.12, 0.07, 8).translate(0, 0.53, 0));
    this.markiTip = g(new THREE.ConeGeometry(0.2, 0.42, 4).rotateY(Math.PI / 4).translate(0, 0.56 + 0.21, 0));
    const chev = new THREE.Shape();
    chev.moveTo(0, 0.13);
    chev.lineTo(0.2, -0.04);
    chev.lineTo(0.13, -0.1);
    chev.lineTo(0, 0.0);
    chev.lineTo(-0.13, -0.1);
    chev.lineTo(-0.2, -0.04);
    chev.closePath();
    this.markiChevron = g(
      new THREE.ExtrudeGeometry(chev, { depth: 0.025, bevelEnabled: false })
        .rotateX(-Math.PI / 2) // shape +y -> world -z (forward)
        .translate(0, 0.11, -0.2),
    );

    // walk: orb on a short neck with a floating halo ring.
    this.walkNeck = g(new THREE.CylinderGeometry(0.12, 0.19, 0.1, 16).translate(0, 0.17, 0));
    this.walkOrb = g(new THREE.SphereGeometry(0.25, 20, 14).translate(0, 0.43, 0));
    this.walkHalo = g(new THREE.TorusGeometry(0.33, 0.03, 8, 36).rotateX(Math.PI / 2));

    this.burstBit = g(new THREE.IcosahedronGeometry(0.06, 0));

    const std = (color: string, roughness = 0.5): THREE.MeshStandardMaterial =>
      m(new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }));

    this.team = { 0: std(TEAM_COLORS[0].main, 0.42), 1: std(TEAM_COLORS[1].main, 0.42) };
    this.teamDark = { 0: std(TEAM_COLORS[0].dark, 0.5), 1: std(TEAM_COLORS[1].dark, 0.5) };
    this.teamLight = { 0: std(TEAM_COLORS[0].light, 0.4), 1: std(TEAM_COLORS[1].light, 0.4) };
    this.rarity = {
      common: std(RARITY_COLORS.common, 0.45),
      rare: std(RARITY_COLORS.rare, 0.45),
      epic: std(RARITY_COLORS.epic, 0.45),
      legendary: std(RARITY_COLORS.legendary, 0.35),
    };
    this.baseMat = std(BOARD_COLORS.pieceBase, 0.6);
    this.accentMat = std('#FFFFFF', 0.5);
  }

  build(p: Piece): THREE.Group {
    const root = new THREE.Group();
    root.userData.pieceId = p.id;
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh => {
      const me = new THREE.Mesh(geo, mat);
      me.castShadow = true;
      me.receiveShadow = false;
      parent.add(me);
      return me;
    };
    const teamMat = this.team[p.owner];

    mesh(this.base, this.baseMat, root);
    mesh(this.rarityRing, this.rarity[CHARACTER_RARITY[p.character]], root);

    // Level pips: on the base top, on the side facing the camera (+z), centered.
    const n = p.level;
    const spread = 0.42; // radians between pips
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * spread;
      const pip = mesh(this.pip, this.teamDark[p.owner], root);
      pip.castShadow = false;
      pip.position.set(Math.sin(a) * 0.29, 0.128, Math.cos(a) * 0.29);
    }

    // Body is yawed so that its local -z faces the owner's forward direction.
    const body = new THREE.Group();
    body.rotation.y = p.owner === 0 ? 0 : Math.PI;
    body.scale.setScalar(1.15);
    body.position.y = -0.02;
    root.add(body);
    this.buildBody(p.character, body, teamMat, p.owner);
    return root;
  }

  private buildBody(ch: CharacterId, body: THREE.Group, teamMat: THREE.Material, owner: PlayerId): void {
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = body): THREE.Mesh => {
      const me = new THREE.Mesh(geo, mat);
      me.castShadow = true;
      parent.add(me);
      return me;
    };
    switch (ch) {
      case 'sad': {
        add(this.sadPillar, teamMat);
        add(this.sadCap, this.teamDark[owner]);
        add(this.sadArm, teamMat);
        add(this.sadArm, teamMat).rotation.y = Math.PI / 2;
        break;
      }
      case 'marki': {
        add(this.markiChevron, this.teamLight[owner]).castShadow = false;
        const spear = new THREE.Group();
        spear.position.set(0, 0.11, 0.06);
        spear.rotation.x = -0.24; // lean toward -z (forward)
        body.add(spear);
        add(this.markiShaft, teamMat, spear);
        add(this.markiCollar, this.teamDark[owner], spear);
        add(this.markiTip, teamMat, spear);
        break;
      }
      case 'walk': {
        add(this.walkNeck, this.teamDark[owner]);
        add(this.walkOrb, teamMat);
        const halo = add(this.walkHalo, this.teamLight[owner]);
        halo.position.y = 0.46;
        halo.rotation.x = 0.32;
        halo.rotation.z = 0.12;
        break;
      }
    }
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
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
  private readonly selectRing: THREE.Mesh;
  private readonly pieceLayer = new THREE.Group();
  private readonly fxLayer = new THREE.Group();

  private readonly visuals = new Map<string, PieceVisual>();
  private highlights: BoardHighlights = {};
  private hi: HighlightIndex = indexHighlights({});

  private cellCb: ((pos: Pos) => void) | null = null;
  private interactive = true;
  private anim: RunningAnim | null = null;
  private rafId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private down: { id: number; x: number; y: number } | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_TOP);
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpC = new THREE.Color();

  constructor(container: HTMLElement) {
    this.container = container;
    // Throws if WebGL is unavailable -> createBoardView falls back to 2D.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    const gl = this.renderer.getContext();
    if (!gl) throw new Error('WebGL context unavailable');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setClearColor(0x000000, 0);
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

    this.buildLights();
    this.buildBoard();

    this.tiles = this.buildTiles();
    const overlays = this.buildOverlays();
    this.moveDots = overlays.dots;
    this.captureRings = overlays.rings;
    this.selectRing = overlays.select;

    this.scene.add(this.pieceLayer, this.fxLayer);
    this.applyHighlights();

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
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd5d8dc, 1.75);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(-4.5, 14, 7);
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

  private buildBoard(): void {
    // Raised rounded slab.
    const slabGeo = new RoundedBoxGeometry(SLAB_SIZE, SLAB_H, SLAB_SIZE, 3, 0.18);
    slabGeo.translate(0, -SLAB_H / 2 + 0.001, 0);
    const slabMat = new THREE.MeshStandardMaterial({ color: BOARD_COLORS.gap, roughness: 0.85 });
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.receiveShadow = true;
    this.scene.add(slab);
    this.ownGeometries.push(slabGeo);
    this.ownMaterials.push(slabMat);

    // Soft contact shadow under the slab: procedural blurred texture (no downloads).
    const tex = this.makeSoftShadowTexture();
    const shGeo = new THREE.PlaneGeometry(SLAB_SIZE * 1.35, SLAB_SIZE * 1.35).rotateX(-Math.PI / 2);
    const shMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55 });
    const sh = new THREE.Mesh(shGeo, shMat);
    sh.position.set(0.25, -SLAB_H - 0.01, -0.35);
    sh.renderOrder = -1;
    this.scene.add(sh);
    this.ownGeometries.push(shGeo);
    this.ownMaterials.push(shMat);
    this.ownTextures.push(tex);
  }

  private makeSoftShadowTexture(): THREE.Texture {
    const size = 256;
    const cvs = document.createElement('canvas');
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext('2d');
    if (ctx) {
      const inner = size / 1.35;
      const off = (size - inner) / 2;
      ctx.fillStyle = 'rgba(32,33,36,1)';
      ctx.shadowColor = 'rgba(32,33,36,1)';
      ctx.shadowBlur = 18;
      // Draw the rect off-canvas and only keep its shadow (pure blur).
      ctx.shadowOffsetX = size * 2;
      ctx.beginPath();
      const rr = 10;
      const x = off - size * 2;
      ctx.moveTo(x + rr, off);
      ctx.arcTo(x + inner, off, x + inner, off + inner, rr);
      ctx.arcTo(x + inner, off + inner, x, off + inner, rr);
      ctx.arcTo(x, off + inner, x, off, rr);
      ctx.arcTo(x, off, x + inner, off, rr);
      ctx.closePath();
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildTiles(): THREE.InstancedMesh {
    const geo = new RoundedBoxGeometry(TILE_SIZE, TILE_H, TILE_SIZE, 1, 0.03);
    geo.translate(0, TILE_H / 2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(geo, mat, BOARD_SIZE * BOARD_SIZE);
    mesh.receiveShadow = true;
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
    return mesh;
  }

  private buildOverlays(): { dots: THREE.InstancedMesh; rings: THREE.InstancedMesh; select: THREE.Mesh } {
    const n = BOARD_SIZE * BOARD_SIZE;
    const overlayMat = (color: string, opacity: number): THREE.MeshBasicMaterial => {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.ownMaterials.push(mat);
      return mat;
    };

    const dotGeo = new THREE.CircleGeometry(0.15, 28).rotateX(-Math.PI / 2);
    const dots = new THREE.InstancedMesh(dotGeo, overlayMat(BOARD_COLORS.moveDot, BOARD_COLORS.moveDotAlpha), n);
    dots.count = 0;
    dots.renderOrder = 2;

    const ringGeo = new THREE.RingGeometry(0.36, 0.45, 36).rotateX(-Math.PI / 2);
    const rings = new THREE.InstancedMesh(ringGeo, overlayMat(BOARD_COLORS.capture, 0.9), n);
    rings.count = 0;
    rings.renderOrder = 2;

    const selGeo = new THREE.RingGeometry(0.4, 0.465, 40).rotateX(-Math.PI / 2);
    const select = new THREE.Mesh(selGeo, overlayMat(BOARD_COLORS.selected, 1));
    select.visible = false;
    select.renderOrder = 2;

    this.ownGeometries.push(dotGeo, ringGeo, selGeo);
    this.scene.add(dots, rings, select);
    return { dots, rings, select };
  }

  // ---------------------------------------------------------------- public API

  setPieces(pieces: Piece[]): void {
    if (this.disposed) return;
    this.finishAnimation();
    this.syncPieces(pieces);
    this.requestRender();
  }

  animateMove(move: Move, piecesAfter: Piece[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishAnimation();
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
    if (move.captureId) {
      const cv = this.visuals.get(move.captureId);
      if (cv) {
        this.visuals.delete(move.captureId);
        captured = cv.root;
        capturedOwner = cv.piece.owner;
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
    const captureStart = captured ? moveDur * 0.62 : moveDur;
    const duration = captured ? Math.max(moveDur, captureStart + ANIM.capture + 80) : moveDur;
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
        captured,
        capturedOwner,
        captureStart,
        capturedMaterials,
        burst: null,
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

  resize(): void {
    if (this.disposed) return;
    const { w, h } = containerSize(this.container);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h, false);
    this.fitCamera(w / h);
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.finishAnimation();
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
        v = { piece: p, root: this.kit.build(p) };
        this.visuals.set(p.id, v);
        this.pieceLayer.add(v.root);
      }
      v.piece = { ...p, pos: { ...p.pos } };
      v.root.scale.setScalar(1);
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
    for (const v of this.visuals.values()) {
      v.root.position.y = posKey(v.piece.pos) === this.hi.selected ? SELECT_LIFT : 0;
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

    const place = (mesh: THREE.InstancedMesh, list: Pos[] | undefined): void => {
      let i = 0;
      for (const p of list ?? []) {
        if (p.r < 0 || p.r >= BOARD_SIZE || p.c < 0 || p.c >= BOARD_SIZE) continue;
        this.tmpM.makeTranslation(cellX(p.c), OVERLAY_Y, cellZ(p.r));
        mesh.setMatrixAt(i++, this.tmpM);
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(this.moveDots, this.highlights.moves);
    place(this.captureRings, this.highlights.captures);

    const sel = this.highlights.selected;
    this.selectRing.visible = !!sel;
    if (sel) this.selectRing.position.set(cellX(sel.c), OVERLAY_Y + 0.001, cellZ(sel.r));
    if (!this.anim) this.applyLift();
  }

  // ---------------------------------------------------------------- camera

  /**
   * Fixed tilt, auto-fit distance + recentre so the whole slab (and piece tops) fits the
   * viewport with a small margin for any aspect ratio.
   */
  private fitCamera(aspect: number): void {
    const cam = this.camera;
    cam.aspect = aspect;
    // Portrait has spare height: look more top-down (far rows stay big). Landscape: a bit lower.
    const elevDeg = aspect < 0.8 ? 60 : aspect < 1.2 ? 57 : 53;
    cam.fov = aspect < 0.8 ? 30 : 34;
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
    pts.push(new THREE.Vector3(-HALF, 1.05, -HALF), new THREE.Vector3(HALF, 1.05, -HALF));
    const margin = aspect < 0.8 ? 0.94 : 0.9;
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
        const fits = (b.maxX - b.minX) / 2 <= margin && (b.maxY - b.minY) / 2 <= margin;
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
    this.renderer.render(this.scene, this.camera);
    if (animating) this.requestRender();
  };

  /** Advance the running animation; returns true if more frames are needed. */
  private tickAnimation(now: number): boolean {
    const a = this.anim;
    if (!a) return false;
    const t = now - a.start;
    if (t >= a.duration) {
      this.finishAnimation();
      return false;
    }
    if (a.mover) {
      const k = clamp01(t / a.moveDur);
      const e = easeInOutCubic(k);
      const root = a.mover.root;
      root.position.lerpVectors(a.from, a.to, e);
      if (a.jump) {
        root.position.y = Math.sin(Math.PI * k) * a.jumpHeight;
        // Squash on take-off/landing, stretch mid-air.
        const s = 1 + 0.12 * Math.sin(Math.PI * k) - 0.1 * Math.max(0, 1 - k * 6) - 0.1 * Math.max(0, k * 6 - 5);
        root.scale.set(2 - s, s, 2 - s);
      }
    }
    if (a.captured && t >= a.captureStart) {
      const k = clamp01((t - a.captureStart) / ANIM.capture);
      const s = 1 - easeOutCubic(k);
      a.captured.scale.setScalar(Math.max(0.001, s));
      a.captured.position.y = 0.15 * easeOutCubic(k);
      for (const m of a.capturedMaterials) m.opacity = 1 - k;
      if (!a.burst) a.burst = this.spawnBurst(a.captured, a.capturedOwner);
      this.updateBurst(a.burst, clamp01((t - a.captureStart) / (ANIM.capture + 80)));
    }
    return true;
  }

  private spawnBurst(target: THREE.Group, owner: PlayerId): Burst {
    const color = TEAM_COLORS[owner].main;
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const count = 10;
    const mesh = new THREE.InstancedMesh(this.kit.burstBit, material, count);
    const dirs: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      dirs.push(new THREE.Vector3(Math.cos(a), 0.9 + Math.random() * 0.8, Math.sin(a)).multiplyScalar(0.9 + Math.random() * 0.5));
    }
    const origin = target.position.clone();
    origin.y = 0.35;
    this.fxLayer.add(mesh);
    return { mesh, material, dirs, origin };
  }

  private updateBurst(b: Burst, k: number): void {
    const e = easeOutCubic(k);
    for (let i = 0; i < b.dirs.length; i++) {
      const d = b.dirs[i];
      this.tmpV.set(b.origin.x + d.x * e * 0.75, b.origin.y + d.y * e * 0.55 - k * k * 0.5, b.origin.z + d.z * e * 0.75);
      const s = 1 - k * 0.7;
      this.tmpM.makeScale(s, s, s).setPosition(this.tmpV);
      b.mesh.setMatrixAt(i, this.tmpM);
    }
    b.mesh.instanceMatrix.needsUpdate = true;
    b.material.opacity = 1 - k;
  }

  /** Jump the running animation (if any) to its end state and resolve it. */
  private finishAnimation(): void {
    const a = this.anim;
    if (!a) return;
    this.anim = null;
    if (a.mover) a.mover.root.scale.setScalar(1);
    if (a.captured) {
      this.pieceLayer.remove(a.captured);
      for (const m of a.capturedMaterials) m.dispose();
    }
    if (a.burst) {
      this.fxLayer.remove(a.burst.mesh);
      a.burst.mesh.dispose();
      a.burst.material.dispose();
    }
    this.syncPieces(a.piecesAfter);
    this.requestRender();
    a.resolve();
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
    this.finishAnimation();
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
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

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

    const hits = this.raycaster.intersectObject(this.pieceLayer, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.pieceId === undefined) o = o.parent;
      const id = o?.userData.pieceId as string | undefined;
      const v = id ? this.visuals.get(id) : undefined;
      if (v) return { ...v.piece.pos };
    }
    return planePos;
  }
}
