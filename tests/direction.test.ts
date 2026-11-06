import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, applyMove, getTargetsForPiece, isDirectional, screenArrow, type CharacterId, type Level, type Piece } from '../src/engine';
import { makeState, targetKeys } from './helpers';

const LEVELS: Level[] = [1, 2, 3];

/** Targets of a lone piece in the middle of the board, facing `dir`. */
function reach(character: CharacterId, level: Level, dir: 1 | -1, absorbed?: Piece['absorbed']): string[] {
  const s = makeState([[0, character, level, 5, 5], [1, 'sad', 1, 0, 0]]);
  const p: Piece = { ...s.pieces[0], dir, ...(absorbed ? { absorbed } : {}) };
  return targetKeys(getTargetsForPiece({ ...s, pieces: [p, s.pieces[1]] }, p));
}

describe('isDirectional', () => {
  it('matches the move generator: directional exactly when flipping forward changes the reach', () => {
    for (const ch of CHARACTER_IDS) {
      for (const lv of LEVELS) {
        // Michelle's traps come from backward moves: her facing matters even where her reach is
        // symmetric (3성: up to 2 squares in all four directions).
        // Venoa's arrows fly forward but need a target, so an empty board shows only her steps.
        const differs = reach(ch, lv, 1).join() !== reach(ch, lv, -1).join() || ch === 'michelle' || ch === 'venoa';
        expect({ ch, lv, directional: isDirectional({ character: ch, level: lv }) }).toEqual({ ch, lv, directional: differs });
      }
    }
  });

  it('always for marki, walk, michelle and rakaeli; never for sad and picker', () => {
    for (const lv of LEVELS) {
      for (const ch of ['marki', 'walk', 'michelle', 'rakaeli'] as const) expect(isDirectional({ character: ch, level: lv })).toBe(true);
      for (const ch of ['sad', 'picker'] as const) expect(isDirectional({ character: ch, level: lv })).toBe(false);
    }
  });

  it('brutile only while his pattern has a front (level 3 reaches every neighbour)', () => {
    expect(isDirectional({ character: 'brutile', level: 1 })).toBe(true);
    expect(isDirectional({ character: 'brutile', level: 2 })).toBe(true);
    expect(isDirectional({ character: 'brutile', level: 3 })).toBe(false);
  });

  it('insaner only once he absorbed a direction-dependent pattern', () => {
    expect(isDirectional({ character: 'insaner', level: 2 })).toBe(false);
    expect(isDirectional({ character: 'insaner', level: 2, absorbed: [{ character: 'sad', level: 3 }] })).toBe(false);
    expect(isDirectional({ character: 'insaner', level: 2, absorbed: [{ character: 'brutile', level: 3 }] })).toBe(false);
    expect(isDirectional({ character: 'insaner', level: 2, absorbed: [{ character: 'picker', level: 1 }, { character: 'walk', level: 1 }] })).toBe(true);
    // His own orthogonal slides already cover Michelle's sideways / back steps: still symmetric.
    expect(isDirectional({ character: 'insaner', level: 1, absorbed: [{ character: 'michelle', level: 1 }] })).toBe(false);
    // Cross-check against the generator for every single absorbed pattern.
    for (const ch of CHARACTER_IDS) {
      for (const lv of LEVELS) {
        const absorbed = [{ character: ch, level: lv }];
        const differs = reach('insaner', 1, 1, absorbed).join() !== reach('insaner', 1, -1, absorbed).join();
        expect({ ch, lv, d: isDirectional({ character: 'insaner', level: 1, absorbed }) }).toEqual({ ch, lv, d: differs });
      }
    }
  });
});

describe('screenArrow', () => {
  it('player 0 (drawn at the bottom) moves up, player 1 down, until a piece turns around', () => {
    expect(screenArrow({ owner: 0 })).toBe('up');
    expect(screenArrow({ owner: 1 })).toBe('down');
    expect(screenArrow({ owner: 0, dir: -1 })).toBe('down');
    expect(screenArrow({ owner: 1, dir: 1 })).toBe('up');
  });

  it('flips when a walk reaches the far edge', () => {
    let s = makeState([[0, 'walk', 1, 8, 5], [1, 'sad', 1, 0, 0]]);
    expect(screenArrow(s.pieces[0])).toBe('up');
    s = applyMove(s, { pieceId: 'p0-walk', from: { r: 8, c: 5 }, to: { r: 9, c: 5 } });
    expect(screenArrow(s.pieces.find((p) => p.id === 'p0-walk')!)).toBe('down');
  });
});
