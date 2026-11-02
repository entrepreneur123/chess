/**
 * Lobby: hero key-visual (the player's squad illustrations), wordmark, a dominant PLAY block with
 * the difficulty picker, the squad strip, and a bottom dock for the meta screens.
 *
 * The static skeleton (backdrop, hero, wordmark) is built once so entrance animations and images
 * don't replay; only the data-driven slots re-render on profile changes.
 */
import type { Difficulty } from '../../ai/bot';
import { CHARACTERS, CHARACTER_IDS, type CharacterId, type Level, type Rarity } from '../../engine';
import { APP_NAME, APP_TAGLINE, MATCH_GEM_REWARD, MATCH_REWARD } from '../../meta/economy';
import { DIFFICULTY_LABEL } from '../../meta/opponent';
import { freeBoxRemainingMs, getProfile, isOwned, levelUpsAvailable, squadOfProfile, subscribeProfile, updateProfile } from '../../meta/profile';
import { formationGrid } from '../components/formationGrid';
import { showSettings } from '../components/settingsSheet';
import { isTutorialOpen, showTutorial } from '../components/tutorial';
import { coinChip, gemChip, rarityChip, unitArt } from '../components/piece';
import { Disposables, h, replaceChildren } from '../dom';
import { icon, type IconName } from '../icons';
import type { Router, Screen } from '../router';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const DIFF_SUB: Record<Difficulty, string> = { easy: '입문', normal: '표준', hard: '고수' };
const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/** Owned characters ordered for the key visual: [featured (highest rarity), left, right]. */
function heroOrder(): CharacterId[] {
  const p = getProfile();
  const owned = CHARACTER_IDS.filter((id) => isOwned(p, id));
  return owned.sort((a, b) => RARITY_RANK[CHARACTERS[b].rarity] - RARITY_RANK[CHARACTERS[a].rarity]).slice(0, 3);
}

const artSrc = (id: CharacterId, lv: Level) => `./chars/${id}-lv${lv}.jpg`;

