/**
 * Character screen (캐릭터 tab): a portrait grid of the whole roster, one tile per character.
 *  - Tile: the fielded grade's portrait in a rarity frame (white / orange / purple / animated
 *    rainbow), the owned stars on its bottom edge and the name underneath. Locked characters are
 *    dimmed with a lock, and show their essence price or the arena ("N 전장") that opens them.
 *    Corner badges flag what can be done right now: "강화 가능" / "구매 가능".
 *  - Order: owned first (roster order), then locked ones in the order their arenas open them,
 *    the "found / not found" split collection screens of top mobile games use: what you can field
 *    is on top, and the locked part reads as a progression path.
 *  - Tap: the full unit card (upgrade, grade picker, movement diagrams, skill and trait copy,
 *    Rakaeli's 기본 / 타천 switch) opens in a bottom sheet.
 * Tiles and the open card update in place on every profile change, so scroll and focus survive
 * every pick, upgrade or purchase.
 */
import { haptic, sfx } from '../../audio/sfx';
import { CHARACTERS, CHARACTER_IDS, type CharacterId, type Level } from '../../engine';
import { buyBlocker, getProfile, isOwned, priceOf, setGrade, subscribeProfile, updateProfile, upgradeBlocker, type Profile } from '../../meta/profile';
import { arenaForRating, unlockArenaOf, upgradeCost } from '../../meta/progression';
import { essenceIcon, tokenIcon, topBar } from '../components/currency';
import { confirmBuy, confirmUpgrade } from '../components/purchase';
import { RARITY_LABEL, artMissing, cardArtUrl, faceUrl, movementDiagram, movementReach, rarityChip, starsOf, unitArt } from '../components/piece';
import { showBottomSheet, type SheetHandle } from '../components/sheet';
import { Disposables, h, prefersReducedMotion, replaceChildren } from '../dom';
import { icon } from '../icons';
import { playHomeMusic } from '../musicBridge';
import type { Router, Screen } from '../router';

/** Per-level title shown on the card (UI copy only). */
export const TIER_TITLE: Record<CharacterId, [string, string, string]> = {
  sad: ['견습 성기사', '은빛 성기사', '신성 성기사'],
  marki: ['들판의 황소', '철갑 황소', '용암 황소'],
  walk: ['방패병', '강철 방패병', '마도 방패병'],
  insaner: ['꼬마 악마', '광기의 악동', '미친 왕'],
  brutile: ['떠돌이 마녀', '독초의 흑마녀', '불모의 여왕'],
  michelle: ['인형 소녀', '속삭이는 인형사', '저주 인형의 주인'],
  picker: ['카우보이', '사막의 올가미꾼', '황야의 전설'],
  rakaeli: ['눈가린 천사', '추락한 천사', '타천의 군주'],
  rampid: ['얼음 소년', '서리 질주자', '빙하의 폭풍'],
  larhen: ['그림자 단검', '달밤의 암살자', '은월의 처형자'],
  volkonov: ['떠돌이 음유시인', '궁정 음유시인', '선율의 거장'],
  verish: ['질주하는 소녀', '강철 부츠의 질주자', '음속의 관통자'],
  midos: ['방황하는 망령', '그림자 사냥꾼', '심연의 망령왕'],
};

