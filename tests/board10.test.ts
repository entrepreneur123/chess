/**
 * The 10 x 10 board with 2 x 10 home zones: bounds, square indexing, character reach at the
 * edges, storm resolution on 10 columns and the match-length bound.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  MAX_MATCH_PLIES,
  N_SQUARES,
  STORM_FULL_STEPS,
  STORM_INTERVAL_PLIES,
  SUDDEN_DEATH_PLY,
  ZONE_DEPTH,
  applyMove,
  fastFromState,
  fastGenMoves,
  fastMake,
  getLegalMoves,
  inStorm,
  isInZone,
  isOnBoard,
  posOf,
  sqOf,
  type GameState,
} from '../src/engine';
import { movementReach, movementSpan } from '../src/ui/components/piece';
import { squareLabel } from '../src/ui/game/fieldPanel';
import { keys, makeState, targetKeys } from './helpers';

describe('10 x 10 bounds', () => {
  it('has 100 squares indexed r * 10 + c', () => {
    expect(BOARD_SIZE).toBe(10);
    expect(N_SQUARES).toBe(100);
    for (let s = 0; s < N_SQUARES; s++) expect(sqOf(posOf(s))).toBe(s);
    expect(sqOf({ r: 9, c: 9 })).toBe(99);
    expect(isOnBoard({ r: 9, c: 9 })).toBe(true);
    expect(isOnBoard({ r: 10, c: 0 })).toBe(false);
    expect(isOnBoard({ r: 0, c: 10 })).toBe(false);
    expect(isOnBoard({ r: -1, c: 0 })).toBe(false);
  });

  it('home zones are rows 0..1 (blue) and 8..9 (red), all 10 columns', () => {
    expect(ZONE_DEPTH).toBe(2);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(isInZone(0, { r, c })).toBe(r <= 1);
        expect(isInZone(1, { r, c })).toBe(r >= 8);
      }
    }
  });

  it('square labels run A..J and 1..10', () => {
    expect(squareLabel(0, 0)).toBe('A1');
    expect(squareLabel(9, 9)).toBe('J10');
    expect(squareLabel(4, 5)).toBe('F5');
  });
});

describe('character reach on 10 columns', () => {
  const t = (s: GameState, id: string) => targetKeys(getLegalMoves(s, id));

  it("Walk 3성's 9-wide landing row fits: columns 0..8 from column 4, 1..9 from column 5", () => {
    const exp = (c0: number, c1: number) => keys(Array.from({ length: c1 - c0 + 1 }, (_, i) => [2, c0 + i] as [number, number]));
    expect(t(makeState([[0, 'walk', 3, 1, 4], [1, 'sad', 1, 9, 9]]), 'p0-walk')).toEqual(exp(0, 8));
    expect(t(makeState([[0, 'walk', 3, 1, 5], [1, 'sad', 1, 9, 0]]), 'p0-walk')).toEqual(exp(1, 9));
    expect(t(makeState([[0, 'walk', 3, 1, 0], [1, 'sad', 1, 9, 9]]), 'p0-walk')).toEqual(exp(0, 4));
  });

  it("Marki 3성 from the front home row rushes to row 6 (5 squares) or steps 1 left / right", () => {
    const s = makeState([[0, 'marki', 3, 1, 4], [1, 'sad', 1, 9, 0]]);
    expect(t(s, 'p0-marki')).toEqual(keys([[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [1, 3], [1, 5]]));
  });

  it('the movement diagrams show every pattern whole (no clipping at the 10 x 10 edges)', () => {
    expect(movementSpan('marki', 3)).toEqual({ rows: 6, cols: 3 });
    expect(movementSpan('walk', 3)).toEqual({ rows: 2, cols: 9 });
    expect(movementSpan('sad', 3)).toEqual({ rows: 7, cols: 7 });
    expect(movementSpan('insaner', 3)).toEqual({ rows: 7, cols: 7 });
    expect(movementSpan('picker', 3)).toEqual({ rows: 7, cols: 7 });
    expect(movementSpan('michelle', 3)).toEqual({ rows: 4, cols: 5 });
    expect(movementSpan('brutile', 3)).toEqual({ rows: 3, cols: 3 });
  });

  it("the collection's reach stat counts the engine's open-board targets", () => {
    const reach = (id: Parameters<typeof movementReach>[0]) => [1, 2, 3].map((lv) => movementReach(id, lv as 1 | 2 | 3));
    expect(reach('sad')).toEqual([4, 8, 12]);
    expect(reach('marki')).toEqual([3, 4, 7]);
    expect(reach('walk')).toEqual([5, 7, 9]);
    expect(reach('insaner')).toEqual([8, 12, 16]);
    expect(reach('brutile')).toEqual([2, 3, 8]);
    expect(reach('michelle')).toEqual([3, 6, 7]);
    expect(reach('picker')).toEqual([4, 8, 12]);
    expect(reach('rakaeli')).toEqual([3, 6, 7]);
    expect([1, 2, 3].map((lv) => movementReach('rakaeli', lv as 1 | 2 | 3, true))).toEqual([5, 10, 16]);
  });
});

describe('storm on 10 columns', () => {
  it('5 advances swallow the whole board', () => {
    expect(STORM_FULL_STEPS).toBe(5);
    for (let c = 0; c < BOARD_SIZE; c++) expect(inStorm(c, STORM_FULL_STEPS)).toBe(true);
    const open = Array.from({ length: BOARD_SIZE }, (_, c) => c).filter((c) => !inStorm(c, STORM_FULL_STEPS - 1));
    expect(open).toEqual([4, 5]);
  });

  it('a capture-free game in the centre columns ends at exactly MAX_MATCH_PLIES = 68 by the storm (engine and FastBoard agree)', () => {
    expect(MAX_MATCH_PLIES).toBe(SUDDEN_DEATH_PLY + STORM_FULL_STEPS * STORM_INTERVAL_PLIES);
    expect(MAX_MATCH_PLIES).toBe(68);
    // Two pieces a side (so the one-piece trigger never fires), shuffling in columns 4..5 of their
    // own half without ever capturing: only sudden death and the storm can end it.
    let s = makeState([
      [0, 'sad', 1, 1, 4],
      [0, 'marki', 1, 0, 5],
      [1, 'sad', 1, 8, 5],
      [1, 'marki', 1, 9, 4],
    ]);
    const b = fastFromState(s);
    const buf = new Int32Array(128);
    const advances: number[] = [];
    while (s.status === 'playing') {
      expect(s.ply).toBeLessThan(MAX_MATCH_PLIES);
      const own = (r: number) => (s.turn === 0 ? r <= 3 : r >= 6);
      const legal = getLegalMoves(s);
      const m = legal.find((x) => !x.captureId && x.to.c >= 4 && x.to.c <= 5 && own(x.to.r)) ?? legal.find((x) => !x.captureId)!;
      const n = fastGenMoves(b, b.turn, buf, 0);
      const enc = Array.from(buf.subarray(0, n)).find((e) => b.ids[(e >> 8) & 255] === m.pieceId && (e & 255) === sqOf(m.to))!;
      const storm = s.storm;
      s = applyMove(s, m);
      fastMake(b, enc);
      if (s.storm !== storm) advances.push(s.ply);
      expect(b.storm).toBe(s.storm);
      expect(b.ply).toBe(s.ply);
    }
    // Storm from ply 38 (turn 20), one advance every 6 turn changes (3 turns): plies 44 .. 68.
    expect(advances).toEqual([44, 50, 56, 62, 68]);
    expect(s.ply).toBe(MAX_MATCH_PLIES);
    expect(s.storm).toBe(STORM_FULL_STEPS);
    expect(s.endReason).toBe('storm');
    expect(s.pieces).toHaveLength(0);
    expect(b.alive[0] + b.alive[1]).toBe(0);
  });

  it('the one-piece trigger resolves within 5 * 6 = 30 turn changes', () => {
    let s = makeState([
      [0, 'sad', 1, 1, 4],
      [1, 'sad', 1, 8, 5],
    ], 0, { ply: 10 });
    let start: number | null = null;
    while (s.status === 'playing') {
      const legal = getLegalMoves(s);
      const own = (r: number) => (s.turn === 0 ? r <= 3 : r >= 6);
      s = applyMove(s, legal.find((x) => !x.captureId && x.to.c >= 4 && x.to.c <= 5 && own(x.to.r)) ?? legal[0]);
      // A hand-built position is settled by its first move: that is when the storm starts.
      if (start === null && s.stormIn !== null) start = s.ply;
    }
    expect(start).toBe(11);
    expect(s.endReason).toBe('storm');
    expect(s.ply - start!).toBe(STORM_FULL_STEPS * STORM_INTERVAL_PLIES);
  });
});
