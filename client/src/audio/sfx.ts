import { audio, mtof } from './audio';

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

let lastBounce = 0;
let lastRim = 0;

export const sfx = {
  bounce(strength: number) {
    const ctx = audio.ctx;
    if (!ctx || strength < 0.4) return;
    if (ctx.currentTime - lastBounce < 0.03) return;
    lastBounce = ctx.currentTime;
    const k = Math.min(1, strength / 7);
    audio.tone({ freq: 150 + k * 40, freqEnd: 52, sweep: 0.12, gain: 0.55 * k + 0.05, decay: 0.2 });
    audio.tone({ type: 'triangle', freq: 330 + Math.random() * 40, freqEnd: 260, gain: 0.12 * k, decay: 0.09 });
    audio.noiseHit({ type: 'lowpass', freq: 1800, gain: 0.25 * k, decay: 0.035 });
  },

  rim(strength: number) {
    const ctx = audio.ctx;
    if (!ctx || strength < 0.25) return;
    if (ctx.currentTime - lastRim < 0.04) return;
    lastRim = ctx.currentTime;
    const k = Math.min(1, strength / 6);
    const f0 = 360 + Math.random() * 60;
    [1, 2.76, 5.4, 8.93].forEach((m, i) => {
      audio.tone({ freq: f0 * m, gain: (0.22 * k) / (i + 1), decay: 0.5 / (i * 0.5 + 1), reverb: 0.25 });
    });
    audio.noiseHit({ type: 'highpass', freq: 3000, gain: 0.2 * k, decay: 0.04 });
  },

  board(strength: number) {
    if (!audio.ctx || strength < 0.3) return;
    const k = Math.min(1, strength / 7);
    audio.noiseHit({ type: 'lowpass', freq: 700, gain: 0.45 * k, decay: 0.14 });
    audio.tone({ freq: 120, freqEnd: 70, gain: 0.4 * k, decay: 0.2 });
    audio.tone({ freq: 1150 + Math.random() * 100, gain: 0.05 * k, decay: 0.3, reverb: 0.4 });
  },

  wall(strength: number) {
    if (!audio.ctx || strength < 0.3) return;
    const k = Math.min(1, strength / 7);
    [1, 1.5, 2.25].forEach((m, i) => audio.tone({ freq: 1500 * m, gain: (0.08 * k) / (i + 1), decay: 0.8, reverb: 0.6 }));
    audio.noiseHit({ type: 'bandpass', freq: 2500, gain: 0.15 * k, decay: 0.06 });
  },

  swish(clean: boolean) {
    if (!audio.ctx) return;
    audio.noiseHit({ type: 'bandpass', freq: 5200, freqEnd: 1600, q: 0.9, gain: clean ? 0.6 : 0.35, attack: 0.02, decay: 0.32 });
    audio.noiseHit({ type: 'highpass', freq: 6500, gain: clean ? 0.25 : 0.1, attack: 0.005, decay: 0.12 });
  },

  whoosh(power: number) {
    if (!audio.ctx) return;
    audio.noiseHit({ type: 'bandpass', freq: 350, freqEnd: 1700, q: 1.4, gain: 0.12 + power * 0.12, attack: 0.03, decay: 0.32 });
  },

  /** Rising bell arpeggio; climbs higher as the streak grows. */
  chime(streak: number, root = 72) {
    const ctx = audio.ctx;
    if (!ctx) return;
    const base = Math.min(streak, 6);
    [0, 1, 2].forEach((n, i) => {
      const note = root + PENTA[Math.min(PENTA.length - 1, base + n * 2)];
      bell(mtof(note), ctx.currentTime + i * 0.07, 0.16);
    });
  },

  fanfare(root = 72) {
    const ctx = audio.ctx;
    if (!ctx) return;
    [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => bell(mtof(root + n), ctx.currentTime + i * 0.055, 0.12));
    audio.noiseHit({ type: 'highpass', freq: 8000, gain: 0.08, attack: 0.2, decay: 1.2, reverb: 0.8 });
  },

  /** A swelling crowd-like roar made from layered filtered noise. */
  cheer(intensity: number) {
    const ctx = audio.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const f of [420, 900, 1800, 3200]) {
      const src = audio.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (0.9 + Math.random() * 0.2);
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      const peak = 0.16 * intensity * (f < 1000 ? 1 : 0.6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.18);
      g.gain.setValueAtTime(peak, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      const trem = ctx.createOscillator();
      trem.frequency.value = 5 + Math.random() * 5;
      const tg = ctx.createGain();
      tg.gain.value = peak * 0.4;
      trem.connect(tg).connect(g.gain);
      src.connect(bp).connect(g).connect(audio.sfx);
      const s = ctx.createGain();
      s.gain.value = 0.3;
      g.connect(s).connect(audio.reverbSend);
      src.start(t, Math.random());
      trem.start(t);
      src.stop(t + 2.3);
      trem.stop(t + 2.3);
    }
  },

  portal() {
    const ctx = audio.ctx;
    if (!ctx) return;
    audio.tone({ freq: 220, freqEnd: 1760, sweep: 0.35, gain: 0.18, decay: 0.45, reverb: 0.7 });
    audio.tone({ type: 'triangle', freq: 330, freqEnd: 2640, sweep: 0.4, gain: 0.08, decay: 0.5, reverb: 0.7 });
    audio.noiseHit({ type: 'bandpass', freq: 3000, freqEnd: 9000, gain: 0.1, attack: 0.05, decay: 0.4, reverb: 0.5 });
  },

  thunder(strength: number) {
    if (!audio.ctx) return;
    audio.noiseHit({ type: 'highpass', freq: 1500, gain: 0.25 * strength, decay: 0.12 });
    audio.noiseHit({ type: 'lowpass', freq: 380, freqEnd: 70, gain: 0.85 * strength, attack: 0.05, decay: 3.2, reverb: 0.5 });
  },

  star(i: number) {
    const ctx = audio.ctx;
    if (!ctx) return;
    const step = [0, 4, 7][i] ?? 0;
    bell(mtof(76 + step), ctx.currentTime, 0.22);
    bell(mtof(88 + step), ctx.currentTime + 0.02, 0.08);
  },

  click() {
    audio.tone({ freq: 900, freqEnd: 600, gain: 0.08, decay: 0.05 });
  },

  beep(high = false) {
    audio.tone({ type: 'triangle', freq: high ? 1320 : 660, gain: 0.18, decay: high ? 0.4 : 0.15, reverb: 0.3 });
  },

  buzzer() {
    const ctx = audio.ctx;
    if (!ctx) return;
    audio.tone({ type: 'square', freq: 196, gain: 0.12, attack: 0.01, decay: 0.7 });
    audio.tone({ type: 'square', freq: 147, gain: 0.08, attack: 0.01, decay: 0.7 });
  },

  pop() {
    audio.tone({ freq: 500, freqEnd: 1200, sweep: 0.06, gain: 0.1, decay: 0.08 });
  },
};

