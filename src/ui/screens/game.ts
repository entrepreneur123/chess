import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { BotClient } from '../../ai/botClient';
import { haptic, sfx } from '../../audio/sfx';
import { playCharSfx, playVoice, playWasteDeath, preloadCharacterAudio, stopVoice } from '../../audio/voice';
import { VOICE_TEXT } from '../../audio/voiceManifest';
import {
  BOARD_SIZE,
  CHARACTERS,
  SKILL_UNLOCK_PLY,
  WASTE_SIZE,
  capturedIds,
  createGame,
  AWAKEN_TURNS,
  getLegalMoves,
  getPieceById,
  getTargetsForPiece,
  isAwake,
  isDirectional,
  isStunned,
  josa,
  materialScore,
  skillAnchors,
  skillBlock,
  skillKindOf,
  skillUnlockIn,
  sqOf,
  suddenDeathIn,
  turnNumber,
  wasteArea,
  type GameState,
  type Move,
  type Piece,
  type PlayerId,
  type Pos,
  type SkillAction,
  type SkillBlock,
} from '../../engine';
import { Board2DView, BoardView, createBoardView, diagEnabled, type IBoardView } from '../../render';
import type { VoiceEvent } from '../../audio/voice';
import { PACING } from '../../meta/economy';
import { getProfile, setProfile, settleMatch, updateProfile, type MatchOutcome, type MatchSummary } from '../../meta/profile';
import { DUNGEON_LABEL, arenaById } from '../../meta/progression';
import { useMatchBackdrop } from '../backdrops';
import { duck, playArenaMusic } from '../musicBridge';
import { resultPanel } from '../game/resultPanel';
import { randInt, defaultRng } from '../../meta/rng';
import { installBoardDrag, type BoardDrag } from '../components/boardDrag';
import { confetti } from '../components/celebrate';
import { starsOf, unitArt } from '../components/piece';
import { confirmDialog, showDialog } from '../components/dialog';
import { clearToasts, toast } from '../components/toast';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';
import { BOT, GameController, HUMAN, type ControllerSnapshot, type Phase } from '../game/GameController';
import { CRITICAL_MS, createRoster, endReasonText, setText, TimerRing, turnPillContent } from '../game/hud';
import { createFieldPanel } from '../game/fieldPanel';
import { createHand, handModel, selectFromHand } from '../game/hand';
import { CUTIN_MS, cutInEl, preloadCutIns } from '../game/cutin';
import type { GameParams } from './gameParams';
import '../game/hud.css';

/**
 * Show the sudden-death countdown this many turns (per player, see `turnNumber`) before it starts:
 * from turn 15 with the storm at turn 20 (about the last quarter of the run-up, as before).
 */
const SUDDEN_DEATH_WARN_TURNS = 5;
/** Grace period for a lost WebGL context to come back before the match switches to the 2D board. */
const CONTEXT_FALLBACK_MS = 3000;
/** Plies -> turns as the player counts them (one move each = one turn). */
const pliesToTurns = (plies: number) => Math.ceil(plies / 2);

/** 'name' with the particle that fits the name, e.g. '타천'을 / '불모지'를. */
const quoted = (name: string, pair: '을/를'): string => `'${name}'${josa(name, pair).slice(name.length)}`;

/** The board's optional transform FX (Rakaeli's "타천"); boards without it simply skip it. */
interface AwakenFxView {
  playAwaken?(pieceId: string, phase: 'on' | 'off'): Promise<void>;
}

/** Play the transform-in ('on') or revert ('off') FX when the board has it. Never throws. */
async function playAwaken(board: IBoardView | null, pieceId: string, phase: 'on' | 'off'): Promise<void> {
  try {
    await (board as (IBoardView & AwakenFxView) | null)?.playAwaken?.(pieceId, phase);
  } catch (e) {
    console.warn('awaken fx failed', e);
  }
}

