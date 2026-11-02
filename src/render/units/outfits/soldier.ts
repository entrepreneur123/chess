/**
 * Walk, shield soldier / jumper (hero body + Quaternius Ranger outfit, cloth keyed to team colour).
 *  Lv1 militia        Ranger tunic / sleeves / trousers / boots (green -> team), kettle hat, team scarf,
 *                     round wooden shield with an iron boss, wooden spear.
 *  Lv2 veteran        mail shirt + steel breastplate, steel pauldrons with team insets, nasal helmet with a
 *                     team crest, kite shield with a star emblem, spear with a team pennant.
 *  Lv3 arcane guard   dark violet arcane plate with glowing runes, horned closed helm with a glowing visor,
 *                     tower shield with a glowing sigil, crystal glaive, tattered violet cape.
 */
import * as THREE from 'three';
import type { VInfo } from '../body';
import { alongY, blade, flat, sheet, trs } from '../gear';
import { RE, V, clamp01, is, type OutfitCtx } from '../kit';
import type { Style } from '../style';
import { P, anatomy, armor, belt, cape, grip, horn, plume, polearm, shield, slice, st, type Anatomy } from './common';
import type { OutfitResult } from './index';

export function soldier(ctx: OutfitCtx): OutfitResult {
  const L = ctx.level;
  const A = anatomy(ctx);
  const body = ctx.srcMesh('Body');
  const boneOfV = (i: number): string => ctx.src.bones[body.dom[i]];
  const skin: Style = { color: '#FFFFFF', tex: 1 };
  const outfit: Style = { color: '#FFFFFF', tex: 1 };

  const steel: Style = L === 2 ? st('#9AA8BA', { metal: 0.9 }) : st('#45337A', { metal: 0.85, pattern: P.filigree, glow: 0.1 });
  const trim: Style = L === 2 ? st('#C9D3E0', { metal: 1 }) : st('#B98CFF', { glow: 1.2, metal: 0.6 });
  const mail: Style = L === 2 ? st('#5C6470', { pattern: P.chain, metal: 0.65 }) : st('#2A2140', { pattern: P.chain, metal: 0.7 });
  const leather = st(L === 3 ? '#1C1428' : '#4A3324');
  const shoulderX = Math.abs(ctx.src.bonePos('upperarm_l').x);

  if (L === 1) {
    // Hero head + neck only; the Ranger outfit covers the rest.
    ctx.use('Body', () => skin);
    ctx.hide('Body', ctx.tris('Body', (v) => v.bone !== 'Head' && !(v.bone === 'neck_01' && v.p.y > A.neck.min.y + 0.02), 1));
    for (const m of ['Ranger_Torso', 'Ranger_Arms', 'Ranger_Legs', 'Ranger_Boots', 'Ranger_Pauldron']) ctx.use(m, () => outfit);
  } else {
    ctx.use('Body', (i) => {
      const b = boneOfV(i);
      if (b === 'Head' || b === 'neck_01') return skin;
      if (is(b, RE.hand)) return leather;
      return mail;
    });
    if (L === 2) {
      // Ranger trousers + boots under the mail shirt.
      ctx.hide('Body', ctx.tris('Body', (v) => is(v.bone, RE.thigh, RE.calf, RE.foot) || (v.bone === 'pelvis' && v.p.y < A.waist - 0.06), 1));
      ctx.use('Ranger_Legs', () => outfit);
      ctx.use('Ranger_Boots', () => outfit);
    }
  }
  if (L <= 2) {
    ctx.use('Eyes', () => st('#FFFFFF'));
    ctx.use('Brows', () => st('#2A1E18'));
  } else {
    ctx.hide('Body', ctx.tris('Body', (v) => v.bone === 'Head', 1));
  }

  const torso = (v: VInfo): boolean => is(v.bone, RE.spine, RE.clav) || (v.bone === 'pelvis' && v.p.y > A.waist - 0.06);
  if (L >= 2) {
    // Breastplate (Lv2) / full arcane cuirass (Lv3).
    armor(ctx, (v) => (L === 2 ? is(v.bone, RE.chest) && v.p.y > A.chest.min.y + 0.08 : torso(v)), {
      offset: (_p, n) => 0.032 + 0.01 * Math.max(0, n.z),
      smooth: 16,
      style: steel,
      rim: { radius: 0.012, style: trim },
      keep: L === 2,
    });
    for (const side of ['l', 'r'] as const) {
      const sx = side === 'l' ? 1 : -1;
      const sh = ctx.src.bonePos(`upperarm_${side}`);
      armor(ctx, (v) => is(v.bone, RE.clav, RE.upperarm) && v.p.x * sx > 0.11 && v.p.x * sx < 0.32 && v.p.y > sh.y - 0.02, {
        offset: 0.042,
        smooth: 14,
        style: steel,
        rim: { radius: 0.012, style: trim },
        inflate: { center: sh, scale: [1.08, 1.06, 1.1] },
      });
      ctx.gear.add(new THREE.SphereGeometry(0.05, 12, 6, 0, Math.PI * 2, 0, 0.9), trs(sh.clone().add(V(sx * 0.04, 0.115, 0)), [0, 0, -sx * 0.4], [1.1, 0.5, 1]), st('team', { glow: L === 3 ? 0.3 : 0.05, metal: 0.4 }), ctx.bone(`clavicle_${side}`));
    }
    armor(ctx, (v) => is(v.bone, RE.lowerarm), { offset: 0.016, smooth: 8, style: L === 2 ? leather : steel, rim: { radius: 0.008, style: trim } });
    if (L === 3) {
      armor(ctx, (v) => is(v.bone, RE.upperarm) && Math.abs(v.p.x) > shoulderX + 0.08, { offset: 0.02, smooth: 8, style: steel, rim: { radius: 0.008, style: trim } });
      armor(ctx, (v) => is(v.bone, RE.hand), { offset: 0.007, smooth: 1, style: steel, need: 2 });
      armor(ctx, (v) => v.bone === 'pelvis' && v.p.y < A.waist - 0.04, { offset: 0.03, smooth: 10, style: { ...steel, pattern: P.lames }, rim: { radius: 0.01, style: trim } });
      armor(ctx, (v) => is(v.bone, RE.thigh), { offset: 0.022, smooth: 10, style: steel, rim: { radius: 0.009, style: trim } });
      armor(ctx, (v) => is(v.bone, RE.calf), { offset: 0.02, smooth: 10, style: steel, rim: { radius: 0.009, style: trim } });
      armor(ctx, (v) => is(v.bone, RE.foot), { offset: 0.014, smooth: 4, style: steel, rim: { radius: 0.006, style: trim } });
      for (const side of ['l', 'r'] as const) {
        const k = ctx.at(`calf_${side}`);
        ctx.gear.add(flat(new THREE.ConeGeometry(0.045, 0.09, 5)), alongY(k.clone().add(V(0, 0.0, 0.07)), V(0, 0.4, 1)), trim, ctx.bone(`calf_${side}`));
      }
    }
  }
  belt(ctx, A.waist - 0.05, { style: L === 3 ? st('#1C1428') : st('#3E2A1C'), buckle: L === 3 ? trim : st('#9AA0A8', { metal: 0.8 }), out: L === 1 ? 0.045 : 0.05, width: 0.05 });

  helmet(ctx, A, L, steel, trim);
  if (L <= 2) scarf(ctx, A, L);
  if (L === 3) {
    cape(ctx, { bottom: A.knee - 0.05, widthTop: 0.16, widthBottom: 0.28, ragged: 0.08, style: (u) => (u < 0.08 || u > 0.92 ? st('team') : st('#2A1A44')) });
  }

  // --- shield (faces forward in the guard idle)
  const pose = { normal: V(-0.15, 0.05, 1).normalize(), up: V(0, 1, 0) };
  if (L === 1) {
    shield(ctx, 'l', { shape: 'round', size: 0.56, planks: st('#7A5432'), face: st('team', { shade: 0.9 }), rim: st('#4A4A4E', { metal: 0.6 }), boss: st('#8A9098', { metal: 0.85 }), pose, out: 0.08 });
  } else if (L === 2) {
    shield(ctx, 'l', { shape: 'kite', size: 0.66, face: st('team'), rim: trim, emblem: { style: st('#F2F4F8', { metal: 0.6 }), kind: 'star' }, pose, out: 0.08 });
  } else {
    shield(ctx, 'l', { shape: 'tower', size: 0.6, face: st('#2A1A44', { metal: 0.6, pattern: P.filigree, glow: 0.2 }), rim: st('team', { metal: 0.5, glow: 0.2 }), emblem: { style: st('#7A3CFF', { glow: 1.0, pattern: P.rune }), kind: 'sigil' }, pose, out: 0.09 });
  }

  // --- spear / glaive (upright in the idle)
  const g = grip(ctx, 'r');
  const wood = st('#6E4C2C');
  const idleDir = V(0, 1, 0.12);
  if (L <= 2) {
    polearm(ctx, g, {
      length: 1.42,
      back: 0.45,
      shaft: wood,
      idleDir,
      head: (tip, dir, side) => {
        ctx.gear.add(flat(blade(0.06, 0.016, 6, 0.35)), alongY(tip.clone().addScaledVector(dir, -0.01), dir, [1, 0.24, 1]), st('#B8BEC6', { metal: 0.85 }), g.bone);
        ctx.gear.add(new THREE.CylinderGeometry(0.017, 0.015, 0.05, 7), alongY(tip.clone().addScaledVector(dir, -0.03), dir), st('#4A4A4E', { metal: 0.6 }), g.bone);
        if (L === 2) pennant(ctx, tip.clone().addScaledVector(dir, -0.08), dir, side, g.bone);
      },
    });
  } else {
    polearm(ctx, g, {
      length: 1.38,
      back: 0.45,
      shaft: st('#1C1428', { metal: 0.6 }),
      idleDir,
      radius: 0.016,
      head: (tip, dir, side) => {
        const crystal = st('#D7B8FF', { glow: 1.8, metal: 0.3 });
        ctx.gear.add(flat(blade(0.11, 0.03, 6, 0.3)), alongY(tip.clone().addScaledVector(dir, -0.02), dir.clone().addScaledVector(side, 0.12), [1, 0.36, 1]), crystal, g.bone);
        ctx.gear.add(new THREE.OctahedronGeometry(0.035), trs(tip.clone().addScaledVector(dir, -0.05)), st('team', { glow: 1.4 }), g.bone);
        for (const k of [-1, 1]) ctx.gear.add(flat(new THREE.ConeGeometry(0.018, 0.1, 4)), alongY(tip.clone().addScaledVector(dir, -0.06).addScaledVector(side, k * 0.04), dir.clone().addScaledVector(side, k * 0.9)), trim, g.bone);
      },
    });
  }
  return { teamKey: 1 };
}

