// Shared helpers for the store-asset scripts (screenshots and promo video).
//
// Everything here drives the REAL app on a Vite DEV server. The only hooks used are the DEV-only
// `window.__router` (src/main.ts) and `window.__game` (src/ui/screens/game.ts); neither ships in a
// production build. The player's moves are real taps on the board (page.mouse on the square
// rectangles the board reports). The opponent's moves are scripted: the bot port of the live
// GameController is pointed at a fixed list of LEGAL moves (each one is checked with the engine's
// own isLegalMove before it is played), so every frame is the real game rendering real rules.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../../..');
export const STORE_OUT = resolve(here, '../out');

/** Phone viewport used for every in-app capture (CSS px). Captured at deviceScaleFactor 2. */
export const PHONE = { width: 390, height: 780 };

/**
 * Demo profile. Every grade is freely selectable in the app, so this is simply a squad the player
 * could pick. The 7-3 record is seeded so the lobby does not show an empty "0승 0패".
 */
export const DEMO_PROFILE = {
  version: 3,
  grades: { sad: 2, marki: 2, walk: 3, insaner: 3, brutile: 3 },
  formation: [
    { character: 'walk', level: 3, row: 2, col: 4 },
    { character: 'insaner', level: 3, row: 1, col: 6 },
    { character: 'brutile', level: 3, row: 2, col: 8 },
  ],
  formationSaved: true,
  stats: { wins: 7, losses: 3, draws: 0 },
  difficulty: 'normal',
  settings: { sound: true, voice: true, haptics: false, view: 'top' },
  onboarding: { tutorialSeen: true, firstMoveDone: true },
};

/**
 * Math.random seed, applied the moment the matchmaking screen opens (see seedMatchmaking). With it
 * the matchmaking screen deterministically builds the opponent "번개 지호" (normal): walk 2성 at
 * (10,8), insaner 2성 at (10,2), sad 3성 at (9,5) (absolute squares; the scripted match below
 * depends on exactly this squad). Re-seeding at that moment keeps the opponent the same however
 * many random numbers the screens before it used.
 */
export const MATCH_SEED = 87589;

/** Start `vite` (DEV server, so the DEV-only hooks exist). Returns { base, stop }. */
export async function startDevServer(port = 5191) {
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group, so stop() also ends the vite process under npx
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://localhost:${port}`;
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(base + '/');
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > 30000) throw new Error('vite did not start:\n' + log);
    await new Promise((r) => setTimeout(r, 300));
  }
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  };
  return { base, stop };
}

/** Browser context with the demo profile, the seeded Math.random and (optionally) audio logging. */
export async function newPhoneContext(browser, { profile = DEMO_PROFILE, seed = MATCH_SEED, audioLog = false, scale = 2, viewport = PHONE } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: false });
  await ctx.addInitScript(
    ([p, s]) => {
      localStorage.setItem('tactics12.profile', JSON.stringify(p));
      let a = s >>> 0;
      window.__reseed = (k) => (a = k >>> 0);
      Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    [profile, seed],
  );
  if (audioLog) await ctx.addInitScript(installAudioLog);
  return ctx;
}

/**
 * Runs in the page: records every decoded game clip that starts (or is stopped) on the Web Audio
 * graph, with wall-clock times, so the promo soundtrack can be rebuilt from the same files at the
 * same moments. Synthesized UI blips (oscillators) are not clips and are not logged.
 */
