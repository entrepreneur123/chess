/**
 * Match orchestration, independent of the DOM. Drives the engine, the bot and the turn clock,
 * and exposes an immutable-ish snapshot for the HUD/board to render.
 *
 * Phases: humanTurn -> animating -> botThinking -> animating -> humanTurn ... -> ended
 */
import {
  applyMove,
  applyTimeout,
  applyTimeUp,
  getLegalMoves,
  getPieceAt,
  getPieceById,
  getTargetsForPiece,
  isLegalMove,
  resign,
  skipBonus,
  turnTimeMsFor,
  type CharacterId,
  type GameState,
  type HistoryEntry,
  type Move,
  type Piece,
  type PlayerId,
  type Pos,
  MATCH_TIME_MS,
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
  | { type: 'toast'; message: string; tone?: 'neutral' | 'warn'; kind?: 'timeout' | 'pass'; player?: PlayerId }
  /** A chain move became available to `player` for `pieceId`. */
  | { type: 'bonus'; player: PlayerId; pieceId: string }
  /** `pieceId` (an Insaner) absorbed the movement of `character`. */
  | { type: 'absorb'; player: PlayerId; pieceId: string; character: CharacterId }
  /** The storm advanced to `storm` columns per side, removing `killed`. */
  | { type: 'storm'; storm: number; killed: string[]; /** The removed pieces as they stood. */ lost: Piece[] }
  | { type: 'ended'; state: GameState };

export interface ControllerPorts {
  requestBotMove(state: GameState): Promise<Move | null>;
  /** Play the move on the board. `after` is the resulting state. Must resolve (even on failure). */
  animate(move: Move, after: GameState): Promise<void>;
  /** Minimum visible think time for the bot. */
  botThinkDelayMs(): number;
  now?(): number;
  /** Fixed time per turn (tests). Defaults to the engine's `turnTimeMsFor` (45 / 40 / 20 s). */
  turnTimeMs?: number;
  /** Match clock length (tests). Defaults to MATCH_TIME_MS. */
  matchTimeMs?: number;
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
  private turnTime: number;
  private timerRemaining: number;
  private timerStartedAt: number | null = null;
  private timerHandle: unknown = null;
  private resumeWaiters: (() => void)[] = [];

  // Match clock (whole game, pauses excluded). When it runs out the game is adjudicated.
  private readonly matchTime: number;
  private matchRemaining: number;
  private matchStartedAt: number | null = null;
  private matchHandle: unknown = null;
  private matchUp = false;

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(initial: GameState, private readonly ports: ControllerPorts) {
    this._state = initial;
    this.turnTime = ports.turnTimeMs ?? turnTimeMsFor(initial);
    this.timerRemaining = this.turnTime;
    this.matchTime = ports.matchTimeMs ?? MATCH_TIME_MS;
    this.matchRemaining = this.matchTime;
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
    if (!this._paused) this.runMatchClock();
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

  /** Remaining match time in ms (frozen while paused; 0 once it ran out). */
  matchRemainingMs(): number {
    if (this.matchStartedAt === null) return this.matchRemaining;
    return Math.max(0, this.matchRemaining - (this.now() - this.matchStartedAt));
  }
  get matchTimeMs(): number {
    return this.matchTime;
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

  /** Decline the pending chain move (human only). Returns false if none is pending. */
  skipBonus(): boolean {
    if (this.disposed || this._phase !== 'humanTurn' || this._paused || this._state.bonusPieceId === null) return false;
    this.gen++;
    this.stopTimer();
    const prev = this._state;
    this.selection = null;
    this._state = skipBonus(prev);
    this.announce(prev, this._state, 1);
    this.checkEndOrContinue(true);
    return true;
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
    this.freezeMatchClock();
    this.emit({ type: 'change' });
  }

  resume(): void {
    if (!this._paused || this.disposed) return;
    this._paused = false;
    if (this.started && this._phase !== 'ended') this.runMatchClock();
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
    this.freezeMatchClock();
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

  /**
   * Recompute the current selection against the latest state/phase: drop it if the piece is gone
   * (e.g. just captured), otherwise refresh its destinations and actionability. Without this a
   * preview made during the bot's turn kept stale (or ghost) highlights after the bot moved.
   */
  private refreshSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    const piece = getPieceById(this._state, sel.pieceId);
    if (!piece || this._phase === 'ended') {
      this.selection = null;
    } else if (piece.owner === HUMAN && this._phase === 'humanTurn') {
      this.selection = { pieceId: piece.id, moves: getLegalMoves(this._state, piece.id), actionable: true };
    } else {
      this.selection = { pieceId: piece.id, moves: getTargetsForPiece(this._state, piece), actionable: false };
    }
  }

  private enterTurn(): void {
    if (this.disposed) return;
    if (this._state.status === 'ended') {
      this.checkEndOrContinue(false);
      return;
    }
    if (this.matchUp) {
      this.doTimeUp();
      return;
    }
    this.turnTime = this.ports.turnTimeMs ?? turnTimeMsFor(this._state);
    this.timerRemaining = this.turnTime;
    this.timerStartedAt = null;
    if (this._state.turn === HUMAN) {
      this._phase = 'humanTurn';
      // A chain move can only be played by one piece: pre-select it so the player just taps a square.
      const bonusId = this._state.bonusPieceId;
      if (bonusId !== null && getPieceById(this._state, bonusId)) this.selection = { pieceId: bonusId, moves: getLegalMoves(this._state, bonusId), actionable: true };
      this.refreshSelection();
      if (!this._paused) this.runTimer();
      this.emit({ type: 'change' });
    } else {
      this._phase = 'botThinking';
      this.refreshSelection();
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
    this.announce(prev, next, 1);
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
    if (who === HUMAN) this.emit({ type: 'toast', message: '시간 초과! 턴이 넘어갑니다', tone: 'warn', kind: 'timeout', player: who });
    else this.emit({ type: 'toast', message: '상대가 시간을 초과해 턴이 넘어옵니다', kind: 'timeout', player: who });
    this.announce(prev, this._state, 1);
    this.checkEndOrContinue(true);
  }

  /**
   * Events for everything the engine did after the action itself: auto-passes, absorptions,
   * chain moves granted, and storm advances (`skip` = history entries that were the action).
   */
  private announce(prev: GameState, next: GameState, skip: number): void {
    const action = next.history[prev.history.length];
    if (action?.kind === 'move' && action.move.captureId) {
      const before = getPieceById(prev, action.move.pieceId);
      const after = getPieceById(next, action.move.pieceId);
      if (before && after && (after.absorbed?.length ?? 0) > (before.absorbed?.length ?? 0)) {
        const victim = getPieceById(prev, action.move.captureId);
        if (victim) this.emit({ type: 'absorb', player: action.player, pieceId: after.id, character: victim.character });
      }
    }
    if (next.status === 'playing' && next.bonusPieceId !== null && prev.bonusPieceId === null) {
      this.emit({ type: 'bonus', player: next.turn, pieceId: next.bonusPieceId });
    }
    const added = next.history.slice(prev.history.length + skip);
    for (const e of added) {
      if (e.kind === 'storm') this.emit({ type: 'storm', storm: e.storm, killed: e.killed, lost: prev.pieces.filter((p) => e.killed.includes(p.id)) });
      else if (e.kind === 'pass' && e.reason === 'noMoves') {
        this.emit({
          type: 'toast',
          message: e.player === HUMAN ? '움직일 수 있는 말이 없어 턴을 넘깁니다' : '상대가 움직일 수 없어 턴이 넘어옵니다',
          kind: 'pass',
          player: e.player,
        });
      }
    }
  }

  /** The match clock ran out: adjudicate now (an animation in flight finishes first, see enterTurn). */
  private doTimeUp(): void {
    if (this.disposed || this._phase === 'ended') return;
    this.gen++;
    this.stopTimer();
    this.selection = null;
    this._state = applyTimeUp(this._state);
    this.checkEndOrContinue(false);
  }

  private checkEndOrContinue(continueTurn: boolean): void {
    if (this._state.status === 'ended') {
      this._phase = 'ended';
      this.refreshSelection();
      this.stopTimer();
      this.freezeMatchClock();
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

  private runMatchClock(): void {
    if (this.matchHandle !== null || this.matchUp) return;
    this.matchStartedAt = this.now();
    this.matchHandle = this.setTimer(() => {
      this.matchHandle = null;
      this.matchStartedAt = null;
      this.matchRemaining = 0;
      this.matchUp = true;
      if (this._phase === 'humanTurn' || this._phase === 'botThinking') this.doTimeUp();
    }, Math.max(0, this.matchRemaining));
  }

  private freezeMatchClock(): void {
    if (this.matchHandle === null) return;
    this.clearTimer(this.matchHandle);
    this.matchHandle = null;
    if (this.matchStartedAt !== null) this.matchRemaining = Math.max(0, this.matchRemaining - (this.now() - this.matchStartedAt));
    this.matchStartedAt = null;
  }
}
