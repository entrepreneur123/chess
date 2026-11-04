import { describe, expect, it } from 'vitest';
import type { CharacterId, Piece } from '../src/engine/types';
import {
  AURA_BOX,
  EMBER_COUNT,
  awakeFaceUrl,
  awakenOf,
  awakenTimeline,
  emberAt,
  isRakaeli,
  makeAwakenSample,
  rakaeliStyle,
  sampleAwaken,
} from '../src/render/awakenFx';
import { CHARACTER_FX, CHARACTER_RARITY, RAKAELI_AWAKE_FX } from '../src/render/palette';
import { LOOKS, MOVE_CLIP } from '../src/render/units/config';
import { TokenKit } from '../src/render/tokens';
import type { IBoardView } from '../src/render/types';

const RAK = 'rakaeli' as CharacterId;
const piece = (character: CharacterId, awaken?: number): Piece => {
  const p: Piece & { awaken?: number } = { id: 'x', owner: 0, character, level: 2, pos: { r: 3, c: 4 } };
  if (awaken !== undefined) p.awaken = awaken;
  return p;
};

describe('Rakaeli render: identity and state', () => {
  it('reads the transform counter defensively', () => {
    expect(awakenOf(piece(RAK))).toBe(0);
    expect(awakenOf(piece(RAK, 2))).toBe(2);
    expect(awakenOf(piece(RAK, 1))).toBe(1);
    expect(awakenOf(piece(RAK, 0))).toBe(0);
    expect(awakenOf(piece(RAK, -1))).toBe(0);
    expect(awakenOf(piece(RAK, Number.NaN))).toBe(0);
    expect(awakenOf({ ...piece(RAK), awaken: '2' } as unknown as Piece)).toBe(0);
  });

  it('picks the move style from the mover state', () => {
    expect(isRakaeli(piece(RAK))).toBe(true);
    expect(isRakaeli(piece('walk'))).toBe(false);
    expect(rakaeliStyle(piece(RAK))).toBe('ash');
    expect(rakaeliStyle(piece(RAK, 2))).toBe('awake');
    expect(rakaeliStyle(piece('walk'))).toBeNull();
  });

  it('names the transformed face art per level', () => {
    expect(awakeFaceUrl(1)).toBe('./chars/rakaeli-awake-lv1-face.jpg');
    expect(awakeFaceUrl(3)).toBe('./chars/rakaeli-awake-lv3-face.jpg');
  });
});

