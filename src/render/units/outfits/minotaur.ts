/**
 * Marki, minotaur bruiser (hero body bulked by bone scales, human head replaced by a sculpted bull
 * head rigid to the Head bone, feet turned into hooves).
 *  Lv1  brown hide, leather X-harness + belt + hide kilt, wrapped fists, iron nose ring, ivory horns.
 *  Lv2  blood-red hide, iron shoulder plates with rivets, iron horn caps, chain across the chest,
 *       studded belt, iron bracers + spiked knuckles (embers from config).
 *  Lv3  obsidian hide with molten cracks, burning horns and mane, spiked black plate with glowing
 *       seams, molten fists (fire aura, rune disc and light pillar from config).
 */
import * as THREE from 'three';
import type { VInfo } from '../body';
import { alongY, blade, flat, plate, taperTube, trs } from '../gear';
import { RE, V, is, lerp, type OutfitCtx } from '../kit';
import type { Style } from '../style';
import { P, anatomy, armor, belt, horn, slice, st } from './common';
import type { OutfitResult } from './index';

/** Mean linear colour of the hero skin texture (to match flat fur to the textured body). */
const SKIN_AVG = new THREE.Color(0.58, 0.32, 0.19);

function furHex(tint: string): string {
  return '#' + new THREE.Color(tint).multiply(SKIN_AVG).multiplyScalar(1.35).getHexString();
}

