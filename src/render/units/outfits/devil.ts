/**
 * Insaner, legendary mischievous devil (Quaternius imp body: horns, spiky hair, glowing eyes, fangs).
 *  Lv1 red imp       ragged shorts + team loincloth and scarf, spade tail with a flame tip, crooked trident.
 *  Lv2 jester        skull mask pushed up on the forehead, tattered two-tone jester coat with tails,
 *                    chains + skull trinkets, twin curved daggers with violet edges (violet sparks).
 *  Lv3 mad king      jagged horn crown, flame cape, magenta rune cracks on the skin, orbiting stolen
 *                    weapons (sword / axe / dagger) and spirit wisps (rune disc + light pillar).
 */
import * as THREE from 'three';
import { alongY, blade, flat, plate, sheet, taperTube, trs, type SkinFn } from '../gear';
import { RE, V, clamp01, is, lerp, type OutfitCtx } from '../kit';
import type { Style } from '../style';
import { P, anatomy, armor, basisY, cape, frame, grip, polearm, slice, st, type Grip } from './common';
import type { OutfitResult } from './index';

export function devil(ctx: OutfitCtx): OutfitResult {
  const L = ctx.level;
  const A = anatomy(ctx);
  const skin: Style = L === 1 ? { color: '#FFFFFF', tex: 1 } : L === 2 ? { color: '#E8B8C8', tex: 1 } : { color: '#7A5280', tex: 1, pattern: P.lava };
  // Team-dyed mohawk: light, unsaturated texels of the head (the spiky hair) take the team colour.
  const bodyM = ctx.srcMesh('Body');
  const hairTop = A.head.min.y + (A.head.max.y - A.head.min.y) * 0.55;
  ctx.use('Body', (i) => {
    if (ctx.src.bones[bodyM.dom[i]] !== 'Head' || bodyM.pos[i * 3 + 1] < hairTop) return skin;
    const t = ctx.texel(bodyM.uv[i * 2], bodyM.uv[i * 2 + 1]);
    if (!t) return skin;
    const mx = Math.max(t[0], t[1], t[2]);
    const mn = Math.min(t[0], t[1], t[2]);
    if (mx > 0.45 && mx - mn < 0.2) return st('team', { shade: 0.55 + mx * 0.7, glow: L === 3 ? 0.25 : 0 });
    return skin;
  });
  ctx.use('Shorts', () => ({ color: L === 1 ? '#FFFFFF' : '#5A4A6A', tex: 1 }));
  ctx.use('Collar', () => ({ color: '#FFFFFF', tex: 1 }));
  if (L >= 2) ctx.use('Chains', () => ({ color: '#B8B0C8', tex: 1, metal: 0.6 }));

  const dark = st('#1C1020');
  const bone = st('#E9DFC6');
  const violet = st('#C85CFF', { glow: 2.0 });

  // --- tail (3 sway bones) with a spade tip.
  tail(ctx, L);

  // --- loincloth (front + back flaps, team) and scarf
  const waistY = ctx.src.bonePos('pelvis').y + 0.03;
  const ws = slice(ctx, waistY, 0.02, (v) => is(v.bone, RE.pelvis, RE.spine));
  if (L === 1) {
    for (const [z, rot] of [
      [ws.front + 0.025, -0.08],
      [ws.back - 0.025, 0.08],
    ] as const) {
      const g = plate([[-0.08, 0], [0.08, 0], [0.07, -0.16], [0.035, -0.24], [0.0, -0.18], [-0.03, -0.26], [-0.07, -0.15]], 0.008, 0.002);
      ctx.gear.add(g, trs([0, waistY - 0.02, z], [rot, 0, 0]), st('team', { shade: 0.85 }), ctx.bone('pelvis'));
    }
    ctx.gear.add(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true), new THREE.Matrix4().compose(V(ws.cx, waistY - 0.01, ws.cz), new THREE.Quaternion(), V(ws.rx + 0.02, 0.03, ws.rz + 0.02)), st('#3A2418'), ctx.bone('pelvis'));
    scarf(ctx, A);
  }

  // --- Lv2+: jester coat (two-tone shell over torso + upper arms) with tattered tails, skull trinkets.
  if (L >= 2) {
    const tone = (p: THREE.Vector3): Style => {
      const left = p.x > 0;
      const diamond = Math.sin(p.y * 26) * Math.sin(p.x * 18 + p.z * 10) > 0.55;
      if (L === 3) return diamond ? st('#3A0C3E') : st('#1A0A1E');
      return left ? (diamond ? dark : st('team')) : diamond ? st('team') : dark;
    };
    armor(ctx, (v) => is(v.bone, RE.spine, RE.clav, RE.upperarm) && v.p.y > waistY + 0.02 && !(Math.abs(v.p.x) < 0.07 && v.p.z > 0 && v.p.y > A.chest.min.y + 0.05), {
      offset: 0.014,
      smooth: 5,
      style: tone,
      rim: { radius: 0.008, style: L === 3 ? st('#FF3DF0', { glow: 1.0 }) : st('#C9A24A', { metal: 0.8 }) },
      mesh: 'Body',
    });
    coatTails(ctx, waistY, L);
    // Skull trinkets hanging from the belt.
    for (const a of [-0.9, -0.3, 0.45, 1.0]) {
      const p = V(ws.cx + Math.sin(a) * (ws.rx + 0.03), waistY - 0.05, ws.cz + Math.cos(a) * (ws.rz + 0.03));
      skull(ctx, p, 0.032, ctx.bone('pelvis'), bone);
    }
    if (L === 2) {
      // Skull mask pushed up on the forehead (tilted back, eye holes facing up-forward).
      const hb = ctx.at('Head');
      const mp = hb.clone().add(V(0, 0.155, 0.075));
      const mask = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
      ctx.gear.add(mask, trs(mp, [1.05, 0, 0], [0.055, 0.06, 0.035]), bone, ctx.bone('Head'));
      for (const sx of [1, -1]) ctx.gear.add(new THREE.SphereGeometry(0.012, 8, 6), trs(mp.clone().add(V(sx * 0.022, 0.028, 0.012)), [0.4, 0, 0], [1, 1, 0.5]), dark, ctx.bone('Head'));
      ctx.gear.add(new THREE.BoxGeometry(0.03, 0.006, 0.02), trs(mp.clone().add(V(0, -0.012, 0.03)), [0.9, 0, 0]), dark, ctx.bone('Head'));
    }
  }

  // --- weapons
  const gr = grip(ctx, 'r');
  if (L === 1) {
    polearm(ctx, gr, {
      length: 1.25,
      back: 0.45,
      shaft: st('#3A2A26'),
      radius: 0.012,
      idleDir: V(0.12, 1, 0.1),
      head: (tip, dir, side) => {
        const iron = st('#5A4A4A', { metal: 0.7 });
        ctx.gear.add(flat(new THREE.BoxGeometry(0.17, 0.018, 0.018)), frame(tip.clone().addScaledVector(dir, 0.0), side, dir, side.clone().cross(dir)), iron, gr.bone);
        for (const k of [-1, 0, 1]) {
          const base = tip.clone().addScaledVector(side, k * 0.075);
          const crook = dir.clone().addScaledVector(side, k * 0.25 + (k === 0 ? 0.08 : 0)).normalize();
          ctx.gear.add(flat(new THREE.ConeGeometry(0.013, k === 0 ? 0.2 : 0.15, 5)), alongY(base.clone().addScaledVector(crook, k === 0 ? 0.1 : 0.075), crook), k === 0 ? st('#9CFF3A', { glow: 0.8, metal: 0.4 }) : iron, gr.bone);
        }
        // Team ribbon below the head.
        ctx.gear.add(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), alongY(tip.clone().addScaledVector(dir, -0.08), dir), st('team'), gr.bone);
      },
    });
  } else {
    dagger(ctx, gr, L, violet);
    dagger(ctx, grip(ctx, 'l'), L, violet);
  }

  // --- Lv3: crown, flame cape, orbiting weapons + wisps
  if (L === 3) {
    crown(ctx, A);
    cape(ctx, {
      bottom: A.knee - 0.1,
      widthTop: 0.13,
      widthBottom: 0.3,
      ragged: 0.12,
      style: (u, v) => (u < 0.06 || u > 0.94 ? st('team', { glow: 0.3 }) : v > 0.55 ? st('#4A0A52', { pattern: P.flame }) : st('#2A0830')),
      sway: 1.6,
    });
    orbit(ctx);
  }
  return {};
}

