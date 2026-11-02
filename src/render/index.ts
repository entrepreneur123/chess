import type { IBoardView } from './types';
import { BoardView } from './BoardView';
import { Board2DView } from './Board2DView';

export type { BoardHighlights, BoardViewMode, IBoardView } from './types';
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

/** Create the 3D board; falls back to the flat Canvas2D board if WebGL fails for any reason. */
export function createBoardView(container: HTMLElement): IBoardView {
  if (isWebGLAvailable()) {
    try {
      return new BoardView(container);
    } catch (err) {
      console.warn('[render] WebGL board failed, using 2D fallback:', err);
      // A half-initialised WebGL canvas may have been appended; remove it.
      container.querySelectorAll('canvas').forEach((c) => c.remove());
    }
  }
  return new Board2DView(container);
}
