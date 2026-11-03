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
