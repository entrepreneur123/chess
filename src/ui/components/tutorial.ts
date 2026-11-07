/**
 * First-run "how to play" carousel: swipeable cards (native scroll-snap), page dots, skip.
 * Re-playable from the lobby. Resolves when closed (completed or skipped).
 */
import { sfx } from '../../audio/sfx';
import { BOARD_SIZE, CHARACTERS, CHARACTER_IDS, SKILL_UNLOCK_PLY, inStorm, STARTER_IDS, SUDDEN_DEATH_PLY, TURN_TIME_1_MS, TURN_TIME_2_MS, TURN_TIME_MS, ZONE_DEPTH, type CharacterId } from '../../engine';
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
  // Every character: a two-column list of compact rows (art, name + concept, one-line move, diagram).
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
  return h(
    'div',
    { class: 'tut-art tut-art--tap' },
    miniBoard({
      rows: 5,
      cols: 5,
      pieces: [
        { r: 3, c: 2, ch: 'marki', owner: 0 },
        { r: 0, c: 2, ch: 'sad', owner: 1 },
      ],
      targets: [[1, 2], [2, 2]],
      captures: [[0, 2]],
    }),
    h('span', { class: 'tut-finger', 'aria-hidden': 'true' }),
  );
}

/** One square of a tutorial mini board: a piece, a move dot, a capture ring, a block mark, storm. */
interface MiniPiece {
  r: number;
  c: number;
  ch: CharacterId;
  owner: 0 | 1;
  lv?: 1 | 2 | 3;
  /** Facing chevron next to the token (screen up / down). */
  arrow?: 'up' | 'down';
}
interface MiniSpec {
  rows: number;
  cols: number;
  /** Cell size in px (default 30). */
  cell?: number;
  pieces?: MiniPiece[];
  targets?: [number, number][];
  captures?: [number, number][];
  /** Squares the move can NOT reach (an X): blocked lanes, dead ends. */
  blocked?: [number, number][];
  /** Closed storm squares. */
  storm?: [number, number][];
  /** Squares a jumper flies over (a faint arc dot). */
  over?: [number, number][];
}

/**
 * A small static board for the tutorial cards (rows top to bottom as drawn; the player's side is
 * at the bottom, like the match). No animation loops: only the decorations named in the CSS.
 */
function miniBoard(spec: MiniSpec): HTMLElement {
  const cell = spec.cell ?? 30;
  const k = (r: number, c: number) => `${r},${c}`;
  const set = (list?: [number, number][]) => new Set((list ?? []).map(([r, c]) => k(r, c)));
  const targets = set(spec.targets);
  const captures = set(spec.captures);
  const blocked = set(spec.blocked);
  const storm = set(spec.storm);
  const over = set(spec.over);
  const at = new Map((spec.pieces ?? []).map((p) => [k(p.r, p.c), p]));
  const cells: HTMLElement[] = [];
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const key = k(r, c);
      const p = at.get(key);
      const cls = [
        'tut-board__cell',
        (r + c) % 2 ? 'is-dark' : '',
        targets.has(key) ? 'is-target' : '',
        captures.has(key) ? 'is-capture' : '',
        blocked.has(key) ? 'is-blocked' : '',
        storm.has(key) ? 'is-storm' : '',
        over.has(key) ? 'is-over' : '',
      ]
        .filter(Boolean)
        .join(' ');
      cells.push(
        h(
          'span',
          { class: cls },
          p ? pieceToken(p.ch, p.lv ?? 1, p.owner, cell >= 28 ? 'sm' : 'xs') : null,
          p?.arrow ? h('span', { class: `tut-dir${p.arrow === 'down' ? ' is-down' : ''}`, 'aria-hidden': 'true' }, icon('up', 12)) : null,
        ),
      );
    }
  }
  return h('div', { class: 'tut-board', style: `--cell:${cell}px;grid-template-columns:repeat(${spec.cols}, ${cell}px)` }, cells);
}

/** A row of small caption chips under a card's art. */
function chips(items: string[], out?: string): HTMLElement {
  return h('div', { class: 'tut-strikes' }, items.map((t) => h('span', { class: 'tut-strike' }, t)), out ? h('span', { class: 'tut-strike is-out' }, out) : null);
}

/** Sliders stop where the lane is blocked and take only the first enemy on it. */
function sliderArt(): Child {
  return h(
    'div',
    { class: 'tut-art tut-art--col' },
    miniBoard({
      rows: 5,
      cols: 5,
      pieces: [
        { r: 4, c: 1, ch: 'marki', owner: 0 },
        { r: 1, c: 1, ch: 'sad', owner: 0 },
        { r: 4, c: 3, ch: 'marki', owner: 0 },
        { r: 2, c: 3, ch: 'walk', owner: 1 },
        { r: 0, c: 3, ch: 'sad', owner: 1 },
      ],
      targets: [[3, 1], [2, 1], [3, 3]],
      captures: [[2, 3]],
      blocked: [[0, 1], [1, 3]],
    }),
    chips(['아군에 막히면 멈춤', '길 위의 첫 적만 잡기']),
  );
}

