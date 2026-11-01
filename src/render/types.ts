import type { Move, Piece, Pos } from '../engine/types';

/** Visual state of board squares. All positions are ABSOLUTE board coordinates. */
export interface BoardHighlights {
  selected?: Pos | null; // square of the currently selected piece
  moves?: Pos[]; // empty destination squares the selected piece can move to
  captures?: Pos[]; // destination squares occupied by a capturable enemy
  lastMove?: { from: Pos; to: Pos } | null; // previous move (either player)
  /** Optional rows to tint as a "zone" (e.g. home zone), inclusive range. */
  zoneRows?: [number, number] | null;
}

/** Public API of the 3D board. Implemented by src/render/BoardView.ts. */
export interface IBoardView {
  /** Instantly sync meshes to these pieces (add/remove/move without animation). */
  setPieces(pieces: Piece[]): void;
  /**
   * Animate one move (slide or jump), plus capture effect if move.captureId is set.
   * Resolves when the animation is done. Afterwards the view reflects `piecesAfter`.
   */
  animateMove(move: Move, piecesAfter: Piece[]): Promise<void>;
  setHighlights(h: BoardHighlights): void;
  /** Register the tap/click handler; called with the absolute square tapped. Only one handler. */
  onCellClick(cb: (pos: Pos) => void): void;
  /** Enable/disable input (e.g. during the opponent's turn or animations). */
  setInteractive(enabled: boolean): void;
  /** Re-measure container size; call on window resize/orientation change. */
  resize(): void;
  /** Stop the render loop and free GPU resources. */
  dispose(): void;
}
