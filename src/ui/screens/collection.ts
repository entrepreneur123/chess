/**
 * Character collection: rarity-framed unit cards, level-by-level abilities, and gem level-ups
 * with a before/after comparison and a confirm step (no accidental spending).
 */
import { haptic, sfx } from '../../audio/sfx';
import { CHARACTERS, CHARACTER_IDS, type CharacterId, type Level } from '../../engine';
import { MAX_LEVEL } from '../../meta/economy';
import { canLevelUp, getProfile, levelUp, levelUpCost, subscribeProfile, updateProfile } from '../../meta/profile';
import { appBar } from '../components/appbar';
import { confirmDialog } from '../components/dialog';
import { coinChip, gemChip, movementDiagram, rarityChip } from '../components/piece';
import { toast } from '../components/toast';
import { Disposables, h, prefersReducedMotion, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';

/** Short tactical role per character (UI copy only; rules live in the engine). */
/** Per-level title shown on the card (UI copy only). */
export const TIER_TITLE: Record<CharacterId, [string, string, string]> = {
  sad: ['견습 성기사', '은빛 성기사', '신성 성기사'],
  marki: ['들판의 황소', '철갑 황소', '용암 황소'],
  walk: ['방패병', '강철 방패병', '마도 방패병'],
};

export const ROLE: Record<CharacterId, { role: string; trait: string }> = {
  sad: { role: '수비형 탱커', trait: '상하좌우 자유 이동 · 유일하게 후퇴 가능' },
  marki: { role: '돌격형 공격수', trait: '앞으로만 일직선 돌진 · 사거리 최장' },
  walk: { role: '기습형 점퍼', trait: '사이의 말을 뛰어넘는 점프 · 넓은 앞줄 커버' },
};

/** Numeric "reach" per level for the stat bar (max squares reachable on an open board). */
function reachCount(id: CharacterId, lv: Level): number {
  const tbl: Record<CharacterId, [number, number, number]> = { sad: [4, 8, 12], marki: [3, 4, 6], walk: [5, 7, 9] };
  return tbl[id][lv - 1];
}

/** Rendered 3D look of the unit at a level (blue team), from `docs/brand/render-units.mjs`. */
function unitPreview(id: CharacterId, lv: Level) {
  return h('img', {
    class: `compare__model tier-${lv}`,
    src: `./chars/unit-${id}-lv${lv}-0.png`,
    alt: `${CHARACTERS[id].nameKo} Lv.${lv} 3D 모델`,
    width: '96',
    height: '96',
    loading: 'lazy',
    decoding: 'async',
    draggable: 'false',
  });
}

export function collectionScreen(router: Router): Screen {
  const bag = new Disposables();
  const wallet = h('div', { class: 'wallet wallet--bar' });
  const list = h('div', { class: 'scroll-body collection__body' });
  const el = h('div', { class: 'collection' }, appBar('캐릭터 도감', { onBack: () => router.home(), trailing: wallet }), list);
  let justLeveled: CharacterId | null = null;

  const doLevelUp = async (id: CharacterId) => {
    const p = getProfile();
    const check = canLevelUp(p, id);
    if (!check.ok) {
      toast(
        check.reason === 'cards' ? '카드가 부족해요. 상점에서 상자를 열어보세요' : check.reason === 'gems' ? '보석이 부족해요. 상점에서 보석을 충전하세요' : '최대 레벨입니다',
        { tone: 'warn' },
      );
      return;
    }
    const cost = levelUpCost(p.characters[id].level)!;
    const next = (p.characters[id].level + 1) as Level;
    const ok = await confirmDialog({
      title: `${CHARACTERS[id].nameKo} Lv.${next}로 강화할까요?`,
      body: h(
        'div',
        { class: 'confirm-cost' },
        h('div', { class: 'confirm-cost__row' }, h('span', null, '소모 보석'), h('b', { class: 'confirm-cost__gem' }, icon('gem', 16), `${cost.gems}`)),
        h('div', { class: 'confirm-cost__row' }, h('span', null, '소모 카드'), h('b', null, `${cost.cards}장`)),
        h('p', { class: 'confirm-cost__note' }, '강화 후 이동 범위: ', h('b', null, CHARACTERS[id].descKo[next - 1])),
      ),
      confirmLabel: '강화하기',
    });
    if (!ok) return;
    if (!canLevelUp(getProfile(), id).ok) return; // state changed meanwhile
    justLeveled = id;
    const after = updateProfile((q) => levelUp(q, id));
    sfx('levelup');
    haptic('win');
    toast(`${CHARACTERS[id].nameKo} Lv.${after.characters[id].level} 달성! 이동 범위가 넓어졌어요`, { tone: 'success', duration: 2600 });
  };

  const statBar = (label: string, value: number, max: number, nextValue?: number) =>
    h(
      'div',
      { class: 'stat' },
      h('span', { class: 'stat__label' }, label),
      h(
        'span',
        { class: 'stat__bar', role: 'img', 'aria-label': `${label} ${value}${nextValue ? ` → ${nextValue}` : ''}` },
        nextValue ? h('i', { class: 'stat__next', style: `width:${(nextValue / max) * 100}%` }) : null,
        h('i', { class: 'stat__fill', style: `width:${(value / max) * 100}%` }),
      ),
      h('span', { class: 'stat__value' }, String(value), nextValue ? h('span', { class: 'stat__delta' }, `▲${nextValue - value}`) : null),
    );

  const card = (id: CharacterId) => {
    const p = getProfile();
    const def = CHARACTERS[id];
    const prog = p.characters[id];
    const cost = levelUpCost(prog.level);
    const check = canLevelUp(p, id);
    const next = cost ? ((prog.level + 1) as Level) : null;
    const pct = cost ? Math.min(100, (prog.cards / cost.cards) * 100) : 100;
    const levels: Level[] = [1, 2, 3];
    const leveled = justLeveled === id;
    return h(
      'article',
      { class: `unit-card rarity-${def.rarity} tier-${prog.level}${leveled ? ' is-leveled' : ''}`, 'data-character': id, 'data-level': prog.level },
      h(
        'header',
        { class: 'unit-card__banner' },
        h('img', { class: 'unit-card__art', src: `./chars/${id}-lv${prog.level}.jpg`, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }),
        h('div', { class: 'unit-card__shine', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'unit-card__title' },
          h('div', { class: 'unit-card__role' }, h('b', null, TIER_TITLE[id][prog.level - 1]), ' · ', ROLE[id].role),
          h('div', { class: 'unit-card__name' }, def.nameKo, h('span', { class: 'unit-card__en' }, def.nameEn)),
          h('div', { class: 'unit-card__chips' }, rarityChip(def.rarity), h('span', { class: 'lv-pill lv-pill--big', 'data-level': prog.level }, `Lv.${prog.level}`)),
        ),
        h('div', { class: 'unit-card__stars', 'aria-hidden': 'true' }, levels.map((lv) => icon('star', 16, lv <= prog.level ? 'is-on' : ''))),
        prog.level === 3 ? h('div', { class: 'unit-card__aura', 'aria-hidden': 'true' }) : null,
        h('div', { class: 'unit-card__tier', 'aria-hidden': 'true' }, levels.map((lv) => h('i', { class: lv <= prog.level ? 'is-on' : '' }))),
        leveled ? h('div', { class: 'unit-card__burst', 'aria-hidden': 'true' }, h('span', { class: 'unit-card__burst-text' }, 'LEVEL UP!')) : null,
      ),
      h('p', { class: 'unit-card__trait' }, icon('info', 14), ROLE[id].trait),
      h(
        'div',
        { class: 'unit-card__stats' },
        statBar('이동 범위', reachCount(id, prog.level), 12, next ? reachCount(id, next) : undefined),
        h(
          'div',
          { class: 'unit-card__compare' },
          h('div', { class: 'compare__col' }, h('span', { class: 'compare__cap' }, `Lv.${prog.level} 현재`), unitPreview(id, prog.level), movementDiagram(id, prog.level, { cell: 8 }), h('span', { class: 'compare__desc' }, def.descKo[prog.level - 1])),
          next
            ? [
                h('span', { class: 'compare__arrow' }, icon('chevron', 22)),
                h('div', { class: 'compare__col compare__col--next' }, h('span', { class: 'compare__cap' }, `Lv.${next} 강화 후`), unitPreview(id, next), movementDiagram(id, next, { cell: 8 }), h('span', { class: 'compare__desc' }, def.descKo[next - 1])),
              ]
            : h('div', { class: 'compare__col compare__col--max' }, icon('trophy', 28), h('span', { class: 'compare__cap' }, '최대 레벨')),
        ),
      ),
      h(
        'div',
        { class: 'upgrade' },
        h(
          'div',
          { class: 'upgrade__cards' },
          h('span', { class: 'upgrade__card-icon', 'aria-hidden': 'true' }, icon('card', 22)),
          h('div', { class: 'progress-block__label' }, h('span', null, cost ? '강화 카드' : '보유 카드'), h('span', { class: 'progress-block__value' }, cost ? `${prog.cards} / ${cost.cards}` : String(prog.cards))),
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
                class: `btn ${check.ok ? 'btn--upgrade' : 'btn--tonal'} btn--block`,
                type: 'button',
                'data-action': 'level-up',
                'aria-disabled': check.ok ? 'false' : 'true',
                onclick: () => void doLevelUp(id),
              },
              icon('up', 20),
              `Lv.${prog.level + 1} 강화`,
              h('span', { class: `btn__cost${p.gems < cost.gems ? ' is-short' : ''}` }, icon('gem', 16), String(cost.gems)),
            )
          : h('div', { class: 'max-note' }, icon('check', 18), '최대 레벨 달성'),
        !check.ok && check.reason !== 'max'
          ? h('p', { class: 'upgrade__hint' }, check.reason === 'cards' ? `카드 ${cost!.cards - prog.cards}장 더 필요 · 상자에서 획득` : `보석 ${cost!.gems - p.gems}개 부족 · 상점에서 충전`)
          : null,
      ),
      h(
        'table',
        { class: 'ability-table' },
        h('caption', { class: 'sr-only' }, `${def.nameKo} 레벨별 능력`),
        h('tbody', null,
          levels.map((lv) =>
            h(
              'tr',
              { class: `${lv === prog.level ? 'is-current' : ''}${lv < prog.level ? ' is-past' : ''}${lv > prog.level ? ' is-locked' : ''}` },
              h('th', { scope: 'row' }, lv > prog.level ? icon('lock', 12) : null, `Lv.${lv}`),
              h('td', { class: 'ability-table__desc' }, def.descKo[lv - 1]),
              h('td', { class: 'ability-table__diagram' }, movementDiagram(id, lv, { cell: 6 })),
            ),
          ),
        ),
      ),
    );
  };

  const render = () => {
    const p = getProfile();
    replaceChildren(wallet, coinChip(p.coins), gemChip(p.gems));
    replaceChildren(
      list,
      h('p', { class: 'hint hint--pad' }, icon('info', 16), '상자에서 카드를 모으고 보석으로 강화하세요. 다이어그램의 위쪽이 앞(적 방향)입니다.'),
      CHARACTER_IDS.map(card),
    );
    if (justLeveled && !prefersReducedMotion()) {
      const target = list.querySelector<HTMLElement>(`[data-character="${justLeveled}"]`);
      target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    justLeveled = null;
    // Entrance animation only on first paint (later re-renders must not replay it).
    if (!list.classList.contains('is-settled')) bag.timeout(() => list.classList.add('is-settled'), 900);
  };
  render();
  bag.add(subscribeProfile(render));
  return { el, dispose: () => bag.dispose() };
}
