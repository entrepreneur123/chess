/**
 * MARKI - the charging bull. Quadruped, head lowered, horns forward.
 *  Lv1: brown bull, short bone horns, team scarf + harness band.
 *  Lv2: long horns with team wraps + gold tips, nose ring, shoulder plates, second band.
 *  Lv3: legendary - huge horns with glowing tips, glowing eyes, steel chest armour, back spikes,
 *       flaming tail, aura ring.
 */
import * as THREE from 'three';
import {
  C,
  aura,
  axis,
  box,
  cloth,
  cone,
  cyl,
  glow,
  groundRing,
  limb,
  matte,
  metal,
  sphere,
  taperedTube,
  torus,
  type BuildCtx,
} from './kit';

type P = [number, number, number];

/** Horn centre-line for the +x side (mirrored for -x). */
const HORN: Array<{ p: P; r: number }> = [
  { p: [0.07, 0.5, 0.36], r: 0.052 },
  { p: [0.16, 0.52, 0.385], r: 0.047 },
  { p: [0.25, 0.565, 0.415], r: 0.04 },
  { p: [0.3, 0.64, 0.46], r: 0.032 },
  { p: [0.31, 0.73, 0.52], r: 0.022 },
  { p: [0.28, 0.81, 0.58], r: 0.008 },
];

