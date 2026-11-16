import type { MusicSettings } from '../types';
import { MusicBus } from './bus';
import { acid, clap, crash, hat, kick, stab, supersaw } from './instruments';
import { acidPhrase, barSec, midiToHz, notes, stepSec, steps, STEPS_PER_BAR, type AcidPattern } from './patterns';

/** The loop that runs under the whole lap: pulse plus rolling acid, in C minor. */
export const BASE = {
  kick: 'X...X...X...X...',
  /** Off-beat hats, open-ish. */
  hat: '..X...X...X...X.',
  /** Quiet closed 16ths in between. */
  tick: '.3.3.3.3.3.3.3.3',
  acid: {
    notes: 'C2 C2 C3 C2 . C2 Eb2 C2 G1 . C2 Bb1 C2 C3 . G1',
    accent: 'x..x...x..x..x..',
    slide: '..x...x.....x...',
  } satisfies AcidPattern,
};

/**
 * One chord per character slot, each a step higher than the last (slot 1 lowest), echoing the
 * existing cue vocabulary where the slot number is heard as height.
 */
export const SLOT_CHORDS: number[][] = [
  notes('C4 Eb4 G4'),
  notes('Eb4 G4 Bb4'),
  notes('F4 Ab4 C5'),
  notes('G4 Bb4 D5'),
] as number[][];

/** The drop: a wide C minor 9. */
export const LIFT_CHORD = notes('C4 G4 Bb4 Eb5 G5') as number[];

export type Layer = 'kick' | 'hat' | 'acid' | 'stab' | 'clap' | 'lift';
export const LAYERS: Layer[] = ['kick', 'hat', 'acid', 'stab', 'clap', 'lift'];

export type Trigger = { kind: 'stab'; slot: number } | { kind: 'clap' } | { kind: 'drop' };

/**
 * A 4-bar demo of the action layer for the Jam screen and offline renders: stabs for swaps,
 * a clap for a skill, and a drop on the last bar, like a short rotation would sound.
 */
export function demoTriggers(step: number): Trigger[] {
  const bar = Math.floor(step / STEPS_PER_BAR) % 4;
  const s = step % STEPS_PER_BAR;
  const at: Record<number, Trigger[]> = {
    0: [{ kind: 'stab', slot: 0 }],
    6: [{ kind: 'clap' }],
    16: [{ kind: 'stab', slot: 1 }],
    20: [{ kind: 'clap' }],
    32: [{ kind: 'stab', slot: 2 }],
    38: [{ kind: 'clap' }],
    42: [{ kind: 'stab', slot: 3 }],
    48: [{ kind: 'drop' }],
  };
  return at[bar * STEPS_PER_BAR + s] ?? [];
}

const KICK = steps(BASE.kick);
const HAT = steps(BASE.hat);
const TICK = steps(BASE.tick);
const ACID = acidPhrase(BASE.acid);

/**
 * Plays the base loop and action layer one 16th at a time. Settings are read on every step, so
 * moving a knob is heard on the next note.
 */
export class Groove {
  readonly bus: MusicBus;
  layers = new Set<Layer>(LAYERS);
  demo = false;
  /** Semitones; every pitched voice follows it (the key change of milestone 4). */
  transpose = 0;
  private pending: Trigger[] = [];

  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode,
    private m: MusicSettings,
    readonly bpm = 128,
  ) {
    this.bus = new MusicBus(ctx, dest, m.volume);
  }

  /** Plays on the next step that gets scheduled. */
  trigger(t: Trigger): void {
    this.pending.push(t);
  }

  private hz = (midi: number) => midiToHz(midi + this.transpose);

  play(step: number, time: number): void {
    const m = this.m;
    const s = step % STEPS_PER_BAR;
    const on = (l: Layer) => this.layers.has(l);
    this.bus.setVolume(m.volume, time);

    if (KICK[s] && on('kick')) {
      kick(this.ctx, this.bus.direct, time, { gain: KICK[s] * m.kick });
      this.bus.pump(time, m.sidechain);
    }
    if (on('hat')) {
      if (HAT[s]) hat(this.ctx, this.bus.direct, time, { gain: HAT[s] * m.hat * 0.32, decay: 0.08 });
      if (TICK[s]) hat(this.ctx, this.bus.direct, time, { gain: TICK[s] * m.hat * 0.3, decay: 0.025, tone: 9000 });
    }
    if (on('acid')) {
      const sec = stepSec(this.bpm);
      for (const v of ACID) {
        if (v.step !== s) continue;
        acid(this.ctx, this.bus.ducked, time, {
          pitches: v.pitches.map((p) => ({ hz: this.hz(p.midi), at: p.at * sec })),
          // A 303 gate is a little shorter than the step unless it slides.
          dur: (v.length - 0.45) * sec,
          accent: v.accent,
          gain: m.acid * 0.5,
          cutoff: m.cutoff,
          resonance: m.resonance,
          envMod: m.envMod,
          decay: m.decay,
          drive: m.drive,
        });
      }
    }

    const due = this.demo ? [...this.pending, ...demoTriggers(step)] : this.pending;
    this.pending = [];
    for (const t of due) this.fire(t, time);
  }

  private fire(t: Trigger, time: number): void {
    const m = this.m;
    if (t.kind === 'stab' && this.layers.has('stab')) {
      stab(this.ctx, this.bus.direct, time, { chord: SLOT_CHORDS[t.slot].map(this.hz), detune: m.stabDetune, gain: m.stab * 0.55 });
    } else if (t.kind === 'clap' && this.layers.has('clap')) {
      clap(this.ctx, this.bus.direct, time, { gain: m.hat * 0.9 });
    } else if (t.kind === 'drop' && this.layers.has('lift')) {
      crash(this.ctx, this.bus.direct, time, { gain: m.lift * 0.35 });
      supersaw(this.ctx, this.bus.ducked, time, { chord: LIFT_CHORD.map(this.hz), detune: m.sawDetune, gain: m.lift * 0.5, dur: barSec(this.bpm) });
    }
  }
}

export interface RenderOpts {
  bars: number;
  layers?: Iterable<Layer>;
  demo?: boolean;
  sampleRate?: number;
}

/** Renders the groove faster than real time, deterministically; for checks and WAV export. */
export async function renderGroove(m: MusicSettings, o: RenderOpts): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? 44100;
  const seconds = o.bars * barSec() + 1;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const g = new Groove(ctx, ctx.destination, m);
  if (o.layers) g.layers = new Set(o.layers);
  g.demo = o.demo ?? false;
  for (let i = 0; i < o.bars * STEPS_PER_BAR; i++) g.play(i, i * stepSec());
  return ctx.startRendering();
}
