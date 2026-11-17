import * as Tone from 'tone';
import type { MusicSettings, MusicStyle } from '../types';
import grooveData from './grooves.json';
import { midiToHz, noteToMidi, stepSec, STEPS_PER_BAR } from './patterns';

// The backing band of rhythm mode. Drums are real drummers' grooves (Groove MIDI Dataset,
// CC BY 4.0, see grooves.json and scripts/extract-grooves.mjs) re-synthesised with Tone.js; bass
// follows the kick, keys play the style's chords. Nothing here depends on the rotation: the
// action cues live in cuelayer.ts so they sound the same whatever the style.

/** A hit: [16th, piece index, velocity 1..127, offset in hundredths of a 16th]. */
type Hit = [number, number, number, number];
interface GrooveSrc {
  id: string;
  genre: string;
  bpm: number;
  hits: Hit[];
}

export const PIECES = grooveData.pieces as Piece[];
type Piece = 'kick' | 'snare' | 'stick' | 'hat' | 'pedal' | 'open' | 'ride' | 'bell' | 'crash' | 'tomHi' | 'tomMid' | 'tomLow';

export const GROOVE_CREDIT =
  'Drum grooves: excerpts of the Groove MIDI Dataset by Google LLC (Gillick, Roberts, Engel, Eck and Bamman, 2019), CC BY 4.0, cut into loops, aligned to the beat and re-synthesised. Audio engine: Tone.js (MIT).';

interface StyleDef {
  label: string;
  blurb: string;
  /** App 16ths per groove 16th: 2 plays the groove half-time (a 64 BPM feel on the 128 grid). */
  scale: 1 | 2;
  /** One chord per groove bar, looping. */
  chords: string[][];
  /** Groove 16ths (within a bar) where the keys play. */
  keysAt: number[];
  keysLen: number;
  /** Bass: on the groove's kicks, or on these groove 16ths instead. */
  bassAt?: number[];
  bassOctave: number;
  /** Programmed four-on-the-floor kick and clap instead of the groove's own kick and snare. */
  fourOnFloor?: boolean;
  /** Final lowpass on the band, Hz (lo-fi warmth). */
  tone: number;
  reverb: number;
  /** Programmed by `Band.playRunway` instead of played from recorded grooves. */
  programmed?: boolean;
}

const ch = (s: string) => s.split(' ');

export const STYLES: Record<MusicStyle, StyleDef> = {
  runway: {
    label: 'Runway techno',
    blurb: 'Fashion-show electroclash: dry four-on-the-floor, rolling acid bass, cold stabs, string builds, supersaw lifts.',
    scale: 1,
    chords: [ch('A3 C4 E4 G4'), ch('F3 A3 C4 E4'), ch('G3 C4 D4 G4'), ch('E3 G3 B3 D4')],
    keysAt: [],
    keysLen: 0,
    bassOctave: 2,
    tone: 14000,
    reverb: 0.12,
    programmed: true,
  },
  hiphop: {
    label: 'Lo-fi hip-hop',
    blurb: 'Laid-back, half-time, warm electric piano. Easy on the ears for long sessions.',
    scale: 2,
    chords: [ch('D3 F3 A3 C4 E4'), ch('G2 F3 B3 E4'), ch('C3 E3 G3 B3 D4'), ch('A2 G3 C4 E4')],
    keysAt: [0, 7],
    keysLen: 6,
    bassOctave: 2,
    tone: 5200,
    reverb: 0.28,
  },
  funk: {
    label: 'Funk / disco',
    blurb: 'Real funk, soul and disco drummers with a bouncy bass and clavinet stabs.',
    scale: 1,
    chords: [ch('D4 F4 A4 C5'), ch('D4 F4 A4 C5'), ch('G3 B3 F4 A4'), ch('G3 B3 E4 A4')],
    keysAt: [2, 6, 7, 10, 14],
    keysLen: 1,
    bassOctave: 2,
    tone: 9000,
    reverb: 0.15,
  },
  house: {
    label: 'House',
    blurb: 'Four-on-the-floor with Latin and Afro percussion, off-beat bass and piano chords.',
    scale: 1,
    chords: [ch('A3 C4 E4 G4'), ch('F3 A3 C4 E4'), ch('C4 E4 G4 B4'), ch('G3 B3 D4 F#4')],
    keysAt: [0, 3, 6, 10, 13],
    keysLen: 2,
    bassAt: [2, 6, 10, 14],
    bassOctave: 2,
    fourOnFloor: true,
    tone: 10000,
    reverb: 0.22,
  },
  rock: {
    label: 'Rock / pop',
    blurb: 'Straight backbeats from rock and pop drummers, driving power chords.',
    scale: 1,
    chords: [ch('C3 G3 C4'), ch('G2 D3 G3'), ch('A2 E3 A3'), ch('F2 C3 F3')],
    keysAt: [0, 2, 4, 6, 8, 10, 12, 14],
    keysLen: 2,
    bassAt: [0, 2, 4, 6, 8, 10, 12, 14],
    bassOctave: 1,
    tone: 8000,
    reverb: 0.2,
  },
};

