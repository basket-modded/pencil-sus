/**
 * Tiny procedural sound kit — pencils, paper and alarm bells, no audio files.
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.5, slideTo?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  private noise(dur: number, vol = 0.3, filterFreq = 2200, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
  }

  click() {
    this.tone(680, 0.05, 'square', 0.18, 420);
  }
  tick() {
    this.tone(1200, 0.03, 'square', 0.1);
  }
  task() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'triangle', 0.24), i * 70));
  }
  join() {
    this.tone(392, 0.12, 'triangle', 0.2);
    setTimeout(() => this.tone(587, 0.16, 'triangle', 0.2), 90);
  }
  kill() {
    this.noise(0.35, 0.6, 700, 'lowpass');
    this.tone(140, 0.4, 'sawtooth', 0.35, 60);
  }
  alarm() {
    for (let i = 0; i < 3; i++) setTimeout(() => this.tone(880, 0.2, 'square', 0.16, 620), i * 220);
  }
  whoosh() {
    this.noise(0.5, 0.35, 900, 'bandpass');
  }
  win(team: 'crew' | 'impostors') {
    const notes = team === 'crew' ? [523, 659, 784, 1046] : [392, 330, 262, 196];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.4, 'triangle', 0.3), i * 150));
  }
  scribble() {
    this.noise(0.07, 0.16, 3200);
  }
  error() {
    this.tone(180, 0.18, 'square', 0.2, 120);
  }
}

export const sfx = new Sfx();
