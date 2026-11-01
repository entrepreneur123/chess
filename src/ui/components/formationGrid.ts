import { BOARD_SIZE, ZONE_DEPTH, type CharacterId, type Formation } from '../../engine';
import { h } from '../dom';
import { pieceToken } from './piece';

export const ROW_LABELS = ['후열', '중열', '전열']; // index = local row (0 = back rank)

export interface FormationGridOptions {
  mini?: boolean;
  selected?: CharacterId | null;
  onCell?: (row: number, col: number) => void;
}

/**
 * 3 x 12 home-zone grid. The front row (local row 2) is drawn at the top because the enemy is "up".
 */
export function formationGrid(f: Formation, opts: FormationGridOptions = {}): HTMLElement {
  const grid = h('div', {
    class: `fgrid${opts.mini ? ' fgrid--mini' : ''}`,
    role: opts.onCell ? 'grid' : 'img',
    'aria-label': opts.onCell ? '배치 구역 (위쪽이 적 방향)' : '현재 진형 미리보기',
  });
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