export const STYLE_IDS = Object.keys(STYLES) as MusicStyle[];

export function grooves(style: MusicStyle): { beats: GrooveSrc[]; fills: GrooveSrc[] } {
  return (grooveData.styles as unknown as Record<MusicStyle, { beats: GrooveSrc[]; fills: GrooveSrc[] }>)[style] ?? { beats: [], fills: [] };
}

/**
 * Runway's 32-bar cycle: a restrained verse (pulse, rolling bass, stabs punctuating), a build
 * (strings rising, filter opening, a riser and a snare roll) and a euphoric lift (wide supersaw
 * chords). The pulse never stops.
 */
export type RunwaySection = 'verse' | 'build' | 'lift';
export const RUNWAY_CYCLE = 32;
export function runwaySection(bar: number): { section: RunwaySection; barIn: number; of: number } {
  const c = ((bar % RUNWAY_CYCLE) + RUNWAY_CYCLE) % RUNWAY_CYCLE;
  if (c < 16) return { section: 'verse', barIn: c, of: 16 };
  if (c < 24) return { section: 'build', barIn: c - 16, of: 8 };
  return { section: 'lift', barIn: c - 24, of: 8 };
}

/** Rolling acid line over one bar: semitones above the root per 16th, null where the kick is. */
export const RUNWAY_BASS: (number | null)[] = [null, 0, 12, 0, null, 0, 0, 12, null, 0, 12, 0, null, 0, 3, 12];

/** Groove bars per phrase; the last one is a fill when fills are on. */
export const PHRASE_BARS = 4;

