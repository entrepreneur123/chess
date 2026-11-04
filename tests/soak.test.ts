/**
 * Soak tests (mid-match freeze investigation). Fixed seeds, modest sizes: they stay in the suite.
 *
 *  1. Engine: full bot-vs-bot games through the worker's entry point (`chooseAction` on a
 *     structured-cloned state, as postMessage delivers it), every difficulty, random squads from
 *     all 8 characters, random grades and all-3성 games. Every action must be legal, every game must
 *     end within MAX_MATCH_PLIES (+ chain moves), skills must be cast along the way.
 *  2. Controller: full matches through GameController with a bot on BOTH sides (the human side
 *     plays through the controller's public input API), against hostile ports: animations that
 *     hang forever, reject or throw, and UI listeners that throw. The match must always finish.
 */
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, chooseAction, fallbackAction, isSkillAction, type BotAction, type Difficulty } from '../src/ai/bot';
import {
  CHARACTER_IDS,
  MAX_MATCH_PLIES,
  STORM_ROWS_FROM,
  applyMove,
  applySkill,
  createGame,
  fastFromState,
  fastGenMoves,
  fastImmobile,
  getLegalMoves,
  inStorm,
  isLegalMove,
  isLegalSkill,
  randomFormation,
  skillAnchors,
} from '../src/engine';
import type { CharacterId, Formation, GameState, Level, Move } from '../src/engine';
import { SKILL_FLAG } from '../src/engine/fast';
import { ANIMATION_WATCHDOG_MS, GameController, type ControllerPorts } from '../src/ui/game/GameController';
import { chainPlies, rngFrom } from './helpers';