function installAudioLog() {
  const log = [];
  window.__audioLog = log;
  const urlBySize = new Map();
  const urlByBuffer = new WeakMap();
  const gainOf = new WeakMap();
  const of = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await of(input, init);
    const url = typeof input === 'string' ? input : input.url;
    if (/\/audio\/(sfx|vo)\//.test(url)) {
      res
        .clone()
        .arrayBuffer()
        .then((b) => urlBySize.set(b.byteLength, url.replace(/^.*\/audio\//, '')))
        .catch(() => {});
    }
    return res;
  };
  const AC = window.AudioContext || window.webkitAudioContext;
  const dec = AC.prototype.decodeAudioData;
  AC.prototype.decodeAudioData = function (data, ok, err) {
    const size = data.byteLength;
    const tag = (buf) => {
      const u = urlBySize.get(size);
      if (u && buf) urlByBuffer.set(buf, u);
      return buf;
    };
    const p = dec.call(this, data, (b) => ok && ok(tag(b)), err);
    return p && p.then ? p.then(tag) : p;
  };
  const conn = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (this instanceof AudioBufferSourceNode && dest instanceof GainNode) gainOf.set(this, dest);
    return conn.call(this, dest, ...rest);
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
    const url = this.buffer && urlByBuffer.get(this.buffer);
    if (url) {
      const lead = Math.max(0, when - this.context.currentTime);
      this.__logEntry = { url, t: Date.now() + lead * 1000, rate: this.playbackRate.value, gain: gainOf.get(this)?.gain.value ?? 1 };
      log.push(this.__logEntry);
    }
    return start.call(this, when, ...rest);
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (when = 0) {
    if (this.__logEntry && this.__logEntry.stop === undefined) {
      this.__logEntry.stop = Date.now() + Math.max(0, when - this.context.currentTime) * 1000;
    }
    return stop.call(this, when);
  };
}

/**
 * Every app selector / screen name the store scripts depend on, in one place. If a UI restructure
 * renames something, fix it here (the scripts fail loudly with a timeout naming the selector).
 */
export const SEL = {
  lobbyScreen: '[data-screen="lobby"]',
  bootSplash: '.boot-splash-out',
  toast: '.toast',
  /** Bottom tab bar buttons (v6): collection (캐릭터), lobby (대전), formation (진형). */
  tab: (name) => `nav.tabbar .tab[data-nav="${name}"]`,
  difficulty: (d) => `.seg__btn[data-difficulty="${d}"]`,
  startMatch: '[data-action="start-match"]',
  /** In-game hand card of one of my pieces (piece id, e.g. "p0-walk"). */
  handCard: (pieceId) => `.hand-card[data-action="hand-card"][data-piece="${pieceId}"]`,
  skillButton: '[data-action="skill"]',
  skillConfirm: '[data-action="skill-confirm"]',
  cutIn: '.cutin',
  versusFound: '.mm.is-found',
  result: '.result',
  /** A square of the formation editor grid (local row/col of the player's zone). */
  formationCell: (row, col) => `[data-row="${row}"][data-col="${col}"]`,
  collectionCard: (id) => `[data-character="${id}"]`,
};

/**
 * Real-time multiplier for every wait in this module. The promo recorder slows the page clock down
 * (installTimeWarp) and calls setTimeScale() with the same factor, so the scripted pauses keep
 * their on-screen (virtual) length.
 */
let SLOW = 1;
export function setTimeScale(scale) {
  SLOW = 1 / scale;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SLOW));

/**
 * Slow the page's clock to `scale` x real time: Date, performance.now, requestAnimationFrame
 * timestamps and setTimeout/setInterval delays (CSS/Web Animations are slowed separately through
 * CDP Animation.setPlaybackRate). Software WebGL renders the board at ~13 fps in real time; at
 * 0.2x the recorder gets ~30 frames per virtual second. window.__warp = { scale, d0 } lets the
 * recorder map page (virtual) times back to wall-clock time: real = d0 + (virtual - d0) / scale.
 */
export async function installTimeWarp(ctx, scale) {
  await ctx.addInitScript((S) => {
    const rNow = performance.now.bind(performance);
    const t0 = rNow();
    const vnow = () => t0 + (rNow() - t0) * S;
    performance.now = vnow;
    const RD = Date;
    const d0 = RD.now();
    const vd = () => d0 + (RD.now() - d0) * S;
    class VDate extends RD {
      constructor(...a) {
        if (a.length) super(...a);
        else super(vd());
      }
      static now() {
        return vd();
      }
    }
    window.Date = VDate;
    const rRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => rRaf(() => cb(vnow()));
    const rST = window.setTimeout.bind(window);
    const rSI = window.setInterval.bind(window);
    window.setTimeout = (fn, ms, ...a) => rST(fn, (ms || 0) / S, ...a);
    window.setInterval = (fn, ms, ...a) => rSI(fn, (ms || 0) / S, ...a);
    window.__warp = { scale: S, d0 };
  }, scale);
}

/** Open the app at the lobby and wait until the boot splash is gone. */
export async function openApp(page, base) {
  await page.goto(base + '/');
  await page.waitForSelector(SEL.lobbyScreen);
  await page.waitForFunction((s) => !document.querySelector(s), SEL.bootSplash, { timeout: 8000 * SLOW }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  // A key press is a user gesture: it unlocks the AudioContext (autoplay policy) like a player's
  // first tap, without hitting any control (the tab bar now spans the bottom edge).
  await page.keyboard.press('Shift');
  await sleep(300);
}

export async function navigate(page, name, params) {
  await page.evaluate(([n, p]) => (p ? window.__router.navigate(n, p) : window.__router.navigate(n)), [name, params]);
}

/** Switch top-level screens the way a player does: tap the bottom tab bar. */
export async function tapTab(page, name) {
  await page.click(SEL.tab(name));
  await page.waitForSelector(`[data-screen="${name}"]`);
}

/** From the lobby: pick the difficulty on the segmented control, then tap the gold 대전 시작. */
export async function startMatch(page, difficulty = 'normal') {
  await page.click(SEL.difficulty(difficulty));
  await sleep(250);
  await page.click(SEL.startMatch);
  await page.waitForSelector('[data-screen="matchmaking"]');
}

/**
 * Make the next matchmaking screen deterministic: re-seed Math.random right when the router opens
 * it (whether by the 대전 시작 tap or by navigate()). Call once after openApp().
 */
export async function seedMatchmaking(page, seed = MATCH_SEED) {
  await page.evaluate((k) => {
    const r = window.__router;
    const nav = r.navigate.bind(r);
    r.navigate = (name, ...rest) => {
      if (name === 'matchmaking') window.__reseed(k);
      return nav(name, ...rest);
    };
  }, seed);
}

/** Wait for the match to be mounted, then load the engine module into the page as window.__E. */
export async function waitForMatch(page) {
  await page.waitForFunction(() => !!window.__game?.controller, null, { timeout: 20000 * SLOW });
  await page.evaluate(async () => {
    window.__E = await import('/src/engine/index.ts');
  });
}

/**
 * Point the live controller's bot port at a fixed list of moves ([from, to] absolute squares).
 * Each is resolved against the engine's legal moves at that moment; an illegal entry throws in the
 * page (and the controller then falls back to its own safe move, which the caller's checks catch).
 */
export async function scriptBot(page, moves, thinkMs = 650) {
  await page.evaluate(
    ([list, think]) => {
      const c = window.__game.controller;
      const E = window.__E;
      const queue = list.slice();
      window.__botErrors = [];
      c.ports.botThinkDelayMs = () => think;
      c.ports.requestBotMove = async (s) => {
        // holdBot()/releaseBot(): keep the opponent "thinking" while a still is taken.
        while (window.__botHold) await new Promise((r) => setTimeout(r, 40));
        const next = queue.shift();
        if (!next) {
          window.__botErrors.push('bot queue empty');
          return null;
        }
        const [from, to] = next;
        const piece = E.getPieceAt(s, { r: from[0], c: from[1] });
        const move = piece && E.getLegalMoves(s, piece.id).find((m) => m.to.r === to[0] && m.to.c === to[1]);
        if (!move || !E.isLegalMove(s, move)) {
          window.__botErrors.push(`illegal bot move ${from} -> ${to}`);
          return null;
        }
        return move;
      };
    },
    [moves, thinkMs],
  );
}

/** Keep the scripted opponent from answering until releaseBot() (its turn clock keeps running). */
export const holdBot = (page) => page.evaluate(() => (window.__botHold = true));
export const releaseBot = (page) => page.evaluate(() => (window.__botHold = false));

/** Viewport-centre of a board square (CSS px). */
export async function cellCenter(page, r, c) {
  const rect = await page.evaluate(([r, c]) => window.__game.board.cellRect({ r, c }), [r, c]);
  if (!rect) throw new Error(`no cell rect for ${r},${c}`);
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export async function tapCell(page, r, c) {
  const p = await cellCenter(page, r, c);
  await page.mouse.click(p.x, p.y);
}

/** Wait until it is the player's turn again (or the match ended). */
export async function waitHumanTurn(page, timeout = 15000 * SLOW) {
  await page.waitForFunction(() => {
    const c = window.__game?.controller;
    return c && (c.phase === 'humanTurn' || c.phase === 'ended');
  }, null, { timeout });
}

export async function waitPhase(page, phase, timeout = 15000 * SLOW) {
  await page.waitForFunction((ph) => window.__game?.controller?.phase === ph, phase, { timeout });
}

/** Ply count of the live match. */
export const plyOf = (page) => page.evaluate(() => window.__game.controller.state.ply);

/** Throws if the scripted bot hit an illegal entry. */
export async function assertBotOk(page) {
  const errs = await page.evaluate(() => window.__botErrors ?? []);
  if (errs.length) throw new Error('scripted bot: ' + errs.join('; '));
}

/**
 * The scripted demo match against the seeded opponent (see MATCH_SEED). Absolute squares, row 0 =
 * the player's back rank (bottom of the screen). All moves were verified legal by the engine.
 *   ply 0  P  월크 (2,4) -> (3,1)
 *   ply 1  B  사드 (9,5) -> (6,5)
 *   ply 2  P  인세이너 (1,6) -> (4,3)
 *   ply 3  B  사드 (6,5) -> (4,5)            steps into the jump row of 월크
 *   ply 4  P  월크 (3,1) -> (4,5)  capture   leaps over my 인세이너 at (4,3): jump capture + cut-in
 *   ply 5  B  월크 (10,8) -> (9,7)
 *   ply 6  P  브루타일 불모지 3x3, centre (7,7) (rows 6-8, cols 6-8)
 *   ply 7  B  월크 (9,7) -> (8,7)            lands on the wasteland and dissolves; storm starts
 *   ply 8  P  인세이너 (4,3) -> (7,3)
 *   ply 9  B  인세이너 (10,2) -> (10,3)       lines up with my 인세이너
 *   ply 10 P  인세이너 (7,3) -> (10,3) capture  last enemy piece: victory
 */
export const PLAYER_SCRIPT = [
  { from: [2, 4], to: [3, 1] },
  { from: [1, 6], to: [4, 3] },
  { from: [3, 1], to: [4, 5] },
  { skill: [2, 8], at: [7, 7] },
  { from: [4, 3], to: [7, 3] },
  { from: [7, 3], to: [10, 3] },
];
export const BOT_SCRIPT = [
  [[9, 5], [6, 5]],
  [[6, 5], [4, 5]],
  [[10, 8], [9, 7]],
  [[9, 7], [8, 7]],
  [[10, 2], [10, 3]],
];

/**
 * Play one PLAYER_SCRIPT step through the real UI: tap the piece (its reach shows), hold, tap the
 * destination. For the skill step: tap Brutile, press the skill button, tap the area centre (the
 * preview shows), then press 설치. `hooks.selected` / `hooks.aiming` run while the reach / the
 * wasteland preview is on screen, `hooks.begin` once it is the player's turn (before any tap),
 * `hooks.played` right after the move/skill was committed (used
 * for screenshots).
 */
export async function playStep(page, step, { holdMs = 650, hooks = {} } = {}) {
  // `step.viaHand` (a piece id) selects the piece by tapping its hand card instead of the board.
  await waitHumanTurn(page);
  const ply = await plyOf(page);
  if (hooks.begin) await hooks.begin();
  if (step.skill) {
    await tapCell(page, step.skill[0], step.skill[1]);
    await sleep(holdMs);
    await page.click(SEL.skillButton);
    await sleep(Math.round(holdMs * 0.6));
    await tapCell(page, step.at[0], step.at[1]);
    await sleep(holdMs);
    if (hooks.aiming) await hooks.aiming();
    await page.click(SEL.skillConfirm);
    if (hooks.played) await hooks.played();
  } else {
    if (step.viaHand) await page.click(SEL.handCard(step.viaHand));
    else await tapCell(page, step.from[0], step.from[1]);
    await sleep(holdMs);
    if (hooks.selected) await hooks.selected();
    await tapCell(page, step.to[0], step.to[1]);
    if (hooks.played) await hooks.played();
  }
  await page.waitForFunction((p) => window.__game.controller.state.ply > p, ply, { timeout: 10000 * SLOW });
}

/** Expect a piece (by id) at a square, or gone (null). */
export async function expectPiece(page, id, at) {
  const pos = await page.evaluate((i) => window.__game.controller.state.pieces.find((p) => p.id === i)?.pos ?? null, id);
  const ok = at === null ? pos === null : pos && pos.r === at[0] && pos.c === at[1];
  if (!ok) throw new Error(`expected ${id} at ${JSON.stringify(at)}, found ${JSON.stringify(pos)}`);
}

/**
 * Freeze the next illustration cut-in (CSS animations of the real `.cutin` element) at `atMs` of
 * its 1250 ms life so a still shows its full-on frame. Call BEFORE the move that triggers it: a
 * MutationObserver freezes the element the moment the game adds it, so a slow (software WebGL)
 * frame rate cannot make the capture miss the window. The game removes the element with a timer;
 * that one remove() is deferred until releaseCutIn(). Then await cutInFrozen() and take the still.
 */
export async function armCutInFreeze(page, atMs = 620) {
  await page.evaluate(([t, sel]) => {
    window.__frozenCutIn = null;
    const mo = new MutationObserver(() => {
      const el = document.querySelector(sel);
      if (!el) return;
      mo.disconnect();
      for (const a of el.getAnimations({ subtree: true })) {
        a.pause();
        a.currentTime = t;
      }
      el.remove = () => (el.__removeDeferred = true);
      window.__frozenCutIn = el;
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }, [atMs, SEL.cutIn]);
}

export async function cutInFrozen(page, timeout = 10000 * SLOW) {
  await page.waitForFunction(() => !!window.__frozenCutIn, null, { timeout });
  // Let the frozen frame (and the cut-in art) paint.
  await page.evaluate(() => window.__frozenCutIn.querySelector('img')?.decode().catch(() => {}));
  await sleep(150);
}

/** Undo armCutInFreeze(): resume the animations and let the game's pending remove() happen. */
export async function releaseCutIn(page) {
  await page.evaluate(() => {
    const el = window.__frozenCutIn;
    if (!el) return;
    window.__frozenCutIn = null;
    delete el.remove;
    if (el.__removeDeferred) el.remove();
    else for (const a of el.getAnimations({ subtree: true })) a.play();
  });
}
