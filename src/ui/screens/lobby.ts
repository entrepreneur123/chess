import type { Difficulty } from '../../ai/bot';
import { CHARACTERS, CHARACTER_IDS } from '../../engine';
import { APP_NAME, APP_TAGLINE } from '../../meta/economy';
import { DIFFICULTY_LABEL } from '../../meta/opponent';
import { freeBoxRemainingMs, getProfile, levelUpsAvailable, subscribeProfile, updateProfile } from '../../meta/profile';
import { formationGrid } from '../components/formationGrid';
import { showSettings } from '../components/settingsSheet';
import { isTutorialOpen, showTutorial } from '../components/tutorial';
import { coinChip, gemChip, pieceToken, rarityChip } from '../components/piece';
import { Disposables, h, replaceChildren } from '../dom';
import { icon, type IconName } from '../icons';
import type { Router, Screen } from '../router';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const DIFF_SUB: Record<Difficulty, string> = { easy: '입문', normal: '표준', hard: '고수' };

/** Decorative floating particles for the lobby backdrop (pure CSS animation, GPU-cheap). */
function backdrop(): HTMLElement {
  const orbs: HTMLElement[] = [];
  for (let i = 0; i < 14; i++) {
    orbs.push(h('i', { class: 'lobby-bg__p', style: `--i:${i};--x:${(i * 37) % 100}%;--d:${6 + (i % 5) * 1.7}s;--s:${3 + (i % 4)}px` }));
  }
  return h('div', { class: 'lobby-bg', 'aria-hidden': 'true' }, h('div', { class: 'lobby-bg__grid' }), h('div', { class: 'lobby-bg__glow' }), orbs);
}

/** The GRID CLASH wordmark (SVG-free, pure type + CSS). */
export function wordmark(size: 'md' | 'lg' = 'lg'): HTMLElement {
  const [a, b] = APP_NAME.split(' ');
  return h(
    'div',
    { class: `wordmark wordmark--${size}`, role: 'img', 'aria-label': APP_NAME },
    h('span', { class: 'wordmark__a' }, a),
    h('span', { class: 'wordmark__b' }, b),
  );
}

