/**
 * DEV-ONLY board lab (served by the Vite dev server at /src/render/dev/boardlab.html; not part of any
 * production entry, so it never reaches the bundle). Mounts BoardView({ topOnly: true }) or
 * Board2DView (`?mode=2d`) with pieces of every character for both teams and exposes `window.lab`
 * so a Playwright script can drive every visual state (wasteland, skill preview / cast, wasted
 * moves, deadly highlights, captures) and measure the JS cost of the render loop.
 */
import { BOARD_SIZE } from '../../engine/types';
import type { CharacterId, Level, Move, Piece, PlayerId, Pos } from '../../engine/types';
import { BoardView } from '../BoardView';
import { Board2DView } from '../Board2DView';
import type { BoardHighlights, IBoardView, SkillPreview } from '../types';

const params = new URLSearchParams(location.search);
const modeParam = params.get('mode');
/** '3d' = BoardView({ topOnly: true }) (the game's board), '3dfull' = legacy 3D arena, '2d' = Canvas2D. */
const mode = modeParam === '2d' ? '2d' : modeParam === '3dfull' ? '3dfull' : '3d';

/**
 * `?clock=manual`: deterministic time for screenshots (software WebGL is too slow for wall-clock
 * timing): performance.now / requestAnimationFrame are replaced and advanced by lab.step(ms).
 */
const clock = { manual: params.get('clock') === 'manual', now: 1000, queue: [] as FrameRequestCallback[] };
if (clock.manual) {
  performance.now = () => clock.now;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    clock.queue.push(cb);
    return clock.queue.length;
  };
  window.cancelAnimationFrame = (): void => {
    clock.queue.length = 0;
  };
}
/** Advance the manual clock by `ms` in `frameMs` frames (coarser frames: faster software GL runs). */
function step(ms: number, frameMs = 16): void {
  const end = clock.now + ms;
  while (clock.now < end) {
    clock.now = Math.min(end, clock.now + frameMs);
    const q = clock.queue.splice(0);
    for (const cb of q) cb(clock.now);
  }
}
const host = document.getElementById('board') as HTMLElement;
// `?fill=1`: the board fills the viewport (phone / tablet screenshots at the real board size).
if (params.get('fill') === '1') {
  host.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;margin:0';
}
const logEl = document.getElementById('log') as HTMLElement;
const view: IBoardView = mode === '2d' ? new Board2DView(host) : new BoardView(host, { topOnly: mode === '3d' });

const sq = (r: number, c: number): number => r * BOARD_SIZE + c;
const P = (id: string, owner: PlayerId, character: CharacterId, level: Level, r: number, c: number): Piece => ({ id, owner, character, level, pos: { r, c } });

/** Both teams, every character, mixed levels. */
function basePieces(): Piece[] {
  return [
    P('p0-sad', 0, 'sad', 1, 0, 1),
    P('p0-marki', 0, 'marki', 2, 1, 3),
    P('p0-walk', 0, 'walk', 3, 0, 6),
    P('p0-insaner', 0, 'insaner', 3, 2, 8),
    P('p0-brutile', 0, 'brutile', 2, 2, 4),
    P('p1-sad', 1, 'sad', 3, 9, 9),
    P('p1-marki', 1, 'marki', 1, 8, 8),
    P('p1-walk', 1, 'walk', 2, 9, 5),
    P('p1-insaner', 1, 'insaner', 1, 7, 3),
    P('p1-brutile', 1, 'brutile', 3, 7, 7),
  ];
}

/** Storm scene pieces: both teams spread over the middle (the storm scene drops those in the storm). */
function stormPieces(): Piece[] {
  return [
    P('p0-sad', 0, 'sad', 2, 3, 4),
    P('p0-marki', 0, 'marki', 2, 2, 5),
    P('p0-brutile', 0, 'brutile', 3, 4, 6),
    P('p0-insaner', 0, 'insaner', 3, 1, 3),
    P('p1-sad', 1, 'sad', 3, 6, 5),
    P('p1-walk', 1, 'walk', 2, 7, 4),
    P('p1-picker', 1, 'picker', 2, 5, 3),
    P('p1-michelle', 1, 'michelle', 1, 8, 6),
  ];
}

/**
 * Rakaeli scene: p0 Rakaeli (Lv3) at (3, 4) with `awaken` (undefined = base form), an enemy Rakaeli
 * (Lv2, transformed with `enemyAwaken`) at (6, 6), a stunned walk and a few others around.
 */
