/**
 * 절전 모드 (settings.powerSave): one switch for less heat and battery drain on long sessions.
 *  - `html.power-save` stops the decorative looping CSS animations (menu shine, floating figures,
 *    badges, auras, the skill-ready and storm pulses: see the `.power-save` rules in base.css);
 *  - the match board stops its decorative idle loops (particles, scan sweep, shimmer, pulses) and
 *    draws its move animations at 30 fps (IBoardView.setLowPower).
 * Off by default: the full look is the product. Rules, timings and sounds are the same either way.
 */
import { getProfile, subscribeProfile } from '../meta/profile';

const CLASS = 'power-save';

export const isPowerSave = (): boolean => getProfile().settings.powerSave;

/** Keep the root class in step with the setting (call once at start-up). */
export function installPowerSave(): void {
  let on = isPowerSave();
  document.documentElement.classList.toggle(CLASS, on);
  subscribeProfile((p) => {
    if (p.settings.powerSave === on) return;
    on = p.settings.powerSave;
    document.documentElement.classList.toggle(CLASS, on);
  });
}

/** Call `fn` with the current setting now and on every change; returns the unsubscribe. */
export function watchPowerSave(fn: (on: boolean) => void): () => void {
  let on = isPowerSave();
  fn(on);
  return subscribeProfile((p) => {
    if (p.settings.powerSave === on) return;
    on = p.settings.powerSave;
    fn(on);
  });
}
