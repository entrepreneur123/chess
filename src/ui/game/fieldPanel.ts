/**
 * "현재 진형" drawer (opened from the ≡ button at the top right of the match screen), in the spirit
 * of a card game's field overview: a live mini map of the whole board plus an info card for every
 * piece — the opponent's first. Tapping a piece on the board itself only previews its reach; all
 * reading happens here so a tap never covers the board on a phone.
 *
 * The drawer does NOT pause the turn clock (no free thinking time); it re-renders on every
 * controller change while open, but only when something it shows actually changed.
 */
import { BOARD_SIZE, BUFF_TURNS, CHARACTERS, ZONE_DEPTH, SKILL_UNLOCK_PLY, WASTE_SIZE, getTargetsForPiece, inStorm, isAwake, isDirectional, isStunned, pieceDir, screenArrow, skillUnlockIn, trapsLeft, type FormationSlot, type GameState, type Piece, type PlayerId } from '../../engine';
import { movementDiagram, rarityChip, starsOf, unitArt } from '../components/piece';
import { overlayRoot, pushOverlay, registerForceClose } from '../components/overlay';
import { h, replaceChildren } from '../dom';
import { dirChip, setArrow } from './hand';
import { stormStatusText } from './hud';
import { icon } from '../icons';

/** Column letters, one per board column (A..J on 10 columns). */
const COLS = Array.from({ length: BOARD_SIZE }, (_, i) => String.fromCharCode(65 + i)).join('');

/** Square label as the player sees it: columns A..J left to right, rows 1..10 from the bottom. */
export function squareLabel(r: number, c: number): string {
  return `${COLS[c]}${r + 1}`;
}

export interface FieldPanelOptions {
  /** Lineups as fielded (dead pieces are listed greyed out). */
  formations: [FormationSlot[], FormationSlot[]];
  names: [string, string];
  onClose?: () => void;
}

export interface FieldPanel {
  readonly isOpen: boolean;
  open(state: GameState): void;
  update(state: GameState): void;
  close(): void;
}

function pieceKey(s: GameState): string {
  return (
    s.pieces.map((p) => `${p.id}@${p.pos.r},${p.pos.c}:${(p.absorbed ?? []).map((a) => a.character + a.level).join('')}:${p.stun ?? 0}:${p.awaken ?? 0}:${p.skillUsed ? 1 : 0}`).join('|') +
    `#${s.storm}#${s.waste.length}#${s.skillsUsed.join(',')}#${s.ply >= SKILL_UNLOCK_PLY}#${(s.traps ?? []).length}`
  );
}

function miniMap(s: GameState, focus: string | null, onPick: (id: string) => void): HTMLElement {
  const grid = h('div', { class: 'fmap', role: 'img', 'aria-label': '보드 전체 미니맵 (아래쪽이 내 진영)' });
  grid.style.setProperty('--board-n', String(BOARD_SIZE));
  const byPos = new Map<number, Piece>();
  for (const p of s.pieces) byPos.set(p.pos.r * BOARD_SIZE + p.pos.c, p);
  // The last row (the opponent's back rank) at the top, like the board.
  for (let r = BOARD_SIZE - 1; r >= 0; r--) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = byPos.get(r * BOARD_SIZE + c);
      const trap = (s.traps ?? []).find((t) => t.sq === r * BOARD_SIZE + c);
      const cls = `fmap__cell${(r + c) % 2 === 0 ? ' is-dark' : ''}${inStorm(r, c, s.storm) ? ' is-storm' : ''}${s.waste.includes(r * BOARD_SIZE + c) ? ' is-waste' : ''}${trap ? ` is-trap trap-${trap.owner}` : ''}${r < ZONE_DEPTH ? ' is-home-0' : r >= BOARD_SIZE - ZONE_DEPTH ? ' is-home-1' : ''}`;
      if (p) {
        grid.appendChild(
          h(
            'button',
            {
              class: `${cls} has-piece${focus === p.id ? ' is-focus' : ''}`,
              type: 'button',
              'aria-label': `${p.owner === 0 ? '내' : '상대'} ${CHARACTERS[p.character].nameKo} ${squareLabel(r, c)}`,
              onclick: () => onPick(p.id),
            },
            unitArt(p.character, p.level, { owner: p.owner, cls: `fmap__art${isAwake(p) ? ' is-awake' : ''}`, awake: isAwake(p) }),
          ),
        );
      } else grid.appendChild(h('span', { class: cls }));
    }
  }
  return grid;
}

