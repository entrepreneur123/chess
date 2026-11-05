/**
 * The three later commons: 램피드 Rampid (forward claw slider), 라르헨 Larhen (H-shaped jumper) and
 * 볼코노프 Volkonov (cross slider whose skill "선율" buffs his allies). Movement geometry by grade
 * and side, the buff rules (cast gates, duration, the +1 orthogonal extension), Insaner absorbing
 * them, the absorb-mask nesting guarantee, FastBoard parity over random games and the bot.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction, isSkillAction } from '../src/ai/bot';
import {
  BOARD_SIZE,
  BUFF_TURNS,
  CHARACTERS,
  CHARACTER_IDS,
  MAX_MATCH_PLIES,
  SKILL_UNLOCK_PLY,
  applyMove,
  applySkill,
  createGame,
  fastFromState,
  fastGenMoves,
  fastMake,
  fastMoveToMove,
  fastUnmake,
  genTargets,
  getLegalMoves,
  getTargetsForPiece,
  isBuffed,
  isDirectional,
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
import { CHAR_BY_CODE, CHAR_CODE, absorbedLevel, keepsDirection } from '../src/engine/characters';
import { SKILL_FLAG, fastCanSkill } from '../src/engine/fast';
import { absorbSig, chainPlies, keys, makeState, rngFrom, targetKeys } from './helpers';

const reach = (s: GameState, id: string) => targetKeys(getTargetsForPiece(s, s.pieces.find((p) => p.id === id)!));
const withPiece = (s: GameState, id: string, patch: Partial<Piece>): GameState => ({ ...s, pieces: s.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
const cast = (s: GameState, id: string): GameState => {
  const p = s.pieces.find((x) => x.id === id)!;
  return applySkill(s, { kind: 'skill', pieceId: id, anchor: { ...p.pos } });
};
const play = (s: GameState, id: string, r: number, c: number): GameState => {
  const m = getLegalMoves(s, id).find((x) => x.to.r === r && x.to.c === c);
  if (!m) throw new Error(`no legal move ${id} -> ${r},${c}: ${targetKeys(getLegalMoves(s, id)).join(' ')}`);
  return applyMove(s, m);
};
/** Keep a bystander far away so a side never runs out of pieces. */
const far: [0 | 1, CharacterId, Level, number, number][] = [[1, 'sad', 1, 9, 9]];

describe('램피드 Rampid: forward claw slider', () => {
  it('1 / 2 / 3성: straight forward and both forward diagonals, up to 1 / 2 / 3 squares (player 0)', () => {
    for (const [lv, n] of [[1, 1], [2, 2], [3, 3]] as const) {
      const s = makeState([[0, 'rampid', lv, 4, 4], ...far]);
      const exp: [number, number][] = [];
      for (let k = 1; k <= n; k++) exp.push([4 + k, 4], [4 + k, 4 - k], [4 + k, 4 + k]);
      expect(reach(s, 'p0-rampid'), `lv${lv}`).toEqual(keys(exp));
    }
  });

  it('player 1 claws toward row 0', () => {
    const s = makeState([[1, 'rampid', 2, 5, 5], [0, 'sad', 1, 0, 0]]);
    expect(reach(s, 'p1-rampid')).toEqual(keys([[4, 5], [3, 5], [4, 4], [3, 3], [4, 6], [3, 7]]));
  });

  it('slides: blocked by any piece, captures the first enemy on a prong', () => {
    const s = makeState([[0, 'rampid', 3, 2, 4], [0, 'sad', 1, 3, 4], [1, 'marki', 1, 4, 6], ...far]);
    // Straight prong blocked at once by his own Sad; the right prong stops on the Marki (capture).
    expect(reach(s, 'p0-rampid')).toEqual(keys([[3, 3], [4, 2], [5, 1], [3, 5], [4, 6]]));
  });

  it('is a forward mover: turns around at the far edge', () => {
    const s = makeState([[0, 'rampid', 1, 8, 4], ...far.map((f) => [1, f[1], f[2], 0, 0] as typeof f)]);
    const after = play(s, 'p0-rampid', 9, 4);
    expect(after.pieces.find((p) => p.id === 'p0-rampid')!.dir).toBe(-1);
    expect(isDirectional({ character: 'rampid', level: 3 })).toBe(true);
    expect(keepsDirection(CHAR_CODE.rampid)).toBe(false);
  });
});