/** Role and one-line trait per character; `trait3` replaces `trait` on the 3-star card. */
export const ROLE: Record<CharacterId, { role: string; trait: string; trait3?: string }> = {
  sad: { role: '수비형 탱커', trait: '상하좌우 자유 이동 · 유일하게 후퇴 가능' },
  marki: { role: '돌격형 공격수', trait: '앞으로만 일직선 돌진 · 사거리 최장', trait3: '앞으로 일직선 돌진 · 사거리 최장 · 좌우 1칸 이동도 가능' },
  walk: { role: '기습형 점퍼', trait: '사이의 말을 뛰어넘는 점프 · 넓은 앞줄 커버' },
  insaner: { role: '흡수형 광전사', trait: '적을 잡으면 그 말의 이동 범위만 흡수 (특성·스킬은 흡수 안 함)', trait3: '적을 잡으면 그 말의 이동 범위만 흡수 · 잡은 뒤 한 번 더 이동 (턴당 1번)' },
  brutile: { role: '저주형 마녀', trait: '한 칸씩 걷는 느린 마녀 · 성급이 오를수록 사방으로' },
  michelle: { role: '함정형 견제수', trait: '뒤로 물러날 때 인형 함정(한 판 3개) · 밟은 상대는 1턴 속박' },
  picker: { role: '돌파형 사냥꾼', trait: '대각선 콩콩 점프 · 막히지 않고 지나는 적을 모두 잡음 · 상대 함정에서 멈춤' },
  rakaeli: { role: '변신형 점퍼', trait: '앞쪽 블록으로 점프 · 타천하면 2번 이동하는 동안 점프 범위가 크게 넓어짐' },
  rampid: { role: '돌격형 질주자', trait: '앞 · 앞쪽 대각선 세 갈래 발톱으로 직진 · 끝줄에서 방향 전환' },
  larhen: { role: '도약형 암살자', trait: '사이의 말을 뛰어넘는 H자 점프 · 좌우와 대각선', trait3: '사이의 말을 뛰어넘는 점프 · 세로로 한 칸 더 긴 H자 (양옆 줄 앞뒤 2칸)' },
  volkonov: { role: '지원형 음유시인', trait: '상하좌우 이동 · 스킬 선율로 아군 전원 상하좌우 이동 +1칸' },
  verish: { role: '관통형 질주자', trait: '앞 · 좌우로 슬라이드하며 지나는 적을 모두 잡고 뚫고 감 · 아군 · 불모지 · 벽에는 막힘', trait3: '앞 · 좌우 · 뒤로 관통 슬라이드 · 지나는 적을 모두 잡음 · 아군 · 불모지 · 벽에는 막힘' },
  midos: { role: '암살형 망령', trait: '좌 · 우 · 앞으로 직진 (뒤 · 대각선 불가) · 스킬 그림자 도약으로 보드의 빈 칸 어디로든 순간이동' },
};

/**
 * Numeric "reach" per level for the stat bar: squares reachable on an open board, taken from the
 * engine's move generator (the movement diagram's targets), so it can never drift from the rules.
 * `awake` is Rakaeli's transformed form.
 */
function reachCount(id: CharacterId, lv: Level, awake = false): number {
  return movementReach(id, lv, awake);
}

/** The unit's illustration at a level (the board is top-down only for now, so no 3D renders). */
function unitPreview(id: CharacterId, lv: Level, size = 84, awake = false) {
  return unitArt(id, lv, { size, cls: 'grade-pick__art', awake });
}

/** Which form a two-form card shows (Rakaeli: 기본 / 타천). Per screen visit, default base. */
const formShown = new Map<CharacterId, 'base' | 'awake'>();

/** Everything a card's look depends on; a card is rebuilt only when its key changes. */
function cardKey(p: Profile, id: CharacterId): string {
  return `${tileKey(p, id)}|${formShown.get(id) ?? 'base'}`;
}

/** Everything a grid tile's look depends on. */
function tileKey(p: Profile, id: CharacterId): string {
  return `${p.owned[id]}|${p.grades[id]}|${upgradeBlocker(p, id) ?? 'ok'}|${buyBlocker(p, id) ?? 'ok'}`;
}

