// Heat / battery work: the HUD clock cadence, the ambient frame caps and the 절전 모드 setting.
import { describe, expect, it } from 'vitest';
import { ambientFrameMs, AMBIENT_FRAME_MS, BUSY_FRAME_MS, LOW_POWER_FRAME_MS } from '../src/render/ambient';
import { BOARD_THEMES as ARENA_THEMES } from '../src/render/arenaThemes';
import { clockRedrawMs } from '../src/ui/game/hud';
import { createDefaultProfile, DEFAULT_SETTINGS, getProfile, sanitizeProfile, setProfile, updateProfile } from '../src/meta/profile';
import { isPowerSave, watchPowerSave } from '../src/ui/powerSave';

describe('HUD clock cadence (clockRedrawMs)', () => {
  it('redraws a 45 s turn about 5 times a second, never per display frame', () => {
    // 0.5 SVG units of arc per redraw: 45 000 * 0.5 / (2π * 18) ≈ 199 ms.
    expect(clockRedrawMs(30_500, 45_000)).toBeCloseTo(199, 0);
    // Shorter turns redraw more often (the arc moves faster), within [40, 250] ms.
    expect(clockRedrawMs(10_500, 20_000)).toBeCloseTo(88, 0);
    expect(clockRedrawMs(500_500, 1_000_000)).toBe(250);
    expect(clockRedrawMs(10_500, 100)).toBe(40);
  });

  it('wakes right after the shown second changes (the label and tick sound stay on time)', () => {
    // ceil(remaining / 1000) drops from 31 to 30 at 30 000 ms: 50 ms (+2) from 30 050.
    expect(clockRedrawMs(30_050, 45_000)).toBe(52);
    expect(clockRedrawMs(30_001, 45_000)).toBe(3);
    // Exactly on a boundary the next change is a full second away (then capped by the arc step).
    expect(clockRedrawMs(30_000, 45_000)).toBeCloseTo(199, 0);
    // Time is up: just the arc cadence (the controller handles the forfeit).
    expect(clockRedrawMs(0, 45_000)).toBeCloseTo(199, 0);
    // Never a non-positive delay.
    for (let r = 0; r <= 3000; r += 7) expect(clockRedrawMs(r, 45_000)).toBeGreaterThan(0);
  });

  it('meets every second change: stepping by its own delays never skips a label', () => {
    let rem = 45_000;
    let shown = Math.ceil(rem / 1000);
    while (rem > 0) {
      rem = Math.max(0, rem - clockRedrawMs(rem, 45_000));
      const now = Math.ceil(rem / 1000);
      expect(shown - now).toBeLessThanOrEqual(1);
      shown = now;
    }
  });
});

describe('ambient frame caps (ambientFrameMs)', () => {
  it('stays within ~10–20 fps and is faster for faster themes', () => {
    for (const t of Object.values(ARENA_THEMES)) {
      if (!t.ambient) continue;
      const ms = ambientFrameMs(t.ambient);
      expect(ms).toBeGreaterThanOrEqual(AMBIENT_FRAME_MS);
      expect(ms).toBeLessThanOrEqual(100);
    }
    expect(ambientFrameMs(ARENA_THEMES.moonrune.ambient!)).toBe(100); // faint slow motes
    expect(ambientFrameMs(ARENA_THEMES.apex.ambient!)).toBe(100); // star twinkles
    expect(ambientFrameMs(ARENA_THEMES.emberforge.ambient!)).toBe(50); // fast flickering embers
    const slow = { kind: 'embers' as const, count: 10, colors: ['#fff', '#fff'] as [string, string], size: 0.06, speed: 0.1, alpha: 1 };
    expect(ambientFrameMs({ ...slow, speed: 0.6 })).toBeLessThanOrEqual(ambientFrameMs(slow));
  });

  it('keeps the busy frame floors sane (60 / 90 Hz every refresh, 120 Hz every other; 절전 30 fps)', () => {
    expect(1000 / 60).toBeGreaterThan(BUSY_FRAME_MS);
    expect(1000 / 90).toBeGreaterThan(BUSY_FRAME_MS);
    expect(1000 / 120).toBeLessThan(BUSY_FRAME_MS);
    expect(2000 / 60).toBeGreaterThan(LOW_POWER_FRAME_MS);
    expect(1000 / 60).toBeLessThan(LOW_POWER_FRAME_MS);
  });
});

describe('절전 모드 setting', () => {
  it('is off by default, survives a reload and rejects junk', () => {
    expect(DEFAULT_SETTINGS.powerSave).toBe(false);
    const base = createDefaultProfile();
    expect(base.settings.powerSave).toBe(false);
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, powerSave: true } }).settings.powerSave).toBe(true);
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, powerSave: 'yes' } }).settings.powerSave).toBe(false);
    const { powerSave: _omit, ...older } = base.settings;
    expect(sanitizeProfile({ ...base, settings: older }).settings.powerSave).toBe(false);
  });

  it('notifies watchers on change only', () => {
    setProfile(createDefaultProfile());
    const seen: boolean[] = [];
    const stop = watchPowerSave((on) => seen.push(on));
    updateProfile((p) => ({ ...p, settings: { ...p.settings, sound: !p.settings.sound } })); // unrelated
    updateProfile((p) => ({ ...p, settings: { ...p.settings, powerSave: true } }));
    expect(isPowerSave()).toBe(true);
    updateProfile((p) => ({ ...p, settings: { ...p.settings, powerSave: false } }));
    stop();
    updateProfile((p) => ({ ...p, settings: { ...p.settings, powerSave: true } }));
    expect(seen).toEqual([false, true, false]);
    expect(getProfile().settings.powerSave).toBe(true);
    setProfile(createDefaultProfile());
  });
});
