/**
 * The guided first match (src/meta/tutorialMatch.ts) played through the real engine: every guided
 * step must be legal, allow exactly its one move, and leave the board as the coach text says.
 */
import { describe, expect, it } from 'vitest';
import { applyMove, applySkill, freezeAnchors, getLegalMoves, getPieceById, isLegalMove, pieceDir, skillAnchors, type GameState } from '../src/engine';
import { TUTORIAL_GUIDED_PLIES, tutorialAllows, tutorialBotMove, tutorialCoach, tutorialStart } from '../src/meta/tutorialMatch';

/** My one allowed move at this ply (exactly one must exist). */
function myStep(s: GameState) {
  const allowed = getLegalMoves(s).filter((m) => tutorialAllows(s, m));
  expect(allowed.length, `ply ${s.ply}`).toBe(1);
  return allowed[0];
}

function bot(s: GameState): GameState {
  const m = tutorialBotMove(s);
  expect(m, `ply ${s.ply}: scripted reply`).not.toBeNull();
  expect(isLegalMove(s, m!), `ply ${s.ply}: legal reply ${JSON.stringify(m)}`).toBe(true);
  return applyMove(s, m!);
}

describe('guided first match', () => {
  it('plays every guided step legally and teaches what the coach says', () => {
    let s = tutorialStart();
    expect(s.turn).toBe(0);
    expect(s.pieces.length).toBe(6);

    // ply 0: Marki forward 3 (the only offered move).
    s = applyMove(s, myStep(s));
    expect(getPieceById(s, 'p0-marki')!.pos).toEqual({ r: 4, c: 4 });
    s = bot(s);

    // ply 2: slider capture of the first enemy on the lane.
    const cap = myStep(s);
    expect(cap.captureId).toBe('p1-sad');
    s = applyMove(s, cap);
    s = bot(s);

    // ply 4: reach the enemy's last row: Marki turns around.
    s = applyMove(s, myStep(s));
    expect(pieceDir(getPieceById(s, 'p0-marki')!)).toBe(-1);
    s = bot(s);

    // ply 6: no move is offered; Glacia's freeze is open and the enemy Marki its only target.
    expect(s.ply).toBe(6);
    expect(getLegalMoves(s).filter((m) => tutorialAllows(s, m))).toEqual([]);
    const glacia = getPieceById(s, 'p0-glacia')!;
    expect(freezeAnchors(s, glacia)).toEqual([{ r: 3, c: 8 }]);
    expect(skillAnchors(s, glacia.id)).toEqual([{ r: 3, c: 8 }]);
    s = applySkill(s, { kind: 'skill', pieceId: glacia.id, anchor: { r: 3, c: 8 } });
    expect((getPieceById(s, 'p1-marki')!.stun ?? 0) > 0).toBe(true);
    s = bot(s);

    // ply 8: capture the frozen Marki; one enemy left starts the storm.
    const last = myStep(s);
    expect(last.captureId).toBe('p1-marki');
    s = applyMove(s, last);
    expect(s.pieces.filter((p) => p.owner === 1).map((p) => p.id)).toEqual(['p1-walk']);
    expect(s.stormIn).not.toBeNull();
    expect(s.status).toBe('playing');

    // Free play from here: every legal move allowed, the real AI answers.
    expect(s.ply).toBe(TUTORIAL_GUIDED_PLIES);
    expect(tutorialBotMove(s)).toBeNull();
    s = applyMove(s, getLegalMoves(s)[0]);
    for (const m of getLegalMoves(s)) expect(tutorialAllows(s, m)).toBe(true);
  });

  it('has a coach card for every guided ply and for free play, none once the match ends', () => {
    const s = tutorialStart();
    for (let ply = 0; ply <= TUTORIAL_GUIDED_PLIES + 2; ply++) expect(tutorialCoach({ ...s, ply }, ply % 2 === 0)).not.toBeNull();
    expect(tutorialCoach({ ...s, status: 'ended' }, true)).toBeNull();
  });
});
