import type { CharacterId, GameState, Level, Move, Piece, PlayerId, Pos } from '../src/engine';

export type Spec = [PlayerId, CharacterId, Level, number, number];

/** Build an arbitrary in-progress position (bypasses formation rules). */
export function makeState(specs: Spec[], turn: PlayerId = 0, extra: Partial<GameState> = {}): GameState {
  const pieces: Piece[] = specs.map(([owner, character, level, r, c]) => ({
    id: `p${owner}-${character}`,
    owner,
    character,
    level,
    pos: { r, c },
  }));
  return {
    pieces,
    turn,
    ply: 0,
    pliesSinceCapture: 0,
    consecutiveTimeouts: [0, 0],
    status: 'playing',
    winner: null,
    endReason: null,
    history: [],
    bonusPieceId: null,
    storm: 0,
    stormIn: null,
    ...extra,
  };
}

export const key = (p: Pos) => `${p.r},${p.c}`;
export const targetKeys = (moves: Move[]) => moves.map((m) => key(m.to)).sort();
export const keys = (ps: [number, number][]) => ps.map(([r, c]) => `${r},${c}`).sort();

/** Seeded PRNG (mulberry32). */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
