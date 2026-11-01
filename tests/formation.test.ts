import { describe, expect, it } from 'vitest';
import {
  createGame,
  defaultFormation,
  formationToAbsolute,
  forwardDir,
  getPieceById,
  isInZone,
  randomFormation,
  validateFormation,
} from '../src/engine';
import type { Formation } from '../src/engine';
import { rngFrom } from './helpers';

describe('formation', () => {
  it('default and random formations are valid', () => {
    expect(validateFormation(defaultFormation()).ok).toBe(true);
    expect(defaultFormation({ walk: 3 }).find((s) => s.character === 'walk')!.level).toBe(3);
    const rng = rngFrom(1);
    for (let i = 0; i < 200; i++) expect(validateFormation(randomFormation(rng, { sad: 2 })).ok).toBe(true);
  });
  it('rejects out of zone', () => {
    const f = defaultFormation();
    f[0] = { ...f[0], row: 3 };
    const v = validateFormation(f);
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/구역/);
    f[0] = { ...f[0], row: 0, col: 12 };
    expect(validateFormation(f).ok).toBe(false);
  });
  it('rejects duplicates, wrong count, overlap, bad level', () => {
    const f = defaultFormation();
    expect(validateFormation([...f, { character: 'sad', level: 1, row: 0, col: 0 }]).ok).toBe(false);
    expect(validateFormation(f.slice(0, 2)).ok).toBe(false);
    const dup: Formation = [f[0], { ...f[0], col: 0 }, f[2]];
    const v = validateFormation(dup);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('중복'))).toBe(true);
    const overlap: Formation = [f[0], { ...f[1], row: f[0].row, col: f[0].col }, f[2]];
    expect(validateFormation(overlap).errors.some((e) => e.includes('같은 칸'))).toBe(true);
    expect(validateFormation([{ ...f[0], level: 4 as never }, f[1], f[2]]).ok).toBe(false);
    expect(() => createGame(dup, defaultFormation())).toThrow();
  });
  it('mirrors player 1', () => {
    expect(formationToAbsolute(0, { row: 2, col: 3 })).toEqual({ r: 2, c: 3 });
    expect(formationToAbsolute(1, { row: 2, col: 3 })).toEqual({ r: 9, c: 8 });
    expect(forwardDir(0)).toBe(1);
    expect(forwardDir(1)).toBe(-1);
    expect(isInZone(0, { r: 2, c: 0 })).toBe(true);
    expect(isInZone(0, { r: 3, c: 0 })).toBe(false);
    expect(isInZone(1, { r: 9, c: 11 })).toBe(true);
    expect(isInZone(1, { r: 8, c: 11 })).toBe(false);
    expect(isInZone(1, { r: 10, c: 12 })).toBe(false);
    const g = createGame(defaultFormation(), defaultFormation(), 1);
    expect(g.turn).toBe(1);
    expect(g.pieces.length).toBe(6);
    const m1 = getPieceById(g, 'p1-marki')!;
    expect(m1.pos).toEqual({ r: 9, c: 7 });
    expect(getPieceById(g, 'p0-marki')!.pos).toEqual({ r: 2, c: 4 });
    for (const p of g.pieces) expect(isInZone(p.owner, p.pos)).toBe(true);
  });
});
