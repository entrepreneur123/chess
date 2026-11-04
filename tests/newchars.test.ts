/**
 * Michelle (doll traps, stuns) and Picker (diagonal hop-through): rules, Insaner absorption, the
 * FastBoard used by the bot (make / unmake parity with the engine) and bot play with both.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction, chooseMove, isSkillAction } from '../src/ai/bot';
import {
  BOARD_SIZE,
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
  isLegalMove,
  isStunned,
  randomFormation,
  skillBlock,
  trapsLeft,
  type CharacterId,
  type GameState,
  type Level,
  type Move,
  type Trap,
} from '../src/engine';
import { chainPlies, makeState, keys, rngFrom, targetKeys } from './helpers';

const mv = (state: GameState, pieceId: string, r: number, c: number): Move => {
  const m = getLegalMoves(state, pieceId).find((x) => x.to.r === r && x.to.c === c);
  if (!m) throw new Error(`no legal move ${pieceId} -> ${r},${c}: ${targetKeys(getLegalMoves(state, pieceId)).join(' ')}`);
  return m;
};
/** Play `pieceId` to (r, c) for the side to move. */
const play = (state: GameState, pieceId: string, r: number, c: number) => applyMove(state, mv(state, pieceId, r, c));
const traps = (s: GameState) => (s.traps ?? []).map((t) => `${t.owner}@${t.sq}`);

describe('Michelle movement', () => {
  it('1성: left, right or back 1 (player 0 faces +r)', () => {
    const s = makeState([[0, 'michelle', 1, 5, 5], [1, 'sad', 1, 9, 0]]);
    expect(targetKeys(getLegalMoves(s, 'p0-michelle'))).toEqual(keys([[5, 4], [5, 6], [4, 5]]));
  });

  it('2성: left, right or back up to 2 (slides, blocked by pieces, captures on landing)', () => {
    const s = makeState([[0, 'michelle', 2, 5, 5], [1, 'sad', 1, 5, 6], [0, 'sad', 1, 3, 5]]);
    const t = targetKeys(getLegalMoves(s, 'p0-michelle'));
    expect(t).toEqual(keys([[5, 4], [5, 3], [5, 6], [4, 5]]));
    expect(getLegalMoves(s, 'p0-michelle').find((m) => m.to.c === 6)?.captureId).toBe('p1-sad');
  });

  it('3성: as 2성 plus forward 1', () => {
    const s = makeState([[0, 'michelle', 3, 5, 5], [1, 'sad', 1, 9, 0]]);
    expect(targetKeys(getLegalMoves(s, 'p0-michelle'))).toEqual(keys([[5, 4], [5, 3], [5, 6], [5, 7], [4, 5], [3, 5], [6, 5]]));
  });

  it('player 1 faces -r: back is toward the last row, forward toward r = 0', () => {
    const s = makeState([[1, 'michelle', 3, 5, 5], [0, 'sad', 1, 0, 0]], 1);
    expect(targetKeys(getLegalMoves(s, 'p1-michelle'))).toEqual(keys([[5, 4], [5, 3], [5, 6], [5, 7], [6, 5], [7, 5], [4, 5]]));
    const s1 = makeState([[1, 'michelle', 1, 5, 5], [0, 'sad', 1, 0, 0]], 1);
    expect(targetKeys(getLegalMoves(s1, 'p1-michelle'))).toEqual(keys([[5, 4], [5, 6], [6, 5]]));
  });

  it('never turns around at the far edge (her back stays toward her home rows)', () => {
    let s = makeState([[0, 'michelle', 3, 8, 5], [1, 'sad', 1, 0, 0]]);
    s = play(s, 'p0-michelle', 9, 5);
    const m = s.pieces.find((p) => p.id === 'p0-michelle')!;
    expect(m.dir ?? 1).toBe(1);
  });
});

