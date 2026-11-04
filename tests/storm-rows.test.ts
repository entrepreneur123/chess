/**
 * The storm closes in every 2 turns (STORM_INTERVAL_PLIES = 4) and, from its 3rd step (3 columns per
 * side), also from the top and bottom: one row on each end per step from then on. Storm rows act
 * exactly like storm columns (removal, no move into or through them, no skill target), and they are
 * not a board edge: a forward-only piece facing them never turns around.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  MAX_MATCH_PLIES,
  STORM_FULL_STEPS,
  STORM_INTERVAL_PLIES,
  STORM_ROWS_FROM,
  SUDDEN_DEATH_PLY,
  applyMove,
  createGame,
  fastFromState,
  fastGenMoves,
  fastMake,
  fastMoveToMove,
  fastUnmake,
  getLegalMoves,
  inStorm,
  randomFormation,
  skillAnchors,
  stormRows,
  type CharacterId,
  type GameState,
  type Level,
} from '../src/engine';
import { fastSkillFits } from '../src/engine/fast';
import { chooseAction, evaluate, isSkillAction } from '../src/ai/bot';
import { applySkill, type Move } from '../src/engine';
import { chainPlies, makeState, rngFrom, targetKeys } from './helpers';

const mv = (s: GameState, id: string, r: number, c: number): Move => {
  const m = getLegalMoves(s, id).find((x) => x.to.r === r && x.to.c === c);
  if (!m) throw new Error(`no legal move ${id} -> ${r},${c}: ${targetKeys(getLegalMoves(s, id)).join(' ')}`);
  return m;
};
const at = (storm: number, stormIn = STORM_INTERVAL_PLIES) => ({ storm, stormIn, ply: SUDDEN_DEATH_PLY + 4 * storm });

describe('storm interval and bound', () => {
  it('shrinks every 2 turns (4 plies) and a match is bounded by 38 + 5 * 4 = 58 plies', () => {
    expect(STORM_INTERVAL_PLIES).toBe(4);
    expect(MAX_MATCH_PLIES).toBe(SUDDEN_DEATH_PLY + STORM_FULL_STEPS * STORM_INTERVAL_PLIES);
    expect(MAX_MATCH_PLIES).toBe(58);
  });
});

describe('storm rows', () => {
  it('rows per end = max(0, step - 2): rows 0/9 at step 3, 0-1/8-9 at step 4, the whole board at step 5', () => {
    expect(STORM_ROWS_FROM).toBe(3);
    expect([0, 1, 2, 3, 4, 5].map(stormRows)).toEqual([0, 0, 0, 1, 2, 3]);
    const open = (step: number) => {
      const out: string[] = [];
      for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) if (!inStorm(r, c, step)) out.push(`${r},${c}`);
      return out;
    };
    // Steps 1-2: columns only (every row is open).
    expect(open(2)).toHaveLength(BOARD_SIZE * 6);
    // Step 3: columns 3..6 of rows 1..8.
    expect(open(3)).toHaveLength(8 * 4);
    expect(inStorm(0, 5, 3) && inStorm(9, 4, 3) && !inStorm(1, 5, 3) && !inStorm(8, 4, 3)).toBe(true);
    // Step 4: columns 4..5 of rows 2..7.
    expect(open(4)).toEqual(['2,4', '2,5', '3,4', '3,5', '4,4', '4,5', '5,4', '5,5', '6,4', '6,5', '7,4', '7,5']);
    expect(open(5)).toEqual([]);
  });

  it('removes a piece standing on a row the moment it closes (step 3: rows 0 and 9, step 4: rows 1 and 8)', () => {
    // Step 2 -> 3 on the next turn change: the red marki on row 9 and the blue sad on row 0 go.
    let s = makeState(
      [
        [0, 'sad', 2, 0, 4],
        [0, 'insaner', 2, 1, 5],
        [1, 'sad', 2, 8, 4],
        [1, 'marki', 1, 9, 5],
        [1, 'walk', 1, 5, 4],
      ],
      0,
      { ...at(2, 1) },
    );
    s = applyMove(s, mv(s, 'p0-insaner', 2, 5));
    expect(s.storm).toBe(3);
    const entry = s.history[s.history.length - 1];
    expect(entry.kind === 'storm' && [...entry.killed].sort()).toEqual(['p0-sad', 'p1-marki']);
    expect(s.pieces.map((p) => p.id).sort()).toEqual(['p0-insaner', 'p1-sad', 'p1-walk']);
    // Step 3 -> 4: rows 1 and 8 go (the red sad on row 8), the insaner on row 2 stays.
    s = { ...s, stormIn: 1, turn: 1 };
    s = applyMove(s, mv(s, 'p1-walk', 4, 4));
    expect(s.storm).toBe(4);
    expect(s.pieces.map((p) => p.id).sort()).toEqual(['p0-insaner', 'p1-walk']);
  });

  it('ends the game by storm when the rows take a side\'s last piece, and adjudicates a double wipe by material', () => {
    let s = makeState([[0, 'sad', 2, 4, 4], [1, 'marki', 1, 9, 5]], 0, at(2, 1));
    s = applyMove(s, mv(s, 'p0-sad', 4, 5));
    expect(s.status).toBe('ended');
    expect(s.endReason).toBe('storm');
    expect(s.winner).toBe(0);
    // Both last pieces swallowed by the same step (step 4: rows 1 / 8 and columns 3 / 6): decided by
    // the material lost.
    let w = makeState([[0, 'sad', 1, 1, 4], [1, 'walk', 3, 8, 5]], 0, at(3, 1));
    w = applyMove(w, mv(w, 'p0-sad', 1, 3)); // still on row 1 (closes at step 4)
    expect(w.status).toBe('ended');
    expect(w.endReason).toBe('storm');
    expect(w.pieces).toHaveLength(0);
    // Walk 3성 (8) outweighs Sad 1성 (3).
    expect(w.winner).toBe(1);
  });

  it('blocks slides, jumps and hops into or through storm rows', () => {
    const s3 = makeState(
      [
        [0, 'sad', 3, 3, 3],
        [0, 'picker', 3, 2, 5],
        [1, 'walk', 3, 2, 4],
        [1, 'rakaeli', 3, 4, 6],
        [1, 'insaner', 3, 7, 6],
      ],
      0,
      at(3),
    );
    // Sad 3성 from (3,3) down: (2,3), (1,3), then (0,3) is storm; left: (3,2) is storm.
    const sd = targetKeys(getLegalMoves(s3, 'p0-sad'));
    expect(sd).toContain('1,3');
    expect(sd).not.toContain('0,3');
    expect(sd).not.toContain('3,2');
    // Picker 3성 from (2,5): down-left (1,4) then (0,3) is storm (row 0): the hop stops before it.
    const pk = targetKeys(getLegalMoves(s3, 'p0-picker'));
    expect(pk).toContain('1,4');
    expect(pk).not.toContain('0,3');
    expect(pk).toContain('1,6');
    expect(pk).not.toContain('0,7');
    // Red walk (faces -1) from (2,4) jumps into row 1 only; red rakaeli 3성 from (3,5): rows 2 and 1
    // ahead, never row 0 (back 1 = (4,5)).
    const s3r: GameState = { ...s3, turn: 1 };
    const wk = targetKeys(getLegalMoves(s3r, 'p1-walk'));
    expect(wk.length).toBeGreaterThan(0);
    expect(wk.every((k) => k.startsWith('1,'))).toBe(true);
    // Red rakaeli 3성 on (2,5): 2 rows ahead are 1 and 0, row 0 is storm.
    const rak = makeState([[1, 'rakaeli', 3, 2, 5], [1, 'sad', 1, 6, 5], [0, 'sad', 1, 5, 4]], 1, at(3));
    const rk = targetKeys(getLegalMoves(rak, 'p1-rakaeli'));
    expect(rk.some((k) => k.startsWith('0,'))).toBe(false);
    expect(rk).toEqual(['1,4', '1,5', '1,6', '3,5']);
    // A red walk on row 1 has nowhere to jump (row 0 is storm) and does not turn around.
    const stuck = makeState([[1, 'walk', 3, 1, 4], [1, 'sad', 1, 5, 5], [0, 'sad', 1, 4, 4]], 1, at(3));
    expect(getLegalMoves(stuck, 'p1-walk')).toEqual([]);
    // Marki's rush stops before the storm row: from (5,5) facing +1 at step 3 it reaches 6, 7, 8.
    const mk = makeState([[0, 'marki', 2, 5, 5], [1, 'sad', 1, 4, 4], [1, 'walk', 1, 6, 3]], 0, at(3));
    expect(targetKeys(getLegalMoves(mk, 'p0-marki'))).toEqual(['6,5', '7,5', '8,5']);
    // Every move generated at steps 3 and 4 stays out of the storm.
    for (const st of [3, 4]) {
      const s = { ...s3, ...at(st), pieces: s3.pieces.filter((p) => !inStorm(p.pos.r, p.pos.c, st)) };
      for (const turn of [0, 1] as const) for (const m of getLegalMoves({ ...s, turn })) expect(inStorm(m.to.r, m.to.c, st), `${m.pieceId} -> ${m.to.r},${m.to.c}`).toBe(false);
    }
  });

  it('a Marki facing a storm row cannot move forward and does not turn around', () => {
    // Blue marki 1성 on (8,5) faces +1: row 9 is storm at step 3. Row 8 is not the board edge.
    let s = makeState([[0, 'marki', 1, 6, 5], [0, 'sad', 1, 4, 4], [1, 'sad', 1, 3, 3], [1, 'walk', 1, 5, 3]], 0, at(3));
    s = applyMove(s, mv(s, 'p0-marki', 8, 5));
    const m = s.pieces.find((p) => p.id === 'p0-marki')!;
    expect(m.pos).toEqual({ r: 8, c: 5 });
    // No turn-around on row 8: he still faces the storm.
    expect(m.dir ?? 1).toBe(1);
    s = { ...s, turn: 0 };
    expect(getLegalMoves(s, 'p0-marki')).toEqual([]);
    // The fast board agrees: no forward move, no flip.
    const b = fastFromState(s);
    const buf = new Int32Array(64);
    const n = fastGenMoves(b, 0, buf, 0);
    const ids = Array.from(buf.subarray(0, n)).map((e) => b.ids[(e >> 8) & 255]);
    expect(ids).not.toContain('p0-marki');
    expect(b.dir[b.ids.indexOf('p0-marki')]).toBe(1);
    // Without the storm rows the same square is still not the edge (he turns on row 9 only).
    const plain = makeState([[0, 'marki', 1, 6, 5], [1, 'sad', 1, 3, 3]], 0, at(2));
    const t = applyMove(plain, mv(plain, 'p0-marki', 8, 5));
    expect(t.pieces.find((p) => p.id === 'p0-marki')!.dir ?? 1).toBe(1);
    const u = applyMove({ ...t, turn: 0 }, mv({ ...t, turn: 0 }, 'p0-marki', 9, 5));
    expect(u.pieces.find((p) => p.id === 'p0-marki')!.dir).toBe(-1);
  });

  it('the engine passes a side whose only piece faces the storm rows; it is a stalemate when neither can act', () => {
    // Blue's only piece is a marki stuck facing row 9: red moves, blue is passed ('noMoves').
    let s = makeState([[0, 'marki', 1, 8, 5], [1, 'sad', 1, 4, 4]], 1, at(3));
    s = applyMove(s, mv(s, 'p1-sad', 4, 3));
    expect(s.turn).toBe(1);
    expect(s.history.some((e) => e.kind === 'pass' && e.player === 0 && e.reason === 'noMoves')).toBe(true);
    expect(s.pieces.find((p) => p.id === 'p0-marki')!.dir ?? 1).toBe(1);
    // Red's walk lands on row 1 facing the storm row 0: now neither side can ever act.
    let t = makeState([[0, 'marki', 1, 8, 5], [1, 'walk', 1, 2, 4]], 1, at(3));
    t = applyMove(t, mv(t, 'p1-walk', 1, 4));
    expect(t.status).toBe('ended');
    expect(t.endReason).toBe('stalemate');
    // Walk 1성 (4) outweighs Marki 1성 (3).
    expect(t.winner).toBe(1);
  });

  it('skills never target the storm: no anchors once it closes in, and the fast fit check rejects storm squares', () => {
    const s = makeState([[0, 'brutile', 3, 4, 4], [1, 'sad', 1, 5, 5], [1, 'walk', 1, 6, 6]], 0, at(3));
    expect(skillAnchors(s, 'p0-brutile')).toEqual([]);
    const b = fastFromState(s);
    // A 1x1 at (0,5) (row 0) or (4,0) (column 0) is storm; (4,3) is open.
    expect(fastSkillFits(b, 1, 0 * BOARD_SIZE + 5)).toBe(false);
    expect(fastSkillFits(b, 1, 4 * BOARD_SIZE + 0)).toBe(false);
    expect(fastSkillFits(b, 1, 4 * BOARD_SIZE + 3)).toBe(true);
    // A 2x2 reaching into row 9 at step 3.
    expect(fastSkillFits(b, 2, 8 * BOARD_SIZE + 4)).toBe(false);
  });

  it('the bot rates a piece on the next storm row as in danger', () => {
    // At step 2 (next: rows 0 / 9 close), a sad on row 0 is worth less than the same sad on row 3.
    const onRow = (r: number) => fastFromState(makeState([[0, 'sad', 2, r, 4], [1, 'sad', 2, 6, 5], [1, 'walk', 1, 7, 4]], 0, at(2, 1)));
    expect(evaluate(onRow(0), 0)).toBeLessThan(evaluate(onRow(3), 0) - 50);
    // The bot steps off a closing row.
    const s = makeState([[0, 'sad', 2, 0, 4], [0, 'walk', 1, 3, 3], [1, 'sad', 2, 6, 5], [1, 'walk', 1, 7, 4]], 0, at(2, 1));
    const a = chooseAction(s, 'hard', { timeBudgetMs: 200, rng: rngFrom(3) });
    expect(a && !isSkillAction(a) && a.pieceId === 'p0-sad' && a.to.r > 0).toBe(true);
  });
});

// ---------------------------------------------------------------- FastBoard parity with storm rows

const ALL: CharacterId[] = ['sad', 'marki', 'walk', 'insaner', 'brutile', 'michelle', 'picker', 'rakaeli'];

describe('FastBoard parity with storm rows', () => {
  it('moves, storm ticks and kills at steps 2-5 make / unmake exactly like the engine (random positions)', () => {
    const rng = rngFrom(4242);
    const buf = new Int32Array(256);
    let checked = 0;
    let rowKills = 0;
    for (let g = 0; g < 300; g++) {
      const step = 2 + (g % 3); // 2, 3, 4: the next tick brings rows 0/9, 1/8 or the whole board
      const pool = [...ALL];
      const pieces: [0 | 1, CharacterId, Level, number, number][] = [];
      const used = new Set<number>();
      for (const owner of [0, 1] as const) {
        for (let k = 0; k < 3; k++) {
          const ch = pool.splice(Math.floor(rng() * pool.length), 1)[0];
          let sq: number;
          do sq = Math.floor(rng() * BOARD_SIZE * BOARD_SIZE);
          while (used.has(sq) || inStorm((sq / BOARD_SIZE) | 0, sq % BOARD_SIZE, step));
          used.add(sq);
          pieces.push([owner, ch, (1 + Math.floor(rng() * 3)) as Level, (sq / BOARD_SIZE) | 0, sq % BOARD_SIZE]);
        }
      }
      const s0 = makeState(pieces, (g % 2) as 0 | 1, at(step, 1 + (g % 2)));
      const s = { ...s0, pieces: s0.pieces.map((p) => (p.character === 'insaner' && rng() < 0.5 ? { ...p, absorbed: [{ character: 'picker' as const, level: 3 as const }, { character: 'walk' as const, level: 2 as const }] } : p)) };
      const legal = getLegalMoves(s);
      const b = fastFromState(s);
      const n = fastGenMoves(b, b.turn, buf, 0);
      for (const m of legal) expect(inStorm(m.to.r, m.to.c, step)).toBe(false);
      expect(Array.from(buf.subarray(0, n)).map((m) => `${b.ids[(m >> 8) & 255]}>${m & 255}`).sort()).toEqual(legal.map((m) => `${m.pieceId}>${m.to.r * BOARD_SIZE + m.to.c}`).sort());
      const snap = () => JSON.stringify([Array.from(b.sq), Array.from(b.occ), b.turn, b.ply, b.storm, b.stormIn, Array.from(b.alive), Array.from(b.material), Array.from(b.dir)]);
      const before = snap();
      for (let k = 0; k < n; k++) {
        const m = fastMoveToMove(b, buf[k]);
        const eng = applyMove(s, m);
        const u = fastMake(b, buf[k]);
        // The engine auto-passes a side left without a move (the search passes on its own): compare
        // only plain turn changes.
        if (eng.history.slice(s.history.length).some((e) => e.kind === 'pass')) {
          fastUnmake(b, buf[k], u);
          continue;
        }
        expect(b.storm).toBe(eng.storm);
        const alive = eng.pieces.map((p) => p.id).sort();
        const fastAlive = b.ids.filter((_, i) => b.sq[i] >= 0).sort();
        expect(fastAlive).toEqual(alive);
        for (const p of eng.pieces) expect(b.sq[b.ids.indexOf(p.id)]).toBe(p.pos.r * BOARD_SIZE + p.pos.c);
        for (const e of eng.history.slice(s.history.length)) {
          if (e.kind !== 'storm') continue;
          for (const id of e.killed) {
            const p = s.pieces.find((q) => q.id === id)!;
            const pos = p.id === m.pieceId ? m.to : p.pos;
            if (pos.c >= e.storm && pos.c < BOARD_SIZE - e.storm) rowKills++; // killed by a row, not a column
          }
        }
        fastUnmake(b, buf[k], u);
        expect(snap()).toBe(before);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2000);
    expect(rowKills).toBeGreaterThan(20);
  });

  it('bot self-play through the storm rows stays legal and bounded', () => {
    const rng = rngFrom(58);
    let rowSteps = 0;
    for (let i = 0; i < 16; i++) {
      const pool = [...ALL];
      const pick = () => pool.splice(Math.floor(rng() * pool.length), 1)[0];
      const lv = Object.fromEntries(ALL.map((id) => [id, (1 + (i % 3)) as Level]));
      let g = createGame(randomFormation(rng, lv, [pick(), pick(), pick()]), randomFormation(rng, lv, [pick(), pick(), pick()]), (i % 2) as 0 | 1);
      while (g.status === 'playing') {
        const a = chooseAction(g, i % 2 ? 'hard' : 'normal', { timeBudgetMs: 3, rng })!;
        const before = g.history.length;
        g = isSkillAction(a) ? applySkill(g, a) : applyMove(g, a as Move);
        for (const e of g.history.slice(before)) if (e.kind === 'storm' && e.storm >= STORM_ROWS_FROM) rowSteps++;
        for (const p of g.pieces) expect(inStorm(p.pos.r, p.pos.c, g.storm)).toBe(false);
      }
      expect(g.ply - chainPlies(g.history)).toBeLessThanOrEqual(MAX_MATCH_PLIES);
    }
    expect(rowSteps).toBeGreaterThan(0);
  }, 60_000);
});

describe('storm status copy (HUD chip / field panel)', () => {
  it('mentions 위아래 once rows are in the storm, and warns the step before', async () => {
    const { stormStatusText } = await import('../src/ui/game/hud');
    expect(stormStatusText(0, 2)).toBe('자기장 활성 · 2턴 후 축소');
    expect(stormStatusText(1, 2)).toBe('자기장 · 좌우 1줄 소멸 · 2턴 후 축소');
    expect(stormStatusText(2, 1)).toBe('자기장 · 좌우 2줄 소멸 · 1턴 후 위아래도 축소');
    expect(stormStatusText(3, 2)).toBe('자기장 · 좌우 3줄 · 위아래 1줄 소멸 · 2턴 후 축소');
    expect(stormStatusText(4, 2)).toBe('자기장 · 좌우 4줄 · 위아래 2줄 소멸 · 2턴 후 축소');
  });
});
