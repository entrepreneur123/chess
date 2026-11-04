/**
 * Storm lock (owner rule, 2026-11-04): once the storm has closed in (storm >= 1), a side to move
 * with no legal action (no move, no castable skill) loses at once ('immobile'). Exceptions: a
 * side held only by doll-trap stuns passes ('stunned'), and a chain move that cannot be played
 * lapses ('bonusSkip'). Before the storm closes in, the old auto-pass / stalemate rules stay.
 * Also: a storm step that swallows both sides' last pieces is decided by piece COUNT.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  STORM_INTERVAL_PLIES,
  SUDDEN_DEATH_PLY,
  applyMove,
  fastFromState,
  fastGenMoves,
  fastMake,
  fastMoveToMove,
  fastImmobile,
  fastUnmake,
  getLegalMoves,
  inStorm,
  skipBonus,
  type CharacterId,
  type GameState,
  type Level,
  type Move,
  type Piece,
} from '../src/engine';
import { chooseAction, isSkillAction } from '../src/ai/bot';
import { makeState, rngFrom, targetKeys } from './helpers';

const mv = (s: GameState, id: string, r: number, c: number): Move => {
  const m = getLegalMoves(s, id).find((x) => x.to.r === r && x.to.c === c);
  if (!m) throw new Error(`no legal move ${id} -> ${r},${c}: ${targetKeys(getLegalMoves(s, id)).join(' ')}`);
  return m;
};
const at = (storm: number, stormIn = STORM_INTERVAL_PLIES) => ({ storm, stormIn, ply: SUDDEN_DEATH_PLY + 4 * storm });
const withPiece = (s: GameState, id: string, patch: Partial<Piece>): GameState => ({ ...s, pieces: s.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

describe('storm lock: a side boxed in by the storm loses', () => {
  it('a Walk facing a storm row is boxed in: its side loses at once', () => {
    // Step 3: rows 0 / 9 and columns 0-2 / 7-9 are storm. Red's only piece is a walk on row 1
    // facing row 0 (storm, not an edge: no turn-around).
    let s = makeState([[0, 'sad', 1, 4, 4], [1, 'walk', 3, 1, 4]], 0, at(3));
    s = applyMove(s, mv(s, 'p0-sad', 4, 5));
    expect(s.status).toBe('ended');
    expect(s.endReason).toBe('immobile');
    expect(s.winner).toBe(0);
  });

  it('a Marki and a Walk both facing the storm rows: boxed in, it loses', () => {
    let s = makeState([[0, 'marki', 2, 8, 4], [0, 'walk', 1, 8, 6], [1, 'sad', 1, 4, 4], [1, 'insaner', 1, 3, 5]], 1, at(3));
    expect(getLegalMoves({ ...s, turn: 0 })).toEqual([]);
    s = applyMove(s, mv(s, 'p1-sad', 4, 3));
    expect(s.endReason).toBe('immobile');
    expect(s.winner).toBe(1);
  });

  it('one free piece is enough: no lock while any move exists', () => {
    let s = makeState([[0, 'marki', 2, 8, 4], [0, 'sad', 1, 5, 5], [1, 'sad', 1, 4, 3]], 1, at(3));
    s = applyMove(s, mv(s, 'p1-sad', 3, 3));
    expect(s.status).toBe('playing');
    expect(s.turn).toBe(0);
    expect(getLegalMoves(s).every((m) => m.pieceId === 'p0-sad')).toBe(true);
  });

  it('a side held only by doll-trap stuns still passes (it can move once they wear off)', () => {
    // Blue's only piece, a sad, is stunned (it sits out its owner's next turn) but has moves.
    let s = withPiece(makeState([[0, 'sad', 1, 5, 5], [1, 'sad', 1, 3, 3]], 1, at(3)), 'p0-sad', { stun: 1 });
    s = applyMove(s, mv(s, 'p1-sad', 3, 4));
    expect(s.status).toBe('playing');
    const pass = s.history.find((e) => e.kind === 'pass');
    expect(pass?.kind === 'pass' && pass.player === 0 && pass.reason).toBe('stunned');
    // Red is to move again; blue's sad is free on its next turn.
    expect(s.turn).toBe(1);
    expect(s.pieces.find((p) => p.id === 'p0-sad')!.stun ?? 0).toBe(0);
  });

  it('stunned AND boxed in (no move even without the stun) is a lock', () => {
    let s = withPiece(makeState([[0, 'walk', 1, 8, 4], [1, 'sad', 1, 3, 3]], 1, at(3)), 'p0-walk', { stun: 1 });
    s = applyMove(s, mv(s, 'p1-sad', 3, 4));
    expect(s.endReason).toBe('immobile');
    expect(s.winner).toBe(1);
  });

  it('a stunned piece with moves keeps a side with boxed-in pieces alive (it passes)', () => {
    let s = withPiece(makeState([[0, 'walk', 1, 8, 4], [0, 'sad', 1, 5, 5], [1, 'sad', 1, 3, 3]], 1, at(3)), 'p0-sad', { stun: 1 });
    s = applyMove(s, mv(s, 'p1-sad', 3, 4));
    expect(s.status).toBe('playing');
    expect(s.history.some((e) => e.kind === 'pass' && e.player === 0 && e.reason === 'stunned')).toBe(true);
  });

  it('a pending chain move that cannot be played lapses: never a loss', () => {
    // A chain move pending for blue's insaner during the storm: letting it lapse just passes.
    const s = makeState([[0, 'insaner', 3, 5, 4], [0, 'sad', 1, 6, 5], [1, 'sad', 1, 3, 3]], 0, { ...at(3), bonusPieceId: 'p0-insaner' });
    const t = skipBonus(s);
    expect(t.status).toBe('playing');
    expect(t.history.some((e) => e.kind === 'pass' && e.reason === 'bonusSkip')).toBe(true);
    // The fast board never calls a pending chain move a lock either.
    const b = fastFromState({ ...s, pieces: s.pieces.map((p) => (p.id === 'p0-insaner' ? { ...p, stun: 2 } : p)) });
    expect(b.bonus).toBeGreaterThanOrEqual(0);
    expect(fastImmobile(b)).toBe(false);
  });

  it('before the storm closes in, no legal action loses too (must act every turn)', () => {
    // Blue's only piece: a walk on row 9 still facing +1 (no row ahead), storm not closed in yet.
    let s = withPiece(makeState([[0, 'walk', 1, 9, 4], [1, 'sad', 1, 3, 3]], 1, { stormIn: STORM_INTERVAL_PLIES }), 'p0-walk', { dir: 1 });
    s = applyMove(s, mv(s, 'p1-sad', 3, 4));
    expect(s.storm).toBe(0);
    expect(s.status).toBe('ended');
    expect(s.endReason).toBe('immobile');
    expect(s.winner).toBe(1);
  });

  it('when nobody can act, the side to move loses (no material stalemate)', () => {
    // Both walks face a board edge with no row ahead (facings pinned for the test); blue's sad
    // steps onto wasteland and is gone: red is to move and cannot act, so red loses.
    const t = withPiece(withPiece(makeState([[0, 'walk', 1, 9, 4], [0, 'sad', 1, 5, 5], [1, 'walk', 2, 0, 4]], 0, { waste: [6 * BOARD_SIZE + 5] }), 'p0-walk', { dir: 1 }), 'p1-walk', { dir: -1 });
    const e = applyMove(t, mv(t, 'p0-sad', 6, 5));
    expect(e.status).toBe('ended');
    expect(e.endReason).toBe('immobile');
    expect(e.winner).toBe(0);
  });
});

describe('storm lock: FastBoard parity and the bot', () => {
  it('fastImmobile agrees with the engine after every move (random storm positions)', () => {
    const rng = rngFrom(9001);
    const buf = new Int32Array(256);
    const pool: CharacterId[] = ['marki', 'walk', 'rakaeli', 'brutile', 'michelle', 'sad', 'insaner', 'picker'];
    let locks = 0;
    let checked = 0;
    let wipes = 0;
    for (let g = 0; g < 600; g++) {
      const step = 3 + (g % 2);
      const pieces: [0 | 1, CharacterId, Level, number, number][] = [];
      const used = new Set<number>();
      for (const owner of [0, 1] as const) {
        const avail = [...pool];
        const n = 1 + Math.floor(rng() * 2);
        for (let k = 0; k < n; k++) {
          // Forward-only movers most of the time: they are the ones the storm boxes in.
          const ch = rng() < 0.7 ? avail.splice(Math.floor(rng() * 3), 1)[0] : avail.splice(Math.floor(rng() * avail.length), 1)[0];
          let sq: number;
          do sq = Math.floor(rng() * BOARD_SIZE * BOARD_SIZE);
          while (used.has(sq) || inStorm((sq / BOARD_SIZE) | 0, sq % BOARD_SIZE, step));
          used.add(sq);
          pieces.push([owner, ch, (1 + Math.floor(rng() * 3)) as Level, (sq / BOARD_SIZE) | 0, sq % BOARD_SIZE]);
        }
      }
      const s0 = makeState(pieces, (g % 2) as 0 | 1, at(step, 1 + (g % 3)));
      // Random facings (pieces that turned around earlier) and the odd stun.
      const s: GameState = { ...s0, pieces: s0.pieces.map((p) => ({ ...p, dir: rng() < 0.5 ? 1 : -1, ...(rng() < 0.1 ? { stun: 1 } : {}) })) };
      const legal = getLegalMoves(s);
      if (legal.length === 0) continue;
      const b = fastFromState(s);
      const n = fastGenMoves(b, b.turn, buf, 0);
      expect(n).toBe(legal.length);
      for (let k = 0; k < n; k++) {
        const m = fastMoveToMove(b, buf[k]);
        const eng = applyMove(s, m);
        const u = fastMake(b, buf[k]);
        const added = eng.history.slice(s.history.length);
        if (b.alive[0] === 0 && b.alive[1] === 0) {
          // A double wipe: the fast board's piece-count sign decides like the engine.
          wipes++;
          expect(eng.endReason).toBe('storm');
          expect(Math.sign(b.wipe)).toBe(eng.winner === null ? 0 : eng.winner === 0 ? 1 : -1);
        } else if (b.alive[0] > 0 && b.alive[1] > 0 && b.bonus < 0 && !added.some((e) => e.kind === 'pass')) {
          expect(fastImmobile(b), `${m.pieceId}>${m.to.r},${m.to.c}`).toBe(eng.endReason === 'immobile');
          if (eng.endReason === 'immobile') {
            locks++;
            expect(eng.winner).toBe(1 - b.turn);
          }
          checked++;
        }
        fastUnmake(b, buf[k], u);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(locks).toBeGreaterThan(20);
    expect(wipes).toBeGreaterThan(5);
  });

  it('the bot does not walk into a storm lock, not even for a free capture', () => {
    // Blue: a marki 2성 on (5,5) facing +1 and a walk already boxed on row 8 (row 9 is storm at
    // step 3). Taking the red sad on (8,5) wins material but leaves blue with no move on its next
    // turn: a loss. (6,5) / (7,5) keep blue alive.
    const s = makeState([[0, 'marki', 2, 5, 5], [0, 'walk', 1, 8, 3], [1, 'sad', 1, 8, 5], [1, 'insaner', 1, 2, 4]], 0, at(3));
    expect(targetKeys(getLegalMoves(s))).toEqual(['6,5', '7,5', '8,5']);
    const take = applyMove(s, mv(s, 'p0-marki', 8, 5));
    const after = applyMove(take, getLegalMoves(take)[0]);
    expect(after.endReason).toBe('immobile');
    for (const diff of ['hard', 'extreme'] as const) {
      for (let seed = 1; seed <= 4; seed++) {
        const a = chooseAction(s, diff, { timeBudgetMs: 120, rng: rngFrom(seed) });
        expect(a && !isSkillAction(a) && a.to.r, `${diff} seed ${seed}`).not.toBe(8);
      }
    }
  });
});
