/**
 * Drag-to-move on the match board (both board views): press an own piece, drag it, release it on a
 * highlighted square. Every move still goes through GameController.tapCell, exactly like the tap
 * flow (select the piece, then tap the destination), so animation, voice, FX, chain moves and the
 * skill rules stay identical. A short press is left to the board's own tap handling.
 *
 *  - Drag start selects the piece (if it is not already), which shows its reach like a tap does.
 *  - A ghost coin follows the finger (lifted above it for touch), the piece on the board fades.
 *  - The square under the finger is framed when it is a legal destination.
 *  - Released on a legal square: the move is played. Anywhere else: the ghost flies back.
 *  - Wasteland (deadly) squares are never played by a single drop: the first drop flies back and
 *    warns; a second drop on the same square (or the usual tap on its skull mark) confirms.
 */
import { haptic, sfx } from '../../audio/sfx';
import { BOARD_SIZE, getLegalMoves, getPieceAt, type Move, type Pos } from '../../engine';
import type { IBoardView, ScreenRect } from '../../render';
import type { ControllerSnapshot, GameController } from '../game/GameController';
import { HUMAN } from '../game/GameController';
import { DragGhost, trackPointerDrag, type DragTracker } from './drag';
import { unitArt } from './piece';

/** Tap slop of the board views: a drag released within it on its own square counts as a tap. */
const TAP_SLOP_PX = 14;

export type DropKind = 'move' | 'capture' | 'deadly';

export interface BoardDragDeps {
  /** Board host element: receives the pointer listeners and the pointer capture while dragging. */
  host: HTMLElement;
  board(): IBoardView | null;
  controller(): GameController | null;
  /** True while dragging must not start (e.g. Brutile's skill targeting). */
  blocked(): boolean;
  /** Short warning for the player (a deadly drop that needs confirming). */
  warn(message: string): void;
}

export interface BoardDrag {
  /** Re-check the running drag against a new controller snapshot (cancels it when stale). */
  sync(snap: ControllerSnapshot): void;
  /** True while a piece is being dragged. */
  readonly active: boolean;
  dispose(): void;
}

const samePos = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;

/** What dropping the selected piece on `pos` means (pure; exported for tests). */
export function dropKind(move: Move | undefined, waste: readonly number[]): DropKind | null {
  if (!move) return null;
  if (waste.includes(move.to.r * BOARD_SIZE + move.to.c)) return 'deadly';
  return move.captureId ? 'capture' : 'move';
}

interface Drag {
  pieceId: string;
  from: Pos;
  /** The piece was already selected before the drag (a tap-like release then deselects it). */
  wasSelected: boolean;
  downX: number;
  downY: number;
  ghost: DragGhost;
  /** Square under the pointer last frame (key) and its drop kind. */
  hoverKey: number;
}