function bell(freq: number, t: number, gain: number): void {
  const ctx = audio.ctx!;
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  const g = ctx.createGain();
  car.frequency.value = freq;
  mod.frequency.value = freq * 3.5;
  modGain.gain.setValueAtTime(freq * 2.2, t);
  modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + 0.9);
  mod.connect(modGain).connect(car.frequency);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  car.connect(g).connect(audio.sfx);
  const s = ctx.createGain();
  s.gain.value = 0.5;
  g.connect(s).connect(audio.reverbSend);
  car.start(t);
  mod.start(t);
  car.stop(t + 1.5);
  mod.stop(t + 1.5);
}

/** Looping ambience (wind, rain) whose loudness follows the game. */
export class Ambience {
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private lfo: OscillatorNode | null = null;
  private kind: 'wind' | 'rain' | 'none' = 'none';

  set(kind: 'wind' | 'rain' | 'none'): void {
    if (kind === this.kind) return;
    this.stop();
    this.kind = kind;
    const ctx = audio.ctx;
    if (!ctx || kind === 'none') return;
    this.src = audio.noiseSource(true);
    this.filter = ctx.createBiquadFilter();
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    if (kind === 'wind') {
      this.filter.type = 'bandpass';
      this.filter.frequency.value = 500;
      this.filter.Q.value = 0.7;
      this.lfo = ctx.createOscillator();
      this.lfo.frequency.value = 0.15;
      const lg = ctx.createGain();
      lg.gain.value = 250;
      this.lfo.connect(lg).connect(this.filter.frequency);
      this.lfo.start();
    } else {
      this.filter.type = 'highpass';
      this.filter.frequency.value = 1200;
    }
    this.src.connect(this.filter).connect(this.gain).connect(audio.sfx);
    this.src.start();
  }

  level(v: number): void {
    if (this.gain && audio.ctx) this.gain.gain.setTargetAtTime(v, audio.ctx.currentTime, 0.4);
  }

  stop(): void {
    try {
      this.src?.stop();
      this.lfo?.stop();
    } catch {
      /* already stopped */
    }
    this.src?.disconnect();
    this.gain?.disconnect();
    this.src = null;
    this.lfo = null;
    this.gain = null;
    this.kind = 'none';
  }
}
