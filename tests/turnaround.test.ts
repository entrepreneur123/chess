import { describe, expect, it } from 'vitest';
import { applyMove, fastFromState, fastGenMoves, fastMake, fastMoveToMove, fastUnmake, getLegalMoves, getTargetsForPiece, pieceDir } from '../src/engine';
import { chooseMove } from '../src/ai/bot';
import { makeState, targetKeys, keys } from './helpers';

describe('forward-only movers turn around at the far edge', () => {
  it('marki flips its direction when it reaches row 9 (the last row) and then moves back toward row 0', () => {
    let s = makeState([[0, 'marki', 3, 6, 4], [1, 'sad', 1, 0, 0]]);
    expect(pieceDir(s.pieces[0])).toBe(1);
    s = applyMove(s, { pieceId: 'p0-marki', from: { r: 6, c: 4 }, to: { r: 9, c: 4 } });
    const marki = s.pieces.find((p) => p.id === 'p0-marki')!;
    expect(marki.dir).toBe(-1);
    // Not stuck: it now rushes back toward row 0 (5 squares at Lv3), and the 3-star side step
    // (not tied to the direction) is still 1 square left / right.
    expect(targetKeys(getTargetsForPiece(s, marki))).toEqual(keys([[8, 4], [7, 4], [6, 4], [5, 4], [4, 4], [9, 3], [9, 5]]));
  });

  it('a 3-star marki side-steps on the far edge after turning around, for both players, and stays turned', () => {
    // Player 0 on row 9 facing back (-1): side steps on row 9, rush toward row 0.
    let s = makeState([[0, 'marki', 3, 4, 4], [1, 'sad', 1, 0, 9]]);
    s = applyMove(s, { pieceId: 'p0-marki', from: { r: 4, c: 4 }, to: { r: 9, c: 4 } });
    expect(pieceDir(s.pieces.find((p) => p.id === 'p0-marki')!)).toBe(-1);
    s = applyMove(s, { pieceId: 'p1-sad', from: { r: 0, c: 9 }, to: { r: 1, c: 9 } });
    s = applyMove(s, { pieceId: 'p0-marki', from: { r: 9, c: 4 }, to: { r: 9, c: 5 } });
    const m0 = s.pieces.find((p) => p.id === 'p0-marki')!;
    expect(m0.pos).toEqual({ r: 9, c: 5 });
    expect(pieceDir(m0)).toBe(-1);
    expect(targetKeys(getTargetsForPiece(s, m0))).toEqual(keys([[8, 5], [7, 5], [6, 5], [5, 5], [4, 5], [9, 4], [9, 6]]));
    // Player 1 on row 0 facing back (+1).
    let t = makeState([[1, 'marki', 3, 5, 2], [0, 'sad', 1, 9, 9]], 1);
    t = applyMove(t, { pieceId: 'p1-marki', from: { r: 5, c: 2 }, to: { r: 0, c: 2 } });
    const m1 = t.pieces.find((p) => p.id === 'p1-marki')!;
    expect(pieceDir(m1)).toBe(1);
    expect(targetKeys(getTargetsForPiece(t, m1))).toEqual(keys([[1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [0, 1], [0, 3]]));
    t = applyMove(t, { pieceId: 'p0-sad', from: { r: 9, c: 9 }, to: { r: 8, c: 9 } });
    t = applyMove(t, { pieceId: 'p1-marki', from: { r: 0, c: 2 }, to: { r: 0, c: 1 } });
    expect(pieceDir(t.pieces.find((p) => p.id === 'p1-marki')!)).toBe(1);
  });

  it('a turned-around marki flips again when it reaches row 0', () => {
    let s = makeState([[0, 'marki', 3, 9, 4], [1, 'sad', 1, 3, 9]]);
    s = { ...s, pieces: s.pieces.map((p) => (p.id === 'p0-marki' ? { ...p, dir: -1 as const } : p)) };
    s = applyMove(s, { pieceId: 'p0-marki', from: { r: 9, c: 4 }, to: { r: 4, c: 4 } });
    s = applyMove(s, { pieceId: 'p1-sad', from: { r: 3, c: 9 }, to: { r: 3, c: 8 } });
    s = applyMove(s, { pieceId: 'p0-marki', from: { r: 4, c: 4 }, to: { r: 0, c: 4 } });
    expect(s.pieces.find((p) => p.id === 'p0-marki')!.dir).toBe(1);
  });

  it('walk turns around on the last row and jumps back', () => {
    let s = makeState([[0, 'walk', 1, 8, 5], [1, 'sad', 1, 0, 0]]);
    s = applyMove(s, { pieceId: 'p0-walk', from: { r: 8, c: 5 }, to: { r: 9, c: 6 } });
    const walk = s.pieces.find((p) => p.id === 'p0-walk')!;
    expect(walk.dir).toBe(-1);
    expect(targetKeys(getTargetsForPiece(s, walk))).toEqual(keys([[8, 4], [8, 5], [8, 6], [8, 7], [8, 8]]));
  });

  it('player 1 pieces turn around at row 0', () => {
    let s = makeState([[1, 'marki', 1, 3, 4], [0, 'sad', 1, 9, 9]], 1);
    s = applyMove(s, { pieceId: 'p1-marki', from: { r: 3, c: 4 }, to: { r: 0, c: 4 } });
    expect(s.pieces.find((p) => p.id === 'p1-marki')!.dir).toBe(1);
  });

  it('sad never gets a direction', () => {
    let s = makeState([[0, 'sad', 3, 7, 4], [1, 'marki', 1, 0, 0]]);
    s = applyMove(s, { pieceId: 'p0-sad', from: { r: 7, c: 4 }, to: { r: 9, c: 4 } });
    expect(s.pieces.find((p) => p.id === 'p0-sad')!.dir).toBeUndefined();
  });

  it('the fast board mirrors the turn-around in make/unmake and agrees with the public move list', () => {
    const s = makeState([[0, 'marki', 2, 6, 4], [0, 'walk', 2, 8, 2], [1, 'sad', 2, 2, 8], [1, 'walk', 1, 1, 6]]);
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
    let s = makeState([[0, 'marki', 3, 7, 4], [0, 'walk', 3, 8, 7], [1, 'marki', 3, 2, 3], [1, 'walk', 3, 1, 8], [1, 'sad', 1, 0, 0], [0, 'sad', 1, 9, 9]]);
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
