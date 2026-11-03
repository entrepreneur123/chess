import type { BoardViewOptions, IBoardView } from './types';
import { BoardView } from './BoardView';
import { Board2DView } from './Board2DView';

export type { BoardHighlights, BoardViewMode, BoardViewOptions, IBoardView, SkillPreview } from './types';
export { BoardView } from './BoardView';
export { Board2DView } from './Board2DView';
export * from './palette';

/** True if the browser can create a WebGL context at all (cheap probe, context released). */
export function isWebGLAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the WebGL board; falls back to the flat Canvas2D board if WebGL fails for any reason.
 * `opts.topOnly` = top-down tokens only (no 3D models are ever loaded); the 2D board always is.
 */
export function createBoardView(container: HTMLElement, opts: BoardViewOptions = {}): IBoardView {
  // DEV only: `?board2d` forces the Canvas2D fallback (to check it without disabling WebGL).
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('board2d')) {
    return new Board2DView(container);
  }
  if (isWebGLAvailable()) {
    try {
      return new BoardView(container, opts);
    } catch (err) {
      console.warn('[render] WebGL board failed, using 2D fallback:', err);
      // A half-initialised WebGL canvas may have been appended; remove it.
      container.querySelectorAll('canvas').forEach((c) => c.remove());
    }
  }
  return new Board2DView(container);
}
