/**
 * First-run "how to play" carousel: swipeable cards (native scroll-snap), page dots, skip.
 * Re-playable from the lobby. Resolves when closed (completed or skipped).
 */
import { sfx } from '../../audio/sfx';
import { CHARACTERS, CHARACTER_IDS, TURN_TIME_MS, type CharacterId } from '../../engine';
import { getProfile, updateProfile } from '../../meta/profile';
import { h, prefersReducedMotion, type Child } from '../dom';
import { icon } from '../icons';
import { chestArt } from './chest';
import { formationGrid } from './formationGrid';
import { overlayRoot, pushOverlay, registerForceClose } from './overlay';
import { CONCEPT, movementDiagram, pieceToken, rarityChip, unitArt } from './piece';

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
  insaner: '상하좌우 직진 · 잡은 적의 이동을 흡수',
};

function goalArt(): Child {
  return h(
    'div',
    { class: 'tut-art tut-art--goal' },
    h(
      'div',
      { class: 'tut-goal__row' },
      CHARACTER_IDS.map((id, i) =>
        h('span', { class: 'tut-goal__enemy', style: `--i:${i}` }, unitArt(id, 1, { size: 56, owner: 1 }), h('span', { class: 'tut-goal__x' }, icon('close', 18))),
      ),
    ),
    h('span', { class: 'tut-goal__trophy' }, icon('trophy', 40)),
  );
}

function charactersArt(): Child {
  return h(
    'div',
    { class: 'tut-art tut-art--chars' },
    CHARACTER_IDS.map((id) =>
      h(
        'div',
        { class: 'tut-char' },
        h('div', { class: 'tut-char__diagram' }, movementDiagram(id, 1, { cell: 9 })),
        unitArt(id, 1, { size: 52 }),
        h('div', { class: 'tut-char__name' }, CHARACTERS[id].nameKo),
        h('div', { class: 'tut-char__concept' }, CONCEPT[id]),
        rarityChip(CHARACTERS[id].rarity),
        h('div', { class: 'tut-char__move' }, SHORT_MOVE[id]),
      ),
    ),
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
    h('div', { class: 'tut-zone__label' }, '내 배치 구역 · 3줄 × 12칸'),
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
      [1, 2, 3].map((n) => h('span', { class: `tut-strike${n === 3 ? ' is-out' : ''}` }, n === 3 ? '기권' : `${n}회`)),
    ),
  );
}

function growArt(): Child {
  return h(
    'div',
    { class: 'tut-art tut-art--grow' },
    h('div', { class: 'tut-grow__box' }, chestArt('basic'), h('span', { class: 'tut-grow__cap' }, '상자')),
    h('span', { class: 'tut-grow__arrow' }, icon('chevron', 22)),
    h('div', { class: 'tut-grow__lv' }, movementDiagram('sad', 1, { cell: 7 }), h('span', { class: 'tut-grow__cap' }, 'Lv.1')),
    h('span', { class: 'tut-grow__arrow' }, icon('chevron', 22)),
    h('div', { class: 'tut-grow__lv' }, movementDiagram('sad', 3, { cell: 7 }), h('span', { class: 'tut-grow__cap tut-grow__cap--hi' }, 'Lv.3')),
  );
}

const SLIDES: Slide[] = [
  { key: 'goal', art: goalArt, title: '상대 말 3개를 모두 잡으면 승리!', body: '12×12 보드 위 1:1 대결. 이동 경로에서 처음 만나는 상대 말을 잡을 수 있어요.' },
  { key: 'chars', art: charactersArt, title: '네 캐릭터, 분대는 3명', body: '파란 칸이 갈 수 있는 곳이에요. 마르키·월크는 앞으로만 가다가 끝줄에 닿으면 뒤돌아요. 전설 인세이너는 잡은 적의 이동 능력을 흡수해요.' },
  { key: 'tap', art: tapArt, title: '탭하고, 한 번 더 탭!', body: '내 말을 탭하면 갈 수 있는 칸이 빛나요. 빛나는 칸을 탭하면 이동해요.' },
  { key: 'zone', art: zoneArt, title: '진형은 아래 3줄에서', body: '대전 전에 내 구역(3×12) 안에 말을 자유롭게 배치해 작전을 짜세요.' },
  { key: 'timer', art: timerArt, title: '한 턴은 60초, 말이 줄면 더 짧게', body: '한쪽이 2개 이하면 40초, 1개면 20초. 1개만 남으면 6턴마다 좌우 바깥 줄이 자기장으로 변해 닿은 말은 소멸해요. 3번 연속 시간 초과는 기권패!' },
  { key: 'grow', art: growArt, title: '상자 열고 레벨업', body: '보상 코인으로 상자를 열어 카드를 모으세요. 레벨이 오르면 이동 범위가 넓어져요.' },
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
