/**
 * WALK - the shield-bearer. Big tower shield in front, spear at the side, lighter armour.
 *  Lv1: wooden shield with iron rim + team chevron, short spear, leather cap.
 *  Lv2: steel-faced shield with emblem, longer spear with pennant, crest + pauldron.
 *  Lv3: legendary - gold-rimmed glowing shield, glowing spear head, flowing crest, cape, aura ring.
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
  dome,
  extrude,
  glow,
  groundRing,
  limb,
  matte,
  metal,
  polygon,
  sphere,
  torus,
  type BuildCtx,
} from './kit';

/** Tower-shield outline scaled by k around its own centre. */
function shieldShape(W: number, H: number, k: number): THREE.Shape {
  const cx = 0;
  const cy = H / 2;
  const X = (x: number) => cx + x * k;
  const Y = (y: number) => cy + (y - cy) * k;
  const s = new THREE.Shape();
  s.moveTo(X(0), Y(0));
  s.lineTo(X(W * 0.38), Y(H * 0.1));
  s.lineTo(X(W * 0.5), Y(H * 0.3));
  s.lineTo(X(W * 0.5), Y(H * 0.8));
  s.quadraticCurveTo(X(W * 0.5), Y(H * 1.0), X(0), Y(H * 1.04));
  s.quadraticCurveTo(X(-W * 0.5), Y(H * 1.0), X(-W * 0.5), Y(H * 0.8));
  s.lineTo(X(-W * 0.5), Y(H * 0.3));
  s.lineTo(X(-W * 0.38), Y(H * 0.1));
  s.closePath();
  return s;
}

function crestShape(h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0.1, 0);
  s.quadraticCurveTo(0.12, 0.05 + h, 0.0, 0.07 + h);
  s.quadraticCurveTo(-0.14, 0.08 + h, -0.26, -0.04 - h * 0.6);
  s.lineTo(-0.1, 0);
  s.closePath();
  return s;
}

function chevron(w: number, t: number): THREE.Shape {
  return polygon([
    [0, w * 0.5],
    [w, 0],
    [w, -t],
    [0, w * 0.5 - t],
    [-w, -t],
    [-w, 0],
  ]);
}

