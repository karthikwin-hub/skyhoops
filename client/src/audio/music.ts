import { audio, mtof } from './audio';

export interface MusicTheme {
  bpm: number;
  /** MIDI note of the key's root. */
  root: number;
  scale: 'major' | 'minor' | 'lydian' | 'dorian' | 'mixolydian';
  /** Scale degrees (0-based), one chord per bar. */
  chords: number[];
  /** Brightness of the pad, 0..1. */
  bright: number;
  lead: 'bell' | 'pluck' | 'glass';
  swing?: number;
}

const SCALES: Record<MusicTheme['scale'], number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

function degreeNote(theme: MusicTheme, degree: number): number {
  const s = SCALES[theme.scale];
  const oct = Math.floor(degree / s.length);
  return theme.root + s[((degree % s.length) + s.length) % s.length] + oct * 12;
}

/**
 * Generative music that grows with the player's streak:
 * level 0 pad and sparse notes, 1 adds drums, 2 adds bass, 3 adds arpeggios, 4 adds sparkles.
 */
export class Music {
  private theme: MusicTheme | null = null;
  private timer: number | null = null;
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private level = 0;
  private targetLevel = 0;
  private bus: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;

  play(theme: MusicTheme): void {
    const sameTheme = this.theme === theme;
    this.theme = theme;
    audio.onReady(() => {
      if (this.timer !== null && sameTheme) return;
      this.start();
    });
  }

  setLevel(level: number): void {
    this.targetLevel = Math.max(0, Math.min(4, level));
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const ctx = audio.ctx;
    if (this.bus && ctx) {
      const old = this.bus;
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => old.disconnect(), 1500);
    }
    this.bus = null;
  }

  private start(): void {
    this.stop();
    const ctx = audio.ctx!;
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(0, ctx.currentTime);
    this.bus.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    this.bus.connect(audio.music);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.Q.value = 0.8;
    this.padFilter.connect(this.bus);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    this.padFilter.connect(send).connect(audio.reverbSend);
    this.step = 0;
    this.bar = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private schedule(): void {
    const ctx = audio.ctx;
    const theme = this.theme;
    if (!ctx || !theme || !this.bus) return;
    const stepDur = 60 / theme.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.15) {
      const swing = this.step % 2 === 1 ? (theme.swing ?? 0) * stepDur : 0;
      this.playStep(this.step, this.nextTime + swing, stepDur);
      this.nextTime += stepDur;
      this.step++;
      if (this.step === 16) {
        this.step = 0;
        this.bar++;
        this.level = this.targetLevel;
      }
    }
  }

  private playStep(step: number, t: number, stepDur: number): void {
    const theme = this.theme!;
    const ctx = audio.ctx!;
    const chordDeg = theme.chords[this.bar % theme.chords.length];
    const chord = [0, 2, 4, 6].map((k) => degreeNote(theme, chordDeg + k));
    const L = this.level;

    if (step === 0) {
      this.padFilter!.frequency.setTargetAtTime(500 + theme.bright * 900 + L * 450, t, 0.8);
      const barLen = stepDur * 16;
      for (const n of chord.slice(0, 3)) this.pad(mtof(n - 12), t, barLen);
    }

    if (L >= 1) {
      const kick = step === 0 || step === 8 || (L >= 3 && (step === 4 || step === 12)) || (L >= 2 && step === 10 && this.bar % 2 === 1);
      if (kick) this.kick(t);
      if (step % 4 === 2) this.hat(t, 0.05);
      if (L >= 3 && step % 2 === 1) this.hat(t, 0.018);
    }
    if (L >= 2) {
      const pattern = [0, -1, -1, 12, -1, -1, 0, -1, 0, -1, -1, 7, -1, -1, 12, -1];
      const p = pattern[step];
      if (p >= 0) this.bass(mtof(chord[0] - 24 + p), t, stepDur * 1.6);
    }
    if (L >= 3) {
      if (step === 4 || step === 12) this.clap(t);
      const arp = [0, 1, 2, 3, 2, 1];
      const n = chord[arp[step % arp.length]] + 12 + (step >= 8 ? 12 : 0);
      this.pluck(mtof(n), t, 0.06);
    }
    const sparse = step === 0 || step === 6 || step === 10 || (L >= 1 && step === 14);
    if (sparse && Math.random() < 0.85) {
      const n = chord[(step / 2 + this.bar) % 3 | 0] + 12;
      this.lead(mtof(n), t, theme.lead);
    }
    if (L >= 4 && step % 2 === 0 && Math.random() < 0.45) {
      const n = chord[Math.floor(Math.random() * 4)] + 24;
      this.lead(mtof(n), t, 'glass', 0.04);
    }
    void ctx;
  }

  private pad(freq: number, t: number, len: number): void {
    const ctx = audio.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + len * 0.3);
    g.gain.linearRampToValueAtTime(0.04, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + len * 1.15);
    g.connect(this.padFilter!);
    for (const d of [-9, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = d;
      o.connect(g);
      o.start(t);
      o.stop(t + len * 1.2);
    }
  }

  private kick(t: number): void {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.35);
  }

  private hat(t: number, gain: number): void {
    audio.noiseHit({ t, type: 'highpass', freq: 8000, gain, decay: 0.04, out: this.bus! });
  }

  private clap(t: number): void {
    for (let i = 0; i < 3; i++) {
      audio.noiseHit({ t: t + i * 0.012, type: 'bandpass', freq: 1500, q: 1.5, gain: 0.12, decay: i === 2 ? 0.14 : 0.02, out: this.bus!, reverb: 0.3 });
    }
  }

  private bass(freq: number, t: number, len: number): void {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const sub = ctx.createOscillator();
    sub.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f);
    sub.connect(f);
    f.connect(g).connect(this.bus!);
    o.start(t);
    sub.start(t);
    o.stop(t + len + 0.05);
    sub.stop(t + len + 0.05);
  }

  private pluck(freq: number, t: number, gain: number): void {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(4000, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(f).connect(g).connect(this.bus!);
    const s = ctx.createGain();
    s.gain.value = 0.4;
    g.connect(s).connect(audio.reverbSend);
    o.start(t);
    o.stop(t + 0.25);
  }

  private lead(freq: number, t: number, kind: MusicTheme['lead'], gain = 0.07): void {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = kind === 'pluck' ? 'triangle' : 'sine';
    o.frequency.value = freq;
    const decay = kind === 'glass' ? 1.6 : kind === 'bell' ? 1.1 : 0.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.bus!);
    if (kind !== 'pluck') {
      const h = ctx.createOscillator();
      h.frequency.value = freq * (kind === 'glass' ? 4.01 : 2.0);
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.0001, t);
      hg.gain.exponentialRampToValueAtTime(gain * 0.3, t + 0.004);
      hg.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.5);
      h.connect(hg).connect(this.bus!);
      h.start(t);
      h.stop(t + decay);
    }
    const s = ctx.createGain();
    s.gain.value = 0.7;
    g.connect(s).connect(audio.reverbSend);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

export const music = new Music();
