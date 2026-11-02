import { BotClient } from '../../ai/botClient';
import { haptic, sfx } from '../../audio/sfx';
import { playCharSfx, playVoice, preloadCharacterAudio, stopVoice } from '../../audio/voice';
import { VOICE_TEXT } from '../../audio/voiceManifest';
import { CHARACTERS, createGame, getPieceById, materialScore, suddenDeathIn, type GameState, type Move, type Piece, type Pos } from '../../engine';
import { createBoardView, type IBoardView } from '../../render';
import { MIN_MOVES_FOR_REWARD, PACING } from '../../meta/economy';
import { DIFFICULTY_LABEL } from '../../meta/opponent';
import { applyMatchResult, getProfile, updateProfile, type MatchOutcome } from '../../meta/profile';
import { randInt, defaultRng } from '../../meta/rng';
import { confetti, countUp } from '../components/celebrate';
import { starsOf, unitArt } from '../components/piece';
import { confirmDialog, showDialog } from '../components/dialog';
import { clearToasts, toast } from '../components/toast';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';
import { BOT, GameController, HUMAN, type ControllerSnapshot, type Phase } from '../game/GameController';
import { endReasonText, rosterChips, setText, TimerRing, turnPillContent } from '../game/hud';
import { createFieldPanel } from '../game/fieldPanel';
import { CUTIN_MS, cutInEl, preloadCutIns } from '../game/cutin';
import type { GameParams } from './gameParams';
import '../game/hud.css';

/** Show the sudden-death countdown this many plies before it starts. */
const SUDDEN_DEATH_WARN_PLIES = 10;