/** Jumpers land directly: pieces in between never block them. */
function jumperArt(): Child {
  return h(
    'div',
    { class: 'tut-art tut-art--col' },
    miniBoard({
      rows: 5,
      cols: 5,
      pieces: [
        { r: 4, c: 2, ch: 'rakaeli', owner: 0, lv: 2 },
        { r: 3, c: 2, ch: 'sad', owner: 0 },
        { r: 3, c: 1, ch: 'walk', owner: 1 },
        { r: 2, c: 2, ch: 'marki', owner: 1 },
      ],
      targets: [[3, 3], [2, 1], [2, 3]],
      captures: [[3, 1], [2, 2]],
    }),
    chips(['사이에 말이 있어도 OK', '도착 칸의 적을 잡기']),
  );
}

/** Forward movers turn around on the enemy's last row: the arrow flips. */
function turnArt(): Child {
  return h(
    'div',
    { class: 'tut-art tut-art--col' },
    h(
      'div',
      { class: 'tut-turn' },
      miniBoard({ rows: 5, cols: 3, cell: 26, pieces: [{ r: 2, c: 1, ch: 'marki', owner: 0, arrow: 'up' }], targets: [[1, 1], [0, 1]] }),
      h('span', { class: 'tut-turn__arrow', 'aria-hidden': 'true' }, icon('chevron', 22)),
      miniBoard({ rows: 5, cols: 3, cell: 26, pieces: [{ r: 0, c: 1, ch: 'marki', owner: 0, arrow: 'down' }], targets: [[1, 1], [2, 1], [3, 1]] }),
    ),
    chips(['적진 끝줄 도착', '앞 방향이 반대로', '▲▼ 화살표로 확인']),
  );
}

/** The five skill characters: once per match, from turn 4, sealed by the storm. */
function skillArt(): Child {
  const ids: CharacterId[] = ['brutile', 'rakaeli', 'volkonov', 'midos', 'glacia'];
  return h(
    'div',
    { class: 'tut-art tut-art--col' },
    h(
      'div',
      { class: 'tut-skill' },
      h('span', { class: 'tut-skill__turn' }, h('b', null, String(SKILL_UNLOCK_PLY / 2 + 1)), '턴부터'),
      h('div', { class: 'tut-skill__row' }, ids.map((id) => h('span', { class: 'tut-skill__unit' }, unitArt(id, 1, { size: 40 }), h('span', null, CHARACTERS[id].skill?.nameKo ?? '')))),
    ),
    chips(['한 판에 1번', '스킬도 한 턴'], '자기장 후 봉인'),
  );
}

/** The storm at its third step on the real board: 3 columns per side and the outer rows closed. */
function stormArt(): Child {
  const storm: [number, number][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) if (inStorm(BOARD_SIZE - 1 - r, c, 3)) storm.push([r, c]);
  }
  return h(
    'div',
    { class: 'tut-art tut-art--col' },
    miniBoard({
      rows: BOARD_SIZE,
      cols: BOARD_SIZE,
      cell: 15,
      storm,
      pieces: [
        { r: 6, c: 4, ch: 'sad', owner: 0 },
        { r: 3, c: 5, ch: 'marki', owner: 1 },
      ],
    }),
    chips([`${SUDDEN_DEATH_PLY / 2 + 1}턴 · 말 1개 남으면 발동`, '2턴마다 좁혀옴', '마지막 2×2는 5턴'], '닿으면 소멸'),
  );
}

/** No legal action on your turn is a loss (a stun only passes). */
function immobileArt(): Child {
  return h(
    'div',
    { class: 'tut-art tut-art--col' },
    // A forward-only Marki facing a storm row: he can neither enter it nor turn around there.
    miniBoard({
      rows: 3,
      cols: 5,
      storm: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [2, 0], [2, 4]],
      pieces: [{ r: 2, c: 2, ch: 'marki', owner: 0, arrow: 'up' }],
      blocked: [[1, 2]],
    }),
    chips(['이동 · 스킬 모두 불가', '기절은 자동 패스'], '즉시 패배'),
  );
}