function scarf(ctx: OutfitCtx, A: ReturnType<typeof anatomy>): void {
  const y = A.neck.min.y + 0.005;
  const s = slice(ctx, y, 0.02, (v) => is(v.bone, RE.neck, RE.clav, RE.chest));
  ctx.gear.add(new THREE.TorusGeometry(1, 0.3, 6, 18), new THREE.Matrix4().compose(V(s.cx, y, s.cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), V(Math.min(0.085, s.rx * 0.85), Math.min(0.08, s.rz * 0.95), 0.05)), st('team'), ctx.bone('spine_03'));
  const at = V(-0.03, y - 0.01, s.back + 0.015);
  ctx.addBone('fx_scarf', 'spine_03', at);
  ctx.secondary.push({ bone: 'fx_scarf', axis: [1, 0, -0.3], idleAmp: 0.1, idleFreq: 2.4, run: 0.9, phase: 0.1, hang: 0.7 });
  const b = ctx.bone('fx_scarf');
  const g = sheet(1, 6, (u, v, out) => {
    out.set(at.x + (u - 0.5) * 0.05 * (1 - 0.4 * v), at.y - v * 0.24, at.z - 0.01 - v * 0.03 + 0.01 * Math.sin(v * 7));
  }, 0.007);
  ctx.gear.add(g, null, st('team'), (p) => ({ a: ctx.bone('spine_03'), b, t: clamp01((at.y - p.y) / 0.05) }));
}

