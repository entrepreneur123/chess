import { describe, expect, it } from 'vitest';
import {
  SUDDEN_DEATH_PLY,
  STORM_INTERVAL_PLIES,
  suddenDeathIn,
  turnNumber,
  applyMove,
  applyTimeout,
  createGame,
  defaultFormation,
  getLegalMoves,
  isLegalMove,
  materialScore,
  resign,
} from '../src/engine';
import type { GameState } from '../src/engine';
import { makeState } from './helpers';

const mv = (s: GameState, id: string, r: number, c: number) => {
  const m = getLegalMoves(s, id).find((x) => x.to.r === r && x.to.c === c);
  if (!m) throw new Error(`no move ${id} -> ${r},${c}`);
  return m;
};

describe('applyMove', () => {
  it('moves, alternates turns, is pure', () => {
    const g = createGame(defaultFormation(), defaultFormation());
    const snapshot = structuredClone(g);
    const m = mv(g, 'p0-marki', 5, 4);
    const g2 = applyMove(g, { pieceId: m.pieceId, from: m.from, to: m.to });
    expect(g).toEqual(snapshot);
    expect(g2.turn).toBe(1);
    expect(g2.ply).toBe(1);
    expect(g2.pliesSinceCapture).toBe(1);
    expect(g2.history).toEqual([{ kind: 'move', player: 0, move: { pieceId: 'p0-marki', from: { r: 2, c: 4 }, to: { r: 5, c: 4 } } }]);
    expect(structuredClone(g2)).toEqual(g2);
  });
  it('throws on illegal moves', () => {
    const g = createGame(defaultFormation(), defaultFormation());
    expect(() => applyMove(g, { pieceId: 'p0-marki', from: { r: 2, c: 4 }, to: { r: 6, c: 4 } })).toThrow();
    expect(() => applyMove(g, { pieceId: 'p1-marki', from: { r: 9, c: 7 }, to: { r: 8, c: 7 } })).toThrow();
    expect(() => applyMove(g, { pieceId: 'p0-marki', from: { r: 2, c: 5 }, to: { r: 3, c: 4 } })).toThrow();
    expect(isLegalMove(g, { pieceId: 'p0-marki', from: { r: 2, c: 4 }, to: { r: 3, c: 4 } })).toBe(true);
    const ended = resign(g, 0);
    expect(() => applyMove(ended, { pieceId: 'p0-marki', from: { r: 2, c: 4 }, to: { r: 3, c: 4 } })).toThrow();
  });
  it('captures fill captureId, reset pliesSinceCapture, elimination wins', () => {
    const s = makeState(
      [
        [0, 'sad', 1, 5, 5],
        [0, 'marki', 1, 0, 0],
        [1, 'sad', 1, 6, 5],
      ],
      0,
      { pliesSinceCapture: 10 },
    );
    const s2 = applyMove(s, { pieceId: 'p0-sad', from: { r: 5, c: 5 }, to: { r: 6, c: 5 } });
    expect(s2.pieces.map((p) => p.id).sort()).toEqual(['p0-marki', 'p0-sad']);
    const h = s2.history[0];
    expect(h.kind === 'move' && h.move.captureId).toBe('p1-sad');
    expect(s2.pliesSinceCapture).toBe(0);
    expect(s2.status).toBe('ended');
    expect(s2.winner).toBe(0);
    expect(s2.endReason).toBe('elimination');
  });
});

