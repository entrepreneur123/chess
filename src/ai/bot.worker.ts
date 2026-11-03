/// <reference lib="webworker" />
import type { GameState } from '../engine/types';
import { chooseAction } from './bot';
import type { BotAction, Difficulty } from './bot';

export interface BotRequest {
  id: number;
  state: GameState;
  difficulty: Difficulty;
}
export interface BotResponse {
  id: number;
  move: BotAction | null;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, state, difficulty } = e.data;
  let move: BotAction | null = null;
  try {
    move = chooseAction(state, difficulty);
  } catch {
    move = null;
  }
  ctx.postMessage({ id, move } satisfies BotResponse);
};