/** Which groove (and whether a fill) plays in groove bar `bar`. Pure, for tests. */
export function grooveFor(style: MusicStyle, bar: number, choice: number, fills: boolean): { src: GrooveSrc; fill: boolean; barInSrc: number } {
  const g = grooves(style);
  const phrase = Math.floor(bar / PHRASE_BARS);
  const inPhrase = ((bar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
  if (fills && g.fills.length && inPhrase === PHRASE_BARS - 1) {
    return { src: g.fills[phrase % g.fills.length], fill: true, barInSrc: 0 };
  }
  // Auto (-1) moves to the next groove every phrase.
  const i = choice >= 0 ? choice % g.beats.length : phrase % g.beats.length;
  return { src: g.beats[i], fill: false, barInSrc: inPhrase % 2 };
}

/** Hits for one groove 16th (step 0..15 of a groove bar), including the ones pulled earlier from the next. */
export function hitsAt(src: GrooveSrc, barInSrc: number, step: number): Hit[] {
  const at = barInSrc * STEPS_PER_BAR + step;
  return src.hits.filter((h) => h[0] === at);
}


/** The drummer's swing: mean lateness of the off-16ths, in hundredths of a 16th. Bass and keys follow it. */
export function swingOf(src: GrooveSrc): number {
  const odd = src.hits.filter((h) => h[0] % 2 === 1);
  if (odd.length < 4) return 0;
  const even = src.hits.filter((h) => h[0] % 2 === 0);
  const mean = (hs: Hit[]) => hs.reduce((a, h) => a + h[3], 0) / Math.max(1, hs.length);
  return Math.max(0, Math.min(40, mean(odd) - mean(even)));
}

// ---------------------------------------------------------------- voices
//
// Every note is a small Web Audio graph that exists only while it sounds. Tone's own
// instruments keep their whole graph running per voice, which cost several times more CPU; this
// has to run next to a game.

type Raw = BaseAudioContext;

class Voices {
  private noiseBuf: AudioBuffer;
  private curves = new Map<number, Float32Array<ArrayBuffer>>();

  constructor(private ac: Raw) {
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0);
    let x = 0x2f6b;
    for (let i = 0; i < d.length; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (x / 0x7fffffff) * 2 - 1;
    }
    this.noiseBuf = buf;
  }

  private env(t: number, peak: number, dur: number, attack = 0.002): GainNode {
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
    g.gain.setValueAtTime(0, t + dur + 0.01);
    return g;
  }

  private osc(type: OscillatorType, hz: number, t: number, dur: number, detune = 0): OscillatorNode {
    const o = this.ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    o.detune.value = detune;
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private filter(type: BiquadFilterType, hz: number, q = 0.7): BiquadFilterNode {
    const f = this.ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  }

  private shaper(k: number): WaveShaperNode {
    let c = this.curves.get(k);
    if (!c) {
      c = new Float32Array(512);
      for (let i = 0; i < c.length; i++) {
        const x = (i / (c.length - 1)) * 2 - 1;
        c[i] = Math.tanh(k * x) / Math.tanh(k);
      }
      this.curves.set(k, c);
    }
    const w = this.ac.createWaveShaper();
    w.curve = c;
    return w;
  }

  /** A burst of noise through a filter: hats, cymbals, snare wires, claps. */
  noise(dest: AudioNode, t: number, o: { type: BiquadFilterType; hz: number; q?: number; peak: number; decay: number; attack?: number }): void {
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start(t, (t * 7.31) % 1.8);
    src.stop(t + o.decay + 0.05);
    src.connect(this.filter(o.type, o.hz, o.q)).connect(this.env(t, o.peak, o.decay, o.attack ?? 0.001)).connect(dest);
  }

  /** Electric piano: FM with a decaying index, plus the tine's bell partial. */
  epiano(dest: AudioNode, hz: number, t: number, dur: number, vel: number): void {
    const car = this.osc('sine', hz, t, dur);
    const mod = this.osc('sine', hz, t, dur);
    const idx = this.ac.createGain();
    idx.gain.setValueAtTime(hz * (1.2 + vel), t);
    idx.gain.exponentialRampToValueAtTime(hz * 0.15, t + 0.7);
    mod.connect(idx).connect(car.frequency);
    car.connect(this.env(t, 0.12 * vel, dur, 0.004)).connect(dest);
    this.osc('sine', hz * 4.01, t, 0.25).connect(this.env(t, 0.025 * vel, 0.22)).connect(dest);
  }

  /** Clavinet: a bright pulse, band-passed, plucked short. */
  clav(dest: AudioNode, hz: number, t: number, dur: number, vel: number): void {
    const bp = this.filter('bandpass', 1400, 1.6);
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.12);
    this.osc('square', hz, t, dur).connect(bp);
    this.osc('sawtooth', hz * 2, t, dur, 6).connect(bp);
    bp.connect(this.filter('highpass', 280)).connect(this.env(t, 0.13 * vel, Math.min(dur, 0.18), 0.001)).connect(dest);
  }

  /** House piano: a few decaying partials and a closing filter. */
  piano(dest: AudioNode, hz: number, t: number, dur: number, vel: number): void {
    const lp = this.filter('lowpass', 4000, 0.5);
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.exponentialRampToValueAtTime(1200, t + 0.6);
    lp.connect(this.env(t, 0.11 * vel, dur, 0.002)).connect(dest);
    this.osc('triangle', hz, t, dur).connect(lp);
    this.osc('sine', hz * 2, t, dur).connect(this.env(t, 0.5, dur * 0.6)).connect(lp);
    this.osc('sine', hz * 3, t, 0.3).connect(this.env(t, 0.25, 0.25)).connect(lp);
  }

  /** Overdriven power chord: two detuned saws per note into one distortion. */
  power(dest: AudioNode, hzs: number[], t: number, dur: number, vel: number): void {
    const drive = this.shaper(5);
    const lp = this.filter('lowpass', 2400, 0.9);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.004);
    g.gain.setValueAtTime(0.09 * vel, t + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const pre = this.ac.createGain();
    pre.gain.value = 0.35;
    for (const hz of hzs) {
      this.osc('sawtooth', hz, t, dur, -7).connect(pre);
      this.osc('sawtooth', hz, t, dur, 7).connect(pre);
    }
    pre.connect(drive).connect(lp).connect(g).connect(dest);
  }

  /** Bass in a few flavours. */
  bass(dest: AudioNode, hz: number, t: number, dur: number, vel: number, kind: 'sub' | 'slap' | 'deep' | 'pick'): void {
    const lp = this.filter('lowpass', 600, kind === 'slap' ? 4 : 1);
    const amp = this.ac.createGain();
    const peak = 0.38 * vel;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(peak * (kind === 'slap' ? 0.35 : 0.7), t + 0.18);
    amp.gain.setValueAtTime(peak * (kind === 'slap' ? 0.3 : 0.6), t + dur - 0.03);
    amp.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(amp).connect(dest);
    switch (kind) {
      case 'sub':
        lp.frequency.value = 900;
        this.osc('sine', hz, t, dur).connect(lp);
        this.osc('triangle', hz * 2, t, dur).connect(this.env(t, 0.15, dur)).connect(lp);
        return;
      case 'slap':
        lp.frequency.setValueAtTime(3200, t);
        lp.frequency.exponentialRampToValueAtTime(350, t + 0.14);
        this.osc('sawtooth', hz, t, dur).connect(lp);
        return;
      case 'deep':
        lp.frequency.setValueAtTime(900, t);
        lp.frequency.exponentialRampToValueAtTime(280, t + 0.2);
        this.osc('triangle', hz, t, dur).connect(lp);
        this.osc('sine', hz / 2, t, dur).connect(this.env(t, 0.6, dur)).connect(lp);
        return;
      case 'pick':
        lp.frequency.setValueAtTime(1800, t);
        lp.frequency.exponentialRampToValueAtTime(500, t + 0.1);
        this.osc('sawtooth', hz, t, dur).connect(lp);
        this.osc('square', hz / 2, t, dur).connect(this.env(t, 0.3, dur)).connect(lp);
        return;
    }
  }

  // ---- runway (electroclash techno) voices

  /** Rolling acid bass: a saw into a resonant 24 dB lowpass with an envelope; accents open it further. */
  acid(dest: AudioNode, hz: number, t: number, dur: number, o: { cutoff: number; accent: boolean; slideFrom?: number }): void {
    const saw = this.osc('sawtooth', o.slideFrom ?? hz, t, dur);
    if (o.slideFrom) saw.frequency.exponentialRampToValueAtTime(hz, t + 0.05);
    const f1 = this.filter('lowpass', o.cutoff, 6);
    const f2 = this.filter('lowpass', o.cutoff, 0.7);
    const peak = Math.min(9000, o.cutoff * (o.accent ? 6 : 3.5));
    for (const f of [f1, f2]) {
      f.frequency.setValueAtTime(peak, t);
      f.frequency.exponentialRampToValueAtTime(o.cutoff, t + (o.accent ? 0.14 : 0.2));
    }
    const amp = this.ac.createGain();
    const level = o.accent ? 0.16 : 0.12;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(level, t + 0.003);
    amp.gain.setValueAtTime(level, t + dur - 0.01);
    amp.gain.linearRampToValueAtTime(0, t + dur);
    saw.connect(f1).connect(f2).connect(this.shaper(2)).connect(amp).connect(dest);
  }

  /** Sub-bass foundation: a clean sine. */
  sub(dest: AudioNode, hz: number, t: number, dur: number, gain = 0.32): void {
    const amp = this.ac.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + 0.006);
    amp.gain.setValueAtTime(gain, t + dur - 0.02);
    amp.gain.linearRampToValueAtTime(0, t + dur);
    this.osc('sine', hz, t, dur).connect(amp).connect(dest);
  }

  /** Cold, detuned, metallic stab: detuned saws plus a ring-modulated edge, filtered down fast. */
  coldStab(dest: AudioNode, hzs: number[], t: number, vel: number): void {
    const dur = 0.2;
    const lp = this.filter('lowpass', 4200, 1.2);
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + dur);
    const hp = this.filter('highpass', 320);
    lp.connect(hp).connect(this.env(t, 0.09 * vel, dur, 0.002)).connect(dest);
    for (const hz of hzs) {
      this.osc('sawtooth', hz, t, dur, -14).connect(lp);
      this.osc('sawtooth', hz, t, dur, 14).connect(lp);
      // Ring modulation by an inharmonic partner gives the metallic edge.
      const ring = this.ac.createGain();
      ring.gain.value = 0;
      this.osc('sine', hz * 2.41, t, dur).connect(ring.gain);
      this.osc('square', hz, t, dur).connect(ring).connect(this.env(t, 0.5, dur * 0.6)).connect(lp);
    }
  }

  /** A sparse atmospheric pad: detuned saws, dark, slow in and out. */
  pad(dest: AudioNode, hzs: number[], t: number, dur: number, level: number): void {
    const lp = this.filter('lowpass', 1100, 0.5);
    const amp = this.ac.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(level, t + Math.min(0.8, dur / 3));
    amp.gain.setValueAtTime(level, t + dur - 0.6);
    amp.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(amp).connect(dest);
    for (const hz of hzs) {
      this.osc('sawtooth', hz, t, dur, -8).connect(lp);
      this.osc('sawtooth', hz, t, dur, 8).connect(lp);
    }
  }

  /** Orchestral-style strings for builds: an ensemble of saws, swelling, opening from `bright0` to `bright1`. */
  strings(dest: AudioNode, hzs: number[], t: number, dur: number, level: number, bright0: number, bright1: number): void {
    const lp = this.filter('lowpass', 700 + bright0 * 5000, 0.6);
    lp.frequency.setValueAtTime(700 + bright0 * 5000, t);
    lp.frequency.linearRampToValueAtTime(700 + bright1 * 5000, t + dur);
    const amp = this.ac.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(level, t + Math.min(1.2, dur / 2));
    amp.gain.setValueAtTime(level, t + dur - 0.15);
    amp.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(amp).connect(dest);
    for (const hz of hzs) for (const d of [-11, 0, 11]) this.osc('sawtooth', hz, t, dur, d).connect(lp);
  }

  /** The chorus lift: three wide, detuned saws per note (left, centre, right). Sustained chords, not a drop. */
  supersaw(dest: AudioNode, hzs: number[], t: number, dur: number, level: number): void {
    const hp = this.filter('highpass', 260);
    const lp = this.filter('lowpass', 7000, 0.5);
    const amp = this.ac.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(level, t + 0.03);
    amp.gain.setValueAtTime(level * 0.85, t + dur - 0.2);
    amp.gain.linearRampToValueAtTime(0, t + dur);
    hp.connect(lp).connect(amp).connect(dest);
    for (const hz of hzs) {
      [-22, 0, 22].forEach((d, i) => {
        const pan = this.ac.createStereoPanner();
        pan.pan.value = (i - 1) * 0.85;
        this.osc('sawtooth', hz, t + i * 0.0007, dur, d).connect(pan).connect(hp);
      });
    }
  }

  /** Tension before the lift: band-passed noise sweeping up and swelling. */
  riser(dest: AudioNode, t: number, dur: number, level = 0.05): void {
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start(t);
    src.stop(t + dur + 0.05);
    const bp = this.filter('bandpass', 300, 2);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + dur * 0.95);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp).connect(g).connect(dest);
  }

  /** A quiet vinyl bed for lo-fi: filtered noise with the odd crackle. */
  vinyl(dest: AudioNode, t: number, dur: number): void {
    this.noise(dest, t, { type: 'bandpass', hz: 3000, q: 0.5, peak: 0.006, decay: dur, attack: 0.05 });
    for (let i = 0; i < 3; i++) {
      const at = t + ((Math.sin(t * 13.7 + i * 2.1) + 1) / 2) * dur;
      this.noise(dest, at, { type: 'highpass', hz: 5000, peak: 0.05, decay: 0.004 });
    }
  }
}

