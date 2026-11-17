import type { FlatStep, TrackerEvent } from '../engine';
import type { RhythmTrack, Timings } from '../types';
import type { Trigger } from './cuelayer';
import { barSec, BPM, stepSec, STEPS_PER_BAR } from './patterns';

/** The flat steps one lap of music covers: the looping part, or everything for a one-shot. */
export function lapRange(steps: FlatStep[], loop: boolean): [number, number] {
  const entry = steps.findIndex((s) => s.loopEntry);
  return [loop && entry > 0 ? entry : 0, steps.length];
}

/** Epoch-ms times of one lap: when each step began and when it landed (last click). */
export interface CleanLap {
  start: (number | null)[];
  end: (number | null)[];
  /**
   * When step `ref` was played again in the next lap: the two give the lap's exact length.
   * Null when the run ended first; the learned timings then estimate it.
   */
  ref: number | null;
  next: number | null;
}

/**
 * Listens to tracker events and hands over every clean lap of the looping part with the time
 * of each step. Steps the tracker passes over silently (a moot swap) stay null.
 *
 * A clean lap is held until the next lap repeats one of its steps, because only that says how
 * long the pause after the last step really was. If the run ends or goes wrong first, it is handed over
 * anyway and the learned timings fill in.
 */
export class LapRecorder {
  private start: (number | null)[];
  private end: (number | null)[];
  private from: number;
  private to: number;
  /** Something went wrong since the lap began, or recording started mid-lap. */
  private dirty = true;
  private pending: CleanLap | null = null;

  constructor(
    private steps: FlatStep[],
    loop: boolean,
    private onClean: (lap: CleanLap) => void,
  ) {
    [this.from, this.to] = lapRange(steps, loop);
    this.start = steps.map(() => null);
    this.end = steps.map(() => null);
  }

  private reset(dirty: boolean): void {
    this.start.fill(null);
    this.end.fill(null);
    this.dirty = dirty;
  }

  /** Hands over a held lap without its successor; call when the run ends. */
  flush(): void {
    if (this.pending) this.onClean(this.pending);
    this.pending = null;
  }

  private began(index: number, t: number): void {
    const p = this.pending;
    // The first lap has no opening swap (the player starts on that character), so wait for a
    // step this lap really has.
    if (!p || index < this.from || index >= this.to || p.start[index] === null) return;
    this.pending = null;
    p.ref = index;
    p.next = t;
    this.onClean(p);
  }

  onEvent(e: TrackerEvent): void {
    switch (e.kind) {
      case 'start':
        this.pending = null;
        return this.reset(false);
      case 'progress':
        if (e.clicks === 1) {
          this.began(e.index, e.t);
          this.start[e.index] = e.t;
        }
        return;
      case 'hit':
        if (this.start[e.index] === null) {
          this.began(e.index, e.t);
          this.start[e.index] = e.t;
        }
        this.end[e.index] = e.t;
        return;
      case 'skip':
        // Leaving out attacks or movement is allowed; leaving out a real step is not.
        if (e.missed > 0) this.dirty = true;
        return;
      case 'wrong':
      case 'offtrack':
      case 'resync':
      case 'done':
        this.flush();
        this.dirty = true;
        return;
      case 'lap': {
        const covers = this.end[this.to - 1] !== null && this.start.slice(this.from, this.to).some((t) => t !== null);
        if (e.clean && !this.dirty && covers) {
          this.flush();
          this.pending = { start: [...this.start], end: [...this.end], ref: null, next: null };
        }
        return this.reset(false);
      }
    }
  }
}

/**
 * Quantises a clean lap onto the 128 BPM grid.
 *
 * The lap's length (a step to the same step in the next lap) is rounded to whole bars, so the lap
 * is stretched by the few percent that takes; a grid fitted through all presses then snaps every
 * step to its nearest 16th. Tempo never changes per loadout. Steps the player never pressed (a
 * moot swap) are placed from the learned gaps.
 */
