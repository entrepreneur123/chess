/**
 * Per-character procedural gear on top of the glTF bodies (built once per template, merged into
 * the unit mesh). Positions are measured on the actual rest-pose body (BodyCloud) and props, so
 * the gear follows the models instead of hard-coded guesses.
 *
 *  sad   paladin   crest/plume, cape (2 sway bones), belt + pouches, split tabard with emblem,
 *                  layered pauldrons, engraved glowing blade; Lv3 crown, halo ring, feather wings.
 *  marki war bull  team barding with trim + tassels, mane, angry brows, horn wraps / iron caps /
 *                  obsidian horn extensions with flames, nose ring, peytral with rivets, tail tuft.
 *  walk  shield    kettle helmet + cheek guards (Lv2 nasal + crest, Lv3 horns + glowing visor),
 *                  scarf with sway tails, spear (Lv2 pennant, Lv3 arcane glaive), embossed shield
 *                  emblem, belt; chain mail comes from the palette pattern.
 *  insaner imp     bald skull cap over the rogue face, horns (Lv1 stubs, Lv2 curved, Lv3 jagged crown),
 *                  manic grin + fangs, wagging 2-bone tail with a flame tip, rope + rag loincloth and
 *                  crooked trident (Lv1), bone mask + jester coat + skull chain + violet dagger edges
 *                  (Lv2), flame cape (2 sway bones), orbiting stolen-weapon shards + wisps (Lv3).
 */
import * as THREE from 'three';
import type { CharacterId, Level, PlayerId } from '../../engine/types';
import type { LevelLook, Tint } from './config';
import {
  BodyCloud,
  GearBuilder,
  alongY,
  blade,
  crossOutline,
  flat,
  meshBox,
  plate,
  sheet,
  starOutline,
  taperTube,
  trs,
  worldPos,
  type GearStyle,
  type SkinFn,
} from './gear';
import { PATTERN } from './material';

/** Secondary-motion bone driven by the actor (cloth, wings, pennant). */
export interface SecondarySpec {
  bone: string;
  /** Rotation axis in the bone's local frame (= rest world frame). */
  axis: [number, number, number];
  idleAmp: number;
  idleFreq: number;
  /** Extra angle while running / jumping. */
  run: number;
  phase: number;
  /** Continuous rotation (rad/s) on top of the sway (orbiting FX). */
  spin?: number;
}