function rakPieces(awaken?: number, enemyAwaken?: number): Piece[] {
  const me = P('p0-rak', 0, 'rakaeli' as CharacterId, 3, 3, 4);
  const foe = P('p1-rak', 1, 'rakaeli' as CharacterId, 2, 6, 6);
  if (awaken) (me as Piece & { awaken?: number }).awaken = awaken;
  if (enemyAwaken) (foe as Piece & { awaken?: number }).awaken = enemyAwaken;
  return [
    me,
    foe,
    P('p0-sad', 0, 'sad', 2, 1, 2),
    P('p0-walk', 0, 'walk', 1, 1, 6),
    P('p1-marki', 1, 'marki', 2, 5, 3),
    P('p1-insaner', 1, 'insaner', 3, 8, 4),
    P('p1-picker', 1, 'picker', 1, 8, 7),
  ];
}

/** 3x3 wasteland (rows 5..7, cols 3..5) + a 2x2 one (rows 4..5, cols 8..9). */
const AREA_A = [5, 6, 7].flatMap((r) => [3, 4, 5].map((c) => sq(r, c)));
const AREA_B = [4, 5].flatMap((r) => [8, 9].map((c) => sq(r, c)));

let impacts = 0;
view.onImpact?.(() => {
  impacts++;
});
let taps: Pos[] = [];
view.onCellClick((p) => taps.push(p));

const log = (s: string): void => {
  logEl.textContent = s;
};