export function minotaur(ctx: OutfitCtx): OutfitResult {
  const L = ctx.level;
  const A = anatomy(ctx);
  const body = ctx.srcMesh('Body');
  const boneOfV = (i: number): string => ctx.src.bones[body.dom[i]];

  const tint = L === 1 ? '#B07650' : L === 2 ? '#9A3A2A' : '#4A3C3E';
  const hide: Style = { color: tint, tex: 1, pattern: L === 3 ? P.lava : 0 };
  const fur = st(furHex(tint), { pattern: L === 3 ? P.lava : 0 });
  const furDark = st(furHex(L === 1 ? '#6A4430' : L === 2 ? '#5A1E18' : '#241C1E'));
  const leather = L === 3 ? st('#1E1618') : st(L === 1 ? '#4A3020' : '#2E1A14');
  const iron: Style = L === 1 ? st('#6A6460', { metal: 0.5 }) : L === 2 ? st('#5E6670', { metal: 0.85 }) : st('#2A2628', { metal: 0.9 });
  const ember: Style = st('#FF7A1E', { glow: 2.2 });
  const seam: Style = L === 3 ? st('#FF8A2A', { glow: 1.8 }) : L === 2 ? st('#B88A3A', { metal: 0.9 }) : st('#5A4A3A', { metal: 0.4 });
  const hoof = st('#231C19', { metal: 0.15 });

  // --- body: hide everywhere, head replaced, feet -> hooves.
  const sx0 = (i: number): number => (body.pos[i * 3] > 0 ? 1 : -1);
  ctx.use('Body', (i) => {
    const b = boneOfV(i);
    // War paint on the shoulders / upper arms (team colour, reads from above).
    if (is(b, RE.clav, RE.upperarm, RE.chest) && body.pos[i * 3 + 1] > A.chest.max.y - 0.13) {
      const x = body.pos[i * 3] * sx0(i);
      const band = Math.sin(x * 70 + body.pos[i * 3 + 2] * 20);
      if (x > 0.12 && x < 0.3 && band > 0.35) return st('team', { pattern: L === 3 ? P.lava : 0, shade: 0.9 });
    }
    return hide;
  });
  ctx.hide('Body', ctx.tris('Body', (v) => v.bone === 'Head' || is(v.bone, RE.foot), 1));
  for (const side of ['l', 'r'] as const) {
    const ank = ctx.at(`foot_${side}`);
    const ball = ctx.at(`ball_${side}`);
    const fb = ctx.bone(`foot_${side}`);
    const mid = ank.clone().lerp(ball, 0.55);
    const hoofG = new THREE.CylinderGeometry(0.06, 0.078, 0.1, 14);
    ctx.gear.add(hoofG, trs([mid.x, 0.05, mid.z], [0, 0, 0], [1, 1, 1.45]), hoof, fb);
    ctx.gear.add(flat(new THREE.BoxGeometry(0.008, 0.07, 0.07)), trs([mid.x, 0.04, mid.z + 0.09]), st('#0A0606'), fb);
    ctx.gear.add(new THREE.SphereGeometry(1, 12, 8), trs([ank.x, 0.12, ank.z + 0.02], [0, 0, 0], [0.07, 0.07, 0.09]), furDark, fb);
  }

  bullHead(ctx, L, fur, furDark);

  // --- kilt / loincloth (hide flaps) + belt
  const waistY = A.waist - 0.06;
  const bs = belt(ctx, waistY, { style: leather, buckle: L === 1 ? st('#8A7A5A', { metal: 0.5 }) : seam, out: 0.03, width: 0.06 });
  const flapStyle = L === 3 ? st('#1A1416') : L === 2 ? st('#4A1E16') : st('#6A4A32');
  for (let k = 0; k < 7; k++) {
    const a = lerp(-1.25, 1.25, k / 6);
    const front = Math.abs(a) < 0.5;
    const x = bs.cx + Math.sin(a) * (bs.rx + 0.035);
    const z = bs.cz + Math.cos(a) * (bs.rz + 0.035);
    const len = front ? 0.3 : 0.22;
    const g = plate([[-0.055, 0], [0.055, 0], [0.05, -len * 0.85], [0, -len], [-0.05, -len * 0.85]], 0.01, 0.003);
    const side = x > 0 ? 'l' : 'r';
    ctx.gear.add(g, trs([x, waistY - 0.02, z], [-0.12, a, 0]), k === 3 ? st('team') : flapStyle, Math.abs(x) < 0.04 ? ctx.bone('pelvis') : ctx.bone(`thigh_${side}`));
    // back flaps mirrored
    const zb = bs.cz - Math.cos(a) * (bs.rz + 0.035);
    ctx.gear.add(plate([[-0.06, 0], [0.06, 0], [0.05, -0.26], [-0.05, -0.26]], 0.01, 0.003), trs([x, waistY - 0.02, zb], [0.12, -a, 0]), flapStyle, Math.abs(x) < 0.04 ? ctx.bone('pelvis') : ctx.bone(`thigh_${side}`));
  }
  if (L >= 2) {
    // Studs on the belt.
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      ctx.gear.add(new THREE.ConeGeometry(0.012, 0.022, 5), alongY(V(bs.cx + Math.sin(a) * (bs.rx + 0.034), waistY, bs.cz + Math.cos(a) * (bs.rz + 0.034)), V(Math.sin(a), 0, Math.cos(a))), iron, ctx.bone('pelvis'));
    }
  }

  // --- chest: X harness (Lv1), harness + chain (Lv2), spiked plate (Lv3)
  const torso = (v: VInfo): boolean => is(v.bone, RE.spine, RE.clav) && v.p.y > A.waist;
  const strap = (sx: number, w: number) => (v: VInfo): boolean => {
    if (!torso(v)) return false;
    const top = A.chest.max.y - 0.02;
    const xs = lerp(sx * 0.16, -sx * 0.13, (top - v.p.y) / (top - A.waist));
    return Math.abs(v.p.x - xs) < w;
  };
  if (L <= 2) {
    const sash = st('team', { shade: L === 1 ? 0.8 : 1 });
    armor(ctx, strap(1, 0.04), { offset: 0.013, smooth: 3, style: sash, rim: { radius: 0.007, style: leather }, keep: true });
    if (L === 1) armor(ctx, strap(-1, 0.03), { offset: 0.01, smooth: 3, style: leather, rim: { radius: 0.006, style: seam }, keep: true });
    // Ring where the straps meet (front).
    const c = slice(ctx, lerp(A.chest.max.y, A.waist, 0.45), 0.02, torso);
    ctx.gear.add(new THREE.TorusGeometry(0.03, 0.008, 6, 16), trs([0, lerp(A.chest.max.y, A.waist, 0.45), c.front + 0.016]), iron, ctx.bone('spine_02'));
  }
  if (L === 2) chain(ctx, A, iron);
  if (L >= 2) {
    // Shoulder plates (Lv2 iron with rivets, Lv3 black with spikes and glowing seams).
    for (const side of ['l', 'r'] as const) {
      const sx = side === 'l' ? 1 : -1;
      const sh = ctx.src.bonePos(`upperarm_${side}`);
      armor(ctx, (v) => is(v.bone, RE.clav, RE.upperarm) && v.p.x * sx > 0.1 && v.p.x * sx < 0.33 && v.p.y > sh.y - 0.015, {
        offset: 0.032,
        smooth: 12,
        style: { ...iron, pattern: L === 2 ? P.lames : P.lava },
        rim: { radius: 0.013, style: seam },
        inflate: { center: sh, scale: [1.06, 1.05, 1.06] },
      });
      const tw = ctx.at(`upperarm_${side}`);
      const bone = ctx.bone(`clavicle_${side}`);
      ctx.gear.add(new THREE.SphereGeometry(0.055, 12, 6, 0, Math.PI * 2, 0, 0.9), trs(tw.clone().add(V(sx * 0.02, 0.11, 0.0)), [0, 0, -sx * 0.4], [1.1, 0.45, 1]), st('team', { glow: L === 3 ? 0.35 : 0.05, metal: 0.4 }), bone);
      if (L === 2) {
        for (let k = 0; k < 4; k++) ctx.gear.add(new THREE.SphereGeometry(0.012, 6, 4), trs(tw.clone().add(V(sx * (0.0 + k * 0.035), 0.1 - k * 0.012, 0.05))), seam, bone);
      } else {
        for (let k = 0; k < 3; k++) {
          const base = tw.clone().add(V(sx * (0.0 + k * 0.05), 0.11 - k * 0.015, -0.01));
          ctx.gear.add(flat(new THREE.ConeGeometry(0.026, 0.15 - k * 0.025, 5)), alongY(base, V(sx * (0.35 + k * 0.25), 1, -0.15)), iron, bone);
        }
      }
    }
  }
  if (L === 3) {
    // Spiked chest plate with molten seams.
    armor(ctx, (v) => is(v.bone, RE.chest) && Math.abs(v.p.x) < 0.17 && v.p.y > A.chest.min.y + 0.1, {
      offset: 0.035,
      smooth: 14,
      style: { ...iron, pattern: P.lava },
      rim: { radius: 0.013, style: seam },
      keep: true,
    });
  }

  // --- arms: wraps / bracers, fists
  armor(ctx, (v) => is(v.bone, RE.lowerarm) && Math.abs(v.p.x) > Math.abs(ctx.src.bonePos('lowerarm_l').x) + 0.1, {
    offset: L === 1 ? 0.012 : 0.02,
    smooth: 8,
    style: L === 1 ? leather : iron,
    rim: { radius: 0.008, style: seam },
  });
  armor(ctx, (v) => is(v.bone, RE.hand), { offset: 0.008, smooth: 1, style: L === 1 ? st('#6A4A32') : L === 2 ? iron : { ...iron, pattern: P.lava }, need: 2 });
  if (L >= 2) {
    for (const side of ['l', 'r'] as const) {
      const sx = side === 'l' ? 1 : -1;
      const hb = ctx.bone(`hand_${side}`);
      for (const f of ['index', 'middle', 'ring', 'pinky']) {
        const k = ctx.at(`${f}_01_${side}`);
        ctx.gear.add(flat(new THREE.ConeGeometry(0.012, 0.045, 5)), alongY(k.clone().add(V(sx * 0.015, 0.02, 0)), V(sx * 0.4, 1, 0)), L === 3 ? ember : iron, hb);
      }
    }
  }

  return {};
}

