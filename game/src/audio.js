// audio.js — every sound is synthesised with WebAudio: no audio files,
// no network, nothing to ship. One AudioContext, one master gain, small
// helper builders (noise burst, tone, sweep). Positional-ish by volume.
export class Sfx {
  constructor() {
    this.ctx = null; this.master = null; this.muted = false;
    this.noiseBuf = null;
  }
  ensure() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
    return !!this.ctx;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.35; return this.muted; }

  // A filtered noise burst: the body of every gunshot and the explosion.
  noise(dur, freq, q, gain, when = 0) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }
  // A sine thump: the low body of shots and explosions.
  tone(freq, dur, gain, type = 'sine', slideTo = 0, when = 0) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  play(name, vol = 1) {
    if (!this.ensure()) return;
    switch (name) {
      case 'shot': this.noise(0.09, 1800, 0.8, 0.5 * vol); this.tone(140, 0.08, 0.4 * vol); break;
      case 'shotSmg': this.noise(0.06, 2200, 0.9, 0.35 * vol); this.tone(170, 0.05, 0.25 * vol); break;
      case 'shotShotgun': this.noise(0.16, 900, 0.6, 0.7 * vol); this.tone(90, 0.14, 0.5 * vol); break;
      case 'shotPistol': this.noise(0.07, 1500, 0.9, 0.4 * vol); this.tone(160, 0.06, 0.3 * vol); break;
      case 'dry': this.tone(1200, 0.03, 0.15, 'square'); break;
      case 'reload': this.tone(900, 0.04, 0.2, 'square'); this.tone(700, 0.04, 0.2, 'square', 0, 0.15); break;
      case 'hit': this.tone(2400, 0.05, 0.25, 'square'); break;
      case 'kill': this.tone(880, 0.08, 0.3); this.tone(1320, 0.12, 0.3, 'sine', 0, 0.08); break;
      case 'explode': this.noise(0.7, 300, 0.5, 0.9 * vol); this.tone(70, 0.6, 0.8 * vol, 'sine', 35); break;
      case 'throw': this.noise(0.12, 600, 1, 0.15); break;
      case 'plant': this.tone(1200, 0.06, 0.25, 'square'); this.tone(1200, 0.06, 0.25, 'square', 0, 0.12); break;
      case 'defuse': this.tone(1500, 0.06, 0.25, 'square'); this.tone(1900, 0.1, 0.25, 'square', 0, 0.1); break;
      case 'beep': this.tone(1000, 0.05, 0.2, 'square'); break;
      case 'step': this.noise(0.05, 500, 0.7, 0.12 * vol); break;
      case 'roundStart': this.tone(440, 0.12, 0.25); this.tone(660, 0.18, 0.25, 'sine', 0, 0.12); break;
      case 'win': [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 0.25, 'sine', 0, i * 0.12)); break;
      case 'lose': [392, 330, 262].forEach((f, i) => this.tone(f, 0.16, 0.22, 'sine', 0, i * 0.12)); break;
    }
  }
  // Volume falls with distance to the player (hearing range ~30 m).
  playAt(name, from, listener) {
    const d = Math.hypot(from.x - listener.x, from.z - listener.z);
    if (d > 32) return;
    this.play(name, Math.max(0.15, 1 - d / 32));
  }
}
