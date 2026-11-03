/** Settings bottom sheet (sound / haptics / replay tutorial). Values persist in the profile. */
import { haptic, primeAudio, sfx } from '../../audio/sfx';
import { APP_NAME } from '../../meta/economy';
import { getProfile, updateProfile, type Settings } from '../../meta/profile';
import { h } from '../dom';
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


export function showSettings(): void {
  if (openSheet) return;
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
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
        h('span', { class: 'set-row__main' }, h('span', { class: 'set-row__title' }, '게임 방법 다시 보기'), h('span', { class: 'set-row__sub' }, '규칙 · 캐릭터 · 성급 한눈에')),
        icon('chevron', 20, 'set-row__chev'),
      ),
    ),
    h('p', { class: 'settings__foot' }, APP_NAME),
  );
  const sheet = showBottomSheet(content, { label: '설정' });
  openSheet = sheet;
  void sheet.closed.then(() => {
    openSheet = null;
  });
}
