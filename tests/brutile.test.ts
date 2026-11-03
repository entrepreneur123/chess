import { describe, expect, it } from 'vitest';
import {
  SKILL_UNLOCK_PLY,
  applyMove,
  applySkill,
  createGame,
  getLegalMoves,
  getTargetsForPiece,
  isLegalSkill,
  randomFormation,
  skillAnchors,
  skillBlock,
  wasteArea,
  type GameState,
  type SkillAction,
} from '../src/engine';
import { fastFromState, fastGenMoves, fastMake, fastMoveToMove, fastUnmake, SKILL_FLAG, fastCanSkill } from '../src/engine/fast';
import { chooseAction, isSkillAction } from '../src/ai/bot';
import { keys, makeState, rngFrom, targetKeys } from './helpers';

const sk = (pieceId: string, r: number, c: number): SkillAction => ({ kind: 'skill', pieceId, anchor: { r, c } });

describe('Brutile movement', () => {
  it('1-star: the two forward diagonals', () => {
    const s = makeState([
      [0, 'brutile', 1, 5, 5],
      [1, 'sad', 1, 11, 11],
    ]);
    expect(targetKeys(getLegalMoves(s, 'p0-brutile'))).toEqual(keys([[6, 4], [6, 6]]));
    // Red moves down the board: its forward diagonals are one row lower.
    const r = makeState([
      [1, 'brutile', 1, 5, 5],
      [0, 'sad', 1, 0, 0],
    ], 1);
    expect(targetKeys(getLegalMoves(r, 'p1-brutile'))).toEqual(keys([[4, 4], [4, 6]]));
  });

  it('2-star adds one step straight back; 3-star moves to any of the 8 neighbours', () => {
    const s2 = makeState([
      [0, 'brutile', 2, 5, 5],
      [1, 'sad', 1, 11, 11],
    ]);
    expect(targetKeys(getLegalMoves(s2, 'p0-brutile'))).toEqual(keys([[6, 4], [6, 6], [4, 5]]));
    const s3 = makeState([
      [0, 'brutile', 3, 5, 5],
      [1, 'sad', 1, 11, 11],
    ]);
    expect(getLegalMoves(s3, 'p0-brutile')).toHaveLength(8);
  });

  it('captures like everyone else and turns around at the far row', () => {
    const s = makeState([
      [0, 'brutile', 1, 10, 5],
      [1, 'sad', 1, 11, 6],
      [1, 'walk', 1, 11, 0],
    ]);
    const m = getLegalMoves(s, 'p0-brutile').find((x) => x.to.c === 6)!;
    expect(m.captureId).toBe('p1-sad');
    const after = applyMove(s, m);
    const b = after.pieces.find((p) => p.id === 'p0-brutile')!;
    expect(b.dir).toBe(-1);
    // Facing back down, the 1-star witch now steps down-diagonally (no longer stuck).
    expect(targetKeys(getTargetsForPiece(after, b))).toEqual(keys([[10, 5], [10, 7]]));
  });
});

describe('Insaner vs Brutile', () => {
  it('Insaner absorbs her movement (not the skill)', () => {
    const s = makeState([
      [0, 'insaner', 1, 5, 5],
      [0, 'sad', 1, 0, 0],
      [1, 'brutile', 3, 5, 6],
      [1, 'sad', 1, 11, 11],
    ]);
    const m = getLegalMoves(s, 'p0-insaner').find((x) => x.captureId === 'p1-brutile')!;
    const after = applyMove(s, m);
    const ins = after.pieces.find((p) => p.id === 'p0-insaner')!;
    expect(ins.absorbed).toEqual([{ character: 'brutile', level: 3 }]);
    // Now it also steps diagonally (Brutile 3-star), which a 1-star Insaner cannot do on its own.
    expect(targetKeys(getTargetsForPiece(after, ins))).toContain('6,7');
    expect(skillBlock({ ...after, turn: 0, ply: 20 }, 'p0-insaner')).toBe('noSkill');
  });
});

describe('wasteland', () => {
  it('slides stop ON wasteland, and touching it destroys the mover', () => {
    const s = makeState(
      [
        [0, 'sad', 3, 2, 2],
        [1, 'walk', 1, 11, 11],
        [1, 'marki', 1, 10, 0],
      ],
      0,
      { waste: [4 * 12 + 2] },
    );
    const t = targetKeys(getLegalMoves(s, 'p0-sad'));
    expect(t).toContain('3,2');
    expect(t).toContain('4,2');
    expect(t).not.toContain('5,2'); // the slide cannot pass the wasteland
    const m = getLegalMoves(s, 'p0-sad').find((x) => x.to.r === 4 && x.to.c === 2)!;
    const after = applyMove(s, m);
    expect(after.pieces.some((p) => p.id === 'p0-sad')).toBe(false);
    const rec = after.history[after.history.length - 1];
    expect(rec.kind === 'move' && rec.move.wasted).toBe(true);
    expect(after.status).toBe('ended');
    expect(after.endReason).toBe('waste');
    expect(after.winner).toBe(1);
  });

  it('jumpers die when they land on it', () => {
    const s = makeState(
      [
        [0, 'walk', 1, 2, 5],
        [0, 'sad', 1, 0, 0],
        [1, 'sad', 1, 11, 11],
      ],
      0,
      { waste: [3 * 12 + 4] },
    );
    const m = getLegalMoves(s, 'p0-walk').find((x) => x.to.r === 3 && x.to.c === 4)!;
    const after = applyMove(s, m);
    expect(after.pieces.map((p) => p.id).sort()).toEqual(['p0-sad', 'p1-sad']);
    expect(after.status).toBe('playing');
    expect(after.turn).toBe(1);
  });
});

