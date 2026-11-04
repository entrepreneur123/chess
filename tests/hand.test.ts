import { describe, expect, it } from 'vitest';
import { SKILL_UNLOCK_PLY, type FormationSlot, type GameState, type Move } from '../src/engine';
import { GameController, type ControllerPorts } from '../src/ui/game/GameController';
import { handModel, selectFromHand, skillReadiness } from '../src/ui/game/hand';
import { makeState } from './helpers';

const ports = (): ControllerPorts => ({
  requestBotMove: () => new Promise<Move | null>(() => {}),
  animate: () => Promise.resolve(),
  botThinkDelayMs: () => 0,
  turnTimeMs: 60_000,
  setTimer: () => 0,
  clearTimer: () => {},
});

// Player 0: sad (2,5), brutile (0,0), walk (0,11). Player 1: marki (9,5).
const position = (extra: Partial<GameState> = {}) =>
  makeState(
    [
      [0, 'sad', 1, 2, 5],
      [0, 'brutile', 2, 0, 0],
      [0, 'walk', 1, 0, 11],
      [1, 'marki', 3, 9, 5],
    ],
    0,
    extra,
  );

const slots: FormationSlot[] = [
  { character: 'sad', level: 1, row: 2, col: 5 },
  { character: 'brutile', level: 2, row: 0, col: 0 },
  { character: 'walk', level: 1, row: 0, col: 11 },
];

describe('hand cards: selection goes through the board tap path', () => {
  it('a card tap selects the piece exactly like tapping its square', () => {
    const viaCard = new GameController(position(), ports());
    const viaBoard = new GameController(position(), ports());
    expect(selectFromHand(viaCard, 'p0-sad')).toBe(true);
    viaBoard.tapCell({ r: 2, c: 5 });
    const a = viaCard.snapshot().selection;
    const b = viaBoard.snapshot().selection;
    expect(a?.pieceId).toBe('p0-sad');
    expect(a?.actionable).toBe(true);
    expect(a?.moves.map((m) => `${m.to.r},${m.to.c}`).sort()).toEqual(b?.moves.map((m) => `${m.to.r},${m.to.c}`).sort());
  });

  it('tapping the selected card again deselects, like the board', () => {
    const c = new GameController(position(), ports());
    selectFromHand(c, 'p0-sad');
    selectFromHand(c, 'p0-sad');
    expect(c.snapshot().selection).toBeNull();
  });

  it('switches the selection between cards', () => {
    const c = new GameController(position(), ports());
    selectFromHand(c, 'p0-sad');
    selectFromHand(c, 'p0-walk');
    expect(c.snapshot().selection?.pieceId).toBe('p0-walk');
  });

  it("a captured piece's card does nothing", () => {
    const c = new GameController(position(), ports());
    selectFromHand(c, 'p0-walk');
    expect(selectFromHand(c, 'p0-marki')).toBe(false);
    expect(c.snapshot().selection?.pieceId).toBe('p0-walk');
  });

  it("during the opponent's turn a card only previews reach (not actionable), like the board", () => {
    const c = new GameController(position({ turn: 1 }), ports());
    // Phase starts as humanTurn until start(); force the bot phase through the public flow.
    (c as unknown as { _phase: string })._phase = 'botThinking';
    selectFromHand(c, 'p0-sad');
    expect(c.snapshot().selection).toMatchObject({ pieceId: 'p0-sad', actionable: false });
  });
});

