import { describe, expect, it } from 'vitest';
import type { GameState, Move } from '../src/engine';
import { GameController, type ControllerPorts } from '../src/ui/game/GameController';
import { makeState } from './helpers';

/** Manual clock + timers so races can be driven deterministically. */
function harness(initial: GameState, opts: { botMove?: (s: GameState) => Move | null } = {}) {
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const botCalls: { state: GameState; resolve: (m: Move | null) => void }[] = [];
  const anims: { move: Move; resolve: () => void }[] = [];
  const ports: ControllerPorts = {
    requestBotMove: (s) =>
      new Promise((resolve) => {
        if (opts.botMove) resolve(opts.botMove(s));
        else botCalls.push({ state: s, resolve });
      }),
    animate: (move) => new Promise<void>((resolve) => anims.push({ move, resolve })),
    botThinkDelayMs: () => 0,
    now: () => t,
    turnTimeMs: 60_000,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  };
  const ctrl = new GameController(initial, ports);
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    const end = t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
      await flush();
    }
    t = end;
    await flush();
  };
  const finishAnims = async () => {
    while (anims.length) {
      anims.shift()!.resolve();
      await flush();
    }
  };
  return { ctrl, botCalls, anims, flush, advance, finishAnims };
}

// Player 0: sad (2,5), marki (0,0), walk (0,11). Player 1: marki L3 (9,5) can capture along column 5.
const position = () =>
  makeState([
    [0, 'sad', 1, 2, 5],
    [0, 'marki', 1, 0, 0],
    [0, 'walk', 1, 0, 11],
    [1, 'marki', 3, 9, 5],
    [1, 'sad', 1, 11, 11],
    [1, 'walk', 1, 11, 0],
  ]);

describe('GameController selection after the opponent moves', () => {
  it('does not keep highlights of a piece that the bot just captured', async () => {
    const h = harness(position());
    h.ctrl.start();
    expect(h.ctrl.phase).toBe('humanTurn');
    h.ctrl.tapCell({ r: 2, c: 5 });
    h.ctrl.tapCell({ r: 3, c: 5 });
    await h.finishAnims();
    expect(h.ctrl.phase).toBe('botThinking');
    // While the bot thinks, the player inspects their own sad (non-actionable preview).
    h.ctrl.tapCell({ r: 3, c: 5 });
    expect(h.ctrl.snapshot().selection?.pieceId).toBe('p0-sad');
    // Bot captures it.
    h.botCalls[0].resolve({ pieceId: 'p1-marki', from: { r: 9, c: 5 }, to: { r: 3, c: 5 }, captureId: 'p0-sad' });
    await h.flush();
    await h.finishAnims();
    expect(h.ctrl.phase).toBe('humanTurn');
    const sel = h.ctrl.snapshot().selection;
    if (sel) {
      // Any surviving selection must refer to a piece that still exists.
      expect(h.ctrl.state.pieces.some((p) => p.id === sel.pieceId)).toBe(true);
    }
  });

  it('a preview made during the bot turn becomes actionable (and fresh) on the human turn', async () => {
    const h = harness(position());
    h.ctrl.start();
    h.ctrl.tapCell({ r: 0, c: 0 }); // marki
    h.ctrl.tapCell({ r: 1, c: 0 });
    await h.finishAnims();
    h.ctrl.tapCell({ r: 2, c: 5 }); // preview own sad while the bot thinks
    expect(h.ctrl.snapshot().selection?.actionable).toBe(false);
    h.botCalls[0].resolve({ pieceId: 'p1-sad', from: { r: 11, c: 11 }, to: { r: 10, c: 11 } });
    await h.flush();
    await h.finishAnims();
    expect(h.ctrl.phase).toBe('humanTurn');
    const sel = h.ctrl.snapshot().selection;
    expect(sel?.pieceId).toBe('p0-sad');
    expect(sel?.actionable).toBe(true);
    // Tapping a highlighted destination now plays the move instead of silently deselecting.
    h.ctrl.tapCell({ r: 3, c: 5 });
    expect(h.ctrl.phase).toBe('animating');
  });
});

describe('GameController races', () => {
  it('timeout during the bot think delay discards the stale bot move', async () => {
    const h = harness(position());
    h.ctrl.start();
    h.ctrl.tapCell({ r: 0, c: 0 });
    h.ctrl.tapCell({ r: 1, c: 0 });
    await h.finishAnims();
    await h.advance(60_000); // bot times out
    expect(h.ctrl.state.turn).toBe(0);
    expect(h.ctrl.phase).toBe('humanTurn');
    h.botCalls[0].resolve({ pieceId: 'p1-sad', from: { r: 11, c: 11 }, to: { r: 10, c: 11 } });
    await h.flush();
    expect(h.ctrl.phase).toBe('humanTurn');
    expect(h.anims.length).toBe(0);
  });

  it('resign while animating ends the game once and ignores the animation result', async () => {
    const h = harness(position());
    const ended: GameState[] = [];
    h.ctrl.on((e) => e.type === 'ended' && ended.push(e.state));
    h.ctrl.start();
    h.ctrl.tapCell({ r: 0, c: 0 });
    h.ctrl.tapCell({ r: 1, c: 0 });
    expect(h.ctrl.phase).toBe('animating');
    h.ctrl.resign();
    await h.finishAnims();
    await h.advance(120_000);
    expect(ended.length).toBe(1);
    expect(ended[0].endReason).toBe('resign');
    expect(h.ctrl.phase).toBe('ended');
    expect(h.botCalls.length).toBe(0);
  });

  it('pause freezes the clock and a bot reply waits for resume', async () => {
    const h = harness(position());
    h.ctrl.start();
    h.ctrl.tapCell({ r: 0, c: 0 });
    h.ctrl.tapCell({ r: 1, c: 0 });
    await h.finishAnims();
    h.ctrl.pause();
    h.botCalls[0].resolve({ pieceId: 'p1-sad', from: { r: 11, c: 11 }, to: { r: 10, c: 11 } });
    await h.advance(10 * 60_000);
    expect(h.ctrl.phase).toBe('botThinking');
    expect(h.ctrl.state.consecutiveTimeouts).toEqual([0, 0]);
    expect(h.anims.length).toBe(0);
    h.ctrl.resume();
    await h.flush();
    expect(h.anims.length).toBe(1);
    await h.finishAnims();
    expect(h.ctrl.phase).toBe('humanTurn');
  });

  it('three human timeouts forfeit exactly once, and dispose stops everything', async () => {
    const h = harness(position(), {
      botMove: (s) => (s.pieces.find((p) => p.id === 'p1-sad')!.pos.r === 11
        ? { pieceId: 'p1-sad', from: { r: 11, c: 11 }, to: { r: 10, c: 11 } }
        : { pieceId: 'p1-sad', from: { r: 10, c: 11 }, to: { r: 11, c: 11 } }),
    });
    const ended: GameState[] = [];
    h.ctrl.on((e) => e.type === 'ended' && ended.push(e.state));
    h.ctrl.start();
    for (let i = 0; i < 3; i++) {
      await h.advance(60_000);
      await h.finishAnims();
    }
    expect(ended.length).toBe(1);
    expect(ended[0].endReason).toBe('timeoutForfeit');
    expect(ended[0].winner).toBe(1);
    h.ctrl.dispose();
    await h.advance(600_000);
    expect(ended.length).toBe(1);
  });
});
