/**
 * The 2026-11-06 trio, each with a mechanic the roster did not have:
 *  - 해먼트 Hammont (rare): orthogonal slides 2 / 3 / 3; trait "해머 강타": an enemy he runs into is
 *    knocked one square on instead of captured (crushed when it cannot go; 3성 stuns it).
 *  - 베노아 Venoa (rare): steps 1 orthogonally; trait "독화살": shoots the first piece of a forward
 *    lane (forward diagonals from 2성) 2..3 / 2..3 / 2..4 squares away without moving.
 *  - 글라시아 Glacia (epic): glides orthogonally until stopped (never captures by gliding) + diagonal
 *    1 / 1 / 2; skill "빙결" freezes an enemy within 2 / 3 / 4 squares for its owner's next turn.
 * Geometry, the rules, Insaner absorbing them (movement only), FastBoard parity (moves, shots,
 * pushes and freezes, make / unmake) over random games, and the bot.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction, isSkillAction } from '../src/ai/bot';
import {
  BOARD_SIZE,
  CHARACTER_IDS,
  MAX_MATCH_PLIES,
  SKILL_UNLOCK_PLY,
  applyMove,
  applySkill,
  capturedIds,
  createGame,
  fastFromState,
  fastGenMoves,
  fastMake,
  fastMoveToMove,
  fastUnmake,
  freezeAnchors,
  getLegalMoves,
  getTargetsForPiece,
  isDirectional,
  isLegalMove,
  isLegalSkill,
  randomFormation,
  skillAnchors,
  skillBlock,
  sqOf,
  type CharacterId,
  type GameState,
  type Level,
  type Move,
  type SkillAction,
} from '../src/engine';
import { CHAR_BY_CODE, CHAR_CODE, N_CHARS, absorbMerge, abilityBit, absorbedLevel, absorbWithout, keepsDirection } from '../src/engine/characters';
import { SKILL_FLAG, fastCanSkill, fastFreezeFits } from '../src/engine/fast';
import { absorbSig, chainPlies, keys, makeState, rngFrom, targetKeys } from './helpers';

const reach = (s: GameState, id: string) => targetKeys(getTargetsForPiece(s, s.pieces.find((p) => p.id === id)!));
const far: [0 | 1, CharacterId, Level, number, number][] = [[1, 'sad', 1, 9, 9]];
const move = (s: GameState, id: string, r: number, c: number): Move => getLegalMoves(s, id).find((m) => m.to.r === r && m.to.c === c)!;
const pos = (s: GameState, id: string) => s.pieces.find((p) => p.id === id)?.pos;

describe('absorb masks: 16 character codes fill 32 bits', () => {
  it('every code, the last one using bit 31, round-trips through merge / without', () => {
    expect(N_CHARS).toBe(16);
    let m = 0;
    for (let ch = 0; ch < N_CHARS; ch++) m = absorbMerge(m, abilityBit(ch, ((ch % 3) + 1) as Level));
    for (let ch = 0; ch < N_CHARS; ch++) expect(absorbedLevel(m, ch)).toBe((ch % 3) + 1);
    // A Uint32Array slot (the FastBoard) reads the same levels as the int32 JS number.
    const u = new Uint32Array([m])[0];
    for (let ch = 0; ch < N_CHARS; ch++) expect(absorbedLevel(u, ch)).toBe((ch % 3) + 1);
    const w = absorbWithout(m, 15, 1);
    expect(absorbedLevel(w, 15)).toBe(0);
    expect(absorbedLevel(w, 14)).toBe(3);
  });
});

describe('해먼트 Hammont: knock-back', () => {
  const H = 'p0-hammont';
  it('slides orthogonally 2 / 3 / 3 and is symmetric (no turn-around, no arrow)', () => {
    expect(reach(makeState([[0, 'hammont', 1, 4, 4], ...far]), H)).toEqual(keys([[3, 4], [2, 4], [5, 4], [6, 4], [4, 3], [4, 2], [4, 5], [4, 6]]));
    expect(reach(makeState([[0, 'hammont', 2, 4, 4], ...far]), H)).toEqual(keys([[3, 4], [2, 4], [1, 4], [5, 4], [6, 4], [7, 4], [4, 3], [4, 2], [4, 1], [4, 5], [4, 6], [4, 7]]));
    expect(isDirectional({ character: 'hammont', level: 1 })).toBe(false);
    expect(keepsDirection(CHAR_CODE.hammont)).toBe(true);
  });

  it('a hit knocks the enemy one square on: he takes its square, nothing is captured', () => {
    const s = makeState([[0, 'hammont', 2, 4, 4], [1, 'walk', 1, 6, 4], [1, 'sad', 1, 9, 9]]);
    const m = move(s, H, 6, 4);
    expect(m.captureId).toBeUndefined();
    expect(m.push).toEqual({ id: 'p1-walk', to: { r: 7, c: 4 } });
    const t = applyMove(s, m);
    expect(pos(t, H)).toEqual({ r: 6, c: 4 });
    expect(pos(t, 'p1-walk')).toEqual({ r: 7, c: 4 });
    expect(t.pieces).toHaveLength(3);
    expect(t.pieces.find((p) => p.id === 'p1-walk')!.stun).toBeUndefined();
    expect(t.history.at(-1)).toMatchObject({ kind: 'move', move: { push: { id: 'p1-walk', to: { r: 7, c: 4 } } } });
  });

  it('crushes the enemy when the square behind it is the edge, a piece or wasteland', () => {
    const edge = makeState([[0, 'hammont', 1, 8, 4], [1, 'walk', 1, 9, 4], [1, 'sad', 1, 9, 9]]);
    const m1 = move(edge, H, 9, 4);
    expect(m1.crush).toBe(true);
    expect(m1.captureId).toBe('p1-walk');
    expect(capturedIds(m1)).toEqual(['p1-walk']);
    const t = applyMove(edge, m1);
    expect(t.pieces.map((p) => p.id).sort()).toEqual([H, 'p1-sad']);
    const piece = makeState([[0, 'hammont', 1, 4, 4], [1, 'walk', 1, 5, 4], [0, 'sad', 1, 6, 4], [1, 'sad', 1, 9, 9]]);
    expect(move(piece, H, 5, 4).crush).toBe(true);
    const waste = makeState([[0, 'hammont', 1, 4, 4], [1, 'walk', 1, 5, 4], [1, 'sad', 1, 9, 9]], 0, { waste: [6 * BOARD_SIZE + 4] });
    expect(move(waste, H, 5, 4).crush).toBe(true);
  });

  it('3성 stuns the knocked enemy for its owner next turn; a trap of his side stuns it at any grade', () => {
    const s = makeState([[0, 'hammont', 3, 4, 4], [1, 'walk', 1, 5, 4], [1, 'sad', 1, 9, 9]]);
    const t = applyMove(s, move(s, H, 5, 4));
    const w = t.pieces.find((p) => p.id === 'p1-walk')!;
    expect(w.stun).toBe(1);
    expect(getLegalMoves(t, 'p1-walk')).toEqual([]);
    // Player 1 moves its Sad; at the end of that turn the stun is gone.
    const u = applyMove(t, getLegalMoves(t, 'p1-sad')[0]);
    expect(u.pieces.find((p) => p.id === 'p1-walk')!.stun).toBeUndefined();
    const trap = makeState([[0, 'hammont', 1, 4, 4], [1, 'walk', 1, 5, 4], [1, 'sad', 1, 9, 9]], 0, { traps: [{ sq: 6 * BOARD_SIZE + 4, owner: 0 }] });
    const m = move(trap, H, 5, 4);
    expect(m.push?.stunned).toBe(true);
  });

  it('an Insaner that captures him gets a plain slide (captures, never pushes)', () => {
    let s = makeState([[0, 'insaner', 1, 4, 2], [1, 'hammont', 3, 4, 4], [1, 'walk', 1, 9, 9]]);
    s = applyMove(s, move(s, 'p0-insaner', 4, 4));
    const t = { ...s, turn: 0 as const, pieces: [...s.pieces, { id: 'p1-sad', owner: 1 as const, character: 'sad' as const, level: 1 as const, pos: { r: 5, c: 4 } }] };
    const m = move(t, 'p0-insaner', 5, 4);
    expect(m.captureId).toBe('p1-sad');
    expect(m.push).toBeUndefined();
  });
});

describe('베노아 Venoa: poison arrows', () => {
  const V = 'p0-venoa';
  it('steps 1 orthogonally; shoots forward 2..3 (1성), + forward diagonals (2성), 2..4 (3성)', () => {
    const enemies: [0 | 1, CharacterId, Level, number, number][] = [[1, 'walk', 1, 6, 4], [1, 'sad', 1, 6, 6], [1, 'marki', 1, 8, 0]];
    expect(reach(makeState([[0, 'venoa', 1, 4, 4], ...enemies]), V)).toEqual(keys([[3, 4], [5, 4], [4, 3], [4, 5], [6, 4]]));
    expect(reach(makeState([[0, 'venoa', 2, 4, 4], ...enemies]), V)).toEqual(keys([[3, 4], [5, 4], [4, 3], [4, 5], [6, 4], [6, 6]]));
    // 3성: the far diagonal enemy 4 squares away comes into range.
    expect(reach(makeState([[0, 'venoa', 3, 4, 4], ...enemies]), V)).toEqual(keys([[3, 4], [5, 4], [4, 3], [4, 5], [6, 4], [6, 6], [8, 0]]));
    expect(isDirectional({ character: 'venoa', level: 1 })).toBe(true);
  });

  it('a shot captures without moving; the arrow is blocked by any piece in between', () => {
    const s = makeState([[0, 'venoa', 1, 4, 4], [1, 'walk', 1, 6, 4], [1, 'sad', 1, 9, 9]]);
    const m = move(s, V, 6, 4);
    expect(m.shot).toBe(true);
    expect(m.captureId).toBe('p1-walk');
    const t = applyMove(s, m);
    expect(pos(t, V)).toEqual({ r: 4, c: 4 });
    expect(t.pieces.some((p) => p.id === 'p1-walk')).toBe(false);
    expect(t.history.at(-1)).toMatchObject({ move: { shot: true, captureId: 'p1-walk' } });
    const blocked = makeState([[0, 'venoa', 1, 4, 4], [0, 'sad', 1, 5, 4], [1, 'walk', 1, 6, 4], [1, 'sad', 1, 9, 9]]);
    expect(reach(blocked, V)).not.toContain('6,4');
  });

  it('an adjacent enemy is taken by stepping onto it (not a shot)', () => {
    const s = makeState([[0, 'venoa', 1, 4, 4], [1, 'walk', 1, 5, 4], [1, 'sad', 1, 9, 9]]);
    const m = move(s, V, 5, 4);
    expect(m.shot).toBeUndefined();
    expect(pos(applyMove(s, m), V)).toEqual({ r: 5, c: 4 });
  });

  it('an Insaner that captures her only steps (no arrows)', () => {
    let s = makeState([[0, 'insaner', 1, 4, 2], [1, 'venoa', 3, 4, 4], [1, 'walk', 1, 9, 9]]);
    s = applyMove(s, move(s, 'p0-insaner', 4, 4));
    const t = { ...s, turn: 0 as const, pieces: [...s.pieces, { id: 'p1-sad', owner: 1 as const, character: 'sad' as const, level: 1 as const, pos: { r: 8, c: 4 } }] };
    expect(getLegalMoves(t, 'p0-insaner').some((m) => m.shot)).toBe(false);
    expect(reach(t, 'p0-insaner')).not.toContain('8,4');
  });
});

describe('글라시아 Glacia: ice glide and 빙결', () => {
  const G = 'p0-glacia';
  it('glides until stopped (one landing per direction, never on a piece) + diagonal steps', () => {
    const s = makeState([[0, 'glacia', 1, 4, 4], [1, 'walk', 1, 4, 7], [0, 'sad', 1, 1, 4], [1, 'sad', 1, 9, 9]]);
    // Up: to row 9 (the edge); down: stops at row 2 (Sad on row 1); right: stops at 4,6 (Walk on 4,7);
    // left: to column 0. Diagonals 1.
    expect(reach(s, G)).toEqual(keys([[9, 4], [2, 4], [4, 6], [4, 0], [5, 5], [5, 3], [3, 5], [3, 3]]));
    expect(isDirectional({ character: 'glacia', level: 1 })).toBe(false);
  });

  it('glides end on wasteland (she dies there) and stop before the storm', () => {
    const s = makeState([[0, 'glacia', 1, 4, 4], ...far], 0, { waste: [4 * BOARD_SIZE + 6], storm: 1 });
    const r = reach(s, G);
    expect(r).toContain('4,6');
    expect(r).toContain('4,1'); // column 0 is storm at step 1
    expect(r).not.toContain('4,0');
  });

  it('3성 diagonal slide up to 2 (it captures normally)', () => {
    const s = makeState([[0, 'glacia', 3, 4, 4], [1, 'walk', 1, 6, 6], [1, 'sad', 1, 9, 9]]);
    expect(move(s, G, 6, 6).captureId).toBe('p1-walk');
  });

  it('빙결 targets enemies within 2 / 3 / 4 squares that are not stunned; the target sits out a turn', () => {
    const base = (level: Level) => makeState([[0, 'glacia', level, 4, 4], [1, 'walk', 1, 6, 6], [1, 'sad', 1, 8, 4], [1, 'marki', 1, 9, 9]], 0, { ply: SKILL_UNLOCK_PLY });
    expect(freezeAnchors(base(1), base(1).pieces[0]).map(sqOf)).toEqual([66]);
    expect(skillAnchors(base(2), G).map(sqOf)).toEqual([66]);
    expect(skillAnchors(base(3), G).map(sqOf)).toEqual([66, 84]);
    const s = base(1);
    const t = applySkill(s, { kind: 'skill', pieceId: G, anchor: { r: 6, c: 6 } });
    expect(t.pieces.find((p) => p.id === 'p1-walk')!.stun).toBe(1);
    expect(t.history.at(-1)).toEqual({ kind: 'skill', player: 0, pieceId: G, squares: [], frozen: 'p1-walk' });
    expect(getLegalMoves(t, 'p1-walk')).toEqual([]);
    expect(skillBlock(makeState([[0, 'glacia', 1, 0, 0], ...far], 0, { ply: SKILL_UNLOCK_PLY }), G)).toBe('noTarget');
  });

  it('a melody buff gives her a plain 1-square orthogonal slide (the glide is not reach)', () => {
    const s = makeState([[0, 'glacia', 1, 4, 4], [1, 'walk', 1, 5, 4], [1, 'sad', 1, 9, 9]]);
    const buffed = { ...s, pieces: s.pieces.map((p) => (p.id === G ? { ...p, buff: 2 } : p)) };
    // Blocked upward by the Walk at 5,4: unbuffed she cannot go up, buffed she captures it.
    expect(reach(s, G)).not.toContain('5,4');
    expect(move(buffed, G, 5, 4).captureId).toBe('p1-walk');
  });
});

// ---------------------------------------------------------------- FastBoard parity

const SQUADS: CharacterId[][] = [
  ['hammont', 'venoa', 'glacia'],
  ['hammont', 'insaner', 'michelle'],
  ['venoa', 'picker', 'volkonov'],
  ['glacia', 'brutile', 'rakaeli'],
  ['hammont', 'verish', 'midos'],
  ['venoa', 'glacia', 'sad'],
];
const randLv = (rng: () => number): Partial<Record<CharacterId, Level>> => Object.fromEntries(CHARACTER_IDS.map((id) => [id, (1 + Math.floor(rng() * 3)) as Level]));
const sig = (s: GameState) =>
  JSON.stringify({
    pieces: [...s.pieces]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => [p.id, p.pos.r, p.pos.c, keepsDirection(CHAR_CODE[p.character]) ? 0 : (p.dir ?? (p.owner === 0 ? 1 : -1)), p.stun ?? 0, p.buff ?? 0, p.awaken ?? 0, p.skillUsed ? 1 : 0, absorbSig((p.absorbed ?? []).map((a) => [a.character, a.level]), p.character, p.level)]),
    turn: s.turn,
    waste: [...s.waste].sort((a, b) => a - b),
    traps: (s.traps ?? []).map((t) => t.sq * 2 + t.owner).sort((a, b) => a - b),
  });
function fastSig(b: ReturnType<typeof fastFromState>): string {
  const pieces: (string | number)[][] = [];
  for (let i = 0; i < b.n; i++) {
    if (b.sq[i] < 0) continue;
    const abs: [CharacterId, number][] = CHAR_BY_CODE.map((id, ch) => [id, absorbedLevel(b.absorb[i], ch)]);
    pieces.push([b.ids[i], (b.sq[i] / BOARD_SIZE) | 0, b.sq[i] % BOARD_SIZE, keepsDirection(b.ch[i]) ? 0 : b.dir[i], b.stun[i], b.buff[i], b.awaken[i], b.used[i], absorbSig(abs, CHAR_BY_CODE[b.ch[i]], b.lvl[i])]);
  }
  pieces.sort((a, c) => String(a[0]).localeCompare(String(c[0])));
  const waste: number[] = [];
  const tr: number[] = [];
  for (let s = 0; s < BOARD_SIZE * BOARD_SIZE; s++) {
    if (b.waste[s]) waste.push(s);
    for (const o of [0, 1]) if (b.trap[s] & (o === 0 ? 1 : 2)) tr.push(s * 2 + o);
  }
  return JSON.stringify({ pieces, turn: b.turn, waste, traps: tr.sort((a, c) => a - c) });
}
const strip = (m: Move) => JSON.stringify({ c: capturedIds(m), shot: !!m.shot, push: m.push ?? null, crush: !!m.crush });

describe('FastBoard parity with the engine (Hammont, Venoa, Glacia)', () => {
  it('moves, shots, pushes and freezes make / unmake exactly over random games', () => {
    const rng = rngFrom(6061);
    const buf = new Int32Array(256);
    const seen = { moves: 0, shots: 0, pushes: 0, crushes: 0, stunPush: 0, freezes: 0, glides: 0 };
    for (let g = 0; g < 70; g++) {
      let s = createGame(randomFormation(rng, randLv(rng), SQUADS[g % SQUADS.length]), randomFormation(rng, randLv(rng), SQUADS[(g + 3) % SQUADS.length]), (g % 2) as 0 | 1);
      for (let ply = 0; ply < 120 && s.status === 'playing'; ply++) {
        const legal = getLegalMoves(s);
        const b = fastFromState(s);
        const n = fastGenMoves(b, b.turn, buf, 0);
        expect(Array.from(buf.subarray(0, n)).map((m) => `${b.ids[(m >> 8) & 255]}>${m & 255}`).sort()).toEqual(legal.map((m) => `${m.pieceId}>${sqOf(m.to)}`).sort());
        const before = fastSig(b);
        expect(before).toBe(sig(s));
        for (let k = 0; k < n; k++) {
          const fm = fastMoveToMove(b, buf[k]);
          const lm = legal.find((m) => m.pieceId === fm.pieceId && m.to.r === fm.to.r && m.to.c === fm.to.c)!;
          expect(strip(fm)).toBe(strip(lm));
          if (lm.shot) seen.shots++;
          if (lm.push) seen.pushes++;
          if (lm.push?.stunned) seen.stunPush++;
          if (lm.crush) seen.crushes++;
          if (lm.pieceId.endsWith('glacia') && Math.abs(lm.to.r - lm.from.r) + Math.abs(lm.to.c - lm.from.c) > 2 && (lm.to.r === lm.from.r || lm.to.c === lm.from.c)) seen.glides++;
          const eng = applyMove(s, lm);
          const undo = fastMake(b, buf[k]);
          if (eng.status === 'playing' && eng.history.length === s.history.length + 1) expect(fastSig(b)).toBe(sig(eng));
          fastUnmake(b, buf[k], undo);
          expect(fastSig(b)).toBe(before);
          seen.moves++;
        }
        // Every freeze target of every Glacia that may cast, on both engines.
        const skills: SkillAction[] = [];
        for (let i = 0; i < b.n; i++) {
          if (b.ch[i] !== CHAR_CODE.glacia || b.sq[i] < 0 || b.owner[i] !== b.turn) continue;
          if (!fastCanSkill(b, i)) {
            expect(skillAnchors(s, b.ids[i])).toEqual([]);
            continue;
          }
          const fast: number[] = [];
          for (let t = 0; t < BOARD_SIZE * BOARD_SIZE; t++) if (fastFreezeFits(b, i, t)) fast.push(t);
          expect(fast).toEqual(skillAnchors(s, b.ids[i]).map(sqOf));
          for (const t of fast) {
            const mv = SKILL_FLAG | (i << 8) | t;
            const action: SkillAction = { kind: 'skill', pieceId: b.ids[i], anchor: { r: (t / BOARD_SIZE) | 0, c: t % BOARD_SIZE } };
            skills.push(action);
            const eng = applySkill(s, action);
            const undo = fastMake(b, mv);
            if (eng.status === 'playing' && eng.history.length === s.history.length + 1) expect(fastSig(b)).toBe(sig(eng));
            fastUnmake(b, mv, undo);
            expect(fastSig(b)).toBe(before);
            seen.freezes++;
          }
        }
        if (!legal.length && !skills.length) break;
        if (skills.length && rng() < 0.1) s = applySkill(s, skills[Math.floor(rng() * skills.length)]);
        else if (legal.length) s = applyMove(s, legal[Math.floor(rng() * legal.length)]);
        else s = applySkill(s, skills[0]);
      }
    }
    expect(seen.moves).toBeGreaterThan(5000);
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(10);
  }, 240_000);
});

describe('bot with the trio', () => {
  it('Venoa takes a free shot', () => {
    const s = makeState([[0, 'venoa', 1, 4, 4], [1, 'walk', 2, 7, 4], [1, 'sad', 1, 9, 9]], 0, { ply: 20 });
    const a = chooseAction(s, 'hard', { timeBudgetMs: 200, rng: rngFrom(1) }) as Move;
    expect(a.shot).toBe(true);
  });

  it('Hammont crushes an enemy against the edge', () => {
    const s = makeState([[0, 'hammont', 1, 8, 4], [1, 'walk', 1, 9, 4], [1, 'sad', 1, 9, 9]], 0, { ply: 20 });
    const a = chooseAction(s, 'hard', { timeBudgetMs: 200, rng: rngFrom(2) }) as Move;
    expect(a.crush).toBe(true);
  });

  it('plays legal games with the trio on both sides to termination', () => {
    const rng = rngFrom(88);
    let freezes = 0;
    for (let i = 0; i < 18; i++) {
      let g = createGame(randomFormation(rng, randLv(rng), SQUADS[i % SQUADS.length]), randomFormation(rng, randLv(rng), SQUADS[(i + 1) % SQUADS.length]), (i % 2) as 0 | 1);
      let guard = 0;
      while (g.status === 'playing') {
        expect(++guard).toBeLessThan(400);
        const a = chooseAction(g, i % 2 ? 'normal' : 'easy', { timeBudgetMs: 5, rng });
        expect(a).not.toBeNull();
        if (isSkillAction(a)) {
          expect(isLegalSkill(g, a)).toBe(true);
          if (a.pieceId.endsWith('glacia')) freezes++;
          g = applySkill(g, a);
        } else {
          expect(isLegalMove(g, a as Move)).toBe(true);
          g = applyMove(g, a as Move);
        }
      }
      expect(g.ply - chainPlies(g.history)).toBeLessThanOrEqual(MAX_MATCH_PLIES);
    }
    expect(freezes).toBeGreaterThan(0);
  }, 180_000);
});
