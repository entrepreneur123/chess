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

function load(name: BackdropName): void {
  const root = document.documentElement;
  const url = new URL(`${import.meta.env.BASE_URL}${BACKDROPS[name]}`, document.baseURI).href;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    const done = () => {
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