export function buildTrack(steps: FlatStep[], loop: boolean, lap: CleanLap, timings: Timings, recordedAt = Date.now()): RhythmTrack {
  const [from, to] = lapRange(steps, loop);
  // The first step that was really played; filled-in steps are placed around it, not vice versa.
  let real = from;
  while (real < to - 1 && lap.start[real] === null) real++;
  const start = [...lap.start];
  const end = [...lap.end];

  // Fill gaps backwards from the next known step, then forwards for any trailing ones.
  for (let i = to - 2; i >= from; i--) {
    if (start[i] === null && start[i + 1] !== null) {
      end[i] ??= start[i + 1]! - timings.gap[i];
      start[i] = end[i]! - timings.span[i];
    }
  }
  for (let i = from + 1; i < to; i++) {
    if (start[i] === null && end[i - 1] !== null) start[i] = end[i - 1]! + timings.gap[i - 1];
  }
  for (let i = from; i < to; i++) {
    if (start[i] === null) start[i] = end[i] ?? 0;
    if (end[i] === null || end[i]! < start[i]!) end[i] = start[i];
  }

  const measured = lap.ref !== null && lap.next !== null ? lap.next - lap.start[lap.ref]! : null;
  const lapMs = Math.max(1, measured ?? end[to - 1]! - start[from]! + timings.gap[to - 1]);
  const stepMs = stepSec(BPM) * 1000;
  const count = to - from;

  let bars = Math.max(1, Math.round(lapMs / (barSec(BPM) * 1000)));
  // Every step needs its own 16th; a very dense lap gets more bars rather than collisions.
  while (bars * STEPS_PER_BAR < count) bars++;
  const n = bars * STEPS_PER_BAR;

  // Fit one grid, t ≈ origin + unit·k, through every press that really happened (and the next
  // lap's repeat, n 16ths later). Least squares averages human jitter out instead of letting the
  // error of one or two presses decide the lap length and pile up towards its end.
  const presses: { t: number; i: number }[] = [];
  for (let i = from; i < to; i++) if (lap.start[i] !== null) presses.push({ t: lap.start[i]!, i });
  const anchor = start[real]!;

  const fit = (unit0: number, fitTempo: boolean) => {
    let unit = unit0;
    // Start from the grid phase that suits all presses best (a search, so no single press sets it).
    let origin = anchor;
    let best = Infinity;
    for (let f = -0.5; f < 0.5; f += 1 / 64) {
      const o = anchor + f * unit;
      const c = presses.reduce((sum, p) => {
        const r = (p.t - o) / unit;
        return sum + (r - Math.round(r)) ** 2;
      }, 0);
      if (c < best - 1e-9) [best, origin] = [c, o];
    }
    const kOf = (t: number) => Math.round((t - origin) / unit);
    const points = () => {
      const pts = presses.map((p) => ({ t: p.t, k: kOf(p.t) }));
      if (measured !== null) pts.push({ t: lap.next!, k: kOf(lap.start[lap.ref!]!) + n });
      return pts;
    };
    for (let iter = 0; iter < 4; iter++) {
      const pts = points();
      const mk = pts.reduce((a, p) => a + p.k, 0) / pts.length;
      const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length;
      let cov = 0;
      let vk = 0;
      for (const p of pts) {
        cov += (p.k - mk) * (p.t - mt);
        vk += (p.k - mk) ** 2;
      }
      if (fitTempo && vk > 0) unit = Math.min(1.25 * stepMs, Math.max(0.8 * stepMs, cov / vk));
      origin = mt - unit * mk;
    }
    const cost = points().reduce((sum, p) => sum + (p.t - origin - unit * p.k) ** 2, 0);
    return { origin, unit, cost, kOf };
  };
  // Two starting guesses: the plain 128 BPM 16th, and the lap stretched to whole bars. The
  // tempo is only fitted when the next lap pins the length down.
  const candidates = [fit(stepMs, measured !== null)];
  if (measured !== null) candidates.push(fit(lapMs / n, true));
  const k = candidates.reduce((a, b) => (b.cost < a.cost ? b : a)).kOf;
  // The lap starts on its first step (estimated or real), but never pushes a real one off its 16th.
  const base = Math.min(k(start[from]!), k(start[real]!) - (real - from));
  const q = (t: number) => k(t) - base;

  const pos = steps.map(() => -1);
  const fin = steps.map(() => -1);
  for (let i = from; i < to; i++) {
    pos[i] = Math.max(0, q(start[i]!));
    fin[i] = Math.max(pos[i], q(end[i]!));
  }
  // Strictly in order: a step starts after the previous one landed...
  for (let i = from + 1; i < to; i++) {
    pos[i] = Math.max(pos[i], fin[i - 1] + 1);
    fin[i] = Math.max(fin[i], pos[i]);
  }
  // ...and everything fits inside the lap.
  for (let i = to - 1; i >= from; i--) {
    const limit = i === to - 1 ? n - 1 : pos[i + 1] - 1;
    fin[i] = Math.min(fin[i], limit);
    pos[i] = Math.min(pos[i], fin[i]);
  }
  return { sig: timings.sig, bpm: BPM, bars, pos, end: fin, lapMs: Math.round(lapMs), recordedAt };
}

