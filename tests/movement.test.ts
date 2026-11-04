import { describe, expect, it } from 'vitest';
import { getLegalMoves, getPieceById, getTargetsForPiece } from '../src/engine';
import type { Level } from '../src/engine';
import { keys, makeState, targetKeys } from './helpers';

const t = (s: ReturnType<typeof makeState>, id: string) => targetKeys(getTargetsForPiece(s, getPieceById(s, id)!));

describe('Sad (orthogonal slide up to L)', () => {
  for (const L of [1, 2, 3] as Level[]) {
    it(`level ${L} on open board moves ${4 * L} squares`, () => {
      const s = makeState([[0, 'sad', L, 5, 5]]);
      const exp: [number, number][] = [];
      for (let k = 1; k <= L; k++) exp.push([5 + k, 5], [5 - k, 5], [5, 5 + k], [5, 5 - k]);
      expect(t(s, 'p0-sad')).toEqual(keys(exp));
    });
  }
  it('corner clips to board', () => {
    const s = makeState([[0, 'sad', 3, 0, 0]]);
    expect(t(s, 'p0-sad')).toEqual(keys([[1, 0], [2, 0], [3, 0], [0, 1], [0, 2], [0, 3]]));
    const s2 = makeState([[1, 'sad', 2, 9, 9]]);
    expect(t(s2, 'p1-sad')).toEqual(keys([[8, 9], [7, 9], [9, 8], [9, 7]]));
  });
  it('blocked by ally, captures first enemy only, cannot slide past enemy', () => {
    const s = makeState([
      [0, 'sad', 3, 5, 5],
      [0, 'marki', 1, 6, 5], // ally directly above
      [1, 'walk', 1, 5, 7], // enemy two to the right
      [1, 'sad', 1, 5, 8], // second enemy behind it
    ]);
    const moves = getTargetsForPiece(s, getPieceById(s, 'p0-sad')!);
    expect(targetKeys(moves)).toEqual(keys([[4, 5], [3, 5], [2, 5], [5, 6], [5, 7], [5, 4], [5, 3], [5, 2]]));
    const cap = moves.find((m) => m.to.r === 5 && m.to.c === 7)!;
    expect(cap.captureId).toBe('p1-walk');
    expect(moves.filter((m) => m.captureId).length).toBe(1);
  });
});

describe('Marki (forward-only slide)', () => {
  const R = { 1: 3, 2: 4, 3: 6 } as const;
  for (const L of [1, 2, 3] as Level[]) {
    it(`level ${L} player 0 moves up to ${R[L]} squares +r`, () => {
      const s = makeState([[0, 'marki', L, 2, 4]]);
      const exp: [number, number][] = [];
      for (let k = 1; k <= R[L]; k++) exp.push([2 + k, 4]);
      expect(t(s, 'p0-marki')).toEqual(keys(exp));
    });
    it(`level ${L} player 1 moves up to ${R[L]} squares -r`, () => {
      const s = makeState([[1, 'marki', L, 9, 7]]);
      const exp: [number, number][] = [];
      for (let k = 1; k <= R[L]; k++) exp.push([9 - k, 7]);
      expect(t(s, 'p1-marki')).toEqual(keys(exp));
    });
  }
  it('clipped at the far edge and stuck on the last row', () => {
    expect(t(makeState([[0, 'marki', 3, 7, 0]]), 'p0-marki')).toEqual(keys([[8, 0], [9, 0]]));
    expect(t(makeState([[0, 'marki', 3, 9, 0]]), 'p0-marki')).toEqual([]);
    expect(t(makeState([[1, 'marki', 3, 0, 3]]), 'p1-marki')).toEqual([]);
  });
  it('blocked by ally / captures first enemy / no sideways', () => {
    const blocked = makeState([
      [0, 'marki', 3, 2, 4],
      [0, 'sad', 1, 4, 4],
    ]);
    expect(t(blocked, 'p0-marki')).toEqual(keys([[3, 4]]));
    const cap = makeState([
      [0, 'marki', 3, 2, 4],
      [1, 'sad', 1, 4, 4],
      [1, 'walk', 1, 6, 4],
    ]);
    const moves = getTargetsForPiece(cap, getPieceById(cap, 'p0-marki')!);
    expect(targetKeys(moves)).toEqual(keys([[3, 4], [4, 4]]));
    expect(moves.find((m) => m.to.r === 4)!.captureId).toBe('p1-sad');
  });
});

describe('Walk (jump to row in front)', () => {
  const W = { 1: 2, 2: 3, 3: 4 } as const;
  for (const L of [1, 2, 3] as Level[]) {
    it(`level ${L} lands on ${2 * W[L] + 1} squares`, () => {
      const s = makeState([[0, 'walk', L, 5, 5]]);
      const exp: [number, number][] = [];
      for (let dc = -W[L]; dc <= W[L]; dc++) exp.push([6, 5 + dc]);
      expect(t(s, 'p0-walk')).toEqual(keys(exp));
      const s1 = makeState([[1, 'walk', L, 5, 5]]);
      expect(t(s1, 'p1-walk')).toEqual(keys(exp.map(([, c]) => [4, c] as [number, number])));
    });
  }
  it('clipped at side edges', () => {
    expect(t(makeState([[0, 'walk', 3, 0, 0]]), 'p0-walk')).toEqual(keys([[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]]));
    expect(t(makeState([[0, 'walk', 1, 3, 9]]), 'p0-walk')).toEqual(keys([[4, 7], [4, 8], [4, 9]]));
  });
  it('jumps over pieces, cannot land on ally, captures on enemy', () => {
    const s = makeState([
      [0, 'walk', 1, 5, 5],
      [0, 'sad', 1, 6, 5], // ally in landing row (blocked square)
      [0, 'marki', 1, 5, 4], // ally beside it: irrelevant (jump)
      [1, 'sad', 1, 6, 7], // enemy in landing row
    ]);
    const moves = getTargetsForPiece(s, getPieceById(s, 'p0-walk')!);
    expect(targetKeys(moves)).toEqual(keys([[6, 3], [6, 4], [6, 6], [6, 7]]));
    expect(moves.find((m) => m.to.c === 7)!.captureId).toBe('p1-sad');
  });
  it('at last row has no moves', () => {
    expect(t(makeState([[0, 'walk', 3, 9, 5]]), 'p0-walk')).toEqual([]);
    expect(t(makeState([[1, 'walk', 3, 0, 5]]), 'p1-walk')).toEqual([]);
  });
});

describe('getLegalMoves', () => {
  it('only returns moves for the side to move, filtered by pieceId', () => {
    const s = makeState([
      [0, 'sad', 1, 5, 5],
      [1, 'sad', 1, 8, 8],
    ]);
    expect(getLegalMoves(s).every((m) => m.pieceId === 'p0-sad')).toBe(true);
    expect(getLegalMoves(s, 'p1-sad')).toEqual([]);
    expect(getLegalMoves(s, 'p0-sad').length).toBe(4);
    expect(getLegalMoves({ ...s, status: 'ended' })).toEqual([]);
  });
});