describe('라르헨 Larhen: H-shaped jumper', () => {
  it('1성: left / right 1 and the two forward diagonals; 2성 adds the backward diagonals (an H)', () => {
    const s1 = makeState([[0, 'larhen', 1, 4, 4], ...far]);
    expect(reach(s1, 'p0-larhen')).toEqual(keys([[4, 3], [4, 5], [5, 3], [5, 5]]));
    const s2 = makeState([[0, 'larhen', 2, 4, 4], ...far]);
    expect(reach(s2, 'p0-larhen')).toEqual(keys([[4, 3], [4, 5], [5, 3], [5, 5], [3, 3], [3, 5]]));
  });

  it('3성: left / right up to 5 each way plus all four diagonals, clipped at the edge', () => {
    const s = makeState([[0, 'larhen', 3, 4, 4], ...far]);
    const exp: [number, number][] = [[5, 3], [5, 5], [3, 3], [3, 5]];
    for (let c = 0; c < BOARD_SIZE; c++) if (c !== 4) exp.push([4, c]);
    expect(reach(s, 'p0-larhen')).toEqual(keys(exp));
  });

  it('jumps over pieces, captures on landing, never lands on his own piece', () => {
    const s = makeState([[0, 'larhen', 3, 4, 4], [0, 'sad', 1, 4, 5], [1, 'marki', 1, 4, 7], [1, 'sad', 1, 4, 2], [1, 'walk', 1, 9, 9]]);
    const r = reach(s, 'p0-larhen');
    expect(r).not.toContain('4,5');
    expect(r).toContain('4,6');
    expect(r).toContain('4,7');
    expect(r).toContain('4,8');
    expect(r).toContain('4,1'); // past the enemy Sad on (4,2)
    expect(getLegalMoves(s, 'p0-larhen').find((m) => m.to.c === 7 && m.to.r === 4)?.captureId).toBe('p1-marki');
  });

  it('1성 is directional (forward diagonals), 2성 / 3성 are not; player 1 jumps toward row 0', () => {
    expect(isDirectional({ character: 'larhen', level: 1 })).toBe(true);
    expect(isDirectional({ character: 'larhen', level: 2 })).toBe(false);
    const s = makeState([[1, 'larhen', 1, 5, 5], [0, 'sad', 1, 0, 0]]);
    expect(reach(s, 'p1-larhen')).toEqual(keys([[5, 4], [5, 6], [4, 4], [4, 6]]));
  });

  it('skips storm squares', () => {
    const s = makeState([[0, 'larhen', 3, 4, 4], ...far.map((f) => [f[0], f[1], f[2], 4, 5] as typeof f)], 0, { storm: 2, stormIn: 4 });
    const r = reach(s, 'p0-larhen');
    expect(r).not.toContain('4,0');
    expect(r).not.toContain('4,1');
    expect(r).not.toContain('4,8');
    expect(r).toContain('4,2');
    expect(r).toContain('4,7');
  });
});

describe('볼코노프 Volkonov: cross slider', () => {
  it('1성 cross 1, 2성 and 3성 cross up to 2; symmetric (never turns)', () => {
    for (const [lv, n] of [[1, 1], [2, 2], [3, 2]] as const) {
      const s = makeState([[0, 'volkonov', lv, 4, 4], ...far]);
      const exp: [number, number][] = [];
      for (let k = 1; k <= n; k++) exp.push([4 + k, 4], [4 - k, 4], [4, 4 + k], [4, 4 - k]);
      expect(reach(s, 'p0-volkonov'), `lv${lv}`).toEqual(keys(exp));
    }
    expect(keepsDirection(CHAR_CODE.volkonov)).toBe(true);
    expect(isDirectional({ character: 'volkonov', level: 1 })).toBe(false);
  });
});

