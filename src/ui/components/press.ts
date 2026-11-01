/**
 * Global tap feedback: a radial "ripple" glow from the touch point on every pressable control.
 * One delegated pointerdown listener; no DOM nodes are created (the effect is a CSS ::after on
 * the element, positioned through --rx/--ry and restarted by toggling .fx-ripple).
 */
const SELECTOR = [
  '.btn:not([disabled]):not(.btn--text)',
  '.icon-btn:not([disabled])',
  '.pressable',
].join(',');

let installed = false;

export function installPressFx(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target as Element | null;
      const el = target?.closest?.(SELECTOR) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      // Scale so the 16px glow covers the farthest corner.
      const far = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
      el.style.setProperty('--rx', `${x}px`);
      el.style.setProperty('--ry', `${y}px`);
      el.style.setProperty('--rs', String(Math.max(4, (far * 2) / 16)));
      el.classList.remove('fx-ripple');
      void el.offsetWidth; // restart the animation
      el.classList.add('fx-ripple');
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    'animationend',
    (e) => {
      if (e.animationName === 'fx-ripple') (e.target as Element).classList.remove('fx-ripple');
    },
    { passive: true },
  );
}
