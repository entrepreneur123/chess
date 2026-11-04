import { BOARD_SIZE, PIECES_PER_SIDE, ZONE_DEPTH, type CharacterId, type Formation, type Level } from '../../engine';
import { h } from '../dom';
import { pieceToken } from './piece';

/** Row names, index = local row (0 = back rank, ZONE_DEPTH - 1 = front). */
export const ROW_LABELS: readonly string[] = ['후열', '전열'];
if (ROW_LABELS.length !== ZONE_DEPTH) throw new Error('ROW_LABELS must name every home row');

export type PlaceResult =
  | { ok: true; formation: Formation }
  /** `same`: the character already stands there. `full`: a benched character needs a fielded one to replace. */
  | { ok: false; reason: 'same' | 'full' };

/**
 * Put `character` on local square (row, col) of the home zone. A fielded character moves there
 * (swapping with whoever stands there); a benched one replaces the occupant, and cannot enter an
 * empty square while the squad is full. Shared by the tap and the drag flows of the editor.
 */
export function placeInFormation(work: Formation, character: CharacterId, level: Level, row: number, col: number): PlaceResult {
  const occupant = work.find((s) => s.row === row && s.col === col);
  if (occupant?.character === character) return { ok: false, reason: 'same' };
  const mover = work.find((s) => s.character === character);
  if (!mover && !occupant && work.length >= PIECES_PER_SIDE) return { ok: false, reason: 'full' };
  const next = work.filter((s) => s.character !== character && s !== occupant);
  if (occupant && mover) next.push({ ...occupant, row: mover.row, col: mover.col }); // swap
  next.push({ character, level, row, col });
  return { ok: true, formation: next };
}

export interface FormationGridOptions {
  mini?: boolean;
  selected?: CharacterId | null;
  onCell?: (row: number, col: number) => void;
}

/**
 * ZONE_DEPTH x BOARD_SIZE (2 x 10) home-zone grid. The front row (local row ZONE_DEPTH - 1) is
 * drawn at the top because the enemy is "up".
 */
export function formationGrid(f: Formation, opts: FormationGridOptions = {}): HTMLElement {
  const grid = h('div', {
    class: `fgrid${opts.mini ? ' fgrid--mini' : ''}`,
    role: opts.onCell ? 'grid' : 'img',
    'aria-label': opts.onCell ? '배치 구역 (위쪽이 적 방향)' : '현재 진형 미리보기',
  });
  // Column count for the CSS grid (styles/formation.css reads it).
  grid.style.setProperty('--board-n', String(BOARD_SIZE));
  for (let row = ZONE_DEPTH - 1; row >= 0; row--) {
    if (!opts.mini) grid.appendChild(h('span', { class: 'fgrid__label', 'aria-hidden': 'true' }, ROW_LABELS[row].slice(0, 1)));
    for (let col = 0; col < BOARD_SIZE; col++) {
      const slot = f.find((s) => s.row === row && s.col === col);
      const light = (row + col) % 2 === 0;
      const cls = `fgrid__cell${light ? ' is-light' : ''}${slot ? ' has-piece' : ''}${
        slot && opts.selected === slot.character ? ' is-selected' : ''
      }${opts.selected && !slot ? ' is-target' : ''}`;
      const content = slot ? pieceToken(slot.character, slot.level, 0, opts.mini ? 'xs' : 'sm') : null;
      if (opts.onCell) {
        const onCell = opts.onCell;
        grid.appendChild(
          h(
            'button',
            {
              class: cls,
              type: 'button',
              'data-row': row,
              'data-col': col,
              'aria-label': `${ROW_LABELS[row]} ${col + 1}번째 칸${slot ? ' (배치됨)' : ''}`,
              onclick: () => onCell(row, col),
            },
            content,
          ),
        );
      } else {
        grid.appendChild(h('span', { class: cls }, content));
      }
    }
  }
  return grid;
}
