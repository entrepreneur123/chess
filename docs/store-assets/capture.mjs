// Google Play screenshots: real in-app screens composed into framed, captioned 1080x1920 images.
//
//   node docs/store-assets/capture.mjs
//
// Starts its own Vite DEV server (the DEV-only window.__router / window.__game hooks only exist
// there), plays the scripted demo match from lib/director.mjs and captures each screen at
// 390x780 CSS px, deviceScaleFactor 2 (780x1560). Then docs/store-assets/frame.html composes them.
// Output (docs/store-assets/out/):
//   raw/raw-<key>.png   the untouched in-app captures (780x1560)
//   shot-<n>-<key>.png  the store images (1080x1920), in listing order
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as D from './lib/director.mjs';

const RAW = resolve(D.STORE_OUT, 'raw');
mkdirSync(RAW, { recursive: true });

/** Listing order. `title` may hold <br> and <em> (gold). Keep the sub to one line. */
const SHOTS = [
  {
    key: 'lobby',
    eyebrow: '1:1 전술 보드게임',
    title: '말 <em>3</em>개, <em>144</em>칸<br>한 수의 심리전',
    sub: '12×12 아레나에서 펼치는 1:1 대전',
    art: '/docs/brand/illust/illust-insaner-lv3.jpg',
    accent: 'arcane',
    bg: '/docs/brand/bg/lobby.png',
  },
  {
    key: 'versus',
    eyebrow: 'AI 1:1 대결',
    title: '다섯 캐릭터 중<br><em>셋</em>을 골라 출전',
    sub: '쉬움 · 보통 · 어려움, 원하는 난이도로',
    art: '/docs/brand/illust/illust-brutile-lv3.jpg',
    accent: 'red',
    bg: '/docs/brand/bg/matchmaking.png',
  },
  {
    key: 'board',
    eyebrow: '탭하거나 끌어서 이동',
    title: '탭 한 번으로 이동<br>경로의 <em>적을 잡아라</em>',
    sub: '말마다 다른 이동 범위가 빛나요',
    art: null,
    accent: 'blue',
    bg: '/docs/brand/bg/match.png',
  },
  {
    key: 'walk',
    eyebrow: '월크 · 영웅',
    title: '뛰어넘고 잡는<br><em>기습 점프</em>',
    sub: '사이의 말을 넘어 앞줄 어디든 착지',
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
    key: 'formation',
    eyebrow: '진형 편성',
    title: '<em>진형</em>이 곧 전략',
    sub: '내 구역 3×12 어디든 끌어다 배치',
    art: null,
    accent: 'blue',
    bg: '/docs/brand/bg/lobby.png',
  },
  {
    key: 'collection',
    eyebrow: '상자도 재화도 없음',
    title: '<em>성급</em>은<br>내 마음대로',
    sub: '1성 · 2성 · 3성 모두 처음부터 선택',
    art: '/docs/brand/illust/illust-sad-lv3.jpg',
    accent: 'gold',
    bg: '/docs/brand/bg/lobby.png',
  },
  {
    key: 'victory',
    eyebrow: '승리 조건',
    title: '상대 말 <em>3</em>개를<br>모두 잡으면 <em>승리</em>',
    sub: '40턴이 지나면 자기장이 좁혀와요',
    art: '/docs/brand/illust/illust-marki-lv3.jpg',
    accent: 'gold',
    bg: '/docs/brand/bg/matchmaking.png',
  },
];

const server = await D.startDevServer(5191);
const browser = await D.chromium.launch();
try {
  // ---------------------------------------------------------------- 1. in-app captures
  const ctx = await D.newPhoneContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = async (key) => {
    await page.screenshot({ path: resolve(RAW, `raw-${key}.png`) });
    console.log('captured', key);
  };
  const settle = async () => {
    // Let entrance animations finish; no toast may sit on top of a store screen.
    await D.sleep(1400);
    await page.waitForFunction((t) => !document.querySelector(t), D.SEL.toast, { timeout: 8000 }).catch(() => {});
  };

  await D.openApp(page, server.base);
  await settle();
  await shot('lobby');

  await D.navigate(page, D.SCREENS.formation);
  await settle();
  // Pick up the placed 인세이너 (tap) so its legal drop squares light up, as a player would see it.
  await page.locator(D.SEL.formationCell(1, 6)).first().click();
  await D.sleep(500);
  await shot('formation');

  await D.navigate(page, D.SCREENS.collection);
  await settle();
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), D.SEL.collectionCard('brutile'));
  await D.sleep(600);
  await shot('collection');

  await D.navigate(page, D.SCREENS.matchmaking, { difficulty: 'normal' });
  await page.waitForSelector(D.SEL.versusFound, { timeout: 10000 });
  await D.sleep(800);
  await shot('versus');

  await D.waitForMatch(page);
  await D.scriptBot(page, D.BOT_SCRIPT, 600);
  const [s0, s1, s2, s3, s4, s5] = D.PLAYER_SCRIPT;
  await D.playStep(page, s0);
  await D.playStep(page, s1, { hooks: { selected: () => shot('board') } });
  await D.playStep(page, s2, {
    hooks: {
      played: async () => {
        await D.freezeCutIn(page, 600);
        await shot('walk');
      },
    },
  });
  await D.playStep(page, s3, {
    holdMs: 700,
    hooks: {
      aiming: async () => {
        await page.waitForFunction((t) => !document.querySelector(t), D.SEL.toast, { timeout: 8000 }).catch(() => {});
        await D.sleep(300);
        await shot('brutile');
      },
    },
  });
  await D.playStep(page, s4);
  await D.playStep(page, s5);
  await page.waitForSelector(D.SEL.result, { timeout: 10000 });
  await D.sleep(1600);
  await shot('victory');
  await D.assertBotOk(page);
  await D.expectPiece(page, 'p1-walk', null);
  await D.expectPiece(page, 'p1-insaner', null);
  await D.expectPiece(page, 'p1-sad', null);
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  await ctx.close();

  // ---------------------------------------------------------------- 2. compose
  const frame = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await frame.goto(server.base + '/docs/store-assets/frame.html');
  for (const [i, s] of SHOTS.entries()) {
    const copyBottom = await frame.evaluate((spec) => window.renderShot(spec), { ...s, screen: `/docs/store-assets/out/raw/raw-${s.key}.png?${Date.now()}` });
    if (copyBottom > 470) throw new Error(`caption of ${s.key} runs into the phone (bottom ${copyBottom}px)`);
    const file = resolve(D.STORE_OUT, `shot-${i + 1}-${s.key}.png`);
    await frame.screenshot({ path: file });
    console.log('composed', file, `caption bottom ${Math.round(copyBottom)}px`);
  }
} finally {
  await browser.close();
  server.stop();
}