/** Spade-tipped tail on a 3-bone sway chain. */
function tail(ctx: OutfitCtx, L: number): void {
  const pel = ctx.at('pelvis');
  const back = slice(ctx, pel.y, 0.03, (v) => v.bone === 'pelvis').back;
  const pts = [V(0, pel.y + 0.02, back + 0.02), V(0.02, pel.y - 0.14, back - 0.08), V(0.08, pel.y - 0.3, back - 0.13), V(0.15, pel.y - 0.36, back - 0.2), V(0.2, pel.y - 0.26, back - 0.26)];
  const b1 = ctx.addBone('fx_tail1', 'pelvis', pts[0]);
  const b2 = ctx.addBone('fx_tail2', 'fx_tail1', pts[2]);
  const b3 = ctx.addBone('fx_tail3', 'fx_tail2', pts[3]);
  ctx.secondary.push(
    { bone: 'fx_tail1', axis: [0, 1, 0], idleAmp: 0.22, idleFreq: 1.1, run: 0.3, phase: 0 },
    { bone: 'fx_tail2', axis: [0, 1, 0.4], idleAmp: 0.35, idleFreq: 1.1, run: -0.3, phase: 0.8 },
    { bone: 'fx_tail3', axis: [1, 0, 0], idleAmp: 0.3, idleFreq: 1.1, run: 0.4, phase: 1.6 },
  );
  const curve = new THREE.CatmullRomCurve3(pts);
  const tParam = (p: THREE.Vector3): number => {
    let best = 0;
    let bd = 1e9;
    for (let i = 0; i <= 40; i++) {
      const d = curve.getPoint(i / 40).distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = i / 40;
      }
    }
    return best;
  };
  const pel0 = ctx.bone('pelvis');
  const skin: SkinFn = (p) => {
    const t = tParam(p);
    if (t < 0.12) return { a: pel0, b: b1, t: t / 0.12 };
    if (t < 0.5) return { a: b1, b: b2, t: clamp01((t - 0.3) / 0.2) };
    return { a: b2, b: b3, t: clamp01((t - 0.65) / 0.15) };
  };
  const tailCol: Style = L === 3 ? st('#5A1E5A', { pattern: P.lava }) : L === 2 ? st('#7A1E30') : st('#9A2A2A');
  ctx.gear.add(taperTube(pts, (t) => lerp(0.028, 0.011, t), 18, 7), null, tailCol, skin);
  // Spade.
  const tip = pts[4];
  const dir = curve.getTangent(1).normalize();
  const spade = plate([[0, 0.09], [0.045, 0.02], [0.03, -0.01], [0, 0.0], [-0.03, -0.01], [-0.045, 0.02]], 0.012, 0.004);
  const [x, y, z] = basisY(dir, V(1, 0, 0));
  ctx.gear.add(spade, frame(tip, x, y, z), L === 3 ? st('#FF3DF0', { glow: 1.4 }) : tailCol, b3);
  if (L === 1) {
    for (let k = 0; k < 3; k++) {
      const p0 = tip.clone().addScaledVector(dir, 0.06);
      ctx.gear.add(taperTube([p0, p0.clone().add(V((k - 1) * 0.015, 0.05, 0)), p0.clone().add(V((k - 1) * 0.01, 0.1 - k * 0.015, 0.01))], (q) => 0.016 * (1 - q), 5, 5), null, st('#9CFF3A', { glow: 2.2, pattern: P.flame }), b3);
    }
  }
}

