// Live smoke flow (Playwright, pre-installed Chromium): tutorial -> tabs -> match -> resign -> result.
// Usage: node scripts/e2e-flow.cjs <baseUrl> <width> <height> <tag>   (expects "errors []")
const { chromium } = require('playwright');
const B = process.argv[2] || 'http://localhost:5196';
const W = +(process.argv[3] || 390), H = +(process.argv[4] || 844), tag = process.argv[5] || 'm';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e)); p.on('console', m => m.type()==='error' && errs.push('CON ' + m.text()));
  const shot = (n) => p.screenshot({ path: `/tmp/e2e-${tag}-${n}.png` });
  await p.goto(B + '/'); await p.waitForTimeout(1500);
  await shot('01-tutorial');
  await p.click('[data-action="tut-skip"]'); await p.waitForTimeout(500); await shot('02-lobby');
  await p.click('[data-nav="collection"]'); await p.waitForTimeout(700); await shot('03-collection');
  await p.evaluate(() => document.querySelector('.scroll-body').scrollTo(0, 700)); await p.waitForTimeout(300); await shot('03b-collection');
  await p.goBack(); await p.waitForTimeout(600);
  await p.click('[data-nav="formation"]'); await p.waitForTimeout(700); await shot('04-formation');
  await p.goBack(); await p.waitForTimeout(600);
  // shop removed (no economy)
  await p.click('[data-action="settings"]'); await p.waitForTimeout(500); await shot('06-settings');
  await p.mouse.click(W/2, 80); await p.waitForTimeout(500);
  await p.click('[data-action="start-match"]'); await p.waitForTimeout(1600); await shot('07-matching');
  await p.waitForTimeout(3000); await shot('08-game');
  await p.click('button[aria-label="기권"]').catch(()=>{}); await p.waitForTimeout(500); await shot('09-resign');
  const c = await p.$('.dialog button:has-text("기권")'); if (c) await c.click();
  await p.waitForTimeout(900); await shot('10-result');
  console.log('errors', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
