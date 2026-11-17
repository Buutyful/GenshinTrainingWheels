// The action cues: one fixed sound per key, identical in every music style, each with a sharp
// attack so its timing is unmistakable. In rhythm mode they sit on their own bus above the music
// (the mixer's Cues fader) and the band dips briefly under each one.
//
// Two sets, chosen in Settings (`audio.cueSound`):
//
//   key   distinct sound (default)                     voice
//   1     cold detuned stab, low                       "one"
//   2     square pluck                                 "two"
//   3     glass bell                                   "three"
//   4     metallic ring-modulated ping, high           "four"
//   e     cowbell                                      "E"
//   E     cowbell, then a rising whistle (keep holding) "Eee", drawn out and rising
//   q     impact: sub boom + noise burst               "Q"
//   n     woodblock tick per click                     "N" on the first click, ticks after
//   c     snare crack over a low thump                 "C"
//   dash  noise whoosh upwards                         "dash"
//   jump  rising chirp                                 "jump"
//
// The four swaps are four different instruments, and also rise in pitch with the slot.

import type { CueSound, Grade } from '../types';
import { midiToHz, noteToMidi } from './patterns';
import { say, type VoiceWord } from './voice';

/** One cue, named after the key it asks for. */
export type Trigger =
  | { kind: 'swap'; slot: number }
  | { kind: 'skill' }
  | { kind: 'hold' }
  | { kind: 'burst' }
  /** One normal-attack click; `first` marks the first click of a string. */
  | { kind: 'attack'; first?: boolean }
  | { kind: 'charged' }
  | { kind: 'dash' }
  | { kind: 'jump' };

/** Swap pitches per slot: a rising major triad and octave, inside every style's key. */
export const SLOT_NOTES = ['C4', 'E4', 'G4', 'C5'].map(noteToMidi);

type Ctx = BaseAudioContext;

function envGain(ctx: Ctx, t: number, peak: number, dur: number, attack = 0.001): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.gain.setValueAtTime(0, t + dur + 0.005);
  return g;
}

