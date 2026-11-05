import type { CharacterId, GameState, HistoryEntry, Level, Move, Piece, PlayerId, Pos } from '../src/engine';

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
    waste: [],
    skillsUsed: [0, 0],
    ...extra,
  };
}

/** The same state with `pieceId`'s skill marked as used this match (skills are tracked per piece). */
export function spendSkill(state: GameState, pieceId: string): GameState {
  const owner = state.pieces.find((p) => p.id === pieceId)?.owner ?? 0;
  const used: [number, number] = [state.skillsUsed[0], state.skillsUsed[1]];
  used[owner] += 1;
  return { ...state, skillsUsed: used, pieces: state.pieces.map((p) => (p.id === pieceId ? { ...p, skillUsed: true as const } : p)) };
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

/**
 * Plies that were NOT a turn change: a level-3 Insaner's chain moves (an action of the same player
 * right after its capturing move). Every other ply hands the turn over, which the storm bounds.
 */
export function chainPlies(history: readonly HistoryEntry[]): number {
  let n = 0;
  let prev: PlayerId | null = null;
  for (const e of history) {
    if (e.kind === 'storm') continue;
    if (prev !== null && e.player === prev) n++;
    prev = e.player;
  }
  return n;
}

/**
 * Comparable signature of what a piece has absorbed, shared by the engine / FastBoard parity tests.
 * A FastBoard absorb mask keeps the HIGHEST level per character (every pattern contains the lower
 * levels of the same character), and nothing at or below the holder's own pattern; the engine keeps
 * every absorbed entry. Both reduce to the same set of reachable squares, so both are normalised
 * here: highest level per character, without the holder's own character at or below its level.
 */
export function absorbSig(levels: Iterable<[CharacterId, number]>, holder: CharacterId, holderLevel: number): string {
  const best = new Map<CharacterId, number>();
  for (const [ch, lvl] of levels) if (lvl > (best.get(ch) ?? 0)) best.set(ch, lvl);
  const out: string[] = [];
  for (const [ch, lvl] of best) if (!(ch === holder && lvl <= holderLevel)) out.push(ch + lvl);
  return out.sort().join();
}