function helmet(ctx: OutfitCtx, A: Anatomy, L: number, steel: Style, trim: Style): void {
  const hs = A.head.getSize(new THREE.Vector3());
  const hc = A.headC;
  const head = ctx.bone('Head');
  const iron: Style = L === 1 ? st('#7A7E86', { metal: 0.6 }) : steel;
  if (L <= 2) {
    armor(ctx, (v) => v.bone === 'Head' && (v.p.y > A.brow + 0.012 || (v.p.z < hc.z - 0.02 && v.p.y > A.head.min.y + 0.05)), {
      offset: 0.022,
      smooth: 12,
      style: L === 1 ? (p: THREE.Vector3) => (p.y > A.brow + 0.07 ? st('team', { metal: 0.35, shade: 0.9 }) : iron) : iron,
      rim: { radius: 0.009, style: L === 1 ? st('#55585E', { metal: 0.6 }) : trim },
      rigid: head,
      inflate: { center: hc, scale: [1.05, 1.08, 1.03] },
    });
    if (L === 1) {
      // Kettle hat brim.
      const brimY = A.brow + 0.022;
      ctx.gear.add(new THREE.CylinderGeometry(1, 1.25, 1, 28, 1, true), trs([0, brimY - 0.01, hc.z - 0.005], [0.1, 0, 0], [hs.x * 0.62, 0.035, hs.z * 0.6]), iron, head);
      ctx.gear.add(new THREE.TorusGeometry(1, 0.05, 5, 28), trs([0, brimY - 0.028, hc.z - 0.005], [Math.PI / 2 + 0.1, 0, 0], [hs.x * 0.78, hs.z * 0.75, 0.2]), st('#55585E', { metal: 0.6 }), head);
    } else {
      ctx.gear.add(flat(new THREE.BoxGeometry(0.02, 0.085, 0.018)), trs([0, A.brow - 0.022, A.head.max.z + 0.004], [0.08, 0, 0]), trim, head);
      plume(ctx, { base: V(0, A.head.max.y + 0.02, hc.z + 0.02), parent: 'Head', count: 9, length: 0.15, width: 0.045, arc: [-0.4, 2.0], back: 0.1, style: () => st('team') });
    }
    return;
  }
  // Lv3: closed horned helm with a glowing visor.
  armor(ctx, (v) => v.bone === 'Head' || (v.bone === 'neck_01' && v.p.y > A.neck.min.y + 0.03), {
    offset: 0.024,
    smooth: 26,
    style: steel,
    rim: { radius: 0.011, style: trim },
    rigid: head,
    inflate: { center: hc, scale: [1.06, 1.05, 1.05] },
    need: 2,
  });
  const fz = A.head.max.z + 0.01;
  ctx.gear.add(flat(new THREE.BoxGeometry(hs.x * 0.85, 0.022, 0.03)), trs([0, A.brow - 0.006, fz - 0.014], [0.12, 0, 0]), st('#E2C8FF', { glow: 3 }), head);
  for (const sx of [1, -1]) {
    const pts = [V(sx * hs.x * 0.42, A.brow + 0.05, hc.z), V(sx * hs.x * 0.85, A.brow + 0.09, hc.z + 0.01), V(sx * hs.x * 1.05, A.brow + 0.2, hc.z + 0.04), V(sx * hs.x * 0.95, A.brow + 0.3, hc.z + 0.08)];
    horn(ctx, pts, 0.026, (t) => (t > 0.7 ? st('#D7B8FF', { glow: 1.6 }) : st('#1C1428', { metal: 0.8 })), head);
  }
  ctx.gear.add(flat(new THREE.ConeGeometry(0.02, 0.09, 4)), trs([0, A.head.max.y + 0.05, hc.z + 0.01]), st('team', { glow: 0.4 }), head);
}

