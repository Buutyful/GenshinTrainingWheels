import type { FlatStep, Tracker, TrackerEvent } from './engine';
import { isNoise } from './types';
import type { CharMetrics, GameAction, RunMetrics, Slot, StepAction } from './types';

const emptyChar = (): CharMetrics => ({ fieldMs: 0, actions: {}, hits: 0, missed: 0, wrong: 0, entries: 0 });

/**
 * Watches a run and keeps what the metrics window shows: who was on field for how long,
 * what each character actually did, and how each lap went against the target time.
 */
export class MetricsCollector {
  readonly chars: CharMetrics[] = [0, 1, 2, 3].map(emptyChar);
  trackedMs = 0;
  offTrackMs = 0;
  pausedMs = 0;
  swaps = 0;
  inputs = 0;
  private lastT: number | null = null;
  private onField: Slot | null = null;
  /** Step durations: time of the previous input in this lap, this lap's samples, and the totals. */
  private prevHitT: number | null = null;
  private pending = new Map<number, number>();
  private durSum: number[];
  private durN: number[];

  constructor(
    private steps: FlatStep[],
    private tracker: Tracker,
    private sig: string,
    private targetMs: number | null,
  ) {
    this.durSum = steps.map(() => 0);
    this.durN = steps.map(() => 0);
  }

  /** Credits the time since the last call to whoever was on field. Call before every event. */
  accrue(t: number, active: Slot): void {
    const tr = this.tracker;
    if (this.lastT !== null && tr.startT !== null && t > this.lastT) {
      const dt = t - this.lastT;
      if (tr.status === 'tracking') {
        this.trackedMs += dt;
        this.chars[this.onField ?? active].fieldMs += dt;
      } else if (tr.status === 'offtrack') {
        if (tr.offReason === 'idle') this.pausedMs += dt;
        else this.offTrackMs += dt;
      }
    }
    this.lastT = t;
    if (this.onField !== active) {
      if (tr.status === 'tracking' && this.onField !== null) this.chars[active].entries++;
      this.onField = active;
    }
  }

  onAction(a: GameAction): void {
    if (this.tracker.startT === null && this.tracker.status === 'armed') return;
    if (a.type === 'swap') {
      this.swaps++;
      return;
    }
    this.inputs++;
    const acts = this.chars[a.slot].actions;
    acts[a.type as StepAction] = (acts[a.type as StepAction] ?? 0) + 1;
  }

  onEvent(e: TrackerEvent): void {
    switch (e.kind) {
      case 'start':
        this.lastT = e.t;
        // The run starts on its first input, so that step has no measurable duration.
        this.prevHitT = null;
        this.pending.clear();
        this.chars[this.steps[this.tracker.pointer]?.slot ?? 0].entries++;
        return;
      case 'hit':
        if (this.prevHitT !== null) this.pending.set(e.index, e.t - this.prevHitT);
        this.prevHitT = e.t;
        if (!isNoise(this.steps[e.index].action)) this.chars[this.steps[e.index].slot].hits++;
        return;
      case 'skip':
        // Skips are either all penalised or (when rejoining after a pause) none are.
        if (e.missed > 0) for (const i of e.indices) if (!isNoise(this.steps[i].action)) this.chars[this.steps[i].slot].missed++;
        return;
      case 'wrong':
        this.chars[e.action.slot].wrong++;
        return;
      case 'lap': {
        // Only laps played through count; an abandoned one would skew every step after the break.
        const rec = this.tracker.laps[this.tracker.laps.length - 1];
        if (rec && !rec.aborted) {
          for (const [i, d] of this.pending) {
            this.durSum[i] += d;
            this.durN[i]++;
          }
        }
        this.pending.clear();
        this.prevHitT = e.t;
        return;
      }
      case 'offtrack':
        this.pending.clear();
        this.prevHitT = null;
        return;
      case 'resync':
        this.prevHitT = e.t;
        return;
    }
  }

  result(): RunMetrics {
    const tr = this.tracker;
    return {
      chars: this.chars.map((c) => ({ ...c, actions: { ...c.actions } })),
      laps: tr.laps.filter((l) => !l.aborted).map((l) => ({ ms: l.durationMs, clean: l.clean, errors: l.errors })),
      targetMs: this.targetMs,
      trackedMs: this.trackedMs,
      offTrackMs: this.offTrackMs,
      pausedMs: this.pausedMs,
      swaps: this.swaps,
      inputs: this.inputs,
      steps: {
        sig: this.sig,
        missed: tr.stats.map((s) => s.missed),
        wrong: tr.stats.map((s) => s.wrongAt),
        durMs: this.durSum.map((s, i) => (this.durN[i] ? Math.round(s / this.durN[i]) : 0)),
        durN: [...this.durN],
      },
    };
  }
}
