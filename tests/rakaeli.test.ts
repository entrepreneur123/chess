/**
 * Rakaeli (라카엘리): base and transformed ("타천") jump patterns, the transform skill (awaken
 * countdown, per-piece skill use, gates), Insaner absorbing him, the FastBoard / bot parity, the
 * hand card model, the controller's transform events and profile loading.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction, isSkillAction } from '../src/ai/bot';
import {
  AWAKEN_TURNS,
  BOARD_SIZE,
  CHARACTERS,
  SKILL_UNLOCK_PLY,
  applyMove,
  applySkill,
  createGame,
  fastFromState,
  fastGenMoves,
  fastMake,
  fastMoveToMove,
  fastUnmake,
  getLegalMoves,
  getTargetsForPiece,
  isAwake,
  isLegalMove,
  isLegalSkill,
  randomFormation,
  skillAnchors,
  skillBlock,
  type CharacterId,
  type GameState,
  type Level,
  type Move,
  type Piece,
  type SkillAction,
} from '../src/engine';
import { SKILL_FLAG, fastCanSkill } from '../src/engine/fast';
import { CHAR_BY_CODE, keepsDirection } from '../src/engine/characters';
import { forwardDir } from '../src/engine/board';
import { PROFILE_VERSION, sanitizeProfile } from '../src/meta/profile';
import { GameController, type ControllerEvent, type ControllerPorts } from '../src/ui/game/GameController';
import { handModel, skillReadiness } from '../src/ui/game/hand';
import { movementSpan } from '../src/ui/components/piece';
import { chainPlies, keys, makeState, rngFrom, targetKeys } from './helpers';
import { MAX_MATCH_PLIES, STORM_ROWS_FROM } from '../src/engine';

const R = 'p0-rakaeli';
const reach = (s: GameState, id = R) => targetKeys(getTargetsForPiece(s, s.pieces.find((p) => p.id === id)!));
const withPiece = (s: GameState, id: string, patch: Partial<Piece>): GameState => ({ ...s, pieces: s.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
const transform = (s: GameState, id = R): GameState => {
  const p = s.pieces.find((x) => x.id === id)!;
  return applySkill(s, { kind: 'skill', pieceId: id, anchor: { ...p.pos } });
};
const play = (s: GameState, id: string, r: number, c: number): GameState => {
  const m = getLegalMoves(s, id).find((x) => x.to.r === r && x.to.c === c);
  if (!m) throw new Error(`no legal move ${id} -> ${r},${c}: ${targetKeys(getLegalMoves(s, id)).join(' ')}`);
  return applyMove(s, m);
};
/** A row x column block of squares, plus extras. */
const block = (rows: number[], c0: number, c1: number, extra: [number, number][] = []): string[] => {
  const out: [number, number][] = [...extra];
  for (const r of rows) for (let c = c0; c <= c1; c++) out.push([r, c]);
  return keys(out);
};

// ---------------------------------------------------------------- movement

