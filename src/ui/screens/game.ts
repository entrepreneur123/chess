import { BotClient } from '../../ai/botClient';
import { createGame, getPieceById, materialScore, type GameState, type Piece, type Pos } from '../../engine';
import { createBoardView, type IBoardView } from '../../render';
import { PACING } from '../../meta/economy';
import { DIFFICULTY_LABEL } from '../../meta/opponent';
import { applyMatchResult, updateProfile, type MatchOutcome } from '../../meta/profile';
import { randInt, defaultRng } from '../../meta/rng';
import { confirmDialog, showDialog } from '../components/dialog';
import { toast } from '../components/toast';
import { Disposables, h, replaceChildren } from '../dom';
import { icon } from '../icons';
import type { Router, Screen } from '../router';
import { BOT, GameController, HUMAN, type ControllerSnapshot } from '../game/GameController';
import { endReasonText, pieceInfoCard, rosterChips, setText, TimerRing, turnPillContent } from '../game/hud';
import type { GameParams } from './gameParams';

export function gameScreen(router: Router, params: GameParams): Screen {
  const bag = new Disposables();
  const initial = createGame(params.playerFormation, params.botFormation, HUMAN);

  // ---------- static DOM
  const topRing = new TimerRing(BOT);
  const botRing = new TimerRing(HUMAN);
  const topRoster = h('div', { class: 'pbar__roster-host' });
  const bottomRoster = h('div', { class: 'pbar__roster-host' });
  const pill = h('div', { class: 'turn-pill', role: 'status', 'aria-live': 'polite' });
  const counter = h('div', { class: 'ply-counter', 'aria-label': '잡기 없는 수' });
  const infoHost = h('div', { class: 'info-host' });
  const boardHost = h('div', { class: 'board-host', 'aria-label': '게임 보드' });

  const topBar = h(
    'header',
    { class: 'pbar pbar--top' },
    h('span', { class: 'avatar avatar--red' }, icon('bot', 22)),
    h(
      'div',
      { class: 'pbar__info' },
      h('div', { class: 'pbar__name' }, params.opponentName),
      h('div', { class: 'pbar__meta' }, `AI · ${DIFFICULTY_LABEL[params.difficulty]}`),
    ),
    topRoster,
    topRing.el,
  );
  const resignBtn = h(
    'button',
    { class: 'icon-btn icon-btn--outlined', type: 'button', 'aria-label': '기권', 'data-action': 'resign', onclick: () => void askResign() },
    icon('flag', 20),
  );
  const bottomBar = h(
    'footer',
    { class: 'pbar pbar--bottom' },
    h('span', { class: 'avatar avatar--blue' }, icon('person', 22)),
    h('div', { class: 'pbar__info' }, h('div', { class: 'pbar__name' }, '나'), h('div', { class: 'pbar__meta' }, '블루 · 아래쪽')),
    bottomRoster,
    botRing.el,
    resignBtn,
  );
  const el = h(
    'main',
    { class: 'game no-select' },
    topBar,
    h('div', { class: 'board-wrap' }, boardHost, h('div', { class: 'board-overlay' }, pill, counter), infoHost),
    bottomBar,
  );

  // ---------- runtime objects (created on mount)
  let board: IBoardView | null = null;
  let bot: BotClient | null = null;
  let ctrl: GameController | null = null;
  let syncedPieces: Piece[] | null = null;
  let resultShown = false;

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
        });
      }
      board.setInteractive(snap.phase !== 'animating' && snap.phase !== 'ended' && !snap.paused);
    }
    // HUD
    replaceChildren(topRoster, rosterChips(params.botFormation, BOT, s));
    replaceChildren(bottomRoster, rosterChips(params.playerFormation, HUMAN, s));
    const tp = turnPillContent(snap);
    pill.className = `turn-pill ${tp.cls}`;
    replaceChildren(pill, h('span', { class: 'turn-pill__dot', 'aria-hidden': 'true' }), tp.text);
    setText(counter, `잡기 없이 ${s.pliesSinceCapture}/60`);
    counter.classList.toggle('is-warn', s.pliesSinceCapture >= 50);
    const activeTurn = snap.phase === 'ended' ? null : s.turn;
    topBar.classList.toggle('is-turn', activeTurn === BOT);
    bottomBar.classList.toggle('is-turn', activeTurn === HUMAN);
    resignBtn.toggleAttribute('disabled', snap.phase === 'ended');

    const selPiece = snap.selection ? getPieceById(s, snap.selection.pieceId) : undefined;
    const current = infoHost.firstElementChild as HTMLElement | null;
    if (selPiece && snap.phase !== 'animating') {
      replaceChildren(infoHost, pieceInfoCard(selPiece, snap, () => ctrl?.clearSelection()));
      if (!current) infoHost.firstElementChild?.classList.add('is-entering');
    } else if (current) {
      replaceChildren(infoHost);
    }
  };

  const outcomeOf = (s: GameState): MatchOutcome => (s.winner === null ? 'draw' : s.winner === HUMAN ? 'win' : 'loss');

  const showResult = async (s: GameState) => {
    if (resultShown) return;
    resultShown = true;
    const outcome = outcomeOf(s);
    let reward = 0;
    updateProfile((p) => {
      const humanMoves = s.history.filter((e) => e.kind === 'move' && e.player === HUMAN).length;
      const res = applyMatchResult(p, outcome, params.difficulty, humanMoves);
      reward = res.reward;
      return res.profile;
    });
    await bag.sleep(s.endReason === 'resign' ? 150 : 650);
    if (bag.isDisposed) return;
    const title = outcome === 'win' ? '승리!' : outcome === 'loss' ? '패배' : '무승부';
    const adjudicated = s.endReason === 'moveLimit' || s.endReason === 'stalemate';
    const choice = await showDialog<'again' | 'lobby'>({
      title,
      className: `result result--${outcome}`,
      icon: h('span', { class: `result__icon result__icon--${outcome}` }, icon(outcome === 'win' ? 'trophy' : outcome === 'loss' ? 'flag' : 'info', 36)),
      body: h(
        'div',
        { class: 'result__body' },
        h('p', { class: 'result__reason', 'data-reason': s.endReason ?? '' }, endReasonText(s.endReason, outcome)),
        adjudicated
          ? h('p', { class: 'result__score' }, `전력  나 ${materialScore(s, HUMAN)} : ${materialScore(s, BOT)} 상대`)
          : null,
        h('div', { class: 'result__reward', 'data-reward': reward }, h('span', null, '보상'), icon('coin', 20), h('span', { class: 'result__plus' }, `+${reward}`)),
      ),
      dismissValue: 'lobby',
      actions: [
        { label: '로비', value: 'lobby', variant: 'text' },
        { label: '다시 하기', value: 'again', variant: 'filled' },
      ],
    });
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

      ctrl = new GameController(initial, {
        requestBotMove: (state) => botRef.requestMove(state, params.difficulty),
        botThinkDelayMs: () => randInt(defaultRng, PACING.botThinkMinMs, PACING.botThinkMaxMs),
        animate: async (move, after) => {
          if (!b) return;
          b.setInteractive(false);
          await b.animateMove(move, after.pieces);
          syncedPieces = after.pieces;
        },
      });
      const c = ctrl;
      bag.add(() => c.dispose());

      board?.setPieces(initial.pieces);
      syncedPieces = initial.pieces;
      board?.onCellClick((pos: Pos) => c.tapCell(pos));

      bag.add(
        c.on((e) => {
          if (e.type === 'change') renderSnapshot(c.snapshot());
          else if (e.type === 'toast') toast(e.message, { tone: e.tone === 'warn' ? 'warn' : 'neutral' });
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
        const active = c.phase === 'humanTurn' || c.phase === 'botThinking';
        const rem = c.turnRemainingMs();
        topRing.update(active && snap.turn === BOT, rem, c.turnTimeMs, c.paused);
        botRing.update(active && snap.turn === HUMAN, rem, c.turnTimeMs, c.paused);
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
    dispose: () => bag.dispose(),
  };
}
