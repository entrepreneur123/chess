import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, defaultFormation, PIECES_PER_SIDE, validateFormation, type Formation, type Move } from '../src/engine';
import { dropKind } from '../src/ui/components/boardDrag';
import { placeInFormation } from '../src/ui/components/formationGrid';

const f3: Formation = [
  { character: 'sad', level: 1, row: 0, col: 0 },
  { character: 'marki', level: 2, row: 1, col: 5 },
  { character: 'walk', level: 1, row: 1, col: 9 },
];

describe('placeInFormation (formation editor tap + drag)', () => {
  it('moves a fielded unit to an empty square', () => {
    const r = placeInFormation(f3, 'sad', 1, 1, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.formation.find((s) => s.character === 'sad')).toMatchObject({ row: 1, col: 3 });
    expect(r.formation).toHaveLength(3);
    expect(validateFormation(r.formation).ok).toBe(true);
  });

  it('swaps two fielded units', () => {
    const r = placeInFormation(f3, 'sad', 1, 1, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.formation.find((s) => s.character === 'sad')).toMatchObject({ row: 1, col: 5 });
    expect(r.formation.find((s) => s.character === 'marki')).toMatchObject({ row: 0, col: 0, level: 2 });
    expect(validateFormation(r.formation).ok).toBe(true);
  });

  it('a benched unit replaces the occupant it is dropped on', () => {
    const r = placeInFormation(f3, 'insaner', 3, 1, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.formation.some((s) => s.character === 'marki')).toBe(false);
    expect(r.formation.find((s) => s.character === 'insaner')).toMatchObject({ row: 1, col: 5, level: 3 });
    expect(r.formation).toHaveLength(PIECES_PER_SIDE);
  });

  it('refuses a benched unit on an empty square of a full squad, and a drop on itself', () => {
    expect(placeInFormation(f3, 'insaner', 1, 0, 1)).toEqual({ ok: false, reason: 'full' });
    expect(placeInFormation(f3, 'marki', 2, 1, 5)).toEqual({ ok: false, reason: 'same' });
  });

  it('never mutates the input formation', () => {
    const f = defaultFormation();
    const copy = JSON.parse(JSON.stringify(f));
    placeInFormation(f, f[0].character, f[0].level, 1, 8);
    expect(f).toEqual(copy);
  });
});

describe('dropKind (board drag-to-move)', () => {
  const mv = (to: { r: number; c: number }, captureId?: string): Move => ({ pieceId: 'p0-sad', from: { r: 0, c: 0 }, to, captureId });
  it('classifies drops', () => {
    expect(dropKind(undefined, [])).toBeNull();
    expect(dropKind(mv({ r: 1, c: 0 }), [])).toBe('move');
    expect(dropKind(mv({ r: 1, c: 0 }, 'p1-sad'), [])).toBe('capture');
    // Wasteland square (r * BOARD_SIZE + c): deadly, whatever stands there.
    expect(dropKind(mv({ r: 1, c: 0 }), [BOARD_SIZE])).toBe('deadly');
  });
});

import { josa } from '../src/engine';

describe('josa (Korean particles)', () => {
  it('picks the form by final consonant', () => {
    expect(josa('브루타일', '을/를')).toBe('브루타일을');
    expect(josa('마르키', '을/를')).toBe('마르키를');
    expect(josa('사드', '이/가')).toBe('사드가');
    expect(josa('월크', '이/가')).toBe('월크가');
    expect(josa('인세이너', '은/는')).toBe('인세이너는');
    expect(josa('브루타일', '이/가')).toBe('브루타일이');
  });
});
