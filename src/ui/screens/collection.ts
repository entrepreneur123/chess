import { CHARACTERS, CHARACTER_IDS, type CharacterId, type Level } from '../../engine';
import { MAX_LEVEL } from '../../meta/economy';
import { canLevelUp, getProfile, levelUp, levelUpCost, subscribeProfile, updateProfile } from '../../meta/profile';
import { appBar } from '../components/appbar';
import { coinChip, movementDiagram, pieceToken, rarityChip } from '../components/piece';
import { toast } from '../components/toast';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';

export function collectionScreen(router: Router): Screen {
  const bag = new Disposables();
  const coinHost = h('div', null);
  const list = h('div', { class: 'scroll-body collection__body' });
  const el = h('div', { class: 'collection' }, appBar('캐릭터', { onBack: () => router.home(), trailing: coinHost }), list);
  let justLeveled: CharacterId | null = null;

  const doLevelUp = (id: CharacterId) => {
    const p = getProfile();
    const check = canLevelUp(p, id);
    if (!check.ok) {
      toast(check.reason === 'cards' ? '카드가 부족합니다. 상점에서 상자를 열어보세요' : check.reason === 'coins' ? '코인이 부족합니다' : '최대 레벨입니다', {
        tone: 'warn',
      });
      return;
    }
    justLeveled = id;
    const next = updateProfile((q) => levelUp(q, id));
    toast(`${CHARACTERS[id].nameKo} Lv.${next.characters[id].level} 달성!`, { tone: 'success' });
  };

  const card = (id: CharacterId) => {
    const p = getProfile();
    const def = CHARACTERS[id];
    const prog = p.characters[id];
    const cost = levelUpCost(prog.level);
    const check = canLevelUp(p, id);
    const pct = cost ? Math.min(100, (prog.cards / cost.cards) * 100) : 100;
    const levels: Level[] = [1, 2, 3];
    return h(
      'article',
      { class: `card char-card rarity-${def.rarity}${justLeveled === id ? ' is-leveled' : ''}`, 'data-character': id },
      h(
        'div',
        { class: 'char-card__head' },
        pieceToken(id, prog.level, 0, 'lg'),
        h(
          'div',
          { class: 'char-card__title' },
          h('div', { class: 'char-card__name' }, def.nameKo, h('span', { class: 'char-card__en' }, def.nameEn)),
          h('div', { class: 'char-card__chips' }, rarityChip(def.rarity), h('span', { class: 'lv-pill', 'data-level': prog.level }, `Lv.${prog.level}`)),
        ),
      ),
      h(
        'div',
        { class: 'progress-block' },
        h(
          'div',
          { class: 'progress-block__label' },
          h('span', null, cost ? '다음 레벨까지 카드' : '최대 레벨'),
          h('span', { class: 'progress-block__value' }, cost ? `${prog.cards} / ${cost.cards}` : `보유 ${prog.cards}`),
        ),
        h(
          'div',
          { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) },
          h('span', { class: `progress__bar${cost && prog.cards >= cost.cards ? ' is-full' : ''}`, style: `width:${pct}%` }),
        ),
      ),
      prog.level < MAX_LEVEL && cost
        ? h(
            'button',
            {
              class: `btn ${check.ok ? 'btn--filled' : 'btn--tonal'} btn--block`,
              type: 'button',
              'data-action': 'level-up',
              'aria-disabled': check.ok ? 'false' : 'true',
              onclick: () => doLevelUp(id),
            },
            icon('up', 20),
            `레벨업 · Lv.${prog.level + 1}`,
            h('span', { class: 'btn__cost' }, icon('coin', 16), String(cost.coins)),
          )
        : h('div', { class: 'max-note' }, icon('check', 18), '최대 레벨 달성'),
      h(
        'table',
        { class: 'ability-table' },
        h('caption', { class: 'sr-only' }, `${def.nameKo} 레벨별 능력`),
        h('tbody', null,
          levels.map((lv) =>
            h(
              'tr',
              { class: `${lv === prog.level ? 'is-current' : ''}${lv < prog.level ? ' is-past' : ''}${lv > prog.level ? ' is-locked' : ''}` },
              h('th', { scope: 'row' }, `Lv.${lv}`),
              h('td', { class: 'ability-table__desc' }, def.descKo[lv - 1]),
              h('td', { class: 'ability-table__diagram' }, movementDiagram(id, lv, { cell: 6 })),
            ),
          ),
        ),
      ),
    );
  };

  const render = () => {
    replaceChildren(coinHost, coinChip(getProfile().coins));
    replaceChildren(
      list,
      h('p', { class: 'hint hint--pad' }, '카드를 모아 레벨업하면 이동 범위가 넓어집니다. 다이어그램의 위쪽이 앞(적 방향)입니다.'),
      CHARACTER_IDS.map(card),
    );
    justLeveled = null;
  };
  render();
  bag.add(subscribeProfile(render));
  return { el, dispose: () => bag.dispose() };
}
