/**
 * First-run "how to play" carousel: swipeable cards (native scroll-snap), page dots, skip.
 * Re-playable from the lobby. Resolves when closed (completed or skipped).
 */
import { sfx } from '../../audio/sfx';
import { BOARD_SIZE, CHARACTERS, CHARACTER_IDS, STARTER_IDS, ZONE_DEPTH, TURN_TIME_1_MS, TURN_TIME_2_MS, TURN_TIME_MS, type CharacterId } from '../../engine';
import { getProfile, updateProfile } from '../../meta/profile';
import { h, prefersReducedMotion, type Child } from '../dom';
import { icon } from '../icons';
import { formationGrid } from './formationGrid';
import { overlayRoot, pushOverlay, registerForceClose } from './overlay';
import { CONCEPT, movementDiagram, movementSpan, pieceToken, unitArt } from './piece';

interface Slide {
  key: string;
  art: () => Child;
  title: string;
  body: string;
}

const SHORT_MOVE: Record<CharacterId, string> = {
  sad: '상하좌우 이동',
  marki: '앞으로 직진 · 끝줄에서 뒤돌아요',
  walk: '앞줄로 점프 · 끝줄에서 뒤돌아요',
  insaner: '상하좌우 직진 · 잡은 적의 이동 범위만 흡수',
  brutile: '대각선 한 칸 · 불모지 스킬',
  michelle: '좌·우·뒤 이동 · 물러나며 인형 함정',
  picker: '대각선 콩콩 점프 · 지나는 적 모두 잡기',
  rakaeli: '앞쪽 블록 점프 · 타천하면 범위 확장',
  rampid: '앞쪽 세 갈래 발톱 직진 · 끝줄에서 뒤돌아요',
  larhen: '좌우·대각선 H자 점프 · 3성은 세로로 긴 H',
  volkonov: '상하좌우 이동 · 선율로 아군 이동 +1',
  verish: '앞·좌우 관통 슬라이드 · 지나는 적 모두 잡기',
  midos: '좌·우·앞 직진 · 빈 칸 어디로든 순간이동',
  hammont: '상하좌우 직진 · 부딪힌 적을 밀쳐내기',
  venoa: '한 칸씩 이동 · 떨어진 적을 독화살로 저격',
  glacia: '막힐 때까지 빙판 활주 · 빙결로 적 얼리기',
};

function goalArt(): Child {
  return h(
    'div',
    { class: 'tut-art tut-art--goal' },
    h(
      'div',
      { class: 'tut-goal__row' },
      // An enemy squad is always three pieces.
      STARTER_IDS.map((id, i) =>
        h('span', { class: 'tut-goal__enemy', style: `--i:${i}` }, unitArt(id, 1, { size: 56, owner: 1 }), h('span', { class: 'tut-goal__x' }, icon('close', 18))),
      ),
    ),
    h('span', { class: 'tut-goal__trophy' }, icon('trophy', 40)),
  );
}

function charactersArt(): Child {
  // Eight characters: a two-column list of compact rows (art, name + concept, one-line move, diagram).
  return h(
    'div',
    { class: 'tut-art tut-art--chars' },
    CHARACTER_IDS.map((id) => {
      const { rows, cols } = movementSpan(id, 1);
      const cell = Math.max(2, Math.min(6, Math.floor(26 / Math.max(rows, cols))));
      return h(
        'div',
        { class: `tut-char rarity-${CHARACTERS[id].rarity}` },
        unitArt(id, 1, { size: 26 }),
        h(
          'div',
          { class: 'tut-char__main' },
          h('div', { class: 'tut-char__name' }, CHARACTERS[id].nameKo, h('span', { class: 'tut-char__concept' }, CONCEPT[id])),
          h('div', { class: 'tut-char__move' }, SHORT_MOVE[id]),
        ),
        h('div', { class: 'tut-char__diagram' }, movementDiagram(id, 1, { cell })),
      );
    }),
  );
}

function tapArt(): Child {
  // 5 x 5 mini board: the piece in the middle-bottom, its reachable squares highlighted.
  const cells: HTMLElement[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const isPiece = r === 3 && c === 2;
      const isTarget = c === 2 && r > 0 && r < 3;
      const isEnemy = r === 0 && c === 2;
      cells.push(
        h(
          'span',
          { class: `tut-board__cell${(r + c) % 2 ? ' is-dark' : ''}${isTarget ? ' is-target' : ''}${isEnemy ? ' is-capture' : ''}` },
          isPiece ? pieceToken('marki', 1, 0, 'sm') : isEnemy ? pieceToken('sad', 1, 1, 'sm') : null,
        ),
      );
    }
  }
  return h(
    'div',
    { class: 'tut-art tut-art--tap' },
    h('div', { class: 'tut-board' }, cells),
    h('span', { class: 'tut-finger', 'aria-hidden': 'true' }),
  );
}

