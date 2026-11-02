/**
 * Sad, holy paladin (hero body).
 *  Lv1 squire      quilted gambeson, battered steel breastplate, open bascinet with a short team plume,
 *                  leather bracers / boots, plain longsword + round wooden buckler with a team field,
 *                  short team cape.
 *  Lv2 knight      full silver-blue plate with gold trim over mail, layered pauldrons with team insets,
 *                  closed great helm + tall team plume, tassets, kite shield with a gold cross, longsword
 *                  with a glowing blue rune, long team cape.
 *  Lv3 champion    white-gold ornate plate (glowing filigree), winged great helm + halo crown, radiant
 *                  greatsword, huge gold-trimmed cape (aura, light pillar and particles from config).
 */
import * as THREE from 'three';
import type { VInfo } from '../body';
import { alongY, blade, flat, plate, starOutline, trs } from '../gear';
import { RE, V, is, type OutfitCtx } from '../kit';
import type { Style } from '../style';
import { P, anatomy, armor, belt, cape, dents, grip, plume, shield, st, sword, type Anatomy } from './common';
import type { OutfitResult } from './index';

export function paladin(ctx: OutfitCtx): OutfitResult {
  const L = ctx.level;
  const A = anatomy(ctx);
  const src = ctx.src;
  const body = ctx.srcMesh('Body');
  const boneOfV = (i: number): string => src.bones[body.dom[i]];

  const steel: Style =
    L === 1 ? st('#7E848C', { metal: 0.55 }) : L === 2 ? st('#A8BCDC', { metal: 0.95 }) : st('#E6E0D4', { metal: 0.55, pattern: P.filigree, glow: 0.04 });
  const gold: Style = st('#E2B33C', { metal: 1, glow: 0.12, pattern: P.filigree });
  const limb: Style = L === 3 ? gold : steel;
  const trim: Style = L === 1 ? st('#585C64', { metal: 0.5 }) : L === 2 ? st('#F2C14E', { metal: 1, glow: 0.12 }) : st('#FFD45C', { metal: 1, glow: 0.4 });
  const mail: Style = L === 1 ? st('#B49A6E', { pattern: P.quilt }) : L === 2 ? st('#59606C', { pattern: P.chain, metal: 0.6 }) : st('#CDB98A', { pattern: P.chain, metal: 0.7 });
  const leather: Style = L === 1 ? st('#5A3E2A') : L === 2 ? st('#26304A') : st('#E9DCC2');
  const pants: Style = L === 1 ? st('#353B4A') : mail;
  const skin: Style = { color: '#FFFFFF', tex: 1 };

  // --- body: bare head (Lv1 only shows the face), under-layer everywhere else.
  const closed = L >= 2;
  ctx.use('Body', (i) => {
    const b = boneOfV(i);
    if (b === 'Head' || b === 'neck_01') return skin;
    if (is(b, RE.hand)) return leather;
    if (is(b, RE.thigh, RE.calf, RE.foot) || (b === 'pelvis' && body.pos[i * 3 + 1] < A.waist - 0.05)) return pants;
    return mail;
  });
  if (!closed) {
    ctx.use('Eyes', () => st('#FFFFFF'));
    ctx.use('Brows', () => st('#4A3426'));
  } else {
    ctx.hide('Body', ctx.tris('Body', (v) => v.bone === 'Head', 1));
  }

  const torso = (v: VInfo): boolean => is(v.bone, RE.spine, RE.clav) || (v.bone === 'pelvis' && v.p.y > A.waist - 0.06);
  const shoulderX = Math.abs(src.bonePos('upperarm_l').x);

  // --- torso
  if (L === 1) {
    // Quilted gambeson coat (torso + upper arms + hips), breastplate on top.
    armor(ctx, (v) => torso(v) || is(v.bone, RE.upperarm) || (v.bone === 'pelvis' && v.p.y > A.pelvis.min.y + 0.06), {
      offset: 0.012,
      smooth: 5,
      style: mail,
      rim: { radius: 0.008, style: st('#6E5C44') },
    });
    armor(ctx, (v) => is(v.bone, RE.chest) && Math.abs(v.p.x) < 0.2 && v.p.y > A.chest.min.y + 0.12, {
      offset: (p, n) => 0.036 + dents(0.012)(p) + 0.01 * Math.max(0, n.z),
      smooth: 14,
      style: steel,
      rim: { radius: 0.011, style: trim },
      keep: true,
    });
  } else {
    // Cuirass (chest + back + belly lames) with trim.
    armor(ctx, (v) => is(v.bone, RE.spine) || (v.bone === 'clavicle_l' || v.bone === 'clavicle_r') && Math.abs(v.p.x) < 0.14, {
      offset: (p, n) => 0.03 + 0.012 * Math.max(0, n.z) * (p.y > A.chest.min.y + 0.2 ? 1 : 0.4),
      smooth: 16,
      style: (p) => (p.y < ctx.src.bonePos('spine_02').y + 0.02 && L === 2 ? { ...steel, pattern: P.lames } : steel),
      rim: { radius: 0.013, style: trim },
    });
    // Fauld / hip plates (pelvis band) with lames.
    armor(ctx, (v) => v.bone === 'pelvis' && v.p.y > A.pelvis.min.y + 0.07, {
      offset: 0.028,
      smooth: 10,
      style: { ...steel, pattern: L === 2 ? P.lames : P.filigree },
      rim: { radius: 0.01, style: trim },
    });
  }

  // --- pauldrons (layered domes, team inset)
  if (L >= 2) {
    const big = L === 3 ? 1.12 : 1;
    for (const side of ['l', 'r'] as const) {
      const sx = side === 'l' ? 1 : -1;
      const sh = ctx.src.bonePos(`upperarm_${side}`);
      const top = (v: VInfo, x0: number, x1: number, yMin: number): boolean =>
        is(v.bone, RE.clav, RE.upperarm) && v.p.x * sx > x0 && v.p.x * sx < x1 && v.p.y > yMin;
      armor(ctx, (v) => top(v, 0.11, 0.3, sh.y - 0.02), {
        offset: 0.05 * big,
        smooth: 18,
        style: limb,
        rim: { radius: 0.014, style: trim },
        inflate: { center: sh, scale: [1.12 * big, 1.1 * big, 1.15 * big] },
      });
      armor(ctx, (v) => top(v, 0.2, 0.36, sh.y - 0.035), {
        offset: 0.036 * big,
        smooth: 10,
        style: limb,
        rim: { radius: 0.011, style: trim },
        inflate: { center: sh, scale: [1.06, 1.04 * big, 1.1 * big] },
        keep: true,
      });
      // Team enamel inset on top (reads from above).
      const ins = sh.clone().add(V(sx * 0.03, 0.09 * big + 0.03, 0));
      ctx.gear.add(new THREE.SphereGeometry(0.06 * big, 12, 6, 0, Math.PI * 2, 0, 0.9), trs(ins, [0, 0, -sx * 0.35], [1.1, 0.5, 1]), st('team', { glow: L === 3 ? 0.25 : 0.08, metal: 0.4 }), ctx.bone(`clavicle_${side}`));
      if (L === 3) {
        // Flared wing-like spikes on the pauldron.
        for (let k = 0; k < 3; k++) {
          const p0 = sh.clone().add(V(sx * (0.08 + k * 0.04), 0.13 - k * 0.025, -0.02 - k * 0.03));
          const g = flat(new THREE.ConeGeometry(0.022, 0.13 - k * 0.02, 4));
          ctx.gear.add(g, trs(p0, [-0.5, 0, -sx * (0.7 + k * 0.15)]), trim, ctx.bone(`clavicle_${side}`));
        }
      }
    }
  }

  // --- arms
  if (L === 1) {
    armor(ctx, (v) => is(v.bone, RE.lowerarm), { offset: 0.012, smooth: 6, style: leather, rim: { radius: 0.007, style: st('#3E2A1C') } });
  } else {
    armor(ctx, (v) => is(v.bone, RE.upperarm) && Math.abs(v.p.x) > shoulderX + 0.09, { offset: 0.022, smooth: 10, style: steel, rim: { radius: 0.008, style: trim } });
    armor(ctx, (v) => is(v.bone, RE.lowerarm), { offset: 0.022, smooth: 10, style: limb, rim: { radius: 0.009, style: trim } });
    armor(ctx, (v) => is(v.bone, RE.hand), { offset: 0.007, smooth: 1, style: limb, need: 2 });
    for (const side of ['l', 'r'] as const) {
      // Couter (elbow cop).
      const e = ctx.at(`lowerarm_${side}`);
      ctx.gear.add(new THREE.SphereGeometry(0.045, 10, 6), trs(e.clone().add(V(0, 0, -0.04)), [0, 0, 0], [0.8, 1, 0.7]), trim, ctx.bone(`lowerarm_${side}`));
    }
  }

  // --- legs
  const knee = A.knee;
  if (L === 1) {
    armor(ctx, (v) => (is(v.bone, RE.calf) && v.p.y < knee - 0.12) || is(v.bone, RE.foot), {
      offset: 0.018,
      smooth: 14,
      style: leather,
      rim: { radius: 0.01, style: st('#3E2A1C') },
    });
  } else {
    armor(ctx, (v) => is(v.bone, RE.thigh) && v.p.y < A.pelvis.min.y + 0.02, { offset: 0.022, smooth: 10, style: steel, rim: { radius: 0.009, style: trim } });
    armor(ctx, (v) => is(v.bone, RE.calf), { offset: 0.02, smooth: 10, style: limb, rim: { radius: 0.009, style: trim } });
    armor(ctx, (v) => is(v.bone, RE.foot), { offset: 0.014, smooth: 4, style: limb, rim: { radius: 0.006, style: trim } });
    for (const side of ['l', 'r'] as const) {
      // Poleyn (knee cop) + front tassets.
      const k = ctx.at(`calf_${side}`);
      ctx.gear.add(new THREE.SphereGeometry(0.055, 12, 8), trs(k.clone().add(V(0, 0.01, 0.06)), [0, 0, 0], [0.9, 1.1, 0.6]), trim, ctx.bone(`calf_${side}`));
      const sx = side === 'l' ? 1 : -1;
      const t = ctx.at(`thigh_${side}`);
      const tas = plate(
        [
          [-0.07, 0.07],
          [0.07, 0.07],
          [0.06, -0.09],
          [0, -0.12],
          [-0.06, -0.09],
        ],
        0.012,
        0.004,
      );
      ctx.gear.add(tas, trs(t.clone().add(V(sx * 0.03, -0.08, 0.135)), [-0.22, sx * 0.25, 0]), steel, ctx.bone(`thigh_${side}`));
      ctx.gear.add(new THREE.BoxGeometry(0.15, 0.014, 0.016), trs(t.clone().add(V(sx * 0.03, -0.012, 0.15)), [-0.22, sx * 0.25, 0]), trim, ctx.bone(`thigh_${side}`));
    }
  }

  // --- belt + buckle
  belt(ctx, A.waist - 0.05, { style: L === 3 ? st('#C8962E', { metal: 0.9 }) : st('#3B2A1E'), buckle: trim, out: L === 1 ? 0.03 : 0.045 });

  // --- helmet
  helmet(ctx, A, L, steel, trim);

  // --- cape
  const capeBottom = L === 1 ? A.pelvis.min.y + 0.02 : L === 2 ? knee - 0.12 : 0.18;
  cape(ctx, {
    bottom: capeBottom,
    widthTop: 0.17,
    widthBottom: L === 3 ? 0.36 : L === 2 ? 0.3 : 0.24,
    style: (u) => (L >= 2 && (u < 0.1 || u > 0.9) ? trim : st('team', { shade: L === 1 ? 0.75 : 1 })),
  });

  // --- weapons
  const gr = grip(ctx, 'r');
  if (L === 1) {
    sword(ctx, gr, { idleDir: V(-0.05, -0.85, 0.55), blade: 0.66, width: 0.055, steel: st('#B8BEC6', { metal: 0.6 }), guard: st('#5C5E64', { metal: 0.5 }), grip: st('#3E2A1C'), pommel: st('#5C5E64', { metal: 0.5 }) });
    shield(ctx, 'l', {
      shape: 'round',
      size: 0.34,
      planks: st('#7A5432'),
      face: st('team', { shade: 0.85 }),
      rim: st('#5C5E64', { metal: 0.6 }),
      boss: st('#9AA0A8', { metal: 0.8 }),
    });
  } else if (L === 2) {
    sword(ctx, gr, {
      idleDir: V(-0.05, -0.85, 0.55),
      blade: 0.7,
      width: 0.06,
      steel: st('#E2ECFA', { metal: 0.95 }),
      guard: trim,
      grip: st('#1F2A44'),
      pommel: trim,
      rune: st('#7FD0FF', { glow: 1.6, pattern: P.rune }),
      gem: st('teamLight', { glow: 1.2 }),
    });
    shield(ctx, 'l', {
      shape: 'kite',
      size: 0.44,
      face: st('team'),
      rim: trim,
      emblem: { style: trim, kind: 'cross' },
      out: 0.05,
      pose: { normal: V(0.85, 0, 0.5).normalize(), up: V(0, 1, 0) },
    });
  } else {
    sword(ctx, gr, {
      idleDir: V(0.05, 1, 0.12),
      blade: 0.95,
      width: 0.085,
      steel: st('#FFF6D8', { metal: 0.9, glow: 0.55 }),
      guard: trim,
      grip: st('#7A4A16'),
      pommel: trim,
      rune: st('#FFE9A0', { glow: 2.4, pattern: P.rune }),
      ornate: true,
      gem: st('teamLight', { glow: 1.8 }),
    });
  }
  return {};
}