describe('Michelle doll traps', () => {
  it('only a backward move lays a trap, on the square she left', () => {
    let s = makeState([[0, 'michelle', 2, 5, 5], [1, 'sad', 1, 9, 0]]);
    s = play(s, 'p0-michelle', 5, 6); // sideways: nothing
    expect(traps(s)).toEqual([]);
    s = play(s, 'p1-sad', 9, 1);
    s = play(s, 'p0-michelle', 3, 6); // back 2
    expect(traps(s)).toEqual([`0@${5 * BOARD_SIZE + 6}`]);
    const last = s.history.find((e) => e.kind === 'move' && e.player === 0 && e.move.to.r === 3);
    expect(last?.kind === 'move' && last.move.trap).toBe(true);
    expect(trapsLeft(s, 0)).toBe(2);
  });

  it('at most 3 traps per Michelle, and they never disappear', () => {
    let s = makeState([[0, 'michelle', 3, 8, 5], [0, 'marki', 1, 0, 9], [1, 'sad', 1, 9, 0], [1, 'walk', 1, 9, 9]]);
    const back = () => {
      const m = s.pieces.find((p) => p.id === 'p0-michelle')!;
      s = play(s, 'p0-michelle', m.pos.r - 1, m.pos.c);
      const e = s.pieces.find((p) => p.id === 'p1-sad')!;
      s = play(s, 'p1-sad', e.pos.r, e.pos.c === 0 ? 1 : 0);
    };
    for (let i = 0; i < 5; i++) back();
    // She left rows 8, 7 and 6: the 4th and 5th backward moves lay nothing.
    expect(traps(s)).toEqual([`0@${6 * BOARD_SIZE + 5}`, `0@${7 * BOARD_SIZE + 5}`, `0@${8 * BOARD_SIZE + 5}`]);
    expect(trapsLeft(s, 0)).toBe(0);
    expect(s.trapsLaid).toEqual([3, 0]);
    // 20 more plies: still there.
    for (let i = 0; i < 10; i++) {
      const m = s.pieces.find((p) => p.id === 'p0-michelle')!;
      s = play(s, 'p0-michelle', m.pos.r, m.pos.c === 5 ? 4 : 5);
      const e = s.pieces.find((p) => p.id === 'p1-sad')!;
      s = play(s, 'p1-sad', e.pos.r, e.pos.c === 0 ? 1 : 0);
    }
    expect(s.traps?.length).toBe(3);
  });

  it('a trap stuns an enemy that ENDS its move on it, for exactly its owner\'s next turn', () => {
    // Player 0's trap at (6,5). Player 1's sad steps onto it.
    const trap: Trap = { sq: 6 * BOARD_SIZE + 5, owner: 0 };
    let s = makeState([[0, 'sad', 1, 0, 0], [1, 'sad', 1, 7, 5], [1, 'marki', 1, 9, 9]], 1, { traps: [trap], trapsLaid: [1, 0] });
    s = play(s, 'p1-sad', 6, 5);
    const caught = s.history[s.history.length - 1];
    expect(caught.kind === 'move' && caught.move.stunned).toBe(true);
    expect(isStunned(s.pieces.find((p) => p.id === 'p1-sad')!)).toBe(true);
    // Player 0 moves; then it is player 1's turn: the sad cannot move, the marki can.
    s = play(s, 'p0-sad', 0, 1);
    expect(s.turn).toBe(1);
    expect(getLegalMoves(s, 'p1-sad')).toEqual([]);
    expect(getTargetsForPiece(s, s.pieces.find((p) => p.id === 'p1-sad')!)).toEqual([]);
    expect(getLegalMoves(s, 'p1-marki').length).toBeGreaterThan(0);
    s = play(s, 'p1-marki', 8, 9);
    s = play(s, 'p0-sad', 0, 0);
    // Its owner's next turn is over: free again.
    expect(isStunned(s.pieces.find((p) => p.id === 'p1-sad')!)).toBe(false);
    expect(getLegalMoves(s, 'p1-sad').length).toBeGreaterThan(0);
  });

  it('passing over a trap does not catch a slider; the own side ignores its own traps', () => {
    const trap: Trap = { sq: 6 * BOARD_SIZE + 5, owner: 0 };
    let s = makeState([[0, 'sad', 3, 0, 0], [1, 'sad', 3, 7, 5]], 1, { traps: [trap] });
    s = play(s, 'p1-sad', 4, 5); // slides over (6,5)
    expect(isStunned(s.pieces.find((p) => p.id === 'p1-sad')!)).toBe(false);
    let own = makeState([[0, 'sad', 1, 7, 5], [1, 'sad', 1, 9, 0]], 0, { traps: [trap] });
    own = play(own, 'p0-sad', 6, 5);
    expect(isStunned(own.pieces.find((p) => p.id === 'p0-sad')!)).toBe(false);
    const last = own.history[own.history.length - 1];
    expect(last.kind === 'move' && last.move.stunned).toBeFalsy();
  });

  it('a stunned Brutile cannot cast its skill either', () => {
    const s = makeState([[0, 'brutile', 1, 2, 2], [0, 'sad', 1, 0, 0], [1, 'sad', 1, 9, 0]], 0, { ply: 8 });
    expect(skillBlock(s, 'p0-brutile')).toBeNull();
    const stunned: GameState = { ...s, pieces: s.pieces.map((p) => (p.id === 'p0-brutile' ? { ...p, stun: 1 } : p)) };
    expect(skillBlock(stunned, 'p0-brutile')).toBe('stunned');
    expect(() => applySkill(stunned, { kind: 'skill', pieceId: 'p0-brutile', anchor: { r: 6, c: 6 } })).toThrow();
  });

  it('when every piece that could move is stunned, the turn passes automatically', () => {
    const trap: Trap = { sq: 6 * BOARD_SIZE + 5, owner: 0 };
    let s = makeState([[0, 'sad', 1, 0, 0], [1, 'sad', 1, 7, 5]], 1, { traps: [trap] });
    s = play(s, 'p1-sad', 6, 5); // caught
    s = play(s, 'p0-sad', 0, 1);
    // Player 1's only piece is stunned: its turn was passed with reason 'stunned', player 0 moves again.
    expect(s.turn).toBe(0);
    const pass = s.history[s.history.length - 1];
    expect(pass).toEqual({ kind: 'pass', player: 1, reason: 'stunned' });
    expect(s.status).toBe('playing');
    s = play(s, 'p0-sad', 0, 0);
    expect(s.turn).toBe(1);
    expect(getLegalMoves(s, 'p1-sad').length).toBeGreaterThan(0);
  });

  it('a 3성 Insaner caught by a trap on its capture gets no chain move', () => {
    const trap: Trap = { sq: 6 * BOARD_SIZE + 5, owner: 0 };
    const s0 = makeState([[0, 'sad', 1, 6, 5], [0, 'marki', 1, 0, 0], [1, 'insaner', 3, 8, 5]], 1, { traps: [trap] });
    const s = play(s0, 'p1-insaner', 6, 5);
    expect(s.bonusPieceId).toBeNull();
    expect(s.turn).toBe(0);
    expect(isStunned(s.pieces.find((p) => p.id === 'p1-insaner')!)).toBe(true);
  });
});

