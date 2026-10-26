/** Shared Web Audio graph: master bus, sfx/music buses, a generated reverb and noise sources. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  reverb!: ConvolverNode;
  reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private listeners: (() => void)[] = [];
  sfxOn = localStorage.getItem('skyhoops.sfx') !== 'off';
  musicOn = localStorage.getItem('skyhoops.music') !== 'off';

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 1 : 0;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.42 : 0;
    this.music.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet);
    wet.connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(this.reverb);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    for (const l of this.listeners) l();
    this.listeners = [];
  }

  onReady(fn: () => void): void {
    if (this.ctx) fn();
    else this.listeners.push(fn);
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    localStorage.setItem('skyhoops.sfx', on ? 'on' : 'off');
    if (this.ctx) this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    localStorage.setItem('skyhoops.music', on ? 'on' : 'off');
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.42 : 0, this.ctx.currentTime, 0.2);
  }

  noiseSource(loop = false): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    return src;
  }

  /** Plays a noise burst through a filter with a percussive envelope. */
  noiseHit(opts: {
    t?: number;
    type: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    gain: number;
    attack?: number;
    decay: number;
    out?: AudioNode;
    reverb?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = opts.t ?? ctx.currentTime;
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.decay);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + opts.decay);
    src.connect(f).connect(g).connect(opts.out ?? this.sfx);
    if (opts.reverb) {
      const s = ctx.createGain();
      s.gain.value = opts.reverb;
      g.connect(s).connect(this.reverbSend);
    }
    src.start(t, Math.random() * 1.5);
    src.stop(t + a + opts.decay + 0.05);
  }

  /** Plays an oscillator tone with an optional pitch sweep. */
  tone(opts: {
    t?: number;
    type?: OscillatorType;
    freq: number;
    freqEnd?: number;
    sweep?: number;
    gain: number;
    attack?: number;
    decay: number;
    out?: AudioNode;
    reverb?: number;
    detune?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = opts.t ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + (opts.sweep ?? opts.decay));
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + opts.decay);
    o.connect(g).connect(opts.out ?? this.sfx);
    if (opts.reverb) {
      const s = ctx.createGain();
      s.gain.value = opts.reverb;
      g.connect(s).connect(this.reverbSend);
    }
    o.start(t);
    o.stop(t + a + opts.decay + 0.05);
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }
}

export const audio = new AudioEngine();

export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
