/**
 * INSANER - the imp. Small devil kid: horns, pointed flame tail, manic grin, trident.
 *  Lv1: crimson skin, rag loincloth, small horns, crooked trident, green eyes.
 *  Lv2: longer horns, bone mask on the forehead, jester coat, twin daggers.
 *  Lv3: horn crown, flame cape, glowing cracks, orbiting weapon shards, aura ring.
 */
import * as THREE from 'three';
import { aura, box, cloth, cone, cyl, glow, groundRing, limb, matte, metal, sphere, taperedTube, torus, type BuildCtx } from './kit';

export function buildInsaner(g: THREE.Group, { level: L, team }: BuildCtx): void {
  const skin = matte(L === 3 ? '#4A0C2E' : L === 2 ? '#7A1238' : '#8E1E3A', 0.7, false);
  const horn = metal('#1C1020', 0.6);
  const eye = glow('#9CFF3A', 1.6);
  const teeth = matte('#F4ECD6', 0.5);
  const rag = cloth(L === 1 ? '#4A3A3A' : L === 2 ? team.main : '#2A0C3E');
  const violet = glow(L === 3 ? '#FF3DF0' : '#C85CFF', 1.4);
  const wood = cloth('#3A2230');

  // ---- legs + hooves --------------------------------------------------------------------------
  for (const s of [-1, 1] as const) {
    limb(g, [s * 0.07, 0.08, 0], [s * 0.07, 0.3, 0], 0.045, 0.055, skin);
    box(g, [0.09, 0.08, 0.12], horn, { pos: [s * 0.07, 0.04, 0.02] });
  }
  // ---- body (pot belly) + loincloth / coat -----------------------------------------------------
  sphere(g, [0.16, 0.19, 0.15], skin, { pos: [0, 0.45, 0] });
  cyl(g, 0.15, 0.2, L === 2 ? 0.22 : 0.14, rag, { pos: [0, L === 2 ? 0.26 : 0.3, 0] }, 8);
  if (L === 2) torus(g, 0.16, 0.025, metal('#8A8A96', 0.4), { pos: [0, 0.58, 0], rot: [Math.PI / 2, 0, 0] }, [4, 12]);
  // ---- arms -----------------------------------------------------------------------------------
  for (const s of [-1, 1] as const) {
    limb(g, [s * 0.15, 0.55, 0], [s * 0.26, 0.36, 0.08], 0.04, 0.035, skin);
    sphere(g, 0.05, skin, { pos: [s * 0.27, 0.34, 0.09] });
  }
  // ---- tail with flame tip --------------------------------------------------------------------
  taperedTube(g, 'imp-tail', [[0, 0.32, -0.12], [0.05, 0.2, -0.3], [0.2, 0.3, -0.4], [0.3, 0.5, -0.38]], [0.035, 0.03, 0.022, 0.012], skin);
  cone(g, 0.04, 0.12, violet, { pos: [0.31, 0.57, -0.38] }, 5);
  // ---- head: big, grin, eyes, horns -----------------------------------------------------------
  const hy = 0.84;
  sphere(g, [0.19, 0.17, 0.17], skin, { pos: [0, hy, 0] });
  for (const s of [-1, 1] as const) sphere(g, [0.035, 0.045, 0.02], eye, { pos: [s * 0.075, hy + 0.02, 0.16] });
  box(g, [0.2, 0.03, 0.02], teeth, { pos: [0, hy - 0.07, 0.165], rot: [0.2, 0, 0] });
  for (const s of [-1, 1] as const) cone(g, 0.015, 0.04, teeth, { pos: [s * 0.07, hy - 0.1, 0.165], rot: [Math.PI, 0, 0] }, 4);
  const hornN = L === 3 ? 5 : 2;
  for (let i = 0; i < hornN; i++) {
    const s = hornN === 2 ? (i === 0 ? -1 : 1) : (i - 2) / 2;
    const len = L === 1 ? 0.12 : L === 2 ? 0.2 : 0.28 - Math.abs(s) * 0.1;
    const x = s * (hornN === 2 ? 0.12 : 0.15);
    cone(g, 0.035, len, horn, { pos: [x, hy + 0.15 + len / 2, -0.02], rot: [-0.3, 0, -s * 0.5] }, 6);
  }
  if (L === 2) sphere(g, [0.12, 0.09, 0.07], matte('#E8DCC0', 0.6), { pos: [0, hy + 0.14, 0.1], rot: [-0.6, 0, 0] });
  // ---- weapon ----------------------------------------------------------------------------------
  if (L === 1) {
    limb(g, [0.3, 0.1, 0.1], [0.34, 0.95, 0.1], 0.015, 0.012, wood);
    for (const dx of [-0.05, 0, 0.05]) cone(g, 0.012, 0.12, horn, { pos: [0.34 + dx, 1.0, 0.1] }, 4);
  } else {
    for (const s of [-1, 1] as const) box(g, [0.03, 0.22, 0.015], L === 3 ? violet : metal('#2A2030', 0.4), { pos: [s * 0.3, 0.42, 0.14], rot: [0.4, 0, s * 0.3] });
  }
  if (L === 3) {
    // Flame cape + orbiting shards + aura.
    box(g, [0.36, 0.5, 0.02], glow('#9A1BFF', 0.9), { pos: [0, 0.42, -0.17], rot: [0.12, 0, 0] });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      box(g, [0.04, 0.18, 0.02], violet, { pos: [Math.cos(a) * 0.42, 0.6, Math.sin(a) * 0.42], rot: [0, -a, 0.3] });
    }
    groundRing(g, 0.5, 0.025, aura('#FF3DF0', 0.5), 0.015);
  }
}