/** Tattered coat tails behind (Lv2 / Lv3). */
function coatTails(ctx: OutfitCtx, waistY: number, L: number): void {
  const s = slice(ctx, waistY + 0.02, 0.02, (v) => is(v.bone, RE.pelvis, RE.spine));
  for (const sx of [1, -1]) {
    const side = sx > 0 ? 'l' : 'r';
    const th = ctx.bone(`thigh_${side}`);
    const g = sheet(3, 5, (u, v, out) => {
      const len = 0.42 * (u > 0.5 ? 1 : 0.85) - (v === 1 ? 0.06 * Math.sin(u * 19) : 0);
      out.set(sx * (0.02 + u * (s.rx * 0.95)), waistY + 0.03 - v * len, s.back - 0.01 - v * 0.06 + 0.02 * Math.sin(u * 3));
    }, 0.008);
    ctx.gear.add(g, null, L === 3 ? st('#2A0A30') : sx > 0 ? st('team', { shade: 0.85 }) : st('#1C1020'), (p) => ({ a: ctx.bone('pelvis'), b: th, t: clamp01((waistY - p.y) / 0.25) * 0.7 }));
  }
}

function skull(ctx: OutfitCtx, p: THREE.Vector3, r: number, b: number, bone: Style): void {
  ctx.gear.add(new THREE.SphereGeometry(r, 8, 6), trs(p, [0, 0, 0], [1, 0.95, 1]), bone, b);
  ctx.gear.add(new THREE.BoxGeometry(r * 1.1, r * 0.6, r * 0.9), trs(p.clone().add(V(0, -r * 0.8, r * 0.15))), bone, b);
  for (const sx of [1, -1]) ctx.gear.add(new THREE.SphereGeometry(r * 0.28, 5, 4), trs(p.clone().add(V(sx * r * 0.38, -r * 0.1, r * 0.82))), st('#1C1020'), b);
}

/** Curved dagger with a glowing violet edge. */
function dagger(ctx: OutfitCtx, g: Grip, L: number, edge: Style): void {
  const [x, y, z] = basisY(g.axis, g.palm);
  const o = g.o;
  ctx.gear.add(new THREE.CylinderGeometry(0.012, 0.013, 0.11, 7), frame(o, x, y, z), st('#2A1A2E'), g.bone);
  ctx.gear.add(flat(new THREE.BoxGeometry(0.09, 0.016, 0.022)), frame(o.clone().addScaledVector(y, 0.06), x, y, z), st('#C9A24A', { metal: 0.9 }), g.bone);
  const len = L === 3 ? 0.34 : 0.28;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push(o.clone().addScaledVector(y, 0.065 + t * len).addScaledVector(x, -0.08 * t * t));
  }
  ctx.gear.add(taperTube(pts, (t) => 0.026 * (1 - t * 0.85), 10, 6, 0.25), null, st('#2A2032', { metal: 0.9 }), g.bone);
  const ep = pts.map((p, i) => p.clone().addScaledVector(x, 0.016 * (1 - i / 5)));
  ctx.gear.add(taperTube(ep, (t) => 0.008 * (1 - t * 0.7), 10, 5), null, edge, g.bone);
}

