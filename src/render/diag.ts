/**
 * Render diagnostics: what the board runs on, and why. Shown on screen by `?diag=1` in any build
 * (production included) so a player can send a screenshot when the board looks wrong on a device we
 * cannot test (iPad Safari). Off by default; costs nothing unless the flag is present.
 */

export interface ProgramDiag {
  /** Material name / type of the shader program. */
  name: string;
  runnable: boolean;
  /** Program / shader info log (first line only), if any. */
  log?: string;
}

export interface RenderDiagnostics {
  renderer: 'webgl2' | 'webgl1' | '2d';
  glVendor?: string;
  glRenderer?: string;
  maxTextureSize?: number;
  dpr: number;
  /** Drawing-buffer size (device px) and CSS size of the board canvas. */
  canvas: [number, number];
  css: [number, number];
  /** Bezel look in use. */
  frame: 'regular' | 'slim';
  /** WebGL cells: the instanced cell shader, or the portable textured fallback. */
  tilePath?: 'shader' | 'portable';
  programs: ProgramDiag[];
  /** Self-test notes (repaints, retries, swaps). */
  notes: string[];
  nullCtx: number;
  canvases: number;
  fallbackReason: string | null;
}

/** Process-wide 2D canvas counters (every render canvas goes through ctx2d). */
export const canvasStats = { created: 0, nullCtx: 0 };

/** getContext('2d') with bookkeeping: iOS returns null once its canvas memory budget is spent. */
export function ctx2d(cvs: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null {
  canvasStats.created++;
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = cvs.getContext('2d', opts);
  } catch {
    g = null;
  }
  if (!g) canvasStats.nullCtx++;
  return g;
}

/**
 * Release a canvas's backing store now (iOS keeps it until GC otherwise and counts it against the
 * page's canvas memory budget).
 */
export function releaseCanvas(c: unknown): void {
  if (typeof HTMLCanvasElement !== 'undefined' && c instanceof HTMLCanvasElement) {
    c.width = 0;
    c.height = 0;
  }
}

let fallbackReason: string | null = null;

/** Why the WebGL board was not used (null = it was, or it was never tried). */
export function setFallbackReason(reason: string | null): void {
  fallbackReason = reason;
}

export function getFallbackReason(): string | null {
  return fallbackReason;
}

export function diagEnabled(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('diag') === '1';
  } catch {
    return false;
  }
}

/** One-line WebGL identification (unmasked when the browser allows it). */
export function glIdentity(gl: WebGLRenderingContext | WebGL2RenderingContext): { vendor: string; renderer: string; maxTex: number } {
  let vendor = '';
  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    vendor = String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) ?? '');
    renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    // Some browsers throw on the debug extension; leave the strings empty.
  }
  let maxTex = 0;
  try {
    maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
  } catch {
    maxTex = 0;
  }
  return { vendor, renderer, maxTex };
}

function format(d: RenderDiagnostics | null): string {
  if (!d) return `renderer: none\nfallback: ${fallbackReason ?? '-'}`;
  const bad = d.programs.filter((p) => !p.runnable);
  const lines = [
    `renderer: ${d.renderer}${d.tilePath ? ` · cells ${d.tilePath}` : ''} · frame ${d.frame}`,
    d.glRenderer || d.glVendor ? `gl: ${d.glVendor} / ${d.glRenderer}` : '',
    d.maxTextureSize ? `maxTex: ${d.maxTextureSize}` : '',
    `dpr: ${d.dpr} · canvas ${d.canvas[0]}x${d.canvas[1]} · css ${d.css[0]}x${d.css[1]}`,
    `programs: ${d.programs.length} · failed ${bad.length}`,
    ...bad.map((p) => `  ✗ ${p.name}: ${p.log ?? ''}`),
    `canvases: ${d.canvases} · null ctx: ${d.nullCtx}`,
    `fallback: ${d.fallbackReason ?? '-'}`,
    ...d.notes.map((n) => `note: ${n}`),
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Small fixed panel (bottom-left) listing `source()`; refreshes every second and removes itself once
 * `host` leaves the document (the match screen closed).
 */
export function mountDiagPanel(host: HTMLElement, source: () => RenderDiagnostics | null): void {
  const el = document.createElement('pre');
  el.className = 'render-diag';
  el.setAttribute('aria-hidden', 'true');
  const st = el.style;
  st.position = 'fixed';
  st.left = 'calc(4px + env(safe-area-inset-left, 0px))';
  st.bottom = 'calc(4px + env(safe-area-inset-bottom, 0px))';
  st.zIndex = '9999';
  st.maxWidth = 'min(92vw, 520px)';
  st.margin = '0';
  st.padding = '6px 8px';
  st.borderRadius = '6px';
  st.background = 'rgba(0, 0, 0, 0.78)';
  st.color = '#9BEBFF';
  st.font = '10px/1.35 ui-monospace, Menlo, monospace';
  st.whiteSpace = 'pre-wrap';
  st.wordBreak = 'break-word';
  st.pointerEvents = 'none';
  document.body.appendChild(el);
  let seen = false;
  const tick = (): void => {
    if (host.isConnected) seen = true;
    else if (seen) {
      clearInterval(timer);
      el.remove();
      return;
    }
    let d: RenderDiagnostics | null = null;
    try {
      d = source();
    } catch (e) {
      el.textContent = `diag error: ${String(e)}`;
      return;
    }
    let audio = '';
    try {
      audio = (window as unknown as { __gcAudio?: () => string }).__gcAudio?.() ?? '';
    } catch {
      /* ignore */
    }
    el.textContent = audio ? `${format(d)}\n${audio}` : format(d);
  };
  const timer = window.setInterval(tick, 1000);
  tick();
}
