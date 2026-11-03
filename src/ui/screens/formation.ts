import {
  CHARACTERS,
  CHARACTER_IDS,
  PIECES_PER_SIDE,
  defaultFormation,
  josa,
  randomFormation,
  squadOf,
  validateFormation,
  type CharacterId,
  type Formation,
} from '../../engine';
import { haptic, sfx } from '../../audio/sfx';
import { getProfile, levelsOf, syncFormationLevels, updateProfile } from '../../meta/profile';
import { appBar, settingsButton } from '../components/appbar';
import { showSettings } from '../components/settingsSheet';
import { confirmDialog } from '../components/dialog';
import { DragGhost, trackPointerDrag, type DragTracker } from '../components/drag';
import { formationGrid, placeInFormation, ROW_LABELS } from '../components/formationGrid';
import { movementDiagram, rarityChip, unitArt } from '../components/piece';
import { toast } from '../components/toast';
import { h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';

const sameFormation = (a: Formation, b: Formation) =>
  a.length === b.length &&
  a.every((s) => b.some((t) => t.character === s.character && t.row === s.row && t.col === s.col));

export function formationScreen(router: Router): Screen {
  const profile = getProfile();
  const levels = levelsOf(profile);
  let saved: Formation = profile.formation.map((s) => ({ ...s }));
  let work: Formation = saved.map((s) => ({ ...s }));
  let selected: CharacterId | null = null;

  const el = h('div', { class: 'formation' });
  const gridHost = h('div', { class: 'fgrid-host' });
  const trayHost = h('div', { class: 'tray', role: 'listbox', 'aria-label': '캐릭터 선택' });
  const statusHost = h('div', { class: 'form-status', 'aria-live': 'polite' });
  const saveBtn = h(
    'button',
    { class: 'btn btn--primary', type: 'button', 'data-action': 'save', onclick: () => save() },
    icon('save', 20),
    '저장',
  );

  const isDirty = () => !sameFormation(work, saved) || !getProfile().formationSaved;

  /** Unsaved edits: ask before leaving (back or a tab switch). */
  const confirmLeave = async () =>
    sameFormation(work, saved) ||
    confirmDialog({
      title: '저장하지 않고 나갈까요?',
      body: '변경한 배치가 사라집니다.',
      confirmLabel: '나가기',
      danger: true,
    });

  const leave = async () => {
    if (await confirmLeave()) router.home();
  };

  const FULL_MSG = `말은 ${PIECES_PER_SIDE}개까지 배치할 수 있어요. 배치된 말을 탭하면 교체됩니다`;

  /** Tap flow: pick up the occupant, or put the held character down (move / swap / replace). */
  const placeAt = (row: number, col: number) => {
    const occupant = work.find((s) => s.row === row && s.col === col);
    if (!selected) {
      if (occupant) selected = occupant.character;
      else toast('먼저 배치할 캐릭터를 선택하세요');
      render();
      return;
    }
    const res = placeInFormation(work, selected, levels[selected], row, col);
    if (!res.ok) {
      // Tapping the held piece again puts it back; a benched one needs a fielded one to replace.
      if (res.reason === 'same') {
        selected = null;
        render();
      } else toast(FULL_MSG, { tone: 'warn' });
      return;
    }
    work = res.formation;
    selected = null;
    render();
  };

  // ---------- drag and drop: a unit from its cell or from the roster onto a cell of the zone
  let tracker: DragTracker | null = null;
  let drag: {
    character: CharacterId;
    fromCell: boolean;
    /** Selection before the drag (restored when the drag is cancelled). */
    prevSelected: CharacterId | null;
    ghost: DragGhost;
    x: number;
    y: number;
    hover: HTMLElement | null;
    raf: number;
    scroller: HTMLElement | null;
  } | null = null;
  /** Roster ghosts still flying back / settling (removed on leave). */
  const ghosts = new Set<DragGhost>();

  const cellEl = (row: number, col: number) => gridHost.querySelector<HTMLElement>(`.fgrid__cell[data-row="${row}"][data-col="${col}"]`);
  const trayTokenEl = (id: CharacterId) => trayHost.querySelector<HTMLElement>(`.tray-card[data-character="${id}"] .tray-card__token`);
  /** Where a character is shown: its cell when fielded, else its roster card token. */
  const homeEl = (id: CharacterId, preferCell: boolean) => {
    const slot = work.find((s) => s.character === id);
    return (preferCell && slot ? cellEl(slot.row, slot.col) : null) ?? trayTokenEl(id) ?? (slot ? cellEl(slot.row, slot.col) : null);
  };
  const markSource = (id: CharacterId) => {
    const slot = work.find((s) => s.character === id);
    if (slot) cellEl(slot.row, slot.col)?.classList.add('is-drag-source');
    trayTokenEl(id)?.classList.add('is-drag-source');
  };
  const dropCellAt = (x: number, y: number): HTMLElement | null => {
    const hit = document.elementFromPoint(x, y);
    const cell = hit?.closest<HTMLElement>('.fgrid__cell');
    return cell && gridHost.contains(cell) ? cell : null;
  };
  const cellPos = (cell: HTMLElement) => ({ row: Number(cell.dataset.row), col: Number(cell.dataset.col) });
  const canDropOn = (id: CharacterId, cell: HTMLElement) => {
    const { row, col } = cellPos(cell);
    return placeInFormation(work, id, levels[id], row, col).ok;
  };
  const setHover = (cell: HTMLElement | null) => {
    const d = drag;
    if (!d || cell === d.hover) return;
    d.hover?.classList.remove('is-drop-hover', 'is-drop-swap');
    d.hover = cell && canDropOn(d.character, cell) ? cell : null;
    if (d.hover) d.hover.classList.add('is-drop-hover', ...(d.hover.classList.contains('has-piece') ? ['is-drop-swap'] : []));
    d.ghost.setOver(!!d.hover);
  };
  /** Per frame while dragging: auto-scroll near the scroll area's edges, then re-hit-test. */
  const dragFrame = () => {
    const d = drag;
    if (!d) return;
    d.raf = 0;
    const sc = d.scroller;
    if (sc) {
      const r = sc.getBoundingClientRect();
      const edge = 56;
      const v = d.y < r.top + edge ? -Math.ceil((r.top + edge - d.y) / 5) : d.y > r.bottom - edge ? Math.ceil((d.y - (r.bottom - edge)) / 5) : 0;
      if (v !== 0) {
        const before = sc.scrollTop;
        sc.scrollTop = before + v;
        if (sc.scrollTop !== before) d.raf = requestAnimationFrame(dragFrame);
      }
    }
    setHover(dropCellAt(d.x, d.y));
    d.ghost.follow(d.x, d.y);
  };
  const flyHome = (g: DragGhost, target: HTMLElement | null, fade: boolean) => {
    ghosts.add(g);
    const r = target?.getBoundingClientRect();
    if (!r || r.width === 0) {
      g.remove();
      ghosts.delete(g);
      return;
    }
    void g.settle(r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width, r.height) * 0.8, { ms: fade ? 150 : 210, fade }).then(() => ghosts.delete(g));
  };
  const endDrag = (dropped: { x: number; y: number } | null) => {
    const d = drag;
    drag = null;
    tracker = null;
    if (!d) return;
    if (d.raf) cancelAnimationFrame(d.raf);
    const cell = dropped ? dropCellAt(dropped.x, dropped.y) : null;
    const res = cell ? placeInFormation(work, d.character, levels[d.character], cellPos(cell).row, cellPos(cell).col) : null;
    if (res?.ok) {
      work = res.formation;
      selected = null;
      render();
      const { row, col } = cellPos(cell!);
      const landed = cellEl(row, col);
      landed?.classList.add('is-dropped');
      flyHome(d.ghost, landed, true);
      sfx('land');
      haptic('light');
      return;
    }
    if (res && !res.ok && res.reason === 'full') toast(FULL_MSG, { tone: 'warn' });
    else if (dropped && !(res && res.reason === 'same')) sfx('tap');
    selected = d.prevSelected;
    render();
    flyHome(d.ghost, homeEl(d.character, d.fromCell), false);
  };
  const onPointerDown = (ev: PointerEvent) => {
    if (tracker || !ev.isPrimary || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const t = ev.target as Element | null;
    let character: CharacterId | null = null;
    let fromCell = false;
    const cell = t?.closest<HTMLElement>('.fgrid__cell.has-piece');
    if (cell && gridHost.contains(cell)) {
      const { row, col } = cellPos(cell);
      character = work.find((s) => s.row === row && s.col === col)?.character ?? null;
      fromCell = true;
    } else {
      // Roster: touch drags start on the unit coin only (the rest of the card scrolls the page);
      // a mouse can grab the whole card.
      const card = t?.closest<HTMLElement>('.tray-card');
      if (card && trayHost.contains(card) && (ev.pointerType === 'mouse' || t?.closest('.tray-card__token'))) {
        character = (card.dataset.character as CharacterId | undefined) ?? null;
      }
    }
    if (!character || !CHARACTERS[character]) return;
    const id = character;
    tracker = trackPointerDrag(ev, el, {
      start: (x, y) => {
        const touch = ev.pointerType !== 'mouse';
        const size = touch ? 60 : 52;
        const ghost = new DragGhost(unitArt(id, levels[id], { size, owner: 0 }), { size, lift: touch ? 50 : 0, cls: touch ? 'drag-ghost--touch' : '' });
        drag = { character: id, fromCell, prevSelected: selected, ghost, x, y, hover: null, raf: 0, scroller: el.querySelector<HTMLElement>('.scroll-body') };
        // Picking a unit up is the same as tapping it: it is held and the free squares light up.
        selected = id;
        render();
        markSource(id);
        ghost.follow(x, y);
        sfx('select');
        haptic('light');
        return true;
      },
      move: (x, y) => {
        const d = drag;
        if (!d) return;
        d.x = x;
        d.y = y;
        if (!d.raf) dragFrame();
      },
      drop: (x, y) => endDrag({ x, y }),
      cancel: () => endDrag(null),
    });
  };
  // Pre-drag presses that end as taps just drop the tracker reference.
  const onPointerEnd = (ev: PointerEvent) => {
    if (tracker && !tracker.dragging && ev.isPrimary) tracker = null;
  };
  el.addEventListener('pointerdown', onPointerDown);

  const save = () => {
    const v = validateFormation(work);
    if (!v.ok) {
      toast(v.errors[0] ?? '배치를 확인하세요', { tone: 'warn' });
      return;
    }
    const f = syncFormationLevels(work, levelsOf(getProfile()));
    updateProfile((p) => ({ ...p, formation: f, formationSaved: true }));
    saved = f.map((s) => ({ ...s }));
    toast('진형을 저장했습니다', { tone: 'success' });
    render();
  };

  const render = () => {
    const v = validateFormation(work);
    replaceChildren(gridHost, formationGrid(work, { selected, onCell: placeAt }));
    replaceChildren(
      trayHost,
      CHARACTER_IDS.map((id) => {
        const def = CHARACTERS[id];
        const slot = work.find((s) => s.character === id);
        const lv = levels[id];
        return h(
          'button',
          {
            class: `tray-card pressable rarity-${def.rarity}${selected === id ? ' is-selected' : ''}${slot ? '' : ' is-benched'}`,
            type: 'button',
            role: 'option',
            'aria-selected': selected === id ? 'true' : 'false',
            'data-character': id,
            onclick: () => {
              selected = selected === id ? null : id;
              render();
            },
          },
          selected === id ? h('span', { class: 'tray-card__pick' }, '선택됨') : null,
          h('div', { class: 'tray-card__token' }, unitArt(id, lv, { size: 56 })),
          h(
            'div',
            { class: 'tray-card__main' },
            h('div', { class: 'tray-card__head' }, h('span', { class: 'tray-card__name' }, def.nameKo), rarityChip(def.rarity), h('span', { class: 'lv-text' }, `${lv}성`)),
            h('div', { class: 'tray-card__desc' }, def.descKo[lv - 1]),
            h(
              'div',
              { class: `tray-card__where${slot ? '' : ' is-off'}` },
              slot ? `${ROW_LABELS[slot.row]} · ${slot.col + 1}번 칸` : '대기 중 · 배치된 말을 탭해 교체',
            ),
          ),
          h('div', { class: 'tray-card__diagram' }, movementDiagram(id, lv, { cell: 7 })),
        );
      }),
    );
    replaceChildren(
      statusHost,
      v.ok
        ? h(
            'p',
            { class: `hint${selected ? ' is-holding' : ''}` },
            icon(selected ? 'touch' : 'info', 16),
            drag
              ? `놓을 칸에서 손을 떼세요 · 말 위에 놓으면 교체`
              : selected
              ? work.some((s) => s.character === selected)
                ? `${josa(CHARACTERS[selected].nameKo, '을/를')} 놓을 칸을 탭하세요`
                : `${josa(CHARACTERS[selected].nameKo, '와/과')} 바꿀 말을 탭하세요`
              : `끌어다 놓거나 탭해서 배치 · 분대 ${PIECES_PER_SIDE}명`,
          )
        : h('ul', { class: 'errors' }, v.errors.map((e) => h('li', null, e))),
    );
    saveBtn.toggleAttribute('disabled', !v.ok || !isDirty());
  };

  replaceChildren(
    el,
    appBar('진형 편성', { trailing: settingsButton(() => showSettings()) }),
    h(
      'div',
      { class: 'scroll-body formation__body' },
      h(
        'section',
        { class: 'zone-board enter', style: '--i:0' },
        h('div', { class: 'enemy-hint' }, h('span', { class: 'enemy-hint__chev', 'aria-hidden': 'true' }, icon('up', 16), icon('up', 16)), '적 진영 방향'),
        gridHost,
        h('div', { class: 'zone-caption' }, '내 배치 구역 · 3 × 12'),
      ),
      statusHost,
      h('h3', { class: 'section-title section-title--display section-title--pad' }, '내 캐릭터'),
      trayHost,
    ),
    h(
      'div',
      { class: 'action-bar' },
      h(
        'button',
        {
          class: 'btn btn--tonal',
          type: 'button',
          'data-action': 'recommend',
          onclick: () => {
            work = defaultFormation(levels, squadOf(work));
            selected = null;
            render();
          },
        },
        icon('magic', 20),
        '추천 배치',
      ),
      h(
        'button',
        {
          class: 'btn btn--tonal',
          type: 'button',
          'data-action': 'random',
          onclick: () => {
            work = randomFormation(Math.random, levels, squadOf(work));
            selected = null;
            render();
          },
        },
        icon('shuffle', 20),
        '랜덤',
      ),
      saveBtn,
    ),
  );
  render();

  return {
    el,
    onBack: () => void leave(),
    beforeLeave: confirmLeave,
    mount() {
      window.addEventListener('pointerup', onPointerEnd);
      window.addEventListener('pointercancel', onPointerEnd);
    },
    dispose() {
      tracker?.cancel();
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      for (const g of ghosts) g.remove();
      ghosts.clear();
    },
  };
}
