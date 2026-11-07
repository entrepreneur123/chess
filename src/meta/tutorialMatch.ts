/**
 * The guided first match (owner 2026-11-08: "튜토리얼을 실제로 맨 처음에 한판 하게, 실제로 플레이하면서
 * 설명"). A brand-new account plays this before anything else: a real match on a prepared position
 * where each step allows only the move it teaches (the rest are not offered), the AI answers with
 * scripted moves, and a coach card explains every rule the moment it happens on the board:
 *
 *   ply 0  move: tap Marki, tap a glowing square (forward 3)
 *   ply 2  slider capture: the first enemy on the lane (Sad)
 *   ply 4  reach the enemy's last row: Marki turns around (the arrow flips)
 *   ply 6  skills unlock at turn 4: Glacia freezes the enemy Marki next to her
 *   ply 8  capture the frozen Marki; one enemy left starts the storm
 *   ply 9+ free play against the easy AI: finish the last enemy (Walk) before the storm closes in
 *
 * Pure (engine only): the game screen asks it for the start state, the allowed move, the AI's
 * scripted reply and the coach text. tests/tutorial-match.test.ts plays the whole script.
 */
import { createGame } from '../engine/rules';
import type { Formation, GameState, Move, Piece, Pos } from '../engine/types';

/** The tutorial squad (hand cards / field panel); the board position comes from tutorialStart. */
export const TUTORIAL_PLAYER: Formation = [
  { character: 'walk', level: 1, row: 0, col: 2 },
  { character: 'marki', level: 1, row: 1, col: 4 },
  { character: 'glacia', level: 1, row: 1, col: 7 },
];
export const TUTORIAL_BOT: Formation = [
  { character: 'sad', level: 1, row: 1, col: 5 },
  { character: 'marki', level: 1, row: 1, col: 1 },
  { character: 'walk', level: 1, row: 0, col: 9 },
];
export const TUTORIAL_OPPONENT = '훈련 교관';

/** Prepared position (board rows: 0 = my back row, 9 = the enemy's). */
const START: Record<string, Pos> = {
  'p0-walk': { r: 0, c: 2 },
  'p0-marki': { r: 1, c: 4 },
  'p0-glacia': { r: 2, c: 7 },
  'p1-sad': { r: 6, c: 4 },
  'p1-marki': { r: 8, c: 8 },
  'p1-walk': { r: 9, c: 0 },
};

/** The start state: I move first, from the prepared position. */
export function tutorialStart(): GameState {
  const g = createGame(TUTORIAL_PLAYER, TUTORIAL_BOT, 0);
  const pieces: Piece[] = g.pieces.map((p) => ({ ...p, pos: { ...START[p.id] } }));
  return { ...g, pieces };
}

interface ScriptedMove {
  pieceId: string;
  to: Pos;
}

/** The one move each of my guided turns allows (null: no move, a skill is the step). */
const MY_STEPS: Record<number, ScriptedMove | null> = {
  0: { pieceId: 'p0-marki', to: { r: 4, c: 4 } },
  2: { pieceId: 'p0-marki', to: { r: 6, c: 4 } },
  4: { pieceId: 'p0-marki', to: { r: 9, c: 4 } },
  6: null,
  8: { pieceId: 'p0-glacia', to: { r: 3, c: 8 } },
};

/** The AI's scripted replies (afterwards it plays as the easy AI). */
const BOT_STEPS: Record<number, ScriptedMove> = {
  1: { pieceId: 'p1-marki', to: { r: 5, c: 8 } },
  3: { pieceId: 'p1-marki', to: { r: 3, c: 8 } },
  5: { pieceId: 'p1-walk', to: { r: 8, c: 1 } },
  7: { pieceId: 'p1-walk', to: { r: 7, c: 2 } },
};

/** The last guided ply; from the next one the match is free play. */
export const TUTORIAL_GUIDED_PLIES = 9;

/** Is this move of mine allowed now? (Free play: any legal move.) */
export function tutorialAllows(state: Pick<GameState, 'ply'>, move: Pick<Move, 'pieceId' | 'to'>): boolean {
  if (!(state.ply in MY_STEPS)) return true;
  const step = MY_STEPS[state.ply];
  return !!step && step.pieceId === move.pieceId && step.to.r === move.to.r && step.to.c === move.to.c;
}

/** The AI's scripted reply at this ply, or null (free play: the real AI answers). */
export function tutorialBotMove(state: Pick<GameState, 'ply' | 'pieces'>): Move | null {
  const step = BOT_STEPS[state.ply];
  if (!step) return null;
  const p = state.pieces.find((q) => q.id === step.pieceId);
  if (!p) return null;
  const victim = state.pieces.find((q) => q.pos.r === step.to.r && q.pos.c === step.to.c);
  return { pieceId: p.id, from: { ...p.pos }, to: { ...step.to }, ...(victim ? { captureId: victim.id } : {}) };
}

export interface TutorialCoach {
  /** "2/6" style progress (empty in free play). */
  step: string;
  title: string;
  body: string;
}

/** The coach card for the current ply. `myTurn`: whether it is my move. */
export function tutorialCoach(state: Pick<GameState, 'ply' | 'status' | 'stormIn' | 'storm'>, myTurn: boolean): TutorialCoach | null {
  if (state.status !== 'playing') return null;
  switch (state.ply) {
    case 0:
      return { step: '1/6', title: '말을 움직여 보세요', body: '마르키를 누르고, 가장 먼 빛나는 칸을 눌러 전진! 말을 끌어다 놓아도 돼요.' };
    case 1:
      return { step: '1/6', title: '이제 상대 차례', body: '서로 한 수씩 번갈아 둬요. 상대의 수를 지켜보세요.' };
    case 2:
      return { step: '2/6', title: '슬라이더로 잡기', body: '마르키는 길을 따라 미끄러지는 슬라이더예요. 길 위의 첫 적(빨간 링)을 눌러 잡아요.' };
    case 3:
      return { step: '2/6', title: '잡았어요!', body: '상대 말 3개를 모두 잡으면 승리! 월크 같은 점퍼는 사이의 말을 뛰어넘어요.' };
    case 4:
      return { step: '3/6', title: '적진 끝줄까지!', body: '마르키를 맨 위 끝줄로! 끝줄에 닿으면 방향이 바뀌어요.' };
    case 5:
      return { step: '3/6', title: '방향 전환!', body: '이제 마르키의 앞은 아래쪽. 말과 카드의 ▼ 화살표가 지금 앞 방향이에요.' };
    case 6:
      return { step: '4/6', title: '스킬은 4턴째부터', body: '글라시아 카드의 스킬 버튼을 눌러 옆의 마르키를 얼려요. 스킬은 한 판에 1번, 쓰면 턴 끝!' };
    case 7:
      return { step: '4/6', title: '얼어붙었어요', body: '얼거나 함정에 걸린 말은 다음 1턴 동안 못 움직여요.' };
    case 8:
      return { step: '5/6', title: '얼린 적을 잡아요', body: '글라시아는 대각선 1칸으로 잡을 수 있어요. 얼어붙은 마르키를 잡아요!' };
    default:
      if (state.stormIn !== null || state.storm > 0)
        return {
          step: '6/6',
          title: myTurn ? '마지막 적을 잡아 승리!' : '자기장 발동!',
          body: '적이 1개 남거나 20턴이 되면 시작! 2턴마다 좁혀와 가운데 2×2만 남고, 5턴 뒤 전부 사라져요.',
        };
      return { step: '6/6', title: '이제 자유롭게!', body: 'AI 대전은 시간 제한이 없고, ≡ 메뉴를 열면 일시정지돼요.' };
  }
}
