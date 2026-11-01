/**
 * Match orchestration, independent of the DOM. Drives the engine, the bot and the turn clock,
 * and exposes an immutable-ish snapshot for the HUD/board to render.
 *
 * Phases: humanTurn -> animating -> botThinking -> animating -> humanTurn ... -> ended
 */
import {
  applyMove,
  applyTimeout,
  getLegalMoves,
  getPieceAt,
  getTargetsForPiece,
  isLegalMove,
  resign,
  TURN_TIME_MS,
  type GameState,
  type HistoryEntry,
  type Move,
  type PlayerId,
  type Pos,
} from '../../engine';

export type Phase = 'humanTurn' | 'animating' | 'botThinking' | 'ended';

export const HUMAN: PlayerId = 0;
export const BOT: PlayerId = 1;

export interface Selection {
  pieceId: string;
  /** Destinations. Actionable only when `actionable` (own piece on own turn). */
  moves: Move[];
  actionable: boolean;
}

export interface ControllerSnapshot {
  state: GameState;
  phase: Phase;
  paused: boolean;
  selection: Selection | null;
  lastMove: { from: Pos; to: Pos } | null;
}

export type ControllerEvent =
  | { type: 'change' }
  | { type: 'toast'; message: string; tone?: 'neutral' | 'warn' }
  | { type: 'ended'; state: GameState };

export interface ControllerPorts {
  requestBotMove(state: GameState): Promise<Move | null>;
  /** Play the move on the board. `after` is the resulting state. Must resolve (even on failure). */
  animate(move: Move, after: GameState): Promise<void>;
  /** Minimum visible think time for the bot. */
  botThinkDelayMs(): number;
  now?(): number;
  turnTimeMs?: number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(id: unknown): void;
}

const samePos = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;

export function lastMoveOf(history: HistoryEntry[]): { from: Pos; to: Pos } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.kind === 'move') return { from: e.move.from, to: e.move.to };
  }
  return null;
}

export class GameController {
  private _state: GameState;
  private _phase: Phase = 'humanTurn';
  private _paused = false;
  private selection: Selection | null = null;
  private listeners = new Set<(e: ControllerEvent) => void>();
  /** Bumped to invalidate in-flight async work (bot requests, animations) on resign/timeout/dispose. */
  private gen = 0;
  private disposed = false;
  private started = false;
  private endEmitted = false;

  // Turn clock
  private readonly turnTime: number;
  private timerRemaining: number;
  private timerStartedAt: number | null = null;
  private timerHandle: unknown = null;
  private resumeWaiters: (() => void)[] = [];

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(initial: GameState, private readonly ports: ControllerPorts) {
    this._state = initial;
    this.turnTime = ports.turnTimeMs ?? TURN_TIME_MS;
    this.timerRemaining = this.turnTime;
    this.now = ports.now ?? (() => performance.now());
    this.setTimer = ports.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = ports.clearTimer ?? ((id) => clearTimeout(id as number));
  }

  // ------------------------------------------------------------------ public API

  get state(): GameState {
    return this._state;
  }
  get phase(): Phase {
    return this._phase;
  }
  get paused(): boolean {
    return this._paused;
  }

  snapshot(): ControllerSnapshot {
    return {
      state: this._state,
      phase: this._phase,
      paused: this._paused,
      selection: this.selection,
      lastMove: lastMoveOf(this._state.history),
    };
  }

