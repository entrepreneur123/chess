import type { RenderDiagnostics } from './diag';
import type { Move, Piece, Pos, Trap } from '../engine/types';

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
  /** Subset of `moves` that end on wasteland (the mover would be destroyed): draw a danger mark. */
  deadly?: Pos[];
  /**
   * Subset of `captures` that are Venoa shots (she stays put): drawn as a crosshair reticle in the
   * tone's shot colour (own: venom lime, enemy: magenta) instead of the red capture ring.
   */
  shots?: Pos[];
  /**
   * Venoa's arrow range: the empty squares her arrows fly over (engine `getShotRange`). Tinted and
   * marked with a small sight in the tone's shot colour (own: venom lime, enemy: magenta).
   */
  shotRange?: Pos[];
}

/** Options for creating a board view. */
export interface BoardViewOptions {
  /**
   * Top-down only (3D arena disabled for now): never load or animate the glTF unit models; units
   * are the illustrated tokens. Saves the model download and all skinning/animation work.
   */
  topOnly?: boolean;
  /**
   * Arena whose board theme to paint from the start (src/render/arenaThemes.ts: cells, bezel, grid,
   * surface detail, ambient particles). Unknown or missing ids get the original moonrune look.
   */
  arena?: string;
}

/** Brutile's wasteland targeting overlay. */
export interface SkillPreview {
  /** Squares the wasteland would cover (r * BOARD_SIZE + c). */
  squares: number[];
  /** False when the area is not allowed (a piece stands there / off board): draw it red. */
  valid: boolean;
}

/** A rectangle in viewport (client) CSS pixels. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Camera view of the board: tilted 3D arena (default) or straight top-down. */
export type BoardViewMode = 'tilt' | 'top';

/** Public API of the 3D board. Implemented by src/render/BoardView.ts. */
export interface IBoardView {
  /** Instantly sync meshes to these pieces (add/remove/move without animation). */
  setPieces(pieces: Piece[]): void;
  /**
   * Animate one move (slide or jump), plus capture effect if move.captureId is set.
   * If `move.wasted` is set the mover reaches the wasteland square and is destroyed there (green
   * toxic dissolve; it is absent from `piecesAfter`).
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
  /** Optional: what the board renders with (the ?diag=1 panel). */
  getDiagnostics?(): RenderDiagnostics;
  /** Switch camera view (optional: the flat 2D fallback is always top-down). */
  setViewMode?(mode: BoardViewMode, animate?: boolean): void;
  /**
   * Optional: storm ("자기장") state. `storm` = outer columns consumed per side (0 = none: columns
   * 0..storm-1 and BOARD_SIZE-storm..BOARD_SIZE-1 are gone), `nextIn` = plies until the next shrink (null = the storm
   * has not started). Pieces that vanish from the piece list while the storm is active (and are not
   * a move's capture) dissolve with a storm effect instead of popping out.
   */
  setStorm?(storm: number, nextIn: number | null): void;
  /**
   * Optional: called at the exact moment a capturing strike lands during `animateMove` (the UI
   * syncs the impact sound, haptic and illustration cut-in to it). Only one listener. Picker's
   * hop-through calls it once per victim, as he lands on it, with `captureId` set to that victim.
   */
  onImpact?(cb: (move: Move) => void): void;
  /**
   * Optional: the wasteland squares (r * BOARD_SIZE + c) currently on the board — toxic, cracked, glowing
   * green ground. Called with the full list whenever it changes (it only grows during a match).
   */
  setWaste?(squares: number[]): void;
  /**
   * Optional: Michelle's doll traps (full list; they only ever accumulate during a match). Drawn as
   * small team-tinted dolls with a subtle idle wobble (still with prefers-reduced-motion); a piece
   * standing on one leaves a mini doll peeking out of the square's corner. Stunned pieces
   * (`Piece.stun`, from setPieces / animateMove) are dimmed and carry a "속박" badge.
   */
  setTraps?(traps: readonly Trap[]): void;
  /**
   * Optional: skill targeting overlay. `anchors` = squares the player may tap to place the area
   * (subtle green tint), `preview` = the area under consideration (bright, or red when invalid).
   * null clears both.
   */
  setSkillPreview?(anchors: number[] | null, preview: SkillPreview | null): void;
  /**
   * Optional: play Brutile laying wasteland (`caster` is the Brutile piece id): green black-magic
   * cast on the caster, then the curse spreading over `squares`. Resolves when done (always,
   * also on dispose). The UI calls setWaste with the new full list afterwards.
   */
  animateSkill?(caster: string, squares: number[]): Promise<void>;
  /**
   * Optional: Rakaeli's transform "타천" on `pieceId`'s token. 'on' = the blindfold burns away in
   * a flash, crimson flame wings unfold, a short pulse, and the coin swaps to the transformed face at
   * the peak (then carries the crimson / violet ember aura and the countdown badge = `Piece.awaken`).
   * 'off' = the embers fade, a smoke puff, the coin swaps back to the base face. Resolves when done
   * (at once if the piece is not on the board; always on dispose). prefers-reduced-motion: short
   * fades only. Optional for the caller too: setPieces alone gives the same final look (a
   * transformed piece's last move fades the look out by itself). Call it before, or in the same
   * tick as, the setPieces that changes `awaken`.
   */
  playAwaken?(pieceId: string, phase: 'on' | 'off'): Promise<void>;
  /**
   * Optional (drag-to-move): the board square under a viewport point (client px), using the same
   * mapping as taps; null when the point is off the board.
   */
  pickCell?(clientX: number, clientY: number): Pos | null;
  /** Optional (drag-to-move): viewport rectangle (client px) of a board square, for DOM overlays. */
  cellRect?(pos: Pos): ScreenRect | null;
  /**
   * Optional (drag-to-move): the piece being dragged (a DOM ghost follows the finger) is drawn
   * faded on its square until this is called with null.
   */
  setDragging?(pieceId: string | null): void;
  /**
   * Optional (turn feedback): a subtle glow on the board edge in that team's colour (0 = player /
   * blue, 1 = opponent / red), null = off. Fades in / out (instant with prefers-reduced-motion);
   * calling it again with the same owner is a no-op, so it is safe to call on every UI refresh.
   */
  setTurnGlow?(owner: 0 | 1 | null): void;
  /**
   * Optional: switch the arena board theme at runtime (same ids as BoardViewOptions.arena; unknown =
   * moonrune). Repaints the static arena layers once (old textures / canvases are freed); a no-op
   * for the theme already shown. Team colours, markers and every FX are the same on every theme.
   */
  setArenaTheme?(id: string): void;
  /**
   * Optional: the board is covered (the result dialog over a blurred scrim) and no one is looking
   * at its ambience: stop every decorative idle loop (particles, scan sweep, rings, storm field,
   * wasteland / trap / aura shimmer). Running moves and effects still finish; the board rests on
   * its last frame. false resumes. Saves the whole-screen re-blur each board frame used to cost.
   */
  setPaused?(paused: boolean): void;
  /**
   * Optional: 절전 모드 (settings.powerSave). The same decorative idle loops as setPaused stay off
   * (highlights rest at a steady glow) and moves / effects draw at ~30 fps instead of up to 60–90.
   */
  setLowPower?(on: boolean): void;
}