/** A saved track is only used for the exact rotation it was recorded on. */
export function validTrack(track: RhythmTrack | undefined, steps: FlatStep[], sig: string): RhythmTrack | null {
  return track && track.sig === sig && track.pos.length === steps.length && track.end.length === steps.length ? track : null;
}

export interface ArrEvent {
  pos: number;
  step: number;
  trigger: Trigger;
}

export interface Arrangement {
  bars: number;
  /** Lap length in 16ths. */
  length: number;
  events: ArrEvent[];
  /** Per flat step: its 16th in the lap (what rhythm mode will judge against), -1 if none. */
  targets: number[];
  /** Events per 16th of the lap. */
  at: Map<number, Trigger[]>;
}

/** What each action sounds like in the track. Every element means an action. */
export function triggersFor(step: FlatStep): Trigger[] {
  switch (step.action) {
    case 'swap':
      return [{ kind: 'swap', slot: step.slot }];
    case 'skill':
      return [{ kind: 'skill' }];
    case 'skillHold':
      return [{ kind: 'hold' }];
    case 'burst':
      return [{ kind: 'burst' }];
    case 'na':
      return [{ kind: 'attack', first: true }];
    case 'ca':
      return [{ kind: 'charged' }];
    case 'dash':
      return [{ kind: 'dash' }];
    case 'jump':
      return [{ kind: 'jump' }];
  }
}

export function arrange(steps: FlatStep[], track: RhythmTrack): Arrangement {
  const length = track.bars * STEPS_PER_BAR;
  const events: ArrEvent[] = [];
  steps.forEach((s, i) => {
    const p = track.pos[i];
    if (p < 0) return;
    if (s.action === 'na' && s.count > 1) {
      // One tick per click, spread evenly from the first click to the last.
      const span = track.end[i] - p;
      for (let k = 0; k < s.count; k++) {
        events.push({ pos: p + Math.round((k * span) / (s.count - 1)), step: i, trigger: { kind: 'attack', first: k === 0 } });
      }
    } else {
      for (const trigger of triggersFor(s)) events.push({ pos: p, step: i, trigger });
    }
  });
  const at = new Map<number, Trigger[]>();
  for (const e of events) at.set(e.pos, [...(at.get(e.pos) ?? []), e.trigger]);
  return { bars: track.bars, length, events, targets: [...track.pos], at };
}

/** An arrangement from explicit events, e.g. the Jam lab's demo. */
export function fromEvents(bars: number, events: { pos: number; trigger: Trigger }[]): Arrangement {
  const at = new Map<number, Trigger[]>();
  for (const e of events) at.set(e.pos, [...(at.get(e.pos) ?? []), e.trigger]);
  return { bars, length: bars * STEPS_PER_BAR, events: events.map((e) => ({ ...e, step: -1 })), targets: [], at };
}

/** A 4-bar rotation-like demo that uses every cue once or more. */
export const DEMO = fromEvents(4, [
  { pos: 0, trigger: { kind: 'swap', slot: 0 } },
  { pos: 2, trigger: { kind: 'skill' } },
  { pos: 8, trigger: { kind: 'swap', slot: 1 } },
  { pos: 10, trigger: { kind: 'burst' } },
  { pos: 14, trigger: { kind: 'skill' } },
  { pos: 20, trigger: { kind: 'swap', slot: 2 } },
  { pos: 22, trigger: { kind: 'hold' } },
  { pos: 30, trigger: { kind: 'dash' } },
  { pos: 32, trigger: { kind: 'swap', slot: 3 } },
  { pos: 34, trigger: { kind: 'attack', first: true } },
  { pos: 36, trigger: { kind: 'attack' } },
  { pos: 38, trigger: { kind: 'attack' } },
  { pos: 40, trigger: { kind: 'charged' } },
  { pos: 46, trigger: { kind: 'jump' } },
  { pos: 48, trigger: { kind: 'swap', slot: 0 } },
  { pos: 50, trigger: { kind: 'attack', first: true } },
  { pos: 52, trigger: { kind: 'attack' } },
  { pos: 54, trigger: { kind: 'attack' } },
  { pos: 56, trigger: { kind: 'charged' } },
]);
