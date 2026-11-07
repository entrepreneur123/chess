/**
 * Match orchestration, independent of the DOM. Drives the engine, the bot and the turn clock,
 * and exposes an immutable-ish snapshot for the HUD/board to render.
 *
 * Phases: humanTurn -> animating -> botThinking -> animating -> humanTurn ... -> ended
 */
import {
  applyMove,
  applyTimeout,
  capturedIds,
  trapsLeft,
  applySkill,
  isLegalSkill,
  getLegalMoves,
  getPieceAt,
  getPieceById,
  getTargetsForPiece,
  isLegalMove,
  pieceDir,
  posOf,
  screenArrow,
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
  type SkillAction,
} from '../../engine';
import { fallbackAction } from '../../ai/bot';

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
  /** `pieceId` (Brutile) laid wasteland on `squares`. */
  | { type: 'skill'; player: PlayerId; pieceId: string; squares: number[] }
  /**
   * `pieceId` (Rakaeli) transformed ('on', right after the cast) or turned back ('off', when his
   * owner's turn ended with his last transformed turn; he is still on the board).
   */
  | { type: 'awaken'; phase: 'on' | 'off'; player: PlayerId; pieceId: string }
  /** `pieceId` (Michelle) left a doll trap on `square` (her `trapsLeft` traps remain). */
  | { type: 'trap'; player: PlayerId; pieceId: string; square: Pos; trapsLeft: number }
  /** `pieceId` (owned by `player`) ended its move on an enemy doll trap and is stunned. */
  | { type: 'stun'; player: PlayerId; pieceId: string; square: Pos }
  /** `pieceId` (Picker, or an Insaner with his hop) captured several pieces in one move. */
  | { type: 'multiCapture'; player: PlayerId; pieceId: string; captured: string[] }
  /** `pieceId` reached the far edge and turned around: it now moves `arrow` on screen. */
  | { type: 'turnAround'; player: PlayerId; pieceId: string; arrow: 'up' | 'down' }
  /** The storm advanced to `storm` columns per side, removing `killed`. */
  | { type: 'storm'; storm: number; killed: string[]; /** The removed pieces as they stood. */ lost: Piece[] }
  | { type: 'ended'; state: GameState };

export interface ControllerPorts {
  /** The bot's action: a move or Brutile's wasteland (SkillAction, `kind: 'skill'`). */
  requestBotMove(state: GameState): Promise<Move | SkillAction | null>;
  /** Play the move on the board. `after` is the resulting state. Must resolve (even on failure). */
  animate(move: Move, after: GameState): Promise<void>;
  /** Play a skill on the board. `after` is the resulting state. Must resolve (even on failure). */
  animateSkill?(action: SkillAction, after: GameState): Promise<void>;
  /** Minimum visible think time for the bot. */
  botThinkDelayMs(): number;
  now?(): number;
  /** Fixed time per turn (tests). Defaults to the engine's `turnTimeMsFor` (45 / 40 / 20 s). */
  turnTimeMs?: number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(id: unknown): void;
  /**
   * Does the human's turn run on a clock (running out forfeits)? Default true. False for matches
   * against the AI (only online PvP is timed): the player's turn has no deadline, the bot's turn
   * keeps a silent safety deadline (a stuck bot plays its fallback), and the match can be paused.
   */
  timed?: boolean;
  /**
   * Which of the player's legal moves are offered (the guided tutorial allows only the step's
   * move; the others are not highlighted and cannot be played). Default: all of them.
   */
  humanMoveFilter?(state: GameState, move: Move): boolean;
}

const samePos = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;

/**
 * Watchdog for the board's move / skill animations. The longest real one (a Picker multi-hop, a
 * transform with its cut-in) takes about 2.5 s; a hidden page (no animation frames) or a broken
 * FX must never hold the match in 'animating', so after this long the result is applied anyway
 * (the board snaps to it on the next sync).
 */
export const ANIMATION_WATCHDOG_MS = 6000;

/** The last move's squares (a Midos teleport counts: it moved a piece too). */
export function lastMoveOf(history: HistoryEntry[]): { from: Pos; to: Pos } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.kind === 'move') return { from: e.move.from, to: e.move.to };
    if (e.kind === 'skill' && e.blink) return { from: posOf(e.blink.from), to: posOf(e.blink.to) };
  }
  return null;
}

export class GameController {
  private _state: GameState;
  private _phase: Phase = 'humanTurn';
  private selection: Selection | null = null;
  private listeners = new Set<(e: ControllerEvent) => void>();
  /** Bumped to invalidate in-flight async work (bot requests, animations) on resign/timeout/dispose. */
  private gen = 0;
  private disposed = false;
  private started = false;
  private endEmitted = false;

