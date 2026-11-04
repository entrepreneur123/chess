/**
 * Progression chrome shared by the tab screens: the token and essence icons (inline SVG, flat
 * shaded facets so no gradient ids can collide), the arena badge, the top status bar (rating +
 * arena badge, tokens, essence, settings) and the short "how do I earn this" explainers.
 */
import { haptic, sfx } from '../../audio/sfx';
import { DUNGEON_LABEL, DUNGEON_LEVELS, DUNGEON_REWARD, ESSENCE_REWARD, arenaForRating, type ArenaDef } from '../../meta/progression';
import { getProfile, isDevMode, subscribeProfile, type Profile } from '../../meta/profile';
import { h, prefersReducedMotion } from '../dom';
import { icon } from '../icons';
import type { Router } from '../router';
import { settingsButton } from './appbar';
import { showSettings } from './settingsSheet';
import { showBottomSheet } from './sheet';

const NS = 'http://www.w3.org/2000/svg';

function svg(size: number, cls: string, parts: [string, string][], label?: string): SVGSVGElement {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('class', cls);
  if (label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  } else el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  for (const [tag, attrs] of parts) {
    const p = document.createElementNS(NS, tag);
    for (const kv of attrs.split(';')) {
      const i = kv.indexOf('=');
      if (i > 0) p.setAttribute(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    el.appendChild(p);
  }
  return el;
}

/**
 * 토큰: a gold hexagonal token. Six facets lit from the top-left, a sunken inner hex and a
 * gilded rim.
 */
export function tokenIcon(size = 20, label?: string): SVGSVGElement {
  const c = '12,12';
  const v = ['12,1.5', '21.1,6.75', '21.1,17.25', '12,22.5', '2.9,17.25', '2.9,6.75'];
  const tones = ['#ffe7a3', '#f7cf63', '#c8891e', '#9c6414', '#d79a2c', '#f2c14e'];
  const facets: [string, string][] = v.map((p, i) => ['polygon', `points=${c} ${p} ${v[(i + 1) % 6]};fill=${tones[i]}`]);
  return svg(size, 'cur-icon cur-icon--token', [
    ['polygon', `points=${v.join(' ')};fill=#6e4510`],
    ...facets,
    ['polygon', 'points=12,6.2 17,9.1 17,14.9 12,17.8 7,14.9 7,9.1;fill=#e0a93a;stroke=#6e4510;stroke-width=1.2;stroke-linejoin=round'],
    ['polygon', 'points=12,6.2 17,9.1 12,12 7,9.1;fill=#ffe7a3;opacity=0.55'],
    ['polygon', `points=${v.join(' ')};fill=none;stroke=#3d2508;stroke-width=1.1;stroke-linejoin=round`],
  ], label);
}

/** 에센셜: an arcane crystal shard with a lit crown and a spark. */
export function essenceIcon(size = 20, label?: string): SVGSVGElement {
  return svg(size, 'cur-icon cur-icon--essence', [
    ['polygon', 'points=12,1.5 19.5,9 12,22.5 4.5,9;fill=#2e1d78'],
    ['polygon', 'points=12,2.6 4.9,9 12,9.6;fill=#e4dcff'],
    ['polygon', 'points=12,2.6 19.1,9 12,9.6;fill=#a993ff'],
    ['polygon', 'points=4.9,9 12,9.6 12,21.2;fill=#8b6cff'],
    ['polygon', 'points=19.1,9 12,9.6 12,21.2;fill=#5b3fd1'],
    ['polygon', 'points=12,1.5 19.5,9 12,22.5 4.5,9;fill=none;stroke=#1a0f4d;stroke-width=1.1;stroke-linejoin=round'],
    ['path', 'd=M19.4 2.2l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z;fill=#ffffff'],
  ], label);
}

/** A small shield emblem carrying the arena number, tinted with the arena accent. */
export function arenaBadge(a: ArenaDef, size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  return h('span', { class: `arena-badge arena-badge--${size}`, style: `--arena-accent:${a.accent}`, 'aria-hidden': 'true' }, h('b', null, String(a.index)));
}

/** Animate a number from `from` to `to` (instant with reduced motion). Returns a cancel function. */
export function countUp(el: HTMLElement, from: number, to: number, ms = 900, fmt: (n: number) => string = String): () => void {
  if (from === to || prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
    el.textContent = fmt(to);
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now();
  const tick = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  el.textContent = fmt(from);
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    el.textContent = fmt(to);
  };
}

/** A currency balance as shown: "∞" while developer mode is on. */
export function balanceText(p: Profile, n: number): string {
  return isDevMode(p) ? '∞' : String(n);
}

let infoOpen = false;

/** Short explainer of how a currency is earned and what it buys. */
export function showCurrencyInfo(kind: 'tokens' | 'essence', go?: (to: 'dungeon' | 'ranked') => void): void {
  if (infoOpen) return;
  infoOpen = true;
  const p = getProfile();
  const tokens = kind === 'tokens';
  const rows = tokens
    ? DUNGEON_LEVELS.map((l) => h('li', null, h('span', null, `던전 ${DUNGEON_LABEL[l]}`), h('b', null, tokenIcon(16), `+${DUNGEON_REWARD[l]}`)))
    : [
        h('li', null, h('span', null, '전장전 · 견습전투 승리'), h('b', null, essenceIcon(16), `+${ESSENCE_REWARD.win}`)),
        h('li', null, h('span', null, '무승부'), h('b', null, essenceIcon(16), `+${ESSENCE_REWARD.draw}`)),
        h('li', null, h('span', null, '패배'), h('b', null, essenceIcon(16), `+${ESSENCE_REWARD.loss}`)),
      ];
  const content = h(
    'div',
    { class: 'cur-info' },
    h(
      'div',
      { class: 'cur-info__head' },
      h('span', { class: 'cur-info__icon' }, tokens ? tokenIcon(44) : essenceIcon(44)),
      h(
        'div',
        null,
        h('h2', { class: 'cur-info__title' }, tokens ? '토큰' : '에센셜'),
        h('p', { class: 'cur-info__have' }, `보유 ${balanceText(p, tokens ? p.tokens : p.essence)}`),
      ),
    ),
    h('p', { class: 'cur-info__lead' }, tokens ? '캐릭터 성급 강화(1성 → 2성 → 3성)에 써요. 던전에서 하루 한 번, 첫 승리 때 받아요.' : '상점에서 새 캐릭터를 영입할 때 써요. 전장전과 견습전투에서 매 판 받아요.'),
    h('ul', { class: 'cur-info__rows' }, rows),
    h('p', { class: 'cur-info__note' }, tokens ? '보상은 자정(기기 시간)에 다시 열려요' : '하루 획득 제한 없음'),
    go
      ? h(
          'button',
          {
            class: 'btn btn--primary btn--block',
            type: 'button',
            'data-action': tokens ? 'info-dungeon' : 'info-ranked',
            onclick: () => {
              sheet.close();
              void sheet.closed.then(() => go(tokens ? 'dungeon' : 'ranked'));
            },
          },
          tokens ? '던전 가기' : '전장전 하기',
        )
      : null,
  );
  const sheet = showBottomSheet(content, { label: tokens ? '토큰 안내' : '에센셜 안내' });
  void sheet.closed.then(() => {
    infoOpen = false;
  });
}

/**
 * Top bar of the tab screens: rating with the arena badge on the left (opens the 전장 tab),
 * the two currencies and settings on the right. Values follow the profile live.
 */
export function topBar(router: Router, opts: { onDungeon?: () => void } = {}): { el: HTMLElement; dispose: () => void } {
  const rating = h('b', { class: 'tbar__rating-num t-num' });
  const badgeHost = h('span', { class: 'tbar__badge' });
  const arenaName = h('span', { class: 'tbar__arena' });
  const tokens = h('b', { class: 'tbar__val t-num' });
  const essence = h('b', { class: 'tbar__val t-num' });
  const go = (to: 'dungeon' | 'ranked') => {
    if (to === 'dungeon') {
      if (opts.onDungeon) opts.onDungeon();
      else void router.switchTab('lobby');
    } else router.navigate('matchmaking', { mode: 'ranked' });
  };
  const ratingBtn = h(
    'button',
    {
      class: 'tbar__rank pressable',
      type: 'button',
      'data-action': 'open-arenas',
      onclick: () => {
        if (router.currentName !== 'arenas') void router.switchTab('arenas');
      },
    },
    badgeHost,
    h('span', { class: 'tbar__rank-main' }, h('span', { class: 'tbar__rating' }, icon('trophy', 14), rating), arenaName),
  );
  const pill = (kind: 'tokens' | 'essence', val: HTMLElement) =>
    h(
      'button',
      {
        class: `tbar__cur tbar__cur--${kind} pressable`,
        type: 'button',
        'data-action': `info-${kind}`,
        'aria-label': kind === 'tokens' ? '토큰 안내' : '에센셜 안내',
        onclick: () => {
          sfx('page');
          haptic('light');
          showCurrencyInfo(kind, go);
        },
      },
      h('span', { class: 'tbar__pill' }, kind === 'tokens' ? tokenIcon(22) : essenceIcon(22), val),
    );
  // Developer mode marker, so screenshots are never mistaken for real progress.
  const devChip = h('span', { class: 'tbar__dev', role: 'img', 'aria-label': '개발자 모드 켜짐', hidden: true }, 'DEV');
  const el = h(
    'header',
    { class: 'tbar' },
    ratingBtn,
    devChip,
    h('div', { class: 'tbar__right' }, pill('tokens', tokens), pill('essence', essence), settingsButton(() => showSettings())),
  );
  let key = '';
  const render = () => {
    const p = getProfile();
    const a = arenaForRating(p.rating);
    const dev = isDevMode(p);
    const k = `${p.rating}|${p.tokens}|${p.essence}|${dev}`;
    if (k === key) return;
    key = k;
    rating.textContent = String(p.rating);
    badgeHost.replaceChildren(arenaBadge(a, 'md'));
    arenaName.textContent = `${a.index} 전장 · ${a.name}`;
    tokens.textContent = balanceText(p, p.tokens);
    essence.textContent = balanceText(p, p.essence);
    devChip.hidden = !dev;
    el.classList.toggle('is-dev', dev);
    ratingBtn.setAttribute('aria-label', `레이팅 ${p.rating}, ${a.index} 전장 ${a.name}. 전장 보기`);
    tokens.parentElement?.parentElement?.setAttribute('aria-label', `토큰 ${dev ? '무한' : `${p.tokens}개`} · 안내 보기`);
    essence.parentElement?.parentElement?.setAttribute('aria-label', `에센셜 ${dev ? '무한' : `${p.essence}개`} · 안내 보기`);
  };
  render();
  const off = subscribeProfile(render);
  return { el, dispose: off };
}
