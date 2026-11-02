/**
 * Matchmaking: a short "searching" beat (radar around the player's lead unit + rotating tips),
 * then a split-screen VS card with both sides' key art before the match starts.
 */
import type { Difficulty } from '../../ai/bot';
import { CHARACTERS, squadOf, validateFormation, type CharacterId, type Formation, type Level, type Rarity } from '../../engine';
import { PACING } from '../../meta/economy';
import { createOpponent, DIFFICULTY_LABEL } from '../../meta/opponent';
import { getProfile, levelsOf } from '../../meta/profile';
import { randInt, defaultRng } from '../../meta/rng';
import { pieceToken, unitArt } from '../components/piece';
import { clearToasts, toast } from '../components/toast';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';

const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
const TIPS = [
  '월크는 사이에 있는 말을 뛰어넘어요',
  '마르키는 앞으로 길게 돌진해요. 끝줄에 닿으면 뒤돌아요',
  '사드는 유일하게 뒤로 물러날 수 있어요',
  '60수 동안 잡기가 없으면 남은 전력으로 판정해요',
  '레벨이 오르면 이동 범위가 넓어져요',
  '말이 2개 이하로 줄면 제한시간이 40초, 1개면 20초로 줄어요',
  '한쪽이 1개만 남으면 6턴마다 좌우 바깥 줄이 자기장으로 변해요. 닿으면 즉시 소멸!',
  '전설 인세이너는 잡은 적의 이동 능력을 흡수해요',
  'Lv.3 인세이너는 적을 잡은 직후 한 번 더 움직여요',
  '대전 중 오른쪽 아래 버튼으로 3D 시점과 탑뷰를 바꿀 수 있어요',
];

/** The unit a side "leads" with on the VS card: highest rarity, then highest level. */
function leadUnit(squad: CharacterId[], levels: Record<CharacterId, Level>, exclude?: CharacterId): CharacterId {
  const pool = squad.filter((id) => id !== exclude);
  return (pool.length ? pool : squad).sort(
    (a, b) => RARITY_RANK[CHARACTERS[b].rarity] - RARITY_RANK[CHARACTERS[a].rarity] || levels[b] - levels[a],
  )[0];
}

export function matchmakingScreen(router: Router, params: { difficulty: Difficulty }): Screen {
  const bag = new Disposables();
  const profile = getProfile();
  const difficulty = params.difficulty;
  const levels = levelsOf(profile);
  const playerFormation = validateFormation(profile.formation).ok ? profile.formation : null;
  const mySquad = squadOf(playerFormation ?? profile.formation);
  const myLead = leadUnit(mySquad, levels);

  const stage = h('div', { class: 'mm__stage', 'aria-live': 'polite' });
  const el = h(
    'main',
    { class: 'mm' },
    h('div', { class: 'mm__bg', 'aria-hidden': 'true' }, h('img', { src: `./chars/${myLead}-lv${levels[myLead]}.jpg`, alt: '', decoding: 'async' })),
    stage,
    h(
      'div',
      { class: 'mm__footer' },
      h('button', { class: 'btn btn--tonal btn--sm mm__cancel', type: 'button', 'data-action': 'cancel', onclick: () => router.home() }, icon('close', 18), '취소'),
    ),
  );

  const searching = () => {
    const tip = h('p', { class: 'mm__tip' }, h('b', null, 'TIP'), h('span', null, TIPS[randInt(defaultRng, 0, TIPS.length - 1)]));
    replaceChildren(
      stage,
      h(
        'div',
        { class: 'radar', 'aria-hidden': 'true' },
        h('span', { class: 'radar__sweep' }),
        h('span', { class: 'radar__ring' }),
        h('span', { class: 'radar__ring radar__ring--2' }),
        h('span', { class: 'radar__ring radar__ring--3' }),
        h('span', { class: 'radar__core' }, unitArt(myLead, levels[myLead], { size: 104 })),
      ),
      h('h2', { class: 'mm__title' }, '상대를 찾는 중', h('span', { class: 'mm__dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
      h('p', { class: 'mm__sub' }, h('span', { class: 'chip chip--gold' }, `난이도 ${DIFFICULTY_LABEL[difficulty]}`), '비슷한 실력의 상대를 찾고 있어요'),
      tip,
    );
  };

  const side = (who: 'me' | 'opp', name: string, lv: Record<CharacterId, Level>, owner: 0 | 1, formation: Formation) => {
    // The opponent leads with a different unit than the player so the VS card is a real face-off.
    const squad = squadOf(formation);
    const lead = who === 'me' ? myLead : leadUnit(squad, lv, myLead);
    return h(
      'div',
      { class: `versus__side versus__side--${who}` },
      h('div', { class: 'versus__art' }, h('img', { src: `./chars/${lead}-lv${lv[lead]}.jpg`, alt: '', decoding: 'async', draggable: 'false' })),
      h(
        'div',
        { class: 'versus__plate' },
        h('span', { class: 'versus__eyebrow' }, who === 'me' ? 'BLUE TEAM' : `RED TEAM · AI ${DIFFICULTY_LABEL[difficulty]}`),
        h('span', { class: 'versus__name', 'data-opponent': who === 'opp' ? name : undefined }, name),
        h('div', { class: 'versus__pieces' }, formation.map((s) => pieceToken(s.character, s.level, owner, 'sm'))),
      ),
    );
  };

  const found = (name: string, oppLevels: Record<CharacterId, Level>, oppFormation: Formation) => {
    el.classList.add('is-found');
    clearToasts(); // nothing may cover the VS card
    replaceChildren(
      stage,
      h(
        'div',
        { class: 'versus' },
        side('me', '나', levels, 0, playerFormation ?? profile.formation),
        h('div', { class: 'versus__vs', 'aria-hidden': 'true' }, h('span', null, 'VS')),
        side('opp', name, oppLevels, 1, oppFormation),
      ),
      h(
        'div',
        { class: 'mm__found' },
        h('h2', { class: 'mm__title mm__title--found' }, '상대 발견!'),
        h('p', { class: 'mm__sub' }, h('span', { class: 'chip chip--outline' }, icon('lock', 14), '상대 진형 비공개'), ' 곧 대전이 시작됩니다'),
      ),
    );
  };

  return {
    el,
    mount() {
      if (!profile.formationSaved || !playerFormation) {
        toast('저장된 진형이 없어 추천 배치로 대전합니다', { duration: 2600 });
      }
      searching();
      const opp = createOpponent(difficulty, levels, defaultRng, mySquad);
      const search = randInt(defaultRng, PACING.searchMinMs, PACING.searchMaxMs);
      bag.timeout(() => {
        found(opp.name, opp.levels, opp.formation);
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
