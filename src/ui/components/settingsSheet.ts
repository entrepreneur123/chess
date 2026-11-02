/** Settings bottom sheet (sound / haptics / replay tutorial). Values persist in the profile. */
import { haptic, primeAudio, sfx } from '../../audio/sfx';
import { APP_NAME, DEV_CODE } from '../../meta/economy';
import { getProfile, setDevMode, subscribeProfile, updateProfile, type Settings, type ViewSetting } from '../../meta/profile';
import { h, replaceChildren } from '../dom';
import { confirmDialog } from './dialog';
import { toast } from './toast';
import { icon, type IconName } from '../icons';
import { showBottomSheet } from './sheet';
import { showTutorial } from './tutorial';

let openSheet: { close(): void } | null = null;

type BoolSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

function switchRow(key: BoolSetting, label: string, sub: string, ic: IconName): HTMLElement {
  const id = `set-${key}`;
  const btn = h('button', {
    class: 'switch',
    type: 'button',
    role: 'switch',
    id,
    'aria-labelledby': `${id}-label`,
    'data-setting': key,
    'data-sfx': 'none',
  }, h('span', { class: 'switch__thumb' }, icon('check', 14)));
  const sync = () => btn.setAttribute('aria-checked', String(getProfile().settings[key]));
  btn.addEventListener('click', () => {
    const value = !getProfile().settings[key];
    updateProfile((p) => ({ ...p, settings: { ...p.settings, [key]: value } }));
    sync();
    if (key === 'sound' && value) {
      primeAudio();
      sfx('select');
    }
    if (key === 'haptics' && value) haptic('select');
  });
  sync();
  return h(
    'div',
    { class: 'set-row' },
    h('span', { class: 'set-row__icon' }, icon(ic, 22)),
    h('label', { class: 'set-row__main', id: `${id}-label`, for: id }, h('span', { class: 'set-row__title' }, label), h('span', { class: 'set-row__sub' }, sub)),
    btn,
  );
}

/** Board camera: tilted 3D arena or top-down (segmented control). */
function viewRow(): HTMLElement {
  const opts: { value: ViewSetting; label: string; ic: IconName }[] = [
    { value: 'tilt', label: '3D', ic: 'cube' },
    { value: 'top', label: '탑뷰', ic: 'topview' },
  ];
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '보드 시점' });
  const sync = () => {
    const cur = getProfile().settings.view;
    for (const b of Array.from(seg.children)) {
      const on = (b as HTMLElement).dataset.view === cur;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    }
  };
  for (const o of opts) {
    seg.appendChild(
      h(
        'button',
        {
          class: 'seg__btn',
          type: 'button',
          role: 'radio',
          'data-view': o.value,
          'data-setting': 'view',
          onclick: () => {
            if (getProfile().settings.view === o.value) return;
            updateProfile((p) => ({ ...p, settings: { ...p.settings, view: o.value } }));
            sync();
            sfx('select');
          },
        },
        icon(o.ic, 16),
        o.label,
      ),
    );
  }
  sync();
  return h(
    'div',
    { class: 'set-row' },
    h('span', { class: 'set-row__icon' }, icon('topview', 22)),
    h('span', { class: 'set-row__main' }, h('span', { class: 'set-row__title' }, '보드 시점'), h('span', { class: 'set-row__sub' }, '3D 아레나 또는 위에서 내려다보기')),
    seg,
  );
}

/** Developer account row: shows the state; switch off (with confirm) or unlock with the code. */
function devRow(): { el: HTMLElement; dispose: () => void } {
  const host = h('div', { class: 'set-row set-row--dev' });
  const render = () => {
    const on = getProfile().dev;
    const main = h(
      'span',
      { class: 'set-row__main' },
      h('span', { class: 'set-row__title' }, '개발자 계정', on ? h('span', { class: 'chip chip--dev' }, 'DEV') : null),
      h('span', { class: 'set-row__sub' }, on ? '무제한 재화 · 전 캐릭터 최대 성급' : '테스트용 코드를 입력하면 활성화돼요'),
    );
    if (on) {
      replaceChildren(
        host,
        h('span', { class: 'set-row__icon' }, icon('bolt', 22)),
        main,
        h(
          'button',
          {
            class: 'btn btn--tonal btn--sm set-row__action',
            type: 'button',
            'data-action': 'dev-off',
            onclick: async () => {
              const ok = await confirmDialog({
                title: '일반 계정으로 전환할까요?',
                body: '개발자 계정의 재화와 성급은 초기화되고 새 계정으로 시작합니다.',
                confirmLabel: '전환',
                danger: true,
              });
              if (ok) {
                updateProfile((p) => setDevMode(p, false));
                toast('일반 계정으로 전환했어요', { tone: 'success' });
              }
            },
          },
          '일반 계정으로 전환',
        ),
      );
      return;
    }
    const input = h('input', {
      class: 'field__input',
      type: 'password',
      inputmode: 'text',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      placeholder: '코드 입력',
      'aria-label': '개발자 코드',
      'data-action': 'dev-code',
    }) as HTMLInputElement;
    const submit = () => {
      if (input.value.trim() === DEV_CODE) {
        updateProfile((p) => setDevMode(p, true));
        toast('개발자 계정이 활성화됐어요', { tone: 'success' });
      } else {
        toast('코드가 올바르지 않아요', { tone: 'warn' });
        input.select();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    replaceChildren(
      host,
      h('span', { class: 'set-row__icon' }, icon('lock', 22)),
      main,
      h(
        'div',
        { class: 'field' },
        input,
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'data-action': 'dev-on', onclick: submit }, '활성화'),
      ),
    );
  };
  render();
  let lastDev = getProfile().dev;
  const unsub = subscribeProfile(() => {
    if (getProfile().dev !== lastDev) {
      lastDev = getProfile().dev;
      render();
    }
  });
  return { el: host, dispose: unsub };
}

export function showSettings(): void {
  if (openSheet) return;
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const dev = devRow();
  const content = h(
    'div',
    { class: 'settings' },
    h('h2', { class: 'settings__title' }, '설정'),
    h(
      'div',
      { class: 'set-group' },
      switchRow('sound', '효과음', '이동 · 잡기 · 승리 사운드', 'volume'),
      switchRow('voice', '캐릭터 음성', '선택 · 공격 · 스킬 대사', 'person'),
      switchRow('haptics', '진동', canVibrate ? '잡기 · 내 차례 · 승리 시 짧은 진동' : '이 기기에서는 지원되지 않을 수 있어요', 'vibration'),
      viewRow(),
    ),
    h(
      'div',
      { class: 'set-group' },
      h(
        'button',
        {
          class: 'set-row set-row--link',
          type: 'button',
          'data-action': 'replay-tutorial',
          onclick: () => {
            sheet.close();
            void sheet.closed.then(() => showTutorial());
          },
        },
        h('span', { class: 'set-row__icon' }, icon('help', 22)),
        h('span', { class: 'set-row__main' }, h('span', { class: 'set-row__title' }, '게임 방법 다시 보기'), h('span', { class: 'set-row__sub' }, '규칙 · 캐릭터 · 성장 한눈에')),
        icon('chevron', 20, 'set-row__chev'),
      ),
    ),
    h('div', { class: 'set-group' }, dev.el),
    h('p', { class: 'settings__foot' }, APP_NAME),
  );
  const sheet = showBottomSheet(content, { label: '설정' });
  openSheet = sheet;
  void sheet.closed.then(() => {
    dev.dispose();
    openSheet = null;
  });
}
