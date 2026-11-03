/**
 * The progression block of the result dialog: rating delta with a count-up and the arena bar
 * (전장전), the essence gained (전장전 / 견습전투), the dungeon tokens or the "already claimed"
 * note (던전), a promotion / demotion banner and the "상점에 새 캐릭터" call-out.
 */
import { CHARACTERS, type CharacterId } from '../../engine';
import type { MatchSummary } from '../../meta/profile';
import { DUNGEON_LABEL, DUNGEON_REWARD, arenaById, arenaProgress } from '../../meta/progression';
import { arenaBadge, countUp, essenceIcon, tokenIcon } from '../components/currency';
import { unitArt } from '../components/piece';
import { h, prefersReducedMotion } from '../dom';
import { icon } from '../icons';

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

export function resultPanel(s: MatchSummary, opts: { onShop?: (ids: CharacterId[]) => void } = {}): { el: HTMLElement; start(): void; dispose(): void } {
  const cancels: (() => void)[] = [];
  const parts: HTMLElement[] = [];
  let ratingNum: HTMLElement | null = null;
  let meterFill: HTMLElement | null = null;
  const after = arenaProgress(s.ratingAfter);
  const before = arenaProgress(s.ratingBefore);

  if (s.promoted || s.demoted) {
    const a = arenaById(s.arenaAfter);
    parts.push(
      h(
        'div',
        { class: `res-banner res-banner--${s.promoted ? 'up' : 'down'}`, style: `--arena-accent:${a.accent}`, 'data-banner': s.promoted ? 'promoted' : 'demoted' },
        arenaBadge(a, 'md'),
        h('span', { class: 'res-banner__text' }, h('b', null, s.promoted ? '승급!' : '강등'), `${a.index} 전장 · ${a.name}`),
      ),
    );
  }

  if (s.mode === 'ranked') {
    ratingNum = h('b', { class: 'res-rating__num t-num' }, String(s.ratingBefore));
    const sameArena = s.arenaAfter === s.arenaBefore;
    const startPct = sameArena ? before.progress * 100 : s.promoted ? 0 : 100;
    meterFill = h('i', { class: 'meter__fill', style: `width:${prefersReducedMotion() ? after.progress * 100 : startPct}%` });
    const a = after.arena;
    parts.push(
      h(
        'div',
        { class: 'res-rating', 'data-delta': s.ratingDelta, style: `--arena-accent:${a.accent}` },
        h(
          'div',
          { class: 'res-rating__top' },
          arenaBadge(a, 'sm'),
          h('span', { class: 'res-rating__label' }, '레이팅'),
          ratingNum,
          h('span', { class: `res-rating__delta ${s.ratingDelta > 0 ? 'is-up' : s.ratingDelta < 0 ? 'is-down' : ''}` }, signed(s.ratingDelta)),
        ),
        h('div', { class: 'meter meter--sm', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(after.progress * 100)), 'aria-label': '다음 전장까지 진행도' }, meterFill),
        h('span', { class: 'res-rating__next' }, after.next ? `${a.index} 전장 · 다음 ${after.next.name}까지 ${after.toNext}` : `${a.index} 전장 · 최고 전장`),
      ),
    );
  } else if (s.mode === 'casual') {
    parts.push(h('p', { class: 'res-note' }, icon('info', 14), `견습전투 · 레이팅 변동 없음 (${s.ratingAfter})`));
  }

  const rewards: HTMLElement[] = [];
  if (s.mode !== 'dungeon') {
    rewards.push(h('span', { class: `res-reward${s.essenceGained ? '' : ' is-zero'}`, 'data-reward': 'essence' }, essenceIcon(22), h('b', { class: 't-num' }, `+${s.essenceGained}`), h('span', null, '에센셜')));
  } else if (s.tokensGained > 0) {
    rewards.push(h('span', { class: 'res-reward res-reward--token', 'data-reward': 'tokens' }, tokenIcon(24), h('b', { class: 't-num' }, `+${s.tokensGained}`), h('span', null, `토큰 · 던전 ${s.dungeonLevel ? DUNGEON_LABEL[s.dungeonLevel] : ''}`)));
  }
  if (rewards.length) parts.push(h('div', { class: 'res-rewards' }, rewards));
  if (s.mode === 'dungeon' && s.tokensGained === 0) {
    const lvl = s.dungeonLevel ?? 'easy';
    parts.push(
      h(
        'p',
        { class: 'res-note', 'data-dungeon-note': s.dungeonAlreadyClaimed ? 'claimed' : 'open' },
        s.dungeonAlreadyClaimed ? icon('check', 14) : tokenIcon(16),
        s.dungeonAlreadyClaimed ? '오늘 보상은 이미 받았어요' : `오늘 보상 기회가 남아 있어요 · 승리하면 +${DUNGEON_REWARD[lvl]}`,
      ),
    );
  }

  if (s.newShopCharacters.length) {
    const ids = s.newShopCharacters;
    parts.push(
      h(
        'button',
        { class: 'res-shop pressable', type: 'button', 'data-action': 'result-shop', onclick: () => opts.onShop?.(ids) },
        h('span', { class: 'res-shop__faces' }, ids.slice(0, 2).map((id) => unitArt(id, 1, { size: 36 }))),
        h('span', { class: 'res-shop__text' }, h('b', null, '상점에 새 캐릭터'), ids.map((id) => CHARACTERS[id].nameKo).join(' · ')),
        icon('chevron', 20),
      ),
    );
  }

  const el = h('div', { class: 'res-panel' }, parts);
  return {
    el,
    start() {
      if (ratingNum) cancels.push(countUp(ratingNum, s.ratingBefore, s.ratingAfter, 1000));
      if (meterFill) {
        const fill = meterFill;
        const id = window.setTimeout(() => (fill.style.width = `${after.progress * 100}%`), 120);
        cancels.push(() => window.clearTimeout(id));
      }
    },
    dispose() {
      for (const c of cancels.splice(0)) c();
    },
  };
}