describe('timeouts', () => {
  it('running out of time forfeits at once (no strikes)', () => {
    const g = createGame(defaultFormation(), defaultFormation());
    const t = applyTimeout(g);
    expect(t.status).toBe('ended');
    expect(t.winner).toBe(1);
    expect(t.endReason).toBe('timeoutForfeit');
    expect(t.history[t.history.length - 1]).toEqual({ kind: 'pass', player: 0, reason: 'timeout' });
    expect(t.consecutiveTimeouts).toEqual([1, 0]);
    expect(applyTimeout(t)).toBe(t);
    // Also for the second player, later in the game.
    const g2 = applyMove(g, getLegalMoves(g)[0]);
    const t2 = applyTimeout(g2);
    expect(t2.winner).toBe(0);
    expect(t2.endReason).toBe('timeoutForfeit');
  });
  it('a forfeit is decided before the storm could tick', () => {
    const s = makeState(
      [
        [0, 'sad', 1, 5, 5],
        [1, 'sad', 1, 8, 0],
      ],
      1,
      { stormIn: 1 },
    );
    const t = applyTimeout(s);
    expect(t.endReason).toBe('timeoutForfeit');
    expect(t.winner).toBe(0);
    expect(t.storm).toBe(0);
    expect(t.pieces).toHaveLength(2);
  });
});

describe('turn counter', () => {
  it('counts rounds: both players\' first moves are turn 1', () => {
    expect(turnNumber({ ply: 0 })).toBe(1);
    expect(turnNumber({ ply: 1 })).toBe(1);
    expect(turnNumber({ ply: 2 })).toBe(2);
    expect(turnNumber({ ply: 119 })).toBe(60);
    expect(turnNumber({ ply: 79 })).toBe(40);
    expect(turnNumber({ ply: SUDDEN_DEATH_PLY })).toBe(41);
    let g = createGame(defaultFormation(), defaultFormation());
    g = applyMove(g, getLegalMoves(g)[0]);
    expect(turnNumber(g)).toBe(1);
    g = applyMove(g, getLegalMoves(g)[0]);
    expect(turnNumber(g)).toBe(2);
  });
});