// ---------------------------------------------------------------- the band

type Ctx = Tone.BaseContext;
type BassKind = 'sub' | 'slap' | 'deep' | 'pick';

const VOICING: Record<MusicStyle, { keys: 'epiano' | 'clav' | 'piano' | 'power'; bass: BassKind; kick: { pitchDecay: number; octaves: number; decay: number } }> = {
  // Dry and punchy, not distorted.
  runway: { keys: 'piano', bass: 'deep', kick: { pitchDecay: 0.032, octaves: 5.5, decay: 0.26 } },
  hiphop: { keys: 'epiano', bass: 'sub', kick: { pitchDecay: 0.05, octaves: 5, decay: 0.45 } },
  funk: { keys: 'clav', bass: 'slap', kick: { pitchDecay: 0.03, octaves: 6, decay: 0.28 } },
  house: { keys: 'piano', bass: 'deep', kick: { pitchDecay: 0.06, octaves: 7, decay: 0.42 } },
  rock: { keys: 'power', bass: 'pick', kick: { pitchDecay: 0.025, octaves: 5, decay: 0.3 } },
};

/** Plays a style one app 16th at a time; reads the settings live, so the lab's knobs are heard at once. */
export class Band {
  private v: Voices;
  private kick: Tone.MembraneSynth;
  private toms: Tone.MembraneSynth;
  private snareBody: Tone.MembraneSynth;
  private drumBus: Tone.Gain;
  private bassBus: Tone.Gain;
  private keysBus: Tone.Gain;
  private drumIn: AudioNode;
  private bassIn: AudioNode;
  private keysIn: AudioNode;
  private reverb: Tone.Reverb;
  private toneFilter: Tone.Filter;
  /** Music output; connect it where the music should go. */
  readonly out: Tone.Gain;
  /**
   * Cue sidechain and kick pump are plain Web Audio gains: Tone's Param keeps every automation
   * event and rescans that history on each change, which grew without bound (one pump per beat).
   */
  private duck: GainNode;
  /** Kick sidechain on bass and synths (drums bypass it). */
  private pump: GainNode;
  private style: MusicStyle;
  readonly ready: Promise<void>;

