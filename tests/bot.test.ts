import { describe, expect, it } from 'vitest';
import { chooseMove } from '../src/ai/bot';
import type { Difficulty } from '../src/ai/bot';
import {
  applyMove,
  applyTimeout,
  createGame,
  getLegalMoves,
  getTargetsForPiece,
  isLegalMove,
  randomFormation,
} from '../src/engine';
import type { CharacterId, Level } from '../src/engine';
import { makeState, rngFrom } from './helpers';

function randLevels(rng: () => number): Partial<Record<CharacterId, Level>> {
  const l = () => (1 + Math.floor(rng() * 3)) as Level;
  return { sad: l(), marki: l(), walk: l() };
}

describe('bot self-play', () => {
  it('plays 240 legal games to termination', () => {
    const rng = rngFrom(12345);
    const pairs: [Difficulty, Difficulty, number][] = [
      ['easy', 'easy', 120],
      ['normal', 'easy', 50],
      ['normal', 'normal', 30],
      ['hard', 'normal', 25],
      ['hard', 'hard', 15],
    ];
    let games = 0;
    const reasons: Record<string, number> = {};
    for (const [d0, d1, count] of pairs) {
      for (let i = 0; i < count; i++) {
        let g = createGame(randomFormation(rng, randLevels(rng)), randomFormation(rng, randLevels(rng)), (i % 2) as 0 | 1);
        let guard = 0;
        while (g.status === 'playing') {
          guard++;
          expect(guard).toBeLessThan(600);
          expect(getLegalMoves(g).length).toBeGreaterThan(0); // never stuck
          if (rng() < 0.01) {
            g = applyTimeout(g);
            continue;
          }
          const diff = g.turn === 0 ? d0 : d1;
          const m = chooseMove(g, diff, { timeBudgetMs: 3, rng });
          expect(m).not.toBeNull();
          expect(isLegalMove(g, m!)).toBe(true);
          g = applyMove(g, m!);
        }
        expect(g.ply).toBeLessThan(600);
        reasons[g.endReason!] = (reasons[g.endReason!] ?? 0) + 1;
        games++;
      }
    }
    expect(games).toBe(240);
    expect(reasons.elimination ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it('returns null when the game is over', () => {
    const g = createGame(randomFormation(rngFrom(1)), randomFormation(rngFrom(2)));
    expect(chooseMove({ ...g, status: 'ended' }, 'hard')).toBeNull();
  });
});

describe('bot tactics', () => {
  it('takes an obvious free capture on normal and hard', () => {
    // p0 sad can capture an undefended enemy walk (L3, value 8).
    const s = makeState([
      [0, 'sad', 2, 5, 5],
      [0, 'marki', 1, 0, 0],
      [0, 'walk', 1, 0, 11],
      [1, 'walk', 3, 5, 7],
      [1, 'sad', 1, 11, 0],
      [1, 'marki', 1, 11, 11],
    ]);
    for (const d of ['normal', 'hard'] as Difficulty[]) {
      for (let seed = 0; seed < 5; seed++) {
        const m = chooseMove(s, d, { timeBudgetMs: 150, rng: rngFrom(seed) })!;
        expect(m.captureId).toBe('p1-walk');
      }
    }
  });

  it('easy usually takes a free capture', () => {
    const s = makeState([
      [0, 'sad', 2, 5, 5],
      [1, 'walk', 3, 5, 7],
      [1, 'sad', 1, 11, 0],
    ]);
    let hits = 0;
    for (let seed = 0; seed < 50; seed++) {
      if (chooseMove(s, 'easy', { rng: rngFrom(seed) })!.captureId === 'p1-walk') hits++;
    }
    expect(hits).toBeGreaterThan(35);
  });

  it('hard rescues a piece that is attacked (avoids one-move loss)', () => {
    // p1 sad (L3) at (5,9) attacks p0 walk (L3, value 8) at (5,6). Nothing defends the walk.
    // p0 to move: hard should move the walk out of all enemy reach.
    const s = makeState([
      [0, 'walk', 3, 5, 6],
      [0, 'sad', 1, 0, 0],
      [0, 'marki', 1, 0, 11],
      [1, 'sad', 3, 5, 9],
      [1, 'marki', 1, 11, 0],
      [1, 'walk', 1, 11, 11],
    ]);
    for (let seed = 0; seed < 5; seed++) {
      const m = chooseMove(s, 'hard', { timeBudgetMs: 200, rng: rngFrom(seed) })!;
      const after = applyMove(s, m);
      const walk = after.pieces.find((p) => p.id === 'p0-walk');
      expect(walk).toBeDefined();
      const reach = after.pieces
        .filter((p) => p.owner === 1)
        .flatMap((p) => getTargetsForPiece(after, p))
        .some((x) => x.captureId === 'p0-walk');
      expect(reach).toBe(false);
    }
  });

  it('respects time budget (hard default stays under 1.5s)', () => {
    const rng = rngFrom(7);
    const g = createGame(
      randomFormation(rng, { sad: 3, marki: 3, walk: 3 }),
      randomFormation(rng, { sad: 3, marki: 3, walk: 3 }),
    );
    const t0 = Date.now();
    const m = chooseMove(g, 'hard', { rng });
    const dt = Date.now() - t0;
    expect(m).not.toBeNull();
    expect(dt).toBeLessThan(1500);
    const t1 = Date.now();
    chooseMove(g, 'hard', { timeBudgetMs: 10_000, rng });
    expect(Date.now() - t1).toBeLessThan(1500);
  });
});
