/**
 * The two spending flows, shared by the 상점 and 캐릭터 tabs: unlock a character with essence and
 * raise a star with tokens. Each asks for confirmation, applies the pure profile action and gives
 * feedback. Returns whether the profile changed.
 */
import { haptic, sfx } from '../../audio/sfx';
import { CHARACTERS, josa, type CharacterId, type Level } from '../../engine';
import { buyCharacter, getProfile, priceOf, setProfile, upgradeCharacter } from '../../meta/profile';
import { upgradeCost } from '../../meta/progression';
import { h } from '../dom';
import { icon } from '../icons';
import { confirmDialog } from './dialog';
import { balanceText, essenceIcon, tokenIcon } from './currency';
import { movementDiagram, unitArt } from './piece';
import { toast } from './toast';

export async function confirmBuy(id: CharacterId): Promise<boolean> {
  const def = CHARACTERS[id];
  const price = priceOf(id);
  const ok = await confirmDialog({
    title: `${josa(def.nameKo, '을/를')} 영입할까요?`,
    body: h(
      'div',
      { class: 'spend' },
      unitArt(id, 1, { size: 72 }),
      h('p', { class: 'spend__cost' }, essenceIcon(22), h('b', { class: 't-num' }, String(price)), '에센셜 사용'),
      h('p', { class: 'spend__sub' }, `1성으로 합류 · 보유 ${balanceText(getProfile(), getProfile().essence)} → ${balanceText(getProfile(), getProfile().essence - price)}`),
    ),
    confirmLabel: '영입',
  });
  if (!ok) return false;
  const r = buyCharacter(getProfile(), id);
  if (!r.ok) {
    toast(r.reason === 'essence' ? '에센셜이 부족해요' : '지금은 영입할 수 없어요', { tone: 'warn' });
    return false;
  }
  setProfile(r.profile);
  sfx('levelup');
  haptic('win');
  toast(`${josa(def.nameKo, '이/가')} 합류했어요! 진형에서 배치해 보세요`, { tone: 'success', duration: 2600 });
  return true;
}

export async function confirmUpgrade(id: CharacterId): Promise<boolean> {
  const def = CHARACTERS[id];
  const from = getProfile().owned[id] as Level;
  const cost = upgradeCost(id, from);
  if (cost === null) return false;
  const to = (from + 1) as Level;
  const ok = await confirmDialog({
    title: `${def.nameKo} ${to}성 강화`,
    body: h(
      'div',
      { class: 'spend' },
      h(
        'div',
        { class: 'spend__grow' },
        h('div', { class: 'spend__lv' }, movementDiagram(id, from, { cell: 6 }), h('span', null, `${from}성`)),
        icon('chevron', 22),
        h('div', { class: 'spend__lv is-next' }, movementDiagram(id, to, { cell: 6 }), h('span', null, `${to}성`)),
      ),
      h('p', { class: 'spend__cost' }, tokenIcon(22), h('b', { class: 't-num' }, String(cost)), '토큰 사용'),
      h('p', { class: 'spend__sub' }, `${def.descKo[to - 1]} · 보유 ${balanceText(getProfile(), getProfile().tokens)} → ${balanceText(getProfile(), getProfile().tokens - cost)}`),
    ),
    confirmLabel: '강화',
  });
  if (!ok) return false;
  const r = upgradeCharacter(getProfile(), id);
  if (!r.ok) {
    toast(r.reason === 'tokens' ? '토큰이 부족해요' : '강화할 수 없어요', { tone: 'warn' });
    return false;
  }
  setProfile(r.profile);
  sfx('levelup');
  haptic('win');
  toast(`${def.nameKo} ${to}성 달성! 바로 출전 성급으로 골랐어요`, { tone: 'success', duration: 2400 });
  return true;
}