describe('Brutile skill: 불모지', () => {
  const base = (level: 1 | 2 | 3, extra: Partial<GameState> = {}) =>
    makeState(
      [
        [0, 'brutile', level, 1, 5],
        [0, 'sad', 1, 0, 0],
        [1, 'sad', 1, 10, 6],
        [1, 'marki', 1, 11, 0],
      ],
      0,
      { ply: SKILL_UNLOCK_PLY, ...extra },
    );

  it('area grows 1, 2x2, 3x3 with the grade', () => {
    expect(wasteArea(1, { r: 5, c: 5 })).toEqual([65]);
    expect(wasteArea(2, { r: 5, c: 5 })).toEqual([65, 66, 77, 78]);
    expect(wasteArea(3, { r: 0, c: 0 })).toEqual([0, 1, 2, 12, 13, 14, 24, 25, 26]);
  });

  it('unlocks on the 7th turn (each side has played 3 turns)', () => {
    expect(skillBlock(base(1, { ply: SKILL_UNLOCK_PLY - 1 }), 'p0-brutile')).toBe('notYet');
    expect(skillBlock(base(1), 'p0-brutile')).toBeNull();
    expect(skillBlock(base(1), 'p0-sad')).toBe('noSkill');
  });

  it('can only cover empty squares that are fully on the board', () => {
    const s = base(3);
    expect(isLegalSkill(s, sk('p0-brutile', 5, 5))).toBe(true);
    expect(isLegalSkill(s, sk('p0-brutile', 9, 5))).toBe(false); // (10,6) holds a piece
    expect(isLegalSkill(s, sk('p0-brutile', 10, 10))).toBe(false); // off the board
    expect(skillAnchors(s, 'p0-brutile').every((a) => a.r + 3 <= 12 && a.c + 3 <= 12)).toBe(true);
  });

  it('is the action of the turn, once per match, and stops once the storm closes in', () => {
    const s = base(2);
    const after = applySkill(s, sk('p0-brutile', 5, 5));
    expect(after.waste).toEqual([65, 66, 77, 78]);
    expect(after.turn).toBe(1);
    expect(after.skillsUsed).toEqual([1, 0]);
    const h = after.history[after.history.length - 1];
    expect(h).toEqual({ kind: 'skill', player: 0, pieceId: 'p0-brutile', squares: [65, 66, 77, 78] });
    const back = { ...after, turn: 0 as const };
    expect(skillBlock(back, 'p0-brutile')).toBe('used');
    expect(() => applySkill(back, sk('p0-brutile', 7, 7))).toThrow();
    // Storm activated but not yet shrinking: still allowed. After the first shrink: forbidden.
    expect(skillBlock(base(1, { stormIn: 3, storm: 0 }), 'p0-brutile')).toBeNull();
    expect(skillBlock(base(1, { stormIn: 6, storm: 1 }), 'p0-brutile')).toBe('storm');
  });

  it('not during a chain move or on the opponent turn', () => {
    expect(skillBlock({ ...base(1), turn: 1 }, 'p0-brutile')).toBe('notYourTurn');
    expect(skillBlock({ ...base(1), bonusPieceId: 'p0-sad' }, 'p0-brutile')).toBe('chain');
  });
});

describe('no auto-pass while the wasteland can still be cast', () => {
  // Blue's 1-star Brutile at the far row edge is boxed in: both forward diagonals are off board / blocked.
  const boxed = (extra: Partial<GameState> = {}) =>
    makeState(
      [
        [0, 'brutile', 1, 11, 0],
        [1, 'sad', 1, 10, 1],
        [1, 'walk', 1, 5, 9],
      ],
      1,
      { ply: 20, ...extra },
    );
  it('the side is not passed when it can cast, and is passed once it cannot', () => {
    // Blue's Brutile at (11,0) faces up (dir +1): no row ahead, it has not turned around (dir set by moves only).
    const s = boxed();
    expect(getLegalMoves({ ...s, turn: 0 }, 'p0-brutile')).toHaveLength(0);
    // Red plays a quiet move; Blue must get its turn (to cast) instead of an automatic pass.
    const m = getLegalMoves(s).find((x) => x.pieceId === 'p1-walk')!;
    const after = applyMove(s, m);
    expect(after.turn).toBe(0);
    expect(after.history[after.history.length - 1].kind).toBe('move');
    const a = chooseAction(after, 'normal', { timeBudgetMs: 20, rng: rngFrom(1) });
    expect(isSkillAction(a)).toBe(true);
    // With the skill spent the same position passes automatically.
    const spent = applyMove(boxed({ skillsUsed: [1, 0] }), m);
    expect(spent.turn).toBe(1);
    expect(spent.history.some((e) => e.kind === 'pass' && e.reason === 'noMoves')).toBe(true);
  });
});