/** Ambient backdrop: rarity aura, slow light rays, rising embers, and (wide screens) side art. */
function backdrop(levels: Record<CharacterId, Level>): HTMLElement {
  const [, left, right] = heroOrder();
  const embers: HTMLElement[] = [];
  for (let i = 0; i < 16; i++) {
    embers.push(
      h('i', {
        class: 'lobby-bg__ember',
        style: `--x:${(i * 41 + 7) % 100}%;--d:${7 + (i % 5) * 1.9}s;--delay:${-(i * 1.13) % 9}s;--s:${2 + (i % 3)}px;--drift:${(i % 2 ? 1 : -1) * (8 + (i % 4) * 6)}px`,
      }),
    );
  }
  return h(
    'div',
    { class: 'lobby-bg', 'aria-hidden': 'true' },
    h('img', { class: 'lobby-bg__side lobby-bg__side--l', src: artSrc(left, levels[left]), alt: '', decoding: 'async' }),
    h('img', { class: 'lobby-bg__side lobby-bg__side--r', src: artSrc(right, levels[right]), alt: '', decoding: 'async' }),
    h('div', { class: 'lobby-bg__rays' }),
    h('div', { class: 'lobby-bg__aura' }),
    h('div', { class: 'lobby-bg__embers' }, embers),
  );
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

/** Cinematic key visual: featured unit in front, the other two flanking it. */
function heroStage(levels: Record<CharacterId, Level>): HTMLElement {
  const [main, left, right] = heroOrder();
  const fig = (id: CharacterId, pos: 'l' | 'c' | 'r', i: number) =>
    h(
      'div',
      { class: `hero__fig hero__fig--${pos} rarity-${CHARACTERS[id].rarity}`, style: `--i:${i}` },
      h('img', {
        src: artSrc(id, levels[id]),
        alt: '',
        decoding: 'async',
        draggable: 'false',
        fetchpriority: pos === 'c' ? 'high' : undefined,
      }),
    );
  return h(
    'div',
    { class: 'hero__stage', 'aria-hidden': 'true' },
    h('div', { class: 'hero__glow' }),
    fig(left, 'l', 1),
    fig(right, 'r', 2),
    fig(main, 'c', 0),
    h('div', { class: 'hero__floor' }),
  );
}

export function lobbyScreen(router: Router): Screen {
  const bag = new Disposables();
  const el = h('main', { class: 'lobby' });

  // ---- dynamic slots
  const walletHost = h('div', { class: 'wallet' });
  const devHost = h('div', { class: 'lobby__dev' });
  const plateHost = h('div', { class: 'hero__plate' });
  const diffHost = h('div', { class: 'diff', role: 'radiogroup', 'aria-label': '난이도' });
  const rewardHost = h('p', { class: 'play-panel__reward' });
  const recordHost = h('div', { class: 'record' });
  const squadHost = h('div', { class: 'squad__body' });
  const dockHost = h('nav', { class: 'dock menu-grid', 'aria-label': '메뉴' });
  let bgHost: HTMLElement = h('div');
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

  const openFormation = () => router.navigate('formation');
  const squad = h(
    'section',
    {
      class: 'card card--tap squad pressable enter',
      style: '--i:4',
      role: 'button',
      tabindex: '0',
      'aria-label': '현재 진형 편집',
      onclick: openFormation,
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          openFormation();
        }
      },
    },
    squadHost,
  );

  const hero = h('section', { class: 'hero' });

  replaceChildren(
    el,
    bgHost,
    h(
      'header',
      { class: 'lobby__top' },
      walletHost,
      devHost,
      h(
        'button',
        { class: 'icon-btn icon-btn--glass', type: 'button', 'aria-label': '설정', 'data-action': 'settings', onclick: () => showSettings() },
        icon('settings'),
      ),
    ),
    h(
      'div',
      { class: 'scroll-body lobby__body' },
      hero,
      h(
        'section',
        { class: 'play-panel enter', style: '--i:3' },
        h('div', { class: 'play-panel__head' }, h('span', { class: 't-eyebrow' }, 'AI Duel · 1 vs 1'), rewardHost),
        diffHost,
        playBtn,
        h(
          'div',
          { class: 'play-panel__foot' },
          recordHost,
          h(
            'button',
            { class: 'help-chip pressable', type: 'button', 'data-action': 'how-to-play', onclick: () => void showTutorial() },
            icon('help', 18),
            '게임 방법',
          ),
        ),
      ),
      squad,
    ),
    dockHost,
  );

  const renderHero = (levels: Record<CharacterId, Level>) => {
    const key = heroOrder().map((id) => `${id}${levels[id]}`).join('');
    if (key === heroKey) return;
    const first = heroKey === '';
    heroKey = key;
    const nextBg = backdrop(levels);
    bgHost.replaceWith(nextBg);
    bgHost = nextBg;
    const nextStage = heroStage(levels);
    if (first) {
      replaceChildren(
        hero,
        nextStage,
        h('div', { class: 'hero__brand' }, wordmark('lg'), h('p', { class: 'hero__tag' }, h('span', null, APP_TAGLINE))),
        plateHost,
      );
    } else stageHost.replaceWith(nextStage);
    stageHost = nextStage;
  };

  const render = () => {
    const p = getProfile();
    const levels = Object.fromEntries(CHARACTER_IDS.map((id) => [id, p.characters[id].level])) as Record<CharacterId, Level>;
    renderHero(levels);
    const ups = levelUpsAvailable(p);
    const freeReady = freeBoxRemainingMs(p) === 0;
    const [featured] = heroOrder();

    replaceChildren(
      walletHost,
      h('button', { class: 'wallet__btn', type: 'button', 'aria-label': '상점에서 코인 얻기', onclick: () => router.navigate('shop') }, coinChip(p.coins), h('span', { class: 'wallet__plus' }, icon('plus', 16))),
      h('button', { class: 'wallet__btn', type: 'button', 'aria-label': '상점에서 보석 얻기', onclick: () => router.navigate('shop') }, gemChip(p.gems), h('span', { class: 'wallet__plus' }, icon('plus', 16))),
    );
    replaceChildren(devHost, p.dev ? h('span', { class: 'chip chip--dev', title: '개발자 계정' }, 'DEV') : null);

    replaceChildren(
      plateHost,
      h('span', { class: `hero__plate-name rarity-${CHARACTERS[featured].rarity}` }, CHARACTERS[featured].nameKo),
      rarityChip(CHARACTERS[featured].rarity),
      h('span', { class: 'lv-pill' }, `${p.characters[featured].level}성`),
    );

    replaceChildren(
      diffHost,
      DIFFS.map((d, i) =>
        h(
          'button',
          {
            class: `diff__btn diff__btn--${d}${p.difficulty === d ? ' is-active' : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': p.difficulty === d ? 'true' : 'false',
            'data-difficulty': d,
            onclick: () => {
              if (getProfile().difficulty !== d) updateProfile((q) => ({ ...q, difficulty: d }));
            },
          },
          h('span', { class: 'diff__stars', 'aria-hidden': 'true' }, [0, 1, 2].map((k) => icon('star', 13, k <= i ? 'is-on' : ''))),
          h('span', { class: 'diff__label' }, DIFFICULTY_LABEL[d]),
          h('span', { class: 'diff__sub' }, DIFF_SUB[d]),
        ),
      ),
    );

    replaceChildren(
      rewardHost,
      h('span', { class: 'play-panel__reward-label' }, '승리 보상'),
      h('span', { class: 'play-panel__reward-val' }, icon('coin', 16), `+${MATCH_REWARD.win[p.difficulty]}`),
      h('span', { class: 'play-panel__reward-val' }, icon('gem', 16), `+${MATCH_GEM_REWARD[p.difficulty]}`),
    );

    replaceChildren(
      recordHost,
      h('span', { class: 'record__item record__item--w' }, h('b', null, String(p.stats.wins)), '승'),
      h('span', { class: 'record__item record__item--l' }, h('b', null, String(p.stats.losses)), '패'),
      h('span', { class: 'record__item' }, h('b', null, String(p.stats.draws)), '무'),
    );

    replaceChildren(
      squadHost,
      h(
        'div',
        { class: 'section-head' },
        h('h3', { class: 'section-title section-title--display' }, '내 분대'),
        h('span', { class: 'section-link' }, p.formationSaved ? '진형 편집' : '추천 배치 사용 중', icon('chevron', 18)),
      ),
      h(
        'div',
        { class: 'squad__roster' },
        squadOfProfile(p).map((id) =>
          h(
            'div',
            { class: `squad__unit rarity-${CHARACTERS[id].rarity}` },
            unitArt(id, p.characters[id].level, { kind: 'card', size: 96 }),
            h('span', { class: 'squad__name' }, CHARACTERS[id].nameKo),
            h('span', { class: 'squad__meta' }, rarityChip(CHARACTERS[id].rarity)),
          ),
        ),
      ),
      h(
        'div',
        { class: 'squad__grid' },
        h('div', { class: 'enemy-hint enemy-hint--sm' }, icon('up', 14), '적 방향'),
        formationGrid(p.formation, { mini: true }),
      ),
    );

    const tile = (name: IconName, label: string, tone: string, nav: 'collection' | 'formation' | 'shop', badge?: string, i = 0) =>
      h(
        'button',
        { class: `menu-tile menu-tile--${tone} pressable`, type: 'button', 'data-nav': nav, style: `--i:${i}`, onclick: () => router.navigate(nav) },
        h('span', { class: 'menu-tile__icon' }, icon(name, 26)),
        h('span', { class: 'menu-tile__label' }, label),
        badge ? h('span', { class: 'badge', 'aria-label': badge }, badge) : null,
      );
    replaceChildren(
      dockHost,
      tile('cards', '캐릭터', 'violet', 'collection', ups.length ? String(ups.length) : undefined, 0),
      tile('grid', '진형', 'blue', 'formation', undefined, 1),
      tile('chest', '상점', 'gold', 'shop', freeReady ? '!' : undefined, 2),
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