describe('absorb masks: every pattern contains the lower grades of the same character', () => {
  // The FastBoard keeps only the highest absorbed level per character; that is exact only because
  // a character's reach at a level always contains its reach at every lower level.
  it('holds for every character, both directions and (Rakaeli) both forms, from every square', () => {
    const empty = new Int8Array(BOARD_SIZE * BOARD_SIZE).fill(-1);
    const a = new Int16Array(256);
    const b = new Int16Array(256);
    for (const id of CHARACTER_IDS) {
      const ch = CHAR_CODE[id];
      for (const dir of [1, -1]) {
        for (const awake of id === 'rakaeli' ? [false, true] : [false]) {
          for (let sq = 0; sq < BOARD_SIZE * BOARD_SIZE; sq++) {
            for (const lv of [1, 2]) {
              const na = genTargets(empty, [], 0, ch, lv, sq, a, 0, false, dir, 0, 0, null, null, awake);
              const nb = genTargets(empty, [], 0, ch, lv + 1, sq, b, 0, false, dir, 0, 0, null, null, awake);
              const hi = new Set(Array.from(b.subarray(0, nb)));
              for (let k = 0; k < na; k++) expect(hi.has(a[k]), `${id} ${lv}->${lv + 1} dir ${dir} sq ${sq}`).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('Insaner absorbs the new commons (movement only)', () => {
  it('takes Larhen 3성\'s whole-row jump and Volkonov\'s cross, never the melody or a buff', () => {
    let s = makeState([[0, 'insaner', 2, 4, 4], [1, 'larhen', 3, 4, 6], [1, 'volkonov', 2, 9, 9]], 0, { ply: 20 });
    s = withPiece(s, 'p1-larhen', { buff: 3 });
    s = play(s, 'p0-insaner', 4, 6);
    const ins = s.pieces.find((p) => p.id === 'p0-insaner')!;
    expect(ins.absorbed).toEqual([{ character: 'larhen', level: 3 }]);
    expect(ins.buff).toBeUndefined();
    expect(reach(s, 'p0-insaner')).toContain('4,1'); // Larhen 3성 sideways jump of 5
  });
});

describe('볼코노프 skill 선율 (melody)', () => {
  const base = () =>
    makeState([[0, 'volkonov', 1, 0, 4], [0, 'sad', 1, 4, 4], [0, 'picker', 1, 2, 7], [1, 'marki', 1, 9, 0], [1, 'walk', 1, 9, 9]], 0, { ply: SKILL_UNLOCK_PLY });

  it('is the turn: every OTHER ally gets buff = BUFF_TURNS + 1, counted down at once to the turns left', () => {
    const s = cast(base(), 'p0-volkonov');
    const e = s.history[s.history.length - 1];
    expect(e).toMatchObject({ kind: 'skill', pieceId: 'p0-volkonov', squares: [], buffed: ['p0-sad', 'p0-picker'] });
    expect(s.turn).toBe(1);
    expect(s.pieces.find((p) => p.id === 'p0-sad')!.buff).toBe(BUFF_TURNS[1]);
    expect(s.pieces.find((p) => p.id === 'p0-picker')!.buff).toBe(BUFF_TURNS[1]);
    const v = s.pieces.find((p) => p.id === 'p0-volkonov')!;
    expect(v.buff).toBeUndefined();
    expect(v.skillUsed).toBe(true);
    expect(skillAnchors(base(), 'p0-volkonov')).toEqual([{ r: 0, c: 4 }]);
  });

  it('lasts exactly 3 / 3 / 4 of the allies\' own turns by grade', () => {
    expect(BUFF_TURNS.slice(1)).toEqual([3, 3, 4]);
    for (const lv of [1, 2, 3] as const) {
      let s = withPiece(base(), 'p0-volkonov', { level: lv });
      s = cast(s, 'p0-volkonov');
      let buffedTurns = 0;
      // Alternate: the opponent shuffles its far Walk, player 0 shuffles Volkonov.
      for (let t = 0; t < 8; t++) {
        const opp = getLegalMoves(s).find((m) => m.pieceId === 'p1-walk' || m.pieceId === 'p1-marki')!;
        s = applyMove(s, opp);
        if (isBuffed(s.pieces.find((p) => p.id === 'p0-sad')!)) buffedTurns++;
        const mv = getLegalMoves(s, 'p0-volkonov')[0];
        s = applyMove(s, mv);
      }
      expect(buffedTurns, `lv${lv}`).toBe(BUFF_TURNS[lv]);
    }
  });

  it('adds 1 square past the reach in each orthogonal direction (1 where there was none), as a slide', () => {
    let s = cast(base(), 'p0-volkonov');
    s = applyMove(s, getLegalMoves(s).find((m) => m.pieceId === 'p1-walk')!);
    // Sad 1성 (cross 1) -> cross 2.
    expect(reach(s, 'p0-sad')).toEqual(keys([[5, 4], [6, 4], [3, 4], [2, 4], [4, 5], [4, 6], [4, 3], [4, 2]]));
    // Picker 1성 (diagonals only) keeps his diagonals and gains a plain cross step of 1.
    expect(reach(s, 'p0-picker')).toEqual(keys([[3, 6], [3, 8], [1, 6], [1, 8], [3, 7], [1, 7], [2, 8], [2, 6]]));
  });

  it('a directional pattern grows per direction: Marki 1성 (forward 3) gets forward 4, back 1, sides 1', () => {
    let s = makeState([[0, 'volkonov', 1, 0, 0], [0, 'marki', 1, 3, 4], [1, 'walk', 1, 9, 9]], 0, { ply: SKILL_UNLOCK_PLY });
    s = cast(s, 'p0-volkonov');
    s = applyMove(s, getLegalMoves(s)[0]);
    expect(reach(s, 'p0-marki')).toEqual(keys([[4, 4], [5, 4], [6, 4], [7, 4], [2, 4], [3, 3], [3, 5]]));
  });

  it('the extension is blocked by pieces and captures the first enemy on it', () => {
    let s = makeState([[0, 'volkonov', 1, 0, 0], [0, 'sad', 1, 4, 4], [1, 'marki', 1, 4, 6], [1, 'walk', 1, 9, 9]], 0, { ply: SKILL_UNLOCK_PLY });
    s = cast(s, 'p0-volkonov');
    s = applyMove(s, getLegalMoves(s).find((m) => m.pieceId === 'p1-walk')!);
    expect(getLegalMoves(s, 'p0-sad').find((m) => m.to.r === 4 && m.to.c === 6)?.captureId).toBe('p1-marki');
    // Blocked behind his own Volkonov? (0,0) is far; rightward stops on the Marki: never (4,7).
    expect(reach(s, 'p0-sad')).not.toContain('4,7');
  });

  it('gates: not before the unlock, alone, used, on the opponent turn, during the storm, stunned', () => {
    expect(skillBlock({ ...base(), ply: SKILL_UNLOCK_PLY - 1 }, 'p0-volkonov')).toBe('notYet');
    const alone = makeState([[0, 'volkonov', 1, 0, 4], [1, 'marki', 1, 9, 0]], 0, { ply: 10 });
    expect(skillBlock(alone, 'p0-volkonov')).toBe('alone');
    expect(skillBlock(withPiece(base(), 'p0-volkonov', { skillUsed: true }), 'p0-volkonov')).toBe('used');
    expect(skillBlock({ ...base(), turn: 1 }, 'p0-volkonov')).toBe('notYourTurn');
    expect(skillBlock({ ...base(), storm: 1, stormIn: 4 }, 'p0-volkonov')).toBe('storm');
    expect(skillBlock(withPiece(base(), 'p0-volkonov', { stun: 2 }), 'p0-volkonov')).toBe('stunned');
    expect(skillBlock(base(), 'p0-volkonov')).toBeNull();
  });

  it('a stun does not pause the buff', () => {
    let s = cast(base(), 'p0-volkonov');
    s = withPiece(s, 'p0-sad', { stun: 1 });
    s = applyMove(s, getLegalMoves(s).find((m) => m.pieceId === 'p1-walk')!);
    const before = s.pieces.find((p) => p.id === 'p0-sad')!.buff!;
    s = applyMove(s, getLegalMoves(s, 'p0-volkonov')[0]);
    expect(s.pieces.find((p) => p.id === 'p0-sad')!.buff ?? 0).toBe(before - 1);
  });
});

// ---------------------------------------------------------------- FastBoard parity

const NEW_SQUADS: CharacterId[][] = [
  ['rampid', 'larhen', 'volkonov'],
  ['volkonov', 'insaner', 'picker'],
  ['volkonov', 'michelle', 'rakaeli'],
  ['larhen', 'brutile', 'walk'],
  ['rampid', 'insaner', 'volkonov'],
  ['marki', 'volkonov', 'sad'],
];
const randLv = (rng: () => number): Partial<Record<CharacterId, Level>> => Object.fromEntries(CHARACTER_IDS.map((id) => [id, (1 + Math.floor(rng() * 3)) as Level]));
const sig = (s: GameState) =>
  JSON.stringify({
    pieces: [...s.pieces]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => [p.id, p.pos.r, p.pos.c, keepsDirection(CHAR_CODE[p.character]) ? 0 : (p.dir ?? (p.owner === 0 ? 1 : -1)), p.stun ?? 0, p.awaken ?? 0, p.buff ?? 0, p.skillUsed ? 1 : 0, absorbSig((p.absorbed ?? []).map((a) => [a.character, a.level]), p.character, p.level)]),
    turn: s.turn,
    waste: s.waste,
    skills: s.skillsUsed,
  });
function fastSig(b: ReturnType<typeof fastFromState>): string {
  const pieces: (string | number)[][] = [];
  for (let i = 0; i < b.n; i++) {
    if (b.sq[i] < 0) continue;
    const abs: [CharacterId, number][] = CHAR_BY_CODE.map((id, ch) => [id, absorbedLevel(b.absorb[i], ch)]);
    pieces.push([b.ids[i], (b.sq[i] / BOARD_SIZE) | 0, b.sq[i] % BOARD_SIZE, keepsDirection(b.ch[i]) ? 0 : b.dir[i], b.stun[i], b.awaken[i], b.buff[i], b.used[i], absorbSig(abs, CHAR_BY_CODE[b.ch[i]], b.lvl[i])]);
  }
  pieces.sort((a, c) => String(a[0]).localeCompare(String(c[0])));
  const waste: number[] = [];
  for (let s = 0; s < BOARD_SIZE * BOARD_SIZE; s++) if (b.waste[s]) waste.push(s);
  return JSON.stringify({ pieces, turn: b.turn, waste, skills: [b.skills[0], b.skills[1]] });
}

describe('FastBoard parity with the engine (new commons)', () => {
  it('moves, melodies, buff countdowns and absorbs make / unmake exactly, over random games', () => {
    const rng = rngFrom(1105);
    const buf = new Int32Array(256);
    let checked = 0;
    let melodies = 0;
    let buffedMoves = 0;
    for (let g = 0; g < 60; g++) {
      let s = createGame(randomFormation(rng, randLv(rng), NEW_SQUADS[g % NEW_SQUADS.length]), randomFormation(rng, randLv(rng), NEW_SQUADS[(g + 3) % NEW_SQUADS.length]), (g % 2) as 0 | 1);
      for (let ply = 0; ply < 120 && s.status === 'playing'; ply++) {
        const legal = getLegalMoves(s);
        const b = fastFromState(s);
        const n = fastGenMoves(b, b.turn, buf, 0);
        expect(Array.from(buf.subarray(0, n)).map((m) => `${b.ids[(m >> 8) & 255]}>${m & 255}`).sort()).toEqual(legal.map((m) => `${m.pieceId}>${m.to.r * BOARD_SIZE + m.to.c}`).sort());
        const before = fastSig(b);
        expect(before).toBe(sig(s));
        for (let k = 0; k < n; k++) {
          const eng = applyMove(s, fastMoveToMove(b, buf[k]));
          const undo = fastMake(b, buf[k]);
          if (eng.status === 'playing' && eng.history.length === s.history.length + 1) expect(fastSig(b)).toBe(sig(eng));
          fastUnmake(b, buf[k], undo);
          expect(fastSig(b)).toBe(before);
          checked++;
        }
        let chosen: SkillAction | null = null;
        for (const p of s.pieces.filter((q) => q.owner === s.turn && CHARACTERS[q.character].skill)) {
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
          if (p.character === 'volkonov' && rng() < 0.7) chosen = action;
        }
        if (chosen) {
          s = applySkill(s, chosen);
          melodies++;
        } else if (legal.length) {
          const m = legal[Math.floor(rng() * legal.length)];
          if (s.pieces.find((p) => p.id === m.pieceId)?.buff) buffedMoves++;
          s = applyMove(s, m);
        } else break;
      }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(melodies).toBeGreaterThan(15);
    expect(buffedMoves).toBeGreaterThan(20);
  }, 120_000);
});

describe('bot with the new commons', () => {
  it('plays legal games to termination, casting the melody along the way', () => {
    const rng = rngFrom(4242);
    let melodies = 0;
    for (let i = 0; i < 18; i++) {
      let g = createGame(randomFormation(rng, randLv(rng), NEW_SQUADS[i % NEW_SQUADS.length]), randomFormation(rng, randLv(rng), NEW_SQUADS[(i + 1) % NEW_SQUADS.length]), (i % 2) as 0 | 1);
      let guard = 0;
      while (g.status === 'playing') {
        expect(++guard).toBeLessThan(400);
        const a = chooseAction(g, i % 3 === 0 ? 'easy' : i % 3 === 1 ? 'normal' : 'hard', { timeBudgetMs: 6, rng });
        expect(a).not.toBeNull();
        if (isSkillAction(a)) {
          expect(isLegalSkill(g, a)).toBe(true);
          const after = applySkill(g, a);
          if ((after.history[g.history.length] as { buffed?: string[] }).buffed) melodies++;
          g = after;
        } else {
          expect(isLegalMove(g, a as Move)).toBe(true);
          g = applyMove(g, a as Move);
        }
      }
      expect(g.ply - chainPlies(g.history)).toBeLessThanOrEqual(MAX_MATCH_PLIES);
    }
    expect(melodies).toBeGreaterThan(0);
  }, 120_000);

  it('casts the melody when the extra reach forks two pieces', () => {
    // Sad 1성 on (4,4) reaches neither the Picker on (6,4) nor the Michelle on (4,2), and neither
    // can hit him; buffed (cross 2) he threatens both and only one can get away.
    const s = makeState([[0, 'volkonov', 1, 0, 0], [0, 'sad', 1, 4, 4], [1, 'picker', 1, 6, 4], [1, 'michelle', 1, 4, 2], [1, 'marki', 1, 9, 9]], 0, { ply: 20 });
    let casts = 0;
    for (const seed of [1, 2, 3]) {
      const a = chooseAction(s, 'hard', { timeBudgetMs: 300, rng: rngFrom(seed) });
      if (isSkillAction(a) && a.pieceId === 'p0-volkonov') casts++;
    }
    expect(casts).toBeGreaterThanOrEqual(2);
  });
});

describe('UI models for the new commons', () => {
  it('the hand card carries the buffed turns left; a lonely Volkonov shows "아군 없음"', async () => {
    const { handModel, skillReadiness } = await import('../src/ui/game/hand');
    let s = makeState([[0, 'volkonov', 3, 0, 4], [0, 'sad', 1, 4, 4], [1, 'walk', 1, 9, 9]], 0, { ply: SKILL_UNLOCK_PLY });
    s = cast(s, 'p0-volkonov');
    const slots = [
      { character: 'volkonov' as const, level: 3 as const, row: 0, col: 4 },
      { character: 'sad' as const, level: 1 as const, row: 1, col: 4 },
    ];
    const m = handModel(slots, 0, { state: s, selection: null });
    expect(m.find((c) => c.character === 'sad')!.buff).toBe(BUFF_TURNS[3]);
    expect(m.find((c) => c.character === 'volkonov')!.buff).toBe(0);
    expect(m.find((c) => c.character === 'volkonov')!.skill).toEqual({ state: 'used', label: '사용함' });
    const alone = makeState([[0, 'volkonov', 1, 0, 4], [1, 'walk', 1, 9, 9]], 0, { ply: 10 });
    expect(skillReadiness(alone, 'p0-volkonov')).toEqual({ state: 'sealed', label: '아군 없음' });
  });

  it('the movement diagram measures both middle columns: Larhen 3성 shows all 14 squares', async () => {
    const { movementReach, movementSpan } = await import('../src/ui/components/piece');
    expect(movementReach('larhen', 3)).toBe(14);
    expect(movementSpan('larhen', 3).cols).toBe(11);
    expect(movementReach('larhen', 1)).toBe(4);
    expect(movementReach('rampid', 3)).toBe(9);
    expect(movementReach('volkonov', 2)).toBe(8);
    // Every older character keeps its count (the merged origins add nothing for them).
    expect([movementReach('sad', 3), movementReach('walk', 3), movementReach('marki', 3)]).toEqual([12, 9, 7]);
  });
});
