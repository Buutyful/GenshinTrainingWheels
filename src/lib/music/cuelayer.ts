// The action cues of rhythm mode: one fixed, distinct sound per action, identical in every
// music style, with a sharp attack so its timing is unmistakable. They sit on their own bus above
// the music (the mixer's Cues fader) and the band dips briefly under each one.
//
//   swap → slot N   a square "pluck", higher for each slot (slot 1 lowest)
//   skill (E)       a cowbell: two detuned squares, nothing in the music sounds like it
//   hold skill      the cowbell with a ringing tail
//   burst (Q)       an impact: sub boom + noise burst (the band adds a crash)
//   normal attack   a short woodblock tick per click
//   charged attack  tick + a falling blip
//   dash            a noise whoosh upwards
//   jump            a rising chirp

import { midiToHz, noteToMidi } from './patterns';

/** The musical block of one rotation action. */
export type Trigger =
  | { kind: 'stab'; slot: number; hold?: boolean }
  | { kind: 'clap' }
  | { kind: 'drop' }
  | { kind: 'tick' }
  | { kind: 'snap' }
  | { kind: 'sweep' }
  | { kind: 'blip' };

/** Swap pitches per slot: a rising major triad and octave, inside every style's key. */
export const SLOT_NOTES = ['E4', 'G4', 'C5', 'E5'].map(noteToMidi);

type Ctx = BaseAudioContext;

function envGain(ctx: Ctx, t: number, peak: number, dur: number, attack = 0.001): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.gain.setValueAtTime(0, t + dur + 0.005);
  return g;
}

function osc(ctx: Ctx, type: OscillatorType, hz: number, t: number, dur: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}

function filt(ctx: Ctx, type: BiquadFilterType, hz: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

const noiseBuf = new WeakMap<Ctx, AudioBuffer>();
function noise(ctx: Ctx, t: number, dur: number): AudioBufferSourceNode {
  let buf = noiseBuf.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
    noiseBuf.set(ctx, buf);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start(t);
  src.stop(t + dur + 0.05);
  return src;
}

export function pluck(ctx: Ctx, dest: AudioNode, t: number, midi: number, gain = 0.5, dur = 0.22): void {
  const hz = midiToHz(midi);
  const lp = filt(ctx, 'lowpass', hz * 6, 2);
  lp.frequency.setValueAtTime(hz * 10, t);
  lp.frequency.exponentialRampToValueAtTime(hz * 2, t + dur);
  const g = envGain(ctx, t, gain, dur);
  osc(ctx, 'square', hz, t, dur).connect(lp);
  osc(ctx, 'square', hz * 2.003, t, dur).connect(envGain(ctx, t, 0.35, dur * 0.5)).connect(lp);
  lp.connect(g).connect(dest);
}

export function cowbell(ctx: Ctx, dest: AudioNode, t: number, gain = 0.5, dur = 0.16): void {
  const bp = filt(ctx, 'bandpass', 2600, 1.4);
  const g = envGain(ctx, t, gain, dur);
  osc(ctx, 'square', 540, t, dur).connect(bp);
  osc(ctx, 'square', 800, t, dur).connect(bp);
  bp.connect(g).connect(dest);
}

export function impact(ctx: Ctx, dest: AudioNode, t: number, gain = 0.8): void {
  const o = osc(ctx, 'sine', 120, t, 0.6);
  o.frequency.exponentialRampToValueAtTime(34, t + 0.35);
  o.connect(envGain(ctx, t, gain, 0.6)).connect(dest);
  noise(ctx, t, 0.25).connect(filt(ctx, 'lowpass', 3000)).connect(envGain(ctx, t, gain * 0.55, 0.22)).connect(dest);
}

export function woodTick(ctx: Ctx, dest: AudioNode, t: number, gain = 0.35): void {
  osc(ctx, 'sine', 1750, t, 0.04).connect(envGain(ctx, t, gain, 0.035)).connect(dest);
  noise(ctx, t, 0.01).connect(filt(ctx, 'highpass', 4000)).connect(envGain(ctx, t, gain * 0.5, 0.008, 0.0005)).connect(dest);
}

export function fall(ctx: Ctx, dest: AudioNode, t: number, gain = 0.4): void {
  const o = osc(ctx, 'triangle', 620, t, 0.2);
  o.frequency.exponentialRampToValueAtTime(180, t + 0.18);
  o.connect(envGain(ctx, t, gain, 0.2)).connect(dest);
}

export function sweep(ctx: Ctx, dest: AudioNode, t: number, gain = 0.45, dur = 0.18): void {
  const band = filt(ctx, 'bandpass', 400, 2.5);
  band.frequency.setValueAtTime(400, t);
  band.frequency.exponentialRampToValueAtTime(5000, t + dur);
  noise(ctx, t, dur).connect(band).connect(envGain(ctx, t, gain, dur, 0.04)).connect(dest);
}

export function chirp(ctx: Ctx, dest: AudioNode, t: number, gain = 0.45): void {
  const o = osc(ctx, 'sine', 330, t, 0.14);
  o.frequency.exponentialRampToValueAtTime(990, t + 0.08);
  o.connect(envGain(ctx, t, gain, 0.12)).connect(dest);
}

/** Plays one trigger at audio time `t` into `dest`. */
export function playCue(ctx: Ctx, dest: AudioNode, t: Trigger, time: number): void {
  switch (t.kind) {
    case 'stab':
      pluck(ctx, dest, time, SLOT_NOTES[t.slot] ?? SLOT_NOTES[0], 0.5, t.hold ? 0.6 : 0.22);
      return;
    case 'clap':
      return cowbell(ctx, dest, time);
    case 'drop':
      return impact(ctx, dest, time);
    case 'tick':
      return woodTick(ctx, dest, time);
    case 'snap':
      woodTick(ctx, dest, time);
      return fall(ctx, dest, time + 0.03);
    case 'sweep':
      return sweep(ctx, dest, time);
    case 'blip':
      return chirp(ctx, dest, time);
  }
}

/** Every distinct cue, for the sound guide and tests. */
export const CUE_GUIDE: { label: string; key: string; triggers: Trigger[] }[] = [
  { label: 'Swap → 1', key: 'Digit1', triggers: [{ kind: 'stab', slot: 0 }] },
  { label: 'Swap → 2', key: 'Digit2', triggers: [{ kind: 'stab', slot: 1 }] },
  { label: 'Swap → 3', key: 'Digit3', triggers: [{ kind: 'stab', slot: 2 }] },
  { label: 'Swap → 4', key: 'Digit4', triggers: [{ kind: 'stab', slot: 3 }] },
  { label: 'E', key: 'KeyE', triggers: [{ kind: 'clap' }] },
  { label: 'Hold E', key: 'KeyR', triggers: [{ kind: 'clap' }, { kind: 'stab', slot: 0, hold: true }] },
  { label: 'Q', key: 'KeyQ', triggers: [{ kind: 'drop' }] },
  { label: 'Attack', key: 'KeyA', triggers: [{ kind: 'tick' }] },
  { label: 'CA', key: 'KeyC', triggers: [{ kind: 'snap' }] },
  { label: 'Dash', key: 'KeyD', triggers: [{ kind: 'sweep' }] },
  { label: 'Jump', key: 'Space', triggers: [{ kind: 'blip' }] },
];
