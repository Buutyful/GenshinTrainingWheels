import { isNoise } from './types';
import type { ActionType, GameAction, RotationStep, Slot, TrackerSettings } from './types';

export interface FlatStep {
  slot: Slot;
  action: ActionType;
  count: number;
  /** Swap inserted because the rotation moves to another character. */
  implicit: boolean;
  /** Index into the loadout's steps, -1 for implicit swaps. */
  src: number;
  /** Consecutive steps on the same character share a block. */
  block: number;
}

/** Expands a rotation into the exact sequence of inputs the tracker expects, swaps included. */
export function flatten(steps: RotationStep[], loop: boolean): FlatStep[] {
  const out: FlatStep[] = [];
  if (!steps.length) return out;
  let prev: Slot = loop ? steps[steps.length - 1].slot : steps[0].slot;
  let block = -1;
  steps.forEach((s, i) => {
    if (i === 0 || s.slot !== steps[i - 1].slot) block++;
    if (s.slot !== prev) out.push({ slot: s.slot, action: 'swap', count: 1, implicit: true, src: -1, block });
    out.push({
      slot: s.slot,
      action: s.action,
      count: s.action === 'na' ? Math.max(1, s.count ?? 1) : 1,
      implicit: false,
      src: i,
      block,
    });
    prev = s.slot;
  });
  return out;
}

export type StepStatus = 'pending' | 'ok' | 'partial' | 'missed' | 'skipped';
export type TrackerStatus = 'armed' | 'tracking' | 'offtrack' | 'done';
export type OffReason = 'errors' | 'idle';

export type TrackerEvent =
  | { kind: 'start'; t: number }
  | { kind: 'hit'; index: number; t: number }
  /** A click of an attack string that is not finished yet. */
  | { kind: 'progress'; index: number; clicks: number; t: number }
  | { kind: 'skip'; indices: number[]; missed: number; t: number }
  | { kind: 'wrong'; action: GameAction; expected: number; t: number }
  | { kind: 'offtrack'; reason: OffReason; t: number }
  | { kind: 'resync'; index: number; t: number }
  | { kind: 'lap'; lap: number; durationMs: number; clean: boolean; t: number }
  | { kind: 'done'; t: number };

export interface StepStat {
  hits: number;
  missed: number;
  wrongAt: number;
}

export interface LapRecord {
  durationMs: number;
  errors: number;
  clean: boolean;
  /** Lap that was abandoned or finished while recovering; its duration means nothing. */
  aborted: boolean;
}

export interface Totals {
  hits: number;
  missed: number;
  wrong: number;
  skipped: number;
  extra: number;
}

/**
 * Follows the player through a rotation using only their inputs.
 *
 * Skills, bursts and swaps are judged strictly. Attacks, dashes and jumps are fuzzy: doing
 * them when expected advances the rotation, doing extra ones or leaving them out is never an
 * error, because click counts and movement cannot be verified from input alone.
 */
export class Tracker {
  status: TrackerStatus = 'armed';
  pointer = 0;
  /** Completed laps. */
  lap = 0;
  statuses: StepStatus[];
  naClicks = 0;
  consecutiveErrors = 0;
  offReason: OffReason | null = null;
  startT: number | null = null;
  lapStartT = 0;
  lastActivityT = 0;
  lastProgressT = 0;
  /** When the first click of the attack string in progress landed. */
  stepStartT = 0;
  lapErrors = 0;
  totals: Totals = { hits: 0, missed: 0, wrong: 0, skipped: 0, extra: 0 };
  stats: StepStat[];
  laps: LapRecord[] = [];

  private lastHit: GameAction | null = null;
  private recovering = false;
  private readonly entries: number[];
  private readonly firstReal: number;

  constructor(
    readonly steps: FlatStep[],
    readonly loop: boolean,
    private opts: TrackerSettings,
    private listener: (e: TrackerEvent) => void = () => {},
  ) {
    this.statuses = steps.map(() => 'pending');
    this.stats = steps.map(() => ({ hits: 0, missed: 0, wrongAt: 0 }));
    this.firstReal = steps[0]?.implicit ? 1 : 0;
    this.entries = [];
    steps.forEach((s, i) => {
      if (i === 0 || steps[i - 1].block !== s.block) {
        this.entries.push(i);
        if (s.implicit && i + 1 < steps.length) this.entries.push(i + 1);
      }
    });
    this.arm();
  }