function randomSquad(rng: () => number, must?: CharacterId): CharacterId[] {
  const pool = CHARACTER_IDS.filter((c) => c !== must);
  const out: CharacterId[] = must ? [must] : [];
  while (out.length < 3) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

function randomGrades(rng: () => number, all3: boolean): Partial<Record<CharacterId, Level>> {
  const o: Partial<Record<CharacterId, Level>> = {};
  for (const id of CHARACTER_IDS) o[id] = all3 ? 3 : ((1 + Math.floor(rng() * 3)) as Level);
  return o;
}

/** Game `i` of a soak: squads always cover the skill characters and the recently changed ones. */
function formations(rng: () => number, i: number): [Formation, Formation] {
  const focus: CharacterId[] = ['rakaeli', 'brutile', 'marki', 'insaner', 'michelle', 'picker'];
  const all3 = i % 4 === 0;
  return [
    randomFormation(rng, randomGrades(rng, all3), randomSquad(rng, focus[i % focus.length])),
    randomFormation(rng, randomGrades(rng, all3), randomSquad(rng, focus[(i + 3) % focus.length])),
  ];
}

const isLegal = (s: GameState, a: BotAction): boolean => (isSkillAction(a) ? isLegalSkill(s, a) : isLegalMove(s, a));

describe('soak: bot self-play through the worker entry point', () => {
  it('plays 96 full games at every difficulty: legal actions, bounded length, skills cast', () => {
    const rng = rngFrom(20261104);
    const buf = new Int32Array(256);
    const stats = { waste: 0, transform: 0, storms: 0, rowStorms: 0, reasons: {} as Record<string, number> };
    for (let i = 0; i < 96; i++) {
      const [f0, f1] = formations(rng, i);
      let g = createGame(f0, f1, (i % 2) as 0 | 1);
      const diff: [Difficulty, Difficulty] = [DIFFICULTIES[i % 4], DIFFICULTIES[(i >> 2) % 4]];
      let guard = 0;
      while (g.status === 'playing') {
        expect(++guard, `game ${i} runs away`).toBeLessThan(2 * MAX_MATCH_PLIES);
        const legal = getLegalMoves(g);
        // The engine never leaves a side to move with nothing to play (it passes for it).
        expect(legal.length > 0 || g.pieces.some((p) => p.owner === g.turn && skillAnchors(g, p.id).length > 0), `game ${i} stuck`).toBe(true);
        // FastBoard (the bot's search) generates exactly the engine's moves.
        const b = fastFromState(g);
        let n = 0;
        const end = fastGenMoves(b, b.turn, buf);
        for (let k = 0; k < end; k++) if (!(buf[k] & SKILL_FLAG)) n++;
        expect(n, `game ${i} ply ${g.ply}: fast/engine move count`).toBe(legal.length);
        // A side boxed in by the storm has already lost: the engine never hands it the move, and
        // the fast board (the bot's search) agrees.
        expect(fastImmobile(b), `game ${i} ply ${g.ply}: storm-locked side to move`).toBe(false);
        if (g.ply % 3 === 0) {
          const fb = fallbackAction(g);
          expect(fb && isLegal(g, fb), `game ${i} ply ${g.ply}: fallback`).toBe(true);
        }
        // What the worker does: chooseAction on the structured clone postMessage delivers.
        const a = chooseAction(structuredClone(g), diff[g.turn], { timeBudgetMs: 2, rng });
        expect(a, `game ${i} ply ${g.ply}: no action`).not.toBeNull();
        expect(isLegal(g, a!), `game ${i} ply ${g.ply}: illegal ${JSON.stringify(a)}`).toBe(true);
        const before = g.history.length;
        g = isSkillAction(a) ? applySkill(g, a) : applyMove(g, a as Move);
        for (const e of g.history.slice(before)) {
          if (e.kind === 'skill' && e.transform) stats.transform++;
          else if (e.kind === 'skill') stats.waste++;
          else if (e.kind === 'storm') {
            stats.storms++;
            if (e.storm >= STORM_ROWS_FROM) stats.rowStorms++;
          }
        }
        // Nothing ever stands in the storm (columns, and rows from step 3).
        for (const p of g.pieces) expect(inStorm(p.pos.r, p.pos.c, g.storm), `game ${i}: ${p.id} in the storm`).toBe(false);
      }
      expect(g.ply - chainPlies(g.history), `game ${i} too long`).toBeLessThanOrEqual(MAX_MATCH_PLIES);
      stats.reasons[g.endReason!] = (stats.reasons[g.endReason!] ?? 0) + 1;
      // Once the storm has closed in, a side without a move loses: no stalemate (and no 'noMoves'
      // pass) is left for it.
      if (g.storm >= 1) expect(g.endReason, `game ${i}`).not.toBe('stalemate');
      if (g.endReason === 'immobile') expect(g.winner).not.toBe(g.turn);
      if (g.endReason === 'storm' && g.pieces.length === 0) {
        // A double wipe is decided by piece count (equal = draw).
        const last = [...g.history].reverse().find((e) => e.kind === 'storm');
        const n0 = last?.kind === 'storm' ? last.killed.filter((id) => id.startsWith('p0-')).length : 0;
        const n1 = last?.kind === 'storm' ? last.killed.length - n0 : 0;
        expect(g.winner).toBe(n0 > n1 ? 0 : n1 > n0 ? 1 : null);
      }
      for (let k = 1; k < g.history.length; k++) {
        const e = g.history[k];
        if (e.kind !== 'pass' || e.reason !== 'noMoves') continue;
        // The storm step in force when that pass was played.
        let storm = 0;
        for (let q = 0; q < k; q++) {
          const x = g.history[q];
          if (x.kind === 'storm') storm = x.storm;
        }
        expect(storm, `game ${i}: a noMoves pass after the storm closed in`).toBe(0);
      }
    }
    expect(stats.waste).toBeGreaterThan(0);
    expect(stats.transform).toBeGreaterThan(0);
    expect(stats.storms).toBeGreaterThan(0);
    // The storm reaches its row steps (top / bottom rows) in some of these games.
    expect(stats.rowStorms).toBeGreaterThan(0);
    expect(stats.reasons.timeoutForfeit ?? 0).toBe(0);
  }, 120_000);
});

/** A GameController on virtual time with hostile ports. */
function hostileMatch(seed: number, i: number) {
  const rng = rngFrom(seed);
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const setTimer = (fn: () => void, ms: number) => {
    const id = nextId++;
    timers.set(id, { at: t + ms, fn });
    return id;
  };
  const stats = { hung: 0, rejected: 0, thrown: 0, listenerThrows: 0, skills: 0 };
  /** 80%: finishes after 300-1500 ms; else hangs forever, rejects or throws synchronously. */
  const animation = (): Promise<void> => {
    const x = rng();
    if (x < 0.08) {
      stats.hung++;
      return new Promise<void>(() => undefined);
    }
    if (x < 0.14) {
      stats.rejected++;
      return Promise.reject(new Error('fx failed'));
    }
    if (x < 0.2) {
      stats.thrown++;
      throw new Error('fx threw');
    }
    return new Promise<void>((r) => setTimer(r, 300 + rng() * 1200));
  };
  const diff = DIFFICULTIES[i % 4];
  const ports: ControllerPorts = {
    requestBotMove: (s) => Promise.resolve(chooseAction(structuredClone(s), diff, { timeBudgetMs: 2, rng })),
    animate: animation,
    animateSkill: animation,
    botThinkDelayMs: () => 500 + rng() * 400,
    now: () => t,
    setTimer,
    clearTimer: (id) => void timers.delete(id as number),
  };
  const [f0, f1] = formations(rng, i);
  const ctrl = new GameController(createGame(f0, f1, (i % 2) as 0 | 1), ports);
  // A UI listener that sometimes throws (a broken toast / FX / sound path).
  ctrl.on(() => {
    if (rng() < 0.1) {
      stats.listenerThrows++;
      throw new Error('ui bug');
    }
  });
  const flush = async () => {
    for (let k = 0; k < 10; k++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    const end = t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
      await flush();
    }
    t = end;
    await flush();
  };
  /** The human side: a bot playing through the controller's input API (taps, skills, chain skip). */
  const humanAct = () => {
    const s = ctrl.state;
    if (s.bonusPieceId !== null && rng() < 0.2) {
      ctrl.skipBonus();
      return;
    }
    const a = chooseAction(s, 'easy', { timeBudgetMs: 2, rng });
    if (!a) return;
    if (isSkillAction(a)) {
      stats.skills++;
      expect(ctrl.trySkill(a)).toBe(true);
    } else if (rng() < 0.5) {
      ctrl.tapCell(a.from);
      ctrl.tapCell(a.to);
    } else expect(ctrl.tryHumanMove(a)).toBe(true);
  };
  return { ctrl, stats, advance, humanAct, now: () => t };
}

describe('soak: full matches through GameController with hostile ports', () => {
  it('24 matches always finish: hung / failing animations and throwing listeners never lock the match', async () => {
    const err = console.error;
    const warn = console.warn;
    console.error = () => undefined;
    console.warn = () => undefined;
    const totals = { hung: 0, rejected: 0, thrown: 0, listenerThrows: 0, skills: 0 };
    try {
      for (let i = 0; i < 24; i++) {
        const m = hostileMatch(777 + i, i);
        m.ctrl.start();
        let lastPly = -1;
        let idleSince = 0;
        while (m.ctrl.phase !== 'ended') {
          if (m.ctrl.phase === 'humanTurn') m.humanAct();
          await m.advance(250);
          const ply = m.ctrl.state.history.length;
          if (ply !== lastPly) {
            lastPly = ply;
            idleSince = m.now();
          }
          // Nothing may sit still longer than the watchdog plus the bot's think time.
          expect(m.now() - idleSince, `match ${i} stalled in ${m.ctrl.phase} at ply ${m.ctrl.state.ply}`).toBeLessThan(ANIMATION_WATCHDOG_MS + 5_000);
        }
        const s = m.ctrl.state;
        expect(s.status).toBe('ended');
        expect(s.endReason).not.toBe('timeoutForfeit');
        expect(s.ply - chainPlies(s.history)).toBeLessThanOrEqual(MAX_MATCH_PLIES);
        for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += m.stats[k];
        m.ctrl.dispose();
      }
    } finally {
      console.error = err;
      console.warn = warn;
    }
    expect(totals.hung).toBeGreaterThan(0);
    expect(totals.rejected + totals.thrown).toBeGreaterThan(0);
    expect(totals.listenerThrows).toBeGreaterThan(0);
    expect(totals.skills).toBeGreaterThan(0);
  }, 120_000);
});
