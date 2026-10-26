// Screenshots a world's scenery at high quality from a few camera angles.
// Usage: node scripts/scenery.mjs [url] [stageId] [high|low]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const url = process.argv[2] ?? 'http://localhost:5173/';
const stageId = process.argv[3] ?? 'rooftop';
const quality = process.argv[4] ?? 'high';
const out = 'shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console error', m.text()));
await page.goto(url);
await page.evaluate((q) => {
  localStorage.setItem('skyhoops.profile.v1', JSON.stringify({ name: 'Mia', color: '#ff3d7f', avatar: '🦄' }));
  localStorage.setItem('skyhoops.quality', q);
  const ids = ['rooftop', 'lantern', 'cliffs', 'island', 'moon', 'portal', 'storm'];
  localStorage.setItem('skyhoops.progress.v1', JSON.stringify(Object.fromEntries(ids.map((id) => [id, { stars: 1, best: 10 }]))));
}, quality);
await page.reload();
await page.waitForFunction(() => !!window.skyhoops, null, { timeout: 120000 });
if (stageId !== 'rooftop') {
  await page.waitForTimeout(3000);
  await page.click('[data-action="tour"]');
  await page.waitForTimeout(2500);
  const idx = ['rooftop', 'lantern', 'cliffs', 'island', 'moon', 'portal', 'storm'].indexOf(stageId);
  await page.evaluate((i) => document.querySelectorAll('.stage-card')[i]?.click(), idx);
  await page.waitForTimeout(3000);
}
await page.evaluate(() => window.skyhoops.stopRound());
// Hide the UI so only the 3D scene is captured.
await page.addStyleTag({ content: '.screen, .hud, #toast { display: none !important; }' });

const views = [
  { name: 'wide', center: [0, 2.8, 1], radius: 9, height: 1.6, phase: 0.1 },
  { name: 'skyline', center: [0, 6, -20], radius: 30, height: 4, phase: 0.0 },
  { name: 'sun', center: [-20, 6, -40], radius: 45, height: 3, phase: 0.55 },
];
for (const v of views) {
  await page.evaluate((v) => {
    const d = window.skyhoops.director;
    d.orbitCenter.set(...v.center);
    d.orbitRadius = v.radius;
    d.orbitHeight = v.height;
    d.orbitSpeed = 0;
    d.mode = 'aim';
    d.setMode('orbit');
    d.orbitPhase = v.phase;
    d.setMode('orbit', true);
  }, v);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/scene-${stageId}-${v.name}.png` });
  console.log('saved', v.name);
}
// Close-up of one bird: find a beak (the only yellow-orange standard material) and orbit it.
const found = await page.evaluate(() => {
  const g = window.skyhoops;
  let beak = null;
  g.scene.traverse((o) => {
    if (!beak && o.isMesh && o.material?.color?.getHexString?.() === 'e6b53a') beak = o;
  });
  if (!beak) return false;
  window.__bird = beak;
  const d = g.director;
  d.orbitSpeed = 0;
  d.orbitRadius = 2.2;
  d.orbitHeight = 0.5;
  return true;
});
if (found) {
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const d = window.skyhoops.director;
      const p = window.__bird.getWorldPosition(d.orbitCenter.clone());
      d.orbitCenter.copy(p);
      d.setMode('orbit', true);
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const d = window.skyhoops.director;
      window.__bird.getWorldPosition(d.orbitCenter);
      d.setMode('orbit', true);
    });
    await page.screenshot({ path: `${out}/scene-${stageId}-bird-${i}.png` });
    console.log('saved bird', i);
    await page.waitForTimeout(1200);
  }
}
await browser.close();
