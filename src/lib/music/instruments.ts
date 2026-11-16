// Instruments for the rhythm track. Each one builds a short-lived node graph that plays one
// event at an audio-clock time and cleans itself up; nothing here keeps state between events,
// so the same functions render live (AudioContext) and offline (OfflineAudioContext).
//
// Style target: dry Berlin electroclash. Little reverb, short envelopes, saws and noise.

type Ctx = BaseAudioContext;

const noiseCache = new WeakMap<Ctx, AudioBuffer>();

/** Seeded, so two offline renders of the same pattern come out sample-identical. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(ctx: Ctx): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = buf.getChannelData(0);
    const rnd = mulberry32(0x5eed);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

function noiseSrc(ctx: Ctx, t: number, dur: number, offset = 0): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  src.start(t, offset % 1.9);
  src.stop(t + dur + 0.05);
  return src;
}

function filter(ctx: Ctx, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Attack to `peak`, then an exponential fall to silence at `t + dur`. */
function env(ctx: Ctx, t: number, peak: number, dur: number, attack = 0.002): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.005));
  g.gain.setValueAtTime(0, t + dur + 0.01);
  return g;
}

const curves = new Map<number, Float32Array<ArrayBuffer>>();

/** tanh saturation, normalised so a full-scale input still peaks at 1. */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = Math.round(amount * 100);
  let c = curves.get(key);
  if (!c) {
    const k = 1 + key / 5;
    c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    curves.set(key, c);
  }
  return c;
}

export const centsToRatio = (c: number) => 2 ** (c / 1200);

// ---------------------------------------------------------------- drums

export interface KickParams {
  gain?: number;
  /** Pitch at the hit and where it settles, Hz. */
  top?: number;
  bottom?: number;
  decay?: number;
}

/** Dry analog kick: a sine with a fast pitch drop and a tiny click on top. */
export function kick(ctx: Ctx, dest: AudioNode, t: number, p: KickParams = {}): void {
  const gain = p.gain ?? 1;
  const decay = p.decay ?? 0.34;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(p.top ?? 150, t);
  osc.frequency.exponentialRampToValueAtTime(p.bottom ?? 45, t + 0.075);
  const body = ctx.createGain();
  body.gain.setValueAtTime(0, t);
  body.gain.linearRampToValueAtTime(gain, t + 0.002);
  body.gain.setValueAtTime(gain, t + 0.04);
  body.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(body).connect(dest);
  osc.start(t);
  osc.stop(t + decay + 0.02);

  const click = noiseSrc(ctx, t, 0.012);
  click.connect(filter(ctx, 'highpass', 2500)).connect(env(ctx, t, gain * 0.22, 0.01, 0.0005)).connect(dest);
}

export interface HatParams {
  gain?: number;
  decay?: number;
  /** Lower cut-off of the noise, Hz; higher is thinner. */
  tone?: number;
}

/** Closed hat: very short high-passed noise. */
export function hat(ctx: Ctx, dest: AudioNode, t: number, p: HatParams = {}): void {
  const decay = p.decay ?? 0.045;
  const src = noiseSrc(ctx, t, decay, t * 7.13);
  src
    .connect(filter(ctx, 'highpass', p.tone ?? 7500))
    .connect(filter(ctx, 'peaking', 10000, 1))
    .connect(env(ctx, t, p.gain ?? 0.25, decay, 0.001))
    .connect(dest);
}

/** Clap: three smeared noise bursts and a short tail, band-passed around 1.2 kHz. */
export function clap(ctx: Ctx, dest: AudioNode, t: number, p: { gain?: number } = {}): void {
  const gain = p.gain ?? 0.45;
  const band = filter(ctx, 'bandpass', 1300, 1.4);
  band.connect(dest);
  [0, 0.011, 0.022].forEach((dt, i) => {
    noiseSrc(ctx, t + dt, 0.01, i * 0.31).connect(env(ctx, t + dt, gain, 0.009, 0.0005)).connect(band);
  });
  noiseSrc(ctx, t + 0.03, 0.18, 0.9).connect(env(ctx, t + 0.03, gain * 0.7, 0.16, 0.001)).connect(band);
}

/** Crash: long, bright, high-passed noise; the impact that marks a drop. */
export function crash(ctx: Ctx, dest: AudioNode, t: number, p: { gain?: number; decay?: number } = {}): void {
  const decay = p.decay ?? 1.8;
  noiseSrc(ctx, t, decay, 0.4)
    .connect(filter(ctx, 'highpass', 4200))
    .connect(filter(ctx, 'peaking', 8000, 0.8))
    .connect(env(ctx, t, p.gain ?? 0.22, decay, 0.002))
    .connect(dest);
}

// ---------------------------------------------------------------- acid bass

export interface AcidParams {
  /** Pitches in Hz with their offset from `t`, in seconds; the first is at 0. */
  pitches: { hz: number; at: number }[];
  /** Gate length in seconds. */
  dur: number;
  accent?: boolean;
  gain?: number;
  /** Resting filter cut-off, Hz. */
  cutoff?: number;
  /** 0..1 */
  resonance?: number;
  /** 0..1: how far the filter envelope opens above the cut-off. */
  envMod?: number;
  /** Filter envelope decay, seconds. */
  decay?: number;
  /** 0..1 saturation. */
  drive?: number;
  /** Glide time into a slid note, seconds. */
  slide?: number;
}