function zoneArt(): Child {
  return h(
    'div',
    { class: 'tut-art tut-art--zone' },
    h('div', { class: 'tut-zone__enemy' }, icon('up', 14), '적 방향'),
    h('div', { class: 'tut-zone__grid' }, formationGrid(getProfile().formation, { mini: true })),
    h('div', { class: 'tut-zone__label' }, `내 배치 구역 · ${ZONE_DEPTH}줄 × ${BOARD_SIZE}칸`),
  );
}

function timerArt(): Child {
  const secs = Math.round(TURN_TIME_MS / 1000);
  return h(
    'div',
    { class: 'tut-art tut-art--timer' },
    h(
      'div',
      { class: 'tut-timer' },
      h('span', { class: 'tut-timer__ring', 'aria-hidden': 'true' }),
      h('span', { class: 'tut-timer__num' }, String(secs)),
      h('span', { class: 'tut-timer__unit' }, '초'),
    ),
    h(
      'div',
      { class: 'tut-strikes' },
      // The limit per move as the squad shrinks, then what running out costs.
      [`${secs}초`, `${Math.round(TURN_TIME_2_MS / 1000)}초`, `${Math.round(TURN_TIME_1_MS / 1000)}초`].map((t) => h('span', { class: 'tut-strike' }, t)),
      h('span', { class: 'tut-strike is-out' }, '초과 시 몰수패'),
    ),
  );
}

function growArt(): Child {
  return h(
    'div',
    { class: 'tut-art tut-art--grow' },
    h('div', { class: 'tut-grow__lv' }, movementDiagram('sad', 1, { cell: 7 }), h('span', { class: 'tut-grow__cap' }, '1성')),
    h('span', { class: 'tut-grow__arrow' }, icon('chevron', 22)),
    h('div', { class: 'tut-grow__lv' }, movementDiagram('sad', 2, { cell: 7 }), h('span', { class: 'tut-grow__cap' }, '2성')),
    h('span', { class: 'tut-grow__arrow' }, icon('chevron', 22)),
    h('div', { class: 'tut-grow__lv' }, movementDiagram('sad', 3, { cell: 7 }), h('span', { class: 'tut-grow__cap tut-grow__cap--hi' }, '3성')),
  );
}

const SLIDES: Slide[] = [
  { key: 'goal', art: goalArt, title: '상대 말 3개를 모두 잡으면 승리!', body: `${BOARD_SIZE}×${BOARD_SIZE} 보드 위 1:1 대결. 이동 경로에서 처음 만나는 상대 말을 잡을 수 있어요.` },
  { key: 'chars', art: charactersArt, title: '여덟 캐릭터, 분대는 3명', body: '파란 칸이 갈 수 있는 곳이에요. 미셸은 물러나며 인형 함정을 남기고, 피커는 지나는 적을 모두 잡아요. 라카엘리는 타천하면 2번 이동하는 동안 범위가 넓어져요.' },
  { key: 'tap', art: tapArt, title: '탭하고, 한 번 더 탭!', body: '내 말을 탭하면 갈 수 있는 칸이 빛나요. 빛나는 칸을 탭하면 이동해요.' },
  { key: 'zone', art: zoneArt, title: `진형은 아래 ${ZONE_DEPTH}줄에서`, body: `대전 전에 내 구역(${ZONE_DEPTH}×${BOARD_SIZE}) 안에 말을 자유롭게 배치해 작전을 짜세요.` },
  { key: 'timer', art: timerArt, title: '한 수 45초, 넘기면 몰수패', body: '말이 줄면 제한시간이 40초 → 20초로 줄고, 시간을 넘기면 즉시 몰수패! 한쪽 말이 1개만 남거나 20턴째가 되면 자기장이 발동해 2턴마다 좌우 바깥 줄이 좁혀오고, 3번째부터는 위아래도 좁혀와요. 닿은 말은 소멸해요.' },
  { key: 'grow', art: growArt, title: '토큰으로 성급 강화', body: '던전 첫 승리로 받은 토큰으로 1성 → 2성 → 3성 강화! 전장전 · 견습전투에서 모은 에센셜로는 상점에서 새 캐릭터를 영입해요.' },
];

