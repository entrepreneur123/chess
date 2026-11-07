import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  MAX_MATCH_PLIES,
  STORM_FULL_STEPS,
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
  resign,
  skillUnlockIn,
  wipeWinner,
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
    const m = mv(g, 'p0-marki', 4, 3);
    const g2 = applyMove(g, { pieceId: m.pieceId, from: m.from, to: m.to });
    expect(g).toEqual(snapshot);
    expect(g2.turn).toBe(1);
    expect(g2.ply).toBe(1);
    expect(g2.pliesSinceCapture).toBe(1);
    expect(g2.history).toEqual([{ kind: 'move', player: 0, move: { pieceId: 'p0-marki', from: { r: 1, c: 3 }, to: { r: 4, c: 3 } } }]);
    expect(structuredClone(g2)).toEqual(g2);
  });
  it('throws on illegal moves', () => {
    const g = createGame(defaultFormation(), defaultFormation());
    expect(() => applyMove(g, { pieceId: 'p0-marki', from: { r: 1, c: 3 }, to: { r: 5, c: 3 } })).toThrow();
    expect(() => applyMove(g, { pieceId: 'p1-marki', from: { r: 8, c: 6 }, to: { r: 7, c: 6 } })).toThrow();
    expect(() => applyMove(g, { pieceId: 'p0-marki', from: { r: 1, c: 4 }, to: { r: 2, c: 3 } })).toThrow();
    expect(isLegalMove(g, { pieceId: 'p0-marki', from: { r: 1, c: 3 }, to: { r: 2, c: 3 } })).toBe(true);
    const ended = resign(g, 0);
    expect(() => applyMove(ended, { pieceId: 'p0-marki', from: { r: 1, c: 3 }, to: { r: 2, c: 3 } })).toThrow();
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
    expect(turnNumber({ ply: 37 })).toBe(19);
    // The storm starts with turn 20.
    expect(turnNumber({ ply: SUDDEN_DEATH_PLY })).toBe(20);
    expect(turnNumber({ ply: SUDDEN_DEATH_PLY - 1 })).toBe(19);
    // STORM_INTERVAL_PLIES is 2 turns.
    expect(turnNumber({ ply: SUDDEN_DEATH_PLY + STORM_INTERVAL_PLIES }) - turnNumber({ ply: SUDDEN_DEATH_PLY })).toBe(2);
    let g = createGame(defaultFormation(), defaultFormation());
    g = applyMove(g, getLegalMoves(g)[0]);
    expect(turnNumber(g)).toBe(1);
    g = applyMove(g, getLegalMoves(g)[0]);
    expect(turnNumber(g)).toBe(2);
  });
});

