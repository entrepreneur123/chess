/**
 * Canvas2D painting of Brutile's wasteland for the flat fallback board (Board2DView).
 *
 * Every square is a pre-rendered sprite (cached per variant x neighbour mask x pixel size, so at
 * most 4 x 16 sprites per cell size): scorched ground, a sickly green glowing crack network and a
 * poison puddle. Cracks always cross the square's sides at fixed points, so a square's cracks run on
 * into its wasteland neighbours; sides without a wasteland neighbour get a ragged burnt rim with a
 * toxic glow line. A second "glow" sprite (cracks only) is drawn additively with a pulsing alpha.
 */
import { makeRng } from './common';
import { WASTE_COLORS } from './palette';
import { paintSkullMark } from './waste';

/** Unit points where cracks cross a side (shared by both neighbours of that side). */
const SIDE_T = [0.31, 0.69];

type Pt = [number, number];

interface TileShape {
  /** Outline of the ground (ragged on open sides), unit coords, canvas y down. */
  outline: Pt[];
  /** Crack polylines (unit coords). */
  cracks: Pt[][];
  /** Ragged rim segments (open sides only). */
  rims: Pt[][];
  /** Poison puddle: centre + radii. */
  pool: { x: number; y: number; rx: number; ry: number } | null;
}

/** Variant of a square (stable per square). */
export const wasteVariant = (sq: number): number => ((sq * 2654435761) >>> 0) % 4;

function jagged(rnd: () => number, a: Pt, b: Pt, n: number, amp: number): Pt[] {
  const pts: Pt[] = [a];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const o = (rnd() - 0.5) * 2 * amp * Math.sin(Math.PI * t);
    pts.push([a[0] + dx * t + nx * o, a[1] + dy * t + ny * o]);
  }
  pts.push(b);
  return pts;
}

/**
 * Mask bits (board orientation): 1 = +c (right), 2 = -c (left), 4 = +r (screen up), 8 = -r (down).
 */
function shape(variant: number, mask: number): TileShape {
  const rnd = makeRng(1013 + variant * 7919 + mask * 31);
  const right = (mask & 1) !== 0;
  const left = (mask & 2) !== 0;
  const up = (mask & 4) !== 0;
  const down = (mask & 8) !== 0;
  // Ragged outline: walk the four sides clockwise from the top-left corner (canvas coords).
  const inset = (): number => 0.035 + rnd() * 0.1;
  const outline: Pt[] = [];
  const rims: Pt[][] = [];
  const side = (closed: boolean, from: Pt, to: Pt, inward: Pt): void => {
    const n = 7;
    const seg: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const d = closed ? 0 : inset() * Math.min(1, 4 * Math.min(t, 1 - t) + 0.35);
      seg.push([from[0] + (to[0] - from[0]) * t + inward[0] * d, from[1] + (to[1] - from[1]) * t + inward[1] * d]);
    }
    outline.push(...seg.slice(0, n));
    if (!closed) rims.push(seg);
  };
  side(up, [0, 0], [1, 0], [0, 1]);
  side(right, [1, 0], [1, 1], [-1, 0]);
  side(down, [1, 1], [0, 1], [0, -1]);
  side(left, [0, 1], [0, 0], [1, 0]);
  // Crack network: two inner nodes, joined; every side point links to the nearest node. Open
  // sides get short dead-end cracks that stop before the rim.
  const n1: Pt = [0.28 + rnd() * 0.16, 0.3 + rnd() * 0.16];
  const n2: Pt = [0.56 + rnd() * 0.16, 0.54 + rnd() * 0.16];
  const near = (p: Pt): Pt => (Math.hypot(p[0] - n1[0], p[1] - n1[1]) < Math.hypot(p[0] - n2[0], p[1] - n2[1]) ? n1 : n2);
  const cracks: Pt[][] = [jagged(rnd, n1, n2, 5, 0.07)];
  const sidePts: { p: Pt; closed: boolean }[] = [];
  for (const t of SIDE_T) {
    sidePts.push({ p: [t, 0], closed: up }, { p: [1, t], closed: right }, { p: [t, 1], closed: down }, { p: [0, t], closed: left });
  }
  for (const s of sidePts) {
    const n = near(s.p);
    if (s.closed) cracks.push(jagged(rnd, n, s.p, 4, 0.06));
    else if (rnd() < 0.5) {
      const end: Pt = [n[0] + (s.p[0] - n[0]) * 0.72, n[1] + (s.p[1] - n[1]) * 0.72];
      cracks.push(jagged(rnd, n, end, 3, 0.05));
    }
  }
  const pool = variant % 2 === 0 ? { x: 0.3 + rnd() * 0.4, y: 0.3 + rnd() * 0.4, rx: 0.1 + rnd() * 0.05, ry: 0.07 + rnd() * 0.04 } : null;
  return { outline, cracks, rims, pool };
}

