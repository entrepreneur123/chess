import type { GameState, Move } from '../engine/types';
import { chooseMove } from './bot';
import type { Difficulty } from './bot';

interface Pending {
  id: number;
  state: GameState;
  difficulty: Difficulty;
  resolve: (m: Move | null) => void;
  watchdog?: ReturnType<typeof setTimeout>;
}

/** If the worker hasn't answered within this time, compute on the main thread instead. */
const WORKER_WATCHDOG_MS = 5000;

/**
 * Runs the bot in a Web Worker (falls back to the main thread if workers are unavailable).
 * Only the most recent request is answered with a move; a request superseded by a newer
 * requestMove() call (or by dispose()) resolves with null, and late worker replies are ignored.
 */
export class BotClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: Pending | null = null;
  private disposed = false;

  constructor() {
    try {
      if (typeof Worker !== 'undefined') {
        this.worker = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<{ id: number; move: Move | null }>) => this.onReply(e.data);
        this.worker.onerror = () => this.failWorker();
        this.worker.onmessageerror = () => this.failWorker();
      }
    } catch {
      this.worker = null;
    }
  }

  requestMove(state: GameState, difficulty: Difficulty): Promise<Move | null> {
    if (this.disposed) return Promise.resolve(null);
    this.supersede();
    const id = this.nextId++;
    return new Promise<Move | null>((resolve) => {
      const p: Pending = { id, state, difficulty, resolve };
      this.pending = p;
      if (this.worker) {
        try {
          this.worker.postMessage({ id, state, difficulty });
          p.watchdog = setTimeout(() => {
            if (this.pending === p) this.failWorker();
          }, WORKER_WATCHDOG_MS);
          return;
        } catch {
          this.disposeWorker();
        }
      }
      this.runOnMainThread(p);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.supersede();
    this.disposeWorker();
  }

  private onReply(data: { id: number; move: Move | null }) {
    const p = this.pending;
    if (!p || !data || data.id !== p.id) return; // stale
    this.finish(p, data.move);
  }

  private finish(p: Pending, move: Move | null) {
    if (p.watchdog) clearTimeout(p.watchdog);
    if (this.pending === p) this.pending = null;
    p.resolve(move);
  }

  private supersede() {
    const p = this.pending;
    if (p) this.finish(p, null);
  }

  private failWorker() {
    this.disposeWorker();
    const p = this.pending;
    if (p) {
      if (p.watchdog) clearTimeout(p.watchdog);
      this.runOnMainThread(p);
    }
  }

  private disposeWorker() {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
    }
  }

  private runOnMainThread(p: Pending) {
    // setTimeout so the UI gets a chance to paint before the (blocking) search.
    setTimeout(() => {
      if (this.pending !== p) return;
      let move: Move | null = null;
      try {
        move = chooseMove(p.state, p.difficulty);
      } catch {
        move = null;
      }
      this.finish(p, move);
    }, 30);
  }
}