function osc(ctx: Ctx, type: OscillatorType, hz: number, t: number, dur: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  o.detune.value = detune;
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

// ---------------------------------------------------------------- the four swaps

/** Slot 1: a cold, detuned stab (root and fifth), filtered down fast. */
function coldStab(ctx: Ctx, dest: AudioNode, t: number, hz: number): void {
  const lp = filt(ctx, 'lowpass', 4000, 1.4);
  lp.frequency.setValueAtTime(5000, t);
  lp.frequency.exponentialRampToValueAtTime(800, t + 0.2);
  for (const h of [hz, hz * 1.5]) {
    osc(ctx, 'sawtooth', h, t, 0.22, -15).connect(lp);
    osc(ctx, 'sawtooth', h, t, 0.22, 15).connect(lp);
  }
  lp.connect(filt(ctx, 'highpass', 200)).connect(envGain(ctx, t, 0.28, 0.22, 0.002)).connect(dest);
}

/** Slot 2: a square pluck with a closing filter. */
function pluck(ctx: Ctx, dest: AudioNode, t: number, hz: number): void {
  const lp = filt(ctx, 'lowpass', hz * 6, 2);
  lp.frequency.setValueAtTime(hz * 10, t);
  lp.frequency.exponentialRampToValueAtTime(hz * 2, t + 0.2);
  osc(ctx, 'square', hz, t, 0.22).connect(lp);
  lp.connect(envGain(ctx, t, 0.45, 0.22)).connect(dest);
}

/** Slot 3: a glassy FM bell (inharmonic, rings). */
function bell(ctx: Ctx, dest: AudioNode, t: number, hz: number): void {
  const car = osc(ctx, 'sine', hz, t, 0.6);
  const mod = osc(ctx, 'sine', hz * 3.5, t, 0.6);
  const idx = ctx.createGain();
  idx.gain.setValueAtTime(hz * 2.2, t);
  idx.gain.exponentialRampToValueAtTime(hz * 0.1, t + 0.5);
  mod.connect(idx).connect(car.frequency);
  car.connect(envGain(ctx, t, 0.4, 0.55)).connect(dest);
}

/** Slot 4: a metallic ping: a square ring-modulated by an inharmonic sine. */
function metalPing(ctx: Ctx, dest: AudioNode, t: number, hz: number): void {
  const ring = ctx.createGain();
  ring.gain.value = 0;
  osc(ctx, 'sine', hz * 1.41, t, 0.3).connect(ring.gain);
  osc(ctx, 'square', hz, t, 0.3).connect(ring);
  ring.connect(filt(ctx, 'highpass', 400)).connect(envGain(ctx, t, 0.7, 0.28)).connect(dest);
  osc(ctx, 'sine', hz * 2, t, 0.12).connect(envGain(ctx, t, 0.2, 0.1)).connect(dest);
}

const SWAP_SOUNDS = [coldStab, pluck, bell, metalPing];

// ---------------------------------------------------------------- the rest

export function cowbell(ctx: Ctx, dest: AudioNode, t: number, gain = 0.5, dur = 0.16): void {
  const bp = filt(ctx, 'bandpass', 2600, 1.4);
  osc(ctx, 'square', 540, t, dur).connect(bp);
  osc(ctx, 'square', 800, t, dur).connect(bp);
  bp.connect(envGain(ctx, t, gain, dur)).connect(dest);
}

/** A whistle rising over half a second: "keep holding". */
function whistle(ctx: Ctx, dest: AudioNode, t: number): void {
  const o = osc(ctx, 'sine', midiToHz(noteToMidi('E5')), t, 0.5);
  o.frequency.exponentialRampToValueAtTime(midiToHz(noteToMidi('A5')), t + 0.45);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.16, t + 0.05);
  g.gain.setValueAtTime(0.16, t + 0.4);
  g.gain.linearRampToValueAtTime(0, t + 0.5);
  o.connect(g).connect(dest);
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

/** Charged attack: a snare crack over a low thump, heavier than the attack tick. */
function crack(ctx: Ctx, dest: AudioNode, t: number): void {
  noise(ctx, t, 0.14).connect(filt(ctx, 'bandpass', 1900, 0.9)).connect(envGain(ctx, t, 0.5, 0.13)).connect(dest);
  const o = osc(ctx, 'sine', 190, t, 0.18);
  o.frequency.exponentialRampToValueAtTime(85, t + 0.15);
  o.connect(envGain(ctx, t, 0.5, 0.16)).connect(dest);
}

export function sweep(ctx: Ctx, dest: AudioNode, t: number, gain = 2.2, dur = 0.18): void {
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

/** The word the voice set says for a cue; null keeps the sound (later clicks of an attack string). */
export function wordFor(t: Trigger): VoiceWord | null {
  switch (t.kind) {
    case 'swap':
      return (['one', 'two', 'three', 'four'] as const)[t.slot] ?? 'one';
    case 'skill':
      return 'E';
    case 'hold':
      return 'Eee';
    case 'burst':
      return 'Q';
    case 'attack':
      return t.first ? 'N' : null;
    case 'charged':
      return 'C';
    case 'dash':
      return 'dash';
    case 'jump':
      return 'jump';
  }
}

/** Plays one cue at audio time `time` into `dest`, as a sound or as a spoken key. */
export function playCue(ctx: Ctx, dest: AudioNode, t: Trigger, time: number, mode: CueSound = 'sounds'): void {
  if (mode === 'voice') {
    const w = wordFor(t);
    if (w) {
      say(ctx, dest, w, time);
      // The burst keeps its impact under the word: a Q should always feel big.
      if (t.kind === 'burst') impact(ctx, dest, time, 0.5);
      return;
    }
  }
  switch (t.kind) {
    case 'swap': {
      const slot = Math.max(0, Math.min(3, t.slot));
      return SWAP_SOUNDS[slot](ctx, dest, time, midiToHz(SLOT_NOTES[slot]));
    }
    case 'skill':
      return cowbell(ctx, dest, time);
    case 'hold':
      cowbell(ctx, dest, time);
      return whistle(ctx, dest, time + 0.06);
    case 'burst':
      return impact(ctx, dest, time);
    case 'attack':
      return woodTick(ctx, dest, time);
    case 'charged':
      return crack(ctx, dest, time);
    case 'dash':
      return sweep(ctx, dest, time);
    case 'jump':
      return chirp(ctx, dest, time);
  }
}

// ---------------------------------------------------------------- judgements

/**
 * Rhythm-mode feedback right after a step: short, quiet and high (or low and dull for a miss), so
 * it never reads as the next cue. Early and late are a tick above and a tock below.
 */
export function playJudgement(ctx: Ctx, dest: AudioNode, g: Grade, t: number): void {
  const ping = (note: string, at: number, gain: number, dur = 0.09) =>
    osc(ctx, 'sine', midiToHz(noteToMidi(note)), at, dur).connect(envGain(ctx, at, gain, dur)).connect(dest);
  switch (g) {
    case 'perfect':
      ping('E6', t, 0.11);
      ping('B6', t + 0.045, 0.1, 0.12);
      return;
    case 'good':
      ping('A5', t, 0.09);
      return;
    case 'early':
      osc(ctx, 'triangle', 1500, t, 0.03).connect(envGain(ctx, t, 0.08, 0.03)).connect(dest);
      return;
    case 'late':
      osc(ctx, 'triangle', 420, t, 0.05).connect(envGain(ctx, t, 0.12, 0.05)).connect(dest);
      return;
    case 'miss': {
      const lp = filt(ctx, 'lowpass', 500, 1);
      osc(ctx, 'square', 98, t, 0.14).connect(lp);
      osc(ctx, 'square', 104, t, 0.14).connect(lp);
      lp.connect(envGain(ctx, t, 0.16, 0.14, 0.004)).connect(dest);
    }
  }
}

/** Every distinct cue with the key that plays it in the Music lab. */
export const CUE_GUIDE: { label: string; key: string; trigger: Trigger }[] = [
  { label: 'Swap → 1', key: 'Digit1', trigger: { kind: 'swap', slot: 0 } },
  { label: 'Swap → 2', key: 'Digit2', trigger: { kind: 'swap', slot: 1 } },
  { label: 'Swap → 3', key: 'Digit3', trigger: { kind: 'swap', slot: 2 } },
  { label: 'Swap → 4', key: 'Digit4', trigger: { kind: 'swap', slot: 3 } },
  { label: 'E', key: 'KeyE', trigger: { kind: 'skill' } },
  { label: 'Hold E', key: 'KeyR', trigger: { kind: 'hold' } },
  { label: 'Q', key: 'KeyQ', trigger: { kind: 'burst' } },
  { label: 'Attack (N)', key: 'KeyN', trigger: { kind: 'attack', first: true } },
  { label: 'Charged (C)', key: 'KeyC', trigger: { kind: 'charged' } },
  { label: 'Dash', key: 'KeyD', trigger: { kind: 'dash' } },
  { label: 'Jump', key: 'Space', trigger: { kind: 'jump' } },
];