let open = false;

export function isTutorialOpen(): boolean {
  return open;
}

export function showTutorial(): Promise<void> {
  if (open) return Promise.resolve();
  open = true;
  return new Promise<void>((resolve) => {
    const reduced = prefersReducedMotion();
    let index = 0;
    let done = false;
    let raf = 0;

    const slides = SLIDES.map((s, i) =>
      h(
        'section',
        {
          class: `tut-slide tut-slide--${s.key}`,
          role: 'group',
          'aria-roledescription': '슬라이드',
          'aria-label': `${i + 1} / ${SLIDES.length}: ${s.title}`,
          'data-slide': i,
        },
        s.art(),
        h('h2', { class: 'tut-slide__title' }, s.title),
        h('p', { class: 'tut-slide__body' }, s.body),
      ),
    );
    const track = h('div', { class: 'tut-track', 'data-sfx': 'none' }, slides);
    const dots = SLIDES.map((s, i) =>
      h('button', {
        class: 'tut-dot',
        type: 'button',
        'aria-label': `${i + 1}번째 카드`,
        'data-sfx': 'none',
        onclick: () => goTo(i),
        'data-key': s.key,
      }),
    );
    const nextLabel = h('span', null, '다음');
    const nextBtn = h('button', { class: 'btn btn--primary btn--block btn--lg tut-next', type: 'button', 'data-action': 'tut-next', onclick: () => next() }, nextLabel, icon('chevron', 20));
    const skipBtn = h('button', { class: 'btn btn--text tut-skip', type: 'button', 'data-action': 'tut-skip', onclick: () => close() }, '건너뛰기');
    const panel = h(
      'div',
      { class: 'tut', role: 'dialog', 'aria-modal': 'true', 'aria-label': '게임 방법' },
      h('div', { class: 'tut__top' }, h('span', { class: 'tut__eyebrow' }, '게임 방법'), skipBtn),
      track,
      h('div', { class: 'tut__dots', role: 'tablist', 'aria-label': '카드 선택' }, dots),
      nextBtn,
    );
    const root = h('div', { class: 'scrim tut-scrim', 'data-tutorial': '' }, panel);

    const sync = () => {
      dots.forEach((d, i) => {
        d.classList.toggle('is-active', i === index);
        d.setAttribute('aria-current', i === index ? 'true' : 'false');
      });
      slides.forEach((s, i) => {
        s.classList.toggle('is-current', i === index);
        s.setAttribute('aria-hidden', i === index ? 'false' : 'true');
      });
      const last = index === SLIDES.length - 1;
      nextLabel.textContent = last ? '시작하기' : '다음';
      nextBtn.classList.toggle('is-last', last);
      skipBtn.style.visibility = last ? 'hidden' : '';
    };

    const goTo = (i: number) => {
      const target = Math.max(0, Math.min(SLIDES.length - 1, i));
      track.scrollTo({ left: target * track.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
      if (target !== index) {
        index = target;
        sfx('page');
        sync();
      }
    };

    const next = () => {
      if (index >= SLIDES.length - 1) close();
      else goTo(index + 1);
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const w = track.clientWidth || 1;
        const i = Math.round(track.scrollLeft / w);
        if (i !== index && i >= 0 && i < SLIDES.length) {
          index = i;
          sfx('page');
          sync();
        }
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(index + 1);
      else if (e.key === 'ArrowLeft') goTo(index - 1);
      else if (e.key === 'Escape') close();
      else return;
      e.preventDefault();
    };

    const close = () => {
      if (done) return;
      done = true;
      open = false;
      if (raf) cancelAnimationFrame(raf);
      track.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
      pop();
      unforce();
      if (!getProfile().onboarding.tutorialSeen) {
        updateProfile((p) => ({ ...p, onboarding: { ...p.onboarding, tutorialSeen: true } }));
      }
      root.classList.remove('is-in');
      window.setTimeout(() => root.remove(), 220);
      resolve();
    };

    track.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKey);
    const pop = pushOverlay({ requestClose: () => (close(), true) });
    const unforce = registerForceClose(close);
    sync();
    overlayRoot().appendChild(root);
    requestAnimationFrame(() => root.classList.add('is-in'));
    window.setTimeout(() => nextBtn.focus({ preventScroll: true }), 60);
  });
}
