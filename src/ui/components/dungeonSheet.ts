/**
 * Dungeon picker (bottom sheet): 쉬움 / 보통 / 어려움 / 극악, each with its token reward and what
 * the AI fields, plus today's reward status. Picking one remembers it and starts the match.
 */
import { haptic, sfx } from '../../audio/sfx';
import { DUNGEON_LABEL, DUNGEON_LEVELS, DUNGEON_REWARD, dungeonRewardAvailable, type DungeonLevel } from '../../meta/progression';
import { getProfile, updateProfile } from '../../meta/profile';
import { h } from '../dom';
import { icon } from '../icons';
import { tokenIcon } from './currency';
import { showBottomSheet } from './sheet';

/** What each tier fields (UI copy; the squads live in meta/opponent.ts). */
const TIER_DESC: Record<DungeonLevel, string> = {
  easy: '2성 분대 · 약한 수읽기',
  normal: '3성 1명 + 2성 2명 · 보통 수읽기',
  hard: '전원 3성 · 전설 포함 · 강한 수읽기',
  extreme: '전원 3성 · 전설 포함 · 최강 수읽기',
};

let open = false;

export function showDungeonPicker(onPick: (level: DungeonLevel) => void): void {
  if (open) return;
  open = true;
  const p = getProfile();
  const available = dungeonRewardAvailable(p.dungeon.lastClaimDay);
  const rows = DUNGEON_LEVELS.map((lvl, i) =>
    h(
      'button',
      {
        class: `dgn-row dgn-row--${lvl}${p.dungeonLevel === lvl ? ' is-last' : ''}`,
        type: 'button',
        'data-action': 'dungeon-pick',
        'data-level': lvl,
        'aria-label': `${DUNGEON_LABEL[lvl]} · ${TIER_DESC[lvl]} · ${available ? `승리 시 토큰 ${DUNGEON_REWARD[lvl]}개` : '오늘 보상 받음, 연습'}`,
        onclick: () => {
          sfx('select');
          haptic('light');
          if (getProfile().dungeonLevel !== lvl) updateProfile((q) => ({ ...q, dungeonLevel: lvl }));
          sheet.close();
          void sheet.closed.then(() => onPick(lvl));
        },
      },
      h('span', { class: 'dgn-row__skulls', 'aria-hidden': 'true' }, [0, 1, 2, 3].map((k) => h('i', { class: k <= i ? 'is-on' : '' }))),
      h('span', { class: 'dgn-row__main' }, h('span', { class: 'dgn-row__name' }, DUNGEON_LABEL[lvl]), h('span', { class: 'dgn-row__desc' }, TIER_DESC[lvl])),
      h('span', { class: `dgn-row__reward${available ? '' : ' is-claimed'}` }, tokenIcon(20), h('b', null, `+${DUNGEON_REWARD[lvl]}`)),
      icon('chevron', 20, 'dgn-row__chev'),
    ),
  );
  const content = h(
    'div',
    { class: 'dgn' },
    h('h2', { class: 'dgn__title' }, '던전'),
    h(
      'p',
      { class: `dgn__status${available ? ' is-open' : ''}`, 'data-dungeon-status': available ? 'open' : 'claimed' },
      icon(available ? 'gift' : 'check', 16),
      available ? '오늘 보상 가능 · 첫 승리 때 토큰 지급' : '오늘 보상 받음 · 내일 자정에 다시 열려요',
    ),
    h('div', { class: 'dgn__rows' }, rows),
    h('p', { class: 'dgn__note' }, available ? '하루 한 번, 승리해야 받아요. 패배·무승부는 기회가 남아요' : '지금은 보상 없이 연습할 수 있어요 · 레이팅 변동 없음'),
  );
  const sheet = showBottomSheet(content, { label: '던전 난이도 선택' });
  void sheet.closed.then(() => {
    open = false;
  });
}
