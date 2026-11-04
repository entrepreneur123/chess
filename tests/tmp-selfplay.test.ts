/**
 * TEMPORARY self-play harness (delete after use). Michelle's score in bot-vs-bot games: one side
 * fields Michelle plus two random others, the other side three random non-Michelle characters,
 * same grade for every piece of a game (cycling 1/2/3), sides and first player alternate.
 * Results go to SELFPLAY_OUT (vitest hides console.log of passing tests).
 */
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { chooseAction, isSkillAction } from '../src/ai/bot';
import { CHARACTER_IDS, applyMove, applySkill, createGame } from '../src/engine';
import type { CharacterId, Level, Move } from '../src/engine';
import { botFormation } from '../src/meta/opponent';
import { rngFrom } from './helpers';

const GAMES = Number(process.env.SELFPLAY_GAMES ?? 180);
const BUDGET = Number(process.env.SELFPLAY_MS ?? 12);
const OUT = process.env.SELFPLAY_OUT ?? '/tmp/selfplay.json';
const SEED = Number(process.env.SELFPLAY_SEED ?? 4242);

function squad(rng: () => number, withMichelle: boolean): CharacterId[] {
  const pool = CHARACTER_IDS.filter((c) => c !== 'michelle');
  const out: CharacterId[] = withMichelle ? ['michelle'] : [];
  while (out.length < 3) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

it('michelle self-play', () => {
  const rng = rngFrom(SEED);
  const byGrade: Record<number, { n: number; score: number }> = { 1: { n: 0, score: 0 }, 2: { n: 0, score: 0 }, 3: { n: 0, score: 0 } };
  const reasons: Record<string, number> = {};
  let score = 0;
  let firstScore = 0;
  for (let i = 0; i < GAMES; i++) {
    const lv = ((i % 3) + 1) as Level;
    const mSide = ((i >> 1) % 2) as 0 | 1;
    const first = (i % 2) as 0 | 1;
    const sq = [squad(rng, mSide === 0), squad(rng, mSide === 1)];
    const levels = (s: CharacterId[]) => Object.fromEntries(s.map((c) => [c, lv])) as Record<CharacterId, Level>;
    let g = createGame(botFormation('hard', sq[0], levels(sq[0]), rng), botFormation('hard', sq[1], levels(sq[1]), rng), first);
    while (g.status === 'playing') {
      const a = chooseAction(g, 'hard', { timeBudgetMs: BUDGET, rng });
      if (!a) throw new Error('no action');
      g = isSkillAction(a) ? applySkill(g, a) : applyMove(g, a as Move);
    }
    const s = g.winner === null ? 0.5 : g.winner === mSide ? 1 : 0;
    score += s;
    firstScore += g.winner === null ? 0.5 : g.winner === first ? 1 : 0;
    byGrade[lv].n++;
    byGrade[lv].score += s;
    reasons[g.endReason!] = (reasons[g.endReason!] ?? 0) + 1;
  }
  const res = {
    games: GAMES,
    budgetMs: BUDGET,
    michelle: +(score / GAMES).toFixed(3),
    byGrade: Object.fromEntries(Object.entries(byGrade).map(([k, v]) => [k, +(v.score / v.n).toFixed(3)])),
    firstPlayerScore: +(firstScore / GAMES).toFixed(3),
    reasons,
  };
  writeFileSync(OUT, JSON.stringify(res, null, 2));
}, 1_800_000);