describe('Rakaeli movement', () => {
  const at = (owner: 0 | 1, level: Level, r: number, c: number, awaken = 0) => {
    const s = makeState([[owner, 'rakaeli', level, r, c], [owner === 0 ? 1 : 0, 'sad', 1, owner === 0 ? 9 : 0, 0]], owner);
    return awaken ? withPiece(s, `p${owner}-rakaeli`, { awaken }) : s;
  };

  it('base form, player 0 (forward = +r): 1성 front 3, 2성 2 x 3 block, 3성 adds 1 straight back', () => {
    expect(reach(at(0, 1, 4, 5))).toEqual(block([5], 4, 6));
    expect(reach(at(0, 2, 4, 5))).toEqual(block([5, 6], 4, 6));
    expect(reach(at(0, 3, 4, 5))).toEqual(block([5, 6], 4, 6, [[3, 5]]));
  });

  it('transformed, player 0: 1성 front 5 (Walk 1성), 2성 2 x 5, 3성 3 x 5 + 1 back', () => {
    expect(reach(at(0, 1, 4, 5, 2))).toEqual(block([5], 3, 7));
    expect(reach(at(0, 2, 4, 5, 2))).toEqual(block([5, 6], 3, 7));
    expect(reach(at(0, 3, 4, 5, 2))).toEqual(block([5, 6, 7], 3, 7, [[3, 5]]));
    expect(getTargetsForPiece(at(0, 3, 4, 5, 1), at(0, 3, 4, 5, 1).pieces[0])).toHaveLength(16);
  });

  it('player 1 (forward = -r), both forms', () => {
    const id = 'p1-rakaeli';
    expect(reach(at(1, 1, 5, 4), id)).toEqual(block([4], 3, 5));
    expect(reach(at(1, 2, 5, 4), id)).toEqual(block([4, 3], 3, 5));
    expect(reach(at(1, 3, 5, 4), id)).toEqual(block([4, 3], 3, 5, [[6, 4]]));
    expect(reach(at(1, 1, 5, 4, 2), id)).toEqual(block([4], 2, 6));
    expect(reach(at(1, 2, 5, 4, 2), id)).toEqual(block([4, 3], 2, 6));
    expect(reach(at(1, 3, 5, 4, 2), id)).toEqual(block([4, 3, 2], 2, 6, [[6, 4]]));
  });

  it('jumps over pieces, captures on landing, never lands on his own piece', () => {
    const s = makeState([[0, 'rakaeli', 2, 4, 5], [0, 'sad', 1, 5, 5], [1, 'walk', 1, 6, 5], [1, 'sad', 1, 9, 0]]);
    const moves = getLegalMoves(s, R);
    expect(targetKeys(moves)).toEqual(block([5, 6], 4, 6).filter((k) => k !== '5,5'));
    expect(moves.find((m) => m.to.r === 6 && m.to.c === 5)?.captureId).toBe('p1-walk');
    const after = play(s, R, 6, 5);
    expect(after.pieces.map((p) => p.id)).not.toContain('p1-walk');
  });

  it('clips at the board edge and skips storm columns', () => {
    expect(reach(at(0, 1, 4, 0, 2))).toEqual(block([5], 0, 2));
    // Storm 1: columns 0 and 9 are gone.
    const s = { ...at(0, 1, 4, 1, 2), storm: 1, stormIn: 6 };
    expect(reach(s)).toEqual(block([5], 1, 3));
  });

  it('is a forward mover: turns around at the far edge (both forms)', () => {
    expect(keepsDirection(7)).toBe(false);
    // 2성 one row from the far edge: only the last row is left ahead.
    let s = makeState([[0, 'rakaeli', 2, 8, 5], [1, 'sad', 1, 0, 0]]);
    expect(reach(s)).toEqual(block([9], 4, 6));
    s = play(s, R, 9, 4);
    const r = s.pieces.find((p) => p.id === R)!;
    expect(r.dir).toBe(-1);
    expect(reach({ ...s, turn: 0 })).toEqual(block([8, 7], 3, 5));
    // Transformed 3성 near the edge: rows past the edge are skipped, the back square stays.
    const t = withPiece(makeState([[0, 'rakaeli', 3, 7, 5], [1, 'sad', 1, 0, 0]]), R, { awaken: 2 });
    expect(reach(t)).toEqual(block([8, 9], 3, 7, [[6, 5]]));
    const landed = play(t, R, 9, 7);
    expect(landed.pieces.find((p) => p.id === R)!.dir).toBe(-1);
    // Player 1 turns around at row 0.
    const u = play(makeState([[1, 'rakaeli', 1, 1, 5], [0, 'sad', 1, 9, 9]], 1), 'p1-rakaeli', 0, 6);
    expect(u.pieces.find((p) => p.id === 'p1-rakaeli')!.dir).toBe(1);
  });

  it('wasteland and doll traps act on the landing square, like Walk', () => {
    const s = makeState([[0, 'rakaeli', 1, 4, 5], [0, 'sad', 1, 0, 0], [1, 'sad', 1, 9, 0]], 0, { waste: [5 * BOARD_SIZE + 4] });
    const died = play(s, R, 5, 4);
    expect(died.pieces.map((p) => p.id)).not.toContain(R);
    const t = makeState([[0, 'rakaeli', 1, 4, 5], [0, 'sad', 1, 0, 0], [1, 'sad', 1, 9, 0]], 0, { traps: [{ sq: 5 * BOARD_SIZE + 6, owner: 1 }] });
    const caught = play(t, R, 5, 6);
    expect(caught.pieces.find((p) => p.id === R)!.stun).toBe(1);
  });

  it('the movement diagram spans both forms', () => {
    expect(movementSpan('rakaeli', 1)).toEqual({ rows: 2, cols: 3 });
    expect(movementSpan('rakaeli', 3)).toEqual({ rows: 4, cols: 3 });
    expect(movementSpan('rakaeli', 1, true)).toEqual({ rows: 2, cols: 5 });
    expect(movementSpan('rakaeli', 3, true)).toEqual({ rows: 5, cols: 5 });
  });
});

