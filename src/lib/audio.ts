import type { CueOutput, Sfx } from './cues';
import type { FlatStep } from './engine';
import { cueGain, getMix, onMix } from './mix';
import { nowMs } from './platform';
import type { AudioSettings } from './types';

// One pentatonic palette for everything, so any two cues that overlap still sound in tune.
// One octave lower than the first version, which players found shrill.
const C3 = 130.81, E3 = 164.81, G3 = 196.0;
const C4 = 261.63, E4 = 329.63, G4 = 392.0, A4 = 440.0;
const C5 = 523.25, E5 = 659.25, A5 = 880.0;
const ARP = [C4, E4, G4, C5];

interface NoteOpts {
  type?: OscillatorType;
  gain?: number;
  /** Glide to this frequency. */
  to?: number;
  /** Seconds the glide takes; defaults to the whole note. */
  bend?: number;
  buildup?: boolean;
}

/**
 * Arcade-style cue synthesiser: short, soft-edged chiptune sounds with no audio files to ship.
 *
 * The vocabulary, chosen so each cue is recognisable within its first 100 ms:
 * - swap to slot N: an arpeggio climbing N notes (count and final pitch both tell the slot)
 * - skill: one rising "bloop"; hold skill: the same bloop, sustained
 * - burst: a fast high trill ending on a sparkle
 * - attacks: one woody "tok" per hit; charged attack: tok followed by a low drop
 * - dash: a breath of noise; jump: a quick upward chirp
 */
export class AudioOut implements CueOutput {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private buildupNodes = new Set<{ src: AudioScheduledSourceNode; gain: GainNode }>();
  private unsubscribe: (() => void) | null = null;

  constructor(private cfg: AudioSettings) {}

  /** Must be called from a user gesture (the Start button) so the browser allows sound. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = ctx.createGain();
      this.master.gain.value = cueGain(getMix());
      // Rounds off the square waves, and the compressor keeps overlapping cues from spiking.
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 3800;
      soften.Q.value = 0.4;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      this.master.connect(soften).connect(comp).connect(ctx.destination);
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this.ctx = ctx;
    }
    // Level follows the top-bar mixer live; the cue volume itself is the mixer's Cues fader.
    this.unsubscribe ??= onMix((m) => this.master?.gain.setTargetAtTime(cueGain(m), this.ctx!.currentTime, 0.02));
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    void this.ctx?.close();
    this.ctx = null;
    this.buildupNodes.clear();
  }

  /** Epoch milliseconds to the audio clock, never in the past. */
  private when(atMs: number): number {
    const ctx = this.ctx!;
    return Math.max(ctx.currentTime, ctx.currentTime + (atMs - nowMs()) / 1000);
  }

  private note(freq: number, start: number, dur: number, o: NoteOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, start + (o.bend ?? dur));
    // Square waves carry far more energy than triangles at the same gain.
    const peak = (o.gain ?? 0.3) * (osc.type === 'square' ? 0.38 : 1);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    if (o.buildup) this.track(osc, g);
  }

  private track(src: AudioScheduledSourceNode, gain: GainNode): void {
    const entry = { src, gain };
    this.buildupNodes.add(entry);
    src.onended = () => this.buildupNodes.delete(entry);
  }

  private whoosh(start: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(1600, start);
    band.frequency.exponentialRampToValueAtTime(350, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(band).connect(g).connect(this.master);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  cue(step: FlatStep, at: number, due: number | null): void {
    if (!this.ctx) return;
    const t = this.when(at);
    this.motif(step, t);
    if (due !== null) this.riser(t + 0.1, this.when(due));
  }

  private motif(step: FlatStep, t: number): void {
    switch (step.action) {
      case 'swap':
        for (let i = 0; i <= step.slot; i++) {
          const last = i === step.slot;
          this.note(ARP[i], t + i * 0.055, last ? 0.16 : 0.07, { type: 'square' });
        }
        return;
      case 'skill':
        return this.note(E4, t, 0.13, { to: A4 * 1.12, bend: 0.07 });
      case 'skillHold':
        return this.note(E4, t, 0.38, { to: A4 * 1.12, bend: 0.07 });
      case 'burst':
        [A4, E5, A4, E5].forEach((f, i) => this.note(f, t + i * 0.045, 0.06, { gain: 0.26 }));
        return this.note(A5, t + 0.18, 0.2, { gain: 0.2 });
      case 'na':
        for (let i = 0; i < Math.min(step.count, 5); i++) this.note(260, t + i * 0.085, 0.06, { type: 'sine', to: 130, gain: 0.38 });
        return;
      case 'ca':
        this.note(260, t, 0.06, { type: 'sine', to: 130, gain: 0.38 });
        return this.note(200, t + 0.075, 0.22, { to: 80, gain: 0.38 });
      case 'dash':
        return this.whoosh(t, 0.15);
      case 'jump':
        return this.note(220, t, 0.14, { type: 'square', to: 520 });
    }
  }

  /** A quiet sweep that climbs to the press moment and lands on a soft "pop". */
  private riser(start: number, due: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || due - start < 0.12) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(C3, start);
    osc.frequency.exponentialRampToValueAtTime(C4 * 1.4, due);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.09, due - 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, due + 0.01);
    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(due + 0.03);
    this.track(osc, g);
    this.note(G4, due, 0.09, { type: 'sine', gain: 0.2, buildup: true });
  }

  cutBuildup(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const { src, gain } of this.buildupNodes) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0.0001, now, 0.01);
      src.stop(now + 0.05);
    }
    this.buildupNodes.clear();
  }

  sfx(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'tick':
        return this.note(900, t, 0.03, { type: 'sine', gain: 0.1 });
      case 'error': // a soft "bonk", not a buzzer
        return this.note(G3, t, 0.17, { to: 105, gain: 0.34 });
      case 'offtrack':
        [G3, E3, C3].forEach((f, i) => this.note(f, t + i * 0.13, i === 2 ? 0.3 : 0.14));
        return;
      case 'resync':
        this.note(C4, t, 0.09, { type: 'square' });
        return this.note(G4, t + 0.08, 0.18, { type: 'square' });
      case 'lap':
        this.note(G4, t, 0.1);
        return this.note(C5, t + 0.09, 0.2);
      case 'lapClean':
        [C4, E4, G4, C5, E5].forEach((f, i) => this.note(f, t + i * 0.06, i === 4 ? 0.28 : 0.08, { type: 'square' }));
        return;
      case 'done':
        [C4, E4, G4].forEach((f) => this.note(f, t, 0.6, { gain: 0.16 }));
        return this.note(C5, t + 0.12, 0.6, { gain: 0.16 });
    }
  }
}
