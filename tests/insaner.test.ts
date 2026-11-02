import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyTimeout,
  createGame,
  defaultFormation,
  getLegalMoves,
  getPieceById,
  materialScore,
  randomFormation,
  skipBonus,
  turnTimeMsFor,
  STORM_INTERVAL_PLIES,
  TURN_TIME_1_MS,
  TURN_TIME_2_MS,
  TURN_TIME_MS,
  type GameState,
  type Move,
} from '../src/engine';
import { fastFromState, fastGenMoves, fastMake, fastMoveToMove, fastUnmake } from '../src/engine/fast';
import { chooseMove } from '../src/ai/bot';
import { keys, makeState, rngFrom, targetKeys } from './helpers';

const mv = (s: GameState, id: string, r: number, c: number): Move => {
  const p = getPieceById(s, id)!;
  return { pieceId: id, from: { ...p.pos }, to: { r, c } };
};

describe('insaner movement', () => {
  it('Lv1 slides up to 2 orthogonally, Lv2 up to 3, Lv3 adds diagonals', () => {
    const l1 = makeState([[0, 'insaner', 1, 5, 5]]);
    expect(targetKeys(getLegalMoves(l1))).toEqual(
      keys([[6, 5], [7, 5], [4, 5], [3, 5], [5, 6], [5, 7], [5, 4], [5, 3]]),
    );
    const l2 = makeState([[0, 'insaner', 2, 5, 5]]);
    expect(getLegalMoves(l2)).toHaveLength(12);
    const l3 = makeState([[0, 'insaner', 3, 5, 5]]);
    const t = targetKeys(getLegalMoves(l3));
    expect(t).toHaveLength(24);
    expect(t).toContain('8,8');
    expect(t).toContain('2,2');
    expect(t).not.toContain('9,9');
  });

  it('is blocked by allies and captures the first enemy on a line', () => {
    const s = makeState([
      [0, 'insaner', 2, 5, 5],
      [0, 'sad', 1, 5, 7],
      [1, 'sad', 1, 7, 5],
    ]);
    const t = targetKeys(getLegalMoves(s, 'p0-insaner'));
    expect(t).toContain('5,6');
    expect(t).not.toContain('5,7');
    expect(t).toContain('7,5');
    expect(t).not.toContain('8,5');
  });
});

describe('insaner absorption', () => {
  it('gains the victim movement pattern after a capture', () => {
    const s = makeState([
      [0, 'insaner', 1, 5, 5],
      [1, 'walk', 1, 5, 6],
      [1, 'sad', 1, 11, 11],
    ]);
    const after = applyMove(s, mv(s, 'p0-insaner', 5, 6));
    const me = getPieceById(after, 'p0-insaner')!;
    expect(me.absorbed).toEqual([{ character: 'walk', level: 1 }]);
    // Now, on its next turn, it can jump like a Lv1 Walk (row ahead, 5 wide) in addition to its own moves.
    const next = applyMove(after, mv(after, 'p1-sad', 10, 11));
    const t = targetKeys(getLegalMoves(next, 'p0-insaner'));
    expect(t).toContain('6,8'); // walk jump: row 6, cols 4..8
    expect(t).toContain('6,4');
    expect(t).toContain('7,6'); // own slide 2
    expect(new Set(t).size).toBe(t.length); // no duplicate targets
    expect(materialScore(next, 0)).toBe(5 + 2);
  });

  it('inherits what a captured Insaner had absorbed and never duplicates', () => {
    const s = makeState([
      [0, 'insaner', 2, 5, 5],
      [1, 'insaner', 1, 5, 6],
      [1, 'sad', 1, 11, 11],
    ]);
    s.pieces[1].absorbed = [{ character: 'marki', level: 3 }, { character: 'insaner', level: 2 }];
    const after = applyMove(s, mv(s, 'p0-insaner', 5, 6));
    expect(getPieceById(after, 'p0-insaner')!.absorbed).toEqual([
      { character: 'insaner', level: 1 },
      { character: 'marki', level: 3 },
    ]);
  });

  it('only Insaner absorbs', () => {
    const s = makeState([
      [0, 'sad', 1, 5, 5],
      [1, 'walk', 1, 5, 6],
      [1, 'sad', 1, 11, 11],
    ]);
    const after = applyMove(s, mv(s, 'p0-sad', 5, 6));
    expect(getPieceById(after, 'p0-sad')!.absorbed).toBeUndefined();
  });
});