// ---------------------------------------------------------------- the transform

/** Player 0: Rakaeli 1성 (2,5) and a sad far away; player 1: two pieces on its back rank. */
const duel = (extra: Partial<GameState> = {}) =>
  makeState([[0, 'rakaeli', 1, 2, 5], [0, 'sad', 1, 0, 0], [1, 'sad', 1, 9, 0], [1, 'marki', 1, 9, 9]], 0, { ply: SKILL_UNLOCK_PLY, ...extra });

describe('Rakaeli skill: 타천', () => {
  it('is the action of the turn: awaken = 3 counted down to 2 at once, a transform history entry, anchor = own square', () => {
    const s = duel();
    expect(skillAnchors(s, R)).toEqual([{ r: 2, c: 5 }]);
    expect(isLegalSkill(s, { kind: 'skill', pieceId: R, anchor: { r: 3, c: 5 } })).toBe(false);
    const after = transform(s);
    expect(after.turn).toBe(1);
    const r = after.pieces.find((p) => p.id === R)!;
    expect(r.awaken).toBe(AWAKEN_TURNS - 1);
    expect(r.skillUsed).toBe(true);
    expect(after.skillsUsed).toEqual([1, 0]);
    expect(after.waste).toEqual([]);
    expect(after.history[after.history.length - 1]).toEqual({ kind: 'skill', player: 0, pieceId: R, squares: [], transform: true });
    // The opponent's reach preview of him already shows the transformed pattern.
    expect(reach(after)).toEqual(block([3], 3, 7));
  });

  it('gives exactly 2 transformed moves, then he moves with his base pattern again', () => {
    let s = transform(duel());
    let transformedMoves = 0;
    const path: [number, number][] = [[3, 3], [4, 1], [5, 2]];
    for (const [r, c] of path) {
      s = play(s, 'p1-sad', s.pieces.find((p) => p.id === 'p1-sad')!.pos.r === 9 ? 8 : 9, 0);
      const before = s.pieces.find((p) => p.id === R)!;
      if (isAwake(before)) transformedMoves++;
      s = play(s, R, r, c);
    }
    expect(transformedMoves).toBe(2);
    const r = s.pieces.find((p) => p.id === R)!;
    expect(r.awaken).toBeUndefined();
    expect(reach({ ...s, turn: 0 })).toEqual(block([6], 1, 3));
  });

  it('a stun during the transform costs a transformed move (the countdown does not pause)', () => {
    let s = transform(duel({ traps: [{ sq: 3 * BOARD_SIZE + 3, owner: 1 }] }));
    s = play(s, 'p1-sad', 8, 0);
    s = play(s, R, 3, 3); // first transformed move ends on the enemy trap
    let r = s.pieces.find((p) => p.id === R)!;
    expect([r.stun, r.awaken]).toEqual([1, 1]);
    s = play(s, 'p1-sad', 9, 0);
    // Stunned: his owner's turn goes to the sad instead; when it ends the transform ends too.
    expect(getLegalMoves(s, R)).toEqual([]);
    s = play(s, 'p0-sad', 1, 0);
    r = s.pieces.find((p) => p.id === R)!;
    expect(r.stun).toBeUndefined();
    expect(r.awaken).toBeUndefined();
  });

  it('the storm forbids the cast but does not end a transform in progress', () => {
    expect(skillBlock(duel({ storm: 1, stormIn: 6 }), R)).toBe('storm');
    expect(skillBlock(duel({ stormIn: 3 }), R)).toBeNull(); // active but not shrinking yet
    // A transformed Rakaeli keeps his form through a storm advance (nobody stands in columns 0 / 9).
    const s0 = makeState([[0, 'rakaeli', 1, 2, 5], [0, 'sad', 1, 0, 4], [1, 'sad', 1, 9, 4], [1, 'marki', 1, 9, 6]], 0, { ply: 30, stormIn: 1 });
    const s = withPiece(s0, R, { awaken: 2, skillUsed: true });
    const after = play(s, 'p0-sad', 1, 4);
    expect(after.storm).toBe(1);
    expect(after.pieces.find((p) => p.id === R)!.awaken).toBe(1);
  });

  it('the other gates: not before the unlock, on the opponent turn, during a chain move, stunned, transformed or used', () => {
    expect(skillBlock(duel({ ply: SKILL_UNLOCK_PLY - 1 }), R)).toBe('notYet');
    expect(skillBlock(duel({ turn: 1 }), R)).toBe('notYourTurn');
    expect(skillBlock(duel({ bonusPieceId: 'p0-sad' }), R)).toBe('chain');
    expect(skillBlock(withPiece(duel(), R, { stun: 1 }), R)).toBe('stunned');
    const cast = { ...transform(duel()), turn: 0 as const };
    expect(skillBlock(cast, R)).toBe('active');
    expect(() => applySkill(cast, { kind: 'skill', pieceId: R, anchor: { r: 2, c: 5 } })).toThrow();
    expect(skillBlock(withPiece(duel(), R, { skillUsed: true }), R)).toBe('used');
  });

  it('skills are per piece: Brutile and Rakaeli in one squad each cast once', () => {
    let s = makeState([[0, 'rakaeli', 2, 2, 5], [0, 'brutile', 1, 0, 3], [0, 'sad', 1, 0, 0], [1, 'sad', 1, 9, 0], [1, 'marki', 1, 9, 9]], 0, { ply: SKILL_UNLOCK_PLY });
    s = transform(s);
    s = play(s, 'p1-sad', 8, 0);
    expect(skillBlock(s, 'p0-brutile')).toBeNull();
    s = applySkill(s, { kind: 'skill', pieceId: 'p0-brutile', anchor: { r: 5, c: 5 } });
    expect(s.skillsUsed).toEqual([2, 0]);
    expect(s.waste).toEqual([55]);
    s = play(s, 'p1-sad', 9, 0);
    expect(skillBlock(s, 'p0-brutile')).toBe('used');
    expect(skillBlock(s, R)).toBe('active');
    // The bot sees the same per-piece state.
    const b = fastFromState(s);
    expect(fastCanSkill(b, b.ids.indexOf('p0-brutile'))).toBe(false);
    expect(fastCanSkill(b, b.ids.indexOf(R))).toBe(false);
  });

  it('a boxed-in, untransformed Rakaeli with the skill unused is not passed: casting is the turn', () => {
    // Blue's only piece faces off the board (dir +1 on the last row): no move at all.
    const boxed = (patch: Partial<Piece> = {}) =>
      withPiece(makeState([[0, 'rakaeli', 1, 9, 5], [1, 'sad', 1, 4, 0], [1, 'walk', 1, 6, 9]], 1, { ply: 20 }), R, { dir: 1, ...patch });
    const s = boxed();
    expect(getLegalMoves({ ...s, turn: 0 }, R)).toHaveLength(0);
    const after = play(s, 'p1-sad', 4, 1);
    expect(after.turn).toBe(0);
    const a = chooseAction(after, 'normal', { timeBudgetMs: 20, rng: rngFrom(1) });
    expect(isSkillAction(a) && a.pieceId === R).toBe(true);
    const spent = play(boxed({ skillUsed: true }), 'p1-sad', 4, 1);
    expect(spent.turn).toBe(1);
    expect(spent.history.some((e) => e.kind === 'pass' && e.reason === 'noMoves')).toBe(true);
  });
});

