/**
 * 베리쉬 Verish (rare): a forward / sideways slider whose trait "관통" (pierce) captures and passes
 * every enemy in her lane; her own pieces, wasteland, the board edge and the storm stop her before
 * the square. Geometry by grade and side, the pierce rules, Insaner absorbing her (a plain slide),
 * FastBoard parity over random games and the bot.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction, isSkillAction } from '../src/ai/bot';
import {
  BOARD_SIZE,
  CHARACTER_IDS,
  MAX_MATCH_PLIES,
  applyMove,
  applySkill,
  capturedIds,
  createGame,
  fastFromState,
  fastGenMoves,
  fastMake,
  fastMoveToMove,
  fastUnmake,
  getLegalMoves,
  getTargetsForPiece,
  isDirectional,
  isLegalMove,
  isLegalSkill,
  randomFormation,
  type CharacterId,
  type GameState,
  type Level,
  type Move,
} from '../src/engine';
import { CHAR_BY_CODE, CHAR_CODE, absorbedLevel, keepsDirection } from '../src/engine/characters';
import { absorbSig, chainPlies, keys, makeState, rngFrom, targetKeys } from './helpers';

const V = 'p0-verish';
const reach = (s: GameState, id = V) => targetKeys(getTargetsForPiece(s, s.pieces.find((p) => p.id === id)!));
const far: [0 | 1, CharacterId, Level, number, number][] = [[1, 'sad', 1, 9, 9]];

describe('베리쉬 Verish: lanes by grade', () => {
  it('1성 left / right 1 + forward 2; 2성 left / right 2 + forward 2; 3성 adds forward 3 and back 1 (player 0)', () => {
    expect(reach(makeState([[0, 'verish', 1, 4, 4], ...far]))).toEqual(keys([[4, 3], [4, 5], [5, 4], [6, 4]]));
    expect(reach(makeState([[0, 'verish', 2, 4, 4], ...far]))).toEqual(keys([[4, 3], [4, 2], [4, 5], [4, 6], [5, 4], [6, 4]]));
    expect(reach(makeState([[0, 'verish', 3, 4, 4], ...far]))).toEqual(keys([[4, 3], [4, 2], [4, 5], [4, 6], [5, 4], [6, 4], [7, 4], [3, 4]]));
  });

  it('player 1 slides toward row 0; she is directional and turns around at the far edge', () => {
    expect(reach(makeState([[1, 'verish', 3, 5, 5], [0, 'sad', 1, 0, 0]]), 'p1-verish')).toEqual(keys([[5, 4], [5, 3], [5, 6], [5, 7], [4, 5], [3, 5], [2, 5], [6, 5]]));
    expect(isDirectional({ character: 'verish', level: 1 })).toBe(true);
    expect(keepsDirection(CHAR_CODE.verish)).toBe(false);
    const s = applyMove(makeState([[0, 'verish', 1, 8, 4], [1, 'sad', 1, 0, 0]]), { pieceId: V, from: { r: 8, c: 4 }, to: { r: 9, c: 4 } });
    expect(s.pieces.find((p) => p.id === V)!.dir).toBe(-1);
  });
});

describe('베리쉬 trait 관통 (pierce)', () => {
  it('captures every enemy in the lane and keeps going: one move takes them all', () => {
    const s = makeState([[0, 'verish', 3, 2, 4], [1, 'sad', 1, 3, 4], [1, 'marki', 1, 4, 4], [1, 'walk', 1, 9, 9]]);
    expect(reach(s)).toEqual(expect.arrayContaining(['3,4', '4,4', '5,4']));
    const m = getLegalMoves(s, V).find((x) => x.to.r === 5 && x.to.c === 4)!;
    expect(capturedIds(m)).toEqual(['p1-sad', 'p1-marki']);
    const after = applyMove(s, m);
    expect(after.pieces.map((p) => p.id).sort()).toEqual(['p0-verish', 'p1-walk']);
    const recorded = after.history[after.history.length - 1];
    expect(recorded.kind === 'move' && recorded.move.captureIds).toEqual(['p1-sad', 'p1-marki']);
  });

  it('stopping on an enemy mid-lane captures only the ones up to there', () => {
    const s = makeState([[0, 'verish', 3, 2, 4], [1, 'sad', 1, 3, 4], [1, 'marki', 1, 4, 4], [1, 'walk', 1, 9, 9]]);
    const m = getLegalMoves(s, V).find((x) => x.to.r === 4 && x.to.c === 4)!;
    expect(capturedIds(m)).toEqual(['p1-sad', 'p1-marki']);
    const m1 = getLegalMoves(s, V).find((x) => x.to.r === 3 && x.to.c === 4)!;
    expect(capturedIds(m1)).toEqual(['p1-sad']);
  });

  it('her own piece stops her before its square', () => {
    const s = makeState([[0, 'verish', 3, 2, 4], [0, 'sad', 1, 4, 4], [1, 'marki', 1, 3, 4], ...far]);
    expect(reach(s)).toContain('3,4');
    expect(reach(s)).not.toContain('4,4');
    expect(reach(s)).not.toContain('5,4');
  });

  it('wasteland stops her before it (she never enters it), the storm and the edge too', () => {
    const s = makeState([[0, 'verish', 3, 2, 4], ...far], 0, { waste: [4 * BOARD_SIZE + 4] });
    expect(reach(s)).toContain('3,4');
    expect(reach(s)).not.toContain('4,4');
    expect(reach(s)).not.toContain('5,4');
    const st = makeState([[0, 'verish', 3, 4, 3], [1, 'sad', 1, 4, 5]], 0, { storm: 2, stormIn: 4 });
    expect(reach(st)).not.toContain('4,1');
    expect(reach(st)).toContain('4,2');
    expect(reach(makeState([[0, 'verish', 3, 0, 0], ...far]))).toEqual(keys([[0, 1], [0, 2], [1, 0], [2, 0], [3, 0]]));
  });

  it('enemy doll traps do not stop her lane; only the landing square catches', () => {
    const s = makeState([[0, 'verish', 2, 2, 4], ...far], 0, { traps: [{ sq: 3 * BOARD_SIZE + 4, owner: 1 }] });
    expect(reach(s)).toContain('4,4');
    const caught = applyMove(s, getLegalMoves(s, V).find((m) => m.to.r === 3 && m.to.c === 4)!);
    expect(caught.pieces.find((p) => p.id === V)!.stun).toBeGreaterThan(0);
  });

  it('an Insaner that captures her gets her lanes as a plain slide (no pierce)', () => {
    let s = makeState([[0, 'insaner', 1, 4, 2], [1, 'verish', 3, 4, 4], [1, 'walk', 1, 9, 9]]);
    s = applyMove(s, getLegalMoves(s, 'p0-insaner').find((m) => m.to.r === 4 && m.to.c === 4)!);
    expect(s.pieces.find((p) => p.id === 'p0-insaner')!.absorbed).toEqual([{ character: 'verish', level: 3 }]);
    // Facing forward (+r): two enemies stacked ahead: the slide stops on the first.
    const t = { ...s, turn: 0 as const, pieces: [...s.pieces, { id: 'p1-sad', owner: 1 as const, character: 'sad' as const, level: 1 as const, pos: { r: 6, c: 4 } }, { id: 'p1-marki', owner: 1 as const, character: 'marki' as const, level: 1 as const, pos: { r: 7, c: 4 } }] };
    const r = reach(t, 'p0-insaner');
    expect(r).toContain('6,4');
    expect(r).not.toContain('7,4');
    expect(getLegalMoves(t, 'p0-insaner').every((m) => !m.captureIds)).toBe(true);
  });
});

// ---------------------------------------------------------------- FastBoard parity

const SQUADS: CharacterId[][] = [
  ['verish', 'picker', 'insaner'],
  ['verish', 'volkonov', 'larhen'],
  ['verish', 'michelle', 'brutile'],
  ['sad', 'verish', 'rampid'],
  ['marki', 'walk', 'verish'],
];
const randLv = (rng: () => number): Partial<Record<CharacterId, Level>> => Object.fromEntries(CHARACTER_IDS.map((id) => [id, (1 + Math.floor(rng() * 3)) as Level]));
const sig = (s: GameState) =>
  JSON.stringify({
    pieces: [...s.pieces]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => [p.id, p.pos.r, p.pos.c, keepsDirection(CHAR_CODE[p.character]) ? 0 : (p.dir ?? (p.owner === 0 ? 1 : -1)), p.stun ?? 0, p.buff ?? 0, absorbSig((p.absorbed ?? []).map((a) => [a.character, a.level]), p.character, p.level)]),
    turn: s.turn,
    traps: (s.traps ?? []).map((t) => t.sq * 2 + t.owner).sort((a, b) => a - b),
  });
function fastSig(b: ReturnType<typeof fastFromState>): string {
  const pieces: (string | number)[][] = [];
  for (let i = 0; i < b.n; i++) {
    if (b.sq[i] < 0) continue;
    const abs: [CharacterId, number][] = CHAR_BY_CODE.map((id, ch) => [id, absorbedLevel(b.absorb[i], ch)]);
    pieces.push([b.ids[i], (b.sq[i] / BOARD_SIZE) | 0, b.sq[i] % BOARD_SIZE, keepsDirection(b.ch[i]) ? 0 : b.dir[i], b.stun[i], b.buff[i], absorbSig(abs, CHAR_BY_CODE[b.ch[i]], b.lvl[i])]);
  }
  pieces.sort((a, c) => String(a[0]).localeCompare(String(c[0])));
  const tr: number[] = [];
  for (let s = 0; s < BOARD_SIZE * BOARD_SIZE; s++) for (const o of [0, 1]) if (b.trap[s] & (o === 0 ? 1 : 2)) tr.push(s * 2 + o);
  return JSON.stringify({ pieces, turn: b.turn, traps: tr.sort((a, c) => a - c) });
}

describe('FastBoard parity with the engine (Verish)', () => {
  it('pierces with several captures make / unmake exactly, with the same capture lists, over random games', () => {
    const rng = rngFrom(311);
    const buf = new Int32Array(256);
    let checked = 0;
    let multi = 0;
    for (let g = 0; g < 60; g++) {
      let s = createGame(randomFormation(rng, randLv(rng), SQUADS[g % SQUADS.length]), randomFormation(rng, randLv(rng), SQUADS[(g + 2) % SQUADS.length]), (g % 2) as 0 | 1);
      for (let ply = 0; ply < 120 && s.status === 'playing'; ply++) {
        const legal = getLegalMoves(s);
        const b = fastFromState(s);
        const n = fastGenMoves(b, b.turn, buf, 0);
        expect(Array.from(buf.subarray(0, n)).map((m) => `${b.ids[(m >> 8) & 255]}>${m & 255}`).sort()).toEqual(legal.map((m) => `${m.pieceId}>${m.to.r * BOARD_SIZE + m.to.c}`).sort());
        const before = fastSig(b);
        expect(before).toBe(sig(s));
        for (let k = 0; k < n; k++) {
          const fm = fastMoveToMove(b, buf[k]);
          const lm = legal.find((m) => m.pieceId === fm.pieceId && m.to.r === fm.to.r && m.to.c === fm.to.c)!;
          expect(capturedIds(fm)).toEqual(capturedIds(lm));
          if (capturedIds(lm).length > 1) multi++;
          const eng = applyMove(s, fm);
          const undo = fastMake(b, buf[k]);
          if (eng.status === 'playing' && eng.history.length === s.history.length + 1) expect(fastSig(b)).toBe(sig(eng));
          fastUnmake(b, buf[k], undo);
          expect(fastSig(b)).toBe(before);
          checked++;
        }
        if (!legal.length) break;
        s = applyMove(s, legal[Math.floor(rng() * legal.length)]);
      }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(multi).toBeGreaterThan(5);
  }, 120_000);
});

describe('bot with Verish', () => {
  it('takes a double pierce when it is there', () => {
    const s = makeState([[0, 'verish', 2, 2, 4], [1, 'sad', 1, 3, 4], [1, 'michelle', 1, 4, 4], [1, 'marki', 1, 9, 9]], 0, { ply: 20 });
    for (const seed of [1, 2]) {
      const a = chooseAction(s, 'hard', { timeBudgetMs: 200, rng: rngFrom(seed) }) as Move;
      expect(capturedIds(a).length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('plays legal games with Verish on both sides to termination', () => {
    const rng = rngFrom(77);
    for (let i = 0; i < 15; i++) {
      let g = createGame(randomFormation(rng, randLv(rng), SQUADS[i % SQUADS.length]), randomFormation(rng, randLv(rng), SQUADS[(i + 1) % SQUADS.length]), (i % 2) as 0 | 1);
      let guard = 0;
      while (g.status === 'playing') {
        expect(++guard).toBeLessThan(400);
        const a = chooseAction(g, i % 2 ? 'normal' : 'easy', { timeBudgetMs: 5, rng });
        expect(a).not.toBeNull();
        if (isSkillAction(a)) {
          expect(isLegalSkill(g, a)).toBe(true);
          g = applySkill(g, a);
        } else {
          expect(isLegalMove(g, a as Move)).toBe(true);
          g = applyMove(g, a as Move);
        }
      }
      expect(g.ply - chainPlies(g.history)).toBeLessThanOrEqual(MAX_MATCH_PLIES);
    }
  }, 120_000);
});
