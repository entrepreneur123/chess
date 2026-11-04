/**
 * Matchmaking: a short "searching" beat (radar around the player's lead unit, the mode and the
 * rating band being searched, rotating tips), then a split-screen VS card with both sides' key
 * art, ratings and arenas before the match starts. Every opponent is an AI and says so.
 */
import { CHARACTERS, squadOf, validateFormation, type CharacterId, type Formation, type Level, type Rarity } from '../../engine';
import { PACING } from '../../meta/economy';
import { createOpponent, DIFFICULTY_LABEL, matchArenaId, type Opponent } from '../../meta/opponent';
import { formationAllowed, getProfile, levelsOf } from '../../meta/profile';
import { DUNGEON_LABEL, MODE_LABEL, OPPONENT_BAND, arenaById, arenaForRating, clampRating } from '../../meta/progression';
import { randInt, defaultRng } from '../../meta/rng';
import { preloadArt } from '../backdrops';
import { arenaBadge } from '../components/currency';
import { artMissing, pieceToken, unitArt } from '../components/piece';
import { clearToasts, toast } from '../components/toast';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';
import type { MatchRequest } from './gameParams';

const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
const TIPS = [
  '월크는 사이에 있는 말을 뛰어넘어요',
  '마르키는 앞으로 길게 돌진해요. 끝줄에 닿으면 뒤돌아요',
  '사드는 유일하게 뒤로 물러날 수 있어요',
  '40턴이 지나면 자기장 발동! 좌우 바깥 줄부터 좁혀와요',
  '한 수 제한시간을 넘기면 즉시 몰수패! 고민은 짧게',
  '오른쪽 위 ≡ 버튼을 누르면 현재 진형과 상대 말 정보를 볼 수 있어요',
  '성급이 오르면 이동 범위가 넓어져요',
  '말이 2개 이하로 줄면 제한시간이 40초, 1개면 20초로 줄어요',
  '한쪽 말이 1개만 남아도 자기장 발동. 3턴마다 좌우 바깥 줄이 좁혀와요. 닿으면 즉시 소멸!',
  '전설 인세이너는 잡은 적의 이동 능력을 흡수해요',
  '3성 인세이너는 적을 잡은 직후 한 번 더 움직여요',
  '전설 브루타일은 4턴째부터 불모지를 깔아요. 닿으면 어떤 말이든 소멸!',
  '불모지 스킬은 자기장이 좁혀오기 시작하면 쓸 수 없어요',
];

/** The unit a side "leads" with on the VS card: highest rarity, then highest level. */
function leadUnit(squad: CharacterId[], levels: Record<CharacterId, Level>, exclude?: CharacterId): CharacterId {
  const pool = squad.filter((id) => id !== exclude);
  return (pool.length ? pool : squad).sort(
    (a, b) => RARITY_RANK[CHARACTERS[b].rarity] - RARITY_RANK[CHARACTERS[a].rarity] || levels[b] - levels[a],
  )[0];
}

