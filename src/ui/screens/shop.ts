/**
 * Essence shop (상점 tab). It sells the characters opened in the current arena or any lower one
 * that are not owned yet. Characters from higher arenas show locked with "N 전장 도달 시"; owned
 * ones are listed compactly at the end. Every purchase asks for confirmation first.
 */
import { CHARACTERS, CHARACTER_IDS, type CharacterId } from '../../engine';
import { buyBlocker, getProfile, isOwned, priceOf, subscribeProfile } from '../../meta/profile';
import { ARENA_DEFS, ESSENCE_REWARD, arenaForRating, unlockArenaOf } from '../../meta/progression';
import { essenceIcon, showCurrencyInfo, topBar } from '../components/currency';
import { confirmBuy } from '../components/purchase';
import { rarityChip, unitArt } from '../components/piece';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import { playHomeMusic } from '../musicBridge';
import type { Router, Screen } from '../router';
import { ROLE } from './collection';

export function shopScreen(router: Router): Screen {
  const bag = new Disposables();
  const bar = topBar(router);
  bag.add(bar.dispose);
  const list = h('div', { class: 'scroll-body shop__body' });
  const el = h('div', { class: 'shop' }, bar.el, list);
  let busy = false;

  const buy = async (id: CharacterId) => {
    if (busy) return;
    busy = true;
    try {
      await confirmBuy(id);
    } finally {
      busy = false;
    }
  };

  const offer = (id: CharacterId) => {
    const p = getProfile();
    const def = CHARACTERS[id];
    const block = buyBlocker(p, id);
    const price = priceOf(id);
    const opens = unlockArenaOf(id);
    const lockedByArena = block === 'arena';
    const short = Math.max(0, price - p.essence);
    return h(
      'article',
      { class: `offer rarity-${def.rarity}${lockedByArena ? ' is-locked' : ''}`, 'data-character': id, 'data-state': block ?? 'buyable' },
      h('div', { class: 'offer__art' }, unitArt(id, 1, { size: 72 }), lockedByArena ? h('span', { class: 'offer__lock' }, icon('lock', 20)) : null),
      h(
        'div',
        { class: 'offer__main' },
        h('div', { class: 'offer__head' }, h('span', { class: 'offer__name' }, def.nameKo), rarityChip(def.rarity)),
        h('p', { class: 'offer__role' }, ROLE[id].role),
        lockedByArena && opens
          ? h('p', { class: 'offer__gate' }, icon('lock', 12), `${opens.index} 전장 도달 시 구매 가능`)
          : h('p', { class: 'offer__gate is-open' }, icon('check', 12), opens ? `${opens.index} 전장 ${opens.name}` : ''),
      ),
      h(
        'button',
        {
          class: `btn ${block ? 'btn--tonal' : 'btn--primary'} offer__buy`,
          type: 'button',
          'data-action': 'buy',
          disabled: block ? true : undefined,
          'aria-label': block === 'essence' ? `${def.nameKo} 영입 · 에센셜 ${short}개 부족` : lockedByArena ? `${def.nameKo} 잠김` : `${def.nameKo} 영입 · 에센셜 ${price}`,
          onclick: () => void buy(id),
        },
        h('span', { class: 'offer__price' }, essenceIcon(18), h('b', { class: 't-num' }, String(price))),
        h('span', { class: 'offer__cta' }, lockedByArena ? '잠김' : block === 'essence' ? `${short} 부족` : '영입'),
      ),
    );
  };

  let key = '';
  const render = () => {
    const p = getProfile();
    const arena = arenaForRating(p.rating);
    const notOwned = CHARACTER_IDS.filter((id) => !isOwned(p, id) && unlockArenaOf(id));
    const k = `${p.essence}|${p.rating}|${CHARACTER_IDS.map((id) => p.owned[id]).join()}`;
    if (k === key) return;
    key = k;
    const top = list.scrollTop;
    const buyable = notOwned.filter((id) => buyBlocker(p, id) !== 'arena');
    const locked = notOwned.filter((id) => buyBlocker(p, id) === 'arena').sort((a, b) => (unlockArenaOf(a)?.index ?? 0) - (unlockArenaOf(b)?.index ?? 0));
    const owned = CHARACTER_IDS.filter((id) => isOwned(p, id));
    const emptyArenas = ARENA_DEFS.filter((a) => a.unlocks.length === 0);
    replaceChildren(
      list,
      h('div', { class: 'page-head' }, h('h1', { class: 'page-head__title' }, '상점'), h('span', { class: 'page-head__sub' }, `${arena.index} 전장까지의 캐릭터`)),
      h(
        'button',
        { class: 'wallet pressable', type: 'button', 'data-action': 'info-essence', onclick: () => showCurrencyInfo('essence', () => router.navigate('matchmaking', { mode: 'ranked' })) },
        essenceIcon(40),
        h('span', { class: 'wallet__main' }, h('span', { class: 'wallet__label' }, '보유 에센셜'), h('b', { class: 'wallet__val t-num' }, String(p.essence))),
        h('span', { class: 'wallet__hint' }, `승리 +${ESSENCE_REWARD.win} · 무승부 +${ESSENCE_REWARD.draw}`, h('br'), '전장전 · 견습전투'),
      ),
      buyable.length ? h('h2', { class: 'section-title section-title--display' }, '영입 가능') : null,
      buyable.map(offer),
      !buyable.length && locked.length ? h('p', { class: 'hint hint--pad shop__empty' }, icon('info', 16), '지금 영입할 수 있는 캐릭터를 모두 모았어요') : null,
      locked.length ? h('h2', { class: 'section-title section-title--display' }, '다음 전장에서') : null,
      locked.map(offer),
      emptyArenas.length
        ? h(
            'p',
            { class: 'hint hint--pad shop__soon' },
            icon('castle', 16),
            // Only arena 6 still waits for a character: name it.
            emptyArenas.length === 1 ? `${emptyArenas[0].index} 전장 ${emptyArenas[0].name} · 신규 캐릭터 준비 중` : `${emptyArenas.map((a) => a.index).join('·')} 전장 신규 캐릭터 준비 중`,
          )
        : null,
      h('h2', { class: 'section-title section-title--display' }, '보유 중'),
      h(
        'div',
        { class: 'owned-row' },
        owned.map((id) => h('span', { class: `owned-chip rarity-${CHARACTERS[id].rarity}`, 'data-character': id }, unitArt(id, p.grades[id], { size: 36 }), h('span', null, CHARACTERS[id].nameKo), icon('check', 14))),
      ),
    );
    list.scrollTop = top;
  };

  render();
  bag.add(subscribeProfile(render));
  return { el, mount: () => playHomeMusic(), dispose: () => bag.dispose() };
}