// ---------------------------------------------------------------- Insaner

describe('Insaner absorbs Rakaeli', () => {
  it('takes the BASE pattern at his grade, even from a transformed Rakaeli', () => {
    const s0 = makeState([[0, 'insaner', 1, 5, 5], [0, 'sad', 1, 0, 0], [1, 'rakaeli', 2, 5, 7], [1, 'sad', 1, 9, 0]]);
    const s = withPiece(s0, 'p1-rakaeli', { awaken: 2, skillUsed: true });
    const after = play(s, 'p0-insaner', 5, 7);
    const ins = after.pieces.find((p) => p.id === 'p0-insaner')!;
    expect(ins.absorbed).toEqual([{ character: 'rakaeli', level: 2 }]);
    expect(ins.awaken).toBeUndefined();
    const t = reach({ ...after, turn: 0 }, 'p0-insaner');
    // Base Rakaeli 2성 (forward = +r for player 0): rows 6, 7 x columns 6..8.
    for (const k of ['6,6', '6,8', '7,6', '7,8']) expect(t).toContain(k);
    // Never the transformed width.
    for (const k of ['6,5', '6,9', '7,9']) expect(t).not.toContain(k);
    // The fast board agrees.
    const b = fastFromState({ ...after, turn: 0 });
    const buf = new Int32Array(256);
    const n = fastGenMoves(b, 0, buf, 0);
    const fastKeys = Array.from(buf.subarray(0, n)).filter((m) => b.ids[(m >> 8) & 255] === 'p0-insaner').map((m) => `${((m & 255) / BOARD_SIZE) | 0},${(m & 255) % BOARD_SIZE}`).sort();
    expect(fastKeys).toEqual(t);
  });
});

