/**
 * Character screen: rarity-framed unit cards with every star grade's abilities. Every character
 * and grade is available; the player picks which grade (1성 / 2성 / 3성) to field for each one.
 */
import { haptic, sfx } from '../../audio/sfx';
import { CHARACTERS, CHARACTER_IDS, type CharacterId, type Level } from '../../engine';
import { getProfile, setGrade, subscribeProfile, updateProfile } from '../../meta/profile';
import { appBar } from '../components/appbar';
import { movementDiagram, rarityChip, starsOf, unitArt } from '../components/piece';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';

/** Short tactical role per character (UI copy only; rules live in the engine). */
/** Per-level title shown on the card (UI copy only). */
export const TIER_TITLE: Record<CharacterId, [string, string, string]> = {
  sad: ['견습 성기사', '은빛 성기사', '신성 성기사'],
  marki: ['들판의 황소', '철갑 황소', '용암 황소'],
  walk: ['방패병', '강철 방패병', '마도 방패병'],
  insaner: ['꼬마 악마', '광기의 악동', '미친 왕'],
  brutile: ['떠돌이 마녀', '독초의 흑마녀', '불모의 여왕'],
};

export const ROLE: Record<CharacterId, { role: string; trait: string }> = {
  sad: { role: '수비형 탱커', trait: '상하좌우 자유 이동 · 유일하게 후퇴 가능' },
  marki: { role: '돌격형 공격수', trait: '앞으로만 일직선 돌진 · 사거리 최장' },
  walk: { role: '기습형 점퍼', trait: '사이의 말을 뛰어넘는 점프 · 넓은 앞줄 커버' },
  insaner: { role: '흡수형 광전사', trait: '적을 잡으면 그 말의 이동 능력을 흡수 · 3성은 잡은 뒤 한 번 더 이동' },
  brutile: { role: '저주형 마녀', trait: '한 칸씩 걷는 느린 마녀 · 성급이 오를수록 사방으로' },
};

/** Numeric "reach" per level for the stat bar (max squares reachable on an open board). */
function reachCount(id: CharacterId, lv: Level): number {
  const tbl: Record<CharacterId, [number, number, number]> = { sad: [4, 8, 12], marki: [3, 4, 6], walk: [5, 7, 9], insaner: [8, 12, 24], brutile: [2, 3, 8] };
  return tbl[id][lv - 1];
}

/** The unit's illustration at a level (the board is top-down only for now, so no 3D renders). */
function unitPreview(id: CharacterId, lv: Level, size = 84) {
  return unitArt(id, lv, { size, cls: 'grade-pick__art' });
}

