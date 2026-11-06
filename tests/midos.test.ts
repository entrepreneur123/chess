/**
 * 미도스 Midos (epic, a ghost): slides left / right / forward 1 / 2 / 3 by grade (never back or
 * diagonally) and turns around at the far edge; skill "그림자 도약" teleports him to any free square
 * (no piece, no wasteland, no enemy doll trap). Geometry, the skill rules, Insaner absorbing him,
 * FastBoard parity (moves AND teleports, make / unmake) over random games, and the bot.
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
  blinkAnchors,
  createGame,
  fastFromState,
  fastGenMoves,
  fastMake,
  fastUnmake,
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
import { CHAR_BY_CODE, CHAR_CODE, absorbedLevel, keepsDirection } from '../src/engine/characters';
import { SKILL_FLAG, fastBlinkFits, fastCanSkill, fastImmobile } from '../src/engine/fast';
import { lastMoveOf } from '../src/ui/game/GameController';
import { absorbSig, chainPlies, keys, makeState, rngFrom, spendSkill, targetKeys } from './helpers';

const M = 'p0-midos';
const reach = (s: GameState, id = M) => targetKeys(getTargetsForPiece(s, s.pieces.find((p) => p.id === id)!));
const far: [0 | 1, CharacterId, Level, number, number][] = [[1, 'sad', 1, 9, 9]];
const blink = (pieceId: string, r: number, c: number): SkillAction => ({ kind: 'skill', pieceId, anchor: { r, c } });

describe('미도스 Midos: movement by grade', () => {
  it('1성 left / right / forward 1; 2성 up to 2; 3성 up to 3; never back or diagonal (player 0)', () => {
    expect(reach(makeState([[0, 'midos', 1, 4, 4], ...far]))).toEqual(keys([[4, 3], [4, 5], [5, 4]]));
    expect(reach(makeState([[0, 'midos', 2, 4, 4], ...far]))).toEqual(keys([[4, 3], [4, 2], [4, 5], [4, 6], [5, 4], [6, 4]]));
    expect(reach(makeState([[0, 'midos', 3, 4, 4], ...far]))).toEqual(keys([[4, 3], [4, 2], [4, 1], [4, 5], [4, 6], [4, 7], [5, 4], [6, 4], [7, 4]]));
  });

  it('player 1 slides toward row 0', () => {
    expect(reach(makeState([[1, 'midos', 2, 5, 5], [0, 'sad', 1, 0, 0]]), 'p1-midos')).toEqual(keys([[5, 4], [5, 3], [5, 6], [5, 7], [4, 5], [3, 5]]));
  });

  it('slides are blocked by pieces (capturing an enemy blocker, never an ally) and end on wasteland', () => {
    const s = makeState([[0, 'midos', 3, 4, 4], [0, 'sad', 1, 4, 6], [1, 'walk', 1, 6, 4], [1, 'sad', 1, 9, 9]], 0, { waste: [4 * BOARD_SIZE + 2] });
    expect(reach(s)).toEqual(keys([[4, 3], [4, 2], [4, 5], [5, 4], [6, 4]]));
    expect(getLegalMoves(s, M).find((m) => m.to.r === 6 && m.to.c === 4)!.captureId).toBe('p1-walk');
  });

  it('is directional and turns around on the far edge', () => {
    expect(isDirectional({ character: 'midos', level: 3 })).toBe(true);
    expect(keepsDirection(CHAR_CODE.midos)).toBe(false);
    const s = applyMove(makeState([[0, 'midos', 1, 8, 4], ...far]), { pieceId: M, from: { r: 8, c: 4 }, to: { r: 9, c: 4 } });
    const p = s.pieces.find((x) => x.id === M)!;
    expect(p.dir).toBe(-1);
    expect(reach({ ...s, turn: 0 })).toEqual(keys([[9, 3], [9, 5], [8, 4]]));
  });

  it('an Insaner that captures him slides his left / right / forward pattern', () => {
    let s = makeState([[0, 'insaner', 1, 4, 2], [1, 'midos', 3, 4, 4], [1, 'walk', 1, 9, 9]]);
    s = applyMove(s, getLegalMoves(s, 'p0-insaner').find((m) => m.to.r === 4 && m.to.c === 4)!);
    const ins = s.pieces.find((p) => p.id === 'p0-insaner')!;
    expect(ins.absorbed).toEqual([{ character: 'midos', level: 3 }]);
    // Own 1성 cross reaches 2; Midos 3성 adds forward 3 and the sides up to 3, never back 3.
    const r = reach({ ...s, turn: 0 }, 'p0-insaner');
    expect(r).toEqual(expect.arrayContaining(['7,4', '4,7', '4,1']));
    expect(r).not.toContain('1,4');
  });
});

describe('미도스 skill 그림자 도약 (teleport)', () => {
  const base = (extra: Partial<GameState> = {}) =>
    makeState([[0, 'midos', 2, 0, 4], [0, 'sad', 1, 0, 0], [1, 'walk', 1, 9, 9], [1, 'marki', 1, 9, 0]], 0, { ply: SKILL_UNLOCK_PLY, ...extra });

  it('targets every free square: no piece, no wasteland, no ENEMY doll trap (own traps are fine)', () => {
    const s = base({ waste: [55], traps: [{ sq: 44, owner: 1 }, { sq: 33, owner: 0 }] });
    const anchors = skillAnchors(s, M).map(sqOf);
    expect(anchors.length).toBe(BOARD_SIZE * BOARD_SIZE - 4 - 1 - 1);
    expect(anchors).not.toContain(4); // himself
    expect(anchors).not.toContain(0); // an ally
    expect(anchors).not.toContain(99); // an enemy
    expect(anchors).not.toContain(55); // wasteland
    expect(anchors).not.toContain(44); // enemy trap
    expect(anchors).toContain(33); // own trap
    expect(blinkAnchors(s, 0).map(sqOf)).toEqual(anchors);
  });

  it('follows the shared skill gates: unlock ply, once per match, never in the storm, not while stunned', () => {
    expect(skillBlock(base({ ply: SKILL_UNLOCK_PLY - 1 }), M)).toBe('notYet');
    expect(skillBlock(spendSkill(base(), M), M)).toBe('used');
    expect(skillBlock(base({ storm: 1, stormIn: 4 }), M)).toBe('storm');
    const st = base();
    expect(skillBlock({ ...st, pieces: st.pieces.map((p) => (p.id === M ? { ...p, stun: 1 } : p)) }, M)).toBe('stunned');
    expect(skillBlock(base(), M)).toBeNull();
  });

  it('moves him (no capture), spends the skill, records from / to and hands the turn over', () => {
    const s = base();
    expect(isLegalSkill(s, blink(M, 9, 0))).toBe(false); // an enemy square
    expect(() => applySkill(s, blink(M, 9, 0))).toThrow();
    const t = applySkill(s, blink(M, 6, 7));
    const p = t.pieces.find((x) => x.id === M)!;
    expect(p.pos).toEqual({ r: 6, c: 7 });
    expect(p.skillUsed).toBe(true);
    expect(p.dir).toBeUndefined();
    expect(t.pieces).toHaveLength(4);
    expect(t.turn).toBe(1);
    expect(t.skillsUsed).toEqual([1, 0]);
    expect(t.history.at(-1)).toEqual({ kind: 'skill', player: 0, pieceId: M, squares: [], blink: { from: 4, to: 67 } });
  });

  it("the board's last-move marker shows the teleport (origin and landing)", () => {
    const t = applySkill(base(), blink(M, 6, 7));
    expect(lastMoveOf(t.history)).toEqual({ from: { r: 0, c: 4 }, to: { r: 6, c: 7 } });
  });

  it('landing on the far edge turns him around like a move', () => {
    const t = applySkill(base(), blink(M, 9, 5));
    expect(t.pieces.find((x) => x.id === M)!.dir).toBe(-1);
    expect(t.history.at(-1)).toMatchObject({ blink: { from: 4, to: 95, turned: true } });
  });

  it('a side whose only action is the teleport is not immobile; once spent it is', () => {
    // Player 0: Midos and a 1성 Marki in the bottom-left corner, both facing off the board (dir -1
    // on row 0): no moves at all. Player 1 moves; then it is player 0's turn.
    const boxed = (used: boolean): GameState => {
      const s = makeState([[0, 'midos', 1, 0, 0], [0, 'marki', 1, 0, 1], [1, 'sad', 1, 9, 9]], 1, { ply: SKILL_UNLOCK_PLY });
      return { ...s, pieces: s.pieces.map((p) => (p.owner === 0 ? { ...p, dir: -1 as const, ...(used && p.id === M ? { skillUsed: true as const } : {}) } : p)) };
    };
    const go = (s: GameState) => applyMove(s, { pieceId: 'p1-sad', from: { r: 9, c: 9 }, to: { r: 9, c: 8 } });
    const free = go(boxed(false));
    expect(free.status).toBe('playing');
    expect(getLegalMoves(free)).toEqual([]);
    expect(skillAnchors(free, M).length).toBeGreaterThan(0);
    const b = fastFromState(free);
    expect(fastImmobile(b)).toBe(false);
    const spent = go(boxed(true));
    expect(spent.status).toBe('ended');
    expect(spent.endReason).toBe('immobile');
    expect(spent.winner).toBe(1);
  });
});

// ---------------------------------------------------------------- FastBoard parity

const SQUADS: CharacterId[][] = [
  ['midos', 'picker', 'insaner'],
  ['midos', 'volkonov', 'michelle'],
  ['midos', 'brutile', 'verish'],
  ['sad', 'midos', 'rakaeli'],
  ['marki', 'walk', 'midos'],
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

describe('FastBoard parity with the engine (Midos)', () => {
  it('moves and teleports make / unmake exactly over random games; fast teleport squares = blinkAnchors', () => {
    const rng = rngFrom(4242);
    const buf = new Int32Array(256);
    let moves = 0;
    let blinks = 0;
    let turned = 0;
    for (let g = 0; g < 50; g++) {
      let s = createGame(randomFormation(rng, randLv(rng), SQUADS[g % SQUADS.length]), randomFormation(rng, randLv(rng), SQUADS[(g + 2) % SQUADS.length]), (g % 2) as 0 | 1);
      for (let ply = 0; ply < 120 && s.status === 'playing'; ply++) {
        const legal = getLegalMoves(s);
        const b = fastFromState(s);
        const n = fastGenMoves(b, b.turn, buf, 0);
        expect(Array.from(buf.subarray(0, n)).map((m) => `${b.ids[(m >> 8) & 255]}>${m & 255}`).sort()).toEqual(legal.map((m) => `${m.pieceId}>${m.to.r * BOARD_SIZE + m.to.c}`).sort());
        const before = fastSig(b);
        expect(before).toBe(sig(s));
        expect(fastImmobile(b)).toBe(false); // the engine never leaves a side to move without an action
        for (let k = 0; k < n; k++) {
          const lm = legal.find((m) => m.pieceId === b.ids[(buf[k] >> 8) & 255] && m.to.r * BOARD_SIZE + m.to.c === (buf[k] & 255))!;
          const eng = applyMove(s, lm);
          const undo = fastMake(b, buf[k]);
          if (eng.status === 'playing' && eng.history.length === s.history.length + 1) expect(fastSig(b)).toBe(sig(eng));
          fastUnmake(b, buf[k], undo);
          expect(fastSig(b)).toBe(before);
          moves++;
        }
        // Every teleport square of every Midos that may cast, on both engines.
        const skillActions: SkillAction[] = [];
        for (let i = 0; i < b.n; i++) {
          if (b.ch[i] !== CHAR_CODE.midos || !fastCanSkill(b, i)) {
            if (b.ch[i] === CHAR_CODE.midos && b.sq[i] >= 0 && b.owner[i] === b.turn) expect(skillAnchors(s, b.ids[i])).toEqual([]);
            continue;
          }
          const fast: number[] = [];
          for (let t = 0; t < BOARD_SIZE * BOARD_SIZE; t++) if (fastBlinkFits(b, b.owner[i], t)) fast.push(t);
          expect(fast).toEqual(skillAnchors(s, b.ids[i]).map(sqOf));
          for (const t of fast) {
            const mv = SKILL_FLAG | (i << 8) | t;
            const action = blink(b.ids[i], (t / BOARD_SIZE) | 0, t % BOARD_SIZE);
            skillActions.push(action);
            const eng = applySkill(s, action);
            const undo = fastMake(b, mv);
            if (eng.status === 'playing') expect(fastSig(b)).toBe(sig(eng));
            const e = eng.history[s.history.length];
            if (e.kind === 'skill' && e.blink?.turned) turned++;
            fastUnmake(b, mv, undo);
            expect(fastSig(b)).toBe(before);
            blinks++;
          }
        }
        if (!legal.length && !skillActions.length) break;
        // Mostly moves; now and then a random teleport so the games visit post-teleport positions.
        if (skillActions.length && rng() < 0.08) s = applySkill(s, skillActions[Math.floor(rng() * skillActions.length)]);
        else if (legal.length) s = applyMove(s, legal[Math.floor(rng() * legal.length)]);
        else s = applySkill(s, skillActions[0]);
      }
    }
    expect(moves).toBeGreaterThan(5000);
    expect(blinks).toBeGreaterThan(5000);
    expect(turned).toBeGreaterThan(20);
  }, 180_000);
});

describe('bot with Midos', () => {
  it('teleports into a fork the search can cash in', () => {
    // Midos 3성 at the bottom-left; two loose enemies on row 6 with (6,4) between them, 2 apart each.
    const s = makeState([[0, 'midos', 3, 0, 0], [0, 'sad', 1, 0, 9], [1, 'walk', 1, 6, 2], [1, 'rampid', 1, 6, 6], [1, 'volkonov', 1, 9, 5]], 0, { ply: 20 });
    let forks = 0;
    for (const seed of [1, 2, 3]) {
      const a = chooseAction(s, 'hard', { timeBudgetMs: 400, rng: rngFrom(seed) });
      if (isSkillAction(a)) {
        const t = applySkill(s, a);
        const hits = getTargetsForPiece({ ...t, turn: 0 }, t.pieces.find((p) => p.id === M)!).filter((m) => m.captureId).length;
        if (hits >= 2) forks++;
      }
    }
    expect(forks).toBeGreaterThanOrEqual(2);
  });

  it('lands its teleports where no enemy can take him next turn (random openings, hard bot)', () => {
    const rng = rngFrom(9);
    let casts = 0;
    for (let i = 0; i < 10; i++) {
      const s = createGame(randomFormation(rng, randLv(rng), ['midos', 'sad', 'marki']), randomFormation(rng, randLv(rng), ['walk', 'sad', 'marki']), 0);
      const quiet = { ...s, ply: SKILL_UNLOCK_PLY };
      const a = chooseAction(quiet, 'hard', { timeBudgetMs: 150, rng });
      if (!isSkillAction(a)) continue;
      casts++;
      const t = applySkill(quiet, a);
      expect(getLegalMoves(t).some((m) => m.captureId === M), JSON.stringify(a)).toBe(false);
    }
    // Random openings often leave a loose enemy to fork: the teleport is a real weapon.
    expect(casts).toBeGreaterThan(0);
  });

  it('plays legal games with Midos on both sides to termination', () => {
    const rng = rngFrom(77);
    let cast = 0;
    for (let i = 0; i < 15; i++) {
      let g = createGame(randomFormation(rng, randLv(rng), SQUADS[i % SQUADS.length]), randomFormation(rng, randLv(rng), SQUADS[(i + 1) % SQUADS.length]), (i % 2) as 0 | 1);
      let guard = 0;
      while (g.status === 'playing') {
        expect(++guard).toBeLessThan(400);
        const a = chooseAction(g, i % 2 ? 'normal' : 'easy', { timeBudgetMs: 5, rng });
        expect(a).not.toBeNull();
        if (isSkillAction(a)) {
          expect(isLegalSkill(g, a)).toBe(true);
          if (g.pieces.find((p) => p.id === a.pieceId)?.character === 'midos') cast++;
          g = applySkill(g, a);
        } else {
          expect(isLegalMove(g, a as Move)).toBe(true);
          g = applyMove(g, a as Move);
        }
      }
      expect(g.ply - chainPlies(g.history)).toBeLessThanOrEqual(MAX_MATCH_PLIES);
    }
    expect(cast).toBeGreaterThan(0);
  }, 120_000);
});