export function lobbyScreen(router: Router): Screen {
  const bag = new Disposables();
  const el = h('main', { class: 'lobby' });

  const render = () => {
    const p = getProfile();
    const ups = levelUpsAvailable(p);
    const freeReady = freeBoxRemainingMs(p) === 0;

    const seg = h(
      'div',
      { class: 'diff', role: 'radiogroup', 'aria-label': '난이도' },
      DIFFS.map((d, i) =>
        h(
          'button',
          {
            class: `diff__btn diff__btn--${d}${p.difficulty === d ? ' is-active' : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': p.difficulty === d ? 'true' : 'false',
            'data-difficulty': d,
            onclick: () => updateProfile((q) => ({ ...q, difficulty: d })),
          },
          h('span', { class: 'diff__stars', 'aria-hidden': 'true' }, '★'.repeat(i + 1)),
          h('span', { class: 'diff__label' }, DIFFICULTY_LABEL[d]),
          h('span', { class: 'diff__sub' }, DIFF_SUB[d]),
        ),
      ),
    );

    const menuTile = (name: IconName, label: string, sub: string, tone: string, onclick: () => void, badge?: string, testId?: string) =>
      h(
        'button',
        { class: `menu-tile menu-tile--${tone}`, type: 'button', onclick, 'data-nav': testId },
        h('span', { class: 'menu-tile__icon' }, icon(name, 26)),
        h('span', { class: 'menu-tile__label' }, label),
        h('span', { class: 'menu-tile__sub' }, sub),
        badge ? h('span', { class: 'badge', 'aria-label': badge }, badge) : null,
      );

    replaceChildren(
      el,
      backdrop(),
      h(
        'header',
        { class: 'lobby__top' },
        h(
          'div',
          { class: 'wallet' },
          h('button', { class: 'wallet__btn', type: 'button', 'aria-label': '상점에서 코인 얻기', onclick: () => router.navigate('shop') }, coinChip(p.coins), h('span', { class: 'wallet__plus' }, '+')),
          h('button', { class: 'wallet__btn', type: 'button', 'aria-label': '상점에서 보석 얻기', onclick: () => router.navigate('shop') }, gemChip(p.gems), h('span', { class: 'wallet__plus' }, '+')),
        ),
        h(
          'button',
          { class: 'icon-btn icon-btn--glass', type: 'button', 'aria-label': '설정', 'data-action': 'settings', onclick: () => showSettings() },
          icon('settings'),
        ),
      ),
      h(
        'div',
        { class: 'scroll-body lobby__body' },
        h(
          'section',
          { class: 'logo-block' },
          wordmark('lg'),
          h('p', { class: 'logo-block__tag' }, APP_TAGLINE),
        ),
        h(
          'section',
          { class: 'play-card' },
          h('div', { class: 'play-card__label' }, h('span', null, '난이도 선택')),
          seg,
          h(
            'button',
            {
              class: 'btn btn--play btn--block',
              type: 'button',
              'data-action': 'start-match',
              onclick: () => router.navigate('matchmaking', { difficulty: getProfile().difficulty }),
            },
            icon('play', 26),
            h('span', { class: 'btn--play__text' }, '대전 시작'),
          ),
          h(
            'div',
            { class: 'play-card__foot' },
            h(
              'div',
              { class: 'record' },
              h('span', { class: 'record__item record__item--w' }, h('b', null, String(p.stats.wins)), '승'),
              h('span', { class: 'record__item record__item--l' }, h('b', null, String(p.stats.losses)), '패'),
              h('span', { class: 'record__item' }, h('b', null, String(p.stats.draws)), '무'),
            ),
            h(
              'button',
              { class: 'help-chip', type: 'button', 'data-action': 'how-to-play', onclick: () => void showTutorial() },
              icon('help', 16),
              '게임 방법',
            ),
          ),
        ),
        h(
          'section',
          {
            class: 'card card--tap squad',
            role: 'button',
            tabindex: '0',
            'aria-label': '현재 진형 편집',
            onclick: () => router.navigate('formation'),
            onkeydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                router.navigate('formation');
              }
            },
          },
          h(
            'div',
            { class: 'section-head' },
            h('h3', { class: 'section-title' }, icon('grid', 18), '내 분대 · 진형'),
            h('span', { class: 'section-link' }, p.formationSaved ? '편집' : '추천 배치 사용 중', icon('chevron', 18)),
          ),
          h(
            'div',
            { class: 'squad__roster' },
            CHARACTER_IDS.map((id) =>
              h(
                'div',
                { class: `squad__unit rarity-${CHARACTERS[id].rarity}` },
                pieceToken(id, p.characters[id].level, 0, 'md'),
                h('span', { class: 'squad__name' }, CHARACTERS[id].nameKo),
                h('span', { class: 'squad__meta' }, rarityChip(CHARACTERS[id].rarity), h('span', { class: 'lv-pill' }, `Lv.${p.characters[id].level}`)),
              ),
            ),
          ),
          h('div', { class: 'squad__grid' }, h('div', { class: 'enemy-hint enemy-hint--sm' }, icon('up', 14), '적 방향'), formationGrid(p.formation, { mini: true })),
        ),
        h(
          'nav',
          { class: 'menu-grid', 'aria-label': '메뉴' },
          menuTile(
            'cards',
            '캐릭터',
            ups.length ? `레벨업 가능 ${ups.length}` : '도감 · 레벨업',
            'violet',
            () => router.navigate('collection'),
            ups.length ? String(ups.length) : undefined,
            'collection',
          ),
          menuTile('grid', '진형 편성', '배치 구역 설정', 'blue', () => router.navigate('formation'), undefined, 'formation'),
          menuTile('store', '상점', freeReady ? '무료 상자 준비됨' : '상자 · 보석', 'gold', () => router.navigate('shop'), freeReady ? '!' : undefined, 'shop'),
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