describe('Picker hop-through', () => {
  it('ranges 1 / 2 / 3 on the four diagonals', () => {
    for (const lv of [1, 2, 3] as Level[]) {
      const s = makeState([[0, 'picker', lv, 5, 5], [1, 'sad', 1, 9, 0]]);
      const t = targetKeys(getLegalMoves(s, 'p0-picker'));
      const want: [number, number][] = [];
      for (let k = 1; k <= lv; k++) for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) want.push([5 + dr * k, 5 + dc * k]);
      expect(t).toEqual(keys(want));
    }
  });

  it('captures every enemy on the path and lands beyond them (spec example)', () => {
    // 3성 Picker taps the 3rd square up-left while an enemy stands on the 2nd.
    let s = makeState([[0, 'picker', 3, 2, 5], [1, 'sad', 1, 4, 3], [1, 'marki', 1, 3, 4], [1, 'walk', 1, 9, 9]]);
    const m = mv(s, 'p0-picker', 5, 2);
    expect(capturedIds(m)).toEqual(['p1-marki', 'p1-sad']);
    expect(m.captureId).toBe('p1-marki');
    s = applyMove(s, m);
    expect(s.pieces.map((p) => p.id).sort()).toEqual(['p0-picker', 'p1-walk']);
    expect(s.pieces.find((p) => p.id === 'p0-picker')!.pos).toEqual({ r: 5, c: 2 });
    const rec = s.history[0];
    expect(rec.kind === 'move' && rec.move.captureIds).toEqual(['p1-marki', 'p1-sad']);
    expect(s.pliesSinceCapture).toBe(0);
  });

  it('a capture on the way and one on the landing square: both taken, and a win by elimination', () => {
    let s = makeState([[0, 'picker', 2, 2, 2], [1, 'sad', 1, 3, 3], [1, 'marki', 1, 4, 4]]);
    s = play(s, 'p0-picker', 4, 4);
    expect(s.status).toBe('ended');
    expect(s.winner).toBe(0);
    expect(s.endReason).toBe('elimination');
  });

  it('hops over his own pieces, but cannot land on one', () => {
    const s = makeState([[0, 'picker', 3, 2, 2], [0, 'sad', 1, 3, 3], [0, 'marki', 1, 5, 5], [1, 'sad', 1, 9, 0]]);
    const t = targetKeys(getLegalMoves(s, 'p0-picker'));
    expect(t).toContain('4,4');
    expect(t).not.toContain('3,3');
    expect(t).not.toContain('5,5');
    const after = play(s, 'p0-picker', 4, 4);
    expect(after.pieces.length).toBe(4); // nobody captured
  });

  it('stops at (and may land on) the first enemy trap, and is caught there', () => {
    const trap: Trap = { sq: 4 * BOARD_SIZE + 4, owner: 1 };
    let s = makeState([[0, 'picker', 3, 2, 2], [1, 'sad', 1, 3, 3], [1, 'marki', 1, 9, 9]], 0, { traps: [trap] });
    const t = targetKeys(getLegalMoves(s, 'p0-picker'));
    expect(t).toContain('4,4');
    expect(t).not.toContain('5,5');
    s = play(s, 'p0-picker', 4, 4);
    expect(s.pieces.some((p) => p.id === 'p1-sad')).toBe(false); // captured on the way
    expect(isStunned(s.pieces.find((p) => p.id === 'p0-picker')!)).toBe(true);
    // His own side's trap does not stop him.
    const ownTrap = makeState([[0, 'picker', 3, 2, 2], [1, 'sad', 1, 9, 0]], 0, { traps: [{ sq: 3 * BOARD_SIZE + 3, owner: 0 }] });
    expect(targetKeys(getLegalMoves(ownTrap, 'p0-picker'))).toContain('5,5');
  });

  it('an own piece standing on an enemy trap ends the hop without a landing square', () => {
    const trap: Trap = { sq: 3 * BOARD_SIZE + 3, owner: 1 };
    const s = makeState([[0, 'picker', 3, 2, 2], [0, 'sad', 1, 3, 3], [1, 'sad', 1, 9, 0]], 0, { traps: [trap] });
    const t = targetKeys(getLegalMoves(s, 'p0-picker'));
    expect(t).not.toContain('3,3');
    expect(t).not.toContain('4,4');
  });

  it('wasteland on the path kills him there (the path ends on it), after capturing on the way', () => {
    let s = makeState([[0, 'picker', 3, 2, 2], [1, 'sad', 1, 3, 3], [1, 'marki', 1, 9, 9]], 0, { waste: [4 * BOARD_SIZE + 4] });
    const t = targetKeys(getLegalMoves(s, 'p0-picker'));
    expect(t).toContain('4,4');
    expect(t).not.toContain('5,5');
    s = play(s, 'p0-picker', 4, 4);
    expect(s.pieces.some((p) => p.id === 'p0-picker')).toBe(false);
    expect(s.pieces.some((p) => p.id === 'p1-sad')).toBe(false);
    const rec = s.history[0];
    expect(rec.kind === 'move' && rec.move.wasted).toBe(true);
    expect(s.endReason).toBe('waste');
  });

  it('the storm blocks the path like the board edge', () => {
    const s = makeState([[0, 'picker', 3, 5, 3], [1, 'sad', 1, 9, 5]], 0, { storm: 1, stormIn: 6 });
    const t = targetKeys(getLegalMoves(s, 'p0-picker'));
    expect(t).toContain('7,1');
    expect(t).not.toContain('8,0');
  });
});

