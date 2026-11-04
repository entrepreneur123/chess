/**
 * Character screen (캐릭터 tab): rarity-framed unit cards with every star grade's abilities.
 *  - Owned: the token upgrade button (disabled with the shortfall when tokens are short) and the
 *    grade picker limited to the owned stars; higher stars show locked with their cost.
 *  - Locked: the arena that opens it and its essence price (buy right here when available).
 * Cards update in place, so the scroll position and focus survive every pick or purchase.
 */
import { haptic, sfx } from '../../audio/sfx';
import { CHARACTERS, CHARACTER_IDS, type CharacterId, type Level } from '../../engine';
import { buyBlocker, getProfile, isOwned, priceOf, setGrade, subscribeProfile, updateProfile, upgradeBlocker, type Profile } from '../../meta/profile';
import { arenaForRating, unlockArenaOf, upgradeCost } from '../../meta/progression';
import { essenceIcon, tokenIcon, topBar } from '../components/currency';
import { confirmBuy, confirmUpgrade } from '../components/purchase';
import { artMissing, movementDiagram, rarityChip, starsOf, unitArt } from '../components/piece';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import { playHomeMusic } from '../musicBridge';
import type { Router, Screen } from '../router';

/** Short tactical role per character (UI copy only; rules live in the engine). */
/** Per-level title shown on the card (UI copy only). */
export const TIER_TITLE: Record<CharacterId, [string, string, string]> = {
  sad: ['견습 성기사', '은빛 성기사', '신성 성기사'],
  marki: ['들판의 황소', '철갑 황소', '용암 황소'],
  walk: ['방패병', '강철 방패병', '마도 방패병'],
  insaner: ['꼬마 악마', '광기의 악동', '미친 왕'],
  brutile: ['떠돌이 마녀', '독초의 흑마녀', '불모의 여왕'],
  michelle: ['인형 소녀', '속삭이는 인형사', '저주 인형의 주인'],
  picker: ['카우보이', '사막의 올가미꾼', '황야의 전설'],
};

export const ROLE: Record<CharacterId, { role: string; trait: string }> = {
  sad: { role: '수비형 탱커', trait: '상하좌우 자유 이동 · 유일하게 후퇴 가능' },
  marki: { role: '돌격형 공격수', trait: '앞으로만 일직선 돌진 · 사거리 최장' },
  walk: { role: '기습형 점퍼', trait: '사이의 말을 뛰어넘는 점프 · 넓은 앞줄 커버' },
  insaner: { role: '흡수형 광전사', trait: '적을 잡으면 그 말의 이동 능력을 흡수 · 3성은 잡은 뒤 한 번 더 이동' },
  brutile: { role: '저주형 마녀', trait: '한 칸씩 걷는 느린 마녀 · 성급이 오를수록 사방으로' },
  michelle: { role: '함정형 견제수', trait: '뒤로 물러날 때 인형 함정(한 판 3개) · 밟은 상대는 1턴 속박' },
  picker: { role: '돌파형 사냥꾼', trait: '대각선 콩콩 점프 · 막히지 않고 지나는 적을 모두 잡음 · 상대 함정에서 멈춤' },
};

/** Numeric "reach" per level for the stat bar (max squares reachable on an open board). */
function reachCount(id: CharacterId, lv: Level): number {
  const tbl: Record<CharacterId, [number, number, number]> = { sad: [4, 8, 12], marki: [3, 4, 6], walk: [5, 7, 9], insaner: [8, 12, 24], brutile: [2, 3, 8], michelle: [3, 6, 7], picker: [4, 8, 12] };
  return tbl[id][lv - 1];
}

/** The unit's illustration at a level (the board is top-down only for now, so no 3D renders). */
function unitPreview(id: CharacterId, lv: Level, size = 84) {
  return unitArt(id, lv, { size, cls: 'grade-pick__art' });
}

/** Everything a card's look depends on; a card is rebuilt only when its key changes. */
function cardKey(p: Profile, id: CharacterId): string {
  return `${p.owned[id]}|${p.grades[id]}|${upgradeBlocker(p, id) ?? 'ok'}|${buyBlocker(p, id) ?? 'ok'}`;
}

