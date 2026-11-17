// Rhythm-mode judging: *which* step the player is on is the tracker's job; this only says *when*
// they played it compared with the track. Pure, so it is tested without audio.

import type { FlatStep } from './engine';
import { isNoise } from './types';
import type { Grade, RhythmMetrics } from './types';

/** Judgement windows, ms either side of the target. Constants on purpose: they will need tuning. */
export const WINDOWS = { perfect: 50, good: 110, hit: 250 };

/** Attacks, dashes and jumps are never errors; their windows are this much wider and they never miss. */
export const LOOSE = 2;

/**
 * Every cue reaches the speakers this long after its beat (the rig's limiter look-ahead, measured
 * 6–7 ms). The player hears the beat then, so targets move with it.
 */
export const CHAIN_DELAY_MS = 6.5;

/** Misses in a row after which the player has lost the beat and the track re-aligns to them. */
export const LOST_AFTER = 4;

export const GRADES: Grade[] = ['perfect', 'good', 'early', 'late', 'miss'];

export const GRADE_LABEL: Record<Grade, string> = { perfect: 'Perfect', good: 'Good', early: 'Early', late: 'Late', miss: 'Miss' };

/** Grade for an input `deltaMs` after its target (negative: early). */
export function grade(deltaMs: number, loose = false): Grade {
  const w = loose ? LOOSE : 1;
  const d = Math.abs(deltaMs);
  if (d <= WINDOWS.perfect * w) return 'perfect';
  if (d <= WINDOWS.good * w) return 'good';
  if (d <= WINDOWS.hit * w || loose) return deltaMs < 0 ? 'early' : 'late';
  return 'miss';
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Signed distance, in 16ths, from global position `g` (fractional) to the nearest time the lap's
 * 16th `pos` plays, with lap 16th 0 at global step `offset`.
 */
export function lapDelta(g: number, offset: number, pos: number, length: number): number {
  const d = mod(g - offset - pos, length);
  return d > length / 2 ? d - length : d;
}

export interface Judgement {
  index: number;
  grade: Grade;
  /** Null for a step that was skipped outright. */
  deltaMs: number | null;
}

const emptyCounts = (): Record<Grade, number> => ({ perfect: 0, good: 0, early: 0, late: 0, miss: 0 });

/** Collects a run's judgements: totals, the player's average offset and spread, and per step. */
export class RhythmJudge {
  readonly counts = emptyCounts();
  /** Consecutive misses (timing misses and skipped steps). */
  missStreak = 0;
  /** Consecutive perfect or good judgements. */
  streak = 0;
  bestStreak = 0;
  private sum = 0;
  private sumSq = 0;
  private timed = 0;
  private n: number[];
  private stepSum: number[];
  private misses: number[];

  constructor(
    private steps: FlatStep[],
    private sig: string,
    private latencyMs = 0,
  ) {
    this.n = steps.map(() => 0);
    this.stepSum = steps.map(() => 0);
    this.misses = steps.map(() => 0);
  }

  get total(): number {
    return GRADES.reduce((s, g) => s + this.counts[g], 0);
  }

  /** The player started step `index` `deltaMs` after its target. */
  hit(index: number, deltaMs: number): Judgement {
    const g = grade(deltaMs, isNoise(this.steps[index].action));
    if (g === 'miss') {
      this.misses[index]++;
    } else {
      this.sum += deltaMs;
      this.sumSq += deltaMs * deltaMs;
      this.timed++;
      this.n[index]++;
      this.stepSum[index] += deltaMs;
    }
    return this.count({ index, grade: g, deltaMs });
  }

  /** Step `index` was left out while the track was playing. Attacks and movement never miss. */
  skipped(index: number): Judgement | null {
    if (isNoise(this.steps[index].action)) return null;
    this.misses[index]++;
    return this.count({ index, grade: 'miss', deltaMs: null });
  }

  private count(j: Judgement): Judgement {
    this.counts[j.grade]++;
    if (j.grade === 'miss') {
      this.missStreak++;
      this.streak = 0;
    } else {
      this.missStreak = 0;
      if (j.grade === 'perfect' || j.grade === 'good') this.bestStreak = Math.max(this.bestStreak, ++this.streak);
      else this.streak = 0;
    }
    return j;
  }

  result(): RhythmMetrics {
    const mean = this.timed ? this.sum / this.timed : null;
    return {
      counts: { ...this.counts },
      meanMs: mean,
      spreadMs: mean === null ? null : Math.sqrt(Math.max(0, this.sumSq / this.timed - mean * mean)),
      bestStreak: this.bestStreak,
      latencyMs: this.latencyMs,
      steps: {
        sig: this.sig,
        n: [...this.n],
        meanMs: this.n.map((k, i) => (k ? Math.round(this.stepSum[i] / k) : 0)),
        misses: [...this.misses],
      },
    };
  }
}

/** Share of judged steps that were perfect or good. */
export function onBeat(c: Record<Grade, number>): number | null {
  const total = GRADES.reduce((s, g) => s + c[g], 0);
  return total ? (c.perfect + c.good) / total : null;
}

// ---------------------------------------------------------------- latency calibration

/** Each tap's distance to its nearest beat, ms; beat k is heard at `beat0 + k·beatMs`. */
export function tapOffsets(taps: number[], beat0: number, beatMs: number): number[] {
  return taps.map((t) => {
    const k = Math.round((t - beat0) / beatMs);
    return t - (beat0 + k * beatMs);
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Calibration {
  /** How late the player's presses land after the click they hear, ms. */
  latencyMs: number;
  /** Median distance of a tap from that value, ms: how steady the taps were. */
  spreadMs: number;
  /** Taps used (stray ones far from the rest are left out). */
  used: number;
}

/** Minimum taps for a calibration to count. */
export const MIN_TAPS = 8;

/**
 * The median offset of the taps (robust to a stray press), after dropping taps more than
 * 120 ms from a first median. Null when there are too few taps to trust.
 */
export function calibrate(offsets: number[]): Calibration | null {
  if (offsets.length < MIN_TAPS) return null;
  const m0 = median(offsets);
  const kept = offsets.filter((o) => Math.abs(o - m0) <= 120);
  if (kept.length < MIN_TAPS) return null;
  const m = median(kept);
  return { latencyMs: Math.round(m), spreadMs: Math.round(median(kept.map((o) => Math.abs(o - m)))), used: kept.length };
}
