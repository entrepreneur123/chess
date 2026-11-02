/**
 * Marketing landing page (/landing/). Standalone: no engine import, so the page stays tiny.
 * - Animated hero showcase (a scripted 12x12 mini match loop)
 * - Per-character level tabs that redraw the movement diagram
 */
import './landing.css';

type Char = 'sad' | 'marki' | 'walk' | 'insaner';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ movement diagrams */
const RANGE: Record<Char, [number, number, number]> = {
  sad: [1, 2, 3],
  marki: [3, 4, 6],
  walk: [2, 3, 4], // half width of the front row
  insaner: [2, 3, 3], // orthogonal reach; Lv3 adds diagonals
};
const DESC: Record<Char, [string, string, string]> = {
  sad: ['상하좌우 1칸', '상하좌우 최대 2칸', '상하좌우 최대 3칸'],
  marki: ['앞으로 최대 3칸', '앞으로 최대 4칸', '앞으로 최대 6칸'],
  walk: ['바로 앞줄 5칸으로 점프', '바로 앞줄 7칸으로 점프', '바로 앞줄 9칸으로 점프'],
  insaner: ['상하좌우 최대 2칸', '상하좌우 최대 3칸', '상하좌우·대각선 최대 3칸'],
};
const LABEL: Record<Char, string> = { sad: '사', marki: '마', walk: '월', insaner: '인' };

/** Returns the squares (relative to the piece at 0,0; dr < 0 = forward/up) reachable at `level`. */
function reach(ch: Char, level: number): Array<[number, number]> {
  const n = RANGE[ch][level - 1];
  const out: Array<[number, number]> = [];
  if (ch === 'sad' || ch === 'insaner') {
    for (let k = 1; k <= n; k++) out.push([-k, 0], [k, 0], [0, -k], [0, k]);
    if (ch === 'insaner' && level === 3) {
      for (let k = 1; k <= n; k++) out.push([-k, -k], [-k, k], [k, -k], [k, k]);
    }
  } else if (ch === 'marki') {
    for (let k = 1; k <= n; k++) out.push([-k, 0]);
  } else {
    for (let c = -n; c <= n; c++) out.push([-1, c]);
  }
  return out;
}

function drawGrid(el: HTMLElement, ch: Char, level: number): void {
  const n = RANGE[ch][level - 1];
  // Grid size: enough to show the full range, piece near the bottom for forward movers.
  const omni = ch === 'sad' || ch === 'insaner';
  const half = ch === 'marki' ? 0 : n;
  const cols = half * 2 + 1;
  const rowsUp = ch === 'walk' ? 1 : n;
  const rowsDown = omni ? n : 0;
  const rows = rowsUp + rowsDown + 1;
  const cells = new Set(reach(ch, level).map(([r, c]) => `${r},${c}`));
  el.style.setProperty('--cols', String(cols));
  el.style.setProperty('--rows', String(rows));
  el.textContent = '';
  const frag = document.createDocumentFragment();
  for (let r = -rowsUp; r <= rowsDown; r++) {
    for (let c = -half; c <= half; c++) {
      const cell = document.createElement('i');
      if (r === 0 && c === 0) cell.className = 'is-piece';
      else if (cells.has(`${r},${c}`)) cell.className = 'is-move';
      frag.appendChild(cell);
    }
  }
  el.appendChild(frag);
  el.setAttribute('aria-label', `${el.dataset.name ?? ''} Lv.${level} 이동 범위: ${DESC[ch][level - 1]}`);
}

function initCards(): void {
  document.querySelectorAll<HTMLElement>('.char-card').forEach((card) => {
    const ch = card.dataset.char as Char | undefined;
    const tabs = card.querySelector<HTMLElement>('.lv-tabs');
    const grid = card.querySelector<HTMLElement>('.move-grid');
    if (!ch || !tabs || !grid) return;
    grid.dataset.name = card.querySelector('.char-card__name')?.firstChild?.textContent?.trim() ?? '';
    const buttons: HTMLButtonElement[] = [];
    const select = (lv: number) => {
      buttons.forEach((b, i) => {
        b.classList.toggle('is-active', i === lv - 1);
        b.setAttribute('aria-pressed', String(i === lv - 1));
      });
      drawGrid(grid, ch, lv);
      const art = card.querySelector<HTMLImageElement>('.char-card__art');
      if (art) art.src = `../chars/${ch}-lv${lv}.jpg`;
    };
    for (let lv = 1; lv <= 3; lv++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lv-tab';
      b.textContent = `Lv.${lv}`;
      b.addEventListener('click', () => select(lv));
      buttons.push(b);
      tabs.appendChild(b);
    }
    select(1);
  });
}

