import { BPM, stepSec } from './patterns';

/** Anything with an audio clock; the real AudioContext, or a fake one in tests. */
export interface Clock {
  readonly currentTime: number;
}

export const stepTime = (start: number, step: number, bpm = BPM) => start + step * stepSec(bpm);

/** Steps from `next` onwards whose start falls before `horizon`. */
export function dueSteps(next: number, start: number, horizon: number, bpm = BPM): number[] {
  const out: number[] = [];
  for (let i = next; stepTime(start, i, bpm) < horizon; i++) out.push(i);
  return out;
}

/** First step on a multiple of `grid` steps that starts at or after `t`. */
export function nextGridStep(start: number, t: number, grid = 1, bpm = BPM): number {
  const s = Math.ceil((t - start) / stepSec(bpm) - 1e-9);
  return Math.max(0, Math.ceil(s / grid) * grid);
}

export interface SchedulerOpts {
  bpm?: number;
  /** How far ahead events are queued, seconds. */
  lookahead?: number;
  /** How often the queue is topped up, ms. */
  intervalMs?: number;
  /** Steps due further in the past than this are dropped instead of played late. */
  maxLate?: number;
}

/**
 * Lookahead scheduler ("a tale of two clocks"): a coarse timer wakes up every ~25 ms and queues
 * every 16th that starts within the next ~100 ms at its exact audio-clock time. The timer only
 * decides *when to look*; every sound's timing comes from the audio clock.
 */
export class Scheduler {
  readonly bpm: number;
  private lookahead: number;
  private intervalMs: number;
  private maxLate: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private _start = 0;
  private next = 0;
  private _running = false;

  constructor(
    private clock: Clock,
    private onStep: (step: number, time: number) => void,
    opts: SchedulerOpts = {},
  ) {
    this.bpm = opts.bpm ?? BPM;
    this.lookahead = opts.lookahead ?? 0.1;
    this.intervalMs = opts.intervalMs ?? 25;
    this.maxLate = opts.maxLate ?? 0.03;
  }

  get running(): boolean {
    return this._running;
  }

  /** Audio time of step 0. */
  get start(): number {
    return this._start;
  }

  /** Starts step 0 at `at` (a little in the future by default so the first beat is not clipped). */
  begin(at = this.clock.currentTime + 0.06, timer = true): void {
    this.stop();
    this._start = at;
    this.next = 0;
    this._running = true;
    this.tick();
    if (timer) this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this._running = false;
  }

  /** Called by the timer; public so tests can drive it with a fake clock. */
  tick(): void {
    if (!this._running) return;
    const now = this.clock.currentTime;
    for (const i of dueSteps(this.next, this._start, now + this.lookahead, this.bpm)) {
      const t = stepTime(this._start, i, this.bpm);
      this.next = i + 1;
      // After a stall (a blocked main thread) skip what is gone rather than play it late.
      if (t < now - this.maxLate) continue;
      this.onStep(i, t);
    }
  }

  /** Musical position (in steps, fractional) at audio time `t`. */
  position(t = this.clock.currentTime): number {
    return (t - this._start) / stepSec(this.bpm);
  }

  timeOf(step: number): number {
    return stepTime(this._start, step, this.bpm);
  }

  /** First step on the `grid` that is still ahead of the queue, so a trigger can land on it. */
  nextFree(grid = 1): number {
    return Math.max(nextGridStep(this._start, this.clock.currentTime, grid, this.bpm), Math.ceil(this.next / grid) * grid);
  }
}
