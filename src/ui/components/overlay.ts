/**
 * Shared overlay stack (dialogs, sheets, drawers). The router asks it to close the
 * top-most overlay on hardware back before navigating.
 */

export interface OverlayHandle {
  /** Called on back button / scrim tap. Return false to keep the overlay open. */
  requestClose(): boolean;
  /** Bottom sheets say so: toasts shown over one move above the scrim (see toast.ts). */
  kind?: 'sheet' | 'dialog';
}

const stack: OverlayHandle[] = [];

export function overlayRoot(): HTMLElement {
  let root = document.getElementById('overlay-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'overlay-root';
    document.body.appendChild(root);
  }
  return root;
}

export function pushOverlay(h: OverlayHandle): () => void {
  stack.push(h);
  return () => {
    const i = stack.indexOf(h);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Returns true if an overlay consumed the back action. */
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.requestClose();
  return true;
}

export function hasOverlay(): boolean {
  return stack.length > 0;
}

/** True when `h` is the top-most overlay (only it reacts to Escape). */
export function isTopOverlay(h: OverlayHandle): boolean {
  return stack[stack.length - 1] === h;
}

/** The kind of the top-most overlay, or null when none is open. */
export function topOverlayKind(): 'sheet' | 'dialog' | null {
  const top = stack[stack.length - 1];
  return top ? (top.kind ?? 'dialog') : null;
}

/** Forcefully close everything (used when the router swaps screens). */
const forceClosers = new Set<() => void>();
export function registerForceClose(fn: () => void): () => void {
  forceClosers.add(fn);
  return () => forceClosers.delete(fn);
}
export function closeAllOverlays(): void {
  for (const fn of [...forceClosers]) fn();
}
