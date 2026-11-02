import { haptic, sfx } from '../../audio/sfx';
import { CHARACTERS } from '../../engine';
import { BOX, GEM_PACKS } from '../../meta/economy';
import { freeBoxRemainingMs, getProfile, grantGems, isOwned, levelUpCost, openBox, subscribeProfile, updateProfile, type BoxDrop, type BoxKind } from '../../meta/profile';
import { appBar } from '../components/appbar';
import { chestArt } from '../components/chest';
import { confirmDialog } from '../components/dialog';
import { overlayRoot, pushOverlay, registerForceClose } from '../components/overlay';
import { coinChip, gemChip, rarityChip } from '../components/piece';
import { toast } from '../components/toast';
import { Disposables, h, prefersReducedMotion, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';

function fmtRemaining(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Full-screen box opening: drop + shake -> burst (flash, rarity-coloured light) -> card flip.
 * Tapping during the opening skips straight to the reveal. Resolves when dismissed.
 */
function playBoxOpening(drop: BoxDrop, kind: BoxKind, unlocked = false): Promise<void> {
  return new Promise((resolve) => {
    const def = CHARACTERS[drop.character];
    const prog = getProfile().characters[drop.character];
    const cost = levelUpCost(prog.level);
    const reduced = prefersReducedMotion();
    let stage: 'opening' | 'revealed' = 'opening';
    let closed = false;
    const timers: number[] = [];

    const close = () => {
      if (closed) return;
      closed = true;
      timers.forEach((t) => clearTimeout(t));
      pop();
      unforce();
      root.classList.remove('is-in');
      window.setTimeout(() => root.remove(), 260);
      resolve();
    };

    const burst = () => {
      if (closed || root.classList.contains('is-burst')) return;
      root.classList.add('is-burst');
    };

    const reveal = () => {
      if (stage === 'revealed' || closed) return;
      stage = 'revealed';
      burst();
      root.classList.add('is-revealed');
      sfx('reveal');
      haptic(def.rarity === 'common' ? 'select' : 'win');
      timers.push(window.setTimeout(() => okBtn.focus({ preventScroll: true }), reduced ? 0 : 700));
    };

    const pct = cost ? Math.min(100, (prog.cards / cost.cards) * 100) : 100;
    const ready = !!cost && prog.cards >= cost.cards;
    const okBtn = h('button', { class: 'btn btn--primary btn--block btn--lg', type: 'button', 'data-action': 'reveal-ok', onclick: close }, '확인');
    const cardEl = h(
      'div',
      { class: `reveal-card rarity-${def.rarity}`, 'data-reveal': drop.character },
      h(
        'div',
        { class: 'reveal-card__inner' },
        h('div', { class: 'reveal-card__back' }, h('span', { class: 'reveal-card__emblem' }, icon('swords', 44))),
        h(
          'div',
          { class: 'reveal-card__front rarity-frame' },
          h('img', { class: 'reveal-card__art', src: `./chars/${drop.character}-lv${prog.level}.jpg`, alt: '', decoding: 'async', draggable: 'false' }),
          h('div', { class: 'reveal-card__amount' }, h('span', { class: 'reveal-card__x' }, '×'), String(drop.amount)),
          unlocked ? h('div', { class: 'reveal-card__new' }, 'NEW · 캐릭터 해금!') : null,
          h(
            'div',
            { class: 'reveal-card__info' },
            rarityChip(def.rarity),
            h('div', { class: 'reveal-card__name' }, def.nameKo),
          ),
        ),
      ),
    );
    const details = h(
      'div',
      { class: 'reveal-details' },
      unlocked ? h('p', { class: 'reveal-card__unlock' }, `${def.nameKo}을(를) 분대에 넣을 수 있어요 · 진형 편성에서 투입하세요`) : null,
      h('p', { class: 'reveal-card__progress' }, cost ? (ready ? '강화 가능!' : '다음 강화까지') : '최대 레벨', h('b', null, cost ? `${prog.cards} / ${cost.cards}` : `보유 ${prog.cards}`)),
      h('div', { class: 'progress' }, h('span', { class: `progress__bar${ready ? ' is-full' : ''}`, style: `width:${pct}%` })),
      okBtn,
    );
    const root = h(
      'div',
      { class: `box-overlay rarity-${def.rarity}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': '상자 열기' },
      h('div', { class: 'box-overlay__rays', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'box-overlay__stage' },
        h('div', { class: 'burst', 'aria-hidden': 'true' }),
        chestArt(kind, 'box-3d'),
        h('div', { class: 'box-overlay__flash', 'aria-hidden': 'true' }),
        cardEl,
      ),
      details,
      h('p', { class: 'box-overlay__hint' }, '탭하여 건너뛰기'),
    );
    root.addEventListener('click', (e) => {
      if (stage === 'opening') reveal();
      else if (e.target === root) close();
    });
    const pop = pushOverlay({ requestClose: () => (stage === 'opening' ? reveal() : close(), true) });
    const unforce = registerForceClose(close);
    overlayRoot().appendChild(root);
    requestAnimationFrame(() => root.classList.add('is-in'));
    if (!reduced) sfx('boxShake');
    timers.push(window.setTimeout(burst, reduced ? 0 : 1150));
    timers.push(window.setTimeout(reveal, reduced ? 50 : 1400));
  });
}

export function shopScreen(router: Router): Screen {
  const bag = new Disposables();
  const coinHost = h('div', null);
  const body = h('div', { class: 'scroll-body shop__body' });
  const el = h('div', { class: 'shop' }, appBar('상점', { onBack: () => router.home(), trailing: coinHost }), body);
  let busy = false;
  let settled = false;
  const freeLabel = h('span', { class: 'box-card__cta-label' });
  const freeBtn = h('button', { class: 'btn btn--upgrade btn--block', type: 'button', 'data-action': 'open-free', onclick: () => void buy('free') }, icon('gift', 20), freeLabel);

  const buy = async (kind: BoxKind) => {
    if (busy) return;
    const res = openBox(getProfile(), kind);
    if (!res.ok) {
      toast(res.reason === 'coins' ? '코인이 부족합니다. 대전에서 코인을 모아보세요' : '무료 상자는 24시간마다 열 수 있어요', { tone: 'warn' });
      return;
    }
    if (kind === 'basic') {
      // Spending step: confirm so a stray tap never costs coins.
      busy = true;
      const ok = await confirmDialog({
        title: '일반 상자를 열까요?',
        body: h('div', { class: 'confirm-cost' }, h('div', { class: 'confirm-cost__row' }, h('span', null, '소모 코인'), h('b', { class: 'confirm-cost__coin' }, icon('coin', 16), String(BOX.basicPrice))), h('p', { class: 'confirm-cost__note' }, '캐릭터 카드 1종 (1–3장)을 얻어요.')),
        confirmLabel: '열기',
      });
      busy = false;
      if (!ok) return;
      const before = getProfile();
      const again = openBox(before, kind);
      if (!again.ok) return;
      busy = true;
      updateProfile(() => again.profile);
      await playBoxOpening(again.drop, kind, !isOwned(before, again.drop.character));
      busy = false;
      return;
    }
    busy = true;
    const before = getProfile();
    updateProfile(() => res.profile);
    await playBoxOpening(res.drop, kind, !isOwned(before, res.drop.character));
    busy = false;
  };

  const tickFree = () => {
    const rem = freeBoxRemainingMs(getProfile());
    freeBtn.toggleAttribute('disabled', rem > 0);
    freeLabel.textContent = rem > 0 ? `${fmtRemaining(rem)} 후 열기` : '무료로 열기';
  };

  const odds = () => {
    const w = BOX.rarityWeights;
    return `일반 ${w.common}% · 희귀 ${w.rare}% · 영웅 ${w.epic}% · 전설 ${w.legendary}% · 카드 ${BOX.amountMin}–${BOX.amountMax}장`;
  };

  const claimGems = async (gems: number) => {
    if (busy) return;
    busy = true;
    const ok = await confirmDialog({
      title: `보석 ${gems.toLocaleString('ko-KR')}개 받기`,
      body: h('p', null, '테스트 버전에서는 결제 없이 무료로 지급됩니다. 정식 출시 후 인앱 결제로 전환됩니다.'),
      confirmLabel: '받기',
    });
    busy = false;
    if (!ok) return;
    updateProfile((q) => grantGems(q, gems));
    sfx('coin');
    haptic('select');
    toast(`보석 ${gems.toLocaleString('ko-KR')}개를 받았어요`, { tone: 'success' });
  };

  const render = () => {
    const p = getProfile();
    replaceChildren(coinHost, h('div', { class: 'wallet wallet--bar' }, coinChip(p.coins), gemChip(p.gems)));
    tickFree();
    replaceChildren(
      body,
      h('h3', { class: 'section-title section-title--display section-title--pad' }, '캐릭터 상자'),
      h(
        'div',
        { class: 'box-grid' },
        h(
          'article',
          { class: 'box-card box-card--free enter', style: '--i:0' },
          h('span', { class: 'box-card__ribbon' }, 'FREE'),
          h('div', { class: 'box-card__art' }, chestArt('free')),
          h('div', { class: 'box-card__name' }, '무료 일일 상자'),
          h('div', { class: 'box-card__desc' }, '24시간마다 1회'),
          freeBtn,
        ),
        h(
          'article',
          { class: 'box-card enter', style: '--i:1' },
          h('div', { class: 'box-card__art' }, chestArt('basic')),
          h('div', { class: 'box-card__name' }, '일반 상자'),
          h('div', { class: 'box-card__desc' }, `캐릭터 카드 ${BOX.amountMin}–${BOX.amountMax}장`),
          h(
            'button',
            {
              class: `btn ${p.coins >= BOX.basicPrice || p.dev ? 'btn--primary' : 'btn--tonal'} btn--block`,
              type: 'button',
              'data-action': 'open-basic',
              'aria-disabled': p.coins >= BOX.basicPrice || p.dev ? 'false' : 'true',
              onclick: () => void buy('basic'),
            },
            icon('coin', 22),
            h('span', { class: 't-num' }, String(BOX.basicPrice)),
          ),
        ),
      ),
      h('p', { class: 'hint hint--pad odds' }, icon('info', 16), odds()),
      h('h3', { class: 'section-title section-title--display section-title--pad' }, '보석 충전'),
      h(
        'div',
        { class: 'gem-grid' },
        GEM_PACKS.map((g, i) =>
          h(
            'button',
            { class: `gem-pack gem-pack--${i} pressable enter`, style: `--i:${i + 2}`, type: 'button', 'data-action': 'gem-pack', 'data-pack': g.id, onclick: () => void claimGems(g.gems) },
            i === GEM_PACKS.length - 1 ? h('span', { class: 'gem-pack__best' }, 'BEST') : null,
            h('span', { class: 'gem-pack__art', 'aria-hidden': 'true' }, Array.from({ length: i + 1 }, (_, k) => icon('gem', 34 + i * 4 - k * 6, `gem-pack__gem gem-pack__gem--${k}`))),
            h('span', { class: 'gem-pack__amount' }, g.gems.toLocaleString('ko-KR')),
            h('span', { class: 'gem-pack__price' }, h('s', null, g.priceLabel)),
            h('span', { class: 'gem-pack__tag' }, g.testGrant ? '테스트 무료' : '준비 중'),
          ),
        ),
      ),
      h('p', { class: 'hint hint--pad' }, icon('info', 16), '테스트 버전: 보석은 결제 없이 지급됩니다. 캐릭터 강화에 사용하세요.'),
    );
    body.classList.toggle('is-settled', settled);
    settled = true;
  };

  render();
  bag.add(subscribeProfile(render));
  bag.interval(tickFree, 1000);
  return { el, dispose: () => bag.dispose() };
}