/** Time: none against the AI (pause on the menu); online PvP has the move clock. */
function timeArt(): Child {
  const card = (cls: string, ic: 'bot' | 'swords', title: string, lines: string[]) =>
    h('div', { class: `tut-mode ${cls}` }, h('div', { class: 'tut-mode__head' }, icon(ic, 18), title), lines.map((l) => h('div', { class: 'tut-mode__line' }, l)));
  return h(
    'div',
    { class: 'tut-art tut-art--modes' },
    card('is-ai', 'bot', 'AI 대전', ['시간 제한 없음', '≡ 메뉴 = 일시정지', '언제든 기권']),
    card('is-online', 'swords', '온라인 대전', [`한 수 ${TURN_TIME_MS / 1000}초`, `말 줄면 ${TURN_TIME_2_MS / 1000}초 · ${TURN_TIME_1_MS / 1000}초`, '초과 시 몰수패', '기권은 3턴 이후']),
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

/**
 * First-run guide (owner 2026-11-08: "생처음 계정이면 게임하면서 필요한 기초지식 전부 설명"). Every
 * rule stated here is checked against the engine (docs/PROJECT_STATE.md section 3); keep it in
 * step when a rule changes.
 */
const SLIDES: Slide[] = [
  {
    key: 'goal',
    art: goalArt,
    title: '상대 말 3개를 모두 잡으면 승리!',
    body: `${BOARD_SIZE}×${BOARD_SIZE} 보드 위 3대3 대결. 상대 말을 모두 잡거나, 상대가 더 이상 둘 수 없게 만들면 이겨요.`,
  },
  {
    key: 'tap',
    art: tapArt,
    title: '탭하거나 끌어다 놓아 이동',
    body: '내 말을 누르면 갈 수 있는 칸이 빛나고, 잡을 수 있는 적에는 빨간 링이 떠요. 상대 말을 누르면 그 말이 닿는 곳이 빨갛게 보여요.',
  },
  {
    key: 'slider',
    art: sliderArt,
    title: '슬라이더: 길이 막히면 멈춰요',
    body: '대부분의 말은 길을 따라 미끄러지듯 움직여요. 아군이 길을 막으면 그 앞에서 멈추고, 길 위에서 처음 만나는 적만 잡을 수 있어요.',
  },
  {
    key: 'jumper',
    art: jumperArt,
    title: '점퍼: 사이를 뛰어넘어요',
    body: '월크 · 라르헨 · 라카엘리는 도착 칸으로 바로 점프해요. 사이에 말이 있어도 막히지 않고, 도착 칸에 있는 적을 잡아요.',
  },
  {
    key: 'chars',
    art: charactersArt,
    title: `${CHARACTER_IDS.length}명의 캐릭터, 분대는 3명`,
    body: '캐릭터마다 이동과 특성이 달라요. 피커 · 베리쉬는 지나는 적을 모두 잡고, 해먼트는 적을 밀쳐내고, 베노아는 멀리서 저격해요. 인세이너는 잡은 적의 이동 범위를 흡수해요.',
  },
  {
    key: 'turn',
    art: turnArt,
    title: '적진 끝줄에 닿으면 방향 전환',
    body: '앞으로 가는 말은 상대 끝줄에 닿으면 뒤돌아서 반대쪽이 앞이 돼요. 말과 카드의 ▲▼ 화살표가 지금 앞 방향이에요. 사방이 같은 말(사드 등)은 화살표가 없어요.',
  },
  {
    key: 'skill',
    art: skillArt,
    title: `스킬은 ${SKILL_UNLOCK_PLY / 2 + 1}턴째부터`,
    body: '스킬 캐릭터는 한 판에 한 번 스킬을 써요. 양쪽이 3번씩 둔 뒤부터 쓸 수 있고, 스킬을 쓰면 그 턴이 끝나요. 자기장이 시작되면 스킬은 봉인돼요.',
  },
  {
    key: 'storm',
    art: stormArt,
    title: '자기장이 좁혀와요',
    body: `${SUDDEN_DEATH_PLY / 2 + 1}턴째가 되거나 한쪽 말이 1개만 남으면 발동해요. 2턴마다 좌우 바깥 줄이, 3번째부터는 위아래 줄도 닫혀서 가운데 2×2만 남아요. 2×2가 5턴을 버티면 전부 사라져요. 자기장 칸의 말은 사라지고, 양쪽이 동시에 전멸하면 말이 더 많던 쪽이 이겨요.`,
  },
  {
    key: 'immobile',
    art: immobileArt,
    title: '둘 수 있는 수가 없으면 패배',
    body: '내 차례에 이동도 스킬도 할 수 없으면 바로 져요. 다만 인형 함정 · 빙결 · 강타로 기절해서 못 움직이는 건 패배가 아니라 자동으로 넘어가요.',
  },
  {
    key: 'time',
    art: timeArt,
    title: 'AI 대전은 시간 제한 없음',
    body: 'AI와 싸울 땐 천천히 생각하세요. ≡ 메뉴를 열면 일시정지돼요. 온라인 대전(출시 예정)에서는 한 수 제한 시간을 넘기면 즉시 몰수패이고, 기권은 3턴이 지난 뒤부터 할 수 있어요.',
  },
  { key: 'zone', art: zoneArt, title: `진형은 아래 ${ZONE_DEPTH}줄에서`, body: `대전 전에 내 구역(${ZONE_DEPTH}×${BOARD_SIZE}) 안에 말을 자유롭게 배치해 작전을 짜세요.` },
  { key: 'grow', art: growArt, title: '토큰으로 성급 강화', body: '던전 첫 승리로 받은 토큰으로 1성 → 2성 → 3성 강화! 성급이 오르면 이동 범위가 넓어져요. 전장전 · 견습전투에서 모은 에센셜로는 상점에서 새 캐릭터를 영입해요.' },
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