/** Skill state line of a skill character's info card (per piece: each skill character casts once). */
function skillStatus(piece: Piece | undefined, s: GameState): string {
  if (!piece) return '—';
  if (isAwake(piece)) return `타천 중 · ${piece.awaken}번 더 이동`;
  if (piece.skillUsed) return '사용함';
  if (s.storm > 0) return '자기장으로 사용 불가';
  if (s.ply < SKILL_UNLOCK_PLY) return `${skillUnlockIn(s)}턴 후 사용 가능`;
  const kind = CHARACTERS[piece.character].skill?.kind;
  if (kind === 'buff') {
    if (!s.pieces.some((q) => q.owner === piece.owner && q.id !== piece.id)) return '함께할 아군이 없어요';
    return `사용 가능 · 아군 전원 ${BUFF_TURNS[piece.level]}턴 동안 상하좌우 +1칸`;
  }
  if (kind === 'blink') return '사용 가능 · 빈 칸 어디로든 순간이동';
  return kind === 'transform' ? '사용 가능 · 2번 이동 동안 범위 확장' : '사용 가능 · 닿으면 소멸';
}

/** The forward-direction chip of a direction-dependent piece on the board (null otherwise). */
function arrowChip(piece: Piece | undefined, owner: PlayerId): HTMLElement | null {
  if (!piece || !isDirectional(piece)) return null;
  const chip = dirChip(`fcard__dir owner-${owner}`);
  setArrow(chip, screenArrow(piece), false);
  return chip;
}

function infoCard(slot: FormationSlot, owner: PlayerId, s: GameState, focus: string | null): HTMLElement {
  const id = `p${owner}-${slot.character}`;
  const piece = s.pieces.find((p) => p.id === id);
  const def = CHARACTERS[slot.character];
  const level = piece?.level ?? slot.level;
  const awake = !!piece && isAwake(piece);
  let status: string;
  if (!piece) status = '격파됨';
  else if (isStunned(piece)) status = `${squareLabel(piece.pos.r, piece.pos.c)} · 속박 · 1턴 쉬어요`;
  else {
    const reach = getTargetsForPiece(s, piece);
    const caps = reach.filter((m) => m.captureId).length;
    status = `${squareLabel(piece.pos.r, piece.pos.c)} · 이동 ${reach.length}칸${caps ? owner === 1 ? ` · 내 말 ${caps}개 위협` : ` · 잡기 ${caps}` : ''}${piece.buff ? ` · 선율 ${piece.buff}턴` : ''}`;
  }
  const skillName = def.skill ? (def.skill.kind === 'waste' ? `${def.skill.nameKo} ${WASTE_SIZE[level]}×${WASTE_SIZE[level]}` : def.skill.nameKo) : '';
  return h(
    'article',
    {
      class: `fcard owner-${owner} rarity-${def.rarity}${piece ? '' : ' is-dead'}${focus === id ? ' is-focus' : ''}${awake ? ' is-awake' : ''}`,
      'data-piece': id,
      'aria-label': `${owner === 0 ? '내' : '상대'} ${def.nameKo} ${level}성`,
    },
    h('div', { class: 'fcard__art' }, unitArt(slot.character, level, { size: 52, owner, awake })),
    h(
      'div',
      { class: 'fcard__main' },
      h(
        'div',
        { class: 'fcard__head' },
        h('span', { class: 'fcard__name' }, def.nameKo),
        h('span', { class: 'fcard__stars', 'aria-label': `${level}성` }, starsOf(level)),
        rarityChip(def.rarity),
        arrowChip(piece, owner),
      ),
      h('div', { class: `fcard__status${piece ? '' : ' is-dead'}` }, status),
      h('div', { class: 'fcard__desc' }, awake && def.awakeDescKo ? `${def.skill?.nameKo ?? ''} · ${def.awakeDescKo[level - 1]}` : def.descKo[level - 1]),
      def.skill
        ? h('div', { class: `fcard__skill${awake ? ' is-active' : ''}` }, icon('magic', 14), h('b', null, `스킬 · ${skillName}`), ' ', skillStatus(piece, s))
        : null,
      def.trait
        ? h(
            'div',
            { class: 'fcard__passive fcard__trait' },
            icon('magic', 14),
            h('b', null, def.trait.nameKo),
            ' ',
            slot.character === 'michelle' ? `${trapsLeft(s, owner)}개 남음 · ` : '',
            def.trait.descKo,
          )
        : null,
      piece?.absorbed?.length
        ? h(
            'div',
            { class: 'fcard__absorbed', 'aria-label': '흡수한 능력' },
            icon('magic', 14),
            piece.absorbed.map((a) => h('span', { class: `chip chip--absorb rarity-${CHARACTERS[a.character].rarity}` }, `${CHARACTERS[a.character].nameKo} ${a.level}성`)),
          )
        : def.passiveKo
          ? h('div', { class: 'fcard__passive' }, icon('magic', 14), def.passiveKo)
          : null,
    ),
    // Diagrams are drawn "forward = up"; a piece heading down the board gets it turned around.
    h('div', { class: `fcard__diagram${(piece ? pieceDir(piece) : owner === 0 ? 1 : -1) === -1 ? ' is-flipped' : ''}` }, movementDiagram(slot.character, level, { cell: 7, owner, awake })),
  );
}

