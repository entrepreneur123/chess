/**
 * Michelle's doll traps and the "속박" (stun) badge, shared by both boards.
 *
 *  - `paintDoll` draws a small stitched rag doll (button eyes, patched dress) tinted with the trap
 *    owner's team colour, on a soft team glow. Drawn in code: no image asset.
 *  - `paintStunBadge` draws a chain-link "속박" pill that sits above a stunned token.
 *  - `dollSprite` / `stunSprite` cache those paintings as canvases per size (the 2D board blits them).
 *  - `TrapMarks3D` is the WebGL layer: one small textured plane per trap and per stunned piece,
 *    with a subtle idle wobble of the dolls (off under prefers-reduced-motion). At most 6 traps and
 *    6 stunned pieces exist, so plain meshes (shared geometry + 3 materials) are cheapest.
 */
import * as THREE from 'three';
import type { PlayerId } from '../engine/types';
import { TEAM_COLORS } from './palette';

/** Doll size (fraction of a cell): on an empty square, and tucked in a corner under a token. */
export const DOLL_SIZE = 0.96;
export const DOLL_CORNER_SIZE = 0.56;
/** Corner offset (fraction of a cell, toward the bottom-left) of the mini doll when a piece stands on the trap. */
export const DOLL_CORNER_OFFSET = 0.34;
/**
 * Stun mark: a square sprite STUN_BOX cells wide centred on the token: a chain ring hugging the
 * coin and the "속박" pill across its top edge.
 */
export const STUN_BOX = 1.3;
/** Idle wobble: max angle (radians) and period (ms). */
export const WOBBLE_RAD = 0.12;
export const WOBBLE_MS = 2300;