describe('fast board and bot with Brutile', () => {
  it('fast make/unmake mirrors the engine through wasteland deaths and skill casts', () => {
    const rng = rngFrom(99);
    let skills = 0;
    let deaths = 0;
    for (let game = 0; game < 30; game++) {
      const lv = { sad: 2, marki: 2, walk: 2, insaner: 3, brutile: (1 + (game % 3)) as 1 | 2 | 3 } as const;
      let g = createGame(
        randomFormation(rng, lv, ['brutile', 'sad', 'walk']),
        randomFormation(rng, lv, game % 2 ? ['brutile', 'marki', 'insaner'] : ['sad', 'marki', 'walk']),
        (game % 2) as 0 | 1,
      );
      let guard = 0;
      while (g.status === 'playing' && guard++ < 200) {
        const b = fastFromState(g);
        const buf = new Int32Array(128);
        const n = fastGenMoves(b, b.turn, buf, 0);
        const fastKeys = Array.from(buf.subarray(0, n)).map((m) => {
          const x = fastMoveToMove(b, m);
          return `${x.pieceId}:${x.to.r},${x.to.c}`;
        });
        const legal = getLegalMoves(g);
        expect(fastKeys.sort()).toEqual(legal.map((m) => `${m.pieceId}:${m.to.r},${m.to.c}`).sort());
        const snap = () => JSON.stringify([Array.from(b.sq), Array.from(b.occ), Array.from(b.waste), Array.from(b.skills), b.turn, b.ply, b.stormIn, Array.from(b.alive), Array.from(b.material)]);
        const before = snap();
        for (let k = 0; k < n; k++) {
          const u = fastMake(b, buf[k]);
          fastUnmake(b, buf[k], u);
        }
        expect(snap()).toBe(before);
        // Sometimes cast the wasteland (engine + fast board must agree).
        const caster = g.pieces.find((p) => p.character === 'brutile' && p.owner === g.turn);
        const anchors = caster ? skillAnchors(g, caster.id) : [];
        if (anchors.length && rng() < 0.3) {
          const a = anchors[Math.floor(rng() * anchors.length)];
          const ci = b.ids.indexOf(caster!.id);
          expect(fastCanSkill(b, ci)).toBe(true);
          const mv = SKILL_FLAG | (ci << 8) | (a.r * 12 + a.c);
          const u = fastMake(b, mv);
          const next = applySkill(g, { kind: 'skill', pieceId: caster!.id, anchor: a });
          expect(Array.from(b.waste).flatMap((v, i) => (v ? [i] : []))).toEqual(next.waste);
          expect(b.turn).toBe(next.turn);
          fastUnmake(b, mv, u);
          expect(snap()).toBe(before);
          g = next;
          skills++;
          continue;
        }
        // Prefer moves into wasteland now and then so deaths are exercised.
        const deadly = legal.filter((m) => g.waste.includes(m.to.r * 12 + m.to.c));
        const pick = deadly.length && rng() < 0.3 ? deadly[0] : legal[Math.floor(rng() * legal.length)];
        const code = Array.from(buf.subarray(0, n)).find((m) => {
          const x = fastMoveToMove(b, m);
          return x.pieceId === pick.pieceId && x.to.r === pick.to.r && x.to.c === pick.to.c;
        })!;
        fastMake(b, code);
        const next = applyMove(g, pick);
        const rec = next.history[g.history.length];
        if (rec?.kind === 'move' && rec.move.wasted) deaths++;
        if (next.status === 'playing') {
          expect(b.alive[0] + b.alive[1]).toBe(next.pieces.length);
          expect(b.ply).toBe(next.ply);
        }
        g = next;
      }
    }
    expect(skills).toBeGreaterThan(5);
    expect(deaths).toBeGreaterThan(0);
  });

  it('the bot never walks into wasteland when it has another move, and casts the skill', () => {
    const s = makeState(
      [
        [1, 'sad', 2, 6, 5],
        [1, 'brutile', 3, 10, 5],
        [0, 'walk', 1, 0, 11],
        [0, 'sad', 1, 0, 0],
      ],
      1,
      { waste: [5 * 12 + 5, 6 * 12 + 4], ply: 20 },
    );
    const rng = rngFrom(5);
    let casts = 0;
    for (let i = 0; i < 6; i++) {
      for (const d of ['easy', 'normal', 'hard'] as const) {
        const a = chooseAction({ ...s, skillsUsed: [0, 1] }, d, { timeBudgetMs: 20, rng });
        expect(a).not.toBeNull();
        if (isSkillAction(a)) throw new Error('used a spent skill');
        expect(s.waste.includes(a!.to.r * 12 + a!.to.c)).toBe(false);
        if (isSkillAction(chooseAction(s, d, { timeBudgetMs: 20, rng }))) casts++;
      }
    }
    expect(casts).toBeGreaterThan(0);
  }, 60_000);
});