  /** The player starts on the first character, so the wrap-around swap is skipped on lap one. */
  private arm(): void {
    this.status = 'armed';
    this.pointer = this.firstReal;
    this.naClicks = 0;
    this.statuses.fill('pending');
    if (this.firstReal === 1) this.statuses[0] = 'ok';
  }

  get accuracy(): number | null {
    const { hits, missed, wrong } = this.totals;
    const total = hits + missed + wrong;
    return total ? hits / total : null;
  }

  handle(a: GameAction): void {
    if (this.status === 'done' || !this.steps.length) return;
    this.lastActivityT = a.t;

    if (this.status === 'armed') {
      if (!this.matches(this.steps[this.pointer], a)) return;
      this.status = 'tracking';
      this.startT = a.t;
      this.lapStartT = a.t;
      this.listener({ kind: 'start', t: a.t });
    } else if (this.status === 'offtrack') {
      this.recover(a);
      return;
    }

    const cur = this.steps[this.pointer];
    if (this.matches(cur, a)) return this.progress(a);

    // Swapping back to the character the rotation is waiting on is a correction, not a mistake.
    if (a.type === 'swap' && cur.action !== 'swap' && a.slot === cur.slot) {
      this.totals.extra++;
      return;
    }
    // Mashing a key to make sure it comes out.
    const last = this.lastHit;
    if (
      !isNoise(a.type) &&
      last &&
      last.type === a.type &&
      last.slot === a.slot &&
      a.t - last.t <= this.opts.repeatWindowMs
    ) {
      this.totals.extra++;
      return;
    }

    const ahead = this.findAhead(a);
    if (ahead >= 0) {
      this.skipTo(ahead, a.t, true);
      return this.progress(a);
    }
    if (isNoise(a.type)) {
      this.totals.extra++;
      return;
    }
    this.wrong(a);
  }

  /** Call regularly so a player who stopped playing is paused instead of failed. */
  tick(now: number): void {
    if (this.status === 'tracking' && now - this.lastActivityT > this.opts.idleMs) {
      this.goOffTrack('idle', now);
    }
  }

  /** Back to the armed state, keeping the statistics collected so far. */
  restart(): void {
    if (this.status !== 'armed' && this.status !== 'done') {
      this.laps.push({ durationMs: 0, errors: this.lapErrors, clean: false, aborted: true });
    }
    this.lapErrors = 0;
    this.consecutiveErrors = 0;
    this.offReason = null;
    this.lastHit = null;
    this.arm();
  }

  private matches(step: FlatStep, a: GameAction): boolean {
    return step.action === a.type && step.slot === a.slot;
  }

  private progress(a: GameAction): void {
    const i = this.pointer;
    const cur = this.steps[i];
    this.lastProgressT = a.t;
    if (cur.action === 'na') {
      this.naClicks++;
      if (this.naClicks === 1) this.stepStartT = a.t;
      if (this.naClicks < cur.count) {
        this.listener({ kind: 'progress', index: i, clicks: this.naClicks, t: a.t });
        return;
      }
    }
    this.statuses[i] = 'ok';
    this.stats[i].hits++;
    this.totals.hits++;
    this.consecutiveErrors = 0;
    this.lastHit = a;
    this.listener({ kind: 'hit', index: i, t: a.t });
    this.advance(a.t);
  }

  private advance(t: number): void {
    this.pointer++;
    this.naClicks = 0;
    if (this.pointer >= this.steps.length) this.finishLap(t);
  }

  private finishLap(t: number): void {
    const aborted = this.recovering;
    const record: LapRecord = {
      durationMs: t - this.lapStartT,
      errors: this.lapErrors,
      clean: this.lapErrors === 0 && !aborted,
      aborted,
    };
    this.laps.push(record);
    this.lap++;
    this.listener({ kind: 'lap', lap: this.lap, durationMs: record.durationMs, clean: record.clean, t });
    if (this.loop) {
      this.pointer = 0;
      this.statuses.fill('pending');
      this.lapStartT = t;
      this.lapErrors = 0;
    } else {
      this.pointer = this.steps.length - 1;
      this.status = 'done';
      this.listener({ kind: 'done', t });
    }
  }

