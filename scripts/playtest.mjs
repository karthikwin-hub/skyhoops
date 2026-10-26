// Headless play-test: boots the game, walks through the menus, takes shots and saves screenshots.
// Usage: node scripts/playtest.mjs [url] [stageId] [--mobile]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const url = process.argv[2] ?? 'http://localhost:5173/';
const stageId = process.argv[3] ?? 'rooftop';
const mobile = process.argv.includes('--mobile');
const fast = process.argv.includes('--fast');
const out = 'shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage(
  mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
    : { viewport: fast ? { width: 800, height: 480 } : { width: 1280, height: 760 } },
);
const errors = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const tag = `${stageId}${mobile ? '-mobile' : ''}`;
await page.goto(url);
await page.evaluate(() => {
  localStorage.setItem('skyhoops.profile.v1', JSON.stringify({ name: 'Mia', color: '#ff3d7f', avatar: '🦄' }));
  localStorage.setItem('skyhoops.progress.v1', JSON.stringify({ rooftop: { stars: 3, best: 40 }, lantern: { stars: 2, best: 25 }, cliffs: { stars: 1, best: 12 }, island: { stars: 1, best: 12 }, moon: { stars: 1, best: 12 }, portal: { stars: 1, best: 12 } }));
});
await page.evaluate((q) => localStorage.setItem('skyhoops.quality', q), fast ? 'low' : 'high');
await page.reload();
await page.waitForTimeout(7000);
await page.screenshot({ path: `${out}/01-title${mobile ? '-mobile' : ''}.png` });

await page.click('[data-action="tour"]');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/02-map${mobile ? '-mobile' : ''}.png` });

const idx = ['rooftop', 'lantern', 'cliffs', 'island', 'moon', 'portal', 'storm'].indexOf(stageId);
await page.locator('.stage-card').nth(idx).click();
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/03-intro-${tag}.png` });
await page.click('[data-action="intro-play"]');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/04-aim-${tag}.png` });

// Take a few shots with perfect-ish swipes computed by the game itself.
for (let i = 0; i < 3; i++) {
  const vp = page.viewportSize();
  const x = vp.width / 2;
  const y = vp.height * 0.8;
  await page.waitForFunction(() => window.skyhoops.phase === 'ready', null, { timeout: 60000 });
  await page.waitForTimeout(300);
  // Earth-equivalent distance for the ideal launch speed, which is what swipe length maps to.
  const reach = await page.evaluate(() => {
    const ctx = window.skyhoops.aimContext();
    const d = Math.hypot(ctx.ideal.x - ctx.from.x, ctx.ideal.z - ctx.from.z);
    const h = ctx.ideal.y - ctx.from.y;
    const a = (60 * Math.PI) / 180;
    const v2 = (ctx.g * d * d) / (2 * Math.cos(a) ** 2 * (d * Math.tan(a) - h));
    return (v2 * Math.sin(2 * a)) / 9.81;
  });
  const swipe = Math.min(0.68, (reach / 11) * 0.55) * vp.height;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let s = 1; s <= 8; s++) {
    await page.mouse.move(x, y - (swipe * s) / 8);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/05-drag-${tag}-${i}.png` });
  await page.mouse.up();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/06-flight-${tag}-${i}.png` });
  await page.waitForFunction(() => window.skyhoops.phase !== 'flight', null, { timeout: 60000 });
}
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/07-after-${tag}.png` });
console.log('score after 3 shots:', await page.evaluate(() => document.querySelector('#hud-score')?.textContent ?? window.skyhoops.score));

console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