describe('no moves / stalemate / sudden death', () => {
  it('auto-passes when the next player has no moves', () => {
    // p1 only has a walk on row 0 (stuck). p0 moves -> p1 auto-passes -> p0 to move again.
    const s = makeState([
      [0, 'sad', 1, 5, 5],
      [1, 'walk', 1, 0, 0],
    ]);
    const s2 = applyMove(s, { pieceId: 'p0-sad', from: { r: 5, c: 5 }, to: { r: 5, c: 6 } });
    expect(s2.status).toBe('playing');
    expect(s2.turn).toBe(0);
    expect(s2.ply).toBe(2);
    expect(s2.pliesSinceCapture).toBe(2);
    expect(s2.history[s2.history.length - 1]).toEqual({ kind: 'pass', player: 1, reason: 'noMoves' });
    expect(getLegalMoves(s2).length).toBeGreaterThan(0);
  });
  it('reaching the last row no longer stalls the game: the mover turns around', () => {
    const s = makeState([
      [0, 'marki', 1, 10, 3],
      [0, 'walk', 3, 11, 0],
      [1, 'walk', 1, 0, 5],
    ]);
    const s2 = applyMove(s, { pieceId: 'p0-marki', from: { r: 10, c: 3 }, to: { r: 11, c: 3 } });
    expect(s2.status).toBe('playing');
    expect(s2.pieces.find((p) => p.id === 'p0-marki')!.dir).toBe(-1);
    // p1's walk was placed on row 0 facing the edge (artificial), so p1 auto-passes and p0 moves again.
    expect(s2.history[s2.history.length - 1]).toEqual({ kind: 'pass', player: 1, reason: 'noMoves' });
    expect(s2.turn).toBe(0);
  });
  it('stalemate when neither side can move (all pieces boxed in), adjudicated by material', () => {
    // p0: sad boxed in the corner by its own pieces; marki blocked by the ally ahead; walk facing
    // the edge; brutile's only steps lead onto wasteland. p1: a lone walk facing the edge.
    // Brutile steps onto wasteland (destroyed) -> nobody can move -> stalemate.
    const base = makeState(
      [
        [0, 'sad', 1, 0, 0],
        [0, 'marki', 1, 1, 0],
        [0, 'walk', 1, 0, 1],
        [0, 'brutile', 1, 5, 5],
        [1, 'walk', 1, 11, 5],
      ],
      0,
      { waste: [6 * 12 + 4, 6 * 12 + 6] },
    );
    const s = {
      ...base,
      pieces: base.pieces.map((p) => (p.id === 'p0-marki' || p.id === 'p0-walk' ? { ...p, dir: -1 as const } : p.id === 'p1-walk' ? { ...p, dir: 1 as const } : p)),
    };
    const s2 = applyMove(s, mv(s, 'p0-brutile', 6, 4));
    expect(s2.status).toBe('ended');
    expect(s2.endReason).toBe('stalemate');
    expect(s2.winner).toBe(0);
    expect(materialScore(s2, 0)).toBe(3 + 3 + 4);
    expect(materialScore(s2, 1)).toBe(4);
  });
  it('sudden death: the storm starts on its own at SUDDEN_DEATH_PLY', () => {
    const base = makeState(
      [
        [0, 'sad', 2, 5, 5],
        [0, 'walk', 1, 0, 0],
        [1, 'sad', 2, 8, 8],
        [1, 'walk', 1, 11, 0],
      ],
      0,
      { ply: SUDDEN_DEATH_PLY - 2, pliesSinceCapture: 30 },
    );
    expect(suddenDeathIn(base)).toBe(2);
    const s1 = applyMove(base, mv(base, 'p0-sad', 5, 6));
    expect(s1.stormIn).toBeNull();
    expect(suddenDeathIn(s1)).toBe(1);
    const s2 = applyMove(s1, mv(s1, 'p1-sad', 8, 7));
    expect(s2.status).toBe('playing');
    expect(s2.stormIn).toBe(STORM_INTERVAL_PLIES);
    expect(suddenDeathIn(s2)).toBeNull();
    // long capture-free stretches no longer end the game: only the storm / elimination do
    expect(s2.pliesSinceCapture).toBe(32);
  });
  it('a storm that swallows both last pieces is decided by material', () => {
    const base = makeState(
      [
        [0, 'sad', 3, 5, 1],
        [1, 'sad', 1, 7, 10],
      ],
      0,
      { stormIn: 1, storm: 1 },
    );
    const s2 = applyMove(base, mv(base, 'p0-sad', 6, 1));
    expect(s2.status).toBe('ended');
    expect(s2.endReason).toBe('storm');
    expect(s2.pieces).toHaveLength(0);
    expect(s2.winner).toBe(0);
    const eq = makeState(
      [
        [0, 'sad', 2, 5, 1],
        [1, 'sad', 2, 7, 10],
      ],
      0,
      { stormIn: 1, storm: 1 },
    );
    const d = applyMove(eq, mv(eq, 'p0-sad', 6, 1));
    expect(d.endReason).toBe('storm');
    expect(d.winner).toBeNull();
  });
  it('a capture-free game is bounded by the storm', () => {
    // Shuffle back and forth without ever capturing: sudden death + storm must end it.
    let s = makeState(
      [
        [0, 'sad', 1, 1, 5],
        [1, 'sad', 1, 10, 6],
      ],
      0,
    );
    let guard = 0;
    while (s.status === 'playing' && guard++ < 400) {
      const legal = getLegalMoves(s);
      const moves = legal.filter((m) => !m.captureId);
      s = applyMove(s, (moves.length ? moves : legal)[guard % (moves.length || legal.length)]);
    }
    expect(s.status).toBe('ended');
    expect(SUDDEN_DEATH_PLY + 6 * STORM_INTERVAL_PLIES).toBe(116);
    expect(s.ply).toBeLessThanOrEqual(SUDDEN_DEATH_PLY + 6 * STORM_INTERVAL_PLIES);
  });
});

describe('resign', () => {
  it('opponent wins', () => {
    const g = createGame(defaultFormation(), defaultFormation());
    const r = resign(g, 1);
    expect(r.status).toBe('ended');
    expect(r.winner).toBe(0);
    expect(r.endReason).toBe('resign');
    expect(g.status).toBe('playing');
  });
});