/** 303-style voice: saw into a resonant 24 dB lowpass with an envelope, slides and accents. */
export function acid(ctx: Ctx, dest: AudioNode, t: number, p: AcidParams): void {
  const accent = p.accent ?? false;
  const cutoff = p.cutoff ?? 500;
  const reso = p.resonance ?? 0.6;
  const envMod = p.envMod ?? 0.5;
  const decay = (p.decay ?? 0.22) * (accent ? 0.7 : 1);
  const slide = p.slide ?? 0.06;
  const end = t + p.dur;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(p.pitches[0].hz, t);
  for (let i = 1; i < p.pitches.length; i++) {
    const at = t + p.pitches[i].at;
    osc.frequency.setValueAtTime(p.pitches[i - 1].hz, Math.max(t, at - slide));
    osc.frequency.exponentialRampToValueAtTime(p.pitches[i].hz, at);
  }

  // Two cascaded 12 dB filters: the first carries the resonance, the second steepens the slope.
  const f1 = filter(ctx, 'lowpass', cutoff, 0.8 + reso * 17);
  const f2 = filter(ctx, 'lowpass', cutoff, 0.7);
  const peak = Math.min(14000, cutoff * (1 + envMod * (accent ? 14 : 7)));
  for (const f of [f1, f2]) {
    f.frequency.setValueAtTime(peak, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, cutoff), t + decay);
  }

  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(p.drive ?? 0.3);
  shaper.oversample = '2x';

  // Resonance boosts the signal at the cut-off; keep the level roughly constant.
  const level = (p.gain ?? 0.35) * (accent ? 1.35 : 1) / (1 + reso * 1.6);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + 0.003);
  amp.gain.setValueAtTime(level, end - 0.012);
  amp.gain.linearRampToValueAtTime(0, end);

  osc.connect(f1).connect(f2).connect(shaper).connect(amp).connect(dest);
  osc.start(t);
  osc.stop(end + 0.02);
}

// ---------------------------------------------------------------- synths

/** A group of detuned saws per note, spread across the stereo field. */
function sawStack(ctx: Ctx, dest: AudioNode, t: number, end: number, hz: number, voices: number, spreadCents: number, width: number, seed: number): void {
  const rnd = mulberry32(seed);
  const level = 1 / Math.sqrt(voices);
  for (let v = 0; v < voices; v++) {
    const pos = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1; // -1..1
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = hz * centsToRatio(pos * spreadCents);
    const pan = ctx.createStereoPanner();
    pan.pan.value = pos * width;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(pan).connect(dest);
    // Free-running analog oscillators never start in phase; a sub-millisecond offset avoids the
    // "zipper" of seven saws starting on the same sample.
    const start = t + rnd() * 0.0012;
    osc.start(start);
    osc.stop(end + 0.03);
  }
}

export interface StabParams {
  chord: number[];
  /** Detune of the outer saws, cents. */
  detune?: number;
  dur?: number;
  gain?: number;
  cutoff?: number;
}

/** Cold detuned chord stab: short, dry, filtered down fast. */
export function stab(ctx: Ctx, dest: AudioNode, t: number, p: StabParams): void {
  const dur = p.dur ?? 0.2;
  const cutoff = p.cutoff ?? 3200;
  const lp = filter(ctx, 'lowpass', cutoff, 1.2);
  lp.frequency.setValueAtTime(cutoff * 1.8, t);
  lp.frequency.exponentialRampToValueAtTime(cutoff * 0.5, t + dur);
  const hp = filter(ctx, 'highpass', 180);
  const amp = env(ctx, t, (p.gain ?? 0.3) / Math.sqrt(p.chord.length), dur, 0.003);
  lp.connect(hp).connect(amp).connect(dest);
  p.chord.forEach((hz, i) => sawStack(ctx, lp, t, t + dur, hz, 3, p.detune ?? 12, 0.35, 101 + i));
}

export interface SupersawParams {
  chord: number[];
  voices?: number;
  /** Total spread between the outermost saws, cents. */
  detune?: number;
  dur?: number;
  gain?: number;
  /** 0..1 stereo width. */
  width?: number;
  attack?: number;
}

/** The lift of a drop: seven detuned saws per note, wide, with the low end left to the bass. */
export function supersaw(ctx: Ctx, dest: AudioNode, t: number, p: SupersawParams): void {
  const dur = p.dur ?? 1.8;
  const attack = p.attack ?? 0.015;
  const voices = p.voices ?? 7;
  const hp = filter(ctx, 'highpass', 220);
  const lp = filter(ctx, 'lowpass', 7500, 0.5);
  const amp = ctx.createGain();
  const level = (p.gain ?? 0.3) / Math.sqrt(p.chord.length);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + attack);
  amp.gain.setTargetAtTime(level * 0.7, t + attack, dur / 3);
  amp.gain.setValueAtTime(level * 0.7 * Math.exp(-(dur - attack) * 3 / dur), t + dur - 0.08);
  amp.gain.linearRampToValueAtTime(0, t + dur);
  hp.connect(lp).connect(amp).connect(dest);
  p.chord.forEach((hz, i) => sawStack(ctx, hp, t, t + dur, hz, voices, (p.detune ?? 30) / 2, p.width ?? 0.85, 701 + i));
}