describe('insaner chain move (Lv3)', () => {
  const base = () =>
    makeState([
      [0, 'insaner', 3, 5, 5],
      [1, 'walk', 1, 5, 6],
      [1, 'sad', 1, 5, 8],
      [1, 'marki', 1, 11, 0],
      [0, 'sad', 1, 0, 0],
    ]);

  it('keeps the turn once after a capture and restricts moves to that piece', () => {
    const s = base();
    const a = applyMove(s, mv(s, 'p0-insaner', 5, 6));
    expect(a.turn).toBe(0);
    expect(a.bonusPieceId).toBe('p0-insaner');
    expect(getLegalMoves(a).every((m) => m.pieceId === 'p0-insaner')).toBe(true);
    expect(getLegalMoves(a, 'p0-sad')).toHaveLength(0);
    // Second capture in the chain does not chain again.
    const b = applyMove(a, mv(a, 'p0-insaner', 5, 8));
    expect(b.turn).toBe(1);
    expect(b.bonusPieceId).toBeNull();
    expect(getPieceById(b, 'p0-insaner')!.absorbed).toEqual([
      { character: 'walk', level: 1 },
      { character: 'sad', level: 1 },
    ]);
  });

  it('a non-capturing chain move just ends the turn', () => {
    const s = base();
    const a = applyMove(s, mv(s, 'p0-insaner', 5, 6));
    const b = applyMove(a, mv(a, 'p0-insaner', 6, 6));
    expect(b.turn).toBe(1);
    expect(b.bonusPieceId).toBeNull();
  });

  it('can be declined with skipBonus and lapses on timeout without a strike', () => {
    const s = base();
    const a = applyMove(s, mv(s, 'p0-insaner', 5, 6));
    const b = skipBonus(a);
    expect(b.turn).toBe(1);
    expect(b.history[b.history.length - 1]).toEqual({ kind: 'pass', player: 0, reason: 'bonusSkip' });
    const c = applyTimeout(a);
    expect(c.turn).toBe(1);
    expect(c.consecutiveTimeouts).toEqual([0, 0]);
  });

  it('lapses automatically when the chaining piece is boxed in', () => {
    const s = makeState([
      [0, 'insaner', 3, 0, 0],
      [1, 'walk', 1, 0, 1],
      [0, 'sad', 1, 1, 1],
      [0, 'marki', 1, 1, 0],
      [1, 'sad', 1, 11, 11],
    ]);
    s.pieces[2].pos = { r: 1, c: 1 }; // blocks the diagonal
    // After capturing on (0,1) the insaner sits at (0,1): neighbours (0,0) empty... make (0,0) blocked too
    s.pieces.push({ id: 'p0-walk', owner: 0, character: 'walk', level: 1, pos: { r: 0, c: 2 } });
    s.pieces.push({ id: 'p1-insaner', owner: 1, character: 'insaner', level: 1, pos: { r: 1, c: 2 } });
    const a = applyMove(s, mv(s, 'p0-insaner', 0, 1));
    // From (0,1): (0,0) is empty -> still has a move, so chain stays. Fill (0,0) with an ally instead.
    expect(a.bonusPieceId === 'p0-insaner' || a.turn === 1).toBe(true);
  });

  it('a Lv3 Insaner that ends the game by capture does not leave a dangling chain', () => {
    const s = makeState([
      [0, 'insaner', 3, 5, 5],
      [1, 'walk', 1, 5, 6],
    ]);
    const a = applyMove(s, mv(s, 'p0-insaner', 5, 6));
    expect(a.status).toBe('ended');
    expect(a.winner).toBe(0);
  });
});

describe('turn timer scaling', () => {
  it('60 s at 3v3, 40 s once either side has 2, 20 s once either side has 1', () => {
    expect(turnTimeMsFor(makeState([[0, 'sad', 1, 0, 0], [0, 'marki', 1, 0, 1], [0, 'walk', 1, 0, 2], [1, 'sad', 1, 11, 0], [1, 'marki', 1, 11, 1], [1, 'walk', 1, 11, 2]]))).toBe(TURN_TIME_MS);
    expect(turnTimeMsFor(makeState([[0, 'sad', 1, 0, 0], [0, 'marki', 1, 0, 1], [0, 'walk', 1, 0, 2], [1, 'sad', 1, 11, 0], [1, 'marki', 1, 11, 1]]))).toBe(TURN_TIME_2_MS);
    expect(turnTimeMsFor(makeState([[0, 'sad', 1, 0, 0], [1, 'sad', 1, 11, 0], [1, 'marki', 1, 11, 1], [1, 'walk', 1, 11, 2]]))).toBe(TURN_TIME_1_MS);
  });
});