export interface OutfitCtx {
  ch: CharacterId;
  level: Level;
  owner: PlayerId;
  look: LevelLook;
  scene: THREE.Object3D;
  body: BodyCloud;
  gear: GearBuilder;
  bone(name: string): THREE.Bone;
  /** New bone under `parent` at a rest world position (identity rest world rotation). */
  addBone(name: string, parent: THREE.Bone, at: THREE.Vector3): THREE.Bone;
  secondary: SecondarySpec[];
  tint(t: Tint): string;
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Blend weights along a chain of bones ordered by a coordinate (z for the bull spine). */
function chainSkin(bones: THREE.Bone[], coord: (p: THREE.Vector3) => number): SkinFn {
  const ws = new THREE.Vector3();
  const cs = bones.map((b) => coord(b.getWorldPosition(ws)));
  return (p) => {
    const c = coord(p);
    if (c <= cs[0]) return { a: bones[0] };
    for (let i = 0; i < bones.length - 1; i++) {
      if (c <= cs[i + 1]) return { a: bones[i], b: bones[i + 1], t: (c - cs[i]) / Math.max(1e-6, cs[i + 1] - cs[i]) };
    }
    return { a: bones[bones.length - 1] };
  };
}

export function buildOutfit(ctx: OutfitCtx): void {
  if (ctx.ch === 'sad') paladin(ctx);
  else if (ctx.ch === 'marki') bull(ctx);
  else if (ctx.ch === 'insaner') imp(ctx);
  else soldier(ctx);
}

// ====================================================================== paladin

function paladin(ctx: OutfitCtx): void {
  const { gear, level: L, scene, body } = ctx;
  const head = ctx.bone('head');
  const chest = ctx.bone('chest');
  const hips = ctx.bone('hips');
  const team = ctx.tint(L === 1 ? 'teamMuted' : 'team');
  const teamLight = ctx.tint('teamLight');
  const teamDark = ctx.tint(L === 1 ? 'teamMuted' : 'teamDark');
  const gold: GearStyle = L === 1 ? { color: '#8E7A52', metal: 0.35 } : { color: L === 3 ? '#FFD766' : '#F0BE48', metal: 1, glow: L === 3 ? 0.45 : 0.15 };
  const armor: GearStyle =
    L === 1 ? { color: '#8A8F98', metal: 0.35 } : L === 2 ? { color: '#BCD0EC', metal: 0.85 } : { color: '#FFF8EA', metal: 0.55 };
  const leather: GearStyle = L === 1 ? { color: '#5E412D' } : L === 2 ? { color: '#26304A' } : { color: '#E9DCC2' };

  // --- helmet crest / plume: a fan of volumetric feather blades along the helmet ridge.
  const hb = meshBox(scene, 'Knight_Helmet');
  const hc = hb.getCenter(new THREE.Vector3());
  const hs = hb.getSize(new THREE.Vector3());
  const plumeBone = ctx.addBone('fx_plume', head, V(0, hb.max.y, hc.z));
  ctx.secondary.push({ bone: 'fx_plume', axis: [1, 0, 0], idleAmp: 0.05, idleFreq: 2.1, run: 0.22, phase: 0.3 });
  const size = [0, 0.8, 1.08, 1.3][L];
  const n = L === 1 ? 8 : 12;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const phi = lerp(-0.35, 1.75, t);
    const p = V(0, hc.y + hs.y * 0.47 * Math.cos(phi), hc.z - hs.z * 0.42 * Math.sin(phi));
    const out = V(0, Math.cos(phi), -Math.sin(phi) * 1.1).normalize();
    const dir = out.clone().lerp(V(0, 0.15, -1), 0.35 + 0.35 * t).normalize();
    const len = size * hs.y * (0.62 - 0.22 * t) * (L === 1 ? 0.8 : 1);
    const w = size * hs.y * 0.3 * (1 - 0.3 * t);
    const col = L === 1 ? team : i % 2 === 0 ? team : teamDark;
    gear.add(blade(w, w * 0.55, 6, 0.4), alongY(p, dir, [1, len, 1]), { color: col, glow: L === 3 ? 0.12 : 0 }, plumeBone);
  }
  // Crest base ridge.
  const ridge: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const phi = lerp(-0.45, 1.85, i / 6);
    ridge.push(V(0, hc.y + hs.y * 0.45 * Math.cos(phi), hc.z - hs.z * 0.41 * Math.sin(phi)));
  }
  gear.add(taperTube(ridge, () => hs.y * 0.045, 14, 6, 0.7), null, L === 1 ? { color: '#5A5E66', metal: 0.4 } : gold, head);

  // --- visor: stern face guard (Lv1 nasal + brow, Lv2 barred grille, Lv3 closed plate + glowing slit).
  const hd = body.box((_p, t) => t === 3);
  const fc = hd.getCenter(new THREE.Vector3());
  const fs = hd.getSize(new THREE.Vector3());
  const fz = hd.max.z + 0.015;
  const fy = fc.y - fs.y * 0.08;
  const visor: GearStyle = L === 3 ? { color: '#FFF4DC', metal: 0.6 } : armor;
  gear.add(flat(new THREE.BoxGeometry(fs.x * 0.62, fs.y * 0.07, 0.07)), trs([fc.x, fy + fs.y * 0.12, fz], [0.15, 0, 0]), L === 1 ? armor : gold, head);
  if (L === 1) {
    gear.add(flat(new THREE.BoxGeometry(fs.x * 0.07, fs.y * 0.28, 0.06)), trs([fc.x, fy - 0.02, fz + 0.01]), armor, head);
  } else if (L === 2) {
    for (const bx of [-0.18, -0.06, 0.06, 0.18]) {
      gear.add(flat(new THREE.BoxGeometry(fs.x * 0.045, fs.y * 0.34, 0.05)), trs([fc.x + bx * fs.x, fy - 0.03, fz + 0.005 - Math.abs(bx) * 0.12]), visor, head);
    }
  } else {
    const shell = new THREE.CylinderGeometry(fs.x * 0.42, fs.x * 0.36, fs.y * 0.36, 16, 1, false, -0.95, 1.9);
    gear.add(shell, trs([fc.x, fy - fs.y * 0.03, fz - fs.x * 0.4]), visor, head);
    gear.add(flat(new THREE.BoxGeometry(fs.x * 0.5, fs.y * 0.035, 0.05)), trs([fc.x, fy + fs.y * 0.04, fz + 0.03]), { color: '#9FE8FF', glow: 2.2 }, head);
    gear.add(flat(new THREE.BoxGeometry(fs.x * 0.035, fs.y * 0.16, 0.05)), trs([fc.x, fy - fs.y * 0.04, fz + 0.03]), { color: '#9FE8FF', glow: 2.2 }, head);
  }

  // --- crown + halo (Lv3).
  if (L === 3) {
    const cy = hc.y + hs.y * 0.3;
    const crx = hs.x * 0.43;
    const crz = hs.z * 0.4;
    const band = new THREE.CylinderGeometry(1, 1.04, hs.y * 0.09, 28, 1, true);
    gear.add(band, trs([hc.x, cy, hc.z - hs.z * 0.03], [0, 0, 0], [crx, 1, crz]), gold, head);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const p = V(hc.x + Math.sin(a) * crx, cy + hs.y * 0.04, hc.z - hs.z * 0.03 + Math.cos(a) * crz);
      const big = i % 2 === 0;
      const h = hs.y * (big ? 0.2 : 0.12);
      gear.add(flat(new THREE.ConeGeometry(hs.y * 0.045, h, 4)), alongY(p.clone().add(V(0, h / 2, 0)), V(Math.sin(a) * 0.25, 1, Math.cos(a) * 0.25)), gold, head);
      if (big) gear.add(new THREE.OctahedronGeometry(hs.y * 0.035), trs(p.clone().add(V(0, h * 1.05, 0))), { color: teamLight, glow: 1.4 }, head);
    }
    const halo = new THREE.TorusGeometry(hs.x * 0.36, hs.y * 0.026, 6, 40);
    gear.add(halo, trs([hc.x, hb.max.y + hs.y * 0.2, hc.z - hs.z * 0.18], [Math.PI / 2 - 0.35, 0, 0]), { color: '#FFE9A0', glow: 2.2, metal: 1 }, head);
  }

  // --- cape (two sway bones under the chest).
  const TORSO = (t: number): boolean => t === 0;
  const top = body.sliceY(1.18, 0.06, TORSO);
  const yTop = 1.24;
  const zTop = top.cz - top.rz - 0.01;
  const yBot = L === 1 ? 0.42 : L === 2 ? 0.12 : 0.06;
  const len = yTop - yBot;
  const capeA = ctx.addBone('fx_capeA', chest, V(0, yTop, zTop));
  const capeB = ctx.addBone('fx_capeB', capeA, V(0, yTop - len * 0.5, zTop - 0.1));
  ctx.secondary.push(
    { bone: 'fx_capeA', axis: [1, 0, 0], idleAmp: 0.035, idleFreq: 1.6, run: 0.6, phase: 0 },
    { bone: 'fx_capeB', axis: [1, 0, 0], idleAmp: 0.06, idleFreq: 1.6, run: 0.32, phase: 0.9 },
  );
  const capeSkin: SkinFn = (p) => {
    const s = clamp01((yTop - p.y) / len);
    if (s < 0.18) return { a: chest, b: capeA, t: s / 0.18 };
    return { a: capeA, b: capeB, t: clamp01((s - 0.3) / 0.45) };
  };
  const wTop = top.rx * 0.95;
  const wBot = top.rx * (L === 3 ? 1.5 : 1.3);
  const capeAt = (u: number, v: number, out: THREE.Vector3): void => {
    const x = (u * 2 - 1) * lerp(wTop, wBot, v);
    const bulge = 0.12 * (1 - (u * 2 - 1) ** 2);
    const fold = 0.035 * Math.sin(u * Math.PI * 5) * v;
    out.set(x, yTop - v * len, zTop - 0.02 - bulge * (0.4 + 0.6 * v) - v * 0.14 + fold);
  };
  const capeCol = L === 3 ? team : L === 2 ? team : teamDark;
  const hem = L === 1 ? 1 : 0.9;
  gear.add(sheet(10, 9, (u, v, o) => capeAt(u, v * hem, o)), null, { color: capeCol }, capeSkin);
  if (L > 1) {
    gear.add(sheet(16, 1, (u, v, o) => capeAt(u, hem + v * (1 - hem), o), 0.016), null, L === 3 ? gold : { color: '#DDE6F2', metal: 0.7 }, capeSkin);
    // Shoulder clasps.
    for (const sx of [-1, 1]) {
      gear.add(new THREE.SphereGeometry(0.06, 10, 8), trs([sx * wTop * 0.85, yTop - 0.02, zTop + 0.02]), gold, chest);
    }
  }
  if (L === 3) {
    // Emblem on the back of the cape (follows the cloth).
    const p = new THREE.Vector3();
    capeAt(0.5, 0.36, p);
    gear.add(plate(starOutline(8, 0.45), 0.03, 0.01), trs(p.clone().add(V(0, 0, -0.03)), [0, 0, 0], 0.42), { color: '#FFE9A0', metal: 1, glow: 0.6 }, capeSkin);
  }

  // --- belt, buckle, pouches.
  const wy = 0.52;
  const w = body.sliceY(wy, 0.05, TORSO);
  gear.add(new THREE.CylinderGeometry(1, 1, 0.085, 28, 1, true), trs([w.cx, wy, w.cz], [0, 0, 0], [w.rx + 0.02, 1, w.rz + 0.02]), leather, hips);
  gear.add(flat(new THREE.BoxGeometry(0.15, 0.12, 0.04)), trs([w.cx, wy, w.cz + w.rz + 0.03]), gold, hips);
  if (L > 1) {
    for (const sx of [-1, 1]) {
      const px = w.cx + sx * w.rx * 0.78;
      const pz = w.cz - w.rz * 0.45;
      gear.add(flat(new THREE.BoxGeometry(0.13, 0.15, 0.1)), trs([px, wy - 0.07, pz - 0.02], [0, sx * 0.5, 0]), leather, hips);
      gear.add(flat(new THREE.BoxGeometry(0.14, 0.06, 0.11)), trs([px, wy - 0.01, pz - 0.02], [0, sx * 0.5, 0]), leather, hips);
      gear.add(new THREE.SphereGeometry(0.018, 6, 4), trs([px + sx * 0.0, wy - 0.035, pz + 0.04]), gold, hips);
    }
  }

  // --- tabard: two front panels (each follows its thigh) + emblem.
  if (L > 1) {
    const yT = wy - 0.03;
    const yB = L === 3 ? 0.08 : 0.15;
    for (const sx of [-1, 1]) {
      const leg = ctx.bone(sx > 0 ? 'upperlegl' : 'upperlegr');
      const skin: SkinFn = (p) => ({ a: hips, b: leg, t: 0.75 * clamp01((yT - p.y) / (yT - yB)) });
      const at = (u: number, v: number, o: THREE.Vector3): void => {
        const x = sx * lerp(0.012, 0.16, u);
        const s = body.sliceY(lerp(yT, yB, v), 0.06, (t) => t === 0 || t === 2);
        o.set(x, lerp(yT, yB, v), Math.max(s.cz + s.rz, w.cz + w.rz * 0.92) + 0.03 + 0.03 * v);
      };
      gear.add(sheet(3, 5, at, 0.014), null, { color: team }, skin);
      gear.add(sheet(3, 1, (u, v, o) => at(u, 0.88 + v * 0.12, o.set(0, 0, 0)), 0.02), null, gold, skin);
    }
    // Emblem on the chest (team tabard of the body) + belt plaque.
    const c = body.sliceY(0.86, 0.05, TORSO);
    const ep = V(c.cx, 0.86, c.cz + c.rz + 0.015);
    gear.add(plate(L === 3 ? starOutline(8, 0.5) : crossOutline(0.28), 0.03, 0.008), trs(ep, [0, 0, 0], L === 3 ? 0.32 : 0.26), L === 3 ? { color: '#FFF3C4', metal: 1, glow: 0.9 } : gold, chest);
  }

  // --- layered pauldrons (Lv2+): stacked open shells under the glTF pauldron + rivets / spikes.
  if (L > 1) {
    for (const sx of [-1, 1]) {
      const arm = ctx.bone(sx > 0 ? 'upperarml' : 'upperarmr');
      const pb = meshBox(scene, sx > 0 ? 'Pauldron_L' : 'Pauldron_R');
      const pc = pb.getCenter(new THREE.Vector3());
      const ps = pb.getSize(new THREE.Vector3());
      for (let k = 0; k < 2; k++) {
        const r = ps.z * (0.47 - k * 0.04);
        const shell = new THREE.CylinderGeometry(r, r * 1.12, ps.x * 0.24, 16, 1, true, -Math.PI * 0.62, Math.PI * 1.24);
        const x = pc.x + sx * ps.x * (0.32 + k * 0.2);
        gear.add(shell, trs([x, pc.y - ps.y * (0.16 + k * 0.1), pc.z], [0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2]), k === 0 ? armor : { ...gold, glow: (gold.glow ?? 0) * 0.5 }, arm);
      }
      // Trim ring on the pauldron rim + rivets.
      for (let k = 0; k < 4; k++) {
        const a = -0.9 + k * 0.6;
        gear.add(new THREE.SphereGeometry(ps.y * 0.035, 6, 4), trs([pc.x + sx * ps.x * 0.18, pc.y + Math.cos(a) * ps.y * 0.42, pc.z + Math.sin(a) * ps.z * 0.42]), gold, arm);
      }
      if (L === 3) {
        // Swept "wing" flares on the pauldrons.
        for (let k = 0; k < 3; k++) {
          const p = V(pc.x + sx * ps.x * 0.05, pc.y + ps.y * (0.28 - k * 0.05), pc.z - ps.z * (0.25 - k * 0.22));
          gear.add(blade(ps.z * 0.22, ps.z * 0.06, 5, 0.3), alongY(p, V(sx * 0.6, 1, -0.5 + k * 0.25), [1, ps.y * (0.55 - k * 0.1), 1]), gold, arm);
        }
      }
    }
  }

  // --- engraved glowing line on the blade (Lv2+).
  const swordName = L === 1 ? '1H_Sword' : L === 2 ? '2H_Sword' : 'Gold_Sword';
  engrave(ctx, swordName, 'handslotr', L === 1 ? null : { color: L === 3 ? '#FFF2B0' : '#8FDBFF', glow: L === 3 ? 1.8 : 1.3, pattern: PATTERN.rune });

  // --- feather wings (Lv3).
  if (L === 3) {
    const back = body.sliceY(1.05, 0.06, TORSO);
    for (const sx of [-1, 1]) {
      const root = V(sx * 0.12, 1.12, back.cz - back.rz + 0.02);
      const wb = ctx.addBone(sx > 0 ? 'fx_wingL' : 'fx_wingR', chest, root);
      ctx.secondary.push({ bone: wb.name, axis: [0, sx, 0], idleAmp: 0.12, idleFreq: 1.1, run: -0.35, phase: 0 });
      const arm = [root, V(sx * 0.34, 1.55, root.z - 0.2), V(sx * 0.55, 2.05, root.z - 0.3), V(sx * 0.62, 2.38, root.z - 0.34)];
      const curve = new THREE.CatmullRomCurve3(arm);
      gear.add(taperTube(arm, (t) => 0.06 * (1 - 0.6 * t), 12, 6), null, { color: '#FFE08A', metal: 1, glow: 0.5 }, wb);
      const p = new THREE.Vector3();
      // Primary feathers (long, white), coverts (short, gold).
      for (let k = 0; k < 11; k++) {
        const t = 0.15 + 0.85 * (k / 10);
        curve.getPointAt(t, p);
        const a = lerp(0.2, 0.85, t);
        const dir = V(sx * Math.sin(a), -Math.cos(a), -0.25);
        const lenF = lerp(0.55, 0.85, t);
        gear.add(blade(0.34, 0.035, 6, 0.5), alongY(p.clone().add(V(0, 0, -0.02 - k * 0.004)), dir, [1, lenF * (0.9 + 0.15 * Math.sin(k * 1.7)), 1]), { color: '#FFFFFF', glow: 0.18 }, wb);
        if (k % 2 === 0) {
          gear.add(blade(0.15, 0.04, 5, 0.35), alongY(p.clone().add(V(0, 0, 0.03)), dir, [1, lenF * 0.45, 1]), { color: '#FFD34D', metal: 1, glow: 0.4 }, wb);
        }
      }
    }
  }
}

