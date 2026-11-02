import type { Move, Piece, Pos } from '../engine/types';

/** Visual state of board squares. All positions are ABSOLUTE board coordinates. */
export interface BoardHighlights {
  selected?: Pos | null; // square of the currently selected piece
  moves?: Pos[]; // empty destination squares the selected piece can move to
  captures?: Pos[]; // destination squares occupied by a capturable enemy
  lastMove?: { from: Pos; to: Pos } | null; // previous move (either player)
  /** Optional rows to tint as a "zone" (e.g. home zone), inclusive range. */
  zoneRows?: [number, number] | null;
  /**
   * Whose reach is shown: 'own' (default) = white/cyan move markers for the player's piece,
   * 'enemy' = RED move markers and selection ring for a tapped enemy piece's reach preview.
   */
  tone?: 'own' | 'enemy';
}

/** Camera view of the board: tilted 3D arena (default) or straight top-down. */
export type BoardViewMode = 'tilt' | 'top';

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
  /** Switch camera view (optional: the flat 2D fallback is always top-down). */
  setViewMode?(mode: BoardViewMode, animate?: boolean): void;
  /**
   * Optional: storm ("자기장") state. `storm` = outer columns consumed per side (0 = none: columns
   * 0..storm-1 and 12-storm..11 are gone), `nextIn` = plies until the next shrink (null = the storm
   * has not started). Pieces that vanish from the piece list while the storm is active (and are not
   * a move's capture) dissolve with a storm effect instead of popping out.
   */
  setStorm?(storm: number, nextIn: number | null): void;
  /**
   * Optional: called at the exact moment a capturing strike lands during `animateMove` (the UI
   * syncs the impact sound, haptic and illustration cut-in to it). Only one listener.
   */
  onImpact?(cb: (move: Move) => void): void;
}
