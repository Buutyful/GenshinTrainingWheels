import * as Tone from 'tone';
import { cueGain, musicGain, onMix } from '../mix';
import { nowMs } from '../platform';
import { CHAIN_DELAY_MS, lapDelta } from '../rhythm';
import type { CueSound, Grade, MusicSettings } from '../types';
import type { Arrangement } from './arrange';
import { Band } from './band';
import { playCue, playJudgement, type Trigger } from './cuelayer';
import { stepSec, STEPS_PER_BAR } from './patterns';
import { Scheduler } from './scheduler';

export const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Audio-clock time of what is coming out of the speakers at epoch `tMs` (the same clock as
 * input timestamps). Used by judging and by the calibration, so both measure the same way.
 */
export function epochToAudio(raw: AudioContext, tMs: number): number {
  try {
    const ts = raw.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime) {
      return ts.contextTime + (tMs - (performance.timeOrigin + ts.performanceTime)) / 1000;
    }
  } catch {
    // Older engines: fall through to the estimate.
  }
  return raw.currentTime + (tMs - nowMs()) / 1000 - (raw.outputLatency || 0);
}

/** Lap offset that puts lap 16th `pos` at global step `g`, snapped to whole beats so the groove keeps its feel. */
export function beatOffset(g: number, pos: number): number {
  return Math.round((g - pos) / 4) * 4;
}

/** Cues sit this much above the mixer's Cues level, so they cut through a full band. */
const CUE_BOOST = 1.4;

/** Band plus cue layer on one Tone context, sharing one clock. */
class Rig {
  readonly band: Band;
  readonly music: Tone.Gain;
  readonly cues: Tone.Gain;
  readonly raw: BaseAudioContext;
  readonly cueIn: AudioNode;
  private limiter: Tone.Compressor;

  constructor(
    readonly ctx: Tone.BaseContext,
    m: MusicSettings,
    dest: Tone.InputNode,
    levels: { music: number; cues: number },
    private cueSound: () => CueSound = () => 'sounds',
  ) {
    this.band = new Band(ctx, m);
    this.music = new Tone.Gain({ context: ctx, gain: levels.music });
    this.cues = new Tone.Gain({ context: ctx, gain: levels.cues });
    // A fast, hard limiter last: drums and a cue landing together must never clip. (Tone's own
    // Limiter attacks too slowly to catch drum transients.)
    this.limiter = new Tone.Compressor({ context: ctx, threshold: -3, ratio: 20, knee: 0, attack: 0.001, release: 0.08 });
    this.band.out.connect(this.music);
    this.music.connect(this.limiter);
    this.cues.connect(this.limiter);
    this.limiter.connect(dest);
    // Cue sounds are plain Web Audio graphs built on Tone's own underlying context.
    this.raw = ctx.rawContext as unknown as BaseAudioContext;
    this.cueIn = this.cues.input as unknown as AudioNode;
  }

  step(g: number, time: number, triggers: Trigger[] | undefined): void {
    this.band.play(g, time);
    if (!triggers?.length) return;
    for (const t of triggers) {
      playCue(this.raw, this.cueIn, t, time, this.cueSound());
      if (t.kind === 'burst') this.band.accent(time);
    }
    this.band.duckAt(time);
  }

  dispose(): void {
    this.band.dispose();
    this.music.dispose();
    this.cues.dispose();
    this.limiter.dispose();
  }
}

/**
 * Plays rhythm mode: the band runs continuously on the 128 BPM grid and the cue layer plays the
 * arrangement's action cues on top. The music never waits for the player; when they go off
 * track only the cues drop out, and they come back aligned to the beat when the player rejoins.
 */
export class TrackPlayer {
  private ctx: Tone.Context | null = null;
  private rig: Rig | null = null;
  private sched: Scheduler | null = null;
  private arr: Arrangement | null;
  /** Global step where lap 16th 0 falls; null while the cues are off. */
  private offset: number | null = null;
  private loop: boolean;
  private pending: Trigger[] = [];
  private unsubscribe: (() => void) | null = null;
  /** Whether the grid has been re-phased to the player's first input. */
  anchored = false;

