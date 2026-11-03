/**
 * Arena road (전장 tab): all six arenas from the top (legend) down to the first, each with its
 * rating range, rating steps and the characters it opens; the player's arena is highlighted with
 * their rating and progress, passed arenas are checked and higher ones locked. The list scrolls
 * to the player's arena on open.
 */
import { CHARACTERS } from '../../engine';
import { getProfile, isOwned } from '../../meta/profile';
import { ARENA_DEFS, arenaProgress, arenaRangeLabel, type ArenaDef } from '../../meta/progression';
import { arenaBadge, topBar } from '../components/currency';
import { unitArt } from '../components/piece';
import { Disposables, h } from '../dom';
import { icon } from '../icons';
import { playHomeMusic } from '../musicBridge';
import type { Router, Screen } from '../router';
import { arenaArt } from './lobby';

export function arenasScreen(router: Router): Screen {
  const bag = new Disposables();
  const bar = topBar(router);
  bag.add(bar.dispose);
  const p = getProfile();
  const prog = arenaProgress(p.rating);
  const cur = prog.arena;
  const games = p.stats.wins + p.stats.losses + p.stats.draws;

  const node = (a: ArenaDef) => {
    const state = a.index < cur.index ? 'passed' : a.index === cur.index ? 'current' : 'locked';
    const pct = Math.round(prog.progress * 100);
    return h(
      'article',
      { class: `road-node is-${state}`, style: `--arena-accent:${a.accent}`, 'data-arena': a.id, 'data-state': state, 'aria-label': `${a.index} 전장 ${a.name}, 레이팅 ${arenaRangeLabel(a)}` },
      h('div', { class: 'road-node__rail', 'aria-hidden': 'true' }, arenaBadge(a, 'lg')),
      h(
        'div',
        { class: 'road-node__card' },
        arenaArt(a.card, 'road-node__art'),
        h('div', { class: 'road-node__shade', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'road-node__body' },
          h(
            'div',
            { class: 'road-node__head' },
            h('span', { class: 'road-node__name' }, a.name),
            state === 'current'
              ? h('span', { class: 'road-node__tag is-here' }, '현재')
              : state === 'passed'
              ? h('span', { class: 'road-node__tag' }, icon('check', 12), '통과')
              : h('span', { class: 'road-node__tag' }, icon('lock', 12), `${a.min}부터`),
          ),
          h('p', { class: 'road-node__range' }, h('b', { class: 't-num' }, arenaRangeLabel(a)), h('span', null, `승 +${a.win[0]}~${a.win[1]} · 패 −${a.loss[0]}~${a.loss[1]}`)),
          h(
            'div',
            { class: 'road-node__unlocks' },
            a.unlocks.length
              ? a.unlocks.map((id) =>
                  h(
                    'span',
                    { class: `road-unlock rarity-${CHARACTERS[id].rarity}${isOwned(p, id) ? ' is-owned' : ''}`, 'data-character': id },
                    unitArt(id, 1, { size: 28 }),
                    h('span', null, CHARACTERS[id].nameKo),
                    isOwned(p, id) ? icon('check', 12) : null,
                  ),
                )
              : h('span', { class: 'road-unlock is-soon' }, icon('lock', 12), '새 캐릭터 준비 중'),
          ),
          state === 'current'
            ? h(
                'div',
                { class: 'road-node__me' },
                h('span', { class: 'road-node__me-label' }, '내 레이팅', h('b', { class: 't-num' }, String(p.rating))),
                h('div', { class: 'meter meter--sm', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': '다음 전장까지 진행도' }, h('i', { class: 'meter__fill', style: `width:${pct}%` })),
                h('span', { class: 'road-node__me-next' }, prog.next ? `다음 전장까지 ${prog.toNext}` : '정점에 올랐어요'),
              )
            : null,
        ),
      ),
    );
  };

  const list = h(
    'div',
    { class: 'scroll-body road__body' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-head__title' }, '전장'), h('span', { class: 'page-head__sub' }, '전장전 레이팅으로 올라가요')),
    h(
      'div',
      { class: 'road-stats' },
      h('span', null, h('small', null, '최고 레이팅'), h('b', { class: 't-num' }, String(p.bestRating))),
      h('span', null, h('small', null, '전적'), h('b', { class: 't-num' }, `${p.stats.wins}승 ${p.stats.losses}패 ${p.stats.draws}무`)),
      h('span', null, h('small', null, '승률'), h('b', { class: 't-num' }, games ? `${Math.round((p.stats.wins / games) * 100)}%` : '–')),
    ),
    h('div', { class: 'road' }, [...ARENA_DEFS].reverse().map(node)),
    h('p', { class: 'hint hint--pad' }, icon('info', 16), '레이팅이 내려가면 아래 전장으로 돌아가요. 영입한 캐릭터는 그대로예요'),
  );
  const el = h('div', { class: 'arenas' }, bar.el, list);

  return {
    el,
    mount() {
      playHomeMusic();
      const here = list.querySelector<HTMLElement>('.road-node.is-current');
      if (here) {
        const y = here.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
        list.scrollTop = Math.max(0, y - list.clientHeight / 2 + here.offsetHeight / 2);
      }
    },
    dispose: () => bag.dispose(),
  };
}
