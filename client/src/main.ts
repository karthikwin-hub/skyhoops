import { Game } from './game/game';
import { App } from './ui/app';
import { isTouchDevice } from './engine/renderer';

const saved = localStorage.getItem('skyhoops.quality');
const high = saved ? saved === 'high' : !isTouchDevice;

function boot(): void {
  try {
    const game = new Game(document.getElementById('stage')!, { high });
    new App(game);
    (window as unknown as { skyhoops: Game }).skyhoops = game;
  } catch (err) {
    console.error(err);
    const p = document.querySelector('#loading p');
    if (p) p.textContent = 'Your browser could not start 3D graphics (WebGL). Try another browser.';
  }
}

// Wait briefly for the rounded font so canvas-painted courts use it, but never block for long.
Promise.race([document.fonts.load('700 40px Fredoka'), new Promise((r) => setTimeout(r, 1500))]).finally(boot);
