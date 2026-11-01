/**
 * SAD - the paladin. Armoured, sturdy, plume + sword silhouette.
 *  Lv1: steel armour, short plume, plain longsword, simple cape.
 *  Lv2: pauldrons with spikes, gold trim, taller plume, broadsword, tabard emblem.
 *  Lv3: legendary - glowing blade, helmet wings, halo, crown spikes, aura ring, holy orb.
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
  extrude,
  glow,
  groundRing,
  limb,
  metal,
  polygon,
  sphere,
  torus,
  type BuildCtx,
} from './kit';

function plumeShape(h: number): THREE.Shape {
  // Drawn in (forward, up); the mesh is rotated so +x becomes +z.
  const s = new THREE.Shape();
  s.moveTo(0.1, 0);
  s.quadraticCurveTo(0.13, 0.08 + h * 0.5, 0.03, 0.12 + h);
  s.quadraticCurveTo(-0.1, 0.13 + h, -0.2, 0.05 + h * 0.2);
  s.quadraticCurveTo(-0.24, -0.02, -0.18, -0.06);
  s.lineTo(-0.1, 0);
  s.closePath();
  return s;
}

function capeShape(len: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.17, 0);
  s.lineTo(0.17, 0);
  s.lineTo(0.24, -len * 0.9);
  s.lineTo(0.14, -len);
  s.lineTo(0.0, -len * 0.9);
  s.lineTo(-0.14, -len);
  s.lineTo(-0.24, -len * 0.9);
  s.closePath();
  return s;
}

function wingShape(): THREE.Shape {
  return polygon([
    [0, 0],
    [0.12, 0.02],
    [0.24, 0.1],
    [0.3, 0.22],
    [0.2, 0.2],
    [0.24, 0.32],
    [0.14, 0.26],
    [0.13, 0.38],
    [0.05, 0.26],
    [0, 0.14],
  ]);
}

export function buildSad(g: THREE.Group, { level: L, team }: BuildCtx): void {
  const steel = metal(C.steel);
  const steelLight = metal(C.steelLight, 0.3);
  const steelDark = metal(C.steelDark, 0.42);
  const iron = metal(C.iron, 0.5);
  const gold = metal(C.gold, 0.28);
  const trim = L >= 2 ? gold : steelDark;
  const teamCloth = cloth(team.main);
  const teamDark = cloth(team.dark);
  const holy = glow(team.glow, 1.5);
  const leather = cloth(C.leatherDark);

  // ---- legs & boots -----------------------------------------------------------------------
  for (const s of [-1, 1]) {
    limb(g, [s * 0.085, 0.1, 0.01], [s * 0.085, 0.34, 0], 0.062, 0.07, steelDark);
    box(g, [0.13, 0.1, 0.22], steel, { pos: [s * 0.085, 0.05, 0.035] });
    box(g, [0.13, 0.04, 0.07], trim, { pos: [s * 0.085, 0.1, 0.09] }); // knee/toe cap
  }

  // ---- torso ------------------------------------------------------------------------------
  cyl(g, 0.165, 0.14, 0.3, steel, { pos: [0, 0.48, 0] }, 12);
  sphere(g, [0.15, 0.13, 0.1], steelLight, { pos: [0, 0.52, 0.07] }); // breastplate
  cyl(g, 0.15, 0.15, 0.045, L >= 2 ? gold : leather, { pos: [0, 0.35, 0] }, 12); // belt
  box(g, [0.06, 0.06, 0.03], gold, { pos: [0, 0.35, 0.15] }); // buckle

  // tabard (team colour) with swallow-tail hem
  extrude(
    g,
    L >= 2 ? 'sad-tabard-2' : 'sad-tabard-1',
    () =>
      L >= 2
        ? polygon([[-0.085, 0], [0.085, 0], [0.12, -0.22], [0, -0.17], [-0.12, -0.22]])
        : polygon([[-0.08, 0], [0.08, 0], [0.1, -0.18], [-0.1, -0.18]]),
    0.02,
    teamCloth,
    { pos: [0, 0.34, 0.15] },
    0.004,
  );
  if (L >= 2) box(g, [0.025, 0.2, 0.012], gold, { pos: [0, 0.24, 0.17] });
  // emblem on the chest (diamond)
  box(g, [0.075, 0.075, 0.016], L >= 2 ? teamCloth : teamDark, { pos: [0, 0.54, 0.168], rot: [0, 0, Math.PI / 4] });
  if (L === 3) box(g, [0.04, 0.04, 0.02], holy, { pos: [0, 0.54, 0.172], rot: [0, 0, Math.PI / 4] });

  // ---- cape -------------------------------------------------------------------------------
  const capeLen = [0.4, 0.46, 0.54][L - 1];
  extrude(g, `sad-cape-${L}`, () => capeShape(capeLen), 0.03, L === 3 ? teamCloth : teamDark, {
    pos: [0, 0.63, -0.15],
    rot: [0.16, 0, 0],
  });
  if (L >= 2) {
    box(g, [0.5, 0.02, 0.045], gold, { pos: [0, 0.63 - capeLen * 0.93, -0.15 - capeLen * 0.15], rot: [0.16, 0, 0] });
  }
  box(g, [0.36, 0.045, 0.08], steelDark, { pos: [0, 0.62, -0.1] }); // cape collar

  // ---- shoulders & arms -------------------------------------------------------------------
  const padR = [0.085, 0.105, 0.115][L - 1];
  for (const s of [-1, 1]) {
    sphere(g, [padR, padR * 0.78, padR], L === 3 ? steelLight : steel, { pos: [s * 0.2, 0.6, 0] });
    if (L >= 2) {
      torus(g, padR * 0.88, 0.014, gold, { pos: [s * 0.2, 0.575, 0], rot: [Math.PI / 2, 0, 0] }, [4, 14]);
      cone(g, 0.032, 0.09, L === 3 ? gold : steelLight, { pos: [s * (0.2 + padR * 0.5), 0.665, 0], rot: [0, 0, -s * 0.7] }, 6);
    }
  }
  // left arm (character's left = +x): relaxed, fist; Lv3 holds a holy orb
  limb(g, [0.19, 0.57, 0], [0.25, 0.42, 0.06], 0.052, 0.046, steelDark);
  sphere(g, 0.058, steel, { pos: [0.26, 0.38, 0.08] });
  if (L === 3) {
    sphere(g, 0.05, holy, { pos: [0.27, 0.5, 0.11] });
    torus(g, 0.075, 0.008, gold, { pos: [0.27, 0.5, 0.11], rot: [0.9, 0.3, 0] }, [4, 16]);
  }

  // right arm (-x): holds the sword upright
  const hand: [number, number, number] = [-0.29, 0.42, 0.12];
  limb(g, [-0.19, 0.57, 0], [-0.25, 0.46, 0.1], 0.052, 0.046, steelDark);
  limb(g, [-0.25, 0.46, 0.1], hand, 0.046, 0.05, steel);

  // ---- sword ------------------------------------------------------------------------------
  const bladeLen = [0.42, 0.5, 0.62][L - 1];
  const bladeW = [0.065, 0.085, 0.11][L - 1];
  const [sw] = axis(g, hand, [hand[0] - 0.22, hand[1] + 1, hand[2] + 0.05]);
  const blade = L === 3 ? glow(team.light, 1.1) : L === 2 ? metal(C.steelLight, 0.22) : metal(C.steel, 0.3);
  cyl(sw, 0.02, 0.02, 0.15, leather, { pos: [0, 0, 0] }, 8); // grip
  sphere(sw, 0.032, gold, { pos: [0, -0.085, 0] }); // pommel
  const guardW = [0.17, 0.23, 0.3][L - 1];
  box(sw, [guardW, 0.032, 0.04], L >= 2 ? gold : steelDark, { pos: [0, 0.085, 0] });
  if (L >= 2) {
    for (const s of [-1, 1]) cone(sw, 0.026, 0.05, gold, { pos: [s * (guardW / 2 + 0.01), 0.09, 0], rot: [0, 0, -s * Math.PI / 2] }, 5);
  }
  const by = 0.1 + bladeLen / 2;
  box(sw, [bladeW, bladeLen, 0.026], blade, { pos: [0, by, 0] });
  cone(sw, bladeW * 0.72, 0.1, blade, { pos: [0, 0.1 + bladeLen + 0.05, 0], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.38] }, 4);
  box(sw, [bladeW * 0.28, bladeLen * 0.9, 0.032], L === 3 ? holy : steelDark, { pos: [0, by - 0.01, 0] }); // fuller
  if (L === 3) {
    // soft glow sheath hugging the blade
    box(sw, [bladeW * 1.25, bladeLen * 1.01, 0.04], aura(team.glow, 0.3), { pos: [0, by, 0] });
  }

  // ---- helmet -----------------------------------------------------------------------------
  const hy = 0.79;
  sphere(g, [0.16, 0.16, 0.155], L === 3 ? steelLight : steel, { pos: [0, hy, 0] });
  sphere(g, [0.115, 0.032, 0.06], iron, { pos: [0, hy - 0.005, 0.115] }); // visor slit
  sphere(g, [0.018, 0.075, 0.05], iron, { pos: [0, hy - 0.055, 0.125] }); // breath slit
  box(g, [0.05, 0.05, 0.02], steelDark, { pos: [0, hy - 0.115, 0.1] }); // chin guard
  // brow band + cheeks
  torus(g, 0.158, 0.012, trim, { pos: [0, hy + 0.025, 0], rot: [Math.PI / 2, 0, 0] }, [4, 14]);
  for (const s of [-1, 1]) box(g, [0.03, 0.09, 0.12], steelDark, { pos: [s * 0.15, hy - 0.04, 0.02], rot: [0, 0, s * 0.1] });

  // plume
  const plumeH = [0.04, 0.1, 0.15][L - 1];
  extrude(g, `sad-plume-${L}`, () => plumeShape(plumeH), L === 1 ? 0.055 : 0.07, teamCloth, {
    pos: [0, hy + 0.135, 0],
    rot: [0, -Math.PI / 2, 0],
  }, 0.01);
  if (L >= 2) {
    // plume holder
    box(g, [0.05, 0.03, 0.2], gold, { pos: [0, hy + 0.14, 0.0] });
  }
  if (L === 3) {
    // crown spikes + wings + halo
    for (let i = 0; i < 5; i++) {
      cone(g, 0.022, 0.09, gold, { pos: [(i - 2) * 0.052, hy + 0.14, 0.11 - Math.abs(i - 2) * 0.012] }, 5);
    }
    for (const s of [-1, 1]) {
      extrude(g, 'sad-wing', wingShape, 0.014, gold, {
        pos: [s * 0.15, hy - 0.02, -0.02],
        rot: [0.2, s * 0.55, s * -0.5],
        scale: [s, 1, 1],
      }, 0.004);
    }
    torus(g, 0.22, 0.014, glow(C.gold, 1.6), { pos: [0, hy + 0.02, -0.19], rot: [0.15, 0, 0] }, [4, 20]);
    // aura on the ground
    groundRing(g, 0.45, 0.018, aura(team.glow, 0.85), 0.03);
    groundRing(g, 0.36, 0.01, aura(C.gold, 0.6), 0.032);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      box(g, [0.03, 0.03, 0.03], glow(C.gold, 1.8), { pos: [Math.cos(a) * 0.4, 0.2 + (i % 2) * 0.35, Math.sin(a) * 0.4], rot: [0.6, 0.6 + i, 0.3] });
    }
  }
}