/** Glowing engraving strip along a blade prop (null style = nothing). */
function engrave(ctx: OutfitCtx, prop: string, boneName: string, style: GearStyle | null): void {
  if (!style) return;
  const m = ctx.scene.getObjectByName(prop) as THREE.Mesh | undefined;
  if (!m || !m.isMesh) return;
  const box = meshBox(ctx.scene, prop);
  const len = box.max.z - box.min.z;
  const z0 = box.min.z + len * 0.42;
  const z1 = box.max.z - len * 0.08;
  // Blade cross-section in that range.
  const P = m.geometry.attributes.position;
  const v = new THREE.Vector3();
  const bb = new THREE.Box3();
  const cx = (box.min.x + box.max.x) / 2;
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
    if (v.z > z0 && v.z < z1 && Math.abs(v.x - cx) < len * 0.08) bb.expandByPoint(v);
  }
  if (bb.isEmpty()) return;
  const c = bb.getCenter(new THREE.Vector3());
  const s = bb.getSize(new THREE.Vector3());
  ctx.gear.add(new THREE.BoxGeometry(Math.max(0.012, s.x * 0.16), s.y + 0.012, (z1 - z0) * 0.92), trs(c), style, ctx.bone(boneName));
}

// ====================================================================== bull

function bull(ctx: OutfitCtx): void {
  const { gear, level: L, body } = ctx;
  const HIDE = (t: number): boolean => t === 0 || t === 1;
  const headB = ctx.bone('Head');
  const spine = ['Back', 'Torso', 'Torso2', 'Torso3', 'Neck1'].map((n) => ctx.bone(n));
  const spineSkin = chainSkin(spine, (p) => p.z);
  const neck = ['Torso3', 'Neck1', 'Neck2', 'Neck3', 'Head'].map((n) => ctx.bone(n));
  const neckSkin = chainSkin(neck, (p) => p.z);
  const team = ctx.tint(L === 1 ? 'teamMuted' : L === 3 ? 'teamDeep' : 'team');
  const iron: GearStyle = L === 3 ? { color: '#2A2A30', metal: 0.9 } : { color: L === 1 ? '#5C5650' : '#8A94A2', metal: L === 1 ? 0.45 : 0.9 };
  const trim: GearStyle = L === 1 ? { color: '#5A3A22' } : L === 2 ? { color: '#A9B3C0', metal: 0.9 } : { color: '#FFB347', metal: 1, glow: 0.7 };
  const rivet: GearStyle = L === 3 ? { color: '#FFC861', metal: 1, glow: 0.5 } : { color: '#C9CFD8', metal: 1 };

  // --- barding blanket over the back (team), trim + tassels.
  const z0 = -1.55;
  const z1 = 1.45;
  const span = 1.3;
  const sec = (z: number): { cx: number; cy: number; rx: number; ry: number } => {
    // Low-poly body: wide slab, empty slices are filled from neighbours below.
    const s = body.sliceZ(z, 0.45, HIDE, 2.0);
    const bottom = s.cy - s.ry;
    const ry = (s.top - bottom) / 2;
    return { cx: s.cx, cy: s.top - ry, rx: s.rx, ry };
  };
  const raw: ({ cx: number; cy: number; rx: number; ry: number } | null)[] = [];
  for (let i = 0; i <= 12; i++) {
    const q = sec(lerp(z0, z1, i / 12));
    raw.push(q.rx > 0.4 && q.ry > 0.4 ? q : null);
  }
  const filled = raw.map((q, i) => {
    if (q) return q;
    for (let d = 1; d < 13; d++) {
      const a = raw[i - d] ?? null;
      const b = raw[i + d] ?? null;
      if (a || b) return (a ?? b) as { cx: number; cy: number; rx: number; ry: number };
    }
    return { cx: 0, cy: 3.4, rx: 1.1, ry: 1.1 };
  });
  const secs = filled.map((q, i) => {
    const a = filled[Math.max(0, i - 1)];
    const b = filled[Math.min(12, i + 1)];
    const m = (k: 'cx' | 'cy' | 'rx' | 'ry'): number => a[k] * 0.25 + q[k] * 0.5 + b[k] * 0.25;
    return { cx: m('cx'), cy: m('cy'), rx: Math.max(m('rx'), q.rx), ry: Math.max(m('ry'), q.ry) };
  });
  const drape = (u: number, v: number, o: THREE.Vector3, off = 0.06): void => {
    const f = v * 12;
    const i = Math.min(11, Math.floor(f));
    const k = f - i;
    const a = secs[i];
    const b = secs[i + 1];
    const rx = lerp(a.rx, b.rx, k) + off;
    const ry = lerp(a.ry, b.ry, k) + off;
    const th = (u * 2 - 1) * span;
    o.set(lerp(a.cx, b.cx, k) + Math.sin(th) * rx, lerp(a.cy, b.cy, k) + Math.cos(th) * ry, lerp(z0, z1, v));
  };
  gear.add(sheet(14, 12, (u, v, o) => drape(u, v, o), 0.03), null, { color: team, glow: L === 3 ? 0.05 : 0 }, spineSkin);
  for (const side of [0, 1]) {
    // Hem trim band along each lower edge.
    gear.add(
      sheet(12, 1, (u, v, o) => drape(side === 0 ? v * 0.06 : 1 - v * 0.06, u, o, 0.075), 0.03),
      null,
      trim,
      spineSkin,
    );
    // Tassels.
    for (let k = 0; k <= 5; k++) {
      const p = new THREE.Vector3();
      drape(side, 0.08 + 0.84 * (k / 5), p, 0.08);
      gear.add(flat(new THREE.ConeGeometry(0.07, 0.26, 5)), trs(p.clone().add(V(0, -0.15, 0)), [Math.PI, 0, 0]), L === 1 ? { color: '#4A3020' } : trim, spineSkin);
    }
  }
  // Team emblem on each flank of the barding.
  for (const side of [0, 1]) {
    const p = new THREE.Vector3();
    drape(side === 0 ? 0.13 : 0.87, 0.5, p, 0.1);
    const out = V(side === 0 ? -1 : 1, 0.25, 0).normalize();
    const m = alongY(p, out, 0.62).multiply(trs([0, 0, 0], [-Math.PI / 2, 0, 0]));
    gear.add(plate(L === 3 ? starOutline(6, 0.5) : L === 2 ? starOutline(4, 0.45, Math.PI / 4) : [[-0.4, 0.4], [0.4, 0.4], [0.4, -0.1], [0, -0.5], [-0.4, -0.1]], 0.04, 0.012), m, L === 1 ? { color: '#B9A27A' } : { color: L === 3 ? '#FFD27A' : '#F0F4FA', metal: 0.8, glow: L === 3 ? 0.8 : 0.1 }, spineSkin);
  }

  // --- mane: two staggered rows of blades along the neck ridge.
  const maneN = 12;
  const maneZ0 = worldPos(ctx.scene, 'Torso3').z + 0.2;
  const maneZ1 = worldPos(ctx.scene, 'Head').z - 0.55;
  for (let k = 0; k < maneN; k++) {
    const t = k / (maneN - 1);
    const z = lerp(maneZ0, maneZ1, t);
    const s = body.sliceZ(z, 0.14, HIDE, 2.4);
    const sx = k % 2 === 0 ? -0.09 : 0.09;
    const p = V(s.cx + sx, s.top - 0.06, z);
    const sizeK = [0, 1, 1.15, 1.35][L] * (0.75 + 0.35 * Math.sin(Math.PI * clamp01(t * 1.1)));
    const dir = V(sx * 1.2, 0.85, -0.55 - 0.2 * t).normalize();
    gear.add(blade(0.34, 0.15, 5, 0.3), alongY(p, dir, [sizeK, 0.62 * sizeK, sizeK]), { color: L === 1 ? '#2E1A10' : L === 2 ? '#1E0A08' : '#120C0E' }, neckSkin);
    if (L === 3) {
      gear.add(blade(0.22, 0.1, 5, 0.3), alongY(p.clone().add(V(0, 0.06, -0.02)), dir, [sizeK, 0.82 * sizeK, sizeK]), { color: '#B02000', glow: 0.2, pattern: PATTERN.flame }, neckSkin);
    }
  }

  // --- angry brows + eye sockets.
    for (const sx of [-1, 1]) {
    const eb = body.box((p, t) => t === 4 && Math.sign(p.x) === sx);
    if (eb.isEmpty()) continue;
    const ec = eb.getCenter(new THREE.Vector3());
    const brow = flat(new THREE.BoxGeometry(0.2, 0.13, 0.58));
    gear.add(brow, trs([ec.x + sx * 0.07, ec.y + 0.14, ec.z + 0.04], [0.5, sx * 0.3, sx * -0.4]), { color: L === 3 ? '#0C080A' : L === 2 ? '#2A0E0A' : '#3A2418' }, headB);
  }

  // --- horns: wraps, iron caps (Lv2), obsidian extensions + flames (Lv3).
  const headPos = worldPos(ctx.scene, 'Head');
  for (const sx of [-1, 1]) {
    const hb = body.box((p, t) => t === 6 && Math.sign(p.x) === sx);
    if (hb.isEmpty()) continue;
    // Root: horn vertex closest to the head centre; tip: farthest from the root.
    let root = new THREE.Vector3();
    let best = Infinity;
    body.points.forEach((p, i) => {
      if (body.tags[i] !== 6 || Math.sign(p.x) !== sx) return;
      const d = p.distanceToSquared(headPos);
      if (d < best) {
        best = d;
        root = p;
      }
    });
    let tip = root.clone();
    best = -1;
    body.points.forEach((p, i) => {
      if (body.tags[i] !== 6 || Math.sign(p.x) !== sx) return;
      const d = p.distanceToSquared(root);
      if (d > best) {
        best = d;
        tip = p;
      }
    });
    const axis = tip.clone().sub(root);
    const hl = axis.length();
    axis.normalize();
    const radiusAt = (t: number): number => {
      let r = 0;
      const c = root.clone().addScaledVector(axis, hl * t);
      body.points.forEach((p, i) => {
        if (body.tags[i] !== 6 || Math.sign(p.x) !== sx) return;
        const d = p.clone().sub(c);
        const along = d.dot(axis);
        if (Math.abs(along) > hl * 0.08) return;
        r = Math.max(r, d.addScaledVector(axis, -along).length());
      });
      return Math.max(0.04, r);
    };
    const bands = L === 1 ? [0.2] : L === 2 ? [0.18, 0.34] : [0.16, 0.3, 0.46];
    for (const t of bands) {
      const r = radiusAt(t);
      const c = root.clone().addScaledVector(axis, hl * t);
      const tor = new THREE.TorusGeometry(r * 1.02, r * 0.22, 6, 18).rotateX(Math.PI / 2);
      gear.add(tor, alongY(c, axis), L === 1 ? { color: '#4E3220' } : L === 2 ? { color: team } : trim, headB);
      if (L > 1) gear.add(new THREE.TorusGeometry(r * 1.05, r * 0.1, 4, 18).rotateX(Math.PI / 2), alongY(c.clone().addScaledVector(axis, hl * 0.05), axis), iron, headB);
    }
    if (L === 2) {
      const r = radiusAt(0.8);
      const c = root.clone().addScaledVector(axis, hl * 0.86);
      gear.add(new THREE.ConeGeometry(r * 1.25, hl * 0.42, 10), alongY(c, axis), { color: '#C8D0DA', metal: 1 }, headB);
    }
    if (L === 3) {
      // Curling obsidian extension, then a flame on the tip.
      const r = radiusAt(0.85);
      const up = V(0, 1, 0);
      const p0 = root.clone().addScaledVector(axis, hl * 0.82);
      const d1 = axis.clone().lerp(up, 0.55).normalize();
      const pts = [p0, p0.clone().addScaledVector(axis, hl * 0.14), p0.clone().addScaledVector(axis, hl * 0.18).addScaledVector(d1, hl * 0.2)];
      gear.add(taperTube(pts, (t) => r * (1.05 - 0.85 * t), 10, 8), null, { color: '#1C1418', metal: 0.7 }, headB);
      const tipP = pts[2];
      gear.add(blade(r * 1.9, r * 1.5, 6, 0.22), alongY(tipP.clone().addScaledVector(d1, -r * 0.4), d1.clone().lerp(up, 0.5).normalize(), [1, hl * 0.55, 1]), { color: '#B02000', glow: 0.15, pattern: PATTERN.flame }, headB);
      gear.add(blade(r * 1.2, r * 0.9, 6, 0.32), alongY(tipP.clone(), d1.clone().lerp(up, 0.6).normalize(), [1, hl * 0.32, 1]), { color: '#FFB020', glow: 0.6 }, headB);
    }
  }

  // --- nose ring.
  const mb = body.box((_p, t) => t === 3);
  if (!mb.isEmpty()) {
    const ring = new THREE.TorusGeometry(0.15, 0.035, 6, 18).rotateY(Math.PI / 2);
    gear.add(ring, trs([(mb.min.x + mb.max.x) / 2, mb.min.y + 0.02, mb.max.z - 0.07], [0.3, 0, 0]), L === 1 ? { color: '#77787E', metal: 0.8 } : { color: '#FFC64A', metal: 1, glow: L === 3 ? 0.6 : 0.05 }, headB);
  }

  // --- peytral (chest plate) with rivets (Lv2+), spikes (Lv3).
  if (L > 1) {
    const n1 = worldPos(ctx.scene, 'Neck1');
    const yC = n1.y - 0.15;
    let zFront = -Infinity;
    let cxs = 0;
    let n = 0;
    body.points.forEach((p, i) => {
      if (!HIDE(body.tags[i]) || Math.abs(p.y - yC) > 0.7 || Math.abs(p.x) > 1.0 || p.z < n1.z - 1.2 || p.z > n1.z + 1.2) return;
      zFront = Math.max(zFront, p.z);
      cxs += p.x;
      n++;
    });
    if (n > 0) {
      const s = body.sliceY(yC, 0.25, HIDE);
      const r = Math.max(0.6, s.rx * 0.95);
      const cz = zFront - r + 0.08;
      const shell = new THREE.CylinderGeometry(r, r * 1.06, 0.62, 18, 1, true, -1.15, 2.3);
      const torso3 = ctx.bone('Torso3');
      const nk = ctx.bone('Neck1');
      const skin: SkinFn = (p) => ({ a: torso3, b: nk, t: 0.5 * clamp01((p.y - yC + 0.3) / 0.6) });
      gear.add(shell, trs([cxs / n, yC, cz], [0.25, 0, 0]), iron, skin);
      for (let k = 0; k < 7; k++) {
        const a = -1.0 + (k / 6) * 2.0;
        for (const dy of [-0.26, 0.26]) {
          gear.add(new THREE.SphereGeometry(0.04, 6, 4), trs([cxs / n + Math.sin(a) * (r + 0.03), yC + dy, cz + Math.cos(a) * (r + 0.03) - dy * 0.25]), rivet, skin);
        }
      }
      if (L === 3) {
        for (const a of [-0.6, 0, 0.6]) {
          const p = V(cxs / n + Math.sin(a) * (r + 0.02), yC, cz + Math.cos(a) * (r + 0.02));
          gear.add(flat(new THREE.ConeGeometry(0.09, 0.42, 5)), alongY(p.clone().add(V(Math.sin(a) * 0.18, 0, Math.cos(a) * 0.18)), V(Math.sin(a), 0.1, Math.cos(a))), { color: '#2A2228', metal: 0.8 }, skin);
        }
      }
    }
  }

  // --- tail tuft.
  const tb = body.box((p, t) => HIDE(t) && p.z < -2.6 && Math.abs(p.x) < 0.3);
  if (!tb.isEmpty()) {
    const tail7 = ctx.bone('Tail7');
    const p = V((tb.min.x + tb.max.x) / 2, tb.min.y + 0.12, (tb.min.z + tb.max.z) / 2);
    gear.add(blade(0.28, 0.22, 6, 0.4), alongY(p.clone().add(V(0, 0.15, 0)), V(0, -1, -0.15), [1, 0.62, 1]), L === 3 ? { color: '#B02000', glow: 0.2, pattern: PATTERN.flame } : { color: L === 2 ? '#1E0A08' : '#2E1A10' }, tail7);
  }
}

