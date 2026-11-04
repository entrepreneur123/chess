/**
 * The 2D board's animation loop under hostile frame timing (mid-match freeze regression). Runs the
 * real Board2DView against a minimal DOM / Canvas2D stub with a hand-driven requestAnimationFrame.
 *
 * Root cause of the freeze: rAF timestamps are the frame's start time, so the first frame after
 * animateMove() can be dated a little BEFORE the animation's start (performance.now() at the call).
 * Picker's hop indexed its squares with floor(t / step) = -1, the frame threw, the render loop died
 * and the move's promise never resolved: the match sat in 'animating' forever.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Move, Piece } from '../src/engine/types';

/** Any property is a no-op function returning another stub (gradients, patterns, paths...). */
function stub(): unknown {
  const fn = function () {
    return proxy;
  };
  const proxy: unknown = new Proxy(fn, {
    get: (_t, k) => {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'canvas') return fakeCanvas();
      return proxy;
    },
    set: () => true,
    apply: () => proxy,
  });
  return proxy;
}

function fakeCanvas(): Record<string, unknown> {
  return {
    width: 300,
    height: 300,
    style: {},
    getContext: () => stub(),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300 }),
    toDataURL: () => '',
    remove: () => undefined,
  };
}

type G = Record<string, unknown>;
const g = globalThis as unknown as G;
const saved: G = {};
let frames: ((t: number) => void)[] = [];
let clock = 1000;

beforeEach(() => {
  for (const k of ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'Image', 'matchMedia']) saved[k] = g[k];
  frames = [];
  clock = 1000;
  g.document = { createElement: () => fakeCanvas(), hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined };
  g.window = { devicePixelRatio: 1, addEventListener: () => undefined, removeEventListener: () => undefined, setTimeout, clearTimeout };
  g.requestAnimationFrame = (cb: (t: number) => void) => frames.push(cb);
  g.cancelAnimationFrame = () => undefined;
  g.getComputedStyle = () => ({ position: 'relative' });
  g.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    complete = false;
    naturalWidth = 0;
    decode = () => Promise.resolve();
    addEventListener() {}
  };
  g.matchMedia = () => ({ matches: false, addEventListener: () => undefined });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});

/** Run the pending animation frames with timestamp `t` (frames they request run next call). */
function runFrames(t: number): void {
  const now = frames.splice(0);
  for (const f of now) f(t);
}

async function makeBoard() {
  const { Board2DView } = await import('../src/render/Board2DView');
  const host = { clientWidth: 300, clientHeight: 300, style: {}, appendChild: () => undefined, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 300 }) };
  return new Board2DView(host as unknown as HTMLElement);
}

const picker: Piece = { id: 'p0-picker', owner: 0, character: 'picker', level: 3, pos: { r: 2, c: 2 } };
const victim: Piece = { id: 'p1-sad', owner: 1, character: 'sad', level: 1, pos: { r: 3, c: 3 } };

describe('Board2DView animation loop robustness', () => {
  it("a Picker hop whose first frame is dated before the animation's start still resolves", async () => {
    const realNow = performance.now.bind(performance);
    (performance as unknown as { now: () => number }).now = () => clock;
    try {
      const board = await makeBoard();
      board.setPieces([picker, victim]);
      runFrames(clock);
      // Picker hops over the sad onto (4,4), taking it on the way.
      const move: Move = { pieceId: picker.id, from: picker.pos, to: { r: 4, c: 4 }, captureId: victim.id, captureIds: [victim.id] };
      let done = false;
      void board.animateMove(move, [{ ...picker, pos: { r: 4, c: 4 } }]).then(() => (done = true));
      // The next frame's timestamp is the vsync time, 8 ms BEFORE the call above.
      expect(() => runFrames(clock - 8)).not.toThrow();
      for (let t = clock; t < clock + 10_000 && !done; t += 16) {
        runFrames(t);
        await Promise.resolve();
      }
      expect(done).toBe(true);
      board.dispose();
    } finally {
      (performance as unknown as { now: () => number }).now = realNow;
    }
  });

  it('a frame that throws settles the running move instead of leaving it pending forever', async () => {
    const board = await makeBoard();
    board.setPieces([picker, victim]);
    runFrames(performance.now());
    let done = false;
    const move: Move = { pieceId: picker.id, from: picker.pos, to: { r: 3, c: 2 } };
    void board.animateMove(move, [{ ...picker, pos: { r: 3, c: 2 } }]).then(() => (done = true));
    // Any FX bug inside the frame: here the draw itself fails.
    (board as unknown as { draw: () => void }).draw = () => {
      throw new Error('fx bug');
    };
    const err = console.error;
    console.error = () => undefined;
    try {
      expect(() => runFrames(performance.now() + 16)).not.toThrow();
    } finally {
      console.error = err;
    }
    await Promise.resolve();
    expect(done).toBe(true);
    board.dispose();
  });

  it('a hidden page never waits on frames: the move finishes at once', async () => {
    const board = await makeBoard();
    board.setPieces([picker, victim]);
    runFrames(performance.now());
    (g.document as { hidden: boolean }).hidden = true;
    let done = false;
    const move: Move = { pieceId: picker.id, from: picker.pos, to: { r: 4, c: 4 }, captureId: victim.id, captureIds: [victim.id] };
    void board.animateMove(move, [{ ...picker, pos: { r: 4, c: 4 } }]).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(true); // no frame ran at all
    board.dispose();
  });

  it('when animation frames stop coming, a running move is settled after FRAME_STALL_MS', async () => {
    const { FRAME_STALL_MS } = await import('../src/render/common');
    const board = await makeBoard();
    board.setPieces([picker, victim]);
    runFrames(performance.now());
    let done = false;
    void board.animateMove({ pieceId: picker.id, from: picker.pos, to: { r: 3, c: 2 } }, [{ ...picker, pos: { r: 3, c: 2 } }]).then(() => (done = true));
    // No runFrames(): the page is starved / throttled / its rAF stopped without a visibilitychange.
    await new Promise((r) => setTimeout(r, FRAME_STALL_MS + 150));
    expect(done).toBe(true);
    board.dispose();
  });
});