/** Doll wobble angle at `now` (deterministic per square so neighbours never sway in step). */
export function wobbleAngle(now: number, sq: number): number {
  return WOBBLE_RAD * Math.sin((now / WOBBLE_MS) * Math.PI * 2 + sq * 1.7);
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A stitched rag doll centred at (x, y) with radius R, in `team`'s colours. */
export function paintDoll(g: CanvasRenderingContext2D, x: number, y: number, R: number, team: PlayerId): void {
  const col = TEAM_COLORS[team];
  g.save();
  // Team glow so the doll reads on the dark tiles.
  const halo = g.createRadialGradient(x, y, R * 0.15, x, y, R);
  halo.addColorStop(0, rgba(col.glow, 0.5));
  halo.addColorStop(0.6, rgba(col.glow, 0.18));
  halo.addColorStop(1, rgba(col.glow, 0));
  g.fillStyle = halo;
  g.beginPath();
  g.arc(x, y, R, 0, Math.PI * 2);
  g.fill();
  // The doll itself fills most of the square (the halo stays at R).
  g.translate(x, y + R * 0.05);
  g.scale(1.3, 1.3);
  g.translate(-x, -y);
  const lw = Math.max(1, R * 0.06);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // Dress: a bell in the team colour with a darker hem.
  const top = y - R * 0.05;
  const hem = y + R * 0.68;
  g.beginPath();
  g.moveTo(x - R * 0.2, top);
  g.quadraticCurveTo(x - R * 0.32, y + R * 0.3, x - R * 0.5, hem);
  g.quadraticCurveTo(x, hem + R * 0.14, x + R * 0.5, hem);
  g.quadraticCurveTo(x + R * 0.32, y + R * 0.3, x + R * 0.2, top);
  g.closePath();
  const dress = g.createLinearGradient(x, top, x, hem);
  dress.addColorStop(0, col.light);
  dress.addColorStop(0.55, col.main);
  dress.addColorStop(1, col.dark);
  g.fillStyle = dress;
  g.fill();
  g.strokeStyle = 'rgba(12,10,22,0.9)';
  g.lineWidth = lw;
  g.stroke();
  // A patch with cross stitches on the dress.
  g.fillStyle = 'rgba(240,232,250,0.85)';
  g.fillRect(x + R * 0.04, y + R * 0.26, R * 0.18, R * 0.16);
  g.strokeStyle = 'rgba(12,10,22,0.85)';
  g.lineWidth = lw * 0.7;
  g.strokeRect(x + R * 0.04, y + R * 0.26, R * 0.18, R * 0.16);
  // Floppy arms.
  g.strokeStyle = 'rgba(12,10,22,0.9)';
  g.lineWidth = lw * 2.4;
  g.beginPath();
  g.moveTo(x - R * 0.2, y + R * 0.06);
  g.quadraticCurveTo(x - R * 0.42, y + R * 0.12, x - R * 0.48, y + R * 0.32);
  g.moveTo(x + R * 0.2, y + R * 0.06);
  g.quadraticCurveTo(x + R * 0.42, y + R * 0.12, x + R * 0.48, y + R * 0.32);
  g.stroke();
  g.strokeStyle = '#EDE6F7';
  g.lineWidth = lw * 1.2;
  g.stroke();
  // Head: pale cloth with a dark outline, a tuft of yarn hair.
  const hy = y - R * 0.34;
  const hr = R * 0.3;
  g.fillStyle = '#EDE6F7';
  g.beginPath();
  g.arc(x, hy, hr, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(12,10,22,0.92)';
  g.lineWidth = lw;
  g.stroke();
  g.fillStyle = '#2A2238';
  g.beginPath();
  g.arc(x, hy - hr * 0.18, hr * 1.02, Math.PI * 1.08, Math.PI * 1.92);
  g.quadraticCurveTo(x, hy - hr * 0.55, x - hr * 0.98, hy - hr * 0.42);
  g.fill();
  // Button eyes: X stitches, one a little bigger (it is a sad old doll).
  g.strokeStyle = '#1A1426';
  g.lineWidth = lw * 1.1;
  const eye = (ex: number, s: number) => {
    g.beginPath();
    g.moveTo(ex - s, hy + hr * 0.05 - s);
    g.lineTo(ex + s, hy + hr * 0.05 + s);
    g.moveTo(ex + s, hy + hr * 0.05 - s);
    g.lineTo(ex - s, hy + hr * 0.05 + s);
    g.stroke();
  };
  eye(x - hr * 0.38, hr * 0.17);
  eye(x + hr * 0.38, hr * 0.2);
  // Stitched mouth.
  g.lineWidth = lw * 0.8;
  g.beginPath();
  g.moveTo(x - hr * 0.3, hy + hr * 0.52);
  g.lineTo(x + hr * 0.3, hy + hr * 0.52);
  for (let i = -2; i <= 2; i++) {
    g.moveTo(x + i * hr * 0.14, hy + hr * 0.42);
    g.lineTo(x + i * hr * 0.14, hy + hr * 0.62);
  }
  g.stroke();
  g.restore();
}

/**
 * The stun mark on a canvas `S` px square that spans STUN_BOX cells: a ring of chain links around
 * the coin and the "속박" pill over its top edge.
 */
export function paintStunMark(g: CanvasRenderingContext2D, S: number): void {
  const cell = S / STUN_BOX;
  const c = S / 2;
  g.save();
  // Chain ring: alternating link ovals around the coin (radius ~ the rarity ring).
  const R = cell * 0.47;
  const links = 14;
  g.lineWidth = Math.max(1, cell * 0.045);
  for (let i = 0; i < links; i++) {
    const a = (i / links) * Math.PI * 2;
    const x = c + Math.cos(a) * R;
    const y = c + Math.sin(a) * R;
    g.strokeStyle = 'rgba(20,12,40,0.9)';
    g.lineWidth = Math.max(1.5, cell * 0.075);
    g.beginPath();
    g.ellipse(x, y, cell * 0.075, cell * 0.045, a + Math.PI / 2 + (i % 2 ? Math.PI / 2 : 0), 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = i % 2 ? '#CDB8FF' : '#F1E9FF';
    g.lineWidth = Math.max(1, cell * 0.035);
    g.stroke();
  }
  const w = cell * 1.02;
  const h = cell * 0.38;
  paintStunBadge(g, c, c - cell * 0.5, w, h);
  g.restore();
}

/** The "속박" badge (chain link + label) centred at (x, y), `w` x `h` px. */
export function paintStunBadge(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.save();
  const r = h / 2;
  const left = x - w / 2;
  const top = y - h / 2;
  g.beginPath();
  g.moveTo(left + r, top);
  g.arcTo(left + w, top, left + w, top + h, r);
  g.arcTo(left + w, top + h, left, top + h, r);
  g.arcTo(left, top + h, left, top, r);
  g.arcTo(left, top, left + w, top, r);
  g.closePath();
  const bg = g.createLinearGradient(0, top, 0, top + h);
  bg.addColorStop(0, '#5B3FA8');
  bg.addColorStop(1, '#2C1B5C');
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = Math.max(1, h * 0.08);
  g.strokeStyle = '#CDB8FF';
  g.stroke();
  // Two chain links on the left.
  const cx = left + h * 0.62;
  g.lineWidth = Math.max(1, h * 0.11);
  g.strokeStyle = '#F1E9FF';
  for (const dx of [-h * 0.14, h * 0.14]) {
    g.beginPath();
    g.ellipse(cx + dx, y, h * 0.2, h * 0.12, dx < 0 ? -0.6 : 0.6, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#FFFFFF';
  g.font = `800 ${Math.round(h * 0.62)}px Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('속박', x + h * 0.36, y + h * 0.04);
  g.restore();
}

const dollCache = new Map<string, HTMLCanvasElement>();
const stunCache = new Map<number, HTMLCanvasElement>();


/** Cached doll canvas, `px` device pixels square. */
export function dollSprite(team: PlayerId, px: number): HTMLCanvasElement {
  const S = Math.max(8, Math.round(px));
  const key = `${team}|${S}`;
  let c = dollCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    if (g) paintDoll(g, S / 2, S / 2, S / 2, team);
    dollCache.set(key, c);
  }
  return c;
}

/** Cached stun mark canvas, `px` device pixels square (spans STUN_BOX cells). */
export function stunSprite(px: number): HTMLCanvasElement {
  const S = Math.max(16, Math.round(px));
  let c = stunCache.get(S);
  if (!c) {
    c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    if (g) paintStunMark(g, S);
    stunCache.set(S, c);
  }
  return c;
}

function canvasTexture(cvs: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cvs);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

/** One trap or stun mark in world space (x/z = square centre). */
export interface TrapMark3D {
  sq: number;
  owner: PlayerId;
  /** A piece stands on the trap: draw the mini doll in the square's corner, above the token. */
  covered: boolean;
}

/**
 * WebGL dolls and stun badges. `cellX` / `cellZ` map board coordinates to world x / z; the dolls
 * lie flat at `y` (just above the tiles), corner dolls and badges at `topY` (above the tokens).
 */
export class TrapMarks3D {
  readonly group = new THREE.Group();
  private readonly geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly dollMat: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];
  private readonly stunMat: THREE.MeshBasicMaterial;
  private readonly textures: THREE.Texture[] = [];
  private dolls: { mesh: THREE.Mesh; sq: number }[] = [];
  private badges: THREE.Mesh[] = [];

  constructor(
    private readonly cellX: (c: number) => number,
    private readonly cellZ: (r: number) => number,
    private readonly y: number,
    private readonly topY: number,
  ) {
    const mat = (cvs: HTMLCanvasElement) => {
      const tex = canvasTexture(cvs);
      this.textures.push(tex);
      return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
    };
    this.dollMat = [mat(dollSprite(0, 128)), mat(dollSprite(1, 128))];
    this.stunMat = mat(stunSprite(256));
    this.group.name = 'trap-marks';
  }

  /** Every doll trap on the board (full list). */
  setTraps(marks: readonly TrapMark3D[]): void {
    while (this.dolls.length > marks.length) {
      const d = this.dolls.pop()!;
      this.group.remove(d.mesh);
    }
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      let d = this.dolls[i];
      if (!d) {
        const mesh = new THREE.Mesh(this.geo, this.dollMat[m.owner]);
        mesh.raycast = () => undefined;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        d = { mesh, sq: m.sq };
        this.dolls.push(d);
      }
      d.sq = m.sq;
      d.mesh.material = this.dollMat[m.owner];
      const r = Math.floor(m.sq / 12);
      const c = m.sq % 12;
      const k = m.covered ? DOLL_CORNER_SIZE : DOLL_SIZE;
      // Covered: the doll peeks out of the square's bottom-left corner, over the token (the top
      // edge is where a stunned piece's "속박" pill sits).
      const off = m.covered ? DOLL_CORNER_OFFSET : 0;
      d.mesh.position.set(this.cellX(c) - off, m.covered ? this.topY : this.y, this.cellZ(r) + off);
      d.mesh.scale.set(k, 1, k);
      // Above the token and the stun chain ring (renderOrder 7), below nothing else.
      d.mesh.renderOrder = m.covered ? 8 : 1;
    }
  }

  /** Stunned pieces' squares (full list): a "속박" badge above each token. */
  setStunned(squares: readonly { r: number; c: number }[]): void {
    while (this.badges.length > squares.length) this.group.remove(this.badges.pop()!);
    for (let i = 0; i < squares.length; i++) {
      let b = this.badges[i];
      if (!b) {
        b = new THREE.Mesh(this.geo, this.stunMat);
        b.raycast = () => undefined;
        b.frustumCulled = false;
        b.renderOrder = 7;
        this.group.add(b);
        this.badges.push(b);
      }
      const p = squares[i];
      b.position.set(this.cellX(p.c), this.topY + 0.01, this.cellZ(p.r));
      b.scale.set(STUN_BOX, 1, STUN_BOX);
    }
  }

  /** Any doll on the board (the idle wobble needs frames). */
  get hasDolls(): boolean {
    return this.dolls.length > 0;
  }

  /** Idle wobble (call per frame while `hasDolls`; pass `animate` false to rest them). */
  update(now: number, animate: boolean): void {
    for (const d of this.dolls) d.mesh.rotation.y = animate ? wobbleAngle(now, d.sq) : 0;
  }

  dispose(): void {
    this.geo.dispose();
    for (const m of [...this.dollMat, this.stunMat]) m.dispose();
    for (const t of this.textures) t.dispose();
    this.dolls = [];
    this.badges = [];
  }
}