// ====================================================================== shield soldier

function soldier(ctx: OutfitCtx): void {
  const { gear, level: L, scene, body } = ctx;
  const head = ctx.bone('head');
  const chest = ctx.bone('chest');
  const hips = ctx.bone('hips');
  const team = ctx.tint(L === 1 ? 'teamMuted' : 'team');
  const teamLight = ctx.tint('teamLight');
  const metal: GearStyle =
    L === 1 ? { color: '#6E7178', metal: 0.45 } : L === 2 ? { color: '#CED7E3', metal: 0.95 } : { color: '#43356E', metal: 0.95 };
  const trimS: GearStyle = L === 1 ? { color: '#5A4030' } : L === 2 ? { color: '#E8B64A', metal: 1, glow: 0.12 } : { color: '#E6C66E', metal: 1, glow: 0.35 };
  const arcane: GearStyle = { color: '#C08CFF', glow: 1.8, pattern: PATTERN.rune };

  // --- kettle helmet with cheek guards.
  const hbx = body.box((_p, t) => t === 3);
  const hc = hbx.getCenter(new THREE.Vector3());
  const hs = hbx.getSize(new THREE.Vector3());
  const rx = hs.x * 0.53;
  const ry = hs.y * 0.52;
  const rz = hs.z * 0.53;
  const domeC = V(hc.x, hc.y + hs.y * 0.1, hc.z - hs.z * 0.02);
  const dome = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, 1.38);
  gear.add(dome, trs(domeC, [-0.12, 0, 0], [rx, ry, rz]), metal, head);
  // Brim band.
  const brimY = domeC.y + ry * Math.cos(1.38) - 0.01;
  gear.add(new THREE.CylinderGeometry(1.0, 1.06, hs.y * 0.07, 28, 1, true), trs([domeC.x, brimY, domeC.z + 0.03], [-0.12, 0, 0], [rx * 1.0, 1, rz * 1.0]), trimS, head);
  // Cheek guards.
  for (const sx of [-1, 1]) {
    const g = new THREE.CylinderGeometry(1, 1, hs.y * 0.34, 10, 1, true, sx > 0 ? Math.PI / 2 - 0.62 : Math.PI * 1.5 - 0.18, 0.8);
    gear.add(g, trs([domeC.x, brimY - hs.y * 0.16, domeC.z], [-0.12, 0, 0], [rx * 1.03, 1, rz * 1.03]), metal, head);
    gear.add(new THREE.SphereGeometry(hs.y * 0.025, 6, 4), trs([domeC.x + sx * rx * 0.96, brimY - hs.y * 0.08, domeC.z + rz * 0.3]), trimS, head);
  }
  // Rear neck guard (aventail): chain (Lv2+) / leather (Lv1).
  gear.add(
    new THREE.CylinderGeometry(1, 1.12, hs.y * 0.3, 16, 1, true, Math.PI * 0.62, Math.PI * 0.76),
    trs([domeC.x, brimY - hs.y * 0.15, domeC.z], [-0.12, 0, 0], [rx * 1.0, 1, rz * 1.0]),
    L === 1 ? { color: '#5A4030' } : { color: L === 2 ? '#9AA5B4' : '#3A2A5E', metal: 0.75, pattern: PATTERN.chain },
    head,
  );
  if (L >= 2) {
    // Nasal bar + ridge crest.
    gear.add(flat(new THREE.BoxGeometry(hs.x * 0.07, hs.y * 0.3, hs.z * 0.05)), trs([domeC.x, brimY - hs.y * 0.08, domeC.z + rz * 1.0], [-0.12, 0, 0]), metal, head);
    const ridge: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = lerp(-1.0, 1.25, i / 6);
      ridge.push(V(domeC.x, domeC.y + ry * Math.cos(a) * 1.02, domeC.z + rz * Math.sin(a) * 1.02));
    }
    gear.add(taperTube(ridge, () => hs.y * 0.035, 14, 6, 0.6), null, trimS, head);
  }
  if (L === 2) {
    // Short team horsehair crest.
    for (let k = 0; k < 7; k++) {
      const a = lerp(-0.7, 1.1, k / 6);
      const p = V(domeC.x, domeC.y + ry * Math.cos(a), domeC.z + rz * Math.sin(a));
      gear.add(blade(hs.y * 0.09, hs.y * 0.05, 5, 0.35), alongY(p, V(0, Math.cos(a), Math.sin(a) - 0.6).normalize(), [1, hs.y * 0.3, 1]), { color: k % 2 ? team : teamLight }, head);
    }
  }
  if (L === 3) {
    // Curved horns + glowing visor slit + arcane gem.
    for (const sx of [-1, 1]) {
      const b = V(domeC.x + sx * rx * 0.8, domeC.y + ry * 0.35, domeC.z + rz * 0.1);
      const pts = [b, b.clone().add(V(sx * hs.x * 0.22, hs.y * 0.12, -hs.z * 0.02)), b.clone().add(V(sx * hs.x * 0.32, hs.y * 0.42, -hs.z * 0.12)), b.clone().add(V(sx * hs.x * 0.26, hs.y * 0.62, -hs.z * 0.08))];
      gear.add(taperTube(pts, (t) => hs.y * 0.075 * (1 - 0.88 * t), 12, 8), null, { color: '#1A1426', metal: 0.8 }, head);
      gear.add(new THREE.SphereGeometry(hs.y * 0.03, 8, 6), trs(pts[3]), arcane, head);
    }
    gear.add(flat(new THREE.BoxGeometry(rx * 1.3, hs.y * 0.035, 0.04)), trs([domeC.x, brimY - hs.y * 0.03, domeC.z + rz * 1.02]), { color: '#E6CCFF', glow: 2.0 }, head);
    gear.add(new THREE.OctahedronGeometry(hs.y * 0.06), trs([domeC.x, brimY + hs.y * 0.12, domeC.z + rz * 1.03], [0, 0, 0], [1, 1.4, 0.6]), arcane, head);
  }

  // --- scarf: wrap around the neck + two sway tails.
  const ny = 1.27;
  const ns = body.sliceY(ny, 0.05, (t) => t === 0);
  const scarfCol: GearStyle = { color: team, glow: L === 3 ? 0.12 : 0 };
  gear.add(new THREE.TorusGeometry(1, 0.32, 8, 22).rotateX(Math.PI / 2), trs([ns.cx, ny, ns.cz], [0.1, 0, 0], [ns.rx * 0.8, 0.22, ns.rz * 0.85]), scarfCol, chest);
  const backZ = ns.cz - ns.rz * 0.8;
  const tailLen = L === 1 ? 0.45 : 0.62;
  for (const sx of [-1, 1]) {
    const a = ctx.addBone(sx > 0 ? 'fx_scarfL' : 'fx_scarfR', chest, V(sx * 0.1, ny - 0.02, backZ));
    ctx.secondary.push({ bone: a.name, axis: [1, 0, sx * 0.3], idleAmp: 0.08, idleFreq: 1.9, run: 0.75, phase: sx > 0 ? 0 : 1.3 });
    const skin: SkinFn = (p) => ({ a: chest, b: a, t: clamp01((ny - p.y) / 0.12) });
    gear.add(
      sheet(1, 6, (u, v, o) => o.set(sx * (0.06 + 0.06 * v) + (u - 0.5) * 0.13, ny - 0.02 - v * tailLen, backZ - 0.03 - v * 0.12 - 0.04 * Math.sin(v * 3)), 0.02),
      null,
      scarfCol,
      skin,
    );
  }

  // --- belt.
  const wy = 0.53;
  const w = body.sliceY(wy, 0.05, (t) => t === 0);
  gear.add(new THREE.CylinderGeometry(1, 1, 0.09, 26, 1, true), trs([w.cx, wy, w.cz], [0, 0, 0], [w.rx + 0.02, 1, w.rz + 0.02]), L === 1 ? { color: '#4E3524' } : L === 2 ? { color: '#2C3442' } : { color: '#1E1630' }, hips);
  gear.add(flat(new THREE.BoxGeometry(0.15, 0.13, 0.04)), trs([w.cx, wy, w.cz + w.rz + 0.03]), trimS, hips);
  gear.add(flat(new THREE.BoxGeometry(0.16, 0.16, 0.1)), trs([w.cx - w.rx * 0.75, wy - 0.07, w.cz - w.rz * 0.5], [0, -0.5, 0]), L === 1 ? { color: '#6A4A33' } : { color: '#3A3240' }, hips);

  // --- spear (right hand), pennant (Lv2+), arcane glaive head (Lv3).
  const hand = ctx.bone('handslotr');
  const hp = worldPos(scene, 'handslotr');
  const zTip = [0, 1.75, 2.0, 2.15][L];
  const zButt = -0.7;
  const shaftR = 0.032;
  const shaftLen = zTip - zButt;
  gear.add(
    new THREE.CylinderGeometry(shaftR, shaftR * 1.1, shaftLen, 8),
    trs([hp.x, hp.y, (zTip + zButt) / 2], [Math.PI / 2, 0, 0]),
    L === 1 ? { color: '#7A5232' } : L === 2 ? { color: '#2E2A30' } : { color: '#241A38', metal: 0.5 },
    hand,
  );
  for (const z of L === 1 ? [zTip - 0.05] : [zTip - 0.05, 0.35, -0.35, zButt + 0.04]) {
    gear.add(new THREE.CylinderGeometry(shaftR * 1.6, shaftR * 1.6, 0.06, 8), trs([hp.x, hp.y, z], [Math.PI / 2, 0, 0]), z === zTip - 0.05 ? trimS : metal, hand);
  }
  const bladeLen = [0, 0.38, 0.48, 0.7][L];
  const bladeW = [0, 0.13, 0.16, 0.26][L];
  gear.add(
    flat(blade(bladeW, bladeW * 0.28, 6, L === 3 ? 0.3 : 0.45)),
    trs([hp.x, hp.y, zTip - 0.02], [Math.PI / 2, 0, 0], [1, bladeLen, 1]),
    L === 1 ? { color: '#8A8F96', metal: 0.6 } : L === 2 ? { color: '#E4ECF6', metal: 1 } : { color: '#5E4A9A', metal: 1 },
    hand,
  );
  if (L >= 2) {
    // Engraved glow line along the blade.
    gear.add(new THREE.BoxGeometry(bladeW * 0.14, bladeW * 0.3, bladeLen * 0.55), trs([hp.x, hp.y, zTip + bladeLen * 0.32]), L === 3 ? arcane : { color: '#9FDCFF', glow: 1.2, pattern: PATTERN.rune }, hand);
  }
  if (L === 3) {
    // Side crescent + floating crystal.
    gear.add(flat(blade(0.12, 0.03, 5, 0.3)), trs([hp.x, hp.y - 0.12, zTip + 0.05], [Math.PI / 2 + 0.9, 0, 0], [1, 0.36, 1]), { color: '#5E4A9A', metal: 1 }, hand);
    gear.add(new THREE.OctahedronGeometry(0.07), trs([hp.x, hp.y, zTip - 0.2], [0, 0, 0], [1, 1, 1.8]), arcane, hand);
  }
  if (L >= 2) {
    const pz0 = zTip - 0.6;
    const pz1 = zTip - 0.12;
    const pb = ctx.addBone('fx_pennant', hand, V(hp.x, hp.y, (pz0 + pz1) / 2));
    ctx.secondary.push({ bone: 'fx_pennant', axis: [0, 0, 1], idleAmp: 0.18, idleFreq: 2.4, run: 0.3, phase: 0.5 });
    const pl = L === 3 ? 0.62 : 0.5;
    const at = (u: number, v: number, o: THREE.Vector3): void => {
      // u along the shaft, v away from it (tapering to a swallowtail point).
      const z = lerp(pz1, pz0, u);
      const reach = pl * (1 - 0.55 * Math.abs(u - 0.5) * 2 * (1 - v));
      o.set(hp.x + 0.03 * Math.sin(v * 4 + u * 2), hp.y - 0.04 - v * reach, z - v * 0.12);
    };
    gear.add(sheet(4, 4, at, 0.012), null, { color: team, glow: L === 3 ? 0.15 : 0 }, (p) => ({ a: hand, b: pb, t: clamp01((hp.y - 0.04 - p.y) / 0.15) }));
    gear.add(sheet(4, 1, (u, v, o) => at(u, 0.05 * v, o), 0.016), null, L === 3 ? arcane : trimS, hand);
  }

  // --- shield: embossed emblem, boss and rivets.
  const shieldName = L === 1 ? 'Barbarian_Round_Shield' : L === 2 ? 'Kite_Shield' : 'Tower_Shield';
  const sb = meshBox(scene, shieldName);
  if (!sb.isEmpty()) {
    const slot = ctx.bone('handslotl');
    const sc = sb.getCenter(new THREE.Vector3());
    const ss = sb.getSize(new THREE.Vector3());
    const face = sb.max.y + 0.004;
    const onFace = (x: number, z: number, lift: number, rot = 0, s: number | [number, number, number] = 1): THREE.Matrix4 =>
      trs([x, face + lift, z], [-Math.PI / 2, 0, rot], s);
    const R = Math.min(ss.x, ss.z) * 0.5;
    if (L === 1) {
      gear.add(new THREE.SphereGeometry(R * 0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), trs([sc.x, face - 0.01, sc.z]), { color: '#7D8088', metal: 0.7 }, slot);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        gear.add(new THREE.SphereGeometry(R * 0.06, 6, 4), trs([sc.x + Math.cos(a) * R * 0.78, face, sc.z + Math.sin(a) * R * 0.78]), { color: '#9A9DA4', metal: 0.8 }, slot);
      }
    } else {
      const em = L === 2 ? crossOutline(0.3) : starOutline(8, 0.42);
      gear.add(plate(em, 0.05, 0.015), onFace(sc.x, sc.z, 0.03, 0, R * (L === 3 ? 1.15 : 1.0)), L === 2 ? { color: team } : { color: '#2A1E46', metal: 0.8 }, slot);
      gear.add(plate(em, 0.04, 0.01), onFace(sc.x, sc.z, 0.07, 0, R * (L === 3 ? 0.78 : 0.62)), L === 2 ? { color: '#F0C24E', metal: 1, glow: 0.25 } : arcane, slot);
      // Rim studs.
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        gear.add(new THREE.SphereGeometry(R * 0.05, 6, 4), trs([sc.x + Math.cos(a) * ss.x * 0.42, face, sc.z + Math.sin(a) * ss.z * 0.44]), trimS, slot);
      }
      if (L === 3) {
        gear.add(new THREE.TorusGeometry(R * 0.82, R * 0.035, 4, 32), onFace(sc.x, sc.z, 0.04), { color: '#E0C36A', metal: 1, glow: 0.8 }, slot);
      }
    }
  }

  // --- spiked pauldrons (Lv3).
  if (L === 3) {
    for (const sx of [-1, 1]) {
      const arm = ctx.bone(sx > 0 ? 'upperarml' : 'upperarmr');
      const pb = meshBox(scene, sx > 0 ? 'Pauldron_L' : 'Pauldron_R');
      const pc = pb.getCenter(new THREE.Vector3());
      const ps = pb.getSize(new THREE.Vector3());
      for (let k = 0; k < 3; k++) {
        const p = V(pc.x + sx * ps.x * 0.1, pb.max.y - ps.y * 0.12, pc.z + (k - 1) * ps.z * 0.28);
        gear.add(flat(new THREE.ConeGeometry(ps.y * 0.08, ps.y * (k === 1 ? 0.55 : 0.38), 5)), alongY(p.clone().add(V(0, ps.y * 0.15, 0)), V(sx * 0.35, 1, (k - 1) * 0.3)), { color: '#1A1426', metal: 0.8 }, arm);
      }
      gear.add(new THREE.TorusGeometry(ps.z * 0.46, ps.y * 0.03, 4, 24).rotateY(Math.PI / 2), trs([pc.x + sx * ps.x * 0.38, pc.y - ps.y * 0.1, pc.z]), trimS, arm);
    }
  }
}