function path(g: CanvasRenderingContext2D, pts: Pt[], S: number, close = false): void {
  g.beginPath();
  g.moveTo(pts[0][0] * S, pts[0][1] * S);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] * S, pts[i][1] * S);
  if (close) g.closePath();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/** Ground sprite: scorched earth + crack network + puddle + toxic rim. */
function paintGround(g: CanvasRenderingContext2D, S: number, variant: number, mask: number): void {
  const sh = shape(variant, mask);
  const rnd = makeRng(77 + variant * 13 + mask);
  g.save();
  path(g, sh.outline, S, true);
  g.clip();
  g.fillStyle = WASTE_COLORS.ground;
  g.fillRect(0, 0, S, S);
  // Ash / burn blotches.
  for (let i = 0; i < 6; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = S * (0.15 + rnd() * 0.25);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, hexA(WASTE_COLORS.groundEdge, 0.55));
    gr.addColorStop(1, hexA(WASTE_COLORS.groundEdge, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  // Fine dead cracks (dark).
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = Math.max(0.6, S * 0.012);
  for (let i = 0; i < 5; i++) {
    const a: Pt = [rnd(), rnd()];
    const b: Pt = [a[0] + (rnd() - 0.5) * 0.5, a[1] + (rnd() - 0.5) * 0.5];
    path(g, jagged(rnd, a, b, 4, 0.05), S);
    g.stroke();
  }
  // Poison puddle.
  if (sh.pool) {
    const p = sh.pool;
    const gr = g.createRadialGradient(p.x * S, p.y * S, 0, p.x * S, p.y * S, p.rx * S);
    gr.addColorStop(0, hexA(WASTE_COLORS.miasma, 0.75));
    gr.addColorStop(0.7, hexA('#174E0E', 0.9));
    gr.addColorStop(1, hexA('#0B240A', 0.9));
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(p.x * S, p.y * S, p.rx * S, p.ry * S, 0.3, 0, Math.PI * 2);
    g.fill();
  }
  // Crack network: dark gash + green core.
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = Math.max(1.2, S * 0.05);
  for (const c of sh.cracks) {
    path(g, c, S);
    g.stroke();
  }
  g.strokeStyle = WASTE_COLORS.glow;
  g.lineWidth = Math.max(0.8, S * 0.022);
  for (const c of sh.cracks) {
    path(g, c, S);
    g.stroke();
  }
  g.strokeStyle = hexA(WASTE_COLORS.core, 0.9);
  g.lineWidth = Math.max(0.5, S * 0.008);
  for (const c of sh.cracks) {
    path(g, c, S);
    g.stroke();
  }
  // Darker burnt rim inside the ragged edge.
  g.lineWidth = S * 0.09;
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  for (const r of sh.rims) {
    path(g, r, S);
    g.stroke();
  }
  g.restore();
  // Toxic rim line along the ragged open sides.
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = hexA(WASTE_COLORS.glow, 0.85);
  g.lineWidth = Math.max(0.8, S * 0.02);
  for (const r of sh.rims) {
    path(g, r, S);
    g.stroke();
  }
  g.restore();
}

/** Glow sprite (cracks + rim halo only), drawn additively with a pulsing alpha. */
function paintGlow(g: CanvasRenderingContext2D, S: number, variant: number, mask: number): void {
  const sh = shape(variant, mask);
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const [w, a] of [
    [0.14, 0.16],
    [0.07, 0.35],
  ] as const) {
    g.strokeStyle = hexA(WASTE_COLORS.glow, a);
    g.lineWidth = S * w;
    for (const c of sh.cracks) {
      path(g, c, S);
      g.stroke();
    }
    for (const r of sh.rims) {
      path(g, r, S);
      g.stroke();
    }
  }
  g.restore();
}

/** Sprite cache for one board (cleared on resize). */
export class Waste2DSprites {
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private skull: HTMLCanvasElement | null = null;
  private skullSize = 0;

  private sprite(kind: 'ground' | 'glow', variant: number, mask: number, S: number): HTMLCanvasElement {
    const key = `${kind}:${variant}:${mask}:${S}`;
    let c = this.cache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    if (g) (kind === 'ground' ? paintGround : paintGlow)(g, S, variant, mask);
    this.cache.set(key, c);
    return c;
  }

  ground(variant: number, mask: number, S: number): HTMLCanvasElement {
    return this.sprite('ground', variant, mask, S);
  }

  glow(variant: number, mask: number, S: number): HTMLCanvasElement {
    return this.sprite('glow', variant, mask, S);
  }

  /** Skull danger mark sprite of S x S px. */
  skullMark(S: number): HTMLCanvasElement {
    if (this.skull && this.skullSize === S) return this.skull;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    if (g) paintSkullMark(g, S / 2, S / 2, S / 2);
    this.skull = c;
    this.skullSize = S;
    return c;
  }

  clear(): void {
    this.cache.clear();
    this.skull = null;
  }
}
