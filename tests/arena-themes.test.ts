/**
 * Per-arena board themes (src/render/arenaThemes.ts) and their ambient drift (src/render/ambient.ts):
 * one theme per arena, the readability budget (dark cells, faint details) and the particle math.
 */
import { describe, expect, it } from 'vitest';
import { ARENA_DEFS } from '../src/meta/progression';
import { BOARD_THEMES, BOARD_THEME_IDS, DEFAULT_BOARD_THEME, boardTheme } from '../src/render/arenaThemes';
import { AMBIENT_MAX, makeAmbientSample, sampleAmbient } from '../src/render/ambient';
import { hexToRgb } from '../src/render/common';
import { ARENA, BOARD_COLORS, HOLO } from '../src/render/palette';
import { BOARD_SIZE } from '../src/engine/types';

const luma = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

describe('arena board themes', () => {
  it('every arena has exactly one theme; unknown ids fall back to moonrune', () => {
    expect([...BOARD_THEME_IDS].sort()).toEqual(ARENA_DEFS.map((a) => a.id).sort());
    for (const id of BOARD_THEME_IDS) expect(boardTheme(id).id).toBe(id);
    for (const bad of [undefined, null, '', 'nowhere', '__proto__']) expect(boardTheme(bad)).toBe(DEFAULT_BOARD_THEME);
    expect(DEFAULT_BOARD_THEME.id).toBe('moonrune');
  });

  it('moonrune keeps the original hologram look exactly', () => {
    const m = BOARD_THEMES.moonrune;
    expect([m.tileLight, m.tileDark]).toEqual([BOARD_COLORS.tileLight, BOARD_COLORS.tileDark]);
    expect([m.grid, m.gridCore, m.bed, m.accent]).toEqual([ARENA.grid, ARENA.gridCore, ARENA.bed, ARENA.gold]);
    expect(m.holo).toEqual(HOLO);
    expect(m.homeTint).toBe(1);
  });

  it('cells stay dark and two-tone low-contrast on every theme (markers keep their contrast)', () => {
    for (const t of Object.values(BOARD_THEMES)) {
      expect(luma(t.tileLight)).toBeLessThan(0.15);
      expect(luma(t.tileDark)).toBeLessThan(0.15);
      expect(luma(t.tileLight)).toBeGreaterThanOrEqual(luma(t.tileDark));
      expect(Math.abs(luma(t.tileLight) - luma(t.tileDark))).toBeLessThan(0.03);
      expect(t.holo.gridCore).toBeLessThanOrEqual(0.3);
      expect(t.detailStrength).toBeGreaterThan(0);
      expect(t.detailStrength).toBeLessThanOrEqual(1);
    }
  });

  it('the six themes are distinct (cells, grid, detail)', () => {
    const all = Object.values(BOARD_THEMES);
    expect(new Set(all.map((t) => t.grid)).size).toBe(all.length);
    expect(new Set(all.map((t) => t.tileLight)).size).toBe(all.length);
    expect(new Set(all.map((t) => t.detail)).size).toBe(all.length);
  });
});

describe('ambient particles', () => {
  it('stay over the field, finite and within their alpha at any time', () => {
    const p = makeAmbientSample();
    for (const t of Object.values(BOARD_THEMES)) {
      const spec = t.ambient;
      if (!spec) continue;
      expect(spec.count).toBeLessThanOrEqual(AMBIENT_MAX);
      for (let i = 0; i < spec.count; i++) {
        for (const time of [0, 0.37, 5.2, 61.9, 3600.5, 86400.25]) {
          sampleAmbient(spec, i, time, p);
          for (const v of [p.x, p.y, p.a, p.size]) expect(Number.isFinite(v)).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(-0.6);
          expect(p.x).toBeLessThanOrEqual(BOARD_SIZE + 0.6);
          expect(p.y).toBeGreaterThanOrEqual(-0.6);
          expect(p.y).toBeLessThanOrEqual(BOARD_SIZE + 0.6);
          expect(p.a).toBeLessThanOrEqual(spec.alpha + 1e-9);
          expect(p.size).toBeGreaterThan(0);
        }
      }
    }
  });

  it('rising kinds go up the screen and snow comes down', () => {
    const p = makeAmbientSample();
    const dy = (id: 'emberforge' | 'frostkeep'): number => {
      const spec = BOARD_THEMES[id].ambient!;
      // Particle 0 over a short step (no wrap-around in 0.1 s).
      const y0 = sampleAmbient(spec, 0, 10, p).y;
      const y1 = sampleAmbient(spec, 0, 10.1, p).y;
      return Math.abs(y1 - y0) > 1 ? 0 : y1 - y0;
    };
    expect(dy('emberforge')).toBeLessThan(0);
    expect(dy('frostkeep')).toBeGreaterThan(0);
  });
});
