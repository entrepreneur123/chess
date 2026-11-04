/**
 * Lobby (the 대전 tab): the progression top bar (rating + arena badge, tokens, essence), the
 * current-arena card in the centre (arena art, holo floor, the fielded squad, rating and a bar to
 * the next arena), then the gold 전장전 CTA and a secondary row with 견습전투 and 던전 (with the
 * daily reward badge). The tab bar (router chrome) sits below.
 *
 * The static skeleton (arena art, figures) is built once so images and entrance animations don't
 * replay; only the data-driven slots re-render on profile changes.
 *
 * Developer mode adds a compact "DEV · 전장 선택" strip under the arena card: six arena chips (card
 * art) plus 자동. A picked arena makes every match (전장전, 견습전투, 던전) play there (backdrop, board
 * theme, music; ranked / casual opponents from its pool) and the arena card previews it. With dev
 * mode off the strip is not in the DOM and the lobby is exactly as before.
 */
import { CHARACTERS, CHARACTER_IDS, type CharacterId, type Level, type Rarity } from '../../engine';
import { APP_NAME } from '../../meta/economy';
import { devArenaOf, getProfile, isDevMode, setDevArena, squadOfProfile, subscribeProfile, updateProfile } from '../../meta/profile';
import { ARENA_DEFS, arenaById, arenaProgress, dungeonRewardAvailable, type ArenaDef, type ArenaId, type DungeonLevel } from '../../meta/progression';
import { preloadArt } from '../backdrops';
import { arenaBadge, topBar } from '../components/currency';
import { artMissing } from '../components/piece';
import { showDungeonPicker } from '../components/dungeonSheet';
import { isTutorialOpen, showTutorial } from '../components/tutorial';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import { playHomeMusic } from '../musicBridge';
import type { Router, Screen } from '../router';

const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
/** Shown when an arena's own card art is missing. */
export const FALLBACK_ARENA_ART = './bg/match.webp';

/** The fielded squad ordered for the key visual: [featured (highest rarity), left, right]. */
function heroOrder(): CharacterId[] {
  return [...squadOfProfile(getProfile())].sort((a, b) => RARITY_RANK[CHARACTERS[b].rarity] - RARITY_RANK[CHARACTERS[a].rarity]).slice(0, 3);
}

const artSrc = (id: CharacterId, lv: Level) => `./chars/${id}-lv${lv}.jpg`;

/** An <img> of arena art that falls back to the generic arena once if the file is missing. */
export function arenaArt(src: string, cls: string): HTMLImageElement {
  const img = h('img', { class: cls, src, alt: '', decoding: 'async', draggable: 'false' });
  img.addEventListener('error', () => {
    if (!img.src.endsWith(FALLBACK_ARENA_ART.slice(1))) img.src = FALLBACK_ARENA_ART;
  });
  return img;
}

/** The GRID CLASH wordmark (pure type + CSS). */
export function wordmark(size: 'md' | 'lg' = 'lg'): HTMLElement {
  const [a, b] = APP_NAME.split(' ');
  return h(
    'div',
    { class: `wordmark wordmark--${size}`, role: 'img', 'aria-label': APP_NAME },
    h('span', { class: 'wordmark__a', 'data-text': a }, a),
    h('span', { class: 'wordmark__b', 'data-text': b }, b),
  );
}

/** The squad standing on the arena floor: featured unit in front, the other two flanking it. */
function squadStage(levels: Record<CharacterId, Level>): HTMLElement {
  const [main, left, right] = heroOrder();
  const fig = (id: CharacterId | undefined, pos: 'l' | 'c' | 'r', i: number) =>
    id
      ? h(
          'div',
          { class: `arena__fig arena__fig--${pos} rarity-${CHARACTERS[id].rarity}`, style: `--i:${i}` },
          h('img', { src: artSrc(id, levels[id]), alt: '', decoding: 'async', draggable: 'false', fetchpriority: pos === 'c' ? 'high' : undefined, onerror: artMissing }),
        )
      : null;
  return h('div', { class: 'arena__stage', 'aria-hidden': 'true' }, fig(left, 'l', 1), fig(right, 'r', 2), fig(main, 'c', 0));
}

/**
 * DEV · 전장 선택: 자동 (normal rules) plus one chip per arena (card art, number, name). Calls
 * `pick` with the arena id, or null for 자동. `sync` marks the current choice.
 */