export function collectionScreen(router: Router): Screen {
  const bag = new Disposables();
  formShown.clear();
  const bar = topBar(router);
  bag.add(bar.dispose);
  const grid = h('div', { class: 'cgrid' });
  const headSub = h('span', { class: 'page-head__sub' });
  const list = h(
    'div',
    { class: 'scroll-body collection__body' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-head__title' }, '캐릭터'), headSub),
    grid,
  );
  const el = h('div', { class: 'collection' }, bar.el, list);
  let justPicked: CharacterId | null = null;
  let busy = false;
  /** The open detail sheet: which character, the card shown and the key it was built with. */
  let detail: { id: CharacterId; sheet: SheetHandle; host: HTMLElement; key: string } | null = null;

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
      // The confirm dialog took focus; hand it back to the card in the sheet.
      if (detail && !detail.sheet.el.contains(document.activeElement)) {
        const target = detail.host.querySelector<HTMLElement>('[data-action="upgrade"]:not([disabled]), .grade-pick__btn.is-active, [data-action="buy"]:not([disabled])');
        (target ?? detail.sheet.el).focus({ preventScroll: true });
      }
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

  /** 기본 / 타천 switch of a two-form character (the card is rebuilt in place). */
  const formToggle = (id: CharacterId, awake: boolean) => {
    const def = CHARACTERS[id];
    const pick = (to: 'base' | 'awake') => {
      if ((formShown.get(id) ?? 'base') === to) return;
      formShown.set(id, to);
      sfx(to === 'awake' ? 'levelup' : 'select');
      haptic('light');
      update();
    };
    const btn = (to: 'base' | 'awake', label: string) =>
      h(
        'button',
        {
          class: `form-toggle__btn${(to === 'awake') === awake ? ' is-active' : ''}${to === 'awake' ? ' form-toggle__btn--awake' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': String((to === 'awake') === awake),
          'data-action': 'form',
          'data-form': to,
          onclick: () => pick(to),
        },
        label,
      );
    return h('div', { class: 'form-toggle', role: 'tablist', 'aria-label': `${def.nameKo} 형태` }, btn('base', '기본'), btn('awake', def.skill?.nameKo ?? '변신'));
  };

  const card = (id: CharacterId) => {
    const p = getProfile();
    const def = CHARACTERS[id];
    const owned = p.owned[id];
    const locked = owned === 0;
    const grade = p.grades[id];
    const levels: Level[] = [1, 2, 3];
    const picked = justPicked === id;
    // Rakaeli has two forms: the card shows the one picked with the 기본 / 타천 switch.
    const twoForms = !!def.awakeDescKo;
    const awake = twoForms && formShown.get(id) === 'awake';
    const descOf = (lv: Level) => (awake ? def.awakeDescKo![lv - 1] : def.descKo[lv - 1]);
    const reachMax = Math.max(reachCount(id, 3), reachCount(id, 3, twoForms)) > 12 ? 24 : 12;
    return h(
      'article',
      {
        class: `unit-card unit-card--sheet rarity-${def.rarity} tier-${grade}${picked ? ' is-picked' : ''}${locked ? ' is-locked' : ''}${awake ? ' is-awake' : ''}`,
        'data-character': id,
        'data-level': grade,
        'data-owned': owned,
        'data-form': twoForms ? (awake ? 'awake' : 'base') : undefined,
      },
      h(
        'header',
        { class: 'unit-card__banner' },
        h('img', { class: 'unit-card__art', src: cardArtUrl(id, grade, awake), alt: '', decoding: 'async', draggable: 'false', onerror: artMissing }),
        h('div', { class: 'unit-card__shine', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'unit-card__title' },
          h('div', { class: 'unit-card__role' }, h('b', null, TIER_TITLE[id][grade - 1]), ' · ', ROLE[id].role),
          h('h2', { class: 'unit-card__name', id: `unit-card-name-${id}` }, def.nameKo, h('span', { class: 'unit-card__en' }, def.nameEn)),
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
      twoForms ? formToggle(id, awake) : null,
      actionRow(p, id),
      h('p', { class: 'unit-card__trait' }, icon('info', 14), (grade === 3 && ROLE[id].trait3) || ROLE[id].trait),
      def.passiveKo ? h('p', { class: 'unit-card__passive' }, icon('magic', 14), h('span', null, h('b', null, '패시브 · 흡수'), ' ', def.passiveKo)) : null,
      def.trait ? h('p', { class: 'unit-card__passive unit-card__trait' }, icon('magic', 14), h('span', null, h('b', null, `특성 · ${def.trait.nameKo}`), ' ', def.trait.descKo)) : null,
      def.skill
        ? h('p', { class: 'unit-card__passive unit-card__skill' }, icon('magic', 14), h('span', null, h('b', null, `스킬 · ${def.skill.nameKo}`), ' ', def.skill.descKo[grade - 1], ' · 4턴째부터 한 판에 1번, 자기장이 좁혀오면 금지'))
        : null,
      h('div', { class: 'unit-card__stats' }, statBar(awake ? `${def.skill?.nameKo ?? ''} 이동 범위` : '이동 범위', reachCount(id, grade, awake), reachMax)),
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
                    onclick: (e: Event) => {
                      if (have) pickGrade(id, lv);
                      else {
                        sfx('tap');
                        (e.currentTarget as HTMLElement).closest('.unit-card')?.querySelector<HTMLElement>('[data-action="upgrade"]')?.focus({ preventScroll: true });
                      }
                    },
                  },
                  unitPreview(id, lv, 46, awake),
                  h('span', { class: 'grade-pick__stars', 'aria-hidden': 'true' }, starsOf(lv)),
                  h('span', { class: 'grade-pick__name' }, `${lv}성`),
                  have ? movementDiagram(id, lv, { cell: 6, awake }) : h('span', { class: 'grade-pick__cost' }, icon('lock', 12), tokenIcon(14), h('b', { class: 't-num' }, String(stepCost))),
                );
              }),
            ),
            h('p', { class: 'grade-pick__desc' }, descOf(grade)),
          ),
      h(
        'table',
        { class: 'ability-table' },
        h('caption', { class: 'sr-only' }, `${def.nameKo}${awake ? ` ${def.skill?.nameKo ?? ''}` : ''} 성급별 능력`),
        h('tbody', null,
          levels.map((lv) =>
            h(
              'tr',
              { class: lv === grade && !locked ? 'is-current' : '' },
              h('th', { scope: 'row' }, `${lv}성`),
              h('td', { class: 'ability-table__desc' }, descOf(lv)),
              h('td', { class: 'ability-table__diagram' }, movementDiagram(id, lv, { cell: 6, awake })),
            ),
          ),
        ),
      ),
    );
  };

  // ---- Grid ------------------------------------------------------------------------------

  /** Owned first (roster order), then locked ones in the order their arenas open them. */
  const order = () => {
    const p = getProfile();
    const lockIndex = (id: CharacterId) => unlockArenaOf(id)?.index ?? 99;
    return [...CHARACTER_IDS].sort((a, b) => Number(!isOwned(p, a)) - Number(!isOwned(p, b)) || (isOwned(p, a) ? 0 : lockIndex(a) - lockIndex(b)));
  };

  /** One portrait tile (a button that opens the detail sheet). */
  const tile = (id: CharacterId, index: number) => {
    const p = getProfile();
    const def = CHARACTERS[id];
    const owned = p.owned[id];
    const locked = owned === 0;
    const grade = p.grades[id];
    const canUpgrade = !locked && upgradeBlocker(p, id) === null;
    const buy = locked ? buyBlocker(p, id) : null;
    const canBuy = locked && buy === null;
    const opens = unlockArenaOf(id);
    const price = priceOf(id);
    const levels: Level[] = [1, 2, 3];

    // What sits on the frame's bottom edge: the owned stars, or what it takes to unlock.
    let edge: HTMLElement;
    let lockNote: string;
    if (!locked) {
      edge = h('span', { class: 'ctile__stars', 'aria-hidden': 'true' }, levels.map((lv) => icon('star', 20, lv <= owned ? 'is-on' : '')));
      lockNote = '';
    } else if (buy === 'arena' && opens) {
      edge = h('span', { class: 'ctile__price ctile__price--arena', 'aria-hidden': 'true' }, icon('lock', 12), `${opens.index} 전장`);
      lockNote = `${opens.index} 전장에서 열림`;
    } else if (buy === 'unavailable' || !opens) {
      edge = h('span', { class: 'ctile__price ctile__price--arena', 'aria-hidden': 'true' }, '곧 공개');
      lockNote = '곧 공개';
    } else {
      edge = h('span', { class: `ctile__price${canBuy ? ' is-ready' : ''}`, 'aria-hidden': 'true' }, essenceIcon(15), h('b', { class: 't-num' }, String(price)));
      lockNote = canBuy ? `구매 가능, 에센셜 ${price}` : `에센셜 ${price} 필요`;
    }
    const badge = canUpgrade
      ? h('span', { class: 'ctile__badge ctile__badge--up', 'aria-hidden': 'true' }, icon('up', 12), '강화 가능')
      : canBuy
        ? h('span', { class: 'ctile__badge ctile__badge--buy', 'aria-hidden': 'true' }, '구매 가능')
        : null;
    const label = locked
      ? `${def.nameKo}, ${RARITY_LABEL[def.rarity]}, 미보유, ${lockNote}`
      : `${def.nameKo}, ${RARITY_LABEL[def.rarity]}, ${owned}성 보유${grade < owned ? `, ${grade}성 출전` : ''}${canUpgrade ? ', 강화 가능' : ''}`;
    return h(
      'button',
      {
        class: `ctile rarity-${def.rarity} tier-${owned || 1}${locked ? ' is-locked' : ''}`,
        type: 'button',
        style: `--i:${index}`,
        'data-character': id,
        'data-owned': owned,
        'data-level': grade,
        'aria-label': `${label}. 상세 보기`,
        'aria-haspopup': 'dialog',
        onclick: () => openDetail(id),
      },
      h(
        'span',
        { class: 'ctile__frame' },
        h(
          'span',
          { class: 'ctile__art' },
          h('img', { src: faceUrl(id, grade), alt: '', decoding: 'async', draggable: 'false', onerror: artMissing }),
          locked ? h('span', { class: 'ctile__lock', 'aria-hidden': 'true' }, icon('lock', 22)) : null,
        ),
        edge,
        badge,
      ),
      h('span', { class: 'ctile__name', 'aria-hidden': 'true' }, def.nameKo),
    );
  };

  // Key each rendered tile was built with, so a profile change only rebuilds the tiles that changed.
  const shown = new Map<CharacterId, string>();
  let orderKey = '';
  let ownedBefore = new Set<CharacterId>();

  const syncHead = () => {
    const p = getProfile();
    const n = CHARACTER_IDS.filter((id) => isOwned(p, id)).length;
    headSub.textContent = `보유 ${n} / ${CHARACTER_IDS.length} · ${arenaForRating(p.rating).index} 전장`;
  };

  const renderGrid = () => {
    const p = getProfile();
    const ids = order();
    orderKey = ids.join();
    const hadFocus = grid.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.character : undefined;
    replaceChildren(grid, ids.map((id, i) => tile(id, i)));
    for (const id of CHARACTER_IDS) shown.set(id, tileKey(p, id));
    // A character that just joined pops in at its new place.
    for (const id of ids) if (isOwned(p, id) && ownedBefore.size > 0 && !ownedBefore.has(id)) grid.querySelector(`[data-character="${id}"]`)?.classList.add('is-new');
    ownedBefore = new Set(ids.filter((id) => isOwned(p, id)));
    syncHead();
    if (hadFocus) grid.querySelector<HTMLElement>(`[data-character="${hadFocus}"]`)?.focus({ preventScroll: true });
    // Entrance animation only on first paint (later re-renders must not replay it).
    if (!grid.classList.contains('is-settled')) bag.timeout(() => grid.classList.add('is-settled'), 900);
  };

  // ---- Detail sheet ------------------------------------------------------------------------

  const openDetail = (id: CharacterId) => {
    if (detail) return;
    sfx('page');
    haptic('light');
    const host = h('div', { class: 'unit-detail' }, card(id));
    const sheet = showBottomSheet(host, { label: `${CHARACTERS[id].nameKo} 상세`, className: 'sheet--detail', closeButton: true, draggable: true });
    const mine = { id, sheet, host, key: cardKey(getProfile(), id) };
    detail = mine;
    justPicked = null;
    void sheet.closed.then(() => {
      if (detail === mine) detail = null;
      formShown.delete(id);
      // The tile may have been rebuilt (a purchase re-sorts the grid): focus the current one.
      if (!bag.isDisposed && !grid.contains(document.activeElement)) grid.querySelector<HTMLElement>(`[data-character="${id}"]`)?.focus({ preventScroll: true });
    });
  };
  bag.add(() => detail?.sheet.close());

  /** Rebuild the open card in place when what it shows changed (scroll and focus survive). */
  const updateDetail = () => {
    if (!detail) return;
    const k = cardKey(getProfile(), detail.id);
    if (k === detail.key) return;
    const old = detail.host.firstElementChild as HTMLElement | null;
    const scroller = detail.host.closest<HTMLElement>('.sheet__content');
    const top = scroller?.scrollTop ?? 0;
    // The control that had focus, found again in the rebuilt card by what it does.
    const at = old && old.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const sel = at?.dataset.action
      ? `[data-action="${at.dataset.action}"]${at.dataset.grade ? `[data-grade="${at.dataset.grade}"]` : ''}${at.dataset.form ? `[data-form="${at.dataset.form}"]` : ''}`
      : null;
    const next = card(detail.id);
    if (old) old.replaceWith(next);
    else detail.host.appendChild(next);
    detail.key = k;
    if (scroller) scroller.scrollTop = top;
    if (at) {
      // After an upgrade or purchase its button is gone: the active grade takes focus instead.
      const target = (sel ? next.querySelector<HTMLElement>(`${sel}:not([disabled])`) : null) ?? next.querySelector<HTMLElement>('.grade-pick__btn.is-active');
      if (target) target.focus({ preventScroll: true });
      else detail.sheet.el.focus({ preventScroll: true });
    }
  };

  /**
   * Swap only the changed tile(s) in place, then the open card. Rebuilding everything would reset
   * the scroll position and drop focus on every grade pick.
   */
  const update = () => {
    const p = getProfile();
    if (order().join() !== orderKey) {
      // A purchase moved a tile from the locked group to the owned one.
      const top = list.scrollTop;
      renderGrid();
      list.scrollTop = top;
    } else {
      for (const id of CHARACTER_IDS) {
        const k = tileKey(p, id);
        if (shown.get(id) === k) continue;
        const old = grid.querySelector<HTMLElement>(`[data-character="${id}"]`);
        if (!old) {
          renderGrid();
          break;
        }
        const hadFocus = old === document.activeElement;
        const next = tile(id, Number(old.style.getPropertyValue('--i')) || 0);
        if (old.dataset.owned === '0' && isOwned(p, id)) next.classList.add('is-new');
        old.replaceWith(next);
        shown.set(id, k);
        if (hadFocus) next.focus({ preventScroll: true });
      }
    }
    ownedBefore = new Set(CHARACTER_IDS.filter((id) => isOwned(p, id)));
    syncHead();
    updateDetail();
    justPicked = null;
  };

  renderGrid();
  if (prefersReducedMotion()) grid.classList.add('is-settled');
  bag.add(subscribeProfile(update));
  return { el, mount: () => playHomeMusic(), dispose: () => bag.dispose() };
}
