import type { Difficulty } from '../../ai/bot';
import { CHARACTERS, CHARACTER_IDS } from '../../engine';
import { APP_NAME } from '../../meta/economy';
import { DIFFICULTY_LABEL } from '../../meta/opponent';
import { freeBoxRemainingMs, getProfile, levelUpsAvailable, subscribeProfile, updateProfile } from '../../meta/profile';
import { formationGrid } from '../components/formationGrid';
import { showSettings } from '../components/settingsSheet';
import { isTutorialOpen, showTutorial } from '../components/tutorial';
import { coinChip, pieceToken } from '../components/piece';
import { Disposables, h, replaceChildren } from '../dom';
import { icon, type IconName } from '../icons';
import type { Router, Screen } from '../router';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

export function lobbyScreen(router: Router): Screen {
  const bag = new Disposables();
  const el = h('main', { class: 'lobby' });

  const render = () => {
    const p = getProfile();
    const ups = levelUpsAvailable(p);
    const freeReady = freeBoxRemainingMs(p) === 0;

    const seg = h(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-label': '난이도' },
      DIFFS.map((d) =>
        h(
          'button',
          {
            class: `segmented__btn${p.difficulty === d ? ' is-active' : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': p.difficulty === d ? 'true' : 'false',
            'data-difficulty': d,
            onclick: () => updateProfile((q) => ({ ...q, difficulty: d })),
          },
          p.difficulty === d ? icon('check', 18) : null,
          DIFFICULTY_LABEL[d],
        ),
      ),
    );

    const navTile = (name: IconName, label: string, sub: string, onclick: () => void, badge?: string, testId?: string) =>
      h(
        'button',
        { class: 'nav-tile', type: 'button', onclick, 'data-nav': testId },
        h('span', { class: 'nav-tile__icon' }, icon(name)),
        h('span', { class: 'nav-tile__label' }, label),
        h('span', { class: 'nav-tile__sub' }, sub),
        badge ? h('span', { class: 'badge', 'aria-label': badge }, badge) : null,
      );

    replaceChildren(
      el,
      h(
        'header',
        { class: 'lobby__top' },
        h('div', { class: 'brand' }, h('span', { class: 'brand__mark', 'aria-hidden': 'true' }), h('span', { class: 'brand__name' }, APP_NAME)),
        h(
          'div',
          { class: 'lobby__actions' },
          coinChip(p.coins),
          h(
            'button',
            { class: 'icon-btn', type: 'button', 'aria-label': '설정', 'data-action': 'settings', onclick: () => showSettings() },
            icon('settings'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'scroll-body lobby__body' },
        h(
          'section',
          { class: 'card hero' },
          h(
            'div',
            { class: 'hero__head' },
            h('div', { class: 'hero__eyebrow' }, '1 : 1 전략 대전'),
            h(
              'button',
              { class: 'help-chip', type: 'button', 'data-action': 'how-to-play', onclick: () => void showTutorial() },
              icon('help', 16),
              '게임 방법',
            ),
          ),
          h('h2', { class: 'hero__title' }, '12×12 능력 체스'),
          h(
            'p',
            { class: 'hero__desc' },
            '세 기물의 능력을 조합해 상대의 말을 모두 잡으세요.',
          ),
          h('div', { class: 'hero__label' }, '난이도'),
          seg,
          h(
            'button',
            {
              class: 'btn btn--filled btn--xl',
              type: 'button',
              'data-action': 'start-match',
              onclick: () => router.navigate('matchmaking', { difficulty: getProfile().difficulty }),
            },
            icon('play'),
            '대전 시작',
          ),
          h(
            'div',
            { class: 'hero__stats' },
            h('span', null, h('b', null, String(p.stats.wins)), '승'),
            h('span', null, h('b', null, String(p.stats.losses)), '패'),
            h('span', null, h('b', null, String(p.stats.draws)), '무'),
          ),
        ),
        h(
          'section',
          {
            class: 'card card--tap formation-preview',
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
            h('h3', { class: 'section-title' }, '현재 진형'),
            h('span', { class: 'section-link' }, p.formationSaved ? '편집' : '미설정 · 추천 배치 사용 중', icon('chevron', 18)),
          ),
          h('div', { class: 'enemy-hint enemy-hint--sm' }, icon('up', 14), '적 방향'),
          formationGrid(p.formation, { mini: true }),
          h(
            'div',
            { class: 'roster' },
            CHARACTER_IDS.map((id) =>
              h(
                'div',
                { class: 'roster__item' },
                pieceToken(id, p.characters[id].level, 0, 'sm'),
                h('span', { class: 'roster__name' }, CHARACTERS[id].nameKo),
                h('span', { class: 'roster__lv' }, `Lv.${p.characters[id].level}`),
              ),
            ),
          ),
        ),
        h(
          'nav',
          { class: 'nav-grid', 'aria-label': '메뉴' },
          navTile('grid', '진형 편성', '배치 구역 설정', () => router.navigate('formation'), undefined, 'formation'),
          navTile(
            'cards',
            '캐릭터',
            ups.length ? `레벨업 가능 ${ups.length}` : '레벨 · 능력',
            () => router.navigate('collection'),
            ups.length ? String(ups.length) : undefined,
            'collection',
          ),
          navTile('store', '상점', freeReady ? '무료 상자 준비됨' : '상자 열기', () => router.navigate('shop'), freeReady ? '!' : undefined, 'shop'),
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