describe('Rakaeli render: transform timeline', () => {
  const s = makeAwakenSample();

  it("'on' swaps the face at the peak and ends fully transformed", () => {
    const tl = awakenTimeline('on', false);
    expect(tl.burnAt).toBeLessThan(tl.swapAt);
    expect(tl.wingAt).toBeLessThan(tl.swapAt);
    // The pulse lands within the face swap (the peak).
    expect(tl.pulseAt).toBeGreaterThanOrEqual(tl.swapAt);
    expect(tl.pulseAt).toBeLessThanOrEqual(tl.swapAt + tl.swapMs);
    expect(sampleAwaken('on', tl, 0, 0, 0, s).face).toBe(0);
    expect(sampleAwaken('on', tl, tl.swapAt - 1, 0, 0, s).face).toBe(0);
    expect(sampleAwaken('on', tl, tl.swapAt + tl.swapMs, 0, 0, s).face).toBeCloseTo(1, 6);
    const mid = sampleAwaken('on', tl, tl.burnAt + tl.burnMs / 2, 0, 0, s);
    expect(mid.burn).toBeGreaterThan(0);
    const end = sampleAwaken('on', tl, tl.duration, 0, 0, s);
    expect(end.face).toBeCloseTo(1, 6);
    expect(end.aura).toBeCloseTo(1, 6);
    expect(end.burn).toBe(0);
    expect(end.wingA).toBe(0);
    // Wings are visible and opening mid-way.
    const w = sampleAwaken('on', awakenTimeline('on', false), tl.wingAt + tl.wingMs * 0.6, 0, 0, s);
    expect(w.wingA).toBeGreaterThan(0.5);
    expect(w.wingK).toBeGreaterThan(0.5);
  });

  it("'off' fades the embers, swaps back and continues from a mid-fade look", () => {
    const tl = awakenTimeline('off', false);
    expect(tl.smokeAt).toBeLessThanOrEqual(tl.swapAt + tl.swapMs);
    expect(sampleAwaken('off', tl, 0, 1, 1, s).face).toBe(1);
    expect(sampleAwaken('off', tl, tl.swapAt + tl.swapMs, 1, 1, s).face).toBeCloseTo(0, 6);
    const end = sampleAwaken('off', tl, tl.duration, 1, 1, s);
    expect(end.face).toBeCloseTo(0, 6);
    expect(end.aura).toBeCloseTo(0, 6);
    expect(end.wingA).toBe(0);
    // Started from a half-faded look: never brighter than where it started.
    const half = sampleAwaken('off', tl, 10, 0.6, 0.5, s);
    expect(half.face).toBeLessThanOrEqual(0.6);
    expect(half.aura).toBeLessThanOrEqual(0.5);
  });

  it('reduced motion: short fades only', () => {
    for (const phase of ['on', 'off'] as const) {
      const tl = awakenTimeline(phase, true);
      expect(tl.duration).toBeLessThanOrEqual(320);
      expect(tl.burnAt).toBe(Infinity);
      expect(tl.wingAt).toBe(Infinity);
      expect(tl.pulseAt).toBe(Infinity);
      expect(tl.smokeAt).toBe(Infinity);
      const mid = sampleAwaken(phase, tl, tl.duration / 2, phase === 'on' ? 0 : 1, phase === 'on' ? 0 : 1, s);
      expect(mid.burn).toBe(0);
      expect(mid.wingA).toBe(0);
      const end = sampleAwaken(phase, tl, tl.duration, phase === 'on' ? 0 : 1, phase === 'on' ? 0 : 1, s);
      expect(end.face).toBeCloseTo(phase === 'on' ? 1 : 0, 6);
    }
  });

  it('embers stay inside the aura and fade at both ends of their life', () => {
    const e = { r: 0, a: 0, s: 0, k: 0 };
    for (let i = 0; i < EMBER_COUNT; i++) {
      for (let t = 0; t < 20; t += 0.37) {
        emberAt(i, t, e);
        expect(e.r).toBeGreaterThan(0.4);
        expect(e.r + e.s).toBeLessThan(AURA_BOX / 2);
        expect(e.k).toBeGreaterThanOrEqual(0);
        expect(e.k).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('Rakaeli render: tables and API', () => {
  it('has render entries in every per-character table', () => {
    expect(CHARACTER_FX[RAK]).toBeDefined();
    expect(CHARACTER_RARITY[RAK]).toBe('epic');
    expect(LOOKS[RAK]).toBeDefined();
    expect(MOVE_CLIP[RAK]).toBe('jump');
    // The transformed palette differs from every other character's FX colours.
    for (const [id, fx] of Object.entries(CHARACTER_FX)) {
      if (id === 'rakaeli') continue;
      expect(fx.primary.toUpperCase()).not.toBe(RAKAELI_AWAKE_FX.primary);
    }
  });

  it('declares playAwaken as optional on IBoardView', () => {
    const v = {} as Pick<IBoardView, 'playAwaken'>;
    expect(v.playAwaken).toBeUndefined();
    const f: NonNullable<IBoardView['playAwaken']> = () => Promise.resolve();
    expect(typeof f).toBe('function');
  });

  it('shares the awake face texture slot per level and keeps per-piece blend uniforms', () => {
    const kit = new TokenKit(4, () => undefined);
    const a = kit.material(RAK, 2, 0);
    const b = kit.material(RAK, 2, 1);
    const c = kit.material(RAK, 3, 0);
    const other = kit.material('walk', 2, 0);
    // One texture slot per (character, level), shared by every coin of that look.
    expect(a.uniforms.uAwakeMap).toBe(b.uniforms.uAwakeMap);
    expect(a.uniforms.uAwakeMap).not.toBe(c.uniforms.uAwakeMap);
    expect(a.uniforms.uAwakeMap).not.toBe(a.uniforms.uMap);
    // The blend / burn are per piece.
    expect(a.uniforms.uAwake).not.toBe(b.uniforms.uAwake);
    expect(a.uniforms.uAwake.value).toBe(0);
    expect(a.uniforms.uBurn.value).toBe(0);
    // Everyone else has no awake art (the crimson-tint path never triggers: uAwake stays 0).
    expect(other.uniforms.uHasAwake.value).toBe(0);
    expect(other.uniforms.uAwakeMap.value).toBeNull();
    expect(kit.hasAwake(RAK, 2)).toBe(false);
    for (const m of [a, b, c, other]) m.dispose();
    kit.dispose();
  });
});