  // Turn clock: a wall-clock deadline. It keeps running while the page / app is hidden (like any
  // online game, leaving does not stop your clock); the timer only wakes us up to check it.
  private turnTime: number;
  /** When the current turn's time runs out (`now()` units); null while no turn clock runs. */
  private deadline: number | null = null;
  private timerHandle: unknown = null;

  /** Paused (untimed matches only): the bot holds its answer and its safety deadline stops. */
  private _paused = false;
  /** Time left on the deadline when the pause began (re-armed on resume). */
  private pausedRemaining: number | null = null;
  private resumeWaiters: (() => void)[] = [];

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(initial: GameState, private readonly ports: ControllerPorts) {
    this._state = initial;
    this.turnTime = ports.turnTimeMs ?? turnTimeMsFor(initial);
    // Wall clock: it advances while the page is hidden or the app suspended.
    this.now = ports.now ?? (() => Date.now());
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
  snapshot(): ControllerSnapshot {
    return {
      state: this._state,
      phase: this._phase,
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

  /** Does the human's turn run on a clock? (see ControllerPorts.timed) */
  get timed(): boolean {
    return this.ports.timed !== false;
  }
  get paused(): boolean {
    return this._paused;
  }

  /**
   * Pause an untimed match (the menu is open): the player cannot act, the bot finishes thinking but
   * holds its move until resume(), and the bot's safety deadline stops. A timed (online) match
   * cannot be paused: returns false. Idempotent.
   */
  pause(): boolean {
    if (this.timed || this.disposed || this._phase === 'ended') return false;
    if (this._paused) return true;
    this._paused = true;
    this.pausedRemaining = this.deadline === null ? null : Math.max(0, this.deadline - this.now());
    this.stopTimer();
    this.emit({ type: 'change' });
    return true;
  }

  /** Resume a paused match: the bot's held move plays, its safety deadline runs on. */
  resume(): void {
    if (!this._paused) return;
    this._paused = false;
    const rem = this.pausedRemaining;
    this.pausedRemaining = null;
    if (rem !== null && !this.disposed && this._phase === 'botThinking') {
      this.deadline = this.now() + rem;
      this.armTimer();
    }
    this.flushResume();
    if (!this.disposed) this.emit({ type: 'change' });
  }

  private flushResume(): void {
    const w = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const r of w) r();
  }

  /** Resolves at once, or when the match is resumed (also on resign / dispose). */
  private untilResumed(): Promise<void> {
    if (!this._paused) return Promise.resolve();
    return new Promise<void>((r) => this.resumeWaiters.push(r));
  }

  /** Remaining time of the current turn in ms (the full turn time while no turn clock runs). */
  turnRemainingMs(): number {
    if (this.deadline === null) return this.turnTime;
    return Math.max(0, this.deadline - this.now());
  }

  /**
   * Re-check the turn deadline now. Call it when the page becomes visible again / the app returns
   * to the foreground: hidden pages throttle timers (Chrome: up to a minute) and a suspended iOS app
   * runs none, so a deadline that passed meanwhile is applied at once (the human forfeits on time,
   * the bot plays its fallback).
   */
  checkClock(): void {
    if (this.disposed || this.deadline === null || this.now() < this.deadline) return;
    this.expire();
  }
  get turnTimeMs(): number {
    return this.turnTime;
  }

  /** Board tap at absolute coordinates. */
  tapCell(pos: Pos): void {
    if (this.disposed || this._paused || this._phase === 'ended' || this._phase === 'animating') return;
    const sel = this.selection;
    if (sel?.actionable && this._phase === 'humanTurn') {
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
      this.setSelection({ pieceId: piece.id, moves: this.humanMoves(piece.id), actionable: true });
    } else {
      // Enemy piece, or own piece while the bot is thinking: non-actionable reach preview.
      this.setSelection({ pieceId: piece.id, moves: getTargetsForPiece(this._state, piece), actionable: false });
    }
  }

  /** A skill for the human (own turn). Returns false if not allowed now. */
  trySkill(action: SkillAction): boolean {
    if (this.disposed || this._paused || this._phase !== 'humanTurn' || !isLegalSkill(this._state, action)) return false;
    this.selection = null;
    void this.playSkill(action);
    return true;
  }

  /** Decline the pending chain move (human only). Returns false if none is pending. */
  skipBonus(): boolean {
    if (this.disposed || this._paused || this._phase !== 'humanTurn' || this._state.bonusPieceId === null) return false;
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
    if (this.disposed || this._paused || this._phase !== 'humanTurn' || !isLegalMove(this._state, move)) return false;
    if (this.ports.humanMoveFilter && !this.ports.humanMoveFilter(this._state, move)) return false;
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
    this._paused = false;
    this.pausedRemaining = null;
    this.flushResume();
    this.selection = null;
    this._state = resign(this._state, HUMAN);
    this.checkEndOrContinue(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gen++;
    this.stopTimer();
    this.listeners.clear();
    this.flushResume();
  }

  // ------------------------------------------------------------------ internals

  /** A throwing listener (UI, sound, FX) must never break the turn flow: it is logged and skipped. */
  private emit(e: ControllerEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error(`[game] '${e.type}' listener failed:`, err);
      }
    }
  }

  /**
   * Await a board animation, but never longer than ANIMATION_WATCHDOG_MS, and never throw: the
   * match goes on whatever the animation does.
   */
  private async awaitAnimation(run: () => Promise<void> | undefined, what: string): Promise<void> {
    let timer: unknown = null;
    try {
      const anim = run();
      if (!anim) return;
      await Promise.race([
        anim,
        new Promise<void>((resolve) => {
          timer = this.setTimer(() => {
            timer = null;
            console.warn(`[game] ${what} animation did not finish in ${ANIMATION_WATCHDOG_MS} ms; continuing`);
            resolve();
          }, ANIMATION_WATCHDOG_MS);
        }),
      ]);
    } catch (e) {
      console.warn(`[game] ${what} animation failed`, e);
    } finally {
      if (timer !== null) this.clearTimer(timer);
    }
  }

  /** The player's legal moves for a piece, as offered (ControllerPorts.humanMoveFilter). */
  private humanMoves(pieceId: string): Move[] {
    const all = getLegalMoves(this._state, pieceId);
    const f = this.ports.humanMoveFilter;
    return f ? all.filter((m) => f(this._state, m)) : all;
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
      this.selection = { pieceId: piece.id, moves: this.humanMoves(piece.id), actionable: true };
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
    this.turnTime = this.ports.turnTimeMs ?? turnTimeMsFor(this._state);
    if (this._state.turn === HUMAN) {
      this._phase = 'humanTurn';
      // A chain move can only be played by one piece: pre-select it so the player just taps a square.
      const bonusId = this._state.bonusPieceId;
      if (bonusId !== null && getPieceById(this._state, bonusId)) this.selection = { pieceId: bonusId, moves: this.humanMoves(bonusId), actionable: true };
      this.refreshSelection();
      this.startClock();
      this.emit({ type: 'change' });
    } else {
      this._phase = 'botThinking';
      this.refreshSelection();
      this.startClock();
      this.emit({ type: 'change' });
      void this.runBotTurn();
    }
  }

  private async runBotTurn(): Promise<void> {
    const gen = this.gen;
    const stateAtRequest = this._state;
    const t0 = this.now();
    let move: Move | SkillAction | null = null;
    try {
      move = await this.ports.requestBotMove(stateAtRequest);
    } catch (e) {
      console.warn('bot failed', e);
      move = null;
    }
    if (gen !== this.gen || this.disposed) return;
    const wait = this.ports.botThinkDelayMs() - (this.now() - t0);
    if (wait > 0) await new Promise<void>((r) => this.setTimer(r, wait));
    // Paused (menu open): the answer is ready but waits until the player resumes.
    await this.untilResumed();
    if (gen !== this.gen || this.disposed || this._phase !== 'botThinking') return;
    if (move && 'kind' in move && move.kind === 'skill' && isLegalSkill(this._state, move)) await this.playSkill(move);
    else if (move && !('kind' in move) && isLegalMove(this._state, move)) await this.playMove(move);
    // The bot failed or answered nonsense: it never forfeits for that, it plays a safe fallback.
    else await this.playBotFallback();
  }

  /**
   * The bot's turn must never end in a timeout (that forfeits the match): play a cheap legal action
   * instead. Only when there is nothing at all to play (a boxed-in chain move) is the turn timed out,
   * which for a chain move just skips it.
   */
  private async playBotFallback(): Promise<void> {
    if (this.disposed || this._phase !== 'botThinking') return;
    let action: Move | SkillAction | null = null;
    try {
      action = fallbackAction(this._state);
    } catch (e) {
      console.warn('bot fallback failed', e);
    }
    if (action && 'kind' in action) {
      if (isLegalSkill(this._state, action)) return this.playSkill(action);
    } else if (action && isLegalMove(this._state, action)) return this.playMove(action);
    this.doTimeout();
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
    await this.awaitAnimation(() => this.ports.animate(move, next), 'move');
    if (gen !== this.gen || this.disposed) return;
    this._state = next;
    this.announce(prev, next, 1);
    this.checkEndOrContinue(true);
  }

  private async playSkill(action: SkillAction): Promise<void> {
    const gen = ++this.gen;
    this.stopTimer();
    const prev = this._state;
    let next: GameState;
    try {
      next = applySkill(prev, action);
    } catch (e) {
      console.warn('illegal skill rejected', e);
      this.enterTurn();
      return;
    }
    this._phase = 'animating';
    this.emit({ type: 'change' });
    await this.awaitAnimation(() => this.ports.animateSkill?.(action, next), 'skill');
    if (gen !== this.gen || this.disposed) return;
    this._state = next;
    const entry = next.history[prev.history.length];
    if (entry?.kind === 'skill' && entry.transform) this.emit({ type: 'awaken', phase: 'on', player: entry.player, pieceId: entry.pieceId });
    else if (entry?.kind === 'skill') this.emit({ type: 'skill', player: entry.player, pieceId: entry.pieceId, squares: entry.squares });
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
    const chainLapse = prev.bonusPieceId !== null;
    // Running out of time forfeits the match; only a pending chain move just lapses.
    this._state = applyTimeout(prev);
    if (chainLapse) {
      if (who === HUMAN) this.emit({ type: 'toast', message: '연속 이동 시간이 지나 턴이 넘어갑니다', kind: 'timeout', player: who });
    } else if (who === HUMAN) this.emit({ type: 'toast', message: '시간 초과! 기권패 처리됩니다', tone: 'warn', kind: 'timeout', player: who });
    this.announce(prev, this._state, 1);
    this.checkEndOrContinue(true);
  }

  /**
   * Events for everything the engine did after the action itself: auto-passes, absorptions,
   * chain moves granted, transforms that ended, and storm advances (`skip` = history entries that
   * were the action).
   */
  private announce(prev: GameState, next: GameState, skip: number): void {
    // A transformed Rakaeli whose last transformed turn just ended (and who is still standing).
    for (const p of prev.pieces) {
      if (!p.awaken) continue;
      const q = getPieceById(next, p.id);
      if (q && !q.awaken) this.emit({ type: 'awaken', phase: 'off', player: q.owner, pieceId: q.id });
    }
    const action = next.history[prev.history.length];
    if (action?.kind === 'move') {
      const m = action.move;
      if (m.trap) this.emit({ type: 'trap', player: action.player, pieceId: m.pieceId, square: { ...m.from }, trapsLeft: trapsLeft(next, action.player) });
      if (m.stunned) this.emit({ type: 'stun', player: action.player, pieceId: m.pieceId, square: { ...m.to } });
      const before = getPieceById(prev, m.pieceId);
      const after = getPieceById(next, m.pieceId);
      if (before && after && pieceDir(before) !== pieceDir(after)) this.emit({ type: 'turnAround', player: action.player, pieceId: m.pieceId, arrow: screenArrow(after) });
      const all = capturedIds(m);
      if (all.length > 1) this.emit({ type: 'multiCapture', player: action.player, pieceId: m.pieceId, captured: [...all] });
    }
    // A teleport that landed on the far edge turned the piece around, like a move.
    if (action?.kind === 'skill' && action.blink?.turned) {
      const after = getPieceById(next, action.pieceId);
      if (after) this.emit({ type: 'turnAround', player: action.player, pieceId: after.id, arrow: screenArrow(after) });
    }
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
      } else if (e.kind === 'pass' && e.reason === 'stunned') {
        this.emit({
          type: 'toast',
          message: e.player === HUMAN ? '내 말이 속박돼 이번 턴을 넘깁니다' : '상대 말이 속박돼 턴이 넘어옵니다',
          kind: 'pass',
          player: e.player,
        });
      }
    }
  }

  private checkEndOrContinue(continueTurn: boolean): void {
    if (this._state.status === 'ended') {
      this._phase = 'ended';
      this.refreshSelection();
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

  /**
   * Start the turn clock: a fresh deadline `turnTime` from now. Untimed matches give the player no
   * deadline; the bot's silent safety deadline waits while paused.
   */
  private startClock(): void {
    this.stopTimer();
    if (!this.timed && this._phase === 'humanTurn') return;
    if (this._paused) {
      this.pausedRemaining = this.turnTime;
      return;
    }
    this.deadline = this.now() + this.turnTime;
    this.armTimer();
  }

  /** Wake up at the deadline. Timers may fire late (throttled) or early: the deadline decides. */
  private armTimer(): void {
    if (this.deadline === null) return;
    if (this.timerHandle !== null) this.clearTimer(this.timerHandle);
    this.timerHandle = this.setTimer(() => {
      this.timerHandle = null;
      if (this.deadline === null) return;
      if (this.now() < this.deadline) this.armTimer();
      else this.expire();
    }, Math.max(0, this.deadline - this.now()));
  }

  /** The turn's time ran out. */
  private expire(): void {
    this.stopTimer();
    // The human's clock ran out: forfeit. The bot never times out: it plays a fallback move.
    if (this._phase === 'botThinking') void this.playBotFallback();
    else if (this._phase === 'humanTurn') this.doTimeout();
  }

  private stopTimer(): void {
    if (this.timerHandle !== null) this.clearTimer(this.timerHandle);
    this.timerHandle = null;
    this.deadline = null;
  }
}
