import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  CHARACTER_IDS,
  ZONE_DEPTH,
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
  it('the board is 10 x 10 and each home zone is 2 x 10', () => {
    expect(BOARD_SIZE).toBe(10);
    expect(ZONE_DEPTH).toBe(2);
  });
  it('rejects out of zone: only rows 0..1 and columns 0..9 are allowed', () => {
    const f = defaultFormation();
    f[0] = { ...f[0], row: 2 };
    const v = validateFormation(f);
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/구역\(자기 진영 2줄\)/);
    f[0] = { ...f[0], row: 0, col: 10 };
    expect(validateFormation(f).ok).toBe(false);
    f[0] = { ...f[0], row: -1, col: 0 };
    expect(validateFormation(f).ok).toBe(false);
    // Every corner of the 2 x 10 zone is fine.
    for (const [row, col] of [[0, 0], [0, 9], [1, 0], [1, 9]]) {
      const g = defaultFormation().map((s, i) => (i === 0 ? { ...s, row, col } : s));
      expect(validateFormation(g).ok, `${row},${col}`).toBe(true);
    }
  });
  it('every squad of three gets a valid preset inside the 2 x 10 zone', () => {
    for (const a of CHARACTER_IDS) for (const b of CHARACTER_IDS) for (const c of CHARACTER_IDS) {
      if (a === b || b === c || a === c) continue;
      const f = defaultFormation(undefined, [a, b, c]);
      expect(f.map((s) => s.character)).toEqual([a, b, c]);
      expect(validateFormation(f).ok, `${a},${b},${c}`).toBe(true);
    }
  });
  it('random formations cover the whole 2 x 10 zone and nothing else', () => {
    const rng = rngFrom(7);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) for (const s of randomFormation(rng)) seen.add(`${s.row},${s.col}`);
    expect(seen.size).toBe(ZONE_DEPTH * BOARD_SIZE);
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
    expect(formationToAbsolute(0, { row: 1, col: 3 })).toEqual({ r: 1, c: 3 });
    expect(formationToAbsolute(1, { row: 1, col: 3 })).toEqual({ r: 8, c: 6 });
    expect(formationToAbsolute(1, { row: 0, col: 0 })).toEqual({ r: 9, c: 9 });
    expect(forwardDir(0)).toBe(1);
    expect(forwardDir(1)).toBe(-1);
    expect(isInZone(0, { r: 1, c: 0 })).toBe(true);
    expect(isInZone(0, { r: 2, c: 0 })).toBe(false);
    expect(isInZone(1, { r: 8, c: 9 })).toBe(true);
    expect(isInZone(1, { r: 7, c: 9 })).toBe(false);
    expect(isInZone(1, { r: 9, c: 10 })).toBe(false);
    expect(isInZone(1, { r: 10, c: 0 })).toBe(false);
    const g = createGame(defaultFormation(), defaultFormation(), 1);
    expect(g.turn).toBe(1);
    expect(g.pieces.length).toBe(6);
    const m1 = getPieceById(g, 'p1-marki')!;
    expect(m1.pos).toEqual({ r: 8, c: 6 });
    expect(getPieceById(g, 'p0-marki')!.pos).toEqual({ r: 1, c: 3 });
    for (const p of g.pieces) expect(isInZone(p.owner, p.pos)).toBe(true);
  });
});