/* ------------------------------------------------------------------ hero showcase */
interface Token {
  el: HTMLElement;
  r: number;
  c: number;
}
interface Step {
  caption: string;
  moves: Array<{ who: 'b' | 'r'; idx: number; to: [number, number]; capture?: { who: 'b' | 'r'; idx: number } }>;
}

const N = 12;
const SCRIPT: Step[] = [
  { caption: '마르키가 앞으로 미끄러지며 전진합니다.', moves: [{ who: 'b', idx: 1, to: [6, 4] }] },
  { caption: '상대 월크가 앞줄로 점프해 기습을 노립니다.', moves: [{ who: 'r', idx: 2, to: [8, 7] }] },
  { caption: '사드가 옆으로 이동해 길을 엽니다.', moves: [{ who: 'b', idx: 0, to: [2, 5] }] },
  { caption: '상대 마르키가 돌진합니다.', moves: [{ who: 'r', idx: 1, to: [5, 6] }] },
  { caption: '월크가 뛰어넘어 상대 마르키를 잡았습니다!', moves: [{ who: 'b', idx: 2, to: [5, 6], capture: { who: 'r', idx: 1 } }] },
];

function initShowcase(): void {
  const board = document.querySelector<HTMLElement>('[data-showcase]');
  const cap = document.querySelector<HTMLElement>('[data-showcase-cap]');
  const timerEl = document.querySelector<HTMLElement>('[data-timer]');
  if (!board) return;
  for (let i = 0; i < N * N; i++) {
    const sq = document.createElement('i');
    const r = Math.floor(i / N);
    if (r >= 9) sq.className = 'z-red';
    else if (r <= 2) sq.className = 'z-blue';
    board.appendChild(sq);
  }
  // Start positions (row 0 = top of the screen = red home). Blue is at the bottom.
  const start: Record<'b' | 'r', Array<[number, number, Char]>> = {
    b: [
      [9, 7, 'sad'],
      [9, 4, 'marki'],
      [10, 5, 'walk'],
    ],
    r: [
      [2, 4, 'sad'],
      [2, 6, 'marki'],
      [1, 7, 'walk'],
    ],
  };
  const tokens: Record<'b' | 'r', Token[]> = { b: [], r: [] };
  const place = (t: Token) => {
    t.el.style.setProperty('--r', String(t.r));
    t.el.style.setProperty('--c', String(t.c));
  };
  const spawn = () => {
    board.querySelectorAll('.sc-token').forEach((e) => e.remove());
    for (const who of ['b', 'r'] as const) {
      tokens[who] = start[who].map(([r, c, ch]) => {
        const el = document.createElement('b');
        el.className = `sc-token sc-token--${who} sc-token--${ch}`;
        el.textContent = LABEL[ch];
        board.appendChild(el);
        const t = { el, r, c };
        place(t);
        return t;
      });
    }
  };
  spawn();
  if (reduced) return;

  let step = 0;
  let timer = 60;
  const tick = () => {
    timer = timer <= 1 ? 60 : timer - 1;
    if (timerEl) timerEl.textContent = String(timer);
  };
  window.setInterval(tick, 1000);

  const run = () => {
    if (step >= SCRIPT.length) {
      step = 0;
      window.setTimeout(() => {
        spawn();
        if (cap) cap.textContent = '새 판이 시작됩니다.';
        window.setTimeout(run, 1400);
      }, 1800);
      return;
    }
    const s = SCRIPT[step++];
    if (cap) cap.textContent = s.caption;
    for (const m of s.moves) {
      const t = tokens[m.who][m.idx];
      t.r = m.to[0];
      t.c = m.to[1];
      t.el.classList.toggle('is-jump', t.el.classList.contains('sc-token--walk'));
      place(t);
      if (m.capture) {
        const victim = tokens[m.capture.who][m.capture.idx];
        window.setTimeout(() => victim.el.classList.add('is-captured'), 420);
      }
    }
    window.setTimeout(run, 2200);
  };
  window.setTimeout(run, 1200);
}

initCards();
initShowcase();