export function collectionScreen(router: Router): Screen {
  const bag = new Disposables();
  const list = h('div', { class: 'scroll-body collection__body' });
  const el = h('div', { class: 'collection' }, appBar('캐릭터', { onBack: () => router.home() }), list);
  let justPicked: CharacterId | null = null;

  const pickGrade = (id: CharacterId, grade: Level) => {
    if (getProfile().grades[id] === grade) return;
    justPicked = id;
    updateProfile((q) => setGrade(q, id, grade));
    sfx(grade === 3 ? 'levelup' : 'select');
    haptic('light');
  };

  const statBar = (label: string, value: number, max: number) =>
    h(
      'div',
      { class: 'stat' },
      h('span', { class: 'stat__label' }, label),
      h('span', { class: 'stat__bar', role: 'img', 'aria-label': `${label} ${value}` }, h('i', { class: 'stat__fill', style: `width:${(value / max) * 100}%` })),
      h('span', { class: 'stat__value' }, String(value)),
    );

  const card = (id: CharacterId) => {
    const p = getProfile();
    const def = CHARACTERS[id];
    const grade = p.grades[id];
    const levels: Level[] = [1, 2, 3];
    const picked = justPicked === id;
    const reachMax = reachCount(id, 3) > 12 ? 24 : 12;
    return h(
      'article',
      { class: `unit-card rarity-${def.rarity} tier-${grade}${picked ? ' is-picked' : ''}`, 'data-character': id, 'data-level': grade },
      h(
        'header',
        { class: 'unit-card__banner' },
        h('img', { class: 'unit-card__art', src: `./chars/${id}-lv${grade}.jpg`, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }),
        h('div', { class: 'unit-card__shine', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'unit-card__title' },
          h('div', { class: 'unit-card__role' }, h('b', null, TIER_TITLE[id][grade - 1]), ' · ', ROLE[id].role),
          h('div', { class: 'unit-card__name' }, def.nameKo, h('span', { class: 'unit-card__en' }, def.nameEn)),
          h('div', { class: 'unit-card__chips' }, rarityChip(def.rarity), h('span', { class: 'lv-pill lv-pill--big', 'data-level': grade }, `${grade}성`)),
        ),
        h('div', { class: 'unit-card__stars', 'aria-hidden': 'true' }, levels.map((lv) => icon('star', 16, lv <= grade ? 'is-on' : ''))),
        grade === 3 ? h('div', { class: 'unit-card__aura', 'aria-hidden': 'true' }) : null,
        h('div', { class: 'unit-card__tier', 'aria-hidden': 'true' }, levels.map((lv) => h('i', { class: lv <= grade ? 'is-on' : '' }))),
      ),
      h('p', { class: 'unit-card__trait' }, icon('info', 14), ROLE[id].trait),
      def.passiveKo ? h('p', { class: 'unit-card__passive' }, icon('magic', 14), h('span', null, h('b', null, '패시브 · 흡수'), ' ', def.passiveKo)) : null,
      def.skill
        ? h('p', { class: 'unit-card__passive unit-card__skill' }, icon('magic', 14), h('span', null, h('b', null, `스킬 · ${def.skill.nameKo}`), ' ', def.skill.descKo[grade - 1], ' · 4턴째부터 한 판에 1번, 자기장이 좁혀오면 금지'))
        : null,
      h('div', { class: 'unit-card__stats' }, statBar('이동 범위', reachCount(id, grade), reachMax)),
      // Grade picker: every grade is available; the chosen one is what gets fielded.
      h(
        'div',
        { class: 'grade-pick', role: 'radiogroup', 'aria-label': `${def.nameKo} 출전 성급` },
        h('div', { class: 'grade-pick__label' }, '출전 성급 선택'),
        h(
          'div',
          { class: 'grade-pick__row' },
          levels.map((lv) =>
            h(
              'button',
              {
                class: `grade-pick__btn${lv === grade ? ' is-active' : ''}`,
                type: 'button',
                role: 'radio',
                'aria-checked': String(lv === grade),
                'data-action': 'pick-grade',
                'data-grade': lv,
                onclick: () => pickGrade(id, lv),
              },
              unitPreview(id, lv, 46),
              h('span', { class: 'grade-pick__stars', 'aria-hidden': 'true' }, starsOf(lv)),
              h('span', { class: 'grade-pick__name' }, `${lv}성`),
              movementDiagram(id, lv, { cell: 6 }),
            ),
          ),
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
              { class: lv === grade ? 'is-current' : '' },
              h('th', { scope: 'row' }, `${lv}성`),
              h('td', { class: 'ability-table__desc' }, def.descKo[lv - 1]),
              h('td', { class: 'ability-table__diagram' }, movementDiagram(id, lv, { cell: 6 })),
            ),
          ),
        ),
      ),
    );
  };

  // Grade each rendered card was built with, so a profile change only rebuilds the cards that changed.
  const shown = new Map<CharacterId, Level>();

  const render = () => {
    replaceChildren(
      list,
      h('p', { class: 'hint hint--pad' }, icon('info', 16), '모든 캐릭터를 1성 · 2성 · 3성 중 원하는 성급으로 출전시킬 수 있어요. 다이어그램의 위쪽이 앞(적 방향)입니다.'),
      CHARACTER_IDS.map(card),
    );
    for (const id of CHARACTER_IDS) shown.set(id, getProfile().grades[id]);
    justPicked = null;
    // Entrance animation only on first paint (later re-renders must not replay it).
    if (!list.classList.contains('is-settled')) bag.timeout(() => list.classList.add('is-settled'), 900);
  };

  /**
   * Swap only the changed card(s) in place. Rebuilding the whole list emptied the scroller for a
   * moment, which clamped its scroll position to the top on every grade pick, and dropped focus.
   */
  const update = () => {
    const grades = getProfile().grades;
    const top = list.scrollTop;
    for (const id of CHARACTER_IDS) {
      if (shown.get(id) === grades[id]) continue;
      const old = list.querySelector<HTMLElement>(`[data-character="${id}"]`);
      if (!old) {
        render();
        return;
      }
      const hadFocus = old.contains(document.activeElement);
      const next = card(id);
      old.replaceWith(next);
      shown.set(id, grades[id]);
      if (hadFocus) next.querySelector<HTMLElement>('.grade-pick__btn.is-active')?.focus({ preventScroll: true });
    }
    list.scrollTop = top;
    justPicked = null;
  };

  render();
  bag.add(subscribeProfile(update));
  return { el, dispose: () => bag.dispose() };
}
