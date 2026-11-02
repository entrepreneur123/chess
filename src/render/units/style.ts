/**
 * Vertex styles of the unit geometry (see material.ts for how the shader reads them).
 * A colour is an sRGB hex string or a team tone token; team tones are resolved in the shader from
 * uniforms, so one geometry serves both teams.
 */
import * as THREE from 'three';
import { MODE } from './material';

export type TeamTone = 'team' | 'teamLight' | 'teamDark' | 'teamMuted' | 'teamDeep';
export type Tint = string | TeamTone;
export const TEAM_TONES: TeamTone[] = ['team', 'teamLight', 'teamDark', 'teamMuted', 'teamDeep'];

export interface Style {
  color: Tint;
  /** Emissive strength (0..3). */
  glow?: number;
  /** Metal look (0..1). */
  metal?: number;
  /** material.ts PATTERN id. */
  pattern?: number;
  /** Texture use: 0 flat (default), 1 texture x colour, 2 texture luminance x colour. */
  tex?: 0 | 1 | 2;
  /** Brightness multiplier of a team tone (default 1). */
  shade?: number;
}

export interface Resolved {
  glow: number;
  metal: number;
  pattern: number;
  mode: number;
}

const cache = new Map<string, THREE.Color>();
const resolved: Resolved = { glow: 0, metal: 0, pattern: 0, mode: 0 };

/** Linear vertex colour into `out` + effect data (shared object, copy before keeping). */
export function resolveStyle(s: Style, out: THREE.Color): Resolved {
  const tone = TEAM_TONES.indexOf(s.color as TeamTone);
  if (tone >= 0) {
    const k = s.shade ?? 1;
    out.setRGB(k, k, k);
    resolved.mode = MODE.team + tone;
  } else {
    let c = cache.get(s.color);
    if (!c) {
      c = new THREE.Color(s.color);
      cache.set(s.color, c);
    }
    out.copy(c);
    resolved.mode = s.tex ?? MODE.flat;
  }
  resolved.glow = s.glow ?? 0;
  resolved.metal = s.metal ?? 0;
  resolved.pattern = s.pattern ?? 0;
  return resolved;
}
