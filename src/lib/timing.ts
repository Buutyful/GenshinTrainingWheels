import type { FlatStep, TrackerEvent } from './engine';
import type { ActionType, RotationStep, Timings } from './types';

/** Rough time from landing an action to starting the next one, until the player's own pace is known. */
export const DEFAULT_GAP: Record<ActionType, number> = {
  swap: 300,
  skill: 700,
  skillHold: 900,
  burst: 1700,
  na: 350,
  ca: 700,
  dash: 450,
  jump: 500,
};

const CLICK_MS = 330;

export function timingSig(steps: RotationStep[], loop: boolean): string {
  return `${loop ? 'L' : 'O'}|${steps.map((s) => `${s.slot}${s.action}${s.count ?? ''}`).join(',')}`;
}

export function defaultTimings(steps: FlatStep[], sig: string): Timings {
  return {
    sig,
    gap: steps.map((s) => DEFAULT_GAP[s.action]),
    span: steps.map((s) => (s.action === 'na' ? (s.count - 1) * CLICK_MS : 0)),
  };
}

/** Saved timings are only trusted for the exact rotation they were measured on. */
export function resolveTimings(saved: Timings | undefined, steps: FlatStep[], sig: string): Timings {
  if (saved && saved.sig === sig && saved.gap.length === steps.length && saved.span.length === steps.length) {
    return { sig, gap: [...saved.gap], span: [...saved.span] };
  }
  return defaultTimings(steps, sig);
}

const blend = (old: number, sample: number) => Math.round(old + 0.35 * (sample - old));

/**
 * Learns the player's rhythm from consecutive correct steps. Anything measured across a
 * mistake, a skip or a pause is thrown away, so the cues converge on how the rotation
 * feels when it goes right.
 */
export class TimingLearner {
  private last: { index: number; t: number } | null = null;
  private startT: number | null = null;
  learned = false;

  constructor(
    private steps: FlatStep[],
    readonly timings: Timings,
  ) {}

  onEvent(e: TrackerEvent): void {
    switch (e.kind) {
      case 'progress':
        if (e.clicks === 1) {
          this.sampleGap(e.index, e.t);
          this.startT = e.t;
        }
        break;
      case 'hit': {
        const step = this.steps[e.index];
        if (step.action === 'na' && step.count > 1 && this.startT !== null) {
          const v = e.t - this.startT;
          if (v > 30 && v < 6000) this.timings.span[e.index] = blend(this.timings.span[e.index], v);
        } else {
          this.sampleGap(e.index, e.t);
        }
        this.last = { index: e.index, t: e.t };
        this.startT = null;
        break;
      }
      case 'skip':
      case 'wrong':
      case 'offtrack':
      case 'resync':
        this.last = null;
        this.startT = null;
        break;
    }
  }

  private sampleGap(index: number, t: number): void {
    const last = this.last;
    if (!last || index !== (last.index + 1) % this.steps.length) return;
    const v = t - last.t;
    if (v < 30 || v > 6000) return;
    this.timings.gap[last.index] = blend(this.timings.gap[last.index], v);
    this.learned = true;
  }
}
