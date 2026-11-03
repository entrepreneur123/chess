import { describe, expect, it } from 'vitest';
import type { GameState, Move } from '../src/engine';
import { GameController, type ControllerPorts } from '../src/ui/game/GameController';
import { makeState } from './helpers';

/** Manual clock + timers so races can be driven deterministically. */
function harness(initial: GameState, opts: { botMove?: (s: GameState) => Move | null | Promise<Move | null> } = {}) {
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const botCalls: { state: GameState; resolve: (m: Move | null) => void }[] = [];
  const anims: { move: Move; resolve: () => void }[] = [];
  const ports: ControllerPorts = {
    requestBotMove: (s) =>
      new Promise((resolve) => {
        if (opts.botMove) resolve(Promise.resolve(opts.botMove(s)));
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
  it('the bot never times out: a hung bot plays a fallback move and its late reply is ignored', async () => {
    const h = harness(position());
    h.ctrl.start();
    h.ctrl.tapCell({ r: 0, c: 0 });
    h.ctrl.tapCell({ r: 1, c: 0 });
    await h.finishAnims();
    await h.advance(60_000); // the bot's clock runs out: it must not forfeit
    expect(h.ctrl.state.status).toBe('playing');
    expect(h.anims.length).toBe(1); // the fallback move is being animated
    await h.finishAnims();
    expect(h.ctrl.state.status).toBe('playing');
    expect(h.ctrl.state.turn).toBe(0);
    expect(h.ctrl.phase).toBe('humanTurn');
    const last = h.ctrl.state.history[h.ctrl.state.history.length - 1];
    expect(last.kind === 'move' && last.player).toBe(1);
    h.botCalls[0].resolve({ pieceId: 'p1-sad', from: { r: 11, c: 11 }, to: { r: 10, c: 11 } });
    await h.flush();
    expect(h.ctrl.phase).toBe('humanTurn');
    expect(h.anims.length).toBe(0);
  });

  it('a bot failure (null, illegal move, rejection) falls back to a legal move, never a forfeit', async () => {
    const answers: (() => Move | null | Promise<Move | null>)[] = [
      () => null,
      () => ({ pieceId: 'p1-sad', from: { r: 11, c: 11 }, to: { r: 0, c: 0 } }),
      () => Promise.reject(new Error('worker crashed')),
    ];
    for (const answer of answers) {
      const h = harness(position(), { botMove: answer });
      h.ctrl.start();
      h.ctrl.tapCell({ r: 0, c: 0 });
      h.ctrl.tapCell({ r: 1, c: 0 });
      await h.finishAnims();
      await h.advance(0);
      await h.finishAnims();
      expect(h.ctrl.state.status).toBe('playing');
      expect(h.ctrl.phase).toBe('humanTurn');
      const last = h.ctrl.state.history[h.ctrl.state.history.length - 1];
      expect(last.kind === 'move' && last.player).toBe(1);
    }
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

  it('one human timeout forfeits exactly once, and dispose stops everything', async () => {
    const h = harness(position(), {
      botMove: (s) => (s.pieces.find((p) => p.id === 'p1-sad')!.pos.r === 11
        ? { pieceId: 'p1-sad', from: { r: 11, c: 11 }, to: { r: 10, c: 11 } }
        : { pieceId: 'p1-sad', from: { r: 10, c: 11 }, to: { r: 11, c: 11 } }),
    });
    const ended: GameState[] = [];
    h.ctrl.on((e) => e.type === 'ended' && ended.push(e.state));
    h.ctrl.start();
    await h.advance(59_999);
    expect(h.ctrl.state.status).toBe('playing');
    await h.advance(1);
    await h.finishAnims();
    expect(h.ctrl.phase).toBe('ended');
    expect(h.anims.length).toBe(0);
    await h.advance(120_000);
    expect(ended.length).toBe(1);
    expect(ended[0].endReason).toBe('timeoutForfeit');
    expect(ended[0].winner).toBe(1);
    h.ctrl.dispose();
    await h.advance(600_000);
    expect(ended.length).toBe(1);
  });
});

describe('chain move, storm and timer scaling in the controller', () => {
  const chainPosition = () =>
    makeState([
      [0, 'insaner', 3, 5, 5],
      [1, 'walk', 1, 5, 6],
      [1, 'sad', 1, 11, 11],
      [1, 'marki', 1, 11, 0],
      [0, 'sad', 1, 0, 0],
    ]);

  it('emits bonus + absorb, pre-selects the chaining piece, and skipBonus hands the turn over', async () => {
    const { ctrl, flush, finishAnims, botCalls } = harness(chainPosition());
    const events: string[] = [];
    ctrl.on((e) => {
      if (e.type === 'bonus') events.push(`bonus:${e.player}:${e.pieceId}`);
      if (e.type === 'absorb') events.push(`absorb:${e.player}:${e.character}`);
    });
    ctrl.start();
    await flush();
    expect(ctrl.tryHumanMove({ pieceId: 'p0-insaner', from: { r: 5, c: 5 }, to: { r: 5, c: 6 } })).toBe(true);
    await flush();
    await finishAnims();
    expect(events).toEqual(['absorb:0:walk', 'bonus:0:p0-insaner']);
    expect(ctrl.phase).toBe('humanTurn');
    expect(ctrl.state.bonusPieceId).toBe('p0-insaner');
    const snap = ctrl.snapshot();
    expect(snap.selection?.pieceId).toBe('p0-insaner');
    expect(snap.selection?.actionable).toBe(true);
    // Other own pieces cannot be moved during the chain.
    expect(ctrl.tryHumanMove({ pieceId: 'p0-sad', from: { r: 0, c: 0 }, to: { r: 1, c: 0 } })).toBe(false);
    expect(ctrl.skipBonus()).toBe(true);
    await flush();
    expect(ctrl.state.bonusPieceId).toBeNull();
    expect(ctrl.state.turn).toBe(1);
    expect(ctrl.phase).toBe('botThinking');
    expect(botCalls.length).toBe(1);
    expect(ctrl.skipBonus()).toBe(false);
  });

  it('uses the shrinking turn clock and reports storm advances', async () => {
    // 1 v 2 from the start: the clock is 20 s and the storm activates on the first settle.
    const initial = makeState([
      [0, 'sad', 3, 5, 5],
      [1, 'sad', 3, 8, 8],
      [1, 'marki', 1, 11, 0],
    ]);
    const bot = (s: GameState) => {
      // Red shuffles its sad back and forth; the marki stays on column 0 and will be swallowed.
      const me = s.pieces.find((p) => p.id === 'p1-sad')!;
      const to = me.pos.c === 8 ? { r: 8, c: 7 } : { r: 8, c: 8 };
      return { pieceId: 'p1-sad', from: { ...me.pos }, to };
    };
    const { ctrl, flush, finishAnims, advance } = harness(initial, { botMove: bot });
    (ctrl as unknown as { ports: { turnTimeMs?: number } }).ports.turnTimeMs = undefined;
    const storms: number[] = [];
    ctrl.on((e) => {
      if (e.type === 'storm') storms.push(e.storm);
    });
    ctrl.start();
    await flush();
    expect(ctrl.turnTimeMs).toBe(20_000);
    expect(ctrl.state.stormIn).toBeNull(); // makeState bypasses createGame; the first ply settles it
    let col = 5;
    for (let i = 0; i < 4 && ctrl.state.status === 'playing'; i++) {
      const me = ctrl.state.pieces.find((p) => p.id === 'p0-sad')!;
      const to = { r: 5, c: col === 5 ? 6 : 5 };
      col = to.c;
      expect(ctrl.tryHumanMove({ pieceId: 'p0-sad', from: { ...me.pos }, to })).toBe(true);
      await flush();
      await finishAnims();
      await advance(0);
      await finishAnims();
      await flush();
      if (i === 0) expect(ctrl.state.stormIn).toBeGreaterThan(0);
    }
    expect(storms).toEqual([1]);
    expect(ctrl.state.storm).toBe(1);
    expect(ctrl.state.pieces.some((p) => p.id === 'p1-marki')).toBe(false);
    expect(ctrl.state.status).toBe('playing');
  });
});

describe('GameController without a match clock', () => {
  it('has no match clock: a long game is never ended by wall-clock time', async () => {
    const h = harness(position(), {
      botMove: (s) => (s.pieces.find((p) => p.id === 'p1-sad')!.pos.r === 11
        ? { pieceId: 'p1-sad', from: { r: 11, c: 11 }, to: { r: 10, c: 11 } }
        : { pieceId: 'p1-sad', from: { r: 10, c: 11 }, to: { r: 11, c: 11 } }),
    });
    expect('matchRemainingMs' in h.ctrl).toBe(false);
    h.ctrl.start();
    // 16 rounds of 55 s each (> 14 minutes) with the human always moving just in time.
    for (let i = 0; i < 16; i++) {
      await h.advance(55_000);
      const me = h.ctrl.state.pieces.find((p) => p.id === 'p0-walk')!;
      const to = { r: me.pos.r === 0 ? 1 : 0, c: me.pos.r === 0 ? 10 : 11 };
      const m = { pieceId: 'p0-walk', from: { ...me.pos }, to };
      expect(h.ctrl.tryHumanMove(m)).toBe(true);
      await h.finishAnims();
      await h.advance(0);
      await h.finishAnims();
      expect(h.ctrl.state.status).toBe('playing');
      expect(h.ctrl.phase).toBe('humanTurn');
    }
  });

  it('letting a chain move lapse on time is not a forfeit', async () => {
    const h = harness(
      makeState([
        [0, 'insaner', 3, 5, 5],
        [1, 'walk', 1, 5, 6],
        [1, 'sad', 1, 11, 11],
        [1, 'marki', 1, 11, 0],
        [0, 'sad', 1, 0, 0],
      ]),
    );
    h.ctrl.start();
    expect(h.ctrl.tryHumanMove({ pieceId: 'p0-insaner', from: { r: 5, c: 5 }, to: { r: 5, c: 6 } })).toBe(true);
    await h.finishAnims();
    expect(h.ctrl.state.bonusPieceId).toBe('p0-insaner');
    await h.advance(60_000);
    expect(h.ctrl.state.status).toBe('playing');
    expect(h.ctrl.state.bonusPieceId).toBeNull();
    expect(h.ctrl.state.turn).toBe(1);
    expect(h.ctrl.phase).toBe('botThinking');
  });
});
