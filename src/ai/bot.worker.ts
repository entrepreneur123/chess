/// <reference lib="webworker" />
import type { GameState, Move } from '../engine/types';
import { chooseMove } from './bot';
import type { Difficulty } from './bot';

export interface BotRequest {
  id: number;
  state: GameState;
  difficulty: Difficulty;
}
export interface BotResponse {
  id: number;
  move: Move | null;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, state, difficulty } = e.data;
  let move: Move | null = null;
  try {
    move = chooseMove(state, difficulty);
  } catch {
    move = null;
  }
  ctx.postMessage({ id, move } satisfies BotResponse);
};