/** Frame-cost probe: wraps the view's private frame() / renderer.render (dev only). */
const probe = { frames: 0, renders: 0, total: 0, max: 0, samples: [] as number[] };
(function installProbe(): void {
  const v = view as unknown as { frame: (now: number) => void; renderer?: { render: (...a: unknown[]) => void } };
  const orig = v.frame;
  v.frame = (now: number): void => {
    const t0 = performance.now();
    orig(now);
    const dt = performance.now() - t0;
    probe.frames++;
    probe.total += dt;
    probe.max = Math.max(probe.max, dt);
    probe.samples.push(dt);
  };
  const r = v.renderer;
  if (r) {
    const render = r.render.bind(r);
    r.render = (...a: unknown[]): void => {
      probe.renders++;
      render(...a);
    };
  } else {
    // 2D: count frames that actually drew (draw() calls).
    const d = view as unknown as { draw: (now: number) => void };
    const draw = d.draw.bind(view);
    d.draw = (now: number): void => {
      probe.renders++;
      draw(now);
    };
  }
})();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const lab = {
  mode,
  view,
  sq,
  AREA_A,
  AREA_B,
  get impacts(): number {
    return impacts;
  },
  get taps(): Pos[] {
    return taps;
  },
  resetProbe(): void {
    probe.frames = 0;
    probe.renders = 0;
    probe.total = 0;
    probe.max = 0;
    probe.samples = [];
  },
  probeStats(): { frames: number; renders: number; avgMs: number; maxMs: number; p95Ms: number } {
    const s = [...probe.samples].sort((a, b) => a - b);
    return {
      frames: probe.frames,
      renders: probe.renders,
      avgMs: probe.frames ? probe.total / probe.frames : 0,
      maxMs: probe.max,
      p95Ms: s.length ? s[Math.floor(s.length * 0.95)] : 0,
    };
  },
  base(pieces = basePieces()): void {
    impacts = 0;
    taps = [];
    view.setPieces(pieces);
    view.setWaste?.([]);
    view.setSkillPreview?.(null, null);
    view.setHighlights({});
    log(`${mode} base`);
  },
  waste(): void {
    view.setWaste?.([...AREA_A, ...AREA_B]);
  },
  preview(valid: boolean): void {
    // Anchors: every square where a 3x3 fits (rows 3..8), preview at rows 5..7 / cols 3..5 or over a piece.
    const anchors: number[] = [];
    for (let r = 3; r <= 7; r++) for (let c = 0; c <= 9; c++) anchors.push(sq(r, c));
    const area = valid ? AREA_A : [8, 9, 10].flatMap((r) => [2, 3, 4].map((c) => sq(r, c)));
    const preview: SkillPreview = { squares: area, valid };
    view.setSkillPreview?.(anchors, preview);
  },
  clearPreview(): void {
    view.setSkillPreview?.(null, null);
  },
  async skill(caster = 'p0-brutile', area = AREA_A): Promise<number> {
    const t0 = performance.now();
    await view.animateSkill?.(caster, area);
    return performance.now() - t0;
  },
  startSkill(caster = 'p0-brutile', area = AREA_A): void {
    (window as unknown as { skillDone: unknown }).skillDone = view.animateSkill?.(caster, area).then(() => 'done');
  },
  /** Deadly highlights: p0-brutile selected, moves around it, two of them on wasteland. */
  deadly(tone: 'own' | 'enemy' = 'own'): void {
    const moves: Pos[] = [
      { r: 3, c: 4 },
      { r: 4, c: 4 },
      { r: 5, c: 4 },
      { r: 3, c: 3 },
      { r: 4, c: 3 },
      { r: 5, c: 3 },
      { r: 3, c: 5 },
      { r: 2, c: 5 },
      { r: 2, c: 3 },
    ];
    const h: BoardHighlights = { selected: { r: 2, c: 4 }, moves, captures: [], deadly: [{ r: 5, c: 4 }, { r: 5, c: 3 }], tone };
    view.setHighlights(h);
  },
  /**
   * Venoa's shot markers: a Venoa (own: p0 at 4,4; enemy: p1 at 5,4) aiming at two far targets
   * (reticles in the tone's shot colour) next to one adjacent capture (the red ring).
   */
  shots(tone: 'own' | 'enemy' = 'own'): void {
    const own = tone === 'own';
    const me: PlayerId = own ? 0 : 1;
    const foe: PlayerId = own ? 1 : 0;
    const at = own ? { r: 4, c: 4 } : { r: 5, c: 4 };
    const f = own ? 1 : -1;
    const far1 = { r: at.r + 2 * f, c: at.c };
    const far2 = { r: at.r + 3 * f, c: at.c + 3 };
    const adj = { r: at.r, c: at.c + 1 };
    view.setPieces([
      P(`p${me}-venoa`, me, 'venoa', 3, at.r, at.c),
      P(`p${foe}-sad`, foe, 'sad', 2, far1.r, far1.c),
      P(`p${foe}-walk`, foe, 'walk', 2, far2.r, far2.c),
      P(`p${foe}-marki`, foe, 'marki', 1, adj.r, adj.c),
    ]);
    const moves = [{ r: at.r - f, c: at.c }, { r: at.r, c: at.c - 1 }, { r: at.r + f, c: at.c }];
    // Her 3성 arrow range: forward and both forward diagonals 2..4, cut by the two targets.
    const shotRange: Pos[] = [];
    for (const dc of [-1, 0, 1]) {
      for (let k = 2; k <= 4; k++) {
        const q = { r: at.r + f * k, c: at.c + dc * k };
        if (q.r < 0 || q.r > 9 || q.c < 0 || q.c > 9) break;
        if ((q.r === far1.r && q.c === far1.c) || (q.r === far2.r && q.c === far2.c)) break;
        shotRange.push(q);
      }
    }
    view.setHighlights({ selected: at, moves, captures: [far1, far2, adj], shots: [far1, far2], shotRange, tone });
  },
  /** p0-walk (or any) stepping onto wasteland: absent from piecesAfter. */
  startWasted(id = 'p0-marki', to: Pos = { r: 5, c: 3 }): void {
    const pieces = basePieces();
    const mover = pieces.find((p) => p.id === id) as Piece;
    const move: Move = { pieceId: id, from: { ...mover.pos }, to, wasted: true };
    const after = pieces.filter((p) => p.id !== id);
    (window as unknown as { moveDone: unknown }).moveDone = view.animateMove(move, after).then(() => 'done');
  },
  /** Capture by `id`: a victim is placed one square in front of the attacker first. */
  setupCapture(id: string): { move: Move; after: Piece[] } {
    const pieces = basePieces();
    const att = pieces.find((p) => p.id === id) as Piece;
    const dr = att.owner === 0 ? 2 : -2;
    const to = { r: att.pos.r + dr, c: att.pos.c };
    const victimId = att.owner === 0 ? 'p1-victim' : 'p0-victim';
    pieces.push(P(victimId, att.owner === 0 ? 1 : 0, 'sad', 2, to.r, to.c));
    view.setPieces(pieces);
    view.setHighlights({});
    const move: Move = { pieceId: id, from: { ...att.pos }, to, captureId: victimId };
    const after = pieces.filter((p) => p.id !== victimId).map((p) => (p.id === id ? { ...p, pos: { ...to } } : p));
    return { move, after };
  },
  startCapture(id: string): void {
    const { move, after } = lab.setupCapture(id);
    impacts = 0;
    (window as unknown as { moveDone: unknown }).moveDone = view.animateMove(move, after).then(() => 'done');
  },
  /** Plain move for the move FX (e.g. brutile's green sparkle trail). */
  startMove(id = 'p0-brutile', to: Pos = { r: 2, c: 1 }): void {
    const pieces = basePieces();
    const mover = pieces.find((p) => p.id === id) as Piece;
    const move: Move = { pieceId: id, from: { ...mover.pos }, to };
    const after = pieces.map((p) => (p.id === id ? { ...p, pos: { ...to } } : p));
    (window as unknown as { moveDone: unknown }).moveDone = view.animateMove(move, after).then(() => 'done');
  },
  rakPieces,
  /** Rakaeli scene with p0 Rakaeli at `awaken` (2, 1 or undefined) and the enemy one at `enemy`. */
  rak(awaken?: number, enemy?: number): void {
    impacts = 0;
    view.setPieces(rakPieces(awaken, enemy));
    view.setWaste?.([]);
    view.setHighlights({});
    log(`${mode} rakaeli awaken=${awaken ?? '-'} enemy=${enemy ?? '-'}`);
  },
  /** playAwaken on p0 Rakaeli; window.awDone resolves to 'done'. `after` = the state to sync to. */
  startAwaken(phase: 'on' | 'off', id = 'p0-rak'): void {
    const p = view.playAwaken?.(id, phase) ?? Promise.resolve();
    (window as unknown as { awDone: unknown }).awDone = p.then(() => 'done');
  },
  /**
   * A Rakaeli move from the scene: `awaken` before the move (undefined = base form), to `to`,
   * capturing `victim` if given; piecesAfter has awaken - 1 (absent at 0).
   */
  startRakMove(awaken: number | undefined, to: Pos, victim?: string): void {
    const pieces = rakPieces(awaken, undefined);
    if (victim) {
      const vp = pieces.find((q) => q.id === victim);
      if (vp) vp.pos = { ...to };
    }
    view.setPieces(pieces);
    const me = pieces[0];
    const move: Move = { pieceId: me.id, from: { ...me.pos }, to, ...(victim ? { captureId: victim } : {}) };
    const left = awaken ? awaken - 1 : 0;
    const after = pieces
      .filter((q) => q.id !== victim)
      .map((q) => {
        if (q.id !== me.id) return q;
        const n: Piece & { awaken?: number } = { ...q, pos: { ...to } };
        delete n.awaken;
        if (left > 0) n.awaken = left;
        return n;
      });
    impacts = 0;
    (window as unknown as { moveDone: unknown }).moveDone = view.animateMove(move, after).then(() => 'done');
  },
  /**
   * Storm scene at `step` (columns per side; rows from step 3) with `nextIn` plies to the next
   * shrink: the open-area pieces of `stormPieces`, plus (with `closing`) a piece on each square that
   * this step swallowed, removed right after so they dissolve like the game's storm kills.
   */
  storm(step: number, nextIn: number | null = 2, closing = false): void {
    impacts = 0;
    const rows = step >= 3 ? step - 2 : 0;
    const open = (r: number, c: number): boolean => c >= step && c < BOARD_SIZE - step && r >= rows && r < BOARD_SIZE - rows;
    const keep = stormPieces().filter((p) => open(p.pos.r, p.pos.c));
    view.setWaste?.([]);
    view.setHighlights({});
    if (closing && step > 0) {
      // Pieces standing on the band this step closes (the previous step's open edge).
      const prevRows = step - 1 >= 3 ? step - 3 : 0;
      const prevOpen = (r: number, c: number): boolean => c >= step - 1 && c < BOARD_SIZE - step + 1 && r >= prevRows && r < BOARD_SIZE - prevRows;
      const doomed = [
        P('p0-doom-a', 0, 'sad', 2, Math.max(prevRows, 3), step - 1),
        P('p1-doom-b', 1, 'marki', 1, BOARD_SIZE - 1 - prevRows, 5),
        P('p0-doom-c', 0, 'walk', 1, prevRows, 4),
      ].filter((p) => prevOpen(p.pos.r, p.pos.c) && !open(p.pos.r, p.pos.c));
      view.setStorm?.(step - 1, 1);
      view.setPieces([...keep, ...doomed]);
      view.setStorm?.(step, nextIn);
      view.setPieces(keep);
    } else {
      view.setStorm?.(step, nextIn);
      view.setPieces(keep);
    }
    log(`${mode} storm step=${step} next=${nextIn} closing=${closing}`);
  },
  sleep,
  step,
  dispose(): void {
    view.dispose();
  },
};

(window as unknown as { lab: typeof lab }).lab = lab;
lab.base();