/** Chain across the chest (Lv2): torus links along a diagonal. */
function chain(ctx: OutfitCtx, A: ReturnType<typeof anatomy>, iron: Style): void {
  const top = A.chest.max.y - 0.03;
  const n = 12;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const y = lerp(top, A.waist + 0.02, t);
    const x = lerp(-0.17, 0.14, t);
    const s = slice(ctx, y, 0.02, (v) => is(v.bone, RE.spine, RE.clav));
    const g = new THREE.TorusGeometry(0.017, 0.005, 5, 10);
    ctx.gear.add(g, trs([x, y, s.front + 0.02], [0, k % 2 ? Math.PI / 2 : 0, -0.85]), iron, ctx.bone(y > ctx.src.bonePos('spine_03').y ? 'spine_03' : 'spine_02'));
  }
}

/** Sculpted bull head rigid to the Head bone (built from blended primitives). */
function bullHead(ctx: OutfitCtx, L: number, fur: Style, furDark: Style): void {
  const H = ctx.at('Head');
  const head = ctx.bone('Head');
  const g = ctx.gear;
  const K = 1.12;
  const at = (x: number, y: number, z: number): THREE.Vector3 => H.clone().add(V(x * K, y * K, z * K));
  const nose = st(L === 3 ? '#140E0E' : '#2A1C18');
  const eyeCol = L === 1 ? '#FFB040' : L === 2 ? '#FF3A1A' : '#FFE04A';
  const hornStyle: Style | ((t: number) => Style) =
    L === 1 ? st('#E6D6B2') : L === 2 ? (t) => (t > 0.7 ? st('#8A929C', { metal: 0.9 }) : st('#D8C8A6')) : (t) => (t > 0.6 ? st('#FF9A2A', { glow: 2.2, pattern: P.flame }) : st('#1A1416', { metal: 0.6, pattern: P.lava }));

  // Cranium + cheeks.
  g.add(new THREE.SphereGeometry(1, 18, 14), trs(at(0, 0.115, -0.005), [0, 0, 0], [0.12, 0.115, 0.125]), fur, head);
  g.add(new THREE.SphereGeometry(1, 14, 10), trs(at(0, 0.075, 0.05), [0.3, 0, 0], [0.105, 0.085, 0.1]), fur, head);
  // Muzzle (forward + down) and nose pad.
  const mStart = at(0, 0.1, 0.07);
  const mDir = V(0, -0.85, 1).normalize();
  const muz = new THREE.CapsuleGeometry(0.075, 0.05, 6, 14);
  g.add(muz, alongY(mStart.clone().addScaledVector(mDir, 0.05), mDir, [1.3, 1, 0.95]), fur, head);
  const tip = mStart.clone().addScaledVector(mDir, 0.12);
  g.add(new THREE.SphereGeometry(1, 14, 10), trs(tip, [0.7, 0, 0], [0.092, 0.065, 0.05]), nose, head);
  for (const sx of [1, -1]) g.add(new THREE.SphereGeometry(0.014, 8, 6), trs(tip.clone().add(V(sx * 0.03, -0.004, 0.04))), st('#050303'), head);
  // Jaw.
  g.add(new THREE.CapsuleGeometry(0.05, 0.05, 4, 10), alongY(at(0, 0.02, 0.07), V(0, -0.5, 1), [1.25, 1, 0.8]), furDark, head);
  // Nose ring.
  g.add(new THREE.TorusGeometry(0.03, 0.0065, 6, 18), trs(tip.clone().add(V(0, -0.035, 0.03)), [0.2, 0, 0]), L === 3 ? st('#FFB040', { metal: 1, glow: 0.6 }) : L === 2 ? st('#C9A24A', { metal: 1 }) : st('#8A8680', { metal: 0.8 }), head);
  // Angry brow ridge + glowing eyes.
  for (const sx of [1, -1]) {
    g.add(new THREE.CapsuleGeometry(0.022, 0.07, 4, 8), trs(at(sx * 0.045, 0.165, 0.098), [0, 0, sx * 1.25], [1, 1, 0.8]), furDark, head);
    g.add(new THREE.SphereGeometry(0.017, 8, 6), trs(at(sx * 0.055, 0.142, 0.103), [0, 0, 0], [1.2, 0.7, 0.6]), st(eyeCol, { glow: 2.6 }), head);
    // Ears.
    const ear = new THREE.ConeGeometry(0.03, 0.09, 8);
    ear.scale(1, 1, 0.4);
    g.add(ear, alongY(at(sx * 0.13, 0.15, -0.02), V(sx, -0.25, 0.1)), fur, head);
  }
  // Forelock tuft + mane down the back of the neck.
  const maneStyle = L === 3 ? st('#FF7A1E', { glow: 1.6, pattern: P.flame }) : furDark;
  for (let k = 0; k < 7; k++) {
    const a = lerp(-0.6, 0.6, k / 6);
    g.add(blade(0.045, 0.012, 4, 0.3), alongY(at(Math.sin(a) * 0.06, 0.215, 0.03 + Math.cos(a) * 0.01), V(Math.sin(a) * 0.5, 1, 0.5), [1, 0.1, 1]), furDark, head);
  }
  const neck = ctx.bone('neck_01');
  const sp3 = ctx.bone('spine_03');
  for (let k = 0; k < 9; k++) {
    const t = k / 8;
    const p = at(0, lerp(0.2, -0.12, t), lerp(-0.1, -0.13, t) - 0.02);
    const len = (L === 3 ? 0.2 : 0.12) * (1 - 0.4 * t);
    g.add(blade(0.06, 0.015, 5, 0.3), alongY(p, V(0, 0.3 - t * 0.6, -1).normalize(), [1, len, 1]), maneStyle, t < 0.35 ? head : t < 0.75 ? neck : sp3);
  }
  // Horns: out, up and forward.
  for (const sx of [1, -1]) {
    const pts = [at(sx * 0.09, 0.2, -0.0), at(sx * 0.2, 0.235, 0.0), at(sx * 0.29, 0.31, 0.04), at(sx * 0.31, 0.42, 0.1)];
    horn(ctx, pts, 0.036, hornStyle, head);
    // Horn base ring.
    g.add(new THREE.TorusGeometry(0.036, 0.009, 6, 14), alongY(pts[0].clone().add(V(sx * 0.012, 0.002, 0)), V(sx, 0.25, 0)), L === 1 ? st('#5A3E2A') : st('#3A3434', { metal: 0.8 }), head);
    // Team cloth wrap around each horn (reads from above).
    const wc = new THREE.CatmullRomCurve3(pts).getPoint(0.35);
    const wt = new THREE.CatmullRomCurve3(pts).getTangent(0.35);
    g.add(new THREE.CylinderGeometry(0.032, 0.036, 0.085, 10), alongY(wc, wt), st('team', { glow: L === 3 ? 0.3 : 0 }), head);
    if (L === 3) {
      // Flames licking up from the horn tips.
      for (let k = 0; k < 3; k++) {
        const t = pts[3].clone().add(V(sx * (k - 1) * 0.012, 0.0, (k - 1) * 0.01));
        g.add(taperTube([t, t.clone().add(V(sx * 0.015, 0.045, 0)), t.clone().add(V(-sx * 0.01, 0.085 - k * 0.015, 0.01))], (q) => 0.02 * (1 - q), 6, 5), null, st('#FFC040', { glow: 2.6, pattern: P.flame }), head);
      }
    }
  }
}
