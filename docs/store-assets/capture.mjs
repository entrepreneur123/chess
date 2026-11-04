// GRID CLASH store assets: ONE command regenerates everything.
//
//   node docs/store-assets/capture.mjs                    # screenshots + feature graphic + promo videos
//   node docs/store-assets/capture.mjs shots feature      # any subset of: shots, feature, video
//
// Needs: Playwright + Chromium (require('playwright')), ffmpeg/ffprobe on PATH (libx264, aac,
// loudnorm, ebur128). No network. Takes about 8 minutes on 4 cores (the video is recorded at 0.2x speed).
//
// It starts its own Vite DEV server on port 5191 (the DEV-only window.__router / window.__game
// hooks exist only there) and drives the REAL app with lib/director.mjs: a seeded demo profile,
// real taps on the tab bar, lobby, hand cards and board, and a scripted, engine-checked opponent.
//
// Outputs (committed):
//   docs/store-assets/out/shot-<n>-<key>.png       Google Play screenshots, 1080x1920
//   docs/brand/out/feature-graphic-1024x500.png    Google Play feature graphic
//   docs/store-assets/out/promo-9x16.mp4           1080x1920 promo, H.264 + AAC, faststart
//   docs/store-assets/out/promo-16x9.mp4           1920x1080 promo (YouTube), H.264 + AAC, faststart
// Intermediates (gitignored): docs/store-assets/out/raw/
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import * as D from './lib/director.mjs';
import { renderFeatureGraphic } from './lib/feature.mjs';
import { makePromoVideos } from './lib/video.mjs';

const RAW = resolve(D.STORE_OUT, 'raw');
mkdirSync(RAW, { recursive: true });

const STAGES = ['shots', 'feature', 'video'];
const asked = process.argv.slice(2).filter((a) => STAGES.includes(a));
const run = new Set(asked.length ? asked : STAGES);

/**
 * Listing order (keep docs/store-listing.md in sync). `title` may hold <br> and <em> (gold).
 * Keep the sub to one line. Every claim matches today's rules (README.md).
 */
export const SHOTS = [
  {
    key: 'lobby',
    eyebrow: '1:1 전술 보드게임',
    title: '말 <em>3</em>개, <em>100</em>칸<br>한 수의 심리전',
    sub: '10×10 아레나에서 펼치는 1:1 대전',
    art: '/docs/brand/illust/illust-insaner-lv3.jpg',
    accent: 'arcane',
    bg: '/docs/brand/bg/lobby.png',
  },
  {
    key: 'board',
    eyebrow: '카드나 말을 탭',
    title: '탭 한 번에<br><em>이동 범위</em>가 한눈에',
    sub: '말마다 다른 움직임 · 끌어서 이동도 가능',
    art: null,
    accent: 'blue',
    bg: '/docs/brand/bg/match.png',
  },
  {
    key: 'walk',
    eyebrow: '월크 · 영웅',
    title: '뛰어넘어 잡는<br><em>기습 점프</em>',
    sub: '사이의 말을 넘어 앞줄로 착지',
    art: '/docs/brand/illust/illust-walk-lv3.jpg',
    accent: 'arcane',
    bg: '/docs/brand/bg/match.png',
  },
  {
    key: 'brutile',
    eyebrow: '브루타일 · 전설',
    title: '닿으면 소멸<br><em>땅을 저주하라</em>',
    sub: '스킬 불모지 · 아군이든 적이든 소멸',
    art: '/docs/brand/illust/illust-brutile-lv3.jpg',
    accent: 'toxic',
    bg: '/docs/brand/bg/match.png',
  },
  {
    key: 'storm',
    eyebrow: '서든데스',
    title: '<em>자기장</em>이<br>좁혀온다',
    sub: '40턴이 지나거나 말이 1개만 남으면 발동',
    art: null,
    accent: 'arcane',
    bg: '/docs/brand/bg/match.png',
  },
  {
    key: 'formation',
    eyebrow: '진형 편성',
    title: '<em>진형</em>이 곧 전략',
    sub: '내 구역 2×10 어디든 배치',
    art: null,
    accent: 'blue',
    bg: '/docs/brand/bg/lobby.png',
  },
  {
    key: 'collection',
    eyebrow: '토큰으로 강화',
    title: '<em>성급</em>을<br>끌어올려라',
    sub: '던전 토큰으로 1성 → 2성 → 3성',
    art: '/docs/brand/illust/illust-sad-lv3.jpg',
    artSide: 'right',
    accent: 'gold',
    bg: '/docs/brand/bg/lobby.png',
  },
  {
    key: 'victory',
    eyebrow: '한 수 45초',
    title: '상대 말을 모두<br>잡으면 <em>승리</em>',
    sub: '시간을 넘기면 즉시 몰수패',
    art: '/docs/brand/illust/illust-marki-lv3.jpg',
    accent: 'gold',
    bg: '/docs/brand/bg/matchmaking.png',
  },
];

