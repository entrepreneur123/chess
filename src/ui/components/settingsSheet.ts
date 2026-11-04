/**
 * Settings bottom sheet (sound / music / voice / haptics / replay tutorial). Values persist in the
 * profile; the music bridge follows `sound && music` on its own.
 */
import { haptic, primeAudio, sfx } from '../../audio/sfx';
import { APP_NAME } from '../../meta/economy';
import { DEV_RATING, disableDevMode, enableDevMode, getProfile, isDevMode, unlockDevMode, updateProfile, type Settings } from '../../meta/profile';
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import { showBottomSheet } from './sheet';
import { toast } from './toast';
import { showTutorial } from './tutorial';

/** Taps on the version label that reveal the developer section (like Android's build number). */
const DEV_TAPS = 7;
/** A pause longer than this restarts the tap count. */
const DEV_TAP_GAP_MS = 2000;

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


/**
 * The hidden "개발자 모드" section: one switch that applies infinite currency, rating DEV_RATING and
 * every character at 3성 (the real profile is snapshotted and restored when switched off).
 */
function devSection(): HTMLElement {
  const btn = h('button', {
    class: 'switch switch--dev',
    type: 'button',
    role: 'switch',
    id: 'set-dev',
    'aria-labelledby': 'set-dev-label',
    'data-setting': 'dev',
    'data-sfx': 'none',
  }, h('span', { class: 'switch__thumb' }, icon('check', 14)));
  const sync = () => btn.setAttribute('aria-checked', String(isDevMode(getProfile())));
  btn.addEventListener('click', () => {
    const on = !isDevMode(getProfile());
    updateProfile((p) => (on ? enableDevMode(p) : disableDevMode(p)));
    sync();
    sfx(on ? 'levelup' : 'select');
    haptic('select');
    toast(on ? '개발자 모드 켜짐 · 재화 무한 · 전원 3성' : '원래 프로필로 되돌렸어요', { tone: on ? 'success' : 'neutral' });
  });
  sync();
  return h(
    'div',
    { class: 'set-group set-group--dev', 'data-section': 'dev' },
    h('div', { class: 'set-group__head' }, icon('code', 16), '개발자 모드'),
    h(
      'div',
      { class: 'set-row' },
      h('span', { class: 'set-row__icon set-row__icon--dev' }, icon('code', 22)),
      h(
        'label',
        { class: 'set-row__main', id: 'set-dev-label', for: 'set-dev' },
        h('span', { class: 'set-row__title' }, '개발자 모드 켜기'),
        h('span', { class: 'set-row__sub' }, `재화 ∞ · 레이팅 ${DEV_RATING} · 전원 3성 · 끄면 원래대로`),
      ),
      btn,
    ),
  );
}

/**
 * The version label. Tapping it DEV_TAPS times in a row reveals the developer section; the last
 * few taps count down in a toast, as on Android.
 */
function versionLabel(onUnlock: () => void): HTMLElement {
  let taps = 0;
  let last = 0;
  return h(
    'button',
    {
      class: 'settings__version',
      type: 'button',
      'data-action': 'version',
      'data-sfx': 'none',
      'aria-label': `버전 ${__APP_VERSION__}`,
      onclick: () => {
        const now = Date.now();
        taps = now - last > DEV_TAP_GAP_MS ? 1 : taps + 1;
        last = now;
        if (getProfile().devMode.unlocked) {
          if (taps >= 3) toast('이미 개발자 모드가 열려 있어요');
          return;
        }
        const left = DEV_TAPS - taps;
        if (left <= 0) {
          taps = 0;
          updateProfile(unlockDevMode);
          sfx('levelup');
          haptic('win');
          toast('개발자 모드 활성화', { tone: 'success' });
          onUnlock();
        } else if (left <= 3) {
          sfx('tap');
          toast(`개발자 모드까지 ${left}번 남았어요`, { duration: 1200 });
        }
      },
    },
    `${APP_NAME} · v${__APP_VERSION__}`,
  );
}

export function showSettings(): void {
  if (openSheet) return;
  const devHost = h('div', { class: 'settings__dev' }, getProfile().devMode.unlocked ? devSection() : null);
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const content = h(
    'div',
    { class: 'settings' },
    h('h2', { class: 'settings__title' }, '설정'),
    h(
      'div',
      { class: 'set-group' },
      switchRow('sound', '효과음', '이동 · 잡기 · 승리 사운드', 'volume'),
      switchRow('music', '배경음악', '전장마다 다른 테마 음악', 'music'),
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
    devHost,
    h(
      'p',
      { class: 'settings__foot' },
      versionLabel(() => {
        const section = devSection();
        section.classList.add('is-revealed');
        devHost.replaceChildren(section);
        section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }),
    ),
  );
  const sheet = showBottomSheet(content, { label: '설정' });
  openSheet = sheet;
  void sheet.closed.then(() => {
    openSheet = null;
  });
}
