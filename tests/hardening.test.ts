/**
 * Edge cases found in the quality/security review: hostile saved data, end-reason attribution,
 * and FastBoard parity at the sudden-death boundary.
 */
import { describe, expect, it } from 'vitest';
import { fallbackAction } from '../src/ai/bot';
import {
  BOARD_SIZE,
  MAX_MATCH_PLIES,
  STORM_FULL_STEPS,
  SUDDEN_DEATH_PLY,
  STORM_INTERVAL_PLIES,
  applyMove,
  createGame,
  defaultFormation,
  fastFromState,
  fastGenMoves,
  fastMake,
  getLegalMoves,
  isCharacterId,
  isLegalMove,
  normalizeSquad,
  suddenDeathIn,
  validateFormation,
} from '../src/engine';
import type { CharacterId, Formation, GameState, Move } from '../src/engine';
import { createDefaultProfile, loadProfile, sanitizeProfile, type KeyValueStorage } from '../src/meta/profile';
import { makeState } from './helpers';

const mv = (s: GameState, id: string, r: number, c: number): Move => {
  const m = getLegalMoves(s, id).find((x) => x.to.r === r && x.to.c === c);
  if (!m) throw new Error(`no move ${id} -> ${r},${c}`);
  return m;
};

describe('hostile character ids', () => {
  const inherited = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];

  it('isCharacterId only accepts own roster keys', () => {
    for (const id of inherited) expect(isCharacterId(id)).toBe(false);
    expect(isCharacterId('sad')).toBe(true);
    expect(isCharacterId(3)).toBe(false);
  });

  it('validateFormation rejects inherited Object keys as characters', () => {
    for (const id of inherited) {
      const f = [
        { character: id as CharacterId, level: 1, row: 0, col: 0 },
        { character: 'sad', level: 1, row: 0, col: 1 },
        { character: 'marki', level: 1, row: 0, col: 2 },
      ] as Formation;
      expect(validateFormation(f).ok).toBe(false);
      expect(() => createGame(f, defaultFormation())).toThrow();
    }
  });

  it('normalizeSquad drops inherited keys', () => {
    expect(normalizeSquad(['constructor', 'sad', 'toString'] as CharacterId[])).toEqual(['sad', 'marki', 'walk']);
  });

  it('a save with a hostile formation and grades loads as a playable default', () => {
    const raw = {
      ...createDefaultProfile(),
      owned: { ...createDefaultProfile().owned, sad: 3, constructor: 3 },
      grades: { sad: 3, constructor: 2, __proto__: { sad: 1 } },
      formation: [
        { character: 'constructor', level: 1, row: 0, col: 0 },
        { character: 'sad', level: 1, row: 0, col: 1 },
        { character: 'marki', level: 1, row: 0, col: 2 },
      ],
      formationSaved: true,
      stats: { wins: 1e300, losses: Number.NaN, draws: '5' },
    };
    const p = sanitizeProfile(JSON.parse(JSON.stringify(raw)));
    expect(validateFormation(p.formation).ok).toBe(true);
    expect(p.formationSaved).toBe(false);
    expect(p.grades.sad).toBe(3);
    expect(p.owned).not.toHaveProperty('constructor', 3);
    expect(p.stats.wins).toBe(Number.MAX_SAFE_INTEGER);
    expect(p.stats.losses).toBe(0);
    expect(p.stats.draws).toBe(0);
    expect(() => createGame(p.formation, defaultFormation())).not.toThrow();
    expect(({} as Record<string, unknown>).sad).toBeUndefined(); // no prototype pollution
  });

  it('a save from a newer build is read but not overwritten (downgrade safety)', () => {
    let writes = 0;
    const future = JSON.stringify({ ...createDefaultProfile(), version: 99, futureField: 1 });
    const storage: KeyValueStorage = { getItem: () => future, setItem: () => void writes++ };
    const p = loadProfile(storage);
    expect(validateFormation(p.formation).ok).toBe(true);
    expect(writes).toBe(0);
  });

  it('storage that throws on read or write never breaks loading', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(validateFormation(loadProfile(broken).formation).ok).toBe(true);
    const old: KeyValueStorage = { getItem: () => JSON.stringify({ version: 1 }), setItem: broken.setItem };
    expect(validateFormation(loadProfile(old).formation).ok).toBe(true);
  });
});

