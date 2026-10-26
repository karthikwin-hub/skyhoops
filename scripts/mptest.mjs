// Two-player headless test: host creates a room, a friend joins via invite link, both play a round.
// Usage: node scripts/mptest.mjs [url] [stageId]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const url = process.argv[2] ?? 'http://localhost:5173/';
const stageId = process.argv[3] ?? 'rooftop';
const out = 'shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];

async function player(name, avatar, color, path = '') {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 480 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${name} pageerror] ${e.message}`));
  await page.goto(url);
  await page.evaluate(
    (p) => {
      localStorage.setItem('skyhoops.profile.v1', JSON.stringify(p));
      localStorage.setItem('skyhoops.quality', 'low');
      localStorage.setItem('skyhoops.music', 'off');
    },
    { name, avatar, color },
  );
  await page.goto(url + path);
  await page.waitForFunction(() => !!window.skyhoops, null, { timeout: 90000 }).catch((e) => {
    console.log(errors.join('\n'));
    throw e;
  });
  return page;
}

/** Plays shots through the game's own shot handler until the round is over, sometimes missing on purpose. */
async function playRound(page, missEvery) {
  for (let i = 0; i < 20; i++) {
    const phase = await page
      .waitForFunction(() => ['ready', 'done', 'idle'].includes(window.skyhoops.phase) && window.skyhoops.phase, null, { timeout: 180000 })
      .catch(async (e) => {
        const g = await page.evaluate(() => ({ phase: window.skyhoops.phase, shot: window.skyhoops.state.shotIndex, t: window.skyhoops.shotTime, pos: window.skyhoops.ball.position }));
        await page.screenshot({ path: `${out}/mp-stuck-${i}.png` });
        console.log('stuck', JSON.stringify(g));
        throw e;
      });
    if ((await phase.jsonValue()) !== 'ready') return;
    await page.evaluate((miss) => {
      const g = window.skyhoops;
      const ctx = g.aimContext();
      const d = Math.hypot(ctx.ideal.x - ctx.from.x, ctx.ideal.z - ctx.from.z);
      const h = ctx.ideal.y - ctx.from.y;
      const a = (60 * Math.PI) / 180;
      const v2 = (ctx.g * d * d) / (2 * Math.cos(a) ** 2 * (d * Math.tan(a) - h));
      const reach = (v2 * Math.sin(2 * a)) / 9.81;
      g.shoot({ dx: 0, dy: (reach / 11) * 0.55 * (miss ? 1.4 : 1), curve: 0 });
    }, missEvery > 0 && i % missEvery === missEvery - 1);
    await page.waitForTimeout(200);
  }
}

const host = await player('Mia', '🦄', '#ff3d7f');
await host.click('[data-action="friends"]');
await host.click('[data-action="room-create"]');
await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('#room-code').textContent), null, { timeout: 15000 });
const code = await host.textContent('#room-code');
console.log('room code', code);

const friend = await player('Zoe', '🐸', '#36d6ff', `?room=${code}`);
await host.waitForFunction(() => document.querySelectorAll('#lobby-players .lp').length === 2, null, { timeout: 20000 });
await friend.waitForFunction(() => document.querySelector('#lobby.show') && document.querySelectorAll('#lobby-players .lp').length === 2, null, { timeout: 20000 });
console.log('both players in lobby');

const idx = ['rooftop', 'lantern', 'cliffs', 'island', 'moon', 'portal', 'storm'].indexOf(stageId);
await host.locator('#stage-chips button').nth(idx).click();
await host.waitForTimeout(800);
await host.screenshot({ path: `${out}/mp-01-lobby-host.png` });
await friend.screenshot({ path: `${out}/mp-01-lobby-friend.png` });
await host.click('#room-start');

await Promise.all([host, friend].map((p) => p.waitForFunction(() => window.skyhoops.phase === 'ready', null, { timeout: 60000 })));
console.log('round started on both');

await friend.locator('#reactions button').first().click();
const reacted = await host
  .waitForFunction(() => document.querySelectorAll('#floating-reacts .float-react').length > 0, null, { timeout: 10000 })
  .then(() => true, () => false);
console.log('reaction reached host:', reacted);

const hostPlay = playRound(host, 0);
const friendPlay = playRound(friend, 3);
// Catch a ghost ball mid-flight on the host's screen.
await friend.waitForFunction(() => window.skyhoops.phase === 'flight', null, { timeout: 60000 });
await host.waitForTimeout(500);
await host.screenshot({ path: `${out}/mp-02-ghost-host.png` });
await Promise.all([hostPlay, friendPlay]);
console.log('both finished');

await Promise.all([host, friend].map((p) => p.waitForFunction(() => document.querySelectorAll('#podium-stands .stand').length === 2, null, { timeout: 60000 })));
await host.waitForTimeout(1500);
await host.screenshot({ path: `${out}/mp-03-podium-host.png` });
await friend.screenshot({ path: `${out}/mp-03-podium-friend.png` });
console.log('podium:', await host.textContent('#podium-stands'));

console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
