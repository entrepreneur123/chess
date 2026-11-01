import { describe, expect, it } from 'vitest';
import {
  MAX_CONSECUTIVE_TIMEOUTS,
  NO_CAPTURE_PLY_LIMIT,
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
  it('passes the turn, counts, and forfeits at the limit; moving resets', () => {
    let g = createGame(defaultFormation(), defaultFormation());
    g = applyTimeout(g);
    expect(g.turn).toBe(1);
    expect(g.consecutiveTimeouts).toEqual([1, 0]);
    expect(g.history[g.history.length - 1]).toEqual({ kind: 'pass', player: 0, reason: 'timeout' });
    expect(g.ply).toBe(1);
    g = applyMove(g, getLegalMoves(g)[0]);
    g = applyTimeout(g); // p0 #2
    expect(g.consecutiveTimeouts[0]).toBe(2);
    g = applyMove(g, getLegalMoves(g)[0]);
    g = applyMove(g, getLegalMoves(g)[0]); // p0 moves -> reset
    expect(g.consecutiveTimeouts[0]).toBe(0);
    for (let i = 0; i < MAX_CONSECUTIVE_TIMEOUTS - 1; i++) {
      g = applyTimeout(g); // p1
      expect(g.status).toBe('playing');
      g = applyMove(g, getLegalMoves(g)[0]); // p0
    }
    expect(g.consecutiveTimeouts[1]).toBe(MAX_CONSECUTIVE_TIMEOUTS - 1);
    g = applyTimeout(g);
    expect(g.status).toBe('ended');
    expect(g.winner).toBe(0);
    expect(g.endReason).toBe('timeoutForfeit');
    expect(applyTimeout(g)).toBe(g);
  });
});

describe('no moves / stalemate / move limit', () => {
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
  it('timeout followed by a no-moves player also auto-passes', () => {
    const s = makeState([
      [0, 'sad', 1, 5, 5],
      [1, 'walk', 1, 0, 0],
    ]);
    const s2 = applyTimeout(s);
    expect(s2.turn).toBe(0);
    expect(s2.history.map((h) => h.kind === 'pass' && h.reason)).toEqual(['timeout', 'noMoves']);
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
    // p0: sad boxed in the corner by its own pieces; marki blocked by the ally ahead; walk facing the edge.
    // p1: a lone walk facing the edge. After p1 times out, nobody can move -> stalemate.
    const base = makeState(
      [
        [0, 'sad', 1, 0, 0],
        [0, 'marki', 1, 1, 0],
        [0, 'walk', 1, 0, 1],
        [1, 'walk', 1, 11, 5],
      ],
      1,
    );
    const s = {
      ...base,
      pieces: base.pieces.map((p) => (p.id === 'p0-marki' || p.id === 'p0-walk' ? { ...p, dir: -1 as const } : p.id === 'p1-walk' ? { ...p, dir: 1 as const } : p)),
    };
    const s2 = applyTimeout(s);
    expect(s2.status).toBe('ended');
    expect(s2.endReason).toBe('stalemate');
    expect(s2.winner).toBe(0);
    expect(materialScore(s2, 0)).toBe(3 + 3 + 4);
    expect(materialScore(s2, 1)).toBe(4);
  });
  it('move limit adjudication: winner by material, or draw', () => {
    const base = makeState(
      [
        [0, 'sad', 3, 5, 5],
        [1, 'sad', 1, 8, 8],
      ],
      0,
      { pliesSinceCapture: NO_CAPTURE_PLY_LIMIT - 1 },
    );
    const s2 = applyMove(base, { pieceId: 'p0-sad', from: { r: 5, c: 5 }, to: { r: 5, c: 6 } });
    expect(s2.status).toBe('ended');
    expect(s2.endReason).toBe('moveLimit');
    expect(s2.winner).toBe(0);
    const eq = makeState(
      [
        [0, 'sad', 2, 5, 5],
        [1, 'sad', 2, 8, 8],
      ],
      0,
      { pliesSinceCapture: NO_CAPTURE_PLY_LIMIT - 1 },
    );
    const d = applyMove(eq, { pieceId: 'p0-sad', from: { r: 5, c: 5 }, to: { r: 5, c: 6 } });
    expect(d.status).toBe('ended');
    expect(d.endReason).toBe('moveLimit');
    expect(d.winner).toBeNull();
    // a capture on the last ply resets instead
    const cap = makeState(
      [
        [0, 'sad', 1, 5, 5],
        [0, 'walk', 1, 0, 0],
        [1, 'sad', 1, 5, 6],
        [1, 'walk', 1, 11, 0],
      ],
      0,
      { pliesSinceCapture: NO_CAPTURE_PLY_LIMIT - 1 },
    );
    const c2 = applyMove(cap, { pieceId: 'p0-sad', from: { r: 5, c: 5 }, to: { r: 5, c: 6 } });
    expect(c2.status).toBe('playing');
    expect(c2.pliesSinceCapture).toBe(0);
  });
  it('timeouts count toward the ply limit', () => {
    const s = makeState(
      [
        [0, 'sad', 1, 5, 5],
        [1, 'sad', 2, 8, 8],
      ],
      0,
      { pliesSinceCapture: NO_CAPTURE_PLY_LIMIT - 1 },
    );
    const s2 = applyTimeout(s);
    expect(s2.endReason).toBe('moveLimit');
    expect(s2.winner).toBe(1);
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
