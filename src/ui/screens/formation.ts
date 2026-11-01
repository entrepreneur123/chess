import {
  CHARACTERS,
  CHARACTER_IDS,
  defaultFormation,
  randomFormation,
  validateFormation,
  type CharacterId,
  type Formation,
} from '../../engine';
import { getProfile, levelsOf, syncFormationLevels, updateProfile } from '../../meta/profile';
import { appBar } from '../components/appbar';
import { confirmDialog } from '../components/dialog';
import { formationGrid, ROW_LABELS } from '../components/formationGrid';
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
    { class: 'btn btn--filled', type: 'button', 'data-action': 'save', onclick: () => save() },
    icon('save', 20),
    '저장',
  );

  const isDirty = () => !sameFormation(work, saved) || !getProfile().formationSaved;

  const leave = async () => {
    if (!sameFormation(work, saved)) {
      const ok = await confirmDialog({
        title: '저장하지 않고 나갈까요?',
        body: '변경한 배치가 사라집니다.',
        confirmLabel: '나가기',
        danger: true,
      });
      if (!ok) return;
    }
    router.home();
  };

  const placeAt = (row: number, col: number) => {
    const occupant = work.find((s) => s.row === row && s.col === col);
    if (!selected) {
      if (occupant) selected = occupant.character;
      else toast('먼저 배치할 캐릭터를 선택하세요');
      render();
      return;
    }
    if (occupant?.character === selected) {
      selected = null;
      render();
      return;
    }
    const mover = work.find((s) => s.character === selected);
    const next = work.filter((s) => s.character !== selected && s !== occupant);
    if (occupant && mover) next.push({ ...occupant, row: mover.row, col: mover.col }); // swap
    next.push({ character: selected, level: levels[selected], row, col });
    work = next;
    selected = null;
    render();
  };

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
            class: `tray-card${selected === id ? ' is-selected' : ''}`,
            type: 'button',
            role: 'option',
            'aria-selected': selected === id ? 'true' : 'false',
            'data-character': id,
            onclick: () => {
              selected = selected === id ? null : id;
              render();
            },
          },
          h('div', { class: 'tray-card__token' }, unitArt(id, lv, { size: 56 })),
          h(
            'div',
            { class: 'tray-card__main' },
            h('div', { class: 'tray-card__head' }, h('span', { class: 'tray-card__name' }, def.nameKo), rarityChip(def.rarity), h('span', { class: 'lv-text' }, `Lv.${lv}`)),
            h('div', { class: 'tray-card__desc' }, def.descKo[lv - 1]),
            h(
              'div',
              { class: 'tray-card__where' },
              slot ? `${ROW_LABELS[slot.row]} · ${slot.col + 1}번 칸` : '미배치',
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
            { class: 'hint' },
            selected
              ? `${CHARACTERS[selected].nameKo}을(를) 놓을 칸을 탭하세요. 다른 말 위에 놓으면 자리를 바꿉니다.`
              : '캐릭터를 선택한 뒤 칸을 탭해 배치하세요. 배치된 말을 탭하면 집어 듭니다.',
          )
        : h('ul', { class: 'errors' }, v.errors.map((e) => h('li', null, e))),
    );
    saveBtn.toggleAttribute('disabled', !v.ok || !isDirty());
  };

  replaceChildren(
    el,
    appBar('진형 편성', { onBack: () => void leave() }),
    h(
      'div',
      { class: 'scroll-body formation__body' },
      h(
        'section',
        { class: 'card card--flush' },
        h('div', { class: 'enemy-hint' }, icon('up', 16), '적 진영 방향'),
        gridHost,
        h('div', { class: 'zone-caption' }, '내 배치 구역 (3 × 12)'),
      ),
      statusHost,
      h('h3', { class: 'section-title section-title--pad' }, '내 캐릭터'),
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
            work = defaultFormation(levels);
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
            work = randomFormation(Math.random, levels);
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

  return { el, onBack: () => void leave() };
}