export function collectionScreen(router: Router): Screen {
  const bag = new Disposables();
  const bar = topBar(router);
  bag.add(bar.dispose);
  const list = h('div', { class: 'scroll-body collection__body' });
  const el = h('div', { class: 'collection' }, bar.el, list);
  let justPicked: CharacterId | null = null;
  let busy = false;

  const pickGrade = (id: CharacterId, grade: Level) => {
    const p = getProfile();
    if (p.grades[id] === grade || grade > p.owned[id]) return;
    justPicked = id;
    updateProfile((q) => setGrade(q, id, grade));
    sfx(grade === 3 ? 'levelup' : 'select');
    haptic('light');
  };
  const run = async (fn: () => Promise<boolean>, id: CharacterId) => {
    if (busy) return;
    busy = true;
    try {
      justPicked = id;
      await fn();
    } finally {
      busy = false;
    }
  };

  const statBar = (label: string, value: number, max: number) =>
    h(
      'div',
      { class: 'stat' },
      h('span', { class: 'stat__label' }, label),
      h('span', { class: 'stat__bar', role: 'img', 'aria-label': `${label} ${value}` }, h('i', { class: 'stat__fill', style: `width:${(value / max) * 100}%` })),
      h('span', { class: 'stat__value' }, String(value)),
    );

  /** Owned: the token upgrade. Locked: where it opens and what it costs. */
  const actionRow = (p: Profile, id: CharacterId) => {
    const def = CHARACTERS[id];
    if (!isOwned(p, id)) {
      const opens = unlockArenaOf(id);
      const block = buyBlocker(p, id);
      const price = priceOf(id);
      const short = Math.max(0, price - p.essence);
      return h(
        'div',
        { class: 'unit-card__action' },
        h('div', { class: 'unit-card__lock' }, icon('lock', 16), opens ? `${opens.index} 전장 ${opens.name}에서 열림` : '곧 공개'),
        h(
          'button',
          {
            class: `btn btn--block ${block ? 'btn--tonal' : 'btn--primary'}`,
            type: 'button',
            'data-action': 'buy',
            disabled: block ? true : undefined,
            onclick: () => void run(() => confirmBuy(id), id),
          },
          essenceIcon(20),
          h('span', null, block === 'arena' && opens ? `${opens.index} 전장 도달 시 구매 가능 · ${price}` : block === 'essence' ? `${price} · ${short} 부족` : `영입 · ${price}`),
        ),
      );
    }
    const owned = p.owned[id] as Level;
    const cost = upgradeCost(id, owned);
    if (cost === null) return h('div', { class: 'unit-card__action' }, h('div', { class: 'unit-card__max' }, icon('crown', 16), `${def.nameKo} 최고 성급 3성`));
    const short = Math.max(0, cost - p.tokens);
    return h(
      'div',
      { class: 'unit-card__action' },
      h(
        'button',
        {
          class: `btn btn--block ${short ? 'btn--tonal' : 'btn--primary'} upgrade-btn`,
          type: 'button',
          'data-action': 'upgrade',
          'data-cost': cost,
          disabled: short ? true : undefined,
          onclick: () => void run(() => confirmUpgrade(id), id),
        },
        icon('up', 18),
        h('span', null, `${owned + 1}성 강화`),
        h('span', { class: 'upgrade-btn__cost' }, tokenIcon(18), h('b', { class: 't-num' }, String(cost))),
      ),
      short ? h('p', { class: 'unit-card__short', 'data-short': short }, tokenIcon(14), `토큰 ${short}개 부족 · 던전에서 모아요`) : null,
    );
  };

  const card = (id: CharacterId) => {
    const p = getProfile();
    const def = CHARACTERS[id];
    const owned = p.owned[id];
    const locked = owned === 0;
    const grade = p.grades[id];
    const levels: Level[] = [1, 2, 3];
    const picked = justPicked === id;
    const reachMax = reachCount(id, 3) > 12 ? 24 : 12;
    return h(
      'article',
      { class: `unit-card rarity-${def.rarity} tier-${grade}${picked ? ' is-picked' : ''}${locked ? ' is-locked' : ''}`, 'data-character': id, 'data-level': grade, 'data-owned': owned },
      h(
        'header',
        { class: 'unit-card__banner' },
        h('img', { class: 'unit-card__art', src: `./chars/${id}-lv${grade}.jpg`, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', onerror: artMissing }),
        h('div', { class: 'unit-card__shine', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'unit-card__title' },
          h('div', { class: 'unit-card__role' }, h('b', null, TIER_TITLE[id][grade - 1]), ' · ', ROLE[id].role),
          h('div', { class: 'unit-card__name' }, def.nameKo, h('span', { class: 'unit-card__en' }, def.nameEn)),
          h(
            'div',
            { class: 'unit-card__chips' },
            rarityChip(def.rarity),
            locked ? h('span', { class: 'own-pill own-pill--locked' }, icon('lock', 12), '미보유') : h('span', { class: 'lv-pill lv-pill--big', 'data-level': grade }, `${grade}성`),
            !locked && owned > grade ? h('span', { class: 'own-pill' }, `보유 ${owned}성`) : null,
          ),
        ),
        h('div', { class: 'unit-card__stars', 'aria-hidden': 'true' }, levels.map((lv) => icon('star', 16, lv <= owned ? 'is-on' : ''))),
        grade === 3 && !locked ? h('div', { class: 'unit-card__aura', 'aria-hidden': 'true' }) : null,
        h('div', { class: 'unit-card__tier', 'aria-hidden': 'true' }, levels.map((lv) => h('i', { class: lv <= owned ? 'is-on' : '' }))),
        locked ? h('div', { class: 'unit-card__veil', 'aria-hidden': 'true' }, icon('lock', 34)) : null,
      ),
      actionRow(p, id),
      h('p', { class: 'unit-card__trait' }, icon('info', 14), ROLE[id].trait),
      def.passiveKo ? h('p', { class: 'unit-card__passive' }, icon('magic', 14), h('span', null, h('b', null, '패시브 · 흡수'), ' ', def.passiveKo)) : null,
      def.trait ? h('p', { class: 'unit-card__passive unit-card__trait' }, icon('magic', 14), h('span', null, h('b', null, `특성 · ${def.trait.nameKo}`), ' ', def.trait.descKo)) : null,
      def.skill
        ? h('p', { class: 'unit-card__passive unit-card__skill' }, icon('magic', 14), h('span', null, h('b', null, `스킬 · ${def.skill.nameKo}`), ' ', def.skill.descKo[grade - 1], ' · 4턴째부터 한 판에 1번, 자기장이 좁혀오면 금지'))
        : null,
      h('div', { class: 'unit-card__stats' }, statBar('이동 범위', reachCount(id, grade), reachMax)),
      // Grade picker: owned stars can be fielded; higher ones show locked with their token cost.
      locked
        ? null
        : h(
            'div',
            { class: 'grade-pick', role: 'radiogroup', 'aria-label': `${def.nameKo} 출전 성급` },
            h('div', { class: 'grade-pick__label' }, '출전 성급 선택'),
            h(
              'div',
              { class: 'grade-pick__row' },
              levels.map((lv) => {
                const have = lv <= owned;
                const stepCost = have ? null : upgradeCost(id, (lv - 1) as Level);
                return h(
                  'button',
                  {
                    class: `grade-pick__btn${lv === grade ? ' is-active' : ''}${have ? '' : ' is-locked'}`,
                    type: 'button',
                    role: 'radio',
                    'aria-checked': String(lv === grade),
                    'aria-disabled': have ? undefined : 'true',
                    'aria-label': have ? `${lv}성` : `${lv}성 잠김 · 토큰 ${stepCost}`,
                    'data-action': 'pick-grade',
                    'data-grade': lv,
                    onclick: () => {
                      if (have) pickGrade(id, lv);
                      else {
                        sfx('tap');
                        el.querySelector<HTMLElement>(`[data-character="${id}"] [data-action="upgrade"]`)?.focus({ preventScroll: true });
                      }
                    },
                  },
                  unitPreview(id, lv, 46),
                  h('span', { class: 'grade-pick__stars', 'aria-hidden': 'true' }, starsOf(lv)),
                  h('span', { class: 'grade-pick__name' }, `${lv}성`),
                  have ? movementDiagram(id, lv, { cell: 6 }) : h('span', { class: 'grade-pick__cost' }, icon('lock', 12), tokenIcon(14), h('b', { class: 't-num' }, String(stepCost))),
                );
              }),
            ),
            h('p', { class: 'grade-pick__desc' }, def.descKo[grade - 1]),
          ),
      h(
        'table',
        { class: 'ability-table' },
        h('caption', { class: 'sr-only' }, `${def.nameKo} 성급별 능력`),
        h('tbody', null,
          levels.map((lv) =>
            h(
              'tr',
              { class: lv === grade && !locked ? 'is-current' : '' },
              h('th', { scope: 'row' }, `${lv}성`),
              h('td', { class: 'ability-table__desc' }, def.descKo[lv - 1]),
              h('td', { class: 'ability-table__diagram' }, movementDiagram(id, lv, { cell: 6 })),
            ),
          ),
        ),
      ),
    );
  };

  // Key each rendered card was built with, so a profile change only rebuilds the cards that changed.
  const shown = new Map<CharacterId, string>();

  /** Owned first (roster order), then locked ones in the order their arenas open them. */
  const order = () => {
    const p = getProfile();
    const lockIndex = (id: CharacterId) => unlockArenaOf(id)?.index ?? 99;
    return [...CHARACTER_IDS].sort((a, b) => Number(!isOwned(p, a)) - Number(!isOwned(p, b)) || (isOwned(p, a) ? 0 : lockIndex(a) - lockIndex(b)));
  };
  let orderKey = '';

  const render = () => {
    const p = getProfile();
    const ids = order();
    orderKey = ids.join();
    const ownedN = ids.filter((id) => isOwned(p, id)).length;
    replaceChildren(
      list,
      h('div', { class: 'page-head' }, h('h1', { class: 'page-head__title' }, '캐릭터'), h('span', { class: 'page-head__sub' }, `보유 ${ownedN} / ${CHARACTER_IDS.length} · ${arenaForRating(p.rating).index} 전장`)),
      h('p', { class: 'hint hint--pad hint--line' }, icon('up', 16), '토큰으로 성급 강화', h('span', { class: 'hint__sep', 'aria-hidden': 'true' }, '·'), icon('star', 16), '보유 성급까지 출전 선택'),
      ids.map(card),
    );
    for (const id of CHARACTER_IDS) shown.set(id, cardKey(p, id));
    justPicked = null;
    // Entrance animation only on first paint (later re-renders must not replay it).
    if (!list.classList.contains('is-settled')) bag.timeout(() => list.classList.add('is-settled'), 900);
  };

  /**
   * Swap only the changed card(s) in place. Rebuilding the whole list emptied the scroller for a
   * moment, which clamped its scroll position to the top on every grade pick, and dropped focus.
   */
  const update = () => {
    const p = getProfile();
    if (order().join() !== orderKey) {
      // A purchase moved a card between the owned and locked groups.
      const top = list.scrollTop;
      render();
      list.scrollTop = top;
      return;
    }
    const top = list.scrollTop;
    for (const id of CHARACTER_IDS) {
      const k = cardKey(p, id);
      if (shown.get(id) === k) continue;
      const old = list.querySelector<HTMLElement>(`[data-character="${id}"]`);
      if (!old) {
        render();
        return;
      }
      const hadFocus = old.contains(document.activeElement);
      const next = card(id);
      old.replaceWith(next);
      shown.set(id, k);
      if (hadFocus) next.querySelector<HTMLElement>('.grade-pick__btn.is-active, [data-action="upgrade"]')?.focus({ preventScroll: true });
    }
    list.scrollTop = top;
    justPicked = null;
  };

  render();
  bag.add(subscribeProfile(update));
  return { el, mount: () => playHomeMusic(), dispose: () => bag.dispose() };
}
