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
 * Math.random seed. With it the matchmaking screen deterministically builds the opponent
 * "번개 지호" (normal): walk 2성 at (10,8), insaner 2성 at (10,2), sad 3성 at (9,5) (absolute
 * squares; the scripted match below depends on exactly this squad).
 */
export const MATCH_SEED = 1;

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
export async function newPhoneContext(browser, { profile = DEMO_PROFILE, seed = MATCH_SEED, audioLog = false, scale = 2 } = {}) {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: scale, hasTouch: false });
  await ctx.addInitScript(
    ([p, s]) => {
      localStorage.setItem('tactics12.profile', JSON.stringify(p));
      let a = s >>> 0;
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
  skillButton: '[data-action="skill"]',
  skillConfirm: '[data-action="skill-confirm"]',
  cutIn: '.cutin',
  versusFound: '.mm.is-found',
  result: '.result',
  /** A square of the formation editor grid (local row/col of the player's zone). */
  formationCell: (row, col) => `[data-row="${row}"][data-col="${col}"]`,
  collectionCard: (id) => `[data-character="${id}"]`,
};
export const SCREENS = { formation: 'formation', collection: 'collection', matchmaking: 'matchmaking' };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open the app at the lobby and wait until the boot splash is gone. */
export async function openApp(page, base) {
  await page.goto(base + '/');
  await page.waitForSelector(SEL.lobbyScreen);
  await page.waitForFunction((s) => !document.querySelector(s), SEL.bootSplash, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  // One click unlocks the AudioContext (autoplay policy) exactly like a player's first tap.
  await page.mouse.click(2, PHONE_H() - 2).catch(() => {});
  await sleep(300);
}
const PHONE_H = () => PHONE.height;

export async function navigate(page, name, params) {
  await page.evaluate(([n, p]) => (p ? window.__router.navigate(n, p) : window.__router.navigate(n)), [name, params]);
}

/** Wait for the match to be mounted, then load the engine module into the page as window.__E. */
export async function waitForMatch(page) {
  await page.waitForFunction(() => !!window.__game?.controller, null, { timeout: 20000 });
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
export async function waitHumanTurn(page, timeout = 15000) {
  await page.waitForFunction(() => {
    const c = window.__game?.controller;
    return c && (c.phase === 'humanTurn' || c.phase === 'ended');
  }, null, { timeout });
}

export async function waitPhase(page, phase, timeout = 15000) {
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
 * wasteland preview is on screen, `hooks.played` right after the move/skill was committed (used
 * for screenshots).
 */
export async function playStep(page, step, { holdMs = 650, hooks = {} } = {}) {
  await waitHumanTurn(page);
  const ply = await plyOf(page);
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
    await tapCell(page, step.from[0], step.from[1]);
    await sleep(holdMs);
    if (hooks.selected) await hooks.selected();
    await tapCell(page, step.to[0], step.to[1]);
    if (hooks.played) await hooks.played();
  }
  await page.waitForFunction((p) => window.__game.controller.state.ply > p, ply, { timeout: 10000 });
}

/** Expect a piece (by id) at a square, or gone (null). */
export async function expectPiece(page, id, at) {
  const pos = await page.evaluate((i) => window.__game.controller.state.pieces.find((p) => p.id === i)?.pos ?? null, id);
  const ok = at === null ? pos === null : pos && pos.r === at[0] && pos.c === at[1];
  if (!ok) throw new Error(`expected ${id} at ${JSON.stringify(at)}, found ${JSON.stringify(pos)}`);
}

/**
 * Freeze the illustration cut-in (CSS animations of the real `.cutin` element) at `atMs` of its
 * 1250 ms life so a still shows its full-on frame. Must run before the game removes it.
 */
export async function freezeCutIn(page, atMs = 520, timeout = 6000) {
  await page.waitForSelector(SEL.cutIn, { timeout });
  await page.evaluate(([t, sel]) => {
    const el = document.querySelector(sel);
    for (const a of el.getAnimations({ subtree: true })) {
      a.pause();
      a.currentTime = t;
    }
  }, [atMs, SEL.cutIn]);
}