/** Team scarf: band around the neck + two tails on a sway bone. */
function scarf(ctx: OutfitCtx, A: Anatomy, L: number): void {
  const y = A.neck.min.y + 0.02;
  const s = slice(ctx, y, 0.02, (v) => is(v.bone, RE.neck, RE.clav, RE.chest));
  const cloth = st('team', { shade: L === 1 ? 0.9 : 1 });
  ctx.gear.add(new THREE.TorusGeometry(1, 0.32, 6, 20), new THREE.Matrix4().compose(V(s.cx, y + 0.01, s.cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), V(Math.min(0.1, s.rx * 0.8), Math.min(0.09, s.rz * 0.9), 0.06)), cloth, ctx.bone('spine_03'));
  const at = V(0.04, y - 0.01, s.back + 0.02);
  ctx.addBone('fx_scarf', 'spine_03', at);
  ctx.secondary.push({ bone: 'fx_scarf', axis: [1, 0, 0.3], idleAmp: 0.08, idleFreq: 1.8, run: 0.8, phase: 0.4, hang: 0.7 });
  const b = ctx.bone('fx_scarf');
  for (const [k, len] of [
    [-1, 0.26],
    [1, 0.2],
  ] as const) {
    const g = sheet(1, 6, (u, v, out) => {
      const w = 0.05 * (1 - 0.3 * v);
      out.set(at.x + k * 0.03 + (u - 0.5) * w, at.y - v * len, at.z - 0.01 - v * 0.03 + 0.012 * Math.sin(v * 6));
    }, 0.008);
    ctx.gear.add(g, null, cloth, (p) => ({ a: ctx.bone('spine_03'), b, t: clamp01((at.y - p.y) / 0.05) }));
  }
}

/** Team pennant just below a spear head, on its own sway bone. */
function pennant(ctx: OutfitCtx, at: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3, hand: number): void {
  ctx.addBone('fx_pennant', ctx.src.bones[hand] ?? 'hand_r', at);
  ctx.secondary.push({ bone: 'fx_pennant', axis: [dir.x, dir.y, dir.z], idleAmp: 0.18, idleFreq: 1.6, run: 0.5, phase: 0.2 });
  const b = ctx.bone('fx_pennant');
  const out = side.clone().cross(dir).normalize();
  const g = sheet(6, 2, (u, v, o) => {
    const len = 0.26;
    const h = 0.11 * (1 - u * 0.75);
    o.copy(at).addScaledVector(out, -u * len).addScaledVector(dir, -v * h - u * 0.02);
    o.addScaledVector(side, 0.015 * Math.sin(u * 7));
  }, 0.006);
  ctx.gear.add(g, null, st('team'), (p) => ({ a: hand, b, t: clamp01(p.distanceTo(at) / 0.04) }));
}