/** Jagged horn crown of the mad king. */
function crown(ctx: OutfitCtx, A: ReturnType<typeof anatomy>): void {
  const head = ctx.bone('Head');
  const hs = A.head.getSize(new THREE.Vector3());
  const c = A.headC;
  const y = A.head.min.y + hs.y * 0.8;
  const rx = hs.x * 0.24;
  const rz = hs.z * 0.32;
  ctx.gear.add(new THREE.CylinderGeometry(1, 1.06, 1, 20, 1, true), new THREE.Matrix4().compose(V(c.x, y, c.z), new THREE.Quaternion(), V(rx, 0.035, rz)), st('#1A0A1E', { metal: 0.8 }), head);
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const h = (k % 2 ? 0.1 : 0.17) * (k === 0 ? 1.35 : 1);
    const base = V(c.x + Math.sin(a) * rx, y + 0.01, c.z + Math.cos(a) * rz);
    const dir = V(Math.sin(a) * 0.35, 1, Math.cos(a) * 0.35 + 0.05).normalize();
    ctx.gear.add(flat(new THREE.ConeGeometry(0.022, h, 4)), alongY(base.clone().addScaledVector(dir, h / 2), dir), st('#1A0A1E', { metal: 0.8 }), head);
    ctx.gear.add(new THREE.OctahedronGeometry(0.014), trs(base.clone().addScaledVector(dir, h * 0.82)), st('#FF3DF0', { glow: 2.6 }), head);
  }
}

/** Orbiting stolen weapons + spirit wisps (two spinning bones at the pelvis). */
function orbit(ctx: OutfitCtx): void {
  const pel = ctx.at('pelvis');
  ctx.addBone('fx_orbit', 'root', V(0, pel.y + 0.15, 0));
  ctx.addBone('fx_wisps', 'root', V(0, pel.y + 0.3, 0));
  ctx.secondary.push(
    { bone: 'fx_orbit', axis: [0, 1, 0], idleAmp: 0, idleFreq: 1, run: 0, phase: 0, spin: 1.1 },
    { bone: 'fx_wisps', axis: [0, 1, 0], idleAmp: 0, idleFreq: 1, run: 0, phase: 0, spin: -1.7 },
  );
  const ob = ctx.bone('fx_orbit');
  const wb = ctx.bone('fx_wisps');
  const R = 0.36;
  const y0 = pel.y + 0.15;
  const steel = st('#C8C4D8', { metal: 0.9, glow: 0.15 });
  const glowEdge = st('#FF4AF2', { glow: 1.6 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const c = V(Math.sin(a) * R, y0 + (k - 1) * 0.12, Math.cos(a) * R);
    const tangent = V(Math.cos(a), 0.25, -Math.sin(a)).normalize();
    const radial = V(Math.sin(a), 0, Math.cos(a));
    const [x, y, z] = basisY(tangent, radial);
    if (k === 0) {
      // Sword.
      ctx.gear.add(flat(blade(0.05, 0.012, 6, 0.85)), frame(c, x, y, z, [1, 0.42, 1]), steel, ob);
      ctx.gear.add(flat(new THREE.BoxGeometry(0.12, 0.015, 0.02)), frame(c, x, y, z), st('#C9A24A', { metal: 0.9 }), ob);
      ctx.gear.add(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 6), frame(c.clone().addScaledVector(y, -0.05), x, y, z), st('#3A2418'), ob);
    } else if (k === 1) {
      // Axe.
      ctx.gear.add(new THREE.CylinderGeometry(0.01, 0.011, 0.36, 6), frame(c, x, y, z), st('#4A3020'), ob);
      ctx.gear.add(flat(plate([[0, 0.07], [0.11, 0.1], [0.13, 0], [0.11, -0.1], [0, -0.06]], 0.012, 0.003)), frame(c.clone().addScaledVector(y, 0.12), z, y, x), steel, ob);
    } else {
      // Dagger.
      ctx.gear.add(flat(blade(0.04, 0.01, 6, 0.8)), frame(c, x, y, z, [1, 0.22, 1]), steel, ob);
      ctx.gear.add(new THREE.CylinderGeometry(0.009, 0.009, 0.07, 6), frame(c.clone().addScaledVector(y, -0.035), x, y, z), st('#2A1A2E'), ob);
    }
    ctx.gear.add(new THREE.TorusGeometry(0.05, 0.004, 4, 16), frame(c.clone().addScaledVector(y, 0.05), x, z, y), glowEdge, ob);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const p = V(Math.sin(a) * (R * 0.85), pel.y + 0.3 + Math.sin(k * 2.1) * 0.15, Math.cos(a) * (R * 0.85));
    ctx.gear.add(new THREE.IcosahedronGeometry(0.03, 1), trs(p), st('#4CE84A', { glow: 1.1 }), wb);
    ctx.gear.add(flat(new THREE.ConeGeometry(0.02, 0.07, 6)), alongY(p.clone().add(V(0, 0.04, 0)), V(0, 1, 0)), st('#3AC83A', { glow: 0.8 }), wb);
  }
}