export function gameScreen(router: Router, params: GameParams): Screen {
  const bag = new Disposables();
  const initial = createGame(params.playerFormation, params.botFormation, HUMAN);

  // ---------- static DOM
  const topRing = new TimerRing(BOT);
  const botRing = new TimerRing(HUMAN);
  const roster = createRoster(params.botFormation, BOT);
  const topRoster = h('div', { class: 'pbar__roster-host' }, roster.el);
  // My hand: one card per fielded piece; a tap selects it like tapping it on the board.
  const hand = createHand(params.playerFormation, HUMAN, (pieceId) => onHandTap(pieceId));
  // Tablet landscape only (CSS hides it elsewhere): the opponent's lineup as a mirrored hand in
  // the left column. A tap previews that piece's reach in red, like tapping it on the board.
  const oppHand = createHand(params.botFormation, BOT, (pieceId) => onOppHandTap(pieceId));
  oppHand.el.classList.add('hand--opp');
  oppHand.el.setAttribute('aria-label', '상대 말');
  // The pill is built once; only its text/class change so screen readers announce real changes.
  const pillText = h('span', { class: 'turn-pill__text' });
  const pill = h(
    'div',
    { class: 'turn-pill', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
    h('span', { class: 'turn-pill__dot', 'aria-hidden': 'true' }),
    pillText,
  );
  // Turn counter (per player: both first moves are turn 1). Storm sudden death starts at SUDDEN_DEATH_PLY.
  const turnNum = h('span', { class: 'turn-count__num t-num' }, '1');
  const turnCount = h('div', { class: 'turn-count', role: 'status', 'aria-label': '턴 1' }, h('span', { class: 'turn-count__label' }, '턴'), turnNum);
  let lastTurnNum = 1;
  // Storm status: hidden until a side is down to one piece.
  const stormText = h('span', { class: 'storm-chip__text' });
  const stormChip = h('div', { class: 'storm-chip', role: 'status', 'aria-live': 'polite', hidden: true }, h('span', { class: 'storm-chip__icon', 'aria-hidden': 'true' }, icon('bolt', 14)), stormText);
  // Action dock (below the board, never over it): chain move skip, Brutile's skill, skill targeting.
  const actionBar = h('div', { class: 'action-bar', hidden: true, role: 'group' });
  let dockKey = '';
  // Persistent hint while one side keeps auto-passing (the toast is shown only the first time).
  const passChip = h('div', { class: 'pass-chip', hidden: true });
  // First-match coach mark.
  const coachText = h('span', { class: 'coach__text' });
  const coach = h('div', { class: 'coach', role: 'status', 'aria-live': 'polite', hidden: true }, h('span', { class: 'coach__icon' }, icon('touch', 20)), coachText);
  // Tapping a piece only previews its reach on the board; this chip names it without covering
  // anything (pointer-events: none). Full details live in the ≡ "현재 진형" drawer.
  const selArt = h('span', { class: 'sel-chip__art' });
  const selName = h('span', { class: 'sel-chip__name' });
  const selStars = h('span', { class: 'sel-chip__stars' });
  const selHint = h('span', { class: 'sel-chip__hint' });
  const selChip = h('div', { class: 'sel-chip', hidden: true, 'aria-hidden': 'true' }, selArt, selName, selStars, selHint);
  const infoHost = h('div', { class: 'info-host' }, actionBar, selChip);
  const field = createFieldPanel({
    formations: [params.playerFormation, params.botFormation],
    names: ['나', params.opponentName],
    onClose: () => menuBtn.setAttribute('aria-expanded', 'false'),
  });
  const menuBtn = h(
    'button',
    {
      class: 'icon-btn menu-btn',
      type: 'button',
      'aria-label': '현재 진형 보기',
      'aria-expanded': 'false',
      'data-action': 'field',
      onclick: () => {
        if (!ctrl) return;
        field.open(ctrl.state);
        menuBtn.setAttribute('aria-expanded', 'true');
        sfx('page');
        haptic('light');
      },
    },
    icon('menu', 22),
  );
  const boardHost = h('div', { class: 'board-host', 'aria-label': '게임 보드' });
  // Feedback layer: turn banners, hit flashes and floating combat text (pure CSS animations).
  const fx = h('div', { class: 'fx-layer', 'aria-hidden': 'true' });
  const spawnFx = (el: HTMLElement, ms: number) => {
    fx.appendChild(el);
    bag.timeout(() => el.remove(), ms);
  };
  /** Cut-ins carry a voice line: the music ducks under them. */
  let duckUntil = 0;
  const spawnCutIn = (el: HTMLElement) => {
    spawnFx(el, CUTIN_MS);
    duck(true);
    duckUntil = Date.now() + CUTIN_MS;
    bag.timeout(() => {
      if (Date.now() >= duckUntil - 5) duck(false);
    }, CUTIN_MS);
  };
  const showTurnBanner = (mine: boolean) => {
    spawnFx(
      mine
        ? h('div', { class: 'turn-banner' }, '내 차례', h('span', { class: 'turn-banner__sub' }, 'YOUR TURN'))
        : h('div', { class: 'turn-banner turn-banner--bot' }, '상대 차례'),
      950,
    );
  };
  const showBonusBanner = (mine: boolean) => {
    spawnFx(
      mine
        ? h('div', { class: 'turn-banner turn-banner--bonus' }, '연쇄 이동!', h('span', { class: 'turn-banner__sub' }, 'CHAIN MOVE'))
        : h('div', { class: 'turn-banner turn-banner--bot turn-banner--bonus' }, '상대 연쇄 이동'),
      1000,
    );
  };
  const showStormFx = (killed: number) => {
    spawnFx(h('div', { class: 'storm-flash' }), 700);
    spawnFx(h('div', { class: 'float-text float-text--storm' }, killed > 0 ? `자기장 축소 · ${killed}개 소멸` : '자기장 축소!'), 1300);
    boardWrap.classList.remove('is-shake');
    void boardWrap.offsetWidth;
    boardWrap.classList.add('is-shake');
  };
  const showSuddenDeath = () => {
    spawnFx(h('div', { class: 'turn-banner turn-banner--storm' }, '서든데스!', h('span', { class: 'turn-banner__sub' }, '자기장이 좁혀옵니다')), 1400);
    sfx('levelup');
    haptic('warn');
  };
  /** Picker's hop took a second (third...) piece: a combo count instead of another "격파!". */
  const showComboFx = (n: number) => {
    spawnFx(h('div', { class: 'hit-flash hit-flash--gain' }), 560);
    spawnFx(h('div', { class: 'float-text float-text--combo' }, `${n}연속 격파!`), 1150);
  };
  const showCaptureFx = (byMe: boolean) => {
    spawnFx(h('div', { class: `hit-flash${byMe ? ' hit-flash--gain' : ''}` }), 560);
    spawnFx(h('div', { class: `float-text${byMe ? '' : ' float-text--hurt'}` }, byMe ? '격파!' : '피격!'), 1150);
    if (!byMe) {
      boardWrap.classList.remove('is-shake');
      void boardWrap.offsetWidth;
      boardWrap.classList.add('is-shake');
    }
  };

  const topBar = h(
    'header',
    { class: 'pbar pbar--top' },
    h('span', { class: 'pbar__avatar pbar__avatar--red' }, unitArt(params.botFormation[0]?.character ?? 'sad', params.botFormation[0]?.level ?? 1, { size: 44, owner: BOT })),
    h(
      'div',
      { class: 'pbar__info' },
      h('div', { class: 'pbar__name' }, params.opponentName),
      h(
        'div',
        { class: 'pbar__meta', 'data-opponent-rating': params.opponentRating },
        params.mode === 'dungeon' && params.dungeonLevel
          ? `AI · 던전 ${DUNGEON_LABEL[params.dungeonLevel]}`
          : `AI · ${params.opponentRating} · ${arenaById(params.opponentArena).index} 전장`,
      ),
    ),
    topRoster,
    topRing.el,
    menuBtn,
  );
  const resignBtn = h(
    'button',
    { class: 'icon-btn', type: 'button', 'aria-label': '기권', 'data-action': 'resign', onclick: () => void askResign() },
    icon('flag', 20),
  );
  // My side: the hand of piece cards, with the turn timer and resign on the right.
  const bottomBar = h(
    'footer',
    { class: 'pbar pbar--bottom pbar--hand', 'aria-label': '나 · 블루' },
    hand.el,
    h('div', { class: 'pbar__side' }, botRing.el, resignBtn),
  );
  // Layout (top to bottom): opponent bar, turn strip (whose turn + turn count), a fixed-height notes
  // line (storm status, auto pass, first-match coach), board, action dock, player bar. Every row
  // keeps its height whatever it shows, so the board never resizes and nothing ever covers it.
  const hudStrip = h('div', { class: 'hud-strip' }, turnCount, pill);
  const notes = h('div', { class: 'hud-notes board-overlay' }, stormChip, passChip, coach);
  const boardWrap = h('div', { class: 'board-wrap' }, boardHost, fx);
  const oppPanel = h('aside', { class: 'pbar opp-hand', 'aria-label': `${params.opponentName} · 레드` }, oppHand.el);
  const el = h('main', { class: 'game no-select' }, topBar, oppPanel, hudStrip, notes, boardWrap, infoHost, bottomBar);

  // ---------- runtime objects (created on mount)
  let board: IBoardView | null = null;
  let bot: BotClient | null = null;
  let ctrl: GameController | null = null;
  /** Drag-to-move on the board (plays moves through ctrl.tapCell, like taps). */
  let boardDrag: BoardDrag | null = null;
  let syncedPieces: Piece[] | null = null;
  let resultShown = false;
  let settled = false;
  let pillCls = '';
  let prevPhase: Phase | null = null;
  let prevSel: string | null = null;
  let lastTickSec = -1;
  let stormKey = '';
  let selChipKey = '';
  let wasteKey = 0;
  let trapKey = '';
  /** Brutile's wasteland targeting (the player is choosing where to lay it). */
  let targeting: { pieceId: string; level: 1 | 2 | 3; anchors: Set<number>; preview: Pos | null } | null = null;
  /** Rakaeli's transform waiting for the player's confirm (no target to pick: his own square). */
  let transformAsk: string | null = null;
  /** The first transform of the match gets the coach toast. */
  let transformTipShown = false;
  /** My pieces whose first turn-around of the match got the coach toast. */
  const turnTipShown = new Set<string>();
  const notified = { unlock: false, storm: false };
  let stormStarted = initial.stormIn !== null;
  const passToastShown = [false, false];
  let coachOn = !getProfile().onboarding.firstMoveDone;
  let coachMsg = '';

  const setCoach = (msg: string) => {
    if (msg === coachMsg) return;
    coachMsg = msg;
    coach.hidden = !msg;
    if (msg) {
      coachText.textContent = msg;
      coach.classList.remove('is-entering');
      void coach.offsetWidth;
      coach.classList.add('is-entering');
    }
  };

  const updateCoach = (snap: ControllerSnapshot) => {
    if (!coachOn || snap.phase !== 'humanTurn' || snap.paused) {
      setCoach('');
      return;
    }
    const sel = snap.selection;
    if (snap.state.bonusPieceId !== null) setCoach('한 번 더! 빛나는 칸을 탭하거나 건너뛰세요');
    else if (sel?.actionable && sel.moves.length > 0) setCoach('빛나는 칸을 탭하거나 말을 끌어다 놓아 이동하세요');
    else if (sel?.actionable) setCoach('이 말은 지금 못 움직여요. 다른 말을 탭해 보세요');
    else if (sel) setCoach('상대 말이에요. 아래쪽 파란 말을 탭해 보세요');
    else setCoach('내 말(파랑)이나 아래 카드를 탭해 보세요');
  };

  const finishCoach = () => {
    if (!coachOn) return;
    coachOn = false;
    setCoach('');
    updateProfile((p) => ({ ...p, onboarding: { ...p.onboarding, firstMoveDone: true } }));
    bag.timeout(() => toast('좋아요! 상대 말 3개를 모두 잡으면 승리해요', { tone: 'success', duration: 2600 }), 450);
  };

  /** A transformed Rakaeli dies with his transformed voice and sound. */
  const deathEvent = (p: Piece): VoiceEvent => (isAwake(p) ? 'awake-death' : 'death');

  /**
   * Sound + haptics for one move, split into lift-off (now), the strike landing (capturing moves:
   * the board's onImpact, or the end of the animation on boards without it) and the landing.
   */
  let mover: Piece | null = null;
  /** Every piece the current move captures (Picker's hop can take several), as they stood. */
  let victims: Piece[] = [];
  /** Victims already struck in the current move (onImpact fires once per victim). */
  const impacted = new Set<string>();
  let cutInShown = false;
  /** Caption of the capture shout, so the cut-in shows exactly what is heard. */
  let shout: string | null = null;
  const moveFeedbackStart = (move: Move, before: GameState) => {
    mover = getPieceById(before, move.pieceId) ?? null;
    victims = capturedIds(move)
      .map((id) => getPieceById(before, id))
      .filter((p): p is Piece => !!p);
    impacted.clear();
    cutInShown = false;
    shout = null;
    sfx(mover?.character === 'walk' || mover?.character === 'picker' || mover?.character === 'rakaeli' ? 'jump' : 'move');
    if (!mover) return;
    const vo = { level: mover.level, owner: mover.owner };
    // A transformed Rakaeli speaks (and sounds) in his transformed voice.
    if (isAwake(mover)) {
      playCharSfx(mover.character, move.captureId ? 'awake-capture' : 'awake-move');
      const rel = playVoice(mover.character, move.captureId ? 'awake-capture' : 'awake-move', vo);
      shout = move.captureId && rel ? (VOICE_TEXT[rel] ?? null) : null;
      return;
    }
    const dist = Math.max(Math.abs(move.to.r - move.from.r), Math.abs(move.to.c - move.from.c));
    // Signature moves: Marki's long charge, Walk's wide leap.
    const signature = (mover.character === 'marki' && dist >= 3) || (mover.character === 'walk' && Math.abs(move.to.c - move.from.c) >= 2);
    // Picker's multi-capture hop has its own sound ('hop-multi'); everyone else plays move/skill.
    const multiHop = mover.character === 'picker' && capturedIds(move).length >= 2;
    playCharSfx(mover.character, multiHop ? 'hop-multi' : signature ? 'skill' : 'move');
    if (move.captureId) {
      // Insaner sometimes shouts its absorb line instead of a capture line; a hop that takes
      // several pieces has its own line ('hop-multi', falling back to a capture line).
      const ev = victims.length > 1 ? 'hop-multi' : mover.character === 'insaner' && Math.random() < 0.5 ? 'skill' : 'capture';
      const rel = playVoice(mover.character, ev, vo);
      shout = rel ? (VOICE_TEXT[rel] ?? null) : null;
    } else playVoice(mover.character, signature ? 'skill' : 'move', vo);
  };
  /** One victim struck (`move.captureId`): sound, haptic, hit flash; the cut-in once per move. */
  const impact = (move: Move) => {
    const id = move.captureId;
    if (!id || impacted.has(id)) return;
    impacted.add(id);
    const byMe = move.pieceId.startsWith(`p${HUMAN}-`);
    sfx('capture');
    haptic('capture');
    if (impacted.size >= 2) showComboFx(impacted.size);
    else showCaptureFx(byMe);
    if (mover && mover.id === move.pieceId) {
      playCharSfx(mover.character, 'capture');
      if (!cutInShown) {
        cutInShown = true;
        spawnCutIn(cutInEl({ character: mover.character, level: mover.level, owner: mover.owner, kind: 'capture', line: shout ?? undefined, awake: isAwake(mover) }));
      }
    }
    const v = victims.find((p) => p.id === id);
    if (v) playCharSfx(v.character, deathEvent(v));
  };
  const moveFeedbackEnd = (move: Move) => {
    // Boards without onImpact (or a hop cut short): every victim is still struck once.
    for (const id of capturedIds(move)) impact({ ...move, captureId: id });
    if (move.wasted) {
      if (mover) playCharSfx(mover.character, deathEvent(mover));
      playWasteDeath();
      haptic('warn');
      const mine = move.pieceId.startsWith(`p${HUMAN}-`);
      spawnFx(h('div', { class: 'float-text float-text--waste' }, mine ? '불모지에 소멸!' : '상대가 불모지에 소멸!'), 1300);
    } else if (!move.captureId) sfx('land');
  };
  let lastTurnShown: number | null = null;
  let lastGlow: PlayerId | null | undefined;
  const askResign = async () => {
    if (!ctrl || ctrl.phase === 'ended') return;
    const ok = await confirmDialog({
      title: '기권할까요?',
      body: '기권하면 이번 대전은 패배로 기록됩니다.',
      confirmLabel: '기권',
      cancelLabel: '계속하기',
      danger: true,
    });
    if (ok) ctrl?.resign();
  };

  const BLOCK_TEXT: Record<SkillBlock, string> = {
    noSkill: '',
    notYourTurn: '내 차례에 사용',
    chain: '연쇄 이동 중',
    notYet: '',
    used: '이번 판에 이미 사용',
    active: '타천 중',
    storm: '자기장 이후 사용 불가',
    stunned: '속박 · 다음 턴에 사용 가능',
    ended: '',
  };

  /** Hand card tap: the same controller path as tapping the piece on the board. */
  const onHandTap = (pieceId: string) => {
    const c = ctrl;
    if (!c) return;
    if (targeting || transformAsk) {
      stopTargeting();
      transformAsk = null;
      renderSnapshot(c.snapshot());
    }
    const p = getPieceById(c.state, pieceId);
    if (p && isStunned(p)) {
      // A stunned card cannot be selected (the piece sits out its owner's next turn).
      sfx('tap');
      haptic('light');
      toast(`${josa(CHARACTERS[p.character].nameKo, '은/는')} 인형 함정에 속박돼 이번 턴에 움직일 수 없어요`, { tone: 'warn', duration: 2200 });
      return;
    }
    if (!selectFromHand(c, pieceId)) {
      sfx('tap');
      haptic('light');
    }
  };

  /** Opponent card tap (tablet landscape): preview that piece's reach, as a board tap does. */
  const onOppHandTap = (pieceId: string) => {
    const c = ctrl;
    if (!c) return;
    if (targeting || transformAsk) {
      stopTargeting();
      transformAsk = null;
      renderSnapshot(c.snapshot());
    }
    const p = getPieceById(c.state, pieceId);
    if (p) c.tapCell(p.pos);
    else {
      sfx('tap');
      haptic('light');
    }
  };

  const stopTargeting = () => {
    if (!targeting) return;
    targeting = null;
    board?.setSkillPreview?.(null, null);
  };

  const startTargeting = (pieceId: string) => {
    const c = ctrl;
    if (!c) return;
    const p = getPieceById(c.state, pieceId);
    if (!p || skillBlock(c.state, pieceId) !== null) return;
    const anchorList = skillAnchors(c.state, pieceId).map(sqOf);
    targeting = { pieceId, level: p.level, anchors: new Set(anchorList), preview: null };
    // Only the area under consideration is drawn (valid corners would tint nearly the whole board).
    board?.setSkillPreview?.([], null);
    sfx('select');
    haptic('light');
    renderSnapshot(c.snapshot());
  };

  /** Anchor (lowest corner) of the area for a tapped square: the tap sits at the area's centre. */
  const anchorFor = (pos: Pos, k: number): Pos => {
    const clamp = (v: number) => Math.max(0, Math.min(BOARD_SIZE - k, v));
    return { r: clamp(pos.r - Math.floor((k - 1) / 2)), c: clamp(pos.c - Math.floor((k - 1) / 2)) };
  };

  const confirmSkill = () => {
    const t = targeting;
    if (!t || !t.preview || !t.anchors.has(sqOf(t.preview))) return;
    const action: SkillAction = { kind: 'skill', pieceId: t.pieceId, anchor: t.preview };
    stopTargeting();
    if (!ctrl?.trySkill(action)) toast('지금은 불모지를 쓸 수 없어요', { tone: 'warn' });
  };

  const onTargetTap = (pos: Pos) => {
    const t = targeting;
    if (!t) return;
    const k = WASTE_SIZE[t.level];
    const anchor = anchorFor(pos, k);
    const same = t.preview && t.preview.r === anchor.r && t.preview.c === anchor.c;
    const valid = t.anchors.has(sqOf(anchor));
    // Tapping the previewed area again confirms it.
    if (same && valid) {
      confirmSkill();
      return;
    }
    t.preview = anchor;
    board?.setSkillPreview?.([], { squares: wasteArea(t.level, anchor), valid });
    sfx(valid ? 'select' : 'tap');
    if (ctrl) renderSnapshot(ctrl.snapshot());
  };

  /** Rakaeli's skill button: one tap asks for a confirm (the board previews the transformed reach). */
  const askTransform = (pieceId: string) => {
    const c = ctrl;
    if (!c || skillBlock(c.state, pieceId) !== null) return;
    transformAsk = pieceId;
    sfx('select');
    haptic('light');
    renderSnapshot(c.snapshot());
  };

  const cancelTransform = () => {
    if (!transformAsk) return;
    transformAsk = null;
    sfx('tap');
    if (ctrl) renderSnapshot(ctrl.snapshot());
  };

  const confirmTransform = () => {
    const c = ctrl;
    const id = transformAsk;
    transformAsk = null;
    const p = c && id ? getPieceById(c.state, id) : undefined;
    if (!c || !p) return;
    if (!c.trySkill({ kind: 'skill', pieceId: p.id, anchor: { ...p.pos } })) {
      toast(`지금은 ${josa(CHARACTERS[p.character].skill?.nameKo ?? '스킬', '을/를')} 쓸 수 없어요`, { tone: 'warn' });
      renderSnapshot(c.snapshot());
    }
  };

  /** Squares a piece would reach once transformed (the confirm preview). */
  const transformedReach = (s: GameState, pieceId: string): Move[] => {
    const p = getPieceById(s, pieceId);
    return p ? getTargetsForPiece(s, { ...p, awaken: AWAKEN_TURNS }) : [];
  };

  /** The dock below the board: chain move, a skill button, wasteland targeting or the transform confirm. */
  const renderDock = (snap: ControllerSnapshot) => {
    const s = snap.state;
    const myTurn = snap.phase === 'humanTurn' && !snap.paused;
    if (targeting && (!myTurn || !getPieceById(s, targeting.pieceId) || skillBlock(s, targeting.pieceId) !== null)) stopTargeting();
    if (transformAsk && (!myTurn || skillBlock(s, transformAsk) !== null)) transformAsk = null;
    const sel = snap.selection ? getPieceById(s, snap.selection.pieceId) : undefined;
    let key = '';
    let content: HTMLElement[] = [];
    if (myTurn && s.bonusPieceId !== null) {
      key = 'chain';
      content = [
        h('span', { class: 'action-bar__text' }, icon('magic', 16), '연쇄 이동 · 한 번 더!'),
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'data-action': 'skip-bonus', onclick: () => ctrl?.skipBonus() }, '건너뛰기'),
      ];
    } else if (transformAsk) {
      const p = getPieceById(s, transformAsk)!;
      const def = CHARACTERS[p.character];
      key = `transform|${p.id}`;
      content = [
        h('span', { class: 'action-bar__text' }, icon('magic', 16), `${def.skill!.nameKo} · ${AWAKEN_TURNS - 1}번 이동 동안 범위 확장`),
        h('button', { class: 'btn btn--text btn--sm', type: 'button', 'data-action': 'skill-cancel', onclick: () => cancelTransform() }, '취소'),
        h('button', { class: 'btn btn--success btn--sm action-bar__go action-bar__go--awake', type: 'button', 'data-action': 'skill-confirm', onclick: () => confirmTransform() }, def.skill!.nameKo),
      ];
    } else if (targeting) {
      const t = targeting;
      const k = WASTE_SIZE[t.level];
      const valid = !!t.preview && t.anchors.has(sqOf(t.preview));
      key = `aim|${t.preview?.r},${t.preview?.c}|${valid}`;
      content = [
        h('span', { class: 'action-bar__text' }, icon('target', 16), t.preview ? (valid ? '한 번 더 탭하거나 설치를 누르세요' : '말이 있는 칸에는 깔 수 없어요') : `불모지(${k}×${k})를 깔 곳을 탭하세요`),
        h('button', { class: 'btn btn--text btn--sm', type: 'button', 'data-action': 'skill-cancel', onclick: () => { stopTargeting(); if (ctrl) renderSnapshot(ctrl.snapshot()); } }, '취소'),
        h('button', { class: 'btn btn--success btn--sm action-bar__go', type: 'button', 'data-action': 'skill-confirm', disabled: !valid, onclick: () => confirmSkill() }, '설치'),
      ];
    } else if (myTurn && sel && sel.owner === HUMAN && CHARACTERS[sel.character].skill) {
      const block = skillBlock(s, sel.id);
      const transform = skillKindOf(sel.character) === 'transform';
      const k = WASTE_SIZE[sel.level];
      const ready = transform ? `${AWAKEN_TURNS - 1}번 이동 동안 범위 확장` : `빈 칸 ${k}×${k} · 닿으면 소멸`;
      const reason =
        block === 'notYet' ? `${skillUnlockIn(s)}턴 후 사용 가능` : block === 'active' ? `타천 중 · ${sel.awaken ?? 0}번 더 이동` : block ? BLOCK_TEXT[block] : ready;
      key = `skill|${sel.id}|${block}|${reason}`;
      content = [
        h(
          'button',
          {
            class: `skill-btn${block ? ' is-blocked' : ''}${transform ? ' skill-btn--awake' : ''}${block === 'active' ? ' is-active' : ''}`,
            type: 'button',
            'data-action': 'skill',
            disabled: !!block,
            onclick: () => (transform ? askTransform(sel.id) : startTargeting(sel.id)),
          },
          h('span', { class: 'skill-btn__icon', 'aria-hidden': 'true' }, icon('magic', 20)),
          h('span', { class: 'skill-btn__main' }, h('span', { class: 'skill-btn__name' }, `스킬 · ${CHARACTERS[sel.character].skill!.nameKo}`), h('span', { class: 'skill-btn__sub' }, reason)),
        ),
      ];
    }
    if (key === dockKey) return;
    dockKey = key;
    actionBar.hidden = !key;
    actionBar.className = `action-bar${key ? ` action-bar--${key.split('|')[0]}` : ''}`;
    replaceChildren(actionBar, ...content);
  };

  /** One-time notices: the skills unlocking, and the storm about to forbid them. */
  const skillNotices = (snap: ControllerSnapshot) => {
    const s = snap.state;
    if (snap.phase === 'ended') return;
    // Every skill character casts once per match: only the ones still unused matter.
    const mine = s.storm === 0 ? s.pieces.filter((p) => p.owner === HUMAN && CHARACTERS[p.character].skill && !p.skillUsed) : [];
    if (!notified.unlock && mine.length && s.ply >= SKILL_UNLOCK_PLY && snap.phase === 'humanTurn') {
      notified.unlock = true;
      const names = mine.map((p) => CHARACTERS[p.character].nameKo);
      const last = names[names.length - 1];
      toast(
        mine.length === 1
          ? `${names[0]}의 스킬 ${quoted(CHARACTERS[mine[0].character].skill!.nameKo, '을/를')} 쓸 수 있어요! ${josa(last, '을/를')} 탭하세요`
          : `스킬을 쓸 수 있어요! ${names.slice(0, -1).join('·')}·${josa(last, '을/를')} 탭하세요`,
        { tone: 'success', duration: 2800 },
      );
    }
    if (!notified.storm && mine.length && s.stormIn !== null) {
      notified.storm = true;
      const what = mine.length === 1 ? quoted(CHARACTERS[mine[0].character].skill!.nameKo, '을/를') : '스킬을';
      toast(`자기장이 ${pliesToTurns(s.stormIn)}턴 후 좁혀와요. 그 전에만 ${what} 쓸 수 있어요`, { tone: 'warn', duration: 3000 });
    }
  };

  const renderSnapshot = (snap: ControllerSnapshot) => {
    const s = snap.state;
    // A drag in progress ends (flies back) when the turn ends, the game pauses, the bot acts, etc.
    boardDrag?.sync(snap);
    if (board) {
      if (snap.phase !== 'animating' && syncedPieces !== s.pieces) {
        board.setPieces(s.pieces);
        syncedPieces = s.pieces;
      }
      const sel = snap.selection;
      const selPiece = sel ? getPieceById(s, sel.pieceId) : undefined;
      if (snap.phase === 'animating' || targeting) {
        board.setHighlights({ selected: targeting ? (selPiece?.pos ?? null) : null, moves: [], captures: [], lastMove: targeting ? snap.lastMove : null });
      } else if (transformAsk && getPieceById(s, transformAsk)) {
        // Confirming the transform: preview the transformed reach from where he stands.
        const reach = transformedReach(s, transformAsk);
        board.setHighlights({
          selected: getPieceById(s, transformAsk)!.pos,
          moves: reach.filter((m) => !m.captureId).map((m) => m.to),
          captures: reach.filter((m) => m.captureId).map((m) => m.to),
          lastMove: snap.lastMove,
          tone: 'own',
          deadly: reach.filter((m) => s.waste.includes(sqOf(m.to))).map((m) => m.to),
        });
      } else {
        board.setHighlights({
          selected: selPiece?.pos ?? null,
          moves: sel ? sel.moves.filter((m) => !m.captureId).map((m) => m.to) : [],
          captures: sel ? sel.moves.filter((m) => m.captureId).map((m) => m.to) : [],
          lastMove: snap.lastMove,
          // A tapped enemy shows its reach in red; own pieces keep the white markers.
          tone: selPiece && selPiece.owner === BOT ? 'enemy' : 'own',
          // Moves that end on wasteland are suicide: marked as deadly.
          deadly: sel ? sel.moves.filter((m) => s.waste.includes(sqOf(m.to))).map((m) => m.to) : [],
        });
      }
      board.setInteractive(snap.phase !== 'animating' && snap.phase !== 'ended' && !snap.paused);
      const sk = `${s.storm}|${s.stormIn}`;
      if (sk !== stormKey) {
        stormKey = sk;
        (board as unknown as { setStorm?: (storm: number, nextIn: number | null) => void }).setStorm?.(s.storm, s.stormIn);
      }
    }
    // Storm chip (also counts down to sudden death) + chain-move bar
    const sdPlies = suddenDeathIn(s);
    const sd = sdPlies === null ? null : pliesToTurns(sdPlies);
    const sdSoon = sd !== null && sd <= SUDDEN_DEATH_WARN_TURNS;
    stormChip.hidden = snap.phase === 'ended' || (s.stormIn === null && !sdSoon);
    if (s.stormIn !== null) {
      const inTurns = pliesToTurns(s.stormIn);
      const skillLeft = s.storm === 0 && s.pieces.some((p) => CHARACTERS[p.character].skill && !p.skillUsed);
      setText(stormText, s.storm > 0 ? `자기장 · 좌우 ${s.storm}줄 소멸 · ${inTurns}턴 후 축소` : `자기장 활성 · ${inTurns}턴 후 축소${skillLeft ? ' · 이후 스킬 금지' : ''}`);
      stormChip.classList.toggle('is-soon', inTurns <= 1);
    } else if (sd !== null && sdSoon) {
      setText(stormText, sd > 0 ? `${sd}턴 후 자기장 발동 · 좌우부터 좁혀와요` : '이번 턴부터 자기장 발동');
      stormChip.classList.toggle('is-soon', sd <= 1);
    }
    // Turn counter
    const tn = turnNumber(s);
    if (tn !== lastTurnNum) {
      lastTurnNum = tn;
      setText(turnNum, String(tn));
      turnCount.setAttribute('aria-label', `턴 ${tn}`);
      turnCount.classList.remove('is-tick');
      void turnCount.offsetWidth;
      turnCount.classList.add('is-tick');
    }
    turnCount.classList.toggle('is-late', sd !== null ? sdSoon : s.stormIn !== null);
    if (s.stormIn !== null && !stormStarted) {
      stormStarted = true;
      // Started by the clock (both sides still have several pieces) rather than by a lone survivor.
      if (s.pieces.filter((p) => p.owner === HUMAN).length > 1 && s.pieces.filter((p) => p.owner === BOT).length > 1 && snap.phase !== 'ended') showSuddenDeath();
    }
    renderDock(snap);
    // Wasteland on the board (only ever grows).
    if (board && s.waste.length !== wasteKey) {
      wasteKey = s.waste.length;
      board.setWaste?.(s.waste);
    }
    // Doll traps (only ever accumulate) are drawn once the move that laid them has played.
    const traps = s.traps ?? [];
    const tk = traps.map((t) => t.sq * 2 + t.owner).join();
    if (board && snap.phase !== 'animating' && tk !== trapKey) {
      trapKey = tk;
      board.setTraps?.(traps);
    }
    skillNotices(snap);
    // HUD
    roster.update(s);
    hand.update(handModel(params.playerFormation, HUMAN, snap));
    oppHand.update(handModel(params.botFormation, BOT, snap));
    const tp = turnPillContent(snap);
    if (tp.cls !== pillCls) {
      pillCls = tp.cls;
      pill.className = `turn-pill ${tp.cls}`;
    }
    setText(pillText, tp.text);
    const lastEntry = s.history[s.history.length - 1];
    const passing = snap.phase !== 'ended' && lastEntry?.kind === 'pass' && (lastEntry.reason === 'noMoves' || lastEntry.reason === 'stunned') ? lastEntry.player : null;
    passChip.hidden = passing === null;
    if (passing !== null) {
      const stunned = lastEntry?.kind === 'pass' && lastEntry.reason === 'stunned';
      setText(
        passChip,
        passing === BOT ? (stunned ? '상대 말 속박 · 내가 연속으로 둬요' : '상대 이동 불가 · 내가 연속으로 둬요') : stunned ? '내 말 속박 · 자동 패스' : '이동 가능한 말 없음 · 자동 패스',
      );
    }
    // Your-turn cue (not while paused / on the very first frame before any gesture is irrelevant).
    if (snap.phase === 'humanTurn' && prevPhase !== 'humanTurn' && !snap.paused) {
      sfx('turn');
      if (prevPhase !== null) haptic('turn');
    }
    // Turn banner + board turn sweep whenever the side to move changes (not on the ended state).
    if (snap.phase !== 'ended' && snap.phase !== 'animating' && s.turn !== lastTurnShown) {
      if (lastTurnShown !== null || s.turn === HUMAN) showTurnBanner(s.turn === HUMAN);
      lastTurnShown = s.turn;
      const b = board as unknown as { setTurn?: (p: 0 | 1) => void } | null;
      b?.setTurn?.(s.turn);
    }
    prevPhase = snap.phase;
    updateCoach(snap);
    const activeTurn = snap.phase === 'ended' ? null : s.turn;
    topBar.classList.toggle('is-turn', activeTurn === BOT);
    bottomBar.classList.toggle('is-turn', activeTurn === HUMAN);
    if (activeTurn !== lastGlow) {
      lastGlow = activeTurn;
      // Optional board API (a subtle board-edge glow in the mover's team colour).
      (board as { setTurnGlow?: (owner: PlayerId | null) => void } | null)?.setTurnGlow?.(activeTurn);
    }
    resignBtn.toggleAttribute('disabled', snap.phase === 'ended');

    const selKey = snap.selection ? `${snap.selection.pieceId}|${snap.selection.actionable}` : null;
    if (selKey !== prevSel) {
      if (snap.selection && snap.phase !== 'animating') {
        if (snap.selection.actionable) {
          sfx('select');
          haptic('light');
          const sp = getPieceById(s, snap.selection.pieceId);
          if (sp) playVoice(sp.character, isAwake(sp) ? 'awake-select' : 'select', { level: sp.level, owner: sp.owner });
        } else sfx('tap');
      }
      prevSel = selKey;
    }

    const selPiece = snap.selection ? getPieceById(s, snap.selection.pieceId) : undefined;
    const showSel = !!selPiece && snap.phase !== 'animating' && snap.phase !== 'ended';
    selChip.hidden = !showSel;
    if (selPiece && showSel) {
      const k = `${selPiece.id}|${selPiece.level}|${snap.selection?.moves.length}|${snap.selection?.actionable}|${selPiece.stun ?? 0}|${selPiece.awaken ?? 0}`;
      if (k !== selChipKey) {
        selChipKey = k;
        const sel = snap.selection!;
        const caps = sel.moves.filter((m) => m.captureId).length;
        selChip.className = `sel-chip owner-${selPiece.owner}`;
        const awake = isAwake(selPiece);
        replaceChildren(selArt, unitArt(selPiece.character, selPiece.level, { size: 24, owner: selPiece.owner, awake }));
        setText(selName, CHARACTERS[selPiece.character].nameKo);
        setText(selStars, starsOf(selPiece.level));
        selChip.classList.toggle('is-awake', awake);
        setText(
          selHint,
          (awake ? `타천 · ${selPiece.awaken} · ` : '') +
          (isStunned(selPiece)
            ? '속박 · 1턴 쉬어요'
            : selPiece.owner === BOT
            ? `상대 · 이동 ${sel.moves.length}칸${caps ? ` · 내 말 ${caps}개 위협` : ''}`
            : sel.actionable
              ? sel.moves.length
                ? `이동 ${sel.moves.length}칸${caps ? ` · 잡기 ${caps}` : ''}`
                : '지금 움직일 수 없어요'
              : `이동 범위 ${sel.moves.length}칸`),
        );
      }
    } else selChipKey = '';
    field.update(s);
  };

  const outcomeOf = (s: GameState): MatchOutcome => (s.winner === null ? 'draw' : s.winner === HUMAN ? 'win' : 'loss');

  /** Applies the match to the profile. Runs exactly once per match (guarded by `settled`). */
  const settle = (outcome: MatchOutcome): MatchSummary | null => {
    if (settled) return null;
    settled = true;
    const r = settleMatch(getProfile(), { mode: params.mode, result: outcome, dungeonLevel: params.dungeonLevel, rng: defaultRng, now: new Date() });
    setProfile(r.profile);
    return r.summary;
  };

  const showResult = async (s: GameState) => {
    if (resultShown) return;
    resultShown = true;
    const outcome = outcomeOf(s);
    const summary = settle(outcome);
    const after = getProfile();
    setCoach('');
    field.close();
    await bag.sleep(s.endReason === 'resign' ? 150 : 650);
    if (bag.isDisposed) return;
    clearToasts(); // nothing may sit on top of (or compete with) the result
    const title = outcome === 'win' ? '승리!' : outcome === 'loss' ? '패배' : '무승부';
    const adjudicated = s.endReason === 'stalemate' || (s.endReason === 'storm' && s.pieces.length === 0);
    const panel = summary ? resultPanel(summary, { onShop: () => router.navigate('shop') }) : null;
    if (panel) bag.add(() => panel.dispose());
    // Hero strip: the player's surviving units celebrate (win) or the opponent's units stand (loss).
    const heroOwner = outcome === 'loss' ? BOT : HUMAN;
    const heroPieces = s.pieces.filter((pc) => pc.owner === heroOwner);
    const hero = h(
      'div',
      { class: `result__hero result__hero--${outcome}`, 'aria-hidden': 'true' },
      heroPieces.map((pc, i) => h('span', { class: 'result__unit', style: `--i:${i}` }, unitArt(pc.character, pc.level, { size: 64, owner: pc.owner }))),
    );
    const body = h(
      'div',
      { class: 'result__body' },
      hero,
      h('p', { class: 'result__reason', 'data-reason': s.endReason ?? '' }, endReasonText(s.endReason, outcome, s.endReason === 'storm' && s.pieces.length === 0)),
      outcome === 'loss' && params.mode !== 'ranked' ? h('p', { class: 'result__cheer' }, '진형·성급을 바꿔 다시 도전해 보세요') : null,
      adjudicated && s.pieces.length > 0 ? h('p', { class: 'result__score' }, `전력  나 ${materialScore(s, HUMAN)} : ${materialScore(s, BOT)} 상대`) : null,
      panel?.el ?? null,
      params.mode === 'dungeon' ? null : h('p', { class: 'result__total', 'data-record': '' }, icon('trophy', 16), `통산 ${after.stats.wins}승 ${after.stats.losses}패 ${after.stats.draws}무`),
    );
    const dialog = showDialog<'again' | 'lobby'>({
      title,
      className: `result result--${outcome}`,
      icon: h(
        'span',
        { class: `result__icon result__icon--${outcome}` },
        icon(outcome === 'win' ? 'trophy' : outcome === 'loss' ? 'flag' : 'info', 40),
      ),
      body,
      dismissValue: 'lobby',
      actions: [
        { label: '로비', value: 'lobby', variant: 'text' },
        { label: '다시 하기', value: 'again', variant: 'filled' },
      ],
    });
    panel?.start();
    // The winning side's leading survivor has the last word.
    const speaker = outcome === 'draw' ? undefined : heroPieces[0];
    if (speaker) playVoice(speaker.character, 'victory', { level: speaker.level, owner: speaker.owner });
    if (outcome === 'win') {
      sfx('win');
      haptic('win');
      bag.add(confetti());
    } else sfx(outcome === 'loss' ? 'lose' : 'draw');
    const choice = await dialog;
    if (bag.isDisposed) return;
    if (choice === 'again') router.navigate('matchmaking', { mode: params.mode, dungeonLevel: params.dungeonLevel });
    else router.home();
  };

  return {
    el,
    mount() {
      document.body.classList.add('in-game');
      const theme = arenaById(params.themeArena);
      useMatchBackdrop(theme.backdrop);
      playArenaMusic(theme.id);
      bag.add(() => duck(false));
      bag.add(() => document.body.classList.remove('in-game'));
      try {
        // The 3D arena is disabled for now: top-down board with illustrated tokens only, in the
        // match arena's board theme (cells, bezel, grid, surface detail, ambient particles).
        board = createBoardView(boardHost, { topOnly: true, arena: theme.id });
      } catch (e) {
        console.error('board init failed', e);
        replaceChildren(boardHost, h('div', { class: 'board-error' }, '보드를 표시할 수 없습니다.'));
      }
      bag.add(() => board?.dispose());
      bot = new BotClient();
      const botRef = bot;
      bag.add(() => botRef.dispose());

      const c: GameController = (ctrl = new GameController(initial, {
        requestBotMove: (state) => botRef.requestMove(state, params.difficulty),
        botThinkDelayMs: () => randInt(defaultRng, PACING.botThinkMinMs, PACING.botThinkMaxMs),
        animate: async (move, after) => {
          if (move.pieceId.startsWith(`p${HUMAN}-`)) finishCoach();
          // Stepping on wasteland destroys the mover: the board plays the toxic dissolve.
          const m: Move = c.state.waste.includes(sqOf(move.to)) ? { ...move, wasted: true } : move;
          moveFeedbackStart(m, c.state);
          const b = board;
          if (b) {
            b.setInteractive(false);
            await b.animateMove(m, after.pieces);
            // (Unless the board was replaced meanwhile: the new one syncs on the next render.)
            if (board === b) syncedPieces = after.pieces;
          }
          if (!bag.isDisposed) moveFeedbackEnd(m);
        },
        animateSkill: async (action, after) => {
          const b = board;
          const caster = getPieceById(c.state, action.pieceId);
          const transform = !!caster && skillKindOf(caster.character) === 'transform';
          if (caster) {
            const rel = playVoice(caster.character, 'skill', { level: caster.level, owner: caster.owner });
            playCharSfx(caster.character, 'skill');
            haptic('capture');
            spawnCutIn(cutInEl({ character: caster.character, level: caster.level, owner: caster.owner, kind: 'skill', line: rel ? VOICE_TEXT[rel] : undefined, awake: transform }));
          }
          if (transform) {
            // The transform-in FX (optional board API); the token shows the transformed face once
            // the pieces are synced with `after`.
            if (b) {
              b.setInteractive(false);
              await playAwaken(b, action.pieceId, 'on');
            }
            return;
          }
          if (b) {
            b.setInteractive(false);
            await b.animateSkill?.(action.pieceId, caster ? wasteArea(caster.level, action.anchor) : []);
            b.setWaste?.(after.waste);
            wasteKey = after.waste.length;
          }
        },
      }));
      bag.add(() => c.dispose());

      /** Input and strike callbacks of a (new) board view. */
      const wireBoard = (view: IBoardView) => {
        view.onCellClick((pos: Pos) => {
          if (targeting) onTargetTap(pos);
          else {
            // A tap anywhere on the board while the transform waits for its confirm cancels it.
            if (transformAsk) transformAsk = null;
            c.tapCell(pos);
          }
        });
        view.onImpact?.((move) => {
          if (!bag.isDisposed) impact(move);
        });
      };
      board?.setPieces(initial.pieces);
      syncedPieces = initial.pieces;
      if (board) wireBoard(board);
      // A WebGL context that is lost and not restored leaves a blank board while the match goes on
      // (it reads as a frozen game; iOS drops contexts under memory pressure). After a grace period
      // with the page visible, switch to the 2D board, which shows exactly the same state.
      const glCanvas = board instanceof BoardView ? boardHost.querySelector('canvas') : null;
      if (glCanvas) {
        let lost = false;
        let timer = 0;
        const arm = () => {
          window.clearTimeout(timer);
          timer = lost && !document.hidden ? bag.timeout(() => swapTo2D(), CONTEXT_FALLBACK_MS) : 0;
        };
        const swapTo2D = () => {
          if (!lost || document.hidden || bag.isDisposed || !(board instanceof BoardView)) return;
          console.warn('[game] WebGL context lost and not restored: switching to the 2D board');
          const old = board;
          board = null;
          old.dispose(); // settles any running animation
          try {
            board = new Board2DView(boardHost, { arena: theme.id });
          } catch (e) {
            console.error('2D board init failed', e);
            replaceChildren(boardHost, h('div', { class: 'board-error' }, '보드를 표시할 수 없습니다.'));
            return;
          }
          wireBoard(board);
          // Everything the board was told so far is re-sent by the next render.
          board.setPieces(c.state.pieces);
          syncedPieces = c.state.pieces;
          stormKey = '';
          wasteKey = -1;
          trapKey = '\u0000';
          lastGlow = undefined;
          stopTargeting(); // the wasteland preview lived on the old board
          (board as { setTurn?: (p: PlayerId) => void }).setTurn?.(c.state.turn);
          renderSnapshot(c.snapshot());
        };
        bag.listen(glCanvas, 'webglcontextlost', () => {
          lost = true;
          arm();
        });
        bag.listen(glCanvas, 'webglcontextrestored', () => {
          lost = false;
          arm();
        });
        bag.listen(document, 'visibilitychange', arm);
      }
      const dragRef = (boardDrag = installBoardDrag({
        host: boardHost,
        board: () => board,
        controller: () => ctrl,
        blocked: () => targeting !== null || transformAsk !== null,
        warn: (message) => toast(message, { tone: 'warn', duration: 2600 }),
      }));
      bag.add(() => dragRef.dispose());
      preloadCutIns([...params.playerFormation, ...params.botFormation]);
      void preloadCharacterAudio([...new Set([...params.playerFormation, ...params.botFormation].map((f) => f.character))]);
      bag.add(() => stopVoice());

      bag.add(
        c.on((e) => {
          if (e.type === 'change') renderSnapshot(c.snapshot());
          else if (e.type === 'toast') {
            // Repeated auto-passes would toast every single move: show it once, then the pass chip.
            if (e.kind === 'pass' && e.player !== undefined) {
              if (passToastShown[e.player]) return;
              passToastShown[e.player] = true;
            }
            if (e.kind === 'timeout' && e.player === HUMAN) haptic('warn');
            toast(e.message, { tone: e.tone === 'warn' ? 'warn' : 'neutral' });
          } else if (e.type === 'bonus') {
            showBonusBanner(e.player === HUMAN);
            const bp = getPieceById(c.state, e.pieceId);
            if (bp) {
              playVoice(bp.character, 'chain', { level: bp.level, owner: bp.owner });
              playCharSfx(bp.character, 'chain');
            }
            sfx(e.player === HUMAN ? 'levelup' : 'turn');
            if (e.player === HUMAN) haptic('capture');
          } else if (e.type === 'skill') {
            if (e.player === BOT) toast('상대 브루타일이 불모지를 깔았어요! 닿으면 소멸해요', { tone: 'warn', duration: 2600 });
          } else if (e.type === 'awaken') {
            const who = getPieceById(c.state, e.pieceId);
            const mine = e.player === HUMAN;
            if (e.phase === 'on') {
              spawnFx(h('div', { class: 'float-text float-text--awake' }, mine ? '타천!' : '상대 타천!'), 1300);
              if (!transformTipShown) {
                transformTipShown = true;
                const name = CHARACTERS[who?.character ?? 'rakaeli'].nameKo;
                toast(`${mine ? '' : '상대 '}${name} 타천: ${AWAKEN_TURNS - 1}번 이동하는 동안 범위 확장`, { tone: mine ? 'success' : 'warn', duration: 3000 });
              }
            } else if (who) {
              // Turning back: the revert FX, his last transformed line and sound.
              playVoice(who.character, 'awake-end', { level: who.level, owner: who.owner });
              playCharSfx(who.character, 'awake-end');
              spawnFx(h('div', { class: 'float-text float-text--awake-end' }, mine ? '타천 해제' : '상대 타천 해제'), 1100);
              void playAwaken(board, who.id, 'off');
            }
          } else if (e.type === 'trap') {
            const mine = e.player === HUMAN;
            const who = getPieceById(c.state, e.pieceId);
            if (who) {
              playVoice(who.character, 'trap-set', { level: who.level, owner: who.owner });
              playCharSfx(who.character, 'trap-set');
            }
            sfx('select');
            haptic('light');
            spawnFx(h('div', { class: 'float-text float-text--trap' }, mine ? `인형 함정 · ${e.trapsLeft}개 남음` : '상대 인형 함정!'), 1200);
            const p = getProfile();
            if (!p.onboarding.trapTip) {
              updateProfile((q) => ({ ...q, onboarding: { ...q.onboarding, trapTip: true } }));
              toast(mine ? '미셸이 인형 함정을 놓았어요! 상대 말이 이 칸에 멈추면 1턴 속박돼요' : '상대 미셸의 인형 함정! 그 칸에 멈추면 1턴 동안 못 움직여요', { tone: mine ? 'success' : 'warn', duration: 3200 });
            }
          } else if (e.type === 'stun') {
            const mine = e.player === HUMAN;
            // The trap's owner (the other side's Michelle) has the line.
            const owner = mine ? BOT : HUMAN;
            const michelle = c.state.pieces.find((p) => p.owner === owner && p.character === 'michelle');
            playVoice(michelle?.character ?? 'michelle', 'trap-sprung', { level: michelle?.level ?? 2, owner });
            playCharSfx('michelle', 'trap-sprung');
            haptic(mine ? 'warn' : 'capture');
            spawnFx(h('div', { class: `float-text float-text--trap${mine ? ' float-text--hurt' : ''}` }, mine ? '속박! 1턴 쉬어요' : '상대 속박!'), 1300);
            const p = getProfile();
            if (!p.onboarding.stunTip) {
              updateProfile((q) => ({ ...q, onboarding: { ...q.onboarding, stunTip: true } }));
              toast('인형 함정에 걸린 말은 주인의 다음 1턴 동안 이동도 스킬도 못 써요', { tone: 'neutral', duration: 3200 });
            }
          } else if (e.type === 'turnAround') {
            // Coach toast on the first turn-around of each of my direction-dependent pieces (the
            // hand card and roster chevrons flip every time).
            const who = getPieceById(c.state, e.pieceId);
            if (e.player === HUMAN && who && isDirectional(who) && !turnTipShown.has(who.id)) {
              turnTipShown.add(who.id);
              toast(`${CHARACTERS[who.character].nameKo} 방향 전환 · 이제 ${e.arrow === 'up' ? '위로' : '아래로'} 전진`, { tone: 'neutral', duration: 2600 });
            }
          } else if (e.type === 'multiCapture') {
            if (e.player === HUMAN) haptic('win');
          } else if (e.type === 'absorb') {
            const who = e.player === HUMAN ? '내 인세이너가' : '상대 인세이너가';
            toast(`${who} ${CHARACTERS[e.character].nameKo}의 이동 능력을 흡수했어요`, { tone: e.player === HUMAN ? 'success' : 'warn', duration: 2400 });
          } else if (e.type === 'storm') {
            showStormFx(e.killed.length);
            // Pieces swallowed by the storm: their death sound, and one last word from the first.
            const gone = e.lost;
            gone.forEach((p) => playCharSfx(p.character, deathEvent(p)));
            if (gone[0]) playVoice(gone[0].character, deathEvent(gone[0]), { level: gone[0].level, owner: gone[0].owner });
            sfx('capture');
            haptic('warn');
          }
          else if (e.type === 'ended') void showResult(e.state);
        }),
      );

      bag.listen(document, 'visibilitychange', () => {
        if (document.hidden) c.pause();
        else c.resume();
      });
      // Running out of time forfeits, so the native app pauses the clock whenever it is
      // backgrounded too (the WebView does not always fire visibilitychange there).
      if (Capacitor.isNativePlatform()) {
        let handle: PluginListenerHandle | null = null;
        let closed = false;
        void App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) c.resume();
          else c.pause();
        }).then((hd) => {
          if (closed) void hd.remove();
          else handle = hd;
        });
        bag.add(() => {
          closed = true;
          void handle?.remove();
        });
      }
      bag.listen(window, 'resize', () => board?.resize());
      bag.listen(window, 'orientationchange', () => board?.resize());

      bag.frameLoop(() => {
        const snap = c.state;
        const active = c.phase === 'humanTurn' || c.phase === 'botThinking';
        const rem = c.turnRemainingMs();
        topRing.update(active && snap.turn === BOT, rem, c.turnTimeMs, c.paused);
        botRing.update(active && snap.turn === HUMAN, rem, c.turnTimeMs, c.paused);
        // Countdown ticks for the last seconds of the player's own turn.
        if (c.phase === 'humanTurn' && !c.paused) {
          bottomBar.classList.toggle('is-urgent', rem <= PACING.timerWarnMs);
          // Out of time is an immediate forfeit: the last seconds pulse red.
          bottomBar.classList.toggle('is-critical', rem <= CRITICAL_MS);
          const sec = Math.ceil(rem / 1000);
          if (sec !== lastTickSec) {
            lastTickSec = sec;
            if (sec > 0 && sec <= PACING.timerWarnMs / 1000) {
              sfx(sec <= 3 ? 'tickUrgent' : 'tick');
              if (sec === PACING.timerWarnMs / 1000) haptic('warn');
            }
          }
        } else {
          lastTickSec = -1;
          bottomBar.classList.remove('is-urgent', 'is-critical');
        }
      });

      if (import.meta.env.DEV) {
        const w = window as unknown as Record<string, unknown>;
        w.__game = { controller: c, board, params };
        bag.add(() => {
          if ((w.__game as { controller?: unknown } | undefined)?.controller === c) delete w.__game;
        });
      }
      if (import.meta.env.DEV || diagEnabled()) {
        // Read-only probe for automated soak tests (`?diag=1`, also in production): copies of what
        // the screen already shows (the game has no hidden information) and square geometry. It
        // cannot act: tests play through the real UI.
        const w = window as unknown as Record<string, unknown>;
        const probe = {
          snapshot: () => JSON.parse(JSON.stringify(c.snapshot())) as ControllerSnapshot,
          legalMoves: () => (c.phase === 'humanTurn' && !c.paused ? JSON.parse(JSON.stringify(getLegalMoves(c.state))) as Move[] : []),
          skillAnchors: (pieceId: string) => (c.phase === 'humanTurn' && !c.paused ? skillAnchors(c.state, pieceId) : []),
          /** Squares the opponent's pieces reach now (what tapping them previews). */
          enemyReach: () => c.state.pieces.filter((p) => p.owner === BOT).flatMap((p) => getTargetsForPiece(c.state, p).map((m) => m.to)),
          cellRect: (pos: Pos) => board?.cellRect?.(pos) ?? null,
          get renderer() {
            return board?.getDiagnostics?.()?.renderer ?? null;
          },
        };
        w.__gridclash = probe;
        bag.add(() => {
          if (w.__gridclash === probe) delete w.__gridclash;
        });
      }

      renderSnapshot(c.snapshot());
      c.start();
      if (document.hidden) c.pause();
    },
    onBack() {
      if (!ctrl || ctrl.phase === 'ended') router.home();
      else void askResign();
    },
    dispose: () => {
      field.close();
      bag.dispose();
    },
  };
}