// ---------------------------------------------------------------- FastBoard parity

const SQUADS: CharacterId[][] = [
  ['rakaeli', 'brutile', 'sad'],
  ['rakaeli', 'insaner', 'michelle'],
  ['walk', 'rakaeli', 'picker'],
  ['rakaeli', 'marki', 'brutile'],
  ['insaner', 'sad', 'rakaeli'],
];
const randLv = (rng: () => number): Partial<Record<CharacterId, Level>> => {
  const l = () => (1 + Math.floor(rng() * 3)) as Level;
  return Object.fromEntries((Object.keys(CHARACTERS) as CharacterId[]).map((id) => [id, l()]));
};
const directional = (ch: CharacterId) => !keepsDirection(CHAR_BY_CODE.indexOf(ch));
const sig = (s: GameState) =>
  JSON.stringify({
    pieces: [...s.pieces]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => [
        p.id,
        p.pos.r,
        p.pos.c,
        directional(p.character) ? (p.dir ?? forwardDir(p.owner)) : 0,
        p.stun ?? 0,
        p.awaken ?? 0,
        p.skillUsed ? 1 : 0,
        (p.absorbed ?? []).map((a) => a.character + a.level).sort().join(),
      ]),
    turn: s.turn,
    waste: s.waste,
    skills: s.skillsUsed,
  });
function fastSig(b: ReturnType<typeof fastFromState>): string {
  const pieces: (string | number)[][] = [];
  for (let i = 0; i < b.n; i++) {
    if (b.sq[i] < 0) continue;
    const abs: string[] = [];
    for (let bit = 0; bit < CHAR_BY_CODE.length * 3; bit++) if (b.absorb[i] & (1 << bit)) abs.push(CHAR_BY_CODE[(bit / 3) | 0] + ((bit % 3) + 1));
    pieces.push([b.ids[i], (b.sq[i] / BOARD_SIZE) | 0, b.sq[i] % BOARD_SIZE, keepsDirection(b.ch[i]) ? 0 : b.dir[i], b.stun[i], b.awaken[i], b.used[i], abs.sort().join()]);
  }
  pieces.sort((a, c) => String(a[0]).localeCompare(String(c[0])));
  const waste: number[] = [];
  for (let s = 0; s < BOARD_SIZE * BOARD_SIZE; s++) if (b.waste[s]) waste.push(s);
  return JSON.stringify({ pieces, turn: b.turn, waste, skills: [b.skills[0], b.skills[1]] });
}