export function buildMarki(g: THREE.Group, { level: L, team }: BuildCtx): void {
  const fur = matte(C.fur, 0.85, false);
  const furDark = matte(C.furDark, 0.85, false);
  const hoof = matte(C.hoof, 0.5);
  const bone = matte(C.bone, 0.55);
  const steel = metal(C.steel);
  const steelDark = metal(C.steelDark, 0.42);
  const gold = metal(C.gold, 0.28);
  const teamCloth = cloth(team.main);
  const teamDark = cloth(team.dark);
  const heat = glow(team.glow, 1.7);
  const gem = glow(L === 3 ? team.glow : C.gold, 1.6);

  // ---- body -------------------------------------------------------------------------------
  sphere(g, [0.215, 0.2, 0.34], fur, { pos: [0, 0.4, -0.05], rot: [0.1, 0, 0] }, [11, 7]);
  sphere(g, [0.205, 0.19, 0.18], furDark, { pos: [0, 0.5, 0.12] }, [9, 6]); // shoulder hump
  sphere(g, [0.185, 0.175, 0.18], fur, { pos: [0, 0.4, -0.22] }, [8, 5]); // rump
  sphere(g, [0.16, 0.16, 0.18], furDark, { pos: [0, 0.42, 0.27] }, [8, 5]); // neck/chest

  // ---- legs -------------------------------------------------------------------------------
  const legs: Array<{ s: number; front: boolean }> = [
    { s: -1, front: true },
    { s: 1, front: true },
    { s: -1, front: false },
    { s: 1, front: false },
  ];
  for (const { s, front } of legs) {
    const x = s * 0.13;
    if (front && s === 1) {
      // raised, stepping forward (charge pose)
      limb(g, [x, 0.4, 0.17], [x, 0.31, 0.34], 0.08, 0.058, fur);
      limb(g, [x, 0.31, 0.34], [x, 0.2, 0.45], 0.058, 0.045, furDark);
      limb(g, [x, 0.2, 0.45], [x, 0.135, 0.48], 0.05, 0.062, hoof, 7);
    } else if (front) {
      limb(g, [x, 0.4, 0.17], [x, 0.2, 0.24], 0.08, 0.058, fur);
      limb(g, [x, 0.2, 0.24], [x, 0.09, 0.26], 0.058, 0.045, furDark);
      cyl(g, 0.048, 0.064, 0.09, hoof, { pos: [x, 0.045, 0.26] }, 7);
    } else {
      limb(g, [x, 0.42, -0.2], [x, 0.2, -0.33], 0.095, 0.055, fur);
      limb(g, [x, 0.2, -0.33], [x, 0.09, -0.27], 0.055, 0.045, furDark);
      cyl(g, 0.048, 0.064, 0.09, hoof, { pos: [x, 0.045, -0.27] }, 7);
    }
  }

  // ---- head -------------------------------------------------------------------------------
  const head = new THREE.Group();
  head.name = 'bull-head';
  g.add(head);
  sphere(head, [0.155, 0.14, 0.185], furDark, { pos: [0, 0.4, 0.42], rot: [0.15, 0, 0] }, [11, 7]);
  sphere(head, [0.1, 0.08, 0.085], matte(C.muzzle, 0.7), { pos: [0, 0.32, 0.56] }, [9, 6]);
  for (const s of [-1, 1]) {
    // eyes
    sphere(head, 0.034, matte(C.white, 0.4), { pos: [s * 0.088, 0.435, 0.51] });
    sphere(head, 0.02, L === 3 ? heat : matte(C.dark, 0.4), { pos: [s * 0.098, 0.435, 0.537] });
    // angry brow
    box(head, [0.085, 0.022, 0.04], furDark, { pos: [s * 0.088, 0.475, 0.515], rot: [0, 0, s * 0.45] });
    // ears
    cone(head, 0.042, 0.13, furDark, { pos: [s * 0.165, 0.455, 0.36], rot: [0, 0, -s * (Math.PI / 2 - 0.25)] }, 6);
  }
  if (L >= 2) torus(head, 0.04, 0.009, gold, { pos: [0, 0.29, 0.645] }, [3, 10]); // nose ring
  if (L >= 2) sphere(head, [0.11, 0.035, 0.1], L === 3 ? steel : steelDark, { pos: [0, 0.495, 0.4], rot: [0.1, 0, 0] }, [8, 5]); // brow plate
  if (L === 3) sphere(head, [0.03, 0.03, 0.015], gem, { pos: [0, 0.5, 0.48] });

  // ---- horns ------------------------------------------------------------------------------
  const nSeg = L === 1 ? 4 : HORN.length;
  const hornScale = [0.82, 1.0, 1.22][L - 1];
  const hornMat = L === 3 ? matte('#F8F0DA', 0.45) : bone;
  const tipMat = L === 3 ? heat : gold;
  const hp = HORN.slice(0, nSeg).map(
    ({ p }) => [p[0] * hornScale, 0.5 + (p[1] - 0.5) * hornScale, 0.36 + (p[2] - 0.36) * hornScale] as P,
  );
  const hr = HORN.slice(0, nSeg).map(({ r }) => r * (L === 3 ? 1.15 : 1));
  for (const s of [-1, 1]) {
    const hornParent = new THREE.Group();
    hornParent.scale.x = s;
    head.add(hornParent);
    taperedTube(hornParent, `marki-horn-${L}`, hp, hr, hornMat, { t0: 0, t1: L === 3 ? 0.62 : 1, steps: 7, radial: 6 });
    if (L === 3) taperedTube(hornParent, `marki-horn-${L}`, hp, hr, tipMat, { t0: 0.62, t1: 1, steps: 4, radial: 6 });
    if (L >= 2) {
      // wraps (team colour) around the first two joints + gold base cap
      sphere(hornParent, hr[0] * 1.15, L === 3 ? gold : steelDark, { pos: hp[0] });
      for (const i of [1, 2]) {
        const a0 = hp[i];
        const b0 = hp[i + 1];
        const [ax] = axis(hornParent, a0, [a0[0] + (b0[0] - a0[0]), a0[1] + (b0[1] - a0[1]), a0[2] + (b0[2] - a0[2])]);
        torus(ax, hr[i] + 0.008, 0.015, teamCloth, { rot: [Math.PI / 2, 0, 0] }, [3, 8]);
      }
      if (L === 2) {
        const tip = hp[hp.length - 1];
        const prev = hp[hp.length - 2];
        const [tx] = axis(hornParent, tip, [tip[0] + (tip[0] - prev[0]), tip[1] + (tip[1] - prev[1]), tip[2] + (tip[2] - prev[2])]);
        cone(tx, 0.016, 0.06, gold, { pos: [0, -0.02, 0] }, 6);
      }
    }
  }

  // ---- team gear --------------------------------------------------------------------------
  torus(g, 0.155, 0.045, L === 3 ? teamCloth : teamDark, { pos: [0, 0.4, 0.3], rot: [0.0, 0, 0] }, [4, 10]); // scarf
  box(g, [0.1, 0.2, 0.02], teamCloth, { pos: [-0.05, 0.31, 0.43], rot: [0.0, 0, 0.12] }); // scarf tail
  // harness band
  const band = (z: number, mat: THREE.Material) => torus(g, 0.205, 0.02, mat, { pos: [0, 0.4, z], rot: [0.1, 0, 0] }, [4, 10]);
  band(-0.06, teamCloth);
  if (L >= 2) {
    band(-0.2, teamDark);
    box(g, [0.05, 0.05, 0.03], gold, { pos: [0, 0.6, -0.06] }); // buckle on the back
  }
  // saddle blanket on the back
  box(g, [0.2, 0.02, 0.17], teamDark, { pos: [0, 0.6, -0.12], rot: [0.1, 0, 0] });

  if (L >= 2) {
    // shoulder plates + spikes
    for (const s of [-1, 1]) {
      sphere(g, [0.1, 0.055, 0.12], L === 3 ? steel : steelDark, { pos: [s * 0.15, 0.6, 0.13], rot: [0, 0, s * -0.5] });
      cone(g, 0.032, 0.11, L === 3 ? gold : steel, { pos: [s * 0.22, 0.66, 0.13], rot: [0, 0, -s * 0.7] }, 5);
    }
  }
  if (L === 3) {
    // chest armour, back spikes, glowing runes
    sphere(g, [0.17, 0.15, 0.1], metal('#8E99AE', 0.35), { pos: [0, 0.42, 0.37] });
    box(g, [0.06, 0.06, 0.02], heat, { pos: [0, 0.43, 0.46], rot: [0, 0, Math.PI / 4] });
    for (let i = 0; i < 4; i++) {
      cone(g, 0.03, 0.1 - i * 0.012, gold, { pos: [0, 0.62 - i * 0.012, 0.2 - i * 0.14], rot: [-0.15, 0, 0] }, 5);
    }
    for (const s of [-1, 1]) {
      sphere(g, [0.012, 0.07, 0.11], heat, { pos: [s * 0.2, 0.4, -0.1] });
    }
  }

  // ---- tail -------------------------------------------------------------------------------
  limb(g, [0, 0.47, -0.36], [0, 0.46, -0.5], 0.025, 0.018, furDark, 6);
  limb(g, [0, 0.46, -0.5], [0, 0.3, -0.54], 0.018, 0.018, furDark, 6);
  if (L === 3) {
    cone(g, 0.045, 0.15, heat, { pos: [0, 0.26, -0.55], rot: [Math.PI, 0, 0] }, 6);
    cone(g, 0.03, 0.12, aura(team.glow, 0.7), { pos: [0.03, 0.22, -0.56], rot: [Math.PI, 0, 0.3] }, 6);
  } else {
    sphere(g, [0.04, 0.06, 0.04], furDark, { pos: [0, 0.27, -0.54] });
  }

  if (L === 3) {
    groundRing(g, 0.46, 0.018, aura(team.glow, 0.85), 0.03);
  }
}