describe('no moves / stalemate / sudden death', () => {
  it('a side with no legal action loses at once (must act every turn)', () => {
    // p1 only has a walk on row 0 (stuck). p0 moves -> p1 cannot act -> p1 loses.
    const s = makeState([
      [0, 'sad', 1, 5, 5],
      [1, 'walk', 1, 0, 0],
    ]);
    const s2 = applyMove(s, { pieceId: 'p0-sad', from: { r: 5, c: 5 }, to: { r: 5, c: 6 } });
    expect(s2.status).toBe('ended');
    expect(s2.endReason).toBe('immobile');
    expect(s2.winner).toBe(0);
  });
  it('reaching the last row no longer stalls the game: the mover turns around', () => {
    const s = makeState([
      [0, 'marki', 1, 8, 3],
      [0, 'walk', 3, 9, 0],
      [1, 'walk', 1, 0, 5],
      [1, 'sad', 1, 5, 9],
    ]);
    const s2 = applyMove(s, { pieceId: 'p0-marki', from: { r: 8, c: 3 }, to: { r: 9, c: 3 } });
    expect(s2.status).toBe('playing');
    expect(s2.pieces.find((p) => p.id === 'p0-marki')!.dir).toBe(-1);
    // p1 still has a free piece (its sad), so the game goes on.
    expect(s2.turn).toBe(1);
  });
  it('when nobody can move, the side to move loses (no stalemate any more)', () => {
    // p0: sad boxed in the corner by its own pieces; marki blocked by the ally ahead; walk facing
    // the edge; brutile's only steps lead onto wasteland. p1: a lone walk facing the edge.
    // Brutile steps onto wasteland (destroyed) -> nobody can move -> stalemate.
    const base = makeState(
      [
        [0, 'sad', 1, 0, 0],
        [0, 'marki', 1, 1, 0],
        [0, 'walk', 1, 0, 1],
        [0, 'brutile', 1, 5, 5],
        [1, 'walk', 1, 9, 5],
      ],
      0,
      { waste: [6 * BOARD_SIZE + 4, 6 * BOARD_SIZE + 6] },
    );
    const s = {
      ...base,
      pieces: base.pieces.map((p) => (p.id === 'p0-marki' || p.id === 'p0-walk' ? { ...p, dir: -1 as const } : p.id === 'p1-walk' ? { ...p, dir: 1 as const } : p)),
    };
    const s2 = applyMove(s, mv(s, 'p0-brutile', 6, 4));
    expect(s2.status).toBe('ended');
    // It is p1's turn and p1 cannot act: p1 loses, whatever the material says.
    expect(s2.endReason).toBe('immobile');
    expect(s2.winner).toBe(0);
  });
  it('sudden death: the storm starts on its own at SUDDEN_DEATH_PLY', () => {
    const base = makeState(
      [
        [0, 'sad', 2, 5, 5],
        [0, 'walk', 1, 0, 0],
        [1, 'sad', 2, 8, 8],
        [1, 'walk', 1, 9, 0],
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
  it('a storm that swallows both last pieces is decided by piece COUNT; 1 vs 1 is a draw', () => {
    // 1 vs 1 (a 3성 against a 1성): rarity and grade do not count, it is a draw.
    const one = makeState(
      [
        [0, 'sad', 3, 5, 1],
        [1, 'sad', 1, 7, 8],
      ],
      0,
      { stormIn: 1, storm: 1 },
    );
    const d1 = applyMove(one, mv(one, 'p0-sad', 6, 1));
    expect(d1.status).toBe('ended');
    expect(d1.endReason).toBe('storm');
    expect(d1.pieces).toHaveLength(0);
    expect(d1.winner).toBeNull();
    // 2 cheap pieces vs 1 legendary 3성: the side with more pieces wins.
    const two = makeState(
      [
        [0, 'sad', 1, 5, 1],
        [0, 'michelle', 1, 3, 8],
        [1, 'insaner', 3, 7, 8],
      ],
      0,
      { stormIn: 1, storm: 1 },
    );
    const w = applyMove(two, mv(two, 'p0-sad', 6, 1));
    expect(w.endReason).toBe('storm');
    expect(w.pieces).toHaveLength(0);
    expect(w.winner).toBe(0);
    expect(wipeWinner(two.pieces, two.pieces.map((p) => p.id))).toBe(0);
  });
  it('a capture-free game is bounded by the storm', () => {
    // Shuffle back and forth without ever capturing: sudden death + storm must end it.
    let s = makeState(
      [
        [0, 'sad', 1, 1, 4],
        [1, 'sad', 1, 8, 5],
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
    // 10 x 10: six 2-turn steps down to the middle 2 x 2, which holds 5 turns, then the 7th step
    // swallows the board: 38 + 6 * 4 + 10 = 72 plies at most.
    expect(BOARD_SIZE).toBe(10);
    expect(STORM_FULL_STEPS).toBe(7);
    expect(MAX_MATCH_PLIES).toBe(SUDDEN_DEATH_PLY + (STORM_FULL_STEPS - 1) * STORM_INTERVAL_PLIES + 10);
    expect(MAX_MATCH_PLIES).toBe(72);
    expect(s.ply).toBeLessThanOrEqual(MAX_MATCH_PLIES);
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

describe('random first player: turn counting, skills and sudden death stay fair', () => {
  it('whoever starts, each side unlocks its skill on its own 4th turn and both have played 19 moves when sudden death starts', () => {
    for (const first of [0, 1] as const) {
      const g = createGame(defaultFormation(), defaultFormation(), first);
      expect(g.turn).toBe(first);
      expect(g.ply).toBe(0);
      // Ply p is the (floor(p / 2) + 1)-th turn of the side to move: first mover on even plies.
      const sideAt = (ply: number) => (ply % 2 === 0 ? first : 1 - first);
      const ownTurn = (ply: number) => Math.floor(ply / 2) + 1;
      expect(turnNumber({ ply: 0 })).toBe(1);
      expect(turnNumber({ ply: 1 })).toBe(1);
      // Skills: locked on each side's first three turns, open from its 4th (SKILL_UNLOCK_PLY = 6).
      for (let ply = 0; ply < 12; ply++) {
        const open = skillUnlockIn({ ply }) === 0;
        expect(open, `ply ${ply} side ${sideAt(ply)}`).toBe(ownTurn(ply) >= 4);
      }
      // Sudden death: at ply 38 the first mover starts turn 20; both sides have made 19 moves.
      expect(SUDDEN_DEATH_PLY).toBe(38);
      expect(ownTurn(SUDDEN_DEATH_PLY)).toBe(20);
      expect(ownTurn(SUDDEN_DEATH_PLY + 1)).toBe(20);
      expect(suddenDeathIn({ ply: 37, stormIn: null, status: 'playing' })).toBe(1);
    }
  });

  it('the coin flip is a fair 50/50', async () => {
    const { coinFlipFirst, seededRng } = await import('../src/meta/rng');
    const rng = seededRng(2026);
    let ones = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) ones += coinFlipFirst(rng);
    expect(Math.abs(ones / N - 0.5)).toBeLessThan(0.015);
  });
});