  /**
   * Looks for the step this action belongs to further down the rotation. Fuzzy actions may
   * only jump over other fuzzy steps; important actions may leave `maxSkip` important steps behind.
   */
  private findAhead(a: GameAction): number {
    const n = this.steps.length;
    let skippedMajor = 0;
    for (let k = 0; k < n; k++) {
      let idx = this.pointer + k;
      if (idx >= n) {
        if (!this.loop) break;
        idx -= n;
      }
      const s = this.steps[idx];
      if (k > 0 && this.matches(s, a)) return idx;
      if (!isNoise(s.action)) {
        skippedMajor++;
        if (isNoise(a.type) || skippedMajor > this.opts.maxSkip) break;
      }
    }
    return -1;
  }

  private skipTo(target: number, t: number, penalize: boolean): void {
    const skipped: number[] = [];
    let missed = 0;
    while (this.pointer !== target && this.status !== 'done') {
      const i = this.pointer;
      const s = this.steps[i];
      if (isNoise(s.action) || !penalize) {
        this.statuses[i] = s.action === 'na' && this.naClicks > 0 ? 'partial' : 'skipped';
        this.totals.skipped++;
      } else {
        this.statuses[i] = 'missed';
        this.stats[i].missed++;
        this.totals.missed++;
        this.lapErrors++;
        missed++;
      }
      skipped.push(i);
      this.advance(t);
    }
    if (skipped.length) this.listener({ kind: 'skip', indices: skipped, missed, t });
  }

  private wrong(a: GameAction): void {
    this.totals.wrong++;
    this.stats[this.pointer].wrongAt++;
    this.lapErrors++;
    this.consecutiveErrors++;
    this.listener({ kind: 'wrong', action: a, expected: this.pointer, t: a.t });
    if (this.consecutiveErrors >= this.opts.offTrackAfter) this.goOffTrack('errors', a.t);
  }

  private goOffTrack(reason: OffReason, t: number): void {
    this.status = 'offtrack';
    this.offReason = reason;
    this.listener({ kind: 'offtrack', reason, t });
  }

  /** While off track nothing is judged; we only wait for an action that places the player again. */
  private recover(a: GameAction): void {
    if (isNoise(a.type)) return;
    const target = this.findAnchor(a);
    if (target < 0) return;
    const penalize = this.offReason === 'errors';
    this.status = 'tracking';
    this.offReason = null;
    this.consecutiveErrors = 0;
    this.listener({ kind: 'resync', index: target, t: a.t });

    if (this.opts.policy === 'restart') {
      this.laps.push({ durationMs: 0, errors: this.lapErrors, clean: false, aborted: true });
      this.statuses.fill('pending');
      for (let i = 0; i < target; i++) this.statuses[i] = 'ok';
      this.pointer = target;
      this.naClicks = 0;
      this.lapStartT = a.t;
      this.lapErrors = 0;
    } else {
      this.recovering = true;
      this.skipTo(target, a.t, penalize);
      this.recovering = false;
    }
    this.progress(a);
  }

  private findAnchor(a: GameAction): number {
    const n = this.steps.length;
    if (this.opts.policy === 'restart') {
      if (this.matches(this.steps[this.firstReal], a)) return this.firstReal;
      if (this.firstReal === 1 && this.matches(this.steps[0], a)) return 0;
      return -1;
    }
    let best = -1;
    let bestDist = Infinity;
    const consider = (i: number) => {
      if (!this.matches(this.steps[i], a)) return;
      let d = i - this.pointer;
      if (d < 0) {
        if (!this.loop) return;
        d += n;
      }
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    };
    // Prefer the start of a character's block; fall back to anywhere in the rotation.
    for (const i of this.entries) consider(i);
    if (best < 0) for (let i = 0; i < n; i++) consider(i);
    return best;
  }
}