describe('FastBoard parity with the engine (Rakaeli)', () => {
  it('moves, transforms, countdowns and per-piece skills make / unmake exactly, over random games', () => {
    const rng = rngFrom(2026);
    const buf = new Int32Array(256);
    let checked = 0;
    let casts = 0;
    let awakeMoves = 0;
    let reverts = 0;
    let rowStorm = 0;
    for (let g = 0; g < 50; g++) {
      let s = createGame(randomFormation(rng, randLv(rng), SQUADS[g % SQUADS.length]), randomFormation(rng, randLv(rng), SQUADS[(g + 2) % SQUADS.length]), (g % 2) as 0 | 1);
      for (let ply = 0; ply < 120 && s.status === 'playing'; ply++) {
        const legal = getLegalMoves(s);
        const b = fastFromState(s);
        const n = fastGenMoves(b, b.turn, buf, 0);
        expect(Array.from(buf.subarray(0, n)).map((m) => `${b.ids[(m >> 8) & 255]}>${m & 255}`).sort()).toEqual(legal.map((m) => `${m.pieceId}>${m.to.r * BOARD_SIZE + m.to.c}`).sort());
        const before = fastSig(b);
        expect(before).toBe(sig(s));
        if (s.storm >= STORM_ROWS_FROM) rowStorm++; // storm rows are on the board
        for (let k = 0; k < n; k++) {
          const eng = applyMove(s, fastMoveToMove(b, buf[k]));
          const undo = fastMake(b, buf[k]);
          if (eng.status === 'playing' && eng.history.length === s.history.length + 1) expect(fastSig(b)).toBe(sig(eng));
          fastUnmake(b, buf[k], undo);
          expect(fastSig(b)).toBe(before);
          checked++;
        }
        // Every skill piece of the side to move: the fast gate matches the engine, and a cast matches.
        const skillers = s.pieces.filter((p) => p.owner === s.turn && CHARACTERS[p.character].skill);
        let cast: SkillAction | null = null;
        for (const p of skillers) {
          const i = b.ids.indexOf(p.id);
          const ok = skillBlock(s, p.id) === null;
          expect(fastCanSkill(b, i), p.id).toBe(ok);
          if (!ok) continue;
          const anchors = skillAnchors(s, p.id);
          const a = anchors[Math.floor(rng() * anchors.length)];
          const action: SkillAction = { kind: 'skill', pieceId: p.id, anchor: a };
          const mv = SKILL_FLAG | (i << 8) | (a.r * BOARD_SIZE + a.c);
          const eng = applySkill(s, action);
          const u = fastMake(b, mv);
          if (eng.status === 'playing' && eng.history.length === s.history.length + 1) expect(fastSig(b)).toBe(sig(eng));
          fastUnmake(b, mv, u);
          expect(fastSig(b)).toBe(before);
          if (p.character === 'rakaeli' && rng() < 0.6) cast = action;
        }
        const wasAwake = s.pieces.filter((p) => p.awaken).map((p) => p.id);
        if (cast) {
          s = applySkill(s, cast);
          casts++;
        } else if (legal.length) {
          const m = legal[Math.floor(rng() * legal.length)];
          if (wasAwake.includes(m.pieceId)) awakeMoves++;
          s = applyMove(s, m);
        } else break;
        for (const id of wasAwake) if (s.pieces.find((p) => p.id === id && !p.awaken)) reverts++;
      }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(casts).toBeGreaterThan(10);
    expect(awakeMoves).toBeGreaterThan(5);
    expect(reverts).toBeGreaterThan(5);
    // Positions where the storm is at (or about to reach) its row steps were checked too.
    expect(rowStorm).toBeGreaterThan(20);
  }, 120_000);
});

// ---------------------------------------------------------------- bot

describe('bot with Rakaeli', () => {
  it('casts the transform when it forks two pieces the base form cannot reach', () => {
    // Base 1성 from (3,5) reaches row 4 columns 4..6; transformed, columns 3..7: the michelle on
    // (4,3) and the sad on (4,7) are both hit, and only one can step away.
    const s = makeState([[0, 'rakaeli', 1, 3, 5], [0, 'sad', 1, 0, 0], [1, 'michelle', 1, 4, 3], [1, 'sad', 1, 4, 7], [1, 'marki', 1, 9, 9]], 0, { ply: 20 });
    for (const seed of [1, 2, 3]) {
      const a = chooseAction(s, 'hard', { timeBudgetMs: 300, rng: rngFrom(seed) });
      expect(isSkillAction(a) && a.pieceId === R, `seed ${seed}`).toBe(true);
    }
  });

  it('does not waste the transform with no enemy in reach of his two transformed moves', () => {
    const s = makeState([[0, 'rakaeli', 2, 0, 5], [0, 'sad', 1, 0, 0], [1, 'sad', 1, 9, 0], [1, 'marki', 1, 9, 9]], 0, { ply: 20 });
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 4; seed++) expect(isSkillAction(chooseAction(s, d, { timeBudgetMs: 40, rng: rngFrom(seed) })), `${d} ${seed}`).toBe(false);
    }
  });

  it('plays legal games with Rakaeli on both sides to termination, transforming along the way', () => {
    const rng = rngFrom(99);
    let transforms = 0;
    for (let i = 0; i < 20; i++) {
      let g = createGame(randomFormation(rng, randLv(rng), SQUADS[i % SQUADS.length]), randomFormation(rng, randLv(rng), SQUADS[(i + 1) % SQUADS.length]), (i % 2) as 0 | 1);
      let guard = 0;
      while (g.status === 'playing') {
        expect(++guard).toBeLessThan(400);
        const a = chooseAction(g, i % 2 ? 'normal' : 'easy', { timeBudgetMs: 4, rng });
        expect(a).not.toBeNull();
        if (isSkillAction(a)) {
          expect(isLegalSkill(g, a)).toBe(true);
          const after = applySkill(g, a);
          if (after.history[g.history.length]?.kind === 'skill' && (after.history[g.history.length] as { transform?: true }).transform) transforms++;
          g = after;
        } else {
          expect(isLegalMove(g, a as Move)).toBe(true);
          g = applyMove(g, a as Move);
        }
      }
      expect(g.ply - chainPlies(g.history)).toBeLessThanOrEqual(MAX_MATCH_PLIES);
    }
    expect(transforms).toBeGreaterThan(0);
  }, 120_000);

  it('the worker answers with a legal action for a structured-cloned transformed state', async () => {
    const posted: unknown[] = [];
    const g = globalThis as unknown as { self?: unknown };
    const prevSelf = g.self;
    const fake: { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void } = { onmessage: null, postMessage: (m) => posted.push(m) };
    g.self = fake;
    try {
      await import('../src/ai/bot.worker');
      const state = withPiece(makeState([[1, 'rakaeli', 2, 6, 5], [1, 'sad', 1, 9, 0], [0, 'sad', 1, 4, 3], [0, 'walk', 1, 0, 9]], 1, { ply: 20 }), 'p1-rakaeli', { awaken: 2, skillUsed: true });
      fake.onmessage!({ data: structuredClone({ id: 9, state, difficulty: 'hard' }) } as MessageEvent);
      const reply = posted[0] as { id: number; move: Move | null };
      expect(reply.id).toBe(9);
      expect(reply.move && isLegalMove(state, reply.move)).toBe(true);
      // The transformed reach reaches the sad on (4,3); the base 2 x 3 block from (6,5) does not.
      expect(reply.move!.captureId).toBe('p0-sad');
    } finally {
      g.self = prevSelf;
    }
  });
});

