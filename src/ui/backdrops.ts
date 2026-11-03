/**
 * Illustrated backdrops (public/bg/*.webp) are optional: the CSS gradient in base.css is always
 * there underneath. Each image is preloaded off the critical path; only once it has decoded do we
 * expose it as a CSS custom property (absolute URL, so it resolves the same in dev, in the built
 * app under `base: './'` and inside the Capacitor WebView) and add a class on <html> that fades
 * the layer in. A missing file simply leaves the gradient.
 */
const BACKDROPS = {
  lobby: 'bg/lobby.webp',
  matchmaking: 'bg/matchmaking.webp',
  match: 'bg/match.webp',
} as const;

type BackdropName = keyof typeof BACKDROPS;

let installed = false;
let arenaMatchApplied = false;
let fallbackMatchUrl: string | null = null;

function load(name: BackdropName): void {
  const root = document.documentElement;
  const url = new URL(`${import.meta.env.BASE_URL}${BACKDROPS[name]}`, document.baseURI).href;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    const done = () => {
      // An arena backdrop already in place wins over the generic match art.
      if (name === 'match') fallbackMatchUrl = url;
      if (name === 'match' && arenaMatchApplied) {
        root.classList.add('has-bg-match');
        return;
      }
      root.style.setProperty(`--bg-${name}-img`, `url("${url}")`);
      root.classList.add(`has-bg-${name}`);
    };
    // decode() keeps the first painted frame of the layer from stalling the fade.
    if (typeof img.decode === 'function') img.decode().then(done, done);
    else done();
  };
  img.src = url;
}

/** Start loading the backdrops once the first screen has had a chance to paint. */
export function installBackdrops(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const idle = (cb: () => void, timeout: number) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(cb, { timeout });
    else window.setTimeout(cb, Math.min(timeout, 300));
  };
  idle(() => load('lobby'), 600);
  idle(() => {
    load('matchmaking');
    load('match');
  }, 2500);
}

// ---------------------------------------------------------------------------------------------
// Arena art (public/arenas/<id>/): the match backdrop follows the arena being played. Missing
// art (404 / decode failure) falls back to bg/match.webp, which installBackdrops() preloads.
// ---------------------------------------------------------------------------------------------

/** url -> decoded ok (true) / failed (false) / pending (promise). */
const artState = new Map<string, boolean | Promise<boolean>>();

/** Absolute URL of a public asset given as a relative path ("./arenas/x/bg.webp"). */
export function publicUrl(rel: string): string {
  return new URL(`${import.meta.env.BASE_URL}${rel.replace(/^\.\//, '')}`, document.baseURI).href;
}

/** Preload an image once; resolves true when it decoded, false when it is missing or broken. */
export function preloadArt(rel: string): Promise<boolean> {
  const url = publicUrl(rel);
  const known = artState.get(url);
  if (known !== undefined) return Promise.resolve(known);
  const p = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const ok = () => resolve(true);
      if (typeof img.decode === 'function') img.decode().then(ok, ok);
      else ok();
    };
    img.onerror = () => resolve(false);
    img.src = url;
  }).then((ok) => {
    artState.set(url, ok);
    return ok;
  });
  artState.set(url, p);
  return p;
}

let matchToken = 0;

/**
 * Use an arena's backdrop for the match layer (--bg-match-img). Until it has decoded, and for
 * good if it is missing, the generic bg/match.webp stays.
 */
export function useMatchBackdrop(rel: string): void {
  const token = ++matchToken;
  void preloadArt(rel).then((ok) => {
    if (token !== matchToken) return;
    const root = document.documentElement;
    if (!ok) {
      // Back to the generic art (if a previous arena's art was showing).
      if (arenaMatchApplied && fallbackMatchUrl) root.style.setProperty('--bg-match-img', `url("${fallbackMatchUrl}")`);
      arenaMatchApplied = false;
      return;
    }
    arenaMatchApplied = true;
    root.style.setProperty('--bg-match-img', `url("${publicUrl(rel)}")`);
    root.classList.add('has-bg-match');
  });
}
