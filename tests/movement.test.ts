import { describe, expect, it } from 'vitest';
import { applyMove, getLegalMoves, getPieceById, getTargetsForPiece } from '../src/engine';
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

describe('Marki (forward slide; 3-star adds a 1-square side step)', () => {
  const R = { 1: 3, 2: 4, 3: 5 } as const;
  for (const L of [1, 2, 3] as Level[]) {
    it(`level ${L} player 0 moves up to ${R[L]} squares +r${L === 3 ? ' and 1 left / right' : ''}`, () => {
      const s = makeState([[0, 'marki', L, 2, 4]]);
      const exp: [number, number][] = [];
      for (let k = 1; k <= R[L]; k++) exp.push([2 + k, 4]);
      if (L === 3) exp.push([2, 3], [2, 5]);
      expect(t(s, 'p0-marki')).toEqual(keys(exp));
    });
    it(`level ${L} player 1 moves up to ${R[L]} squares -r${L === 3 ? ' and 1 left / right' : ''}`, () => {
      const s = makeState([[1, 'marki', L, 9, 7]]);
      const exp: [number, number][] = [];
      for (let k = 1; k <= R[L]; k++) exp.push([9 - k, 7]);
      if (L === 3) exp.push([9, 6], [9, 8]);
      expect(t(s, 'p1-marki')).toEqual(keys(exp));
    });
  }
  it('clipped at the far edge; with no row ahead only the 3-star side step is left', () => {
    expect(t(makeState([[0, 'marki', 3, 7, 0]]), 'p0-marki')).toEqual(keys([[8, 0], [9, 0], [7, 1]]));
    expect(t(makeState([[0, 'marki', 2, 9, 0]]), 'p0-marki')).toEqual([]);
    expect(t(makeState([[0, 'marki', 3, 9, 0]]), 'p0-marki')).toEqual(keys([[9, 1]]));
    expect(t(makeState([[1, 'marki', 2, 0, 3]]), 'p1-marki')).toEqual([]);
    expect(t(makeState([[1, 'marki', 3, 0, 3]]), 'p1-marki')).toEqual(keys([[0, 2], [0, 4]]));
  });
  it('blocked by ally / captures first enemy / no sideways below 3-star', () => {
    for (const L of [1, 2] as Level[]) {
      expect(t(makeState([[0, 'marki', L, 2, 4]]), 'p0-marki').some((k) => k.startsWith('2,'))).toBe(false);
    }
    const blocked = makeState([
      [0, 'marki', 3, 2, 4],
      [0, 'sad', 1, 4, 4],
    ]);
    expect(t(blocked, 'p0-marki')).toEqual(keys([[3, 4], [2, 3], [2, 5]]));
    const cap = makeState([
      [0, 'marki', 3, 2, 4],
      [1, 'sad', 1, 4, 4],
      [1, 'walk', 1, 6, 4],
    ]);
    const moves = getTargetsForPiece(cap, getPieceById(cap, 'p0-marki')!);
    expect(targetKeys(moves)).toEqual(keys([[3, 4], [4, 4], [2, 3], [2, 5]]));
    expect(moves.find((m) => m.to.r === 4)!.captureId).toBe('p1-sad');
  });
  it('3-star side step: captures an enemy beside him, is blocked by his own piece, 1 square only', () => {
    const s = makeState([
      [0, 'marki', 3, 4, 4],
      [0, 'sad', 1, 4, 5], // ally on the right: blocked
      [1, 'walk', 1, 4, 3], // enemy on the left: capture
      [1, 'sad', 1, 4, 2], // never reached (1 square only)
    ]);
    const moves = getTargetsForPiece(s, getPieceById(s, 'p0-marki')!);
    expect(targetKeys(moves)).toEqual(keys([[5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [4, 3]]));
    expect(moves.find((m) => m.to.c === 3)!.captureId).toBe('p1-walk');
    const after = applyMove(s, moves.find((m) => m.to.c === 3)!);
    expect(getPieceById(after, 'p1-walk')).toBeUndefined();
    expect(getPieceById(after, 'p0-marki')!.pos).toEqual({ r: 4, c: 3 });
    // A side step does not turn him around (he is not on the far edge).
    expect(getPieceById(after, 'p0-marki')!.dir ?? 1).toBe(1);
  });
  it('3-star side step obeys the storm, wasteland and doll traps like any landing', () => {
    // Storm: column 0 is gone, so from column 1 only the right step remains.
    const storm = makeState([[0, 'marki', 3, 4, 1], [1, 'sad', 1, 9, 5], [1, 'walk', 1, 9, 6]], 0, { storm: 1, stormIn: 6 });
    expect(t(storm, 'p0-marki').filter((k) => k.startsWith('4,'))).toEqual(['4,2']);
    // Wasteland beside him: he may step there and is destroyed.
    const w = makeState([[0, 'marki', 3, 4, 4], [0, 'sad', 1, 0, 0], [1, 'sad', 1, 9, 9]], 0, { waste: [4 * 10 + 5] });
    const wm = getTargetsForPiece(w, getPieceById(w, 'p0-marki')!).find((m) => m.to.r === 4 && m.to.c === 5)!;
    expect(wm).toBeDefined();
    const wasted = applyMove(w, wm);
    expect(getPieceById(wasted, 'p0-marki')).toBeUndefined();
    // Enemy doll trap beside him: stepping onto it stuns him.
    const tr = makeState([[0, 'marki', 3, 4, 4], [0, 'sad', 1, 0, 0], [1, 'sad', 1, 9, 9]], 0, { traps: [{ sq: 4 * 10 + 3, owner: 1 }] });
    const trapped = applyMove(tr, { pieceId: 'p0-marki', from: { r: 4, c: 4 }, to: { r: 4, c: 3 } });
    expect(getPieceById(trapped, 'p0-marki')!.stun).toBeGreaterThan(0);
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