function devArenaPicker(pick: (id: ArenaId | null) => void): { el: HTMLElement; sync: (id: ArenaId | null) => void } {
  const chip = (id: ArenaId | null, a: ArenaDef | null): HTMLButtonElement =>
    h(
      'button',
      {
        class: `devpick__chip pressable${a ? '' : ' devpick__chip--auto'}`,
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': a ? `${a.index} 전장 ${a.name}` : '자동 (레이팅 기준)',
        'data-action': 'dev-arena',
        'data-arena': id ?? 'auto',
        style: a ? `--chip-accent:${a.accent}` : undefined,
        onclick: () => pick(id),
      },
      a ? arenaArt(a.card, 'devpick__art') : h('span', { class: 'devpick__auto', 'aria-hidden': 'true' }, icon('target', 18)),
      h('span', { class: 'devpick__label' }, a ? h('b', null, String(a.index)) : null, a ? a.name.split(' ')[0] : '자동'),
    );
  const chips = [chip(null, null), ...ARENA_DEFS.map((a) => chip(a.id, a))];
  const el = h(
    'section',
    { class: 'devpick enter', style: '--i:1', 'aria-label': '개발자 모드 · 전장 선택', 'data-dev': 'arena-picker' },
    h('div', { class: 'devpick__head' }, h('span', { class: 'devpick__tag' }, 'DEV'), h('span', { class: 'devpick__title' }, '전장 선택'), h('span', { class: 'devpick__hint' }, '모든 대전 · 던전에 적용')),
    h('div', { class: 'devpick__strip', role: 'radiogroup', 'aria-label': '전장' }, chips),
  );
  const sync = (id: ArenaId | null): void => {
    for (const c of chips) {
      const on = c.dataset.arena === (id ?? 'auto');
      c.setAttribute('aria-checked', String(on));
      c.classList.toggle('is-on', on);
    }
  };
  return { el, sync };
}