describe('Insaner absorbs the new characters', () => {
  it('absorbs Michelle\'s movement (not her traps)', () => {
    let s = makeState([[0, 'insaner', 1, 5, 5], [1, 'michelle', 3, 5, 6], [1, 'sad', 1, 9, 0]]);
    s = play(s, 'p0-insaner', 5, 6);
    const ins = s.pieces.find((p) => p.id === 'p0-insaner')!;
    expect(ins.absorbed).toEqual([{ character: 'michelle', level: 3 }]);
    s = play(s, 'p1-sad', 9, 1);
    // A backward move of the Insaner lays nothing.
    s = play(s, 'p0-insaner', 4, 6);
    expect(s.traps ?? []).toEqual([]);
  });

  it('absorbs Picker\'s hop-through: it then captures everything on a hop', () => {
    let s = makeState([[0, 'insaner', 1, 2, 2], [1, 'picker', 3, 2, 3], [1, 'sad', 1, 4, 4], [1, 'marki', 1, 5, 5], [1, 'walk', 1, 9, 0]]);
    s = play(s, 'p0-insaner', 2, 3);
    expect(s.pieces.find((p) => p.id === 'p0-insaner')!.absorbed).toEqual([{ character: 'picker', level: 3 }]);
    s = play(s, 'p1-walk', 8, 0);
    // From (2,3) the hop up-right goes (3,4) (4,5) (5,6): put victims there.
    const s2: GameState = {
      ...s,
      pieces: s.pieces.map((p) => (p.id === 'p1-sad' ? { ...p, pos: { r: 3, c: 4 } } : p.id === 'p1-marki' ? { ...p, pos: { r: 4, c: 5 } } : p)),
    };
    const m = mv(s2, 'p0-insaner', 5, 6);
    expect(capturedIds(m).sort()).toEqual(['p1-marki', 'p1-sad']);
    const s3 = applyMove(s2, m);
    const ins = s3.pieces.find((p) => p.id === 'p0-insaner')!;
    expect(ins.absorbed?.map((a) => a.character).sort()).toEqual(['marki', 'picker', 'sad']);
  });

  it('a 3성 Insaner\'s hop multi-capture earns one chain move, like any capture', () => {
    const s = makeState(
      [[0, 'insaner', 3, 2, 2], [1, 'sad', 1, 3, 3], [1, 'marki', 1, 4, 4], [1, 'walk', 1, 9, 0]],
      0,
    );
    const withHop: GameState = { ...s, pieces: s.pieces.map((p) => (p.id === 'p0-insaner' ? { ...p, absorbed: [{ character: 'picker', level: 3 }] } : p)) };
    const after = play(withHop, 'p0-insaner', 5, 5);
    expect(after.pieces.filter((p) => p.owner === 1).map((p) => p.id)).toEqual(['p1-walk']);
    expect(after.bonusPieceId).toBe('p0-insaner');
    expect(after.turn).toBe(0);
  });
});