function helmet(ctx: OutfitCtx, A: Anatomy, L: number, steel: Style, trim: Style): void {
  const hs = A.head.getSize(new THREE.Vector3());
  const hc = A.headC;
  const head = ctx.bone('Head');
  if (L === 1) {
    // Open bascinet: skull + back of the head, face open; nasal bar.
    armor(ctx, (v) => v.bone === 'Head' && (v.p.y > A.brow + 0.012 || (v.p.z < hc.z - 0.015 && v.p.y > A.head.min.y + 0.04)), {
      offset: 0.02,
      smooth: 12,
      style: steel,
      rim: { radius: 0.009, style: trim },
      rigid: head,
      inflate: { center: hc, scale: [1.04, 1.06, 1.02] },
    });
    // Bascinet: pointed skull ridge + nasal bar.
    ctx.gear.add(flat(new THREE.BoxGeometry(0.02, 0.09, 0.018)), trs([0, A.brow - 0.024, A.head.max.z + 0.004], [0.08, 0, 0]), steel, head);
    ctx.gear.add(flat(new THREE.BoxGeometry(hs.x * 0.9, 0.02, 0.02)), trs([0, A.brow + 0.018, A.head.max.z - 0.012], [0.1, 0, 0]), trim, head);
    plume(ctx, {
      base: V(0, A.head.max.y + 0.03, hc.z - 0.02),
      parent: 'Head',
      count: 6,
      length: 0.14,
      width: 0.05,
      arc: [0.2, 1.5],
      style: () => st('team', { shade: 0.85 }),
    });
    return;
  }
  // Closed great helm.
  armor(ctx, (v) => v.bone === 'Head' || (v.bone === 'neck_01' && v.p.y > A.neck.min.y + 0.03), {
    offset: 0.024,
    smooth: 28,
    style: steel,
    rim: { radius: 0.011, style: trim },
    rigid: head,
    inflate: { center: hc, scale: [1.08, 1.04, 1.04] },
    need: 2,
  });
  const fz = A.head.max.z + 0.012;
  const slit: Style = L === 3 ? st('#FFE9A0', { glow: 2.4 }) : st('#0B1020', { glow: 0 });
  ctx.gear.add(flat(new THREE.BoxGeometry(hs.x * 0.82, 0.016, 0.03)), trs([0, A.brow - 0.008, fz - 0.012], [0.12, 0, 0]), slit, head);
  // Vertical face ridge + brow band.
  ctx.gear.add(flat(new THREE.BoxGeometry(0.016, hs.y * 0.62, 0.02)), trs([0, A.brow - hs.y * 0.18, fz + 0.002], [0.1, 0, 0]), trim, head);
  ctx.gear.add(flat(new THREE.BoxGeometry(hs.x * 1.0, 0.018, 0.02)), trs([0, A.brow + 0.016, fz - 0.016], [0.12, 0, 0]), trim, head);
  const top = A.head.max.y + 0.03;
  if (L === 2) {
    plume(ctx, {
      base: V(0, top, hc.z - 0.01),
      parent: 'Head',
      count: 11,
      length: 0.26,
      width: 0.06,
      style: (i) => st(i % 2 ? 'teamDark' : 'team'),
    });
    return;
  }
  // Lv3: wings on the sides + halo crown.
  for (const sx of [1, -1]) {
    for (let k = 0; k < 4; k++) {
      const p0 = V(sx * (hs.x * 0.5 + 0.012), hc.y + 0.03 - k * 0.018, hc.z - 0.01 - k * 0.02);
      const len = 0.19 - k * 0.035;
      const dir = V(sx * 0.35, 0.75 - k * 0.12, -0.75 - k * 0.1).normalize();
      ctx.gear.add(blade(0.06 - k * 0.008, 0.012, 6, 0.3), alongY(p0, dir, [1, len, 1]), k === 0 ? trim : st('#FFFFFF', { glow: 0.35, metal: 0.3 }), head);
    }
  }
  const crown = plate(starOutline(10, 0.78), 0.012, 0.003);
  crown.rotateX(-Math.PI / 2);
  ctx.gear.add(new THREE.TorusGeometry(hs.x * 0.42, 0.012, 6, 32), trs([0, top + 0.08, hc.z - 0.03], [Math.PI / 2 - 0.3, 0, 0]), st('#FFE9A0', { glow: 2.4, metal: 1 }), head);
  ctx.gear.add(crown, trs([0, top - 0.005, hc.z - 0.01], [0, 0, 0], [hs.x * 1.05, 1, hs.z * 0.95]), trim, head);
  plume(ctx, {
    base: V(0, top, hc.z - 0.04),
    parent: 'Head',
    count: 7,
    length: 0.2,
    width: 0.055,
    arc: [0.6, 1.8],
    style: (i) => st(i % 2 ? 'teamLight' : 'team', { glow: 0.15 }),
  });
}