export function buildWalk(g: THREE.Group, { level: L, team }: BuildCtx): void {
  const steel = metal(C.steel);
  const steelLight = metal(C.steelLight, 0.28);
  const steelDark = metal(C.steelDark, 0.45);
  const gold = metal(C.gold, 0.28);
  const leather = cloth(C.leather);
  const leatherDark = cloth(C.leatherDark);
  const teamCloth = cloth(team.main);
  const teamDark = cloth(team.dark);
  const skin = matte(C.skin, 0.7, false);
  const trousers = cloth('#3B4150');

  // ---- legs (slightly staggered: skirmisher stance) ---------------------------------------
  for (const [s, dz] of [[-1, -0.04], [1, 0.05]] as const) {
    limb(g, [s * 0.08, 0.1, dz], [s * 0.08, 0.33, 0], 0.055, 0.065, trousers);
    box(g, [0.115, 0.1, 0.2], leatherDark, { pos: [s * 0.08, 0.05, dz + 0.03] });
    box(g, [0.12, 0.05, 0.1], L >= 2 ? steelDark : leather, { pos: [s * 0.08, 0.14, dz + 0.03] }); // shin guard
  }

  // ---- torso (team tunic over light armour) ------------------------------------------------
  cyl(g, 0.16, 0.135, 0.3, teamCloth, { pos: [0, 0.47, 0] }, 12);
  cyl(g, 0.14, 0.19, 0.13, teamDark, { pos: [0, 0.29, 0] }, 12); // tunic skirt
  cyl(g, 0.145, 0.145, 0.04, leatherDark, { pos: [0, 0.35, 0] }, 12); // belt
  box(g, [0.05, 0.05, 0.03], gold, { pos: [0, 0.35, 0.145] });
  if (L >= 2) sphere(g, [0.14, 0.12, 0.09], steel, { pos: [0, 0.52, 0.05] }); // chest plate
  // leather cross-strap
  limb(g, [-0.15, 0.6, 0.03], [0.1, 0.38, 0.14], 0.022, 0.022, leatherDark, 6);
  // scarf
  torus(g, 0.125, 0.04, L === 3 ? teamCloth : teamDark, { pos: [0, 0.64, 0.0], rot: [Math.PI / 2, 0, 0] }, [4, 12]);
  // scarf tails
  box(g, [0.07, 0.2, 0.02], teamDark, { pos: [0.07, 0.52, -0.14], rot: [0.25, 0, -0.1] });
  if (L >= 2) box(g, [0.07, 0.26, 0.02], teamCloth, { pos: [-0.04, 0.48, -0.15], rot: [0.2, 0, 0.08] });

  // ---- head -------------------------------------------------------------------------------
  const hy = 0.77;
  sphere(g, [0.14, 0.14, 0.13], skin, { pos: [0, hy - 0.01, 0.0] });
  for (const s of [-1, 1]) sphere(g, 0.016, matte(C.dark, 0.5), { pos: [s * 0.055, hy - 0.015, 0.125] }); // eyes
  for (const s of [-1, 1]) box(g, [0.045, 0.012, 0.012], matte(C.leatherDark), { pos: [s * 0.055, hy + 0.02, 0.128], rot: [0, 0, s * -0.25] }); // brows
  // helmet cap + rim
  const helmet = L === 3 ? steelLight : steel;
  dome(g, [0.158, 0.14, 0.15], helmet, { pos: [0, hy + 0.01, 0] }, [14, 6]);
  torus(g, 0.155, 0.014, L >= 2 ? gold : steelDark, { pos: [0, hy + 0.012, 0], rot: [Math.PI / 2, 0, 0] }, [4, 14]);
  box(g, [0.028, 0.1, 0.02], steelDark, { pos: [0, hy - 0.04, 0.142] }); // nose guard
  if (L >= 2) for (const s of [-1, 1]) box(g, [0.02, 0.07, 0.09], steelDark, { pos: [s * 0.15, hy - 0.04, 0.02] }); // cheek guards

  if (L >= 2) {
    const h = L === 2 ? 0.05 : 0.11;
    extrude(g, `walk-crest-${L}`, () => crestShape(h), L === 2 ? 0.05 : 0.07, teamCloth, {
      pos: [0, hy + 0.12, 0],
      rot: [0, -Math.PI / 2, 0],
    }, 0.008);
  }
  if (L === 3) {
    for (const s of [-1, 1]) {
      cone(g, 0.022, 0.15, gold, { pos: [s * 0.15, hy + 0.1, 0.0], rot: [0, 0, -s * 0.75] }, 5); // horns-of-light
    }
  }

  // ---- arms -------------------------------------------------------------------------------
  const spA: [number, number, number] = [-0.28, 0.0, -0.08];
  const spLen = [0.82, 0.9, 0.96][L - 1];
  const dirv = new THREE.Vector3(0.04, 1, 0.3).normalize();
  const spB: [number, number, number] = [spA[0] + dirv.x * spLen, spA[1] + dirv.y * spLen, spA[2] + dirv.z * spLen];
  const hand: [number, number, number] = [spA[0] + dirv.x * 0.46, spA[1] + dirv.y * 0.46, spA[2] + dirv.z * 0.46];
  limb(g, [-0.18, 0.58, 0], [-0.26, 0.5, 0.05], 0.05, 0.045, teamDark);
  limb(g, [-0.26, 0.5, 0.05], [hand[0], hand[1], hand[2]], 0.045, 0.045, leather);
  sphere(g, 0.052, skin, { pos: hand });
  // shoulder pad(s)
  sphere(g, [0.09, 0.07, 0.09], L === 1 ? leather : L === 2 ? steel : gold, { pos: [-0.2, 0.6, 0] });
  sphere(g, [0.09, 0.07, 0.09], L === 1 ? leather : L === 2 ? steel : gold, { pos: [0.2, 0.6, 0] });

  // ---- spear ------------------------------------------------------------------------------
  const [sp] = axis(g, spA, spB);
  const shaft = matte(C.woodDark, 0.8);
  cyl(sp, 0.018, 0.018, spLen, shaft, { pos: [0, spLen / 2, 0] }, 6);
  cyl(sp, 0.026, 0.026, 0.05, steelDark, { pos: [0, 0.01, 0] }, 6); // butt cap
  const headLen = [0.15, 0.2, 0.26][L - 1];
  const spearMat = L === 3 ? glow(team.light, 1.3) : L === 2 ? metal(C.steelLight, 0.22) : metal(C.steel, 0.3);
  cyl(sp, 0.026, 0.026, 0.05, L >= 2 ? gold : steelDark, { pos: [0, spLen - 0.02, 0] }, 6);
  cone(sp, 0.052, headLen, spearMat, { pos: [0, spLen + headLen / 2 - 0.0, 0], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.4] }, 4);
  if (L === 3) cone(sp, 0.08, headLen * 1.1, aura(team.glow, 0.28), { pos: [0, spLen + headLen / 2, 0], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.5] }, 4);
  if (L >= 2) {
    // pennant (flows outward and back)
    extrude(sp, `walk-pennant-${L}`, () => polygon([[0, 0], [-0.2 - (L - 2) * 0.06, -0.035], [-0.16, -0.075], [-0.2 - (L - 2) * 0.06, -0.12], [0, -0.1]]), 0.012, teamCloth, {
      pos: [-0.016, spLen - 0.06, 0],
    }, 0.003);
  }

  // ---- tower shield -----------------------------------------------------------------------
  const W = [0.42, 0.46, 0.5][L - 1];
  const H = [0.5, 0.54, 0.6][L - 1];
  const sh = new THREE.Group();
  sh.position.set(0.02, 0.06, 0.2);
  sh.rotation.set(-0.05, 0.0, 0);
  g.add(sh);
  const rimMat = L === 3 ? gold : L === 2 ? steelLight : steelDark;
  const faceMat = L === 1 ? matte(C.wood, 0.85) : L === 2 ? metal('#8F9AAE', 0.4) : metal('#6F7C95', 0.35);
  extrude(sh, `walk-shield-rim-${L}`, () => shieldShape(W, H, 1), 0.05, rimMat, {}, 0.008);
  extrude(sh, `walk-shield-face-${L}`, () => shieldShape(W, H, 0.84), 0.04, faceMat, { pos: [0, 0, 0.022] }, 0.006);
  if (L === 1) {
    // wooden planks
    for (const x of [-W * 0.16, W * 0.16]) box(sh, [0.012, H * 0.78, 0.012], matte(C.woodDark), { pos: [x, H * 0.5, 0.058] });
  }
  // team chevron emblem
  const eMat = L === 3 ? glow(team.glow, 1.6) : teamCloth;
  extrude(sh, 'walk-chev', () => chevron(W * 0.3, 0.07), 0.016, eMat, { pos: [0, H * 0.52, 0.056] }, 0.003);
  if (L >= 2) extrude(sh, 'walk-chev2', () => chevron(W * 0.3, 0.05), 0.016, eMat, { pos: [0, H * 0.34, 0.056] }, 0.003);
  // boss
  sphere(sh, [0.06, 0.06, 0.04], L === 1 ? steel : gold, { pos: [0, H * 0.7, 0.062] });
  if (L === 3) {
    cone(sh, 0.035, 0.14, gold, { pos: [0, H * 1.04 + 0.06, 0.0] }, 5);
    for (const s of [-1, 1]) cone(sh, 0.025, 0.08, gold, { pos: [s * W * 0.5, H * 0.86, 0.0], rot: [0, 0, -s * 0.5] }, 5);
    // shield glow
    extrude(sh, `walk-shield-glow`, () => shieldShape(W, H, 1.12), 0.01, aura(team.glow, 0.22), { pos: [0, 0, -0.01] }, 0);
  }

  // ---- cape & aura (Lv3) ------------------------------------------------------------------
  if (L === 3) {
    extrude(g, 'walk-cape', () => polygon([[-0.16, 0], [0.16, 0], [0.22, -0.46], [0.08, -0.4], [0, -0.5], [-0.08, -0.4], [-0.22, -0.46]]), 0.025, teamDark, {
      pos: [0, 0.62, -0.14],
      rot: [0.15, 0, 0],
    });
    groundRing(g, 0.46, 0.018, aura(team.glow, 0.85), 0.03);
    groundRing(g, 0.37, 0.01, aura(C.gold, 0.55), 0.032);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.3;
      box(g, [0.028, 0.028, 0.028], glow(team.glow, 1.8), { pos: [Math.cos(a) * 0.41, 0.15 + (i % 2) * 0.4, Math.sin(a) * 0.41], rot: [0.6, 0.6 + i, 0.3] });
    }
  }
}