  on(cb: (e: ControllerEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.enterTurn();
  }

  /** Remaining time of the current turn in ms (frozen while paused/animating). */
  turnRemainingMs(): number {
    if (this.timerStartedAt === null) return this.timerRemaining;
    return Math.max(0, this.timerRemaining - (this.now() - this.timerStartedAt));
  }
  get turnTimeMs(): number {
    return this.turnTime;
  }

  /** Board tap at absolute coordinates. */
  tapCell(pos: Pos): void {
    if (this.disposed || this._phase === 'ended' || this._phase === 'animating') return;
    const sel = this.selection;
    if (sel?.actionable && this._phase === 'humanTurn' && !this._paused) {
      const move = sel.moves.find((m) => samePos(m.to, pos));
      if (move) {
        void this.playHumanMove(move);
        return;
      }
    }
    const piece = getPieceAt(this._state, pos);
    if (!piece || (sel && sel.pieceId === piece.id)) {
      this.setSelection(null);
      return;
    }
    if (piece.owner === HUMAN && this._phase === 'humanTurn') {
      this.setSelection({ pieceId: piece.id, moves: getLegalMoves(this._state, piece.id), actionable: true });
    } else {
      // Enemy piece, or own piece while the bot is thinking: non-actionable reach preview.
      this.setSelection({ pieceId: piece.id, moves: getTargetsForPiece(this._state, piece), actionable: false });
    }
  }

  /** Programmatic move (used by tests/debug). Returns false if not allowed now. */
  tryHumanMove(move: Move): boolean {
    if (this._phase !== 'humanTurn' || this._paused || !isLegalMove(this._state, move)) return false;
    void this.playHumanMove(move);
    return true;
  }

  clearSelection(): void {
    this.setSelection(null);
  }

  resign(): void {
    if (this.disposed || this._phase === 'ended') return;
    this.gen++;
    this.stopTimer();
    this.selection = null;
    this._state = resign(this._state, HUMAN);
    this.checkEndOrContinue(false);
  }

  pause(): void {
    if (this._paused || this.disposed) return;
    this._paused = true;
    this.freezeTimer();
    this.emit({ type: 'change' });
  }

  resume(): void {
    if (!this._paused || this.disposed) return;
    this._paused = false;
    if (this._phase === 'humanTurn' || this._phase === 'botThinking') this.runTimer();
    const waiters = this.resumeWaiters.splice(0);
    for (const w of waiters) w();
    this.emit({ type: 'change' });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gen++;
    this.stopTimer();
    this.listeners.clear();
    this.resumeWaiters.splice(0).forEach((w) => w());
  }

  // ------------------------------------------------------------------ internals

  private emit(e: ControllerEvent): void {
    for (const l of [...this.listeners]) l(e);
  }

  private setSelection(sel: Selection | null): void {
    this.selection = sel;
    this.emit({ type: 'change' });
  }

  private enterTurn(): void {
    if (this.disposed) return;
    if (this._state.status === 'ended') {
      this.checkEndOrContinue(false);
      return;
    }
    this.timerRemaining = this.turnTime;
    this.timerStartedAt = null;
    if (this._state.turn === HUMAN) {
      this._phase = 'humanTurn';
      if (!this._paused) this.runTimer();
      this.emit({ type: 'change' });
    } else {
      this._phase = 'botThinking';
      if (!this._paused) this.runTimer();
      this.emit({ type: 'change' });
      void this.runBotTurn();
    }
  }

  private async runBotTurn(): Promise<void> {
    const gen = this.gen;
    const stateAtRequest = this._state;
    const t0 = this.now();
    let move: Move | null = null;
    try {
      move = await this.ports.requestBotMove(stateAtRequest);
    } catch (e) {
      console.warn('bot failed', e);
      move = null;
    }
    if (gen !== this.gen || this.disposed) return;
    const wait = this.ports.botThinkDelayMs() - (this.now() - t0);
    if (wait > 0) await new Promise<void>((r) => this.setTimer(r, wait));
    await this.whenResumed();
    if (gen !== this.gen || this.disposed || this._phase !== 'botThinking') return;
    if (move && isLegalMove(this._state, move)) {
      await this.playMove(move);
    } else {
      // Bot couldn't produce a legal move: treat like a timeout so the game never stalls.
      this.doTimeout();
    }
  }

  private whenResumed(): Promise<void> {
    if (!this._paused) return Promise.resolve();
    return new Promise((r) => this.resumeWaiters.push(r));
  }

  private async playHumanMove(move: Move): Promise<void> {
    this.selection = null;
    await this.playMove(move);
  }

  private async playMove(move: Move): Promise<void> {
    const gen = ++this.gen; // invalidates any stale bot result
    this.stopTimer();
    const prev = this._state;
    let next: GameState;
    try {
      next = applyMove(prev, move);
    } catch (e) {
      console.warn('illegal move rejected', e);
      this.enterTurn();
      return;
    }
    this._phase = 'animating';
    this.emit({ type: 'change' });
    try {
      await this.ports.animate(move, next);
    } catch (e) {
      console.warn('animation failed', e);
    }
    if (gen !== this.gen || this.disposed) return;
    this._state = next;
    this.announcePasses(prev, next, 1);
    this.checkEndOrContinue(true);
  }

  private doTimeout(): void {
    if (this.disposed || this._phase === 'ended') return;
    this.gen++;
    this.stopTimer();
    const prev = this._state;
    const who = prev.turn;
    this.selection = null;
    this._state = applyTimeout(prev);
    if (who === HUMAN) this.emit({ type: 'toast', message: '시간 초과! 턴이 넘어갑니다', tone: 'warn' });
    else this.emit({ type: 'toast', message: '상대가 시간을 초과해 턴이 넘어옵니다' });
    this.announcePasses(prev, this._state, 1);
    this.checkEndOrContinue(true);
  }

  /** Toast for any 'noMoves' passes the engine auto-inserted after the action. */
  private announcePasses(prev: GameState, next: GameState, skip: number): void {
    const added = next.history.slice(prev.history.length + skip);
    for (const e of added) {
      if (e.kind === 'pass' && e.reason === 'noMoves') {
        this.emit({
          type: 'toast',
          message: e.player === HUMAN ? '움직일 수 있는 말이 없어 턴을 넘깁니다' : '상대가 움직일 수 없어 턴이 넘어옵니다',
        });
      }
    }
  }

  private checkEndOrContinue(continueTurn: boolean): void {
    if (this._state.status === 'ended') {
      this._phase = 'ended';
      this.stopTimer();
      this.emit({ type: 'change' });
      if (!this.endEmitted) {
        this.endEmitted = true;
        this.emit({ type: 'ended', state: this._state });
      }
      return;
    }
    if (continueTurn) this.enterTurn();
  }

  // ---- clock

  private runTimer(): void {
    if (this.timerHandle !== null) return;
    this.timerStartedAt = this.now();
    this.timerHandle = this.setTimer(() => {
      this.timerHandle = null;
      this.timerStartedAt = null;
      this.timerRemaining = 0;
      this.doTimeout();
    }, Math.max(0, this.timerRemaining));
  }

  private freezeTimer(): void {
    if (this.timerHandle === null) return;
    this.clearTimer(this.timerHandle);
    this.timerHandle = null;
    if (this.timerStartedAt !== null) this.timerRemaining = Math.max(0, this.timerRemaining - (this.now() - this.timerStartedAt));
    this.timerStartedAt = null;
  }

  private stopTimer(): void {
    this.freezeTimer();
  }
}
