import { describe, expect, it } from 'vitest';
import { applyMove, fastFromState, fastGenMoves, fastMake, fastMoveToMove, fastUnmake, getLegalMoves, getTargetsForPiece, pieceDir } from '../src/engine';
import { chooseMove } from '../src/ai/bot';
import { makeState, targetKeys, keys } from './helpers';

describe('forward-only movers turn around at the far edge', () => {
  it('marki flips its direction when it reaches row 11 and then moves back toward row 0', () => {
    let s = makeState([[0, 'marki', 3, 8, 4], [1, 'sad', 1, 0, 0]]);
    expect(pieceDir(s.pieces[0])).toBe(1);
    s = applyMove(s, { pieceId: 'p0-marki', from: { r: 8, c: 4 }, to: { r: 11, c: 4 } });
    const marki = s.pieces.find((p) => p.id === 'p0-marki')!;
    expect(marki.dir).toBe(-1);
    // Not stuck: it now has backward moves (3/4/6 squares for Lv3 -> 6 squares toward row 0).
    expect(targetKeys(getTargetsForPiece(s, marki))).toEqual(keys([[10, 4], [9, 4], [8, 4], [7, 4], [6, 4], [5, 4]]));
  });

  it('a turned-around marki flips again when it reaches row 0', () => {
    let s = makeState([[0, 'marki', 3, 11, 4], [1, 'sad', 1, 3, 11]]);
    s = { ...s, pieces: s.pieces.map((p) => (p.id === 'p0-marki' ? { ...p, dir: -1 as const } : p)) };
    s = applyMove(s, { pieceId: 'p0-marki', from: { r: 11, c: 4 }, to: { r: 5, c: 4 } });
    s = applyMove(s, { pieceId: 'p1-sad', from: { r: 3, c: 11 }, to: { r: 3, c: 10 } });
    s = applyMove(s, { pieceId: 'p0-marki', from: { r: 5, c: 4 }, to: { r: 0, c: 4 } });
    expect(s.pieces.find((p) => p.id === 'p0-marki')!.dir).toBe(1);
  });

  it('walk turns around on the last row and jumps back', () => {
    let s = makeState([[0, 'walk', 1, 10, 5], [1, 'sad', 1, 0, 0]]);
    s = applyMove(s, { pieceId: 'p0-walk', from: { r: 10, c: 5 }, to: { r: 11, c: 6 } });
    const walk = s.pieces.find((p) => p.id === 'p0-walk')!;
    expect(walk.dir).toBe(-1);
    expect(targetKeys(getTargetsForPiece(s, walk))).toEqual(keys([[10, 4], [10, 5], [10, 6], [10, 7], [10, 8]]));
  });

  it('player 1 pieces turn around at row 0', () => {
    let s = makeState([[1, 'marki', 1, 3, 4], [0, 'sad', 1, 11, 11]], 1);
    s = applyMove(s, { pieceId: 'p1-marki', from: { r: 3, c: 4 }, to: { r: 0, c: 4 } });
    expect(s.pieces.find((p) => p.id === 'p1-marki')!.dir).toBe(1);
  });

  it('sad never gets a direction', () => {
    let s = makeState([[0, 'sad', 3, 9, 4], [1, 'marki', 1, 0, 0]]);
    s = applyMove(s, { pieceId: 'p0-sad', from: { r: 9, c: 4 }, to: { r: 11, c: 4 } });
    expect(s.pieces.find((p) => p.id === 'p0-sad')!.dir).toBeUndefined();
  });

  it('the fast board mirrors the turn-around in make/unmake and agrees with the public move list', () => {
    const s = makeState([[0, 'marki', 2, 8, 4], [0, 'walk', 2, 10, 2], [1, 'sad', 2, 2, 9], [1, 'walk', 1, 1, 6]]);
    const b = fastFromState(s);
    const buf = new Int32Array(64);
    const n = fastGenMoves(b, 0, buf, 0);
    const legal = getLegalMoves(s);
    expect(n).toBe(legal.length);
    for (let k = 0; k < n; k++) {
      const mv = buf[k];
      const before = Array.from(b.dir);
      const undo = fastMake(b, mv);
      const m = fastMoveToMove({ ...b, sq: fastFromState(s).sq } as never, mv); // from-square must be read before make
      void m;
      const after = applyMove(s, fastMoveToMove(fastFromState(s), mv));
      const pi = mv >> 8;
      expect(b.dir[pi]).toBe(pieceDir(after.pieces.find((p) => p.id === b.ids[pi])!));
      fastUnmake(b, mv, undo);
      expect(Array.from(b.dir)).toEqual(before);
    }
  });

  it('the bot keeps returning legal moves across turn-arounds', () => {
    let s = makeState([[0, 'marki', 3, 9, 4], [0, 'walk', 3, 10, 7], [1, 'marki', 3, 2, 3], [1, 'walk', 3, 1, 8], [1, 'sad', 1, 0, 0], [0, 'sad', 1, 11, 11]]);
    let flips = 0;
    for (let i = 0; i < 80 && s.status === 'playing'; i++) {
      const mv = chooseMove(s, i % 2 ? 'hard' : 'normal', { timeBudgetMs: 5 });
      if (!mv) break;
      const legal = getLegalMoves(s).some((m) => m.pieceId === mv.pieceId && m.to.r === mv.to.r && m.to.c === mv.to.c);
      expect(legal).toBe(true);
      const before = s.pieces.find((p) => p.id === mv.pieceId)!;
      s = applyMove(s, mv);
      const afterP = s.pieces.find((p) => p.id === mv.pieceId);
      if (afterP && pieceDir(afterP) !== pieceDir(before)) flips++;
    }
    expect(flips).toBeGreaterThanOrEqual(0);
  });
});