describe('end reasons', () => {
  it('a capture of the last piece on a storm-advance ply is an elimination, not a storm win', () => {
    // The storm advances on this very turn change but kills nobody.
    const s = makeState(
      [
        [0, 'sad', 2, 5, 5],
        [0, 'marki', 1, 1, 6],
        [1, 'sad', 1, 6, 5],
      ],
      0,
      { stormIn: 1, storm: 0 },
    );
    const t = applyMove(s, mv(s, 'p0-sad', 6, 5));
    expect(t.status).toBe('ended');
    expect(t.winner).toBe(0);
    expect(t.endReason).toBe('elimination');
  });

  it('a last piece stepping onto wasteland on a storm-advance ply loses by waste', () => {
    const s = makeState(
      [
        [0, 'sad', 1, 5, 5],
        [1, 'sad', 1, 8, 8],
      ],
      0,
      { stormIn: 1, waste: [5 * BOARD_SIZE + 6] },
    );
    const t = applyMove(s, mv(s, 'p0-sad', 5, 6));
    expect(t.status).toBe('ended');
    expect(t.winner).toBe(1);
    expect(t.endReason).toBe('waste');
    expect(t.storm).toBe(0); // the game was decided before the storm could tick
  });

  it('the storm swallowing one side\'s last piece is a storm win for the other', () => {
    const s = makeState(
      [
        [0, 'sad', 1, 5, 5],
        [1, 'sad', 1, 8, 0],
        [1, 'marki', 1, 8, 9],
      ],
      0,
      { stormIn: 1 },
    );
    const t = applyMove(s, mv(s, 'p0-sad', 5, 6));
    expect(t.storm).toBe(1);
    expect(t.status).toBe('ended');
    expect(t.endReason).toBe('storm');
    expect(t.winner).toBe(0);
    expect(t.pieces.map((p) => p.id)).toEqual(['p0-sad']);
  });
});

describe('sudden death at the new constant', () => {
  it('SUDDEN_DEATH_PLY is turn 41 and the match is bounded by 110 plies on 10 columns', () => {
    expect(SUDDEN_DEATH_PLY).toBe(80);
    expect(STORM_FULL_STEPS).toBe(5);
    expect(SUDDEN_DEATH_PLY + STORM_FULL_STEPS * STORM_INTERVAL_PLIES).toBe(110);
    expect(MAX_MATCH_PLIES).toBe(110);
  });

  it('FastBoard activates and ticks the storm exactly like the engine around ply 80', () => {
    let s = makeState(
      [
        [0, 'sad', 2, 5, 5],
        [0, 'walk', 1, 1, 3],
        [1, 'sad', 2, 8, 8],
        [1, 'walk', 1, 8, 9],
      ],
      0,
      { ply: SUDDEN_DEATH_PLY - 3 },
    );
    const b = fastFromState(s);
    const buf = new Int32Array(128);
    let steps = 0;
    while (s.status === 'playing' && steps++ < 60) {
      expect(suddenDeathIn(s)).toBe(s.stormIn === null ? Math.max(0, SUDDEN_DEATH_PLY - s.ply) : null);
      expect(b.ply).toBe(s.ply);
      expect(b.stormIn).toBe(s.stormIn ?? -1);
      expect(b.storm).toBe(s.storm);
      expect(b.turn).toBe(s.turn);
      const n = fastGenMoves(b, b.turn, buf, 0);
      const legal = getLegalMoves(s);
      expect(n).toBe(legal.length);
      // Shuffle the sads sideways, never capturing, so the storm decides the game.
      const pick = legal.find((m) => !m.captureId && m.pieceId.endsWith('sad')) ?? legal[0];
      const enc = Array.from(buf.subarray(0, n)).find((e) => b.ids[(e >> 8) & 255] === pick.pieceId && (e & 255) === pick.to.r * BOARD_SIZE + pick.to.c)!;
      expect(enc).toBeDefined();
      s = applyMove(s, pick);
      fastMake(b, enc);
      if (s.ply === SUDDEN_DEATH_PLY) expect(s.stormIn).toBe(STORM_INTERVAL_PLIES);
    }
    expect(s.storm).toBeGreaterThan(0);
  });
});

describe('bot fallback', () => {
  it('always returns a legal, non-suicidal move when one exists', () => {
    const s = makeState(
      [
        [0, 'sad', 1, 5, 5],
        [1, 'sad', 1, 8, 8],
      ],
      0,
      { waste: [5 * BOARD_SIZE + 6, 4 * BOARD_SIZE + 5, 6 * BOARD_SIZE + 5] },
    );
    for (let i = 0; i < 30; i++) {
      const a = fallbackAction(s);
      expect(a && !('kind' in a) && isLegalMove(s, a)).toBe(true);
      expect((a as Move).to).toEqual({ r: 5, c: 4 });
    }
  });

  it('returns null for a finished game', () => {
    const s = makeState([[0, 'sad', 1, 5, 5]], 0, { status: 'ended', winner: 0, endReason: 'elimination' });
    expect(fallbackAction(s)).toBeNull();
  });
});