// ====================================================================== imp

/** Zigzag hem offset (0..1 of `depth`) for a tattered edge at parameter u. */
const ragged = (u: number, teeth: number): number => Math.abs(((u * teeth) % 1) * 2 - 1);

function imp(ctx: OutfitCtx): void {
  const { gear, level: L, scene, body } = ctx;
  const head = ctx.bone('head');
  const chest = ctx.bone('chest');
  const hips = ctx.bone('hips');
  const root = ctx.bone('root');
  const team = ctx.tint(L === 1 ? 'teamMuted' : 'team');
  const teamLight = ctx.tint('teamLight');
  const teamDark = ctx.tint(L === 1 ? 'teamMuted' : 'teamDark');
  // Skin matches the level palette (config.ts) so the skull cap blends with the face.
  const skin: GearStyle = L === 1 ? { color: '#8E1E3A' } : L === 2 ? { color: '#7A1238' } : { color: '#4A0C2E', pattern: PATTERN.lava };
  const horn: GearStyle = L === 3 ? { color: '#0A0610', metal: 0.8 } : { color: '#1A1020', metal: 0.55 };
  const boneS: GearStyle = { color: '#E6D9BE' };
  const violet: GearStyle = { color: L === 3 ? '#FF3DF0' : '#C85CFF', glow: L === 3 ? 2.2 : 1.5 };
  const flame: GearStyle = L === 3 ? { color: '#C020FF', glow: 0.45, pattern: PATTERN.flame } : { color: '#7A2BFF', glow: 0.3, pattern: PATTERN.flame };
  const iron: GearStyle = L === 3 ? { color: '#17101E', metal: 0.9 } : { color: '#2E2232', metal: 0.6 };
  const TORSO = (t: number): boolean => t === 0;

  // --- skull cap: the rogue head is a face shell (hair stripped in the asset); close it with an
  // ellipsoid that sits just behind the face surface and rises into a bald dome.
  const face = body.box((p, t) => t === 3 && Math.abs(p.x) < 0.42);
  const fc = face.getCenter(new THREE.Vector3());
  const fs = face.getSize(new THREE.Vector3());
  const rx = fs.x * 0.52;
  const ry = fs.y * 0.56;
  const rz = rx * 1.02;
  const sc = V(fc.x, fc.y + fs.y * 0.06, face.max.z - rz * 1.04);
  gear.add(new THREE.SphereGeometry(1, 24, 16), trs(sc, [0, 0, 0], [rx, ry, rz]), skin, head);
  const top = V(sc.x, sc.y + ry, sc.z);

  // --- horns.
  const hornOf = (base: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, curl: number, style: GearStyle): void => {
    const up = V(0, 1, 0);
    const d1 = dir.clone().normalize();
    const d2 = d1.clone().lerp(up, curl).normalize();
    const d3 = d2.clone().lerp(V(0, 0.4, -1).normalize(), curl * 0.6).normalize();
    const pts = [base, base.clone().addScaledVector(d1, len * 0.35), base.clone().addScaledVector(d1, len * 0.35).addScaledVector(d2, len * 0.35), base.clone().addScaledVector(d1, len * 0.35).addScaledVector(d2, len * 0.35).addScaledVector(d3, len * 0.3)];
    gear.add(taperTube(pts, (t) => r * (1 - 0.9 * t * t), 10, 7), null, style, head);
  };
  const hornLen = [0, fs.y * 0.3, fs.y * 0.55, fs.y * 0.75][L];
  for (const sx of [-1, 1]) {
    const base = V(sc.x + sx * rx * 0.62, sc.y + ry * 0.62, sc.z + rz * 0.1);
    hornOf(base, V(sx * 0.7, 0.75, -0.15), hornLen, fs.y * (L === 1 ? 0.07 : 0.085), L === 1 ? 0.25 : L === 2 ? 0.6 : 0.75, horn);
    if (L === 3) gear.add(new THREE.OctahedronGeometry(fs.y * 0.035), trs(base.clone().add(V(sx * 0.3 * hornLen, 0.9 * hornLen, -0.25 * hornLen))), violet, head);
  }
  if (L === 3) {
    // Jagged crown of smaller horns around the dome.
    for (let i = 0; i < 7; i++) {
      const a = -1.1 + (i / 6) * 2.2;
      const base = V(sc.x + Math.sin(a) * rx * 0.72, sc.y + ry * 0.74, sc.z + Math.cos(a) * rz * 0.72 - rz * 0.05);
      const len = fs.y * (0.22 + 0.16 * Math.cos(a * 1.6));
      hornOf(base, V(Math.sin(a) * 0.45, 1, Math.cos(a) * 0.3 - 0.1), len, fs.y * 0.05, 0.3, horn);
    }
    // Floating glowing ring behind the horns.
    gear.add(new THREE.TorusGeometry(rx * 0.9, fs.y * 0.02, 6, 36), trs([top.x, top.y + fs.y * 0.12, top.z - rz * 0.25], [Math.PI / 2 - 0.3, 0, 0]), { color: '#FF7AF5', glow: 2.0, metal: 1 }, head);
  }

  // --- manic grin: wide white tooth band with upturned corners, dark mouth behind, fangs.
  const my = face.min.y + fs.y * 0.3;
  const mouth = body.sliceY(my, fs.y * 0.05, (t) => t === 3);
  const front = mouth.cz + mouth.rz;
  const gw = fs.x * 0.36;
  const arc: THREE.Vector3[] = [];
  const arcBack: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = -1 + (i / 8) * 2;
    const x = fc.x + a * gw;
    const y = my + fs.y * 0.08 * a * a;
    const z = front - gw * (1 - Math.cos(a * 0.95)) * 0.5;
    arc.push(V(x, y, z + 0.012));
    arcBack.push(V(x, y, z - 0.006));
  }
  gear.add(taperTube(arcBack, (t) => fs.y * 0.045 * (0.6 + 0.4 * Math.sin(t * Math.PI)), 12, 5, 0.6), null, { color: '#160410' }, head);
  gear.add(taperTube(arc, (t) => fs.y * 0.026 * (0.5 + 0.5 * Math.sin(t * Math.PI)), 12, 5, 0.5), null, { color: '#F6EEDC', glow: 0.08 }, head);
  for (const a of [-0.62, -0.2, 0.2, 0.62]) {
    const x = fc.x + a * gw;
    const z = front - gw * (1 - Math.cos(a * 0.95)) * 0.5 + 0.02;
    gear.add(flat(new THREE.ConeGeometry(fs.y * 0.016, fs.y * 0.06, 4)), trs([x, my + fs.y * 0.08 * a * a - fs.y * 0.035, z], [Math.PI, 0, 0]), boneS, head);
  }

  // --- manic eyes: glowing almond overlays on the rogue eyes + angry V brows.
  for (const sx of [-1, 1]) {
    const eb = body.box((p, t) => t === 5 && Math.sign(p.x) === sx);
    if (eb.isEmpty()) continue;
    const ec = eb.getCenter(new THREE.Vector3());
    const es = eb.getSize(new THREE.Vector3());
    const ew = Math.max(es.x, fs.x * 0.07);
    gear.add(blade(ew * 1.25, 0.02, 6, 0.5), alongY(V(ec.x - sx * ew * 0.3, ec.y - ew * 0.5, eb.max.z + 0.012), V(sx * 0.5, 1, 0.25), [1, ew * 1.05, 1]), { color: L === 3 ? '#C8FF4A' : '#9CFF3A', glow: L === 3 ? 2.8 : 2.0 }, head);
    gear.add(flat(new THREE.BoxGeometry(ew * 1.6, ew * 0.32, 0.03)), trs([ec.x + sx * ew * 0.1, ec.y + ew * 0.85, eb.max.z + 0.01], [0.1, 0, sx * -0.55]), { color: '#160410' }, head);
  }

  // --- bone mask pushed up on the forehead (Lv2): skull-shaped plate, dark sockets, teeth.
  if (L === 2) {
    const mc = V(sc.x, sc.y + ry * 0.7, sc.z + rz * 0.66);
    const M = trs(mc, [-0.85, 0, 0], fs.y * 0.5);
    const outline: [number, number][] = [[-0.48, 0.1], [-0.42, 0.42], [-0.2, 0.6], [0.2, 0.6], [0.42, 0.42], [0.48, 0.1], [0.34, -0.2], [0.3, -0.55], [-0.3, -0.55], [-0.34, -0.2]];
    gear.add(plate(outline, 0.1, 0.03), M, boneS, head);
    for (const sx of [-1, 1]) {
      gear.add(new THREE.SphereGeometry(0.15, 10, 8), M.clone().multiply(trs([sx * 0.22, 0.08, 0.06], [0, 0, 0], [1, 1.15, 0.5])), { color: '#120816' }, head);
      gear.add(new THREE.OctahedronGeometry(0.05), M.clone().multiply(trs([sx * 0.22, 0.08, 0.1])), violet, head);
    }
    gear.add(flat(new THREE.ConeGeometry(0.07, 0.16, 4)), M.clone().multiply(trs([0, -0.18, 0.06], [Math.PI, 0, 0])), { color: '#120816' }, head);
    for (let i = 0; i < 5; i++) {
      gear.add(flat(new THREE.BoxGeometry(0.07, 0.14, 0.06)), M.clone().multiply(trs([(i - 2) * 0.11, -0.48, 0.04])), { color: '#120816' }, head);
    }
  }

  // --- tail: two sway bones from the hips, spade tip + flame.
  const hipY = worldPos(scene, 'hips').y;
  const hs = body.sliceY(hipY, 0.06, TORSO);
  const tailRoot = V(hs.cx, hipY - 0.02, hs.cz - hs.rz + 0.02);
  const tailA = ctx.addBone('fx_tailA', hips, tailRoot);
  const tailLen = [0, 0.85, 0.95, 1.1][L];
  const tp = [tailRoot, tailRoot.clone().add(V(0.08, -0.22, -tailLen * 0.3)), tailRoot.clone().add(V(0.2, -0.12, -tailLen * 0.62)), tailRoot.clone().add(V(0.14, 0.26, -tailLen * 0.78))];
  const tailB = ctx.addBone('fx_tailB', tailA, tp[2]);
  ctx.secondary.push(
    { bone: 'fx_tailA', axis: [0, 1, 0], idleAmp: 0.22, idleFreq: 1.35, run: 0.2, phase: 0 },
    { bone: 'fx_tailB', axis: [0, 1, 0], idleAmp: 0.38, idleFreq: 1.35, run: 0.25, phase: 1.1 },
  );
  const curve = new THREE.CatmullRomCurve3(tp);
  const tailSkin: SkinFn = (p) => {
    const t = clamp01((tailRoot.z - p.z) / (tailLen * 0.78));
    if (t < 0.45) return { a: hips, b: tailA, t: clamp01(t / 0.3) };
    return { a: tailA, b: tailB, t: clamp01((t - 0.45) / 0.3) };
  };
  gear.add(taperTube(tp, (t) => 0.06 * (1 - 0.65 * t), 16, 7), null, skin, tailSkin);
  const tipP = new THREE.Vector3();
  const tipD = new THREE.Vector3();
  curve.getPointAt(1, tipP);
  curve.getTangentAt(1, tipD);
  gear.add(blade(0.2, 0.05, 6, 0.4), alongY(tipP.clone().addScaledVector(tipD, -0.04), tipD, [1, 0.26, 1]), horn, tailB);
  const fl = [0, 0.36, 0.48, 0.66][L];
  gear.add(blade(0.16 * fl / 0.3, 0.09, 6, 0.3), alongY(tipP.clone().addScaledVector(tipD, 0.02), tipD.clone().lerp(V(0, 1, 0), 0.5).normalize(), [1, fl, 1]), flame, tailB);
  gear.add(blade(0.08, 0.06, 5, 0.35), alongY(tipP.clone().addScaledVector(tipD, 0.04), tipD.clone().lerp(V(0, 1, 0), 0.6).normalize(), [1, fl * 0.55, 1]), { color: L === 3 ? '#FFB0FA' : '#E0B0FF', glow: 1.2 }, tailB);

  // --- waist: rope belt (Lv1) / studded belt (Lv2+) and the rag loincloth / jester coat.
  const wy = 0.56;
  const w = body.sliceY(wy, 0.05, TORSO);
  if (L === 1) {
    gear.add(new THREE.TorusGeometry(1, 0.03, 6, 26).rotateX(Math.PI / 2), trs([w.cx, wy, w.cz], [0, 0, 0], [w.rx + 0.03, 1, w.rz + 0.03]), { color: '#8A7A58' }, hips);
    gear.add(new THREE.SphereGeometry(0.045, 8, 6), trs([w.cx + w.rx * 0.55, wy - 0.01, w.cz + w.rz * 0.78]), { color: '#8A7A58' }, hips);
  } else {
    gear.add(new THREE.CylinderGeometry(1, 1, 0.085, 26, 1, true), trs([w.cx, wy, w.cz], [0, 0, 0], [w.rx + 0.025, 1, w.rz + 0.025]), { color: '#1C1020' }, hips);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      gear.add(new THREE.OctahedronGeometry(0.028), trs([w.cx + Math.sin(a) * (w.rx + 0.03), wy, w.cz + Math.cos(a) * (w.rz + 0.03)]), k === 0 ? violet : iron, hips);
    }
  }
  const yT = wy - 0.02;
  const yB = L === 1 ? 0.22 : L === 2 ? 0.12 : 0.18;
  const panels = L === 1 ? 2 : 4;
  for (let k = 0; k < panels; k++) {
    const a0 = L === 1 ? (k === 0 ? -0.8 : Math.PI - 0.8) : -Math.PI / 4 + (k * Math.PI) / 2 - 0.15;
    const a1 = a0 + (L === 1 ? 1.6 : Math.PI / 2 - 0.2);
    const side = Math.sin((a0 + a1) / 2) >= 0 ? 'upperlegl' : 'upperlegr';
    const leg = ctx.bone(side);
    const pskin: SkinFn = (p) => ({ a: hips, b: leg, t: 0.7 * clamp01((yT - p.y) / (yT - yB)) });
    const col = L === 1 ? { color: '#4E3E42' } : k % 2 === 0 ? { color: team, glow: L === 3 ? 0.15 : 0 } : { color: L === 3 ? '#1A0A26' : '#2A1038' };
    const at = (u: number, v: number, o: THREE.Vector3): void => {
      const a = lerp(a0, a1, u);
      const y = lerp(yT, yB, v);
      const s = body.sliceY(Math.max(y, 0.3), 0.07, (t) => t === 0 || t === 2);
      const r = Math.max(s.rx, w.rx * 0.9) + 0.03 + 0.05 * v;
      const hem = L === 1 ? 0.09 * ragged(u, 3) : 0.14 * ragged(u + k * 0.5, 2);
      o.set(s.cx + Math.sin(a) * r, y + hem * v * v, s.cz + Math.cos(a) * r * (Math.cos(a) > 0 ? 1 : 0.95));
    };
    gear.add(sheet(6, 5, at, 0.014), null, col, pskin);
  }

  // --- Lv2 jester coat details: pointed shoulder flaps + chain with skull trinkets.
  if (L >= 2) {
    const sh = body.sliceY(1.12, 0.06, TORSO);
    for (const sx of [-1, 1]) {
      const arm = ctx.bone(sx > 0 ? 'upperarml' : 'upperarmr');
      for (let k = 0; k < 3; k++) {
        const p = V(sx * (sh.rx * 0.78 + 0.03), 1.2, sh.cz + (k - 1) * 0.12);
        gear.add(blade(0.16, 0.025, 5, 0.45), alongY(p, V(sx * 0.8, 0.45, (k - 1) * 0.35), [1, 0.26 + (k === 1 ? 0.08 : 0), 1]), k % 2 === 0 ? { color: team } : { color: L === 3 ? '#1A0A26' : '#2A1038' }, arm);
        gear.add(new THREE.SphereGeometry(0.026, 6, 4), trs(p.clone().add(V(sx * 0.23, 0.12, (k - 1) * 0.095))), L === 3 ? violet : { color: '#E0B64A', metal: 1, glow: 0.2 }, arm);
      }
    }
    const cy = 1.02;
    const cs = body.sliceY(cy, 0.05, TORSO);
    gear.add(new THREE.TorusGeometry(1, 0.022, 5, 30).rotateX(Math.PI / 2), trs([cs.cx, cy, cs.cz], [-0.35, 0, 0], [cs.rx + 0.03, 1, cs.rz + 0.03]), iron, chest);
    for (const a of [-0.5, 0, 0.5]) {
      const p = V(cs.cx + Math.sin(a) * (cs.rx + 0.03), cy - 0.08 - (a === 0 ? 0.05 : 0), cs.cz + Math.cos(a) * (cs.rz + 0.04));
      gear.add(new THREE.SphereGeometry(0.05, 10, 8), trs(p, [0, 0, 0], [1, 1.15, 0.9]), boneS, chest);
      for (const sx of [-1, 1]) gear.add(new THREE.SphereGeometry(0.014, 5, 4), trs(p.clone().add(V(sx * 0.02, 0.005, 0.045))), L === 3 ? violet : { color: '#120816' }, chest);
    }
  }

  // --- weapons: crooked trident (Lv1) / glTF knives with glowing edges (Lv2+).
  if (L === 1) {
    const hand = ctx.bone('handslotr');
    const hp = worldPos(scene, 'handslotr');
    const shaft = [V(hp.x, hp.y, -0.75), V(hp.x + 0.04, hp.y - 0.02, 0.2), V(hp.x - 0.03, hp.y + 0.03, 0.9), V(hp.x, hp.y, 1.45)];
    gear.add(taperTube(shaft, () => 0.03, 12, 7), null, { color: '#3A2430' }, hand);
    gear.add(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 8), trs([hp.x, hp.y, 1.42], [Math.PI / 2, 0, 0]), iron, hand);
    for (const dx of [-1, 0, 1]) {
      const b = V(hp.x + dx * 0.08, hp.y, 1.44);
      const pts = dx === 0 ? [b, b.clone().add(V(0, 0, 0.32)), b.clone().add(V(0, 0, 0.5))] : [b, b.clone().add(V(dx * 0.06, 0, 0.14)), b.clone().add(V(dx * 0.05, 0.02, 0.4))];
      gear.add(taperTube(pts, (t) => 0.028 * (1 - 0.85 * t), 8, 6), null, iron, hand);
    }
    gear.add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8), trs([hp.x, hp.y, 1.3], [Math.PI / 2, 0, 0]), { color: '#8A7A58' }, hand);
  } else {
    engrave(ctx, 'Knife', 'handslotr', { ...violet, pattern: PATTERN.rune });
    engrave(ctx, 'Knife_Offhand', 'handslotl', { ...violet, pattern: PATTERN.rune });
  }

  // --- flame cape (Lv3): two sway bones, jagged hem, flame pattern.
  if (L === 3) {
    const ct = body.sliceY(1.18, 0.06, TORSO);
    const yTop = 1.22;
    const zTop = ct.cz - ct.rz - 0.01;
    const yBot = 0.1;
    const len = yTop - yBot;
    const capeA = ctx.addBone('fx_capeA', chest, V(0, yTop, zTop));
    const capeB = ctx.addBone('fx_capeB', capeA, V(0, yTop - len * 0.5, zTop - 0.1));
    ctx.secondary.push(
      { bone: 'fx_capeA', axis: [1, 0, 0], idleAmp: 0.05, idleFreq: 1.9, run: 0.6, phase: 0 },
      { bone: 'fx_capeB', axis: [1, 0, 0], idleAmp: 0.09, idleFreq: 1.9, run: 0.32, phase: 0.9 },
    );
    const capeSkin: SkinFn = (p) => {
      const s = clamp01((yTop - p.y) / len);
      if (s < 0.18) return { a: chest, b: capeA, t: s / 0.18 };
      return { a: capeA, b: capeB, t: clamp01((s - 0.3) / 0.45) };
    };
    const wTop = ct.rx * 1.0;
    const wBot = ct.rx * 1.7;
    const capeAt = (u: number, v: number, o: THREE.Vector3): void => {
      const x = (u * 2 - 1) * lerp(wTop, wBot, v);
      const bulge = 0.12 * (1 - (u * 2 - 1) ** 2);
      const hem = 0.22 * ragged(u, 4) * v * v;
      o.set(x, yTop - v * len + hem, zTop - 0.02 - bulge * (0.4 + 0.6 * v) - v * 0.16);
    };
    gear.add(sheet(12, 9, capeAt, 0.016), null, flame, capeSkin);
    gear.add(sheet(12, 3, (u, v, o) => capeAt(0.15 + u * 0.7, 0.3 + v * 0.55, o.set(0, 0, 0)), 0.02), null, { color: '#FF3DF0', glow: 0.9, pattern: PATTERN.flame }, capeSkin);
    for (const sx of [-1, 1]) {
      gear.add(new THREE.OctahedronGeometry(0.06), trs([sx * wTop * 0.85, yTop - 0.02, zTop + 0.02]), violet, chest);
    }
  }

  // --- Lv3 orbit: stolen-weapon shards and wisps circling the imp (spinning bone under the root).
  if (L === 3) {
    const orbit = ctx.addBone('fx_orbit', root, V(0, 1.05, 0));
    ctx.secondary.push({ bone: 'fx_orbit', axis: [0, 1, 0], idleAmp: 0.0, idleFreq: 1, run: 0, phase: 0, spin: 1.1 });
    const obsidian: GearStyle = { color: '#120A1A', metal: 0.9 };
    const R = 0.95;
    const shard = (a: number, y: number, kind: number): void => {
      const p = V(Math.sin(a) * R, y, Math.cos(a) * R);
      const tangent = V(Math.cos(a), 0, -Math.sin(a));
      const up = V(0, 1, 0).lerp(tangent, 0.35).normalize();
      if (kind === 0) {
        // Sword: blade + guard + glowing fuller.
        gear.add(blade(0.16, 0.035, 6, 0.75), alongY(p, up, [1, 0.72, 1]), obsidian, orbit);
        gear.add(new THREE.BoxGeometry(0.03, 0.03, 0.24), alongY(p.clone().addScaledVector(up, -0.02), up), violet, orbit);
        gear.add(new THREE.BoxGeometry(0.035, 0.5, 0.012), alongY(p.clone().addScaledVector(up, 0.3), up), violet, orbit);
      } else if (kind === 1) {
        // Axe: haft + crescent head.
        gear.add(new THREE.CylinderGeometry(0.02, 0.025, 0.66, 6), alongY(p.clone().addScaledVector(up, 0.33), up), obsidian, orbit);
        const m = alongY(p.clone().addScaledVector(up, 0.5), up).multiply(trs([0.12, 0, 0], [0, Math.PI / 2, 0]));
        gear.add(plate([[-0.5, 0.5], [0.5, 0.35], [0.3, 0], [0.5, -0.35], [-0.5, -0.5], [-0.3, 0]], 0.03, 0.01), m.clone().multiply(trs([0, 0, 0], [0, 0, 0], 0.34)), obsidian, orbit);
        gear.add(plate([[0.5, 0.35], [0.3, 0], [0.5, -0.35], [0.4, -0.3], [0.25, 0], [0.4, 0.3]], 0.045, 0.005), m.multiply(trs([0, 0, 0], [0, 0, 0], 0.34)), violet, orbit);
      } else {
        // Curved dagger.
        gear.add(blade(0.1, 0.03, 6, 0.6), alongY(p, up.clone().lerp(tangent, 0.3).normalize(), [1, 0.42, 1]), obsidian, orbit);
        gear.add(blade(0.045, 0.034, 6, 0.6), alongY(p, up.clone().lerp(tangent, 0.3).normalize(), [1, 0.4, 1]), violet, orbit);
      }
    };
    shard(0, 0.0, 0);
    shard((Math.PI * 2) / 3, 0.18, 1);
    shard((Math.PI * 4) / 3, -0.12, 2);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
      gear.add(new THREE.OctahedronGeometry(0.055), trs([Math.sin(a) * R * 1.08, 0.3 - i * 0.22, Math.cos(a) * R * 1.08], [0, a, 0], [1, 1.6, 1]), { color: '#FFB0FA', glow: 2.4 }, orbit);
    }
  }
  void teamLight;
  void teamDark;
}
