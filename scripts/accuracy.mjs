// Fires perfect shots through the real game loop and logs each outcome.
// Usage: node scripts/accuracy.mjs [url] [stageId]
import { chromium } from 'playwright-core';
import { homedir } from 'node:os';

const url = process.argv[2] ?? 'http://localhost:5173/';
const stageId = process.argv[3] ?? 'rooftop';
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url);
await page.evaluate(() => {
  localStorage.setItem('skyhoops.profile.v1', JSON.stringify({ name: 'Bot', color: '#ff3d7f', avatar: '🦄' }));
  localStorage.setItem('skyhoops.quality', 'low');
});
await page.reload();
await page.waitForFunction(() => !!window.skyhoops);
await page.evaluate((id) => {
  const g = window.skyhoops;
  const log = (window.__shots = []);
  const ev = g.events;
  const onScore = ev.onScore;
  const onShotEnd = ev.onShotEnd;
  ev.onScore = (e) => (log.push({ score: e }), onScore?.(e));
  ev.onShotEnd = (made) => (log.push({ end: made, rimTouch: g.touchedRim, board: g.touchedBoard, dist: g.shotDistance }), onShotEnd?.(made));
  void id;
}, stageId);
await page.waitForTimeout(4000);
await page.click('[data-action="tour"]');
await page.waitForTimeout(2500);
const idx = ['rooftop', 'lantern', 'cliffs', 'island', 'moon', 'portal', 'storm'].indexOf(stageId);
await page.locator('.stage-card').nth(idx).click();
await page.waitForTimeout(3000);
await page.click('[data-action="intro-play"]');

for (let i = 0; i < 10; i++) {
  const ph = await page.waitForFunction(() => ['ready', 'done'].includes(window.skyhoops.phase) && window.skyhoops.phase, null, { timeout: 180000 });
  if ((await ph.jsonValue()) === 'done') break;
  const info = await page.evaluate(() => {
    const g = window.skyhoops;
    const ctx = g.aimContext();
    const d = Math.hypot(ctx.ideal.x - ctx.from.x, ctx.ideal.z - ctx.from.z);
    const h = ctx.ideal.y - ctx.from.y;
    const a = (60 * Math.PI) / 180;
    const v2 = (ctx.g * d * d) / (2 * Math.cos(a) ** 2 * (d * Math.tan(a) - h));
    const reach = (v2 * Math.sin(2 * a)) / 9.81;
    g.shoot({ dx: 0, dy: (reach / 11) * 0.55, curve: 0 });
    return { d: +d.toFixed(2), h: +h.toFixed(2), from: ctx.from, ideal: ctx.ideal, release: g.release, wind: g.setup.wind };
  });
  console.log(`shot ${i}`, JSON.stringify(info));
  await page.waitForFunction(() => window.skyhoops.phase !== 'flight', null, { timeout: 180000 });
  console.log('  ->', JSON.stringify(await page.evaluate(() => window.__shots.splice(0))));
}
await browser.close();