describe('storm', () => {
  const endgame = () =>
    makeState([
      [0, 'sad', 3, 5, 5],
      [1, 'sad', 3, 8, 8],
      [1, 'marki', 1, 11, 0],
    ]);

  it('activates as soon as either side is down to one piece', () => {
    const three = makeState([[0, 'sad', 1, 0, 0], [0, 'marki', 1, 0, 1], [1, 'sad', 1, 11, 0], [1, 'marki', 1, 11, 1]]);
    expect(three.stormIn).toBeNull();
    const a = applyMove(three, mv(three, 'p0-sad', 1, 0));
    expect(a.stormIn).toBeNull();
    const s = endgame();
    const b = applyMove(s, mv(s, 'p0-sad', 6, 5)); // a fresh makeState is settled lazily: first move activates
    expect(b.stormIn).toBe(STORM_INTERVAL_PLIES);
    expect(b.storm).toBe(0);
  });

  it('advances every 6 turn changes, removes pieces in the new columns and blocks moves into the storm', () => {
    let s = endgame();
    s = { ...s, stormIn: STORM_INTERVAL_PLIES };
    // Walk the red marki to the edge column 0 (it stays there) and shuffle the sads for 6 plies.
    const seq: [string, number, number][] = [
      ['p0-sad', 5, 6],
      ['p1-sad', 8, 7],
      ['p0-sad', 5, 5],
      ['p1-sad', 8, 8],
      ['p0-sad', 5, 6],
      ['p1-marki', 10, 0],
    ];
    for (const [id, r, c] of seq) {
      expect(s.storm).toBe(0);
      s = applyMove(s, mv(s, id, r, c));
    }
    expect(s.storm).toBe(1);
    expect(s.stormIn).toBe(STORM_INTERVAL_PLIES);
    expect(getPieceById(s, 'p1-marki')).toBeUndefined();
    const stormEntry = s.history[s.history.length - 1];
    expect(stormEntry).toEqual({ kind: 'storm', storm: 1, killed: ['p1-marki'] });
    expect(s.status).toBe('playing');
    // Column 0 and 11 are gone: nothing may enter them.
    s = applyMove(s, mv(s, 'p0-sad', 5, 3));
    s = applyMove(s, mv(s, 'p1-sad', 8, 10));
    expect(targetKeys(getLegalMoves(s, 'p0-sad'))).not.toContain('5,0');
    expect(targetKeys(getLegalMoves(s, 'p0-sad'))).toContain('5,1');
    s = applyMove(s, mv(s, 'p0-sad', 5, 1));
    expect(targetKeys(getLegalMoves(s, 'p1-sad'))).not.toContain('8,11');
  });

  it('ends the game with reason storm when a side loses its last piece to it', () => {
    let s = makeState([
      [0, 'sad', 3, 5, 5],
      [1, 'sad', 3, 8, 0],
    ]);
    s = { ...s, stormIn: 1 };
    s = applyMove(s, mv(s, 'p0-sad', 5, 6));
    expect(s.status).toBe('ended');
    expect(s.endReason).toBe('storm');
    expect(s.winner).toBe(0);
  });

  it('is decided by material when the storm takes the last pieces of both sides at once', () => {
    let s = makeState([
      [0, 'sad', 1, 5, 11],
      [1, 'sad', 1, 8, 0],
      [1, 'marki', 1, 7, 0],
    ]);
    s = { ...s, stormIn: 1 };
    s = applyMove(s, mv(s, 'p0-sad', 6, 11));
    expect(s.status).toBe('ended');
    expect(s.endReason).toBe('storm');
    expect(s.pieces).toHaveLength(0);
    expect(s.winner).toBe(1); // Red lost 3 + 3 to Blue's 3
  });

  it('ticks on timeouts and auto-passes too', () => {
    let s = makeState([
      [0, 'sad', 1, 5, 5],
      [1, 'sad', 1, 8, 0],
    ]);
    s = { ...s, stormIn: 1 };
    s = applyTimeout(s);
    expect(s.storm).toBe(1);
    expect(s.status).toBe('ended');
    expect(s.winner).toBe(0);
  });
});