  constructor(
    private m: MusicSettings,
    arrangement: Arrangement | null,
    loop = true,
    /** Read on every cue, so switching sounds/voice is heard at once. */
    private cueSound: () => CueSound = () => 'sounds',
    /** Calibrated device latency, ms; read live. */
    private latencyMs: () => number = () => 0,
  ) {
    this.arr = arrangement;
    this.loop = loop;
  }

  get arrangement(): Arrangement | null {
    return this.arr;
  }

  get playing(): boolean {
    return this.offset !== null;
  }

  /**
   * Must run from a user gesture (Start). The band plays until the first input re-phases it, or
   * with `waitForPlayer` stays silent until that first input starts it.
   */
  async start(waitForPlayer = false): Promise<void> {
    if (!this.ctx) {
      // A plain browser context: Tone's default wrapper (standardized-audio-context) doubles the CPU cost.
      const ctx = new Tone.Context(new AudioContext({ latencyHint: 'interactive' }));
      ctx.lookAhead = 0;
      this.ctx = ctx;
      this.rig = new Rig(ctx, this.m, ctx.destination, { music: 0, cues: 0 }, this.cueSound);
      this.unsubscribe = onMix((mix) => {
        this.rig?.music.gain.rampTo(musicGain(mix), 0.03);
        this.rig?.cues.gain.rampTo(cueGain(mix) * CUE_BOOST, 0.03);
      });
      this.sched = new Scheduler(ctx, (g, t) => this.onStep(g, t));
      await this.rig.band.ready;
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (!this.sched!.running && !waitForPlayer) this.sched!.begin();
  }

  stop(): void {
    this.sched?.stop();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.rig?.dispose();
    void this.ctx?.close();
    this.ctx = null;
    this.rig = null;
    this.sched = null;
    this.offset = null;
    this.anchored = false;
  }

  /** Swap in a newly recorded track; it starts on the next step the player makes. */
  setArrangement(a: Arrangement | null): void {
    this.arr = a;
    this.offset = null;
  }

  /** Plays a cue on the next 16th (the Jam lab's pads). */
  trigger(t: Trigger): void {
    this.pending.push(t);
  }

  /**
   * Audio-clock time of the beat a press at epoch `tMs` was aimed at: what was heard then, less
   * the device's calibrated latency and the rig's own small delay before a cue is heard.
   */
  private aimedAt(tMs: number): number {
    const raw = this.ctx!.rawContext as unknown as AudioContext;
    return epochToAudio(raw, tMs) - (this.latencyMs() + CHAIN_DELAY_MS) / 1000;
  }

  /**
   * The player began a step at epoch `tMs`. `pos` is that step's 16th in the lap, or null for a
   * step outside it (the opener). The first call re-phases the beat to the player; later calls
   * bring the cues back in when they are off.
   *
   * Returns how far the step was from the track, ms (negative: early), when the track was
   * playing; null when this step only (re)aligned it or there is nothing to judge against.
   */
  stepStarted(tMs: number, pos: number | null): number | null {
    const ctx = this.ctx;
    const sched = this.sched;
    if (!ctx || !sched) return null;
    if (!this.anchored) {
      this.anchored = true;
      // Global step 0 is where this step's lap 16th falls, so it lands exactly on their input.
      const p = pos ?? 0;
      const at = this.aimedAt(tMs) - p * stepSec(sched.bpm);
      this.offset = pos !== null && this.arr ? 0 : null;
      // The input's own 16th is already due: play it now, then schedule onwards from the next one.
      this.onStep(p, ctx.currentTime);
      sched.begin(at, true, p + 1);
      return null;
    }
    if (pos === null || !this.arr) return null;
    const g = sched.position(this.aimedAt(tMs));
    if (this.offset === null) {
      this.offset = beatOffset(Math.round(g), pos);
      return null;
    }
    return lapDelta(g, this.offset, pos, this.arr.length) * stepSec(sched.bpm) * 1000;
  }

  /** A perfect / good / early / late / miss sound, now, on the cue bus. */
  judged(g: Grade): void {
    const rig = this.rig;
    if (!rig || !this.ctx) return;
    playJudgement(rig.raw, rig.cueIn, g, this.ctx.currentTime + 0.005);
  }

  /** Starts the arrangement's cues on the next bar line (the lab's demo). */
  alignNextBar(): void {
    if (!this.ctx || !this.sched?.running || !this.arr) return;
    this.offset = Math.ceil((this.sched.position() + 1) / STEPS_PER_BAR) * STEPS_PER_BAR;
  }

  /** Off track or finished: keep the band, drop the cues. */
  dropActions(): void {
    this.offset = null;
  }

  /** Where the music is, for the UI: beat in bar, and 16th in the lap when the track plays. */
  position(): { beat: number; lapStep: number | null; bars: number } | null {
    if (!this.ctx || !this.sched?.running) return null;
    const raw = this.ctx.rawContext as unknown as AudioContext;
    const g = Math.floor(this.sched.position(this.ctx.currentTime - (raw.outputLatency || 0)));
    const lapStep = this.offset !== null && this.arr ? mod(g - this.offset, this.arr.length) : null;
    return { beat: mod(Math.floor(g / 4), 4), lapStep, bars: this.arr?.bars ?? 0 };
  }

  private onStep(g: number, time: number): void {
    const rig = this.rig;
    if (!rig) return;
    const arr = this.arr;
    let triggers: Trigger[] | undefined;
    if (this.offset !== null && arr) {
      const rel = g - this.offset;
      if (!this.loop && rel >= arr.length) this.offset = null;
      else if (rel >= 0) triggers = arr.at.get(mod(rel, arr.length));
    }
    if (this.pending.length) {
      triggers = [...(triggers ?? []), ...this.pending];
      this.pending = [];
    }
    rig.step(g, time, triggers);
  }
}

export interface RenderOpts {
  bars: number;
  /** Cue triggers per 16th, e.g. an arrangement looped. */
  cuesAt?: (step: number) => Trigger[] | undefined;
  music?: boolean;
  cues?: boolean;
  cueSound?: CueSound;
  sampleRate?: number;
  /** First bar to play (for rendering a later section of an arrangement). */
  fromBar?: number;
  /** Render in one go (faster, but blocks the page); the default yields to keep the UI responsive. */
  blocking?: boolean;
}

/** Renders band and cues faster than real time, for measurements, the spectrogram and WAV export. */
export async function renderMusic(m: MusicSettings, o: RenderOpts): Promise<AudioBuffer> {
  const seconds = o.bars * STEPS_PER_BAR * stepSec() + 1.5;
  const sr = o.sampleRate ?? 44100;
  const ctx = new Tone.OfflineContext(new OfflineAudioContext(2, Math.ceil(seconds * sr), sr));
  const rig = new Rig(ctx, m, ctx.destination, { music: o.music === false ? 0 : m.volume, cues: o.cues === false ? 0 : 0.6 * CUE_BOOST }, () => o.cueSound ?? 'sounds');
  await rig.band.ready;
  const first = (o.fromBar ?? 0) * STEPS_PER_BAR;
  const bar = (k: number) => {
    for (let i = k * STEPS_PER_BAR; i < (k + 1) * STEPS_PER_BAR; i++) rig.step(first + i, i * stepSec(), o.cuesAt?.(i));
  };
  // Schedule bar by bar just ahead of the render, like live playback does. Creating every note
  // up front leaves thousands of idle nodes in the graph, slowing the render far beyond real use.
  const raw = ctx.rawContext as unknown as OfflineAudioContext;
  bar(0);
  for (let k = 1; k < o.bars; k++) {
    const at = Math.floor(((k * STEPS_PER_BAR * stepSec() - 0.2) * sr) / 128) * 128 / sr;
    void raw.suspend(at).then(() => {
      bar(k);
      void raw.resume();
    });
  }
  const buf = await ctx.render(!o.blocking);
  rig.dispose();
  return buf.get()!;
}