/** Play the demo match through the real UI and save every raw still (raw/raw-<key>.png). */
async function captureRaw(browser, base) {
  const ctx = await D.newPhoneContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = async (key) => {
    await page.screenshot({ path: resolve(RAW, `raw-${key}.png`) });
    console.log('captured', key);
  };
  const noToast = () => page.waitForFunction((t) => !document.querySelector(t), D.SEL.toast, { timeout: 8000 }).catch(() => {});
  const settle = async () => {
    // Let entrance animations finish; no toast may sit on top of a store screen.
    await D.sleep(1400);
    await noToast();
  };

  await D.openApp(page, base);
  await D.seedMatchmaking(page);
  await settle();
  await shot('lobby');

  // Tab bar: 진형 (formation). Pick up the placed 인세이너 so its legal drop squares light up.
  await D.tapTab(page, 'formation');
  await settle();
  await page.locator(D.SEL.formationCell(1, 6)).first().click();
  await D.sleep(500);
  await shot('formation');

  // Tab bar: 캐릭터 (collection), scrolled to Brutile's grade picker.
  await D.tapTab(page, 'collection');
  await settle();
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), D.SEL.collectionCard('brutile'));
  await D.sleep(600);
  await shot('collection');

  // Tab bar: 대전 (lobby), then 보통 + 대전 시작.
  await D.tapTab(page, 'lobby');
  await D.sleep(600);
  await D.startMatch(page, 'normal');
  await page.waitForSelector(D.SEL.versusFound, { timeout: 10000 });
  await D.sleep(800);
  await shot('versus');

  await D.waitForMatch(page);
  await D.scriptBot(page, D.BOT_SCRIPT, 600);
  const [s0, s1, s2, s3, s4, s5] = D.PLAYER_SCRIPT;
  await D.playStep(page, s0);
  // 인세이너 picked from the hand (its card lights up, its reach shows on the board).
  await D.playStep(page, { ...s1, viaHand: 'p0-insaner' }, { hooks: { selected: () => shot('board') } });
  // 월크's jump capture: hold the opponent and freeze the real cut-in at its full-on frame.
  await D.playStep(page, s2, {
    hooks: {
      selected: async () => {
        await shot('walk-aim'); // alternative still: 월크's jump row with the capture ring
        await D.holdBot(page);
        await D.armCutInFreeze(page, 620);
      },
      played: async () => {
        await D.cutInFrozen(page);
        await shot('walk');
        await D.releaseCutIn(page);
        await D.releaseBot(page);
      },
    },
  });
  await D.playStep(page, s3, {
    holdMs: 700,
    hooks: {
      aiming: async () => {
        await noToast();
        await D.sleep(300);
        await shot('brutile');
      },
    },
  });
  await D.playStep(page, s4);
  // Storm is on (the opponent is down to one piece): 인세이너 lines up the last capture.
  await D.playStep(page, s5, {
    hooks: {
      selected: async () => {
        await noToast();
        await shot('storm');
      },
    },
  });
  await page.waitForSelector(D.SEL.result, { timeout: 10000 });
  await D.sleep(1800); // the result card is in, some confetti still falling
  await shot('victory');
  await D.assertBotOk(page);
  await D.expectPiece(page, 'p1-walk', null);
  await D.expectPiece(page, 'p1-insaner', null);
  await D.expectPiece(page, 'p1-sad', null);
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  await ctx.close();
}

/** Compose the framed, captioned store images from the raw stills. */
async function compose(browser, base) {
  // Drop store images from an older shot list so out/ holds exactly the current set.
  for (const f of readdirSync(D.STORE_OUT)) if (/^shot-\d+-.*\.png$/.test(f)) rmSync(resolve(D.STORE_OUT, f));
  const frame = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await frame.goto(base + '/docs/store-assets/frame.html');
  for (const [i, s] of SHOTS.entries()) {
    const copyBottom = await frame.evaluate((spec) => window.renderShot(spec), { ...s, screen: `/docs/store-assets/out/raw/raw-${s.key}.png?${Date.now()}` });
    if (copyBottom > 470) throw new Error(`caption of ${s.key} runs into the phone (bottom ${copyBottom}px)`);
    const file = resolve(D.STORE_OUT, `shot-${i + 1}-${s.key}.png`);
    await frame.screenshot({ path: file });
    console.log('composed', file, `caption bottom ${Math.round(copyBottom)}px`);
  }
  await frame.close();
}

const server = await D.startDevServer(5191);
const browser = await D.chromium.launch();
try {
  if (run.has('shots')) {
    await captureRaw(browser, server.base);
    await compose(browser, server.base);
  }
  if (run.has('feature')) await renderFeatureGraphic(browser, server.base);
  if (run.has('video')) await makePromoVideos(browser, server.base);
} finally {
  await browser.close();
  server.stop();
}