// ---------------------------------------------------------------- FastBoard parity

const NEW_SQUADS: CharacterId[][] = [
  ['michelle', 'picker', 'insaner'],
  ['picker', 'michelle', 'brutile'],
  ['michelle', 'sad', 'picker'],
  ['picker', 'walk', 'michelle'],
  ['insaner', 'picker', 'marki'],
];
const randLv = (rng: () => number): Partial<Record<CharacterId, Level>> => {
  const l = () => (1 + Math.floor(rng() * 3)) as Level;
  return { sad: l(), marki: l(), walk: l(), insaner: l(), brutile: l(), michelle: l(), picker: l() };
};
const sig = (s: GameState) =>
  JSON.stringify({
    pieces: [...s.pieces]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => [p.id, p.pos.r, p.pos.c, p.dir ?? 0, p.stun ?? 0, (p.absorbed ?? []).map((a) => a.character + a.level).sort().join()]),
    turn: s.turn,
    traps: (s.traps ?? []).map((t) => t.sq * 2 + t.owner).sort((a, b) => a - b),
    laid: s.trapsLaid ?? [0, 0],
  });
function fastSig(b: ReturnType<typeof fastFromState>): string {
  const pieces: (string | number)[][] = [];
  for (let i = 0; i < b.n; i++) {
    if (b.sq[i] < 0) continue;
    const abs: string[] = [];
    for (let bit = 0; bit < 21; bit++) if (b.absorb[i] & (1 << bit)) abs.push(['sad', 'marki', 'walk', 'insaner', 'brutile', 'michelle', 'picker'][(bit / 3) | 0] + ((bit % 3) + 1));
    pieces.push([b.ids[i], (b.sq[i] / BOARD_SIZE) | 0, b.sq[i] % BOARD_SIZE, b.ch[i] === 0 || b.ch[i] >= 5 ? 0 : b.dir[i], b.stun[i], abs.sort().join()]);
  }
  pieces.sort((a, c) => String(a[0]).localeCompare(String(c[0])));
  const tr: number[] = [];
  for (let s = 0; s < BOARD_SIZE * BOARD_SIZE; s++) for (const o of [0, 1]) if (b.trap[s] & (o === 0 ? 1 : 2)) tr.push(s * 2 + o);
  return JSON.stringify({ pieces, turn: b.turn, traps: tr.sort((a, c) => a - c), laid: [b.trapsLaid[0], b.trapsLaid[1]] });
}
/** Normalise dir in the engine signature the same way (only directional movers carry one). */
const sigNorm = (s: GameState) =>
  sig({ ...s, pieces: s.pieces.map((p) => (p.character === 'sad' || p.character === 'michelle' || p.character === 'picker' ? { ...p, dir: undefined } : { ...p, dir: p.dir ?? (p.owner === 0 ? 1 : -1) })) });

