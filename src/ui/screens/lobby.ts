/**
 * Lobby (the 대전 tab): player identity + settings on top, the current-arena showcase in the
 * centre (arena art, a holo grid floor and the fielded squad), then the difficulty segmented
 * control directly above the gold "대전 시작" CTA. The tab bar (router chrome) sits below.
 *
 * The static skeleton (arena art, figures) is built once so images and entrance animations don't
 * replay; only the data-driven slots re-render on profile changes.
 */
import type { Difficulty } from '../../ai/bot';
import { CHARACTERS, CHARACTER_IDS, type CharacterId, type Level, type Rarity } from '../../engine';
import { APP_NAME } from '../../meta/economy';
import { DIFFICULTY_LABEL } from '../../meta/opponent';
import { getProfile, squadOfProfile, subscribeProfile, updateProfile } from '../../meta/profile';
import { currentArena, nextArena } from '../arenas';
import { showSettings } from '../components/settingsSheet';
import { isTutorialOpen, showTutorial } from '../components/tutorial';
import { unitArt } from '../components/piece';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/** The fielded squad ordered for the key visual: [featured (highest rarity), left, right]. */
function heroOrder(): CharacterId[] {
  return [...squadOfProfile(getProfile())].sort((a, b) => RARITY_RANK[CHARACTERS[b].rarity] - RARITY_RANK[CHARACTERS[a].rarity]).slice(0, 3);
}

const artSrc = (id: CharacterId, lv: Level) => `./chars/${id}-lv${lv}.jpg`;

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
          h('img', { src: artSrc(id, levels[id]), alt: '', decoding: 'async', draggable: 'false', fetchpriority: pos === 'c' ? 'high' : undefined }),
        )
      : null;
  return h('div', { class: 'arena__stage', 'aria-hidden': 'true' }, fig(left, 'l', 1), fig(right, 'r', 2), fig(main, 'c', 0));
}

export function lobbyScreen(router: Router): Screen {
  const bag = new Disposables();
  const el = h('main', { class: 'lobby' });
  const arena = currentArena();
  const next = nextArena();

  // ---- dynamic slots
  const identHost = h('div', { class: 'ident' });
  const diffHost = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '난이도' });
  let stageHost: HTMLElement = h('div');
  let heroKey = '';

  const playBtn = h(
    'button',
    {
      class: 'btn btn--play btn--block',
      type: 'button',
      'data-action': 'start-match',
      onclick: () => router.navigate('matchmaking', { difficulty: getProfile().difficulty }),
    },
    icon('swords', 30),
    h('span', { class: 'btn--play__text' }, '대전 시작'),
  );

  const arenaCard = h(
    'section',
    { class: 'arena enter', style: '--i:0', 'aria-label': `현재 전장 · ${arena.name}`, 'data-arena': arena.id },
    h('img', { class: 'arena__art', src: arena.art, alt: '', decoding: 'async', draggable: 'false' }),
    h('div', { class: 'arena__floor', 'aria-hidden': 'true' }, h('div', { class: 'arena__grid' })),
    stageHost,
    h('div', { class: 'arena__shade', 'aria-hidden': 'true' }),
    h('div', { class: 'arena__brand' }, wordmark('md')),
    h(
      'div',
      { class: 'arena__foot' },
      h(
        'div',
        { class: 'arena__plate' },
        h('span', { class: 'arena__eyebrow' }, icon('shield', 12), '현재 전장'),
        h('span', { class: 'arena__name' }, arena.name),
      ),
      // Teaser slot for score-based arenas (none announced yet).
      h(
        'div',
        { class: `arena__next${next ? '' : ' is-locked'}`, 'data-slot': 'next-arena' },
        h('span', { class: 'arena__next-icon' }, icon('lock', 14)),
        h('span', { class: 'arena__next-text' }, h('b', null, '다음 전장'), next ? next.name : '곧 공개'),
      ),
    ),
  );

  replaceChildren(
    el,
    h('div', { class: 'lobby-bg', 'aria-hidden': 'true' }, h('div', { class: 'lobby-bg__aura' })),
    h(
      'header',
      { class: 'lobby__top' },
      identHost,
      h(
        'button',
        { class: 'icon-btn', type: 'button', 'aria-label': '설정', 'data-action': 'settings', onclick: () => showSettings() },
        icon('settings'),
      ),
    ),
    h(
      'div',
      { class: 'scroll-body lobby__body' },
      arenaCard,
      h(
        'section',
        { class: 'play enter', style: '--i:1', 'aria-label': 'AI 대전' },
        diffHost,
        playBtn,
        h(
          'button',
          { class: 'help-link pressable', type: 'button', 'data-action': 'how-to-play', onclick: () => void showTutorial() },
          icon('help', 18),
          '게임 방법',
        ),
      ),
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
    const [featured] = heroOrder();
    const games = p.stats.wins + p.stats.losses + p.stats.draws;
    replaceChildren(
      identHost,
      h('span', { class: 'ident__avatar' }, unitArt(featured, levels[featured], { size: 44 })),
      h(
        'span',
        { class: 'ident__main' },
        h('span', { class: 'ident__name' }, '지휘관'),
        h(
          'span',
          { class: 'ident__record', 'aria-label': `전적 ${p.stats.wins}승 ${p.stats.losses}패 ${p.stats.draws}무` },
          h('span', { class: 'ident__w' }, h('b', null, String(p.stats.wins)), '승'),
          h('span', { class: 'ident__l' }, h('b', null, String(p.stats.losses)), '패'),
          h('span', null, h('b', null, String(p.stats.draws)), '무'),
          games > 0 ? h('span', { class: 'ident__rate' }, `승률 ${Math.round((p.stats.wins / games) * 100)}%`) : null,
        ),
      ),
    );

    replaceChildren(
      diffHost,
      DIFFS.map((d, i) =>
        h(
          'button',
          {
            class: `seg__btn seg__btn--${d}${p.difficulty === d ? ' is-active' : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': p.difficulty === d ? 'true' : 'false',
            'data-difficulty': d,
            onclick: () => {
              if (getProfile().difficulty !== d) updateProfile((q) => ({ ...q, difficulty: d }));
            },
          },
          h('span', { class: 'seg__stars', 'aria-hidden': 'true' }, [0, 1, 2].map((k) => icon('star', 11, k <= i ? 'is-on' : ''))),
          h('span', { class: 'seg__label' }, DIFFICULTY_LABEL[d]),
        ),
      ),
    );
  };

  render();
  bag.add(subscribeProfile(render));
  return {
    el,
    mount() {
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