export function lobbyScreen(router: Router): Screen {
  const bag = new Disposables();
  const el = h('main', { class: 'lobby' });
  const prog = arenaProgress(getProfile().rating);
  const arena = prog.arena;
  const bar = topBar(router, { onDungeon: () => openDungeon() });
  bag.add(bar.dispose);

  const openDungeon = () => showDungeonPicker((level: DungeonLevel) => router.navigate('matchmaking', { mode: 'dungeon', dungeonLevel: level }));

  // ---- dynamic slots
  const dungeonBadge = h('span', { class: 'mode-btn__badge' });
  let stageHost: HTMLElement = h('div');
  let heroKey = '';

  const playBtn = h(
    'button',
    {
      class: 'btn btn--play btn--block',
      type: 'button',
      'data-action': 'start-match',
      'data-mode': 'ranked',
      onclick: () => router.navigate('matchmaking', { mode: 'ranked' }),
    },
    icon('swords', 30),
    h('span', { class: 'btn--play__text' }, '전장전'),
    h('span', { class: 'btn--play__sub' }, '레이팅 · 에센셜'),
  );

  const casualBtn = h(
    'button',
    { class: 'mode-btn pressable', type: 'button', 'data-action': 'start-casual', onclick: () => router.navigate('matchmaking', { mode: 'casual' }) },
    h('span', { class: 'mode-btn__icon' }, icon('target', 22)),
    h('span', { class: 'mode-btn__main' }, h('span', { class: 'mode-btn__name' }, '견습전투'), h('span', { class: 'mode-btn__sub' }, '레이팅 변동 없음')),
  );
  const dungeonBtn = h(
    'button',
    { class: 'mode-btn mode-btn--dungeon pressable', type: 'button', 'data-action': 'open-dungeon', onclick: openDungeon },
    h('span', { class: 'mode-btn__icon' }, icon('castle', 22)),
    h('span', { class: 'mode-btn__main' }, h('span', { class: 'mode-btn__name' }, '던전'), dungeonBadge),
  );

  const pct = Math.round(prog.progress * 100);
  const cardArt = arenaArt(arena.card, 'arena__art');
  const cardEyebrow = h('span', { class: 'arena__eyebrow' }, arenaBadge(arena, 'sm'), `${arena.index} 전장`);
  const cardName = h('span', { class: 'arena__name' }, arena.name);
  const arenaCard = h(
    'section',
    { class: 'arena enter', style: `--i:0;--arena-accent:${arena.accent}`, 'aria-label': `현재 전장 · ${arena.index} 전장 ${arena.name}`, 'data-arena': arena.id },
    cardArt,
    h('div', { class: 'arena__floor', 'aria-hidden': 'true' }, h('div', { class: 'arena__grid' })),
    stageHost,
    h('div', { class: 'arena__shade', 'aria-hidden': 'true' }),
    h('div', { class: 'arena__brand' }, wordmark('md')),
    h(
      'button',
      { class: 'icon-btn arena__help', type: 'button', 'aria-label': '게임 방법', 'data-action': 'how-to-play', onclick: () => void showTutorial() },
      icon('help', 22),
    ),
    h(
      'div',
      { class: 'arena__foot' },
      h(
        'div',
        { class: 'arena__row' },
        h('div', { class: 'arena__plate' }, cardEyebrow, cardName),
        h('div', { class: 'arena__rating', 'data-rating': getProfile().rating }, h('span', { class: 'arena__rating-label' }, '레이팅'), h('b', { class: 't-num' }, String(getProfile().rating))),
      ),
      h(
        'div',
        { class: 'arena__progress' },
        h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': '다음 전장까지 진행도' }, h('i', { class: 'meter__fill', style: `width:${pct}%` })),
        h(
          'span',
          { class: 'arena__togo' },
          prog.next ? [icon('up', 12), `다음 ${prog.next.name}까지 `, h('b', null, String(prog.toNext))] : [icon('crown', 12), '최고 전장 · 전설'],
        ),
      ),
    ),
  );

  // Developer mode: the arena picker (in the DOM only while dev mode is on).
  const devHost = h('div', { class: 'devpick-host' });
  let devPicker: ReturnType<typeof devArenaPicker> | null = null;
  let shownArena: ArenaId = arena.id;
  /** The arena card shows `a` (the player's own arena, or the DEV pick as a preview). */
  const showArena = (a: ArenaDef, dev: boolean): void => {
    arenaCard.classList.toggle('is-dev-preview', dev);
    if (a.id === shownArena) return;
    shownArena = a.id;
    cardArt.src = a.card;
    replaceChildren(cardEyebrow, arenaBadge(a, 'sm'), `${a.index} 전장`);
    cardName.textContent = a.name;
    arenaCard.style.setProperty('--arena-accent', a.accent);
    arenaCard.dataset.arena = a.id;
    arenaCard.setAttribute('aria-label', `${dev ? 'DEV 미리보기' : '현재 전장'} · ${a.index} 전장 ${a.name}`);
  };
  const renderDev = (): void => {
    const p = getProfile();
    const dev = isDevMode(p);
    if (!dev) {
      if (devPicker) {
        devPicker.el.remove();
        devPicker = null;
      }
      showArena(arenaProgress(p.rating).arena, false);
      return;
    }
    if (!devPicker) {
      devPicker = devArenaPicker((id) => {
        updateProfile((q) => setDevArena(q, id));
        if (id) void preloadArt(arenaById(id).backdrop);
      });
      devHost.append(devPicker.el);
    }
    const picked = devArenaOf(p);
    devPicker.sync(picked);
    showArena(picked ? arenaById(picked) : arenaProgress(p.rating).arena, picked !== null);
  };

  replaceChildren(
    el,
    h('div', { class: 'lobby-bg', 'aria-hidden': 'true' }, h('div', { class: 'lobby-bg__aura' })),
    bar.el,
    h(
      'div',
      { class: 'scroll-body lobby__body' },
      arenaCard,
      devHost,
      h('section', { class: 'play enter', style: '--i:1', 'aria-label': 'AI 대전' }, playBtn, h('div', { class: 'mode-row' }, casualBtn, dungeonBtn)),
    ),
  );

  const renderStage = (levels: Record<CharacterId, Level>) => {
    const key = heroOrder().map((id) => `${id}${levels[id]}`).join('');
    if (key === heroKey) return;
    heroKey = key;
    const nextStage = squadStage(levels);
    stageHost.replaceWith(nextStage);
    stageHost = nextStage;
  };

  const render = () => {
    const p = getProfile();
    const levels = Object.fromEntries(CHARACTER_IDS.map((id) => [id, p.grades[id]])) as Record<CharacterId, Level>;
    renderStage(levels);
    const open = dungeonRewardAvailable(p.dungeon.lastClaimDay);
    dungeonBadge.className = `mode-btn__badge${open ? ' is-open' : ''}`;
    dungeonBadge.dataset.dungeon = open ? 'open' : 'claimed';
    replaceChildren(dungeonBadge, open ? [h('i', { class: 'mode-btn__dot', 'aria-hidden': 'true' }), '오늘 보상 가능'] : [icon('check', 12), '오늘 받음']);
    renderDev();
  };

  render();
  bag.add(subscribeProfile(render));
  return {
    el,
    mount() {
      playHomeMusic();
      // Warm the match backdrop of this arena (or the DEV pick) so the board never pops in.
      bag.timeout(() => void preloadArt(arenaById(devArenaOf(getProfile()) ?? arena.id).backdrop), 1200);
      // First launch: open the how-to-play carousel once the lobby has faded in.
      if (!getProfile().onboarding.tutorialSeen) {
        bag.timeout(() => {
          if (!isTutorialOpen() && !getProfile().onboarding.tutorialSeen) void showTutorial();
        }, 450);
      }
    },
    dispose: () => bag.dispose(),
  };
}
