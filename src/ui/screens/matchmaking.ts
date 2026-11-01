import type { Difficulty } from '../../ai/bot';
import { CHARACTER_IDS, validateFormation } from '../../engine';
import { PACING } from '../../meta/economy';
import { createOpponent, DIFFICULTY_LABEL } from '../../meta/opponent';
import { getProfile, levelsOf } from '../../meta/profile';
import { randInt, defaultRng } from '../../meta/rng';
import { pieceToken } from '../components/piece';
import { toast } from '../components/toast';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';

export function matchmakingScreen(router: Router, params: { difficulty: Difficulty }): Screen {
  const bag = new Disposables();
  const profile = getProfile();
  const difficulty = params.difficulty;
  const levels = levelsOf(profile);
  const playerFormation = validateFormation(profile.formation).ok ? profile.formation : null;

  const stage = h('div', { class: 'mm__stage', 'aria-live': 'polite' });
  const el = h(
    'main',
    { class: 'mm' },
    stage,
    h(
      'div',
      { class: 'mm__footer' },
      h('button', { class: 'btn btn--text', type: 'button', 'data-action': 'cancel', onclick: () => router.home() }, '취소'),
    ),
  );

  const searching = () =>
    replaceChildren(
      stage,
      h(
        'div',
        { class: 'radar', 'aria-hidden': 'true' },
        h('span', { class: 'radar__ring' }),
        h('span', { class: 'radar__ring radar__ring--2' }),
        h('span', { class: 'radar__ring radar__ring--3' }),
        h('span', { class: 'radar__core' }, icon('person', 32)),
      ),
      h('h2', { class: 'mm__title' }, '매칭 중…'),
      h('p', { class: 'mm__sub' }, `난이도 ${DIFFICULTY_LABEL[difficulty]} · 비슷한 실력의 상대를 찾고 있어요`),
    );

  const found = (name: string, oppLevels: Record<string, number>) =>
    replaceChildren(
      stage,
      h(
        'div',
        { class: 'versus' },
        h(
          'div',
          { class: 'versus__side' },
          h('span', { class: 'avatar avatar--blue avatar--lg' }, icon('person', 32)),
          h('span', { class: 'versus__name' }, '나'),
          h('div', { class: 'versus__pieces' }, CHARACTER_IDS.map((id) => pieceToken(id, levels[id], 0, 'xs'))),
        ),
        h('span', { class: 'versus__vs' }, 'VS'),
        h(
          'div',
          { class: 'versus__side' },
          h('span', { class: 'avatar avatar--red avatar--lg' }, icon('bot', 32)),
          h('span', { class: 'versus__name', 'data-opponent': name }, name),
          h(
            'div',
            { class: 'versus__pieces' },
            CHARACTER_IDS.map((id) => pieceToken(id, (oppLevels[id] ?? 1) as 1 | 2 | 3, 1, 'xs')),
          ),
        ),
      ),
      h('h2', { class: 'mm__title mm__title--found' }, '상대 발견!'),
      h('p', { class: 'mm__sub' }, h('span', { class: 'chip chip--outline' }, icon('lock', 14), '상대 진형 비공개'), ' 곧 대전이 시작됩니다'),
    );

  return {
    el,
    mount() {
      if (!profile.formationSaved || !playerFormation) {
        toast('저장된 진형이 없어 추천 배치로 대전합니다', { duration: 2600 });
      }
      searching();
      const opp = createOpponent(difficulty, levels);
      const search = randInt(defaultRng, PACING.searchMinMs, PACING.searchMaxMs);
      bag.timeout(() => {
        found(opp.name, opp.levels);
        bag.timeout(() => {
          router.navigate('game', {
            difficulty,
            opponentName: opp.name,
            playerFormation: playerFormation ?? profile.formation,
            botFormation: opp.formation,
          });
        }, PACING.foundHoldMs);
      }, search);
    },
    dispose: () => bag.dispose(),
  };
}