export function installBoardDrag(deps: BoardDragDeps): BoardDrag {
  const { host } = deps;
  let tracker: DragTracker | null = null;
  let drag: Drag | null = null;
  /** A deadly square the player already dropped on once: the next drop there confirms. */
  let armed: { pieceId: string; to: Pos } | null = null;
  const ghosts = new Set<DragGhost>();
  const marker = document.createElement('div');
  marker.className = 'drag-target';
  marker.setAttribute('aria-hidden', 'true');
  marker.hidden = true;
  let markerKind = '';
  let disposed = false;

  const center = (r: ScreenRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  const hideMarker = () => {
    if (!marker.hidden) marker.hidden = true;
  };
  const showMarker = (rect: ScreenRect, kind: DropKind) => {
    if (!marker.isConnected) document.body.appendChild(marker);
    if (kind !== markerKind) {
      markerKind = kind;
      marker.className = `drag-target drag-target--${kind}`;
    }
    marker.style.width = `${rect.width}px`;
    marker.style.height = `${rect.height}px`;
    marker.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    marker.hidden = false;
  };

  const stillValid = (snap: ControllerSnapshot, d: Drag): boolean =>
    snap.phase === 'humanTurn' && !snap.paused && !deps.blocked() && snap.selection?.pieceId === d.pieceId && snap.selection.actionable;

  /** The ghost flies back to the piece's square; the piece reappears when it lands. */
  const flyBack = (d: Drag) => {
    hideMarker();
    const b = deps.board();
    const rect = b?.cellRect?.(d.from) ?? null;
    if (!rect) {
      d.ghost.remove();
      ghosts.delete(d.ghost);
      if (!drag) b?.setDragging?.(null);
      return;
    }
    const c = center(rect);
    void d.ghost.settle(c.x, c.y, rect.width * 0.92, { ms: 210 }).then(() => {
      ghosts.delete(d.ghost);
      // Only restore the piece if no new drag picked one up meanwhile.
      if (!drag && !disposed) deps.board()?.setDragging?.(null);
    });
  };

  const start = (ev: PointerEvent, x: number, y: number): boolean => {
    const c = deps.controller();
    const b = deps.board();
    if (disposed || !c || !b?.pickCell || c.phase !== 'humanTurn' || c.paused || deps.blocked()) return false;
    const pos = b.pickCell(ev.clientX, ev.clientY);
    const piece = pos ? getPieceAt(c.state, pos) : undefined;
    if (!piece || piece.owner !== HUMAN) return false;
    const before = c.snapshot().selection;
    const wasSelected = before?.pieceId === piece.id && before.actionable;
    // Same as tapping the piece: selects it and shows its reach (sound, voice and haptic included).
    if (!wasSelected) c.tapCell(piece.pos);
    const sel = c.snapshot().selection;
    if (!sel || sel.pieceId !== piece.id || !sel.actionable || sel.moves.length === 0) return false;
    const rect = b.cellRect?.(piece.pos);
    const cell = rect?.width ?? 30;
    const touch = ev.pointerType !== 'mouse';
    const size = Math.round(Math.min(76, Math.max(46, cell * (touch ? 1.7 : 1.35))));
    const ghost = new DragGhost(unitArt(piece.character, piece.level, { size, owner: piece.owner }), {
      size,
      // Touch: float the coin clearly above the fingertip. Mouse: keep it under the cursor.
      lift: touch ? Math.round(size * 0.55 + 16) : 0,
      cls: touch ? 'drag-ghost--touch' : '',
    });
    ghosts.add(ghost);
    ghost.follow(x, y);
    drag = { pieceId: piece.id, from: { ...piece.pos }, wasSelected, downX: ev.clientX, downY: ev.clientY, ghost, hoverKey: -1 };
    b.setDragging?.(piece.id);
    if (armed && armed.pieceId !== piece.id) armed = null;
    haptic('light');
    return true;
  };

  const move = (x: number, y: number) => {
    const d = drag;
    const b = deps.board();
    const c = deps.controller();
    if (!d || !b || !c) return;
    // Reads first (board mapping), then writes (marker + ghost transforms): no layout thrash.
    const pos = b.pickCell?.(x, y) ?? null;
    const key = pos ? pos.r * BOARD_SIZE + pos.c : -1;
    if (key !== d.hoverKey) {
      d.hoverKey = key;
      const sel = c.snapshot().selection;
      const kind = pos && sel ? dropKind(sel.moves.find((m) => samePos(m.to, pos)), c.state.waste) : null;
      const rect = pos && kind ? (b.cellRect?.(pos) ?? null) : null;
      if (rect && kind) showMarker(rect, kind);
      else hideMarker();
      d.ghost.setOver(!!kind);
    }
    d.ghost.follow(x, y);
  };

  const drop = (x: number, y: number) => {
    const d = drag;
    drag = null;
    tracker = null;
    hideMarker();
    if (!d) return;
    const c = deps.controller();
    const b = deps.board();
    if (!c || !b || !stillValid(c.snapshot(), d)) {
      flyBack(d);
      return;
    }
    const pos = b.pickCell?.(x, y) ?? null;
    const sel = c.snapshot().selection!;
    const mv = pos ? sel.moves.find((m) => samePos(m.to, pos)) : undefined;
    const kind = dropKind(mv, c.state.waste);
    if (!mv || !kind) {
      flyBack(d);
      if (pos && samePos(pos, d.from) && Math.hypot(x - d.downX, y - d.downY) <= TAP_SLOP_PX) {
        // Barely moved and released on the piece itself: behave exactly like a tap on it.
        if (d.wasSelected) c.tapCell(d.from);
      } else sfx('tap');
      return;
    }
    if (kind === 'deadly' && !(armed && armed.pieceId === d.pieceId && samePos(armed.to, mv.to))) {
      // Never a silent suicide: the first drop on wasteland only arms it.
      armed = { pieceId: d.pieceId, to: { ...mv.to } };
      flyBack(d);
      sfx('tap');
      haptic('warn');
      deps.warn('불모지에 닿으면 소멸해요! 한 번 더 끌어 놓거나 해골 칸을 탭하면 이동합니다');
      return;
    }
    armed = null;
    // Played: the ghost settles into the destination as the board's own piece slides there.
    const rect = b.cellRect?.(mv.to) ?? null;
    if (rect) {
      const cc = center(rect);
      void d.ghost.settle(cc.x, cc.y, rect.width * 0.92, { ms: 140, fade: true }).then(() => ghosts.delete(d.ghost));
    } else {
      d.ghost.remove();
      ghosts.delete(d.ghost);
    }
    b.setDragging?.(null);
    haptic('light');
    c.tapCell(mv.to);
  };

  const cancel = () => {
    const d = drag;
    drag = null;
    tracker = null;
    hideMarker();
    if (d) flyBack(d);
  };

  const onPointerDown = (ev: PointerEvent) => {
    if (disposed || tracker || !ev.isPrimary || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const c = deps.controller();
    const b = deps.board();
    if (!c || !b?.pickCell || c.phase !== 'humanTurn' || c.paused || deps.blocked()) return;
    const pos = b.pickCell(ev.clientX, ev.clientY);
    const piece = pos ? getPieceAt(c.state, pos) : undefined;
    if (!piece || piece.owner !== HUMAN || getLegalMoves(c.state, piece.id).length === 0) return;
    tracker = trackPointerDrag(ev, host, {
      start: (x, y) => {
        const ok = start(ev, x, y);
        if (!ok) tracker = null;
        return ok;
      },
      move,
      drop,
      cancel,
    });
  };
  // Pre-drag gestures that end (tap / release) just drop the tracker reference.
  const onPointerEnd = (ev: PointerEvent) => {
    if (tracker && !tracker.dragging && ev.isPrimary) tracker = null;
  };
  host.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);

  return {
    get active() {
      return drag !== null;
    },
    sync(snap) {
      if (drag && !stillValid(snap, drag)) tracker?.cancel();
      if (armed && (snap.phase !== 'humanTurn' || snap.selection?.pieceId !== armed.pieceId)) armed = null;
    },
    dispose() {
      if (disposed) return;
      tracker?.cancel();
      disposed = true;
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      for (const g of ghosts) g.remove();
      ghosts.clear();
      marker.remove();
    },
  };
}