// ---------------------------------------------------------------- UI models

describe('hand card and controller', () => {
  const slots = [
    { character: 'rakaeli' as const, level: 2 as const, row: 1, col: 5 },
    { character: 'sad' as const, level: 1 as const, row: 0, col: 0 },
  ];

  it('the hand card shows "타천 · N" while transformed and the per-piece skill state otherwise', () => {
    const s = duel();
    expect(skillReadiness(s, R)).toMatchObject({ state: 'ready' });
    const cast = transform(s);
    expect(skillReadiness(cast, R)).toEqual({ state: 'active', label: '타천 · 2' });
    const [card] = handModel(slots, 0, { state: cast, selection: null });
    expect(card.awaken).toBe(2);
    expect(skillReadiness(withPiece(s, R, { skillUsed: true }), R)).toMatchObject({ state: 'used' });
  });

  it('emits a transform event on the cast and a revert event when the last transformed turn ends', async () => {
    const quiet = (st: GameState): Move => {
      const sad = st.pieces.find((p) => p.id === 'p1-sad')!;
      return getLegalMoves(st, 'p1-sad').find((m) => m.to.c === 0 && m.to.r === (sad.pos.r === 9 ? 8 : 9))!;
    };
    const ports: ControllerPorts = {
      requestBotMove: (st) => Promise.resolve(quiet(st)),
      animate: () => Promise.resolve(),
      animateSkill: () => Promise.resolve(),
      botThinkDelayMs: () => 0,
      turnTimeMs: 60_000,
      // The turn clock never runs out here (no timer fires).
      setTimer: () => 0,
      clearTimer: () => {},
    };
    const flush = async () => {
      for (let i = 0; i < 200; i++) await Promise.resolve();
    };
    const ctrl = new GameController(duel(), ports);
    const events: ControllerEvent[] = [];
    ctrl.on((e) => {
      if (e.type === 'awaken') events.push(e);
    });
    ctrl.start();
    expect(ctrl.trySkill({ kind: 'skill', pieceId: R, anchor: { r: 2, c: 5 } })).toBe(true);
    await flush();
    expect(events).toEqual([{ type: 'awaken', phase: 'on', player: 0, pieceId: R }]);
    expect(ctrl.phase).toBe('humanTurn');
    expect(ctrl.tryHumanMove(getLegalMoves(ctrl.state, R).find((m) => m.to.r === 3 && m.to.c === 3)!)).toBe(true);
    await flush();
    expect(events).toHaveLength(1);
    expect(ctrl.tryHumanMove(getLegalMoves(ctrl.state, R).find((m) => m.to.r === 4 && m.to.c === 1)!)).toBe(true);
    await flush();
    expect(events[1]).toEqual({ type: 'awaken', phase: 'off', player: 0, pieceId: R });
    ctrl.dispose();
  });
});

