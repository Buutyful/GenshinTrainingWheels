import type { FlatStep, Tracker, TrackerEvent } from './engine';
import type { AudioSettings, Timings } from './types';

export type Sfx = 'tick' | 'error' | 'offtrack' | 'resync' | 'lap' | 'lapClean' | 'done';

export interface CueOutput {
  /**
   * Plays the sound that identifies a step, starting at `at` (epoch ms). When `due` is given,
   * a build-up rises from the cue and resolves at that moment — the moment to press.
   */
  cue(step: FlatStep, at: number, due: number | null): void;
  /** Silences a build-up that is still rising: the player already pressed. */
  cutBuildup(): void;
  sfx(name: Sfx): void;
}

/** How far ahead of the audio clock cues are handed over; covers the 50 ms update interval. */
const LOOKAHEAD_MS = 60;
const MIN_BUILDUP_MS = 300;

/**
 * Decides what the player hears, and when.
 *
 * A cue that sounds at the instant a key is due is useless: by the time it is heard and
 * understood, the moment has passed. So the director predicts when each upcoming step is
 * due from the player's own rhythm and plays its cue `leadMs` earlier. Steps that follow
 * each other faster than the lead time are cued back to back, as a phrase to be echoed.
 *
 * - full: every step gets a lead-in cue.
 * - swaps: only character swaps do.
 * - adaptive: no lead-ins; the pending step is cued only when the player is late or slips.
 */
export class CueDirector {
  private cued = new Map<number, Set<number>>();
  private reminded = '';
  private replay = false;
  private armedCued = false;
  private riserEnd = 0;

  constructor(
    private tracker: Tracker,
    private timings: Timings,
    private cfg: AudioSettings,
    private out: CueOutput,
  ) {}

  onEvent(e: TrackerEvent): void {
    const fb = this.cfg.feedback;
    switch (e.kind) {
      case 'start':
        this.armedCued = false;
        break;
      case 'hit':
        this.out.cutBuildup();
        this.riserEnd = 0;
        if (this.cfg.hitTick) this.out.sfx('tick');
        break;
      case 'skip':
        if (e.missed > 0) {
          if (fb) this.out.sfx('error');
          this.replay = true;
        }
        break;
      case 'wrong':
        if (fb) this.out.sfx('error');
        this.replay = true;
        break;
      case 'offtrack':
        this.out.cutBuildup();
        if (fb && e.reason === 'errors') this.out.sfx('offtrack');
        break;
      case 'resync':
        if (fb) this.out.sfx('resync');
        break;
      case 'lap':
        if (fb) this.out.sfx(e.clean ? 'lapClean' : 'lap');
        break;
      case 'done':
        if (fb) this.out.sfx('done');
        break;
    }
  }

  /** Call after every batch of tracker updates and on every timer tick. */
  update(now: number): void {
    const t = this.tracker;
    const mode = this.cfg.guidance;
    const n = t.steps.length;
    if (mode === 'off' || t.status === 'done' || t.status === 'offtrack' || !n) {
      this.replay = false;
      return;
    }

    if (t.status === 'armed') {
      // No rhythm yet: say once what the opening move is.
      if (!this.armedCued && mode !== 'adaptive') {
        this.armedCued = true;
        this.out.cue(t.steps[t.pointer], now, null);
      }
      this.replay = false;
      return;
    }

    const p = t.pointer;
    const inProgress = t.naClicks > 0;
    const prev = t.prevIndex(p);
    // The moment the pending step should start (or, for a started attack string, finish).
    const expected = inProgress ? t.stepStartT + this.timings.span[p] : t.lastProgressT + this.timings.gap[prev];

    if (!inProgress && (mode !== 'swaps' || t.steps[p].action === 'swap')) {
      const key = `${t.lap}:${p}`;
      const late = now - expected >= this.cfg.hesitateMs && this.reminded !== key;
      if (this.replay || late) {
        this.reminded = key;
        this.mark(t.lap, p);
        // After a mistake, let the error sound finish before repeating what was expected.
        this.out.cue(t.steps[p], now + (this.replay ? 220 : 0), null);
      }
    }
    this.replay = false;
    if (mode === 'adaptive') return;

    // Walk the predicted timeline and hand over every cue that is about to be due. A late
    // player freezes the timeline at "now", so cues never run more than one lead ahead.
    let start = Math.max(expected, now);
    let j = p;
    let lap = t.lap;
    for (let k = 0; k < n; k++) {
      let landed: number;
      if (k === 0 && inProgress) {
        landed = start;
      } else {
        const cueAt = start - this.cfg.leadMs;
        if (cueAt > now + LOOKAHEAD_MS) break;
        if (this.mark(lap, j) && (mode === 'full' || t.steps[j].action === 'swap')) {
          this.play(t.steps[j], Math.max(cueAt, now), start);
        }
        landed = start + this.timings.span[j];
      }
      start = landed + this.timings.gap[j];
      if (++j >= n) {
        if (!t.loop) break;
        j = t.loopStart;
        lap++;
      }
    }
  }

  private play(step: FlatStep, at: number, due: number): void {
    // One build-up at a time: in a fast run it belongs to the first step, the rest follow its beat.
    const buildup = this.cfg.buildup && due - at >= MIN_BUILDUP_MS && at >= this.riserEnd - 50;
    if (buildup) this.riserEnd = due;
    this.out.cue(step, at, buildup ? due : null);
  }

  /** Records that a step of a lap was cued; false when it already had been. */
  private mark(lap: number, index: number): boolean {
    let set = this.cued.get(lap);
    if (!set) {
      set = new Set();
      this.cued.set(lap, set);
      for (const old of this.cued.keys()) if (old < lap - 1) this.cued.delete(old);
    }
    if (set.has(index)) return false;
    set.add(index);
    return true;
  }
}