  constructor(
    ctx: Ctx,
    private m: MusicSettings,
  ) {
    const context = ctx;
    this.v = new Voices(ctx.rawContext as unknown as Raw);
    this.style = STYLES[m.style] ? m.style : 'hiphop';
    this.out = new Tone.Gain({ context, gain: 0.8 });
    const raw = ctx.rawContext as unknown as Raw;
    this.duck = raw.createGain();
    this.toneFilter = new Tone.Filter({ context, frequency: 9000, type: 'lowpass', rolloff: -12 });
    this.reverb = new Tone.Reverb({ context, decay: 1.6, preDelay: 0.01, wet: 0.2 });
    this.ready = this.reverb.generate().then(() => undefined);
    const comp = new Tone.Compressor({ context, threshold: -16, ratio: 3, attack: 0.004, release: 0.15 });
    this.drumBus = new Tone.Gain({ context });
    this.bassBus = new Tone.Gain({ context });
    this.keysBus = new Tone.Gain({ context });
    this.pump = raw.createGain();
    this.drumBus.connect(this.toneFilter);
    this.bassBus.connect(this.pump);
    this.keysBus.connect(this.reverb);
    this.reverb.connect(this.pump);
    Tone.connect(this.pump, this.toneFilter);
    this.toneFilter.connect(this.duck);
    Tone.connect(this.duck, comp);
    comp.connect(this.out);
    this.drumIn = this.drumBus.input as unknown as AudioNode;
    this.bassIn = this.bassBus.input as unknown as AudioNode;
    this.keysIn = this.keysBus.input as unknown as AudioNode;

    this.kick = new Tone.MembraneSynth({ context, pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.05 } }).connect(this.drumBus);
    this.toms = new Tone.MembraneSynth({ context, pitchDecay: 0.05, octaves: 2.5, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } }).connect(this.drumBus);
    this.snareBody = new Tone.MembraneSynth({ context, pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.001, decay: 0.09, sustain: 0 } }).connect(this.drumBus);
    this.toms.volume.value = -4;
    this.snareBody.volume.value = -8;
    this.applyStyle();
  }

  /** Re-voices the band for the current style (called when the style changes). */
  private applyStyle(): void {
    // A save from a newer or older version may name a style this one does not have.
    if (!STYLES[this.style]) this.style = 'hiphop';
    const s = STYLES[this.style];
    this.toneFilter.frequency.value = s.tone;
    this.reverb.wet.value = Math.min(0.9, s.reverb * (this.m.reverb ?? 0.5) * 2);
    const k = VOICING[this.style].kick;
    this.kick.set({ pitchDecay: k.pitchDecay, octaves: k.octaves, envelope: { decay: k.decay } });
  }

  /** Dip the band briefly so an action cue stands out (cue sidechain). */
  duckAt(time: number, depth = 0.35): void {
    const g = this.duck.gain;
    g.setTargetAtTime(1 - depth, time, 0.004);
    g.setTargetAtTime(1, time + 0.05, 0.06);
  }

  /** The burst's crash, so a Q lifts the whole band. */
  accent(time: number): void {
    this.v.noise(this.drumIn, time, { type: 'highpass', hz: 4500, peak: 0.22, decay: 1.4 });
  }

  dispose(): void {
    for (const n of [this.kick, this.toms, this.snareBody, this.drumBus, this.bassBus, this.keysBus, this.reverb, this.toneFilter, this.out]) n.dispose();
    this.pump.disconnect();
    this.duck.disconnect();
  }

  /** Plays everything of app 16th `step` at audio time `time`. */
  play(step: number, time: number): void {
    if (this.m.style !== this.style && STYLES[this.m.style]) {
      this.style = this.m.style;
      this.applyStyle();
    }
    const s = STYLES[this.style];
    const voicing = VOICING[this.style];
    const m = this.m;
    this.drumBus.gain.value = m.drums;
    this.bassBus.gain.value = m.bass;
    this.keysBus.gain.value = m.keys;

    if (s.programmed) return this.playRunway(step, time);

    // App 16ths per groove 16th; in half-time only every other app 16th starts a groove 16th.
    if (step % s.scale !== 0) return;
    const gStep = step / s.scale;
    const bar = Math.floor(gStep / STEPS_PER_BAR);
    const inBar = ((gStep % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
    const unit = stepSec() * s.scale;
    const { src, fill, barInSrc } = grooveFor(this.style, bar, m.groove, m.fills);
    const next = grooveFor(this.style, inBar === STEPS_PER_BAR - 1 ? bar + 1 : bar, m.groove, m.fills);
    const nextStep = (inBar + 1) % STEPS_PER_BAR;
    // Bass and keys sit in the drummer's swing.
    const swing = inBar % 2 === 1 ? (swingOf(src) / 100) * unit : 0;

    if (this.style === 'hiphop' && inBar === 0 && bar % 2 === 0) this.v.vinyl(this.drumIn, time, unit * 32);

    // Hits on this 16th that are late, and hits of the next 16th that the drummer played early.
    const due: { h: Hit; t: number }[] = [];
    for (const h of hitsAt(src, barInSrc, inBar)) if (h[3] >= 0) due.push({ h, t: time + (h[3] / 100) * unit * 0.8 });
    for (const h of hitsAt(next.src, next.barInSrc, nextStep)) if (h[3] < 0) due.push({ h, t: time + unit + (h[3] / 100) * unit * 0.8 });

    let kicked = false;
    const hits: { piece: Piece; t: number; vel: number }[] = [];
    for (const { h, t } of due) {
      const piece = PIECES[h[1]];
      if (s.fourOnFloor && !fill && (piece === 'kick' || piece === 'snare')) continue;
      hits.push({ piece, t, vel: Math.min(1, (h[2] / 127) ** 1.3 * 1.1) });
    }
    if (s.fourOnFloor && !fill) {
      if (inBar % 4 === 0) hits.push({ piece: 'kick', t: time, vel: 0.95 });
      if (inBar === 4 || inBar === 12) this.clap(time, 0.8);
    }
    // In time order: Tone's drum voices refuse a hit scheduled before their previous one.
    hits.sort((a, b) => a.t - b.t);
    for (const x of hits) {
      this.hit(x.piece, x.t, x.vel);
      if (x.piece === 'kick') kicked = true;
    }

    // Bass and keys follow the chord of this groove bar.
    const chord = s.chords[((bar % s.chords.length) + s.chords.length) % s.chords.length];
    const root = noteToMidi(chord[0]) % 12;
    const bassMidi = 12 * (s.bassOctave + 1) + root;
    const bassOn = s.bassAt ? s.bassAt.includes(inBar) : kicked;
    if (bassOn && !fill) {
      const len = s.bassAt ? unit * 1.6 : unit * 3;
      // Funk pops the octave on the off-16ths.
      const octave = this.style === 'funk' && inBar % 4 === 3 ? 12 : 0;
      this.v.bass(this.bassIn, midiToHz(bassMidi + octave), time + swing, len, 0.9, voicing.bass);
    }
    if (s.keysAt.includes(inBar) && !(fill && this.style !== 'hiphop')) {
      const vel = inBar === 0 ? 0.85 : 0.65;
      const t = time + swing + (this.style === 'hiphop' ? 0.012 : 0);
      const len = unit * s.keysLen;
      const hzs = chord.map((n) => midiToHz(noteToMidi(n)));
      if (voicing.keys === 'power') this.v.power(this.keysIn, hzs, t, len, vel);
      else {
        hzs.forEach((hz, i) => {
          // A slight strum, low to high, keeps chords from sounding like one block.
          const at = t + (voicing.keys === 'epiano' ? i * 0.008 : 0);
          if (voicing.keys === 'epiano') this.v.epiano(this.keysIn, hz, at, len, vel);
          else if (voicing.keys === 'clav') this.v.clav(this.keysIn, hz, at, len, vel);
          else this.v.piano(this.keysIn, hz, at, len, vel);
        });
      }
    }
  }

  /** Runway techno, programmed straight to the spec: quantised, mechanical, no swing. */
  private playRunway(step: number, time: number): void {
    const v = this.v;
    const unit = stepSec();
    const bar = Math.floor(step / STEPS_PER_BAR);
    const inBar = ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
    const { section, barIn, of } = runwaySection(bar);
    const progress = (barIn + inBar / STEPS_PER_BAR) / of;
    const chords = STYLES.runway.chords;
    const chord = chords[Math.floor((((bar % 8) + 8) % 8) / 2)];
    const hzs = chord.map((n) => midiToHz(noteToMidi(n)));
    const root = noteToMidi(chord[0]) % 12;
    const d = this.drumIn;

    // ---- drums: kick on every beat, tight clap on 2 and 4, crisp 16th hats, sparse metal.
    const hits: { piece: Piece; t: number; vel: number }[] = [];
    if (inBar % 4 === 0) {
      hits.push({ piece: 'kick', t: time, vel: 0.95 });
      // The kick pumps the bass and synths.
      const g = this.pump.gain;
      g.setTargetAtTime(0.5, time, 0.003);
      g.setTargetAtTime(1, time + 0.03, 0.05);
    }
    for (const x of hits) this.hit(x.piece, x.t, x.vel);
    if (inBar === 4 || inBar === 12) this.clap(time, section === 'lift' ? 0.85 : 0.7);
    const hatVel = [0.35, 0.15, 0.6, 0.15][inBar % 4];
    if (section === 'lift' && inBar % 4 === 2) v.noise(d, time, { type: 'highpass', hz: 7000, peak: 0.09, decay: 0.22 });
    else v.noise(d, time, { type: 'highpass', hz: 9000, peak: 0.12 * hatVel, decay: 0.035 });
    // Industrial accents: a short metallic ping and a rim click, few and precise.
    if (inBar === 7 && bar % 2 === 1) v.noise(d, time, { type: 'bandpass', hz: 3300, q: 9, peak: 0.25, decay: 0.07 });
    if (inBar === 14 && bar % 4 === 3) v.noise(d, time, { type: 'bandpass', hz: 1900, q: 3, peak: 0.3, decay: 0.03 });
    // Build: a snare roll over its last two bars, getting denser and louder.
    if (section === 'build' && barIn >= 6) {
      const dense = barIn === 7 ? 1 : 2;
      if (inBar % dense === 0) {
        const vel = 0.25 + 0.6 * ((barIn - 6) * 16 + inBar) / 32;
        v.noise(d, time, { type: 'highpass', hz: 1800, peak: 0.3 * vel, decay: 0.1 });
      }
    }
    // A crash marks the lift, a softer one the return to the verse.
    if (inBar === 0 && ((section === 'lift' && barIn === 0) || (section === 'verse' && barIn === 0))) {
      v.noise(d, time, { type: 'highpass', hz: 4500, peak: section === 'lift' ? 0.18 : 0.08, decay: 1.4 });
    }

    // ---- bass: rolling acid between the kicks, a sub on the off-beats.
    const off = RUNWAY_BASS[inBar];
    if (off !== null) {
      const cutoff = section === 'build' ? 380 + 1400 * progress : section === 'lift' ? 900 : 380 + 120 * Math.sin((bar % 8) * 0.8);
      const hz = midiToHz(12 * 3 + root + off);
      const prev = RUNWAY_BASS[inBar - 1];
      const slide = inBar === 14 && prev !== null ? midiToHz(12 * 3 + root + prev) : undefined;
      v.acid(this.bassIn, hz, time, unit * 0.85, { cutoff, accent: off === 12, slideFrom: slide });
    }
    if (inBar % 4 === 2) v.sub(this.bassIn, midiToHz(12 * 2 + root), time, unit * 1.6);

    // ---- synths: punctuate the verse, build with strings, lift with supersaws.
    const twoBarStart = inBar === 0 && bar % 2 === 0;
    if (section === 'verse') {
      if ((inBar === 6 && bar % 2 === 1) || (inBar === 3 && bar % 4 === 2)) v.coldStab(this.keysIn, hzs, time, 0.9);
      if (twoBarStart && barIn >= 8) v.pad(this.keysIn, hzs, time, unit * 32, 0.035);
    } else if (section === 'build') {
      if (twoBarStart) {
        const p0 = barIn / of;
        v.strings(this.keysIn, hzs, time, unit * 32, 0.04 + 0.05 * p0, p0, p0 + 2 / of);
      }
      if (barIn === 4 && inBar === 0) v.riser(d, time, unit * 64);
      if (inBar === 6 && bar % 2 === 1) v.coldStab(this.keysIn, hzs, time, 0.7);
    } else if (twoBarStart) {
      v.supersaw(this.keysIn, hzs, time, unit * 31, 0.065);
    }
  }

  private clap(t: number, vel: number): void {
    [0, 0.011, 0.022].forEach((dt) => this.v.noise(this.drumIn, t + dt, { type: 'bandpass', hz: 1300, q: 1.4, peak: 0.4 * vel, decay: 0.012 }));
    this.v.noise(this.drumIn, t + 0.03, { type: 'bandpass', hz: 1300, q: 1.4, peak: 0.28 * vel, decay: 0.16 });
  }

  private last = new Map<Tone.MembraneSynth, number>();

  /** Triggers a Tone drum voice, never earlier than its previous hit (they must stay in order). */
  private membrane(syn: Tone.MembraneSynth, note: string, dur: number, t: number, vel: number): void {
    const at = Math.max(t, (this.last.get(syn) ?? 0) + 0.002);
    this.last.set(syn, at);
    syn.triggerAttackRelease(note, dur, at, vel);
  }

  private hit(piece: Piece, t: number, vel: number): void {
    const d = this.drumIn;
    switch (piece) {
      case 'kick':
        this.membrane(this.kick, 'C1', 0.3, t, vel);
        return;
      case 'snare':
        this.membrane(this.snareBody, 'G2', 0.08, t, vel);
        this.v.noise(d, t, { type: 'highpass', hz: 1800, peak: 0.32 * vel, decay: 0.17 });
        return;
      case 'stick':
        this.v.noise(d, t, { type: 'bandpass', hz: 1900, q: 3, peak: 0.35 * vel, decay: 0.03 });
        return;
      case 'hat':
      case 'pedal':
        this.v.noise(d, t, { type: 'highpass', hz: 8000, peak: (piece === 'pedal' ? 0.06 : 0.12) * vel, decay: 0.045 });
        return;
      case 'open':
        this.v.noise(d, t, { type: 'highpass', hz: 7000, peak: 0.1 * vel, decay: 0.28 });
        return;
      case 'ride':
      case 'bell':
        this.v.noise(d, t, { type: 'bandpass', hz: piece === 'bell' ? 7500 : 6000, q: 2.5, peak: 0.13 * vel, decay: piece === 'bell' ? 0.35 : 0.6 });
        return;
      case 'crash':
        this.v.noise(d, t, { type: 'highpass', hz: 4500, peak: 0.18 * vel, decay: 1.3 });
        return;
      case 'tomHi':
        this.membrane(this.toms, 'A2', 0.25, t, vel);
        return;
      case 'tomMid':
        this.membrane(this.toms, 'E2', 0.25, t, vel);
        return;
      case 'tomLow':
        this.membrane(this.toms, 'B1', 0.3, t, vel);
        return;
    }
  }
}

export const BAR_SEC = stepSec() * STEPS_PER_BAR;