// ---------------------------------------------------------------- profile

describe('profile', () => {
  it('a v5 profile saved before Rakaeli loads with owned.rakaeli = 0 and nothing else reset', () => {
    const v5 = {
      version: 5,
      owned: { sad: 3, marki: 2, walk: 1, insaner: 2, brutile: 1, michelle: 1, picker: 3 },
      grades: { sad: 2, marki: 2, walk: 1, insaner: 2, brutile: 1, michelle: 1, picker: 3 },
      formation: [
        { character: 'picker', level: 3, row: 0, col: 6 },
        { character: 'sad', level: 2, row: 1, col: 6 },
        { character: 'insaner', level: 2, row: 0, col: 5 },
      ],
      formationSaved: true,
      tokens: 77,
      essence: 140,
      rating: 2105,
      bestRating: 2150,
      stats: { wins: 40, losses: 12, draws: 3 },
      onboarding: { tutorialSeen: true, firstMoveDone: true, trapTip: true, stunTip: true },
    };
    const p = sanitizeProfile(v5);
    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.owned).toEqual({ ...v5.owned, rakaeli: 0 });
    expect(p.grades).toEqual({ ...v5.grades, rakaeli: 1 });
    expect(p.formation).toEqual(v5.formation);
    expect(p.formationSaved).toBe(true);
    expect([p.tokens, p.essence, p.rating, p.bestRating]).toEqual([77, 140, 2105, 2150]);
    expect(p.stats).toEqual(v5.stats);
    expect(p.onboarding).toMatchObject({ tutorialSeen: true, firstMoveDone: true, trapTip: true, stunTip: true });
  });
});