describe('hand model', () => {
  it('marks captured and selected cards', () => {
    const s = position();
    const withoutWalk: GameState = { ...s, pieces: s.pieces.filter((p) => p.id !== 'p0-walk') };
    const cards = handModel(slots, 0, { state: withoutWalk, selection: { pieceId: 'p0-sad', moves: [], actionable: true } });
    expect(cards.map((c) => [c.pieceId, c.alive, c.selected])).toEqual([
      ['p0-sad', true, true],
      ['p0-brutile', true, false],
      ['p0-walk', false, false],
    ]);
    expect(cards[0].skill).toBeNull();
  });

  it("shows Brutile's skill readiness independent of whose turn it is", () => {
    expect(skillReadiness(position({ ply: 0 }), 'p0-brutile')).toMatchObject({ state: 'locked' });
    expect(skillReadiness(position({ ply: 0 }), 'p0-brutile')?.label).toMatch(/턴 후$/);
    expect(skillReadiness(position({ ply: SKILL_UNLOCK_PLY }), 'p0-brutile')).toMatchObject({ state: 'ready' });
    expect(skillReadiness(position({ ply: SKILL_UNLOCK_PLY + 1, turn: 1 }), 'p0-brutile')).toMatchObject({ state: 'ready' });
    expect(skillReadiness(position({ ply: SKILL_UNLOCK_PLY, skillsUsed: [1, 0] }), 'p0-brutile')).toMatchObject({ state: 'used' });
    expect(skillReadiness(position({ ply: SKILL_UNLOCK_PLY, storm: 1, stormIn: 6 }), 'p0-brutile')).toMatchObject({ state: 'sealed' });
    expect(skillReadiness(position(), 'p0-sad')).toBeNull();
  });
});

describe('hand cards: Michelle traps and doll-trap stuns', () => {
  const mslots: FormationSlot[] = [
    { character: 'michelle', level: 2, row: 2, col: 5 },
    { character: 'picker', level: 1, row: 1, col: 1 },
    { character: 'sad', level: 1, row: 0, col: 11 },
  ];
  const mpos = (extra: Partial<GameState> = {}) =>
    makeState(
      [
        [0, 'michelle', 2, 5, 5],
        [0, 'picker', 1, 1, 1],
        [0, 'sad', 1, 0, 11],
        [1, 'marki', 3, 9, 5],
      ],
      0,
      extra,
    );

  it('Michelle\'s card counts the traps left; nobody else has a count', () => {
    const cards = handModel(mslots, 0, { state: mpos({ trapsLaid: [1, 0] }), selection: null });
    expect(cards.map((c) => c.traps)).toEqual([2, null, null]);
    expect(cards.every((c) => !c.stunned)).toBe(true);
  });

  it('a stunned card shows the stun and cannot be selected', async () => {
    const s = mpos();
    s.pieces = s.pieces.map((p) => (p.id === 'p0-picker' ? { ...p, stun: 1 } : p));
    const ctrl = new GameController(s, ports());
    ctrl.start();
    const cards = handModel(mslots, 0, ctrl.snapshot());
    expect(cards[1].stunned).toBe(true);
    expect(selectFromHand(ctrl, 'p0-picker')).toBe(false);
    expect(ctrl.snapshot().selection).toBeNull();
    expect(selectFromHand(ctrl, 'p0-michelle')).toBe(true);
  });

  it('the controller announces a laid trap, then a stun when the bot lands on it', async () => {
    const events: string[] = [];
    // Michelle steps back from (5,5) and leaves a trap; the bot's sad then lands on (5,5).
    const s = makeState(
      [
        [0, 'michelle', 1, 5, 5],
        [0, 'picker', 3, 0, 0],
        [1, 'sad', 1, 6, 5],
        [1, 'marki', 1, 11, 11],
      ],
      0,
    );
    const botMove: Move = { pieceId: 'p1-sad', from: { r: 6, c: 5 }, to: { r: 5, c: 5 } };
    const p: ControllerPorts = { ...ports(), requestBotMove: () => Promise.resolve(botMove) };
    const ctrl = new GameController(s, p);
    ctrl.on((e) => {
      if (e.type === 'trap' || e.type === 'stun' || e.type === 'multiCapture') events.push(`${e.type}:${e.player}`);
    });
    ctrl.start();
    expect(ctrl.tryHumanMove({ pieceId: 'p0-michelle', from: { r: 5, c: 5 }, to: { r: 4, c: 5 } })).toBe(true);
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.state.traps).toEqual([{ sq: 5 * 12 + 5, owner: 0 }]);
    expect(events).toEqual(['trap:0', 'stun:1']);
    expect(ctrl.state.pieces.find((q) => q.id === 'p1-sad')?.stun).toBe(1);
  });
});
