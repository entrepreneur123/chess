import type { BoardViewOptions, IBoardView } from './types';
import { BoardView } from './BoardView';
import { Board2DView } from './Board2DView';
import { diagEnabled, mountDiagPanel, setFallbackReason } from './diag';

export { BOARD_THEMES, BOARD_THEME_IDS, boardTheme } from './arenaThemes';
export type { BoardTheme, BoardThemeId } from './arenaThemes';
export type { BoardHighlights, BoardViewMode, BoardViewOptions, IBoardView, ScreenRect, SkillPreview } from './types';
export { BoardView } from './BoardView';
export { Board2DView } from './Board2DView';
export * from './palette';
export type { RenderDiagnostics } from './diag';
export { diagEnabled } from './diag';

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
 * Create the WebGL board; falls back to the flat Canvas2D board if WebGL fails for any reason
 * (no context, or the BoardView start-up self-check found a shader program that does not link).
 * `opts.topOnly` = top-down tokens only (no 3D models are ever loaded); the 2D board always is.
 * `?diag=1` (any build) shows a small render diagnostics panel; with it, `?board2d` forces the 2D
 * board in production too (DEV: `?board2d` alone).
 */
export function createBoardView(container: HTMLElement, opts: BoardViewOptions = {}): IBoardView {
  const view = pickBoardView(container, opts);
  if (diagEnabled()) mountDiagPanel(container, () => view.getDiagnostics?.() ?? null);
  return view;
}

function pickBoardView(container: HTMLElement, opts: BoardViewOptions): IBoardView {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (q?.has('board2d') && (import.meta.env.DEV || diagEnabled())) {
    setFallbackReason('forced by ?board2d');
    return new Board2DView(container, opts);
  }
  if (!isWebGLAvailable()) setFallbackReason('no WebGL context');
  else {
    try {
      const v = new BoardView(container, opts);
      setFallbackReason(null);
      return v;
    } catch (err) {
      console.warn('[render] WebGL board failed, using 2D fallback:', err);
      setFallbackReason(`WebGL board failed: ${err instanceof Error ? err.message : String(err)}`);
      // A half-initialised WebGL canvas may have been appended; remove it.
      container.querySelectorAll('canvas').forEach((c) => c.remove());
    }
  }
  return new Board2DView(container, opts);
}