export function matchmakingScreen(router: Router, params: MatchRequest): Screen {
  const bag = new Disposables();
  const profile = getProfile();
  const mode = params.mode;
  const dungeonLevel = mode === 'dungeon' ? (params.dungeonLevel ?? profile.dungeonLevel) : undefined;
  const levels = levelsOf(profile);
  const playerFormation = validateFormation(profile.formation).ok && formationAllowed(profile.formation, profile.owned) ? profile.formation : null;
  const mySquad = squadOf(playerFormation ?? profile.formation);
  const myLead = leadUnit(mySquad, levels);
  const myRating = clampRating(profile.rating);
  const myArena = arenaForRating(myRating);
  const opp: Opponent =
    mode === 'dungeon'
      ? createOpponent({ mode: 'dungeon', level: dungeonLevel! }, defaultRng)
      : createOpponent({ mode, rating: myRating, playerGrades: (playerFormation ?? profile.formation).map((s) => s.level) }, defaultRng);
  const themeArena = arenaById(matchArenaId(mode, myRating, opp.arena));
  const modeChip = mode === 'dungeon' ? `${MODE_LABEL.dungeon} · ${DUNGEON_LABEL[dungeonLevel!]}` : MODE_LABEL[mode];
  const searchLine =
    mode === 'dungeon'
      ? `AI · ${DIFFICULTY_LABEL[opp.difficulty]} 수읽기`
      : mode === 'ranked'
      ? `AI · ${myArena.index} 전장 · 레이팅 ${Math.max(myArena.min, myRating - OPPONENT_BAND.ranked)}–${myArena.max === null ? myRating + OPPONENT_BAND.ranked : Math.min(myArena.max, myRating + OPPONENT_BAND.ranked)}`
      : `AI · 레이팅 ${Math.max(0, myRating - OPPONENT_BAND.casual)}–${myRating + OPPONENT_BAND.casual}`;

  const stage = h('div', { class: 'mm__stage', 'aria-live': 'polite' });
  const el = h(
    'main',
    { class: 'mm' },
    h('div', { class: 'mm__bg', 'aria-hidden': 'true' }),
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
      h('p', { class: 'mm__sub mm__sub--mode' }, h('span', { class: 'chip chip--gold', 'data-mode': mode }, modeChip)),
      h('p', { class: 'mm__band' }, searchLine),
      tip,
    );
  };

  const side = (who: 'me' | 'opp', name: string, lv: Record<CharacterId, Level>, owner: 0 | 1, formation: Formation, rating: number, arenaId: Opponent['arena']) => {
    const ar = arenaById(arenaId);
    // The opponent leads with a different unit than the player so the VS card is a real face-off.
    const squad = squadOf(formation);
    const lead = who === 'me' ? myLead : leadUnit(squad, lv, myLead);
    return h(
      'div',
      { class: `versus__side versus__side--${who}` },
      h('div', { class: 'versus__art' }, h('img', { src: `./chars/${lead}-lv${lv[lead]}.jpg`, alt: '', decoding: 'async', draggable: 'false', onerror: artMissing })),
      h(
        'div',
        { class: 'versus__plate' },
        h('span', { class: 'versus__eyebrow' }, who === 'me' ? 'BLUE TEAM' : 'RED TEAM · AI'),
        h('span', { class: 'versus__name', 'data-opponent': who === 'opp' ? name : undefined }, who === 'opp' ? h('span', { class: 'ai-tag' }, 'AI') : null, name),
        h('span', { class: 'versus__rank', 'data-rating': rating }, arenaBadge(ar, 'sm'), h('b', { class: 't-num' }, String(rating)), h('span', null, `${ar.index} 전장`)),
        h('div', { class: 'versus__pieces' }, formation.map((s) => pieceToken(s.character, s.level, owner, 'sm'))),
      ),
    );
  };

  const found = () => {
    el.classList.add('is-found');
    clearToasts(); // nothing may cover the VS card
    replaceChildren(
      stage,
      h(
        'div',
        { class: 'versus' },
        side('me', '나', levels, 0, playerFormation ?? profile.formation, myRating, myArena.id),
        h('div', { class: 'versus__vs', 'aria-hidden': 'true' }, h('span', null, 'VS')),
        side('opp', opp.name, opp.levels, 1, opp.formation, opp.rating, opp.arena),
      ),
      h(
        'div',
        { class: 'mm__found' },
        h('h2', { class: 'mm__title mm__title--found' }, '상대 발견!'),
        h('p', { class: 'mm__sub mm__sub--row' }, h('span', { class: 'chip chip--gold' }, modeChip), h('span', { class: 'chip chip--outline' }, icon('lock', 14), '상대 진형 비공개')),
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
      void preloadArt(themeArena.backdrop);
      const search = randInt(defaultRng, PACING.searchMinMs, PACING.searchMaxMs);
      bag.timeout(() => {
        found();
        bag.timeout(() => {
          router.navigate('game', {
            mode,
            dungeonLevel,
            difficulty: opp.difficulty,
            opponentName: opp.name,
            opponentRating: opp.rating,
            opponentArena: opp.arena,
            themeArena: themeArena.id,
            playerFormation: playerFormation ?? profile.formation,
            botFormation: opp.formation,
          });
        }, PACING.foundHoldMs);
      }, search);
    },
    dispose: () => bag.dispose(),
  };
}