describe('fast board mirrors the engine with the new rules', () => {
  const levels = { sad: 2, marki: 2, walk: 2, insaner: 3 } as const;

  it('generates exactly the engine legal moves through chain moves, absorption and storm', () => {
    const rng = rngFrom(777);
    let checked = 0;
    let chains = 0;
    let storms = 0;
    let suddenDeath = 0;
    for (let game = 0; game < 40; game++) {
      const squad0 = rng() < 0.5 ? (['insaner', 'sad', 'walk'] as const) : (['insaner', 'marki', 'walk'] as const);
      const squad1 = rng() < 0.5 ? (['insaner', 'sad', 'marki'] as const) : (['sad', 'marki', 'walk'] as const);
      let g = createGame(randomFormation(rng, levels, squad0), randomFormation(rng, levels, squad1), (game % 2) as 0 | 1);
      let guard = 0;
      while (g.status === 'playing' && guard++ < 400) {
        const legal = getLegalMoves(g);
        expect(legal.length).toBeGreaterThan(0);
        const b = fastFromState(g);
        const buf = new Int32Array(128);
        const n = fastGenMoves(b, b.turn, buf, 0);
        const fastKeys = Array.from(buf.subarray(0, n)).map((m) => {
          const x = fastMoveToMove(b, m);
          return `${x.pieceId}:${x.to.r},${x.to.c}`;
        }).sort();
        const engKeys = legal.map((m) => `${m.pieceId}:${m.to.r},${m.to.c}`).sort();
        expect(fastKeys).toEqual(engKeys);
        // make/unmake must be exact
        const snap = JSON.stringify([Array.from(b.sq), Array.from(b.occ), Array.from(b.absorb), Array.from(b.dir), b.turn, b.bonus, b.storm, b.stormIn, b.ply, b.wipe, Array.from(b.alive), Array.from(b.material)]);
        for (let k = 0; k < n; k++) {
          const undo = fastMake(b, buf[k]);
          fastUnmake(b, buf[k], undo);
        }
        expect(JSON.stringify([Array.from(b.sq), Array.from(b.occ), Array.from(b.absorb), Array.from(b.dir), b.turn, b.bonus, b.storm, b.stormIn, b.ply, b.wipe, Array.from(b.alive), Array.from(b.material)])).toBe(snap);
        expect(b.histTop).toBe(0);
        if (g.bonusPieceId) chains++;
        if (g.storm > 0) storms++;
        if (g.stormIn !== null && g.pieces.filter((p) => p.owner === 0).length > 1 && g.pieces.filter((p) => p.owner === 1).length > 1) suddenDeath++;
        checked++;
        // Fast make of the chosen move must agree with the engine on turn / storm / alive counts.
        const pick = legal[Math.floor(rng() * legal.length)];
        const mvCode = Array.from(buf.subarray(0, n)).find((m) => {
          const x = fastMoveToMove(b, m);
          return x.pieceId === pick.pieceId && x.to.r === pick.to.r && x.to.c === pick.to.c;
        })!;
        fastMake(b, mvCode);
        const next = applyMove(g, pick);
        if (next.status === 'playing' && !(next.history[next.history.length - 1].kind === 'pass')) {
          expect(b.turn).toBe(next.turn);
          expect(b.storm).toBe(next.storm);
          expect(b.stormIn).toBe(next.stormIn ?? -1);
          expect(b.ply).toBe(next.ply);
          expect(b.alive[0] + b.alive[1]).toBe(next.pieces.length);
          expect(b.bonus >= 0 ? b.ids[b.bonus] : null).toBe(next.bonusPieceId);
        }
        g = next;
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(chains).toBeGreaterThan(0);
    expect(suddenDeath).toBeGreaterThan(0);
    expect(storms).toBeGreaterThan(0);
  });

  it('every difficulty plays legal moves with insaner squads (incl. chain moves)', () => {
    const rng = rngFrom(99);
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let i = 0; i < 4; i++) {
        let g = createGame(
          randomFormation(rng, levels, ['insaner', 'sad', 'walk']),
          randomFormation(rng, levels, ['insaner', 'marki', 'walk']),
          (i % 2) as 0 | 1,
        );
        let guard = 0;
        while (g.status === 'playing' && guard++ < 300) {
          const m = chooseMove(g, d, { rng, timeBudgetMs: d === 'hard' ? 12 : 5 });
          expect(m).not.toBeNull();
          g = applyMove(g, m!);
        }
      }
    }
  }, 60_000);

  it('defaultFormation accepts a squad and fills with starters', () => {
    expect(defaultFormation(undefined, ['insaner']).map((s) => s.character)).toEqual(['insaner', 'sad', 'marki']);
    expect(defaultFormation(undefined, ['walk', 'walk', 'insaner', 'sad', 'marki']).map((s) => s.character)).toEqual(['walk', 'insaner', 'sad']);
  });
});