export function createFieldPanel(opts: FieldPanelOptions): FieldPanel {
  let scrim: HTMLElement | null = null;
  let body: HTMLElement | null = null;
  let pop: (() => void) | null = null;
  let unforce: (() => void) | null = null;
  let key = '';
  let focus: string | null = null;

  const render = (s: GameState, force = false) => {
    if (!body) return;
    const k = `${pieceKey(s)}|${focus}`;
    if (!force && k === key) return;
    key = k;
    const list = (owner: PlayerId) =>
      h(
        'section',
        { class: `fpanel__side side-${owner}` },
        h(
          'h3',
          { class: 'fpanel__title' },
          h('span', { class: `fpanel__dot owner-${owner}`, 'aria-hidden': 'true' }),
          owner === 1 ? `상대 진형 · ${opts.names[1]}` : `내 진형 · ${opts.names[0]}`,
          h('span', { class: 'fpanel__count' }, `${s.pieces.filter((p) => p.owner === owner).length}/${opts.formations[owner].length}`),
        ),
        opts.formations[owner].map((slot) => infoCard(slot, owner, s, focus)),
      );
    replaceChildren(
      body,
      miniMap(s, focus, (id) => {
        focus = focus === id ? null : id;
        render(s, true);
        body?.querySelector(`[data-piece="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }),
      s.stormIn !== null ? h('p', { class: 'fpanel__storm' }, icon('bolt', 14), stormStatusText(s.storm, Math.ceil(s.stormIn / 2))) : null,
      list(1),
      list(0),
    );
  };

  const close = () => {
    if (!scrim) return;
    const el = scrim;
    scrim = null;
    body = null;
    pop?.();
    unforce?.();
    pop = unforce = null;
    el.classList.remove('is-in');
    window.setTimeout(() => el.remove(), 240);
    opts.onClose?.();
  };

  return {
    get isOpen() {
      return scrim !== null;
    },
    open(s: GameState) {
      if (scrim) return;
      key = '';
      focus = null;
      body = h('div', { class: 'fpanel__body' });
      const panel = h(
        'aside',
        { class: 'fpanel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '현재 진형' },
        h(
          'header',
          { class: 'fpanel__header' },
          h('h2', { class: 'fpanel__heading' }, icon('menu', 20), '현재 진형'),
          h('button', { class: 'icon-btn icon-btn--sm icon-btn--light', type: 'button', 'aria-label': '닫기', 'data-action': 'close-field', onclick: close }, icon('close', 22)),
        ),
        body,
      );
      scrim = h('div', { class: 'scrim scrim--drawer' }, panel);
      scrim.addEventListener('click', (e) => {
        if (e.target === scrim) close();
      });
      pop = pushOverlay({ requestClose: () => (close(), true) });
      unforce = registerForceClose(close);
      overlayRoot().appendChild(scrim);
      render(s, true);
      const el = scrim;
      requestAnimationFrame(() => el.classList.add('is-in'));
    },
    update(s: GameState) {
      if (scrim) render(s);
    },
    close,
  };
}