/** fastMake of every legal move matches applyMove; fastUnmake restores the board exactly. */
function checkPosition(s: GameState): number {
  const buf = new Int32Array(256);
  const b = fastFromState(s);
  const n = fastGenMoves(b, b.turn, buf, 0);
  expect(n).toBe(getLegalMoves(s).length);
  const before = fastSig(b);
  let multi = 0;
  for (let k = 0; k < n; k++) {
    const asMove = fastMoveToMove(b, buf[k]);
    const eng = applyMove(s, asMove);
    if (capturedIds(asMove).length > 1) multi++;
    const undo = fastMake(b, buf[k]);
    if (eng.status === 'playing' && eng.history.length === s.history.length + 1) expect(fastSig(b)).toBe(sigNorm(eng));
    else expect([b.alive[0], b.alive[1]]).toEqual([eng.pieces.filter((p) => p.owner === 0).length, eng.pieces.filter((p) => p.owner === 1).length]);
    fastUnmake(b, buf[k], undo);
    expect(fastSig(b)).toBe(before);
  }
  return multi;
}

describe('FastBoard parity with the engine (new characters)', () => {
  it('multi-captures, hops over allies, trap stops and wasteland deaths match exactly', () => {
    let multi = 0;
    multi += checkPosition(makeState([[0, 'picker', 3, 2, 5], [0, 'sad', 1, 0, 0], [1, 'sad', 1, 4, 3], [1, 'marki', 1, 3, 4], [1, 'walk', 1, 9, 9]]));
    multi += checkPosition(makeState([[0, 'picker', 3, 2, 2], [0, 'sad', 1, 3, 3], [1, 'marki', 2, 4, 4], [1, 'walk', 2, 5, 5]]));
    multi += checkPosition(makeState([[0, 'picker', 3, 2, 2], [1, 'sad', 1, 3, 3], [1, 'marki', 1, 4, 4], [1, 'walk', 1, 9, 0]], 0, { waste: [5 * BOARD_SIZE + 5] }));
    multi += checkPosition(makeState([[0, 'picker', 3, 2, 2], [1, 'sad', 1, 3, 3], [1, 'marki', 1, 4, 4], [1, 'walk', 1, 9, 0]], 0, { traps: [{ sq: 4 * BOARD_SIZE + 4, owner: 1 }] }));
    const ins = makeState([[0, 'insaner', 3, 2, 2], [1, 'sad', 1, 3, 3], [1, 'marki', 1, 4, 4], [1, 'walk', 1, 9, 0]]);
    multi += checkPosition({ ...ins, pieces: ins.pieces.map((p) => (p.id === 'p0-insaner' ? { ...p, absorbed: [{ character: 'picker', level: 3 }] } : p)) });
    expect(multi).toBeGreaterThanOrEqual(5);
  });

  it('generates the same moves and makes / unmakes them exactly, over random games', () => {
    const rng = rngFrom(777);
    const buf = new Int32Array(256);
    let checkedMoves = 0;
    let hopCaps = 0;
    let trapsSeen = 0;
    let stunsSeen = 0;
    for (let g = 0; g < 60; g++) {
      const sq0 = NEW_SQUADS[g % NEW_SQUADS.length];
      const sq1 = NEW_SQUADS[(g + 2) % NEW_SQUADS.length];
      let s = createGame(randomFormation(rng, randLv(rng), sq0), randomFormation(rng, randLv(rng), sq1), (g % 2) as 0 | 1);
      for (let ply = 0; ply < 140 && s.status === 'playing'; ply++) {
        const legal = getLegalMoves(s);
        const b = fastFromState(s);
        const n = fastGenMoves(b, b.turn, buf, 0);
        const fastKeys = Array.from(buf.subarray(0, n)).map((m) => `${b.ids[(m >> 8) & 255]}>${m & 255}`).sort();
        const engKeys = legal.map((m) => `${m.pieceId}>${m.to.r * BOARD_SIZE + m.to.c}`).sort();
        expect(fastKeys).toEqual(engKeys);
        if (legal.length === 0) break; // only a cast is left; covered elsewhere
        // Every move: fastMake matches applyMove (turn, pieces, stuns, traps), fastUnmake restores.
        const before = fastSig(b);
        for (let k = 0; k < n; k++) {
          const code = buf[k];
          const asMove = fastMoveToMove(b, code);
          const eng = applyMove(s, asMove);
          if (capturedIds(asMove).length > 1) hopCaps++;
          const rec = eng.history[s.history.length];
          if (rec?.kind === 'move' && rec.move.stunned) stunsSeen++;
          expect(capturedIds(asMove).sort()).toEqual(capturedIds(legal.find((m) => m.pieceId === asMove.pieceId && m.to.r === asMove.to.r && m.to.c === asMove.to.c)!).sort());
          const undo = fastMake(b, code);
          if (eng.status === 'playing' && eng.history.length === s.history.length + 1) {
            // Plain turn change (no auto-pass / storm side effects beyond what fast models).
            expect(fastSig(b)).toBe(sigNorm(eng));
          }
          fastUnmake(b, code, undo);
          expect(fastSig(b)).toBe(before);
          checkedMoves++;
        }
        const m = legal[Math.floor(rng() * legal.length)];
        s = applyMove(s, m);
        trapsSeen = Math.max(trapsSeen, s.traps?.length ?? 0);
      }
    }
    expect(checkedMoves).toBeGreaterThan(5000);
    expect(trapsSeen).toBeGreaterThan(0);
    // The checked moves exercised trap catches (multi-captures are rare in random play: below).
    expect(stunsSeen).toBeGreaterThan(0);
    expect(hopCaps).toBeGreaterThanOrEqual(0);
  }, 120_000);
});