export function gameScreen(router: Router, params: GameParams): Screen {
  const bag = new Disposables();
  const initial = createGame(params.playerFormation, params.botFormation, HUMAN);

  // ---------- static DOM
  const topRing = new TimerRing(BOT);
  const botRing = new TimerRing(HUMAN);
  const topRoster = h('div', { class: 'pbar__roster-host' });
  const bottomRoster = h('div', { class: 'pbar__roster-host' });
  // The pill is built once; only its text/class change so screen readers announce real changes.
  const pillText = h('span', { class: 'turn-pill__text' });
  const pill = h(
    'div',
    { class: 'turn-pill', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
    h('span', { class: 'turn-pill__dot', 'aria-hidden': 'true' }),
    pillText,
  );
  // Match clock (10 min cap): the game is decided by material when it runs out.
  const counter = h('div', { class: 'ply-counter', role: 'timer', 'aria-label': '남은 대전 시간' });
  // Storm status: hidden until a side is down to one piece.
  const stormText = h('span', { class: 'storm-chip__text' });
  const stormChip = h('div', { class: 'storm-chip', role: 'status', 'aria-live': 'polite', hidden: true }, h('span', { class: 'storm-chip__icon', 'aria-hidden': 'true' }, icon('bolt', 14)), stormText);
  // Chain move bar: the player may play one more move with the capturing Insaner, or skip it.
  const bonusBar = h(
    'div',
    { class: 'bonus-bar', hidden: true },
    h('span', { class: 'bonus-bar__text' }, icon('magic', 16), '인세이너 연쇄 이동 · 한 번 더 움직일 수 있어요'),
    h('button', { class: 'btn btn--tonal btn--sm bonus-bar__skip', type: 'button', 'data-action': 'skip-bonus', onclick: () => ctrl?.skipBonus() }, '건너뛰기'),
  );
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
  const infoHost = h('div', { class: 'info-host' }, selChip);
  const field = createFieldPanel({
    formations: [params.playerFormation, params.botFormation],
    names: ['나', params.opponentName],
    onClose: () => menuBtn.setAttribute('aria-expanded', 'false'),
  });
  const menuBtn = h(
    'button',
    {
      class: 'icon-btn icon-btn--outlined menu-btn',
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
      h('div', { class: 'pbar__meta' }, `AI · ${DIFFICULTY_LABEL[params.difficulty]}`),
    ),
    topRoster,
    topRing.el,
    menuBtn,
  );
  // Camera toggle: 3D arena <-> top-down (persisted in settings).
  const viewIcon = h('span', { class: 'view-toggle__icon', 'aria-hidden': 'true' });
  const viewLabel = h('span', { class: 'view-toggle__label' });
  const viewBtn = h(
    'button',
    { class: 'view-toggle', type: 'button', 'data-action': 'toggle-view', onclick: () => toggleView() },
    viewIcon,
    viewLabel,
  );
  const syncViewBtn = () => {
    const top = getProfile().settings.view === 'top';
    // The button shows the view it switches TO.
    replaceChildren(viewIcon, icon(top ? 'cube' : 'topview', 18));
    setText(viewLabel, top ? '3D' : '탑뷰');
    viewBtn.setAttribute('aria-label', top ? '3D 시점으로 보기' : '위에서 내려다보기');
    viewBtn.classList.toggle('is-top', top);
  };
  const toggleView = () => {
    const next = getProfile().settings.view === 'top' ? 'tilt' : 'top';
    updateProfile((p) => ({ ...p, settings: { ...p.settings, view: next } }));
    board?.setViewMode?.(next);
    syncViewBtn();
    sfx('select');
    haptic('light');
  };
  syncViewBtn();
  const resignBtn = h(
    'button',
    { class: 'icon-btn icon-btn--outlined', type: 'button', 'aria-label': '기권', 'data-action': 'resign', onclick: () => void askResign() },
    icon('flag', 20),
  );
  const bottomBar = h(
    'footer',
    { class: 'pbar pbar--bottom' },
    h('span', { class: 'pbar__avatar pbar__avatar--blue' }, unitArt(params.playerFormation[0]?.character ?? 'sad', params.playerFormation[0]?.level ?? 1, { size: 44, owner: HUMAN })),
    h('div', { class: 'pbar__info' }, h('div', { class: 'pbar__name' }, '나'), h('div', { class: 'pbar__meta' }, '블루 · 아래쪽')),
    bottomRoster,
    botRing.el,
    resignBtn,
  );
  const boardWrap = h('div', { class: 'board-wrap' }, boardHost, fx, h('div', { class: 'board-overlay' }, pill, counter, stormChip, passChip, bonusBar, coach), viewBtn, infoHost);
  const el = h('main', { class: 'game no-select' }, topBar, boardWrap, bottomBar);

  // ---------- runtime objects (created on mount)
  let board: IBoardView | null = null;
  let bot: BotClient | null = null;
  let ctrl: GameController | null = null;
  let syncedPieces: Piece[] | null = null;
  let resultShown = false;
  let pillCls = '';
  let rosterKey = -1;
  let prevPhase: Phase | null = null;
  let prevSel: string | null = null;
  let lastTickSec = -1;
  let stormKey = '';
  let selChipKey = '';
  let stormStarted = initial.stormIn !== null;
  let lastClockSec = -1;
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
    else if (sel?.actionable && sel.moves.length > 0) setCoach('빛나는 칸을 탭해 이동하세요');
    else if (sel?.actionable) setCoach('이 말은 지금 못 움직여요. 다른 말을 탭해 보세요');
    else if (sel) setCoach('상대 말이에요. 아래쪽 파란 말을 탭해 보세요');
    else setCoach('내 말(파랑)을 탭해 이동 가능한 칸을 보세요');
  };

  const finishCoach = () => {
    if (!coachOn) return;
    coachOn = false;
    setCoach('');
    updateProfile((p) => ({ ...p, onboarding: { ...p.onboarding, firstMoveDone: true } }));
    bag.timeout(() => toast('좋아요! 상대 말 3개를 모두 잡으면 승리해요', { tone: 'success', duration: 2600 }), 450);
  };

  /**
   * Sound + haptics for one move, split into lift-off (now), the strike landing (capturing moves:
   * the board's onImpact, or the end of the animation on boards without it) and the landing.
   */
  let mover: Piece | null = null;
  let victim: Piece | null = null;
  let impactDone: Move | null = null;
  /** Caption of the capture shout, so the cut-in shows exactly what is heard. */
  let shout: string | null = null;
  const moveFeedbackStart = (move: Move, before: GameState) => {
    mover = getPieceById(before, move.pieceId) ?? null;
    victim = move.captureId ? (getPieceById(before, move.captureId) ?? null) : null;
    impactDone = null;
    shout = null;
    sfx(mover?.character === 'walk' ? 'jump' : 'move');
    if (!mover) return;
    const vo = { level: mover.level, owner: mover.owner };
    const dist = Math.max(Math.abs(move.to.r - move.from.r), Math.abs(move.to.c - move.from.c));
    // Signature moves: Marki's long charge, Walk's wide leap.
    const signature = (mover.character === 'marki' && dist >= 3) || (mover.character === 'walk' && Math.abs(move.to.c - move.from.c) >= 2);
    playCharSfx(mover.character, signature ? 'skill' : 'move');
    if (move.captureId) {
      // Insaner sometimes shouts its absorb line instead of a capture line.
      const ev = mover.character === 'insaner' && Math.random() < 0.5 ? 'skill' : 'capture';
      const rel = playVoice(mover.character, ev, vo);
      shout = rel ? (VOICE_TEXT[rel] ?? null) : null;
    } else playVoice(mover.character, signature ? 'skill' : 'move', vo);
  };
  const impact = (move: Move) => {
    if (impactDone === move || !move.captureId) return;
    impactDone = move;
    const byMe = move.pieceId.startsWith(`p${HUMAN}-`);
    sfx('capture');
    haptic('capture');
    showCaptureFx(byMe);
    if (mover && mover.id === move.pieceId) {
      playCharSfx(mover.character, 'capture');
      spawnFx(cutInEl({ character: mover.character, level: mover.level, owner: mover.owner, kind: 'capture', line: shout ?? undefined }), CUTIN_MS);
    }
    if (victim && victim.id === move.captureId) playCharSfx(victim.character, 'death');
  };
  const moveFeedbackEnd = (move: Move) => {
    if (move.captureId) impact(move);
    else sfx('land');
  };
  let lastTurnShown: number | null = null;
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

  const renderSnapshot = (snap: ControllerSnapshot) => {
    const s = snap.state;
    if (board) {
      if (snap.phase !== 'animating' && syncedPieces !== s.pieces) {
        board.setPieces(s.pieces);
        syncedPieces = s.pieces;
      }
      const sel = snap.selection;
      const selPiece = sel ? getPieceById(s, sel.pieceId) : undefined;
      if (snap.phase === 'animating') {
        board.setHighlights({ selected: null, moves: [], captures: [], lastMove: null });
      } else {
        board.setHighlights({
          selected: selPiece?.pos ?? null,
          moves: sel ? sel.moves.filter((m) => !m.captureId).map((m) => m.to) : [],
          captures: sel ? sel.moves.filter((m) => m.captureId).map((m) => m.to) : [],
          lastMove: snap.lastMove,
          // A tapped enemy shows its reach in red; own pieces keep the white markers.
          tone: selPiece && selPiece.owner === BOT ? 'enemy' : 'own',
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
    const sd = suddenDeathIn(s);
    const sdSoon = sd !== null && sd <= SUDDEN_DEATH_WARN_PLIES;
    stormChip.hidden = snap.phase === 'ended' || (s.stormIn === null && !sdSoon);
    if (s.stormIn !== null) {
      setText(stormText, s.storm > 0 ? `자기장 · 좌우 ${s.storm}줄 소멸 · ${s.stormIn}턴 후 축소` : `자기장 활성 · ${s.stormIn}턴 후 축소`);
      stormChip.classList.toggle('is-soon', s.stormIn <= 2);
    } else if (sdSoon) {
      setText(stormText, `서든데스까지 ${sd}수 · 이후 자기장이 좁혀와요`);
      stormChip.classList.toggle('is-soon', sd <= 2);
    }
    if (s.stormIn !== null && !stormStarted) {
      stormStarted = true;
      // Started by the clock (both sides still have several pieces) rather than by a lone survivor.
      if (s.pieces.filter((p) => p.owner === HUMAN).length > 1 && s.pieces.filter((p) => p.owner === BOT).length > 1 && snap.phase !== 'ended') showSuddenDeath();
    }
    bonusBar.hidden = !(snap.phase === 'humanTurn' && !snap.paused && s.bonusPieceId !== null);
    // HUD
    // Pieces only disappear through captures, so the count is a sufficient change key.
    if (s.pieces.length !== rosterKey) {
      rosterKey = s.pieces.length;
      replaceChildren(topRoster, rosterChips(params.botFormation, BOT, s));
      replaceChildren(bottomRoster, rosterChips(params.playerFormation, HUMAN, s));
    }
    const tp = turnPillContent(snap);
    if (tp.cls !== pillCls) {
      pillCls = tp.cls;
      pill.className = `turn-pill ${tp.cls}`;
    }
    setText(pillText, tp.text);
    const lastEntry = s.history[s.history.length - 1];
    const passing = snap.phase !== 'ended' && lastEntry?.kind === 'pass' && lastEntry.reason === 'noMoves' ? lastEntry.player : null;
    passChip.hidden = passing === null;
    if (passing !== null) setText(passChip, passing === BOT ? '상대 이동 불가 · 내가 연속으로 둬요' : '이동 가능한 말 없음 · 자동 패스');
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
    resignBtn.toggleAttribute('disabled', snap.phase === 'ended');

    const selKey = snap.selection ? `${snap.selection.pieceId}|${snap.selection.actionable}` : null;
    if (selKey !== prevSel) {
      if (snap.selection && snap.phase !== 'animating') {
        if (snap.selection.actionable) {
          sfx('select');
          haptic('light');
          const sp = getPieceById(s, snap.selection.pieceId);
          if (sp) playVoice(sp.character, 'select', { level: sp.level, owner: sp.owner });
        } else sfx('tap');
      }
      prevSel = selKey;
    }

    const selPiece = snap.selection ? getPieceById(s, snap.selection.pieceId) : undefined;
    const showSel = !!selPiece && snap.phase !== 'animating' && snap.phase !== 'ended';
    selChip.hidden = !showSel;
    if (selPiece && showSel) {
      const k = `${selPiece.id}|${selPiece.level}|${snap.selection?.moves.length}|${snap.selection?.actionable}`;
      if (k !== selChipKey) {
        selChipKey = k;
        const sel = snap.selection!;
        const caps = sel.moves.filter((m) => m.captureId).length;
        selChip.className = `sel-chip owner-${selPiece.owner}`;
        replaceChildren(selArt, unitArt(selPiece.character, selPiece.level, { size: 24, owner: selPiece.owner }));
        setText(selName, CHARACTERS[selPiece.character].nameKo);
        setText(selStars, starsOf(selPiece.level));
        setText(
          selHint,
          selPiece.owner === BOT
            ? `상대 · 이동 ${sel.moves.length}칸${caps ? ` · 내 말 ${caps}개 위협` : ''}`
            : sel.actionable
              ? sel.moves.length
                ? `이동 ${sel.moves.length}칸${caps ? ` · 잡기 ${caps}` : ''}`
                : '지금 움직일 수 없어요'
              : `이동 범위 ${sel.moves.length}칸`,
        );
      }
    } else selChipKey = '';
    field.update(s);
  };

  const outcomeOf = (s: GameState): MatchOutcome => (s.winner === null ? 'draw' : s.winner === HUMAN ? 'win' : 'loss');

  const showResult = async (s: GameState) => {
    if (resultShown) return;
    resultShown = true;
    const outcome = outcomeOf(s);
    const humanMoves = s.history.filter((e) => e.kind === 'move' && e.player === HUMAN).length;
    const coinsBefore = getProfile().coins;
    let reward = 0;
    let gemReward = 0;
    updateProfile((p) => {
      const res = applyMatchResult(p, outcome, params.difficulty, humanMoves);
      reward = res.reward;
      gemReward = res.gemReward;
      return res.profile;
    });
    setCoach('');
    field.close();
    await bag.sleep(s.endReason === 'resign' ? 150 : 650);
    if (bag.isDisposed) return;
    clearToasts(); // nothing may sit on top of (or compete with) the result
    const title = outcome === 'win' ? '승리!' : outcome === 'loss' ? '패배' : '무승부';
    const adjudicated = s.endReason === 'timeUp' || s.endReason === 'stalemate' || (s.endReason === 'storm' && s.pieces.length === 0);
    const noReward = reward === 0 && outcome !== 'win' && humanMoves < MIN_MOVES_FOR_REWARD;
    const plus = h('span', { class: 'result__plus' }, '+0');
    const total = h('span', { class: 'result__total-value' }, coinsBefore.toLocaleString('ko-KR'));
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
      outcome === 'loss' && !noReward ? h('p', { class: 'result__cheer' }, '아쉬워요! 진형을 바꿔 다시 도전해 보세요.') : null,
      adjudicated && s.pieces.length > 0 ? h('p', { class: 'result__score' }, `전력  나 ${materialScore(s, HUMAN)} : ${materialScore(s, BOT)} 상대`) : null,
      h(
        'div',
        { class: `result__reward${reward > 0 ? ' has-reward' : ''}`, 'data-reward': reward },
        h('span', null, '보상'),
        icon('coin', 22),
        plus,
        gemReward > 0 ? h('span', { class: 'result__gem' }, icon('gem', 20), `+${gemReward}`) : null,
      ),
      noReward
        ? h('p', { class: 'result__note', 'data-note': 'min-moves' }, icon('info', 16), `${MIN_MOVES_FOR_REWARD}수 이상 둬야 보상을 받아요`)
        : h('p', { class: 'result__total' }, '보유 코인 ', total),
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
    // The winning side's leading survivor has the last word.
    const speaker = outcome === 'draw' ? undefined : heroPieces[0];
    if (speaker) playVoice(speaker.character, 'victory', { level: speaker.level, owner: speaker.owner });
    if (outcome === 'win') {
      sfx('win');
      haptic('win');
      bag.add(confetti());
    } else sfx(outcome === 'loss' ? 'lose' : 'draw');
    if (reward > 0) {
      bag.timeout(() => {
        bag.add(countUp(plus, 0, reward, { prefix: '+', durationMs: 900, onStep: () => sfx('coin') }));
        bag.add(countUp(total, coinsBefore, coinsBefore + reward, { durationMs: 900 }));
      }, 380);
    }
    const choice = await dialog;
    if (bag.isDisposed) return;
    if (choice === 'again') router.navigate('matchmaking', { difficulty: params.difficulty });
    else router.home();
  };

  return {
    el,
    mount() {
      document.body.classList.add('in-game');
      bag.add(() => document.body.classList.remove('in-game'));
      try {
        board = createBoardView(boardHost);
      } catch (e) {
        console.error('board init failed', e);
        replaceChildren(boardHost, h('div', { class: 'board-error' }, '보드를 표시할 수 없습니다.'));
      }
      const b = board;
      bag.add(() => b?.dispose());
      bot = new BotClient();
      const botRef = bot;
      bag.add(() => botRef.dispose());

      const c: GameController = (ctrl = new GameController(initial, {
        requestBotMove: (state) => botRef.requestMove(state, params.difficulty),
        botThinkDelayMs: () => randInt(defaultRng, PACING.botThinkMinMs, PACING.botThinkMaxMs),
        animate: async (move, after) => {
          if (move.pieceId.startsWith(`p${HUMAN}-`)) finishCoach();
          moveFeedbackStart(move, c.state);
          if (b) {
            b.setInteractive(false);
            await b.animateMove(move, after.pieces);
            syncedPieces = after.pieces;
          }
          if (!bag.isDisposed) moveFeedbackEnd(move);
        },
      }));
      bag.add(() => c.dispose());

      board?.setViewMode?.(getProfile().settings.view, false);
      board?.setPieces(initial.pieces);
      syncedPieces = initial.pieces;
      board?.onCellClick((pos: Pos) => c.tapCell(pos));
      board?.onImpact?.((move) => {
        if (!bag.isDisposed) impact(move);
      });
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
          } else if (e.type === 'absorb') {
            const who = e.player === HUMAN ? '내 인세이너가' : '상대 인세이너가';
            toast(`${who} ${CHARACTERS[e.character].nameKo}의 이동 능력을 흡수했어요`, { tone: e.player === HUMAN ? 'success' : 'warn', duration: 2400 });
          } else if (e.type === 'storm') {
            showStormFx(e.killed.length);
            // Pieces swallowed by the storm: their death sound, and one last word from the first.
            const gone = e.lost;
            gone.forEach((p) => playCharSfx(p.character, 'death'));
            if (gone[0]) playVoice(gone[0].character, 'death', { level: gone[0].level, owner: gone[0].owner });
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
      bag.listen(window, 'resize', () => board?.resize());
      bag.listen(window, 'orientationchange', () => board?.resize());

      bag.frameLoop(() => {
        const snap = c.state;
        // Match clock: mm:ss, red in the last minute.
        const mrem = c.matchRemainingMs();
        const msec = Math.ceil(mrem / 1000);
        if (msec !== lastClockSec) {
          lastClockSec = msec;
          setText(counter, `${Math.floor(msec / 60)}:${String(msec % 60).padStart(2, '0')}`);
          counter.classList.toggle('is-warn', msec <= 60 && c.phase !== 'ended');
          counter.setAttribute('aria-label', `남은 대전 시간 ${Math.floor(msec / 60)}분 ${msec % 60}초`);
        }
        const active = c.phase === 'humanTurn' || c.phase === 'botThinking';
        const rem = c.turnRemainingMs();
        topRing.update(active && snap.turn === BOT, rem, c.turnTimeMs, c.paused);
        botRing.update(active && snap.turn === HUMAN, rem, c.turnTimeMs, c.paused);
        // Countdown ticks for the last seconds of the player's own turn.
        if (c.phase === 'humanTurn' && !c.paused) {
          bottomBar.classList.toggle('is-urgent', rem <= PACING.timerWarnMs);
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
          bottomBar.classList.remove('is-urgent');
        }
      });

      if (import.meta.env.DEV) {
        const w = window as unknown as Record<string, unknown>;
        w.__game = { controller: c, board, params };
        bag.add(() => {
          if ((w.__game as { controller?: unknown } | undefined)?.controller === c) delete w.__game;
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