// ---------------------------------------------------------------- bot

describe('bot with Michelle and Picker on both sides', () => {
  it('plays legal games to termination (easy / normal), never stuck', () => {
    const rng = rngFrom(4242);
    const reasons: Record<string, number> = {};
    for (let i = 0; i < 24; i++) {
      const sq0 = NEW_SQUADS[i % NEW_SQUADS.length];
      const sq1 = NEW_SQUADS[(i + 1) % NEW_SQUADS.length];
      let g = createGame(randomFormation(rng, randLv(rng), sq0), randomFormation(rng, randLv(rng), sq1), (i % 2) as 0 | 1);
      let guard = 0;
      while (g.status === 'playing') {
        guard++;
        expect(guard).toBeLessThan(400);
        const a = chooseAction(g, i % 3 === 0 ? 'normal' : 'easy', { timeBudgetMs: 4, rng });
        expect(a).not.toBeNull();
        g = isSkillAction(a) ? applySkill(g, a!) : applyMove(g, a as Move);
      }
      // Every ply but a chain move is a turn change: the storm bounds those to MAX_MATCH_PLIES.
      expect(g.ply - chainPlies(g.history)).toBeLessThanOrEqual(MAX_MATCH_PLIES);
      reasons[g.endReason!] = (reasons[g.endReason!] ?? 0) + 1;
    }
    expect(Object.values(reasons).reduce((x, y) => x + y, 0)).toBe(24);
  }, 120_000);

  it('takes a free double capture with Picker', () => {
    const s = makeState([[0, 'picker', 3, 2, 2], [0, 'sad', 1, 0, 9], [1, 'marki', 2, 3, 3], [1, 'walk', 2, 4, 4], [1, 'sad', 1, 9, 0]]);
    const m = chooseMove(s, 'normal', { timeBudgetMs: 60, rng: rngFrom(1) });
    expect(m && isLegalMove(s, m)).toBe(true);
    expect(capturedIds(m!).length).toBeGreaterThanOrEqual(2);
  });

  it('the worker answers with a legal action for a structured-cloned state', async () => {
    const posted: unknown[] = [];
    const g = globalThis as unknown as { self?: unknown };
    const prevSelf = g.self;
    const fake: { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void } = { onmessage: null, postMessage: (m) => posted.push(m) };
    g.self = fake;
    try {
      await import('../src/ai/bot.worker');
      const trap: Trap = { sq: 6 * BOARD_SIZE + 5, owner: 0 };
      const state = makeState([[0, 'michelle', 2, 5, 5], [0, 'picker', 2, 2, 2], [1, 'picker', 3, 9, 9], [1, 'michelle', 1, 7, 5]], 1, {
        traps: [trap],
        trapsLaid: [1, 0],
      });
      state.pieces[3] = { ...state.pieces[3], stun: 1 };
      const cloned = structuredClone({ id: 7, state, difficulty: 'normal' });
      fake.onmessage!({ data: cloned } as MessageEvent);
      const reply = posted[0] as { id: number; move: Move | null };
      expect(reply.id).toBe(7);
      expect(reply.move).not.toBeNull();
      expect(reply.move!.pieceId).not.toBe('p1-michelle'); // stunned
      expect(isLegalMove(state, reply.move!)).toBe(true);
    } finally {
      g.self = prevSelf;
    }
  });
});

describe('draws and termination are unaffected', () => {
  it('a stun is not a stalemate: the stuck side passes until the stunned side can play again', () => {
    // Player 0's only piece is a Marki facing off the board (no move at all); player 1's sad steps
    // onto player 0's trap. The old rule would have called that a stalemate (nobody can move now).
    const trap: Trap = { sq: 6 * BOARD_SIZE + 5, owner: 0 };
    const s0 = makeState([[0, 'marki', 1, 9, 0], [1, 'sad', 1, 7, 5]], 1, { traps: [trap] });
    s0.pieces[0] = { ...s0.pieces[0], dir: 1 };
    expect(getLegalMoves({ ...s0, turn: 0 }).length).toBe(0);
    const s = play(s0, 'p1-sad', 6, 5);
    expect(s.status).toBe('playing');
    expect(s.turn).toBe(1);
    expect(s.history.slice(1)).toEqual([
      { kind: 'pass', player: 0, reason: 'noMoves' },
      { kind: 'pass', player: 1, reason: 'stunned' },
      { kind: 'pass', player: 0, reason: 'noMoves' },
    ]);
    expect(getLegalMoves(s, 'p1-sad').length).toBeGreaterThan(0);
  });
});
