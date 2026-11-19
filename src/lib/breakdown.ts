// The rotation as a timeline of character turns: when each starts, how long it should take and
// how long it took. Pure, so it is tested without the UI.

import type { FlatStep } from './engine';
import type { Timings } from './types';

export interface TurnRow {
  slot: FlatStep['slot'];
  /** Flattened steps of the turn, the swap into it included. */
  items: { s: FlatStep; i: number }[];
  /** Part of the opener (first rotation only). */
  opener: boolean;
  /** Loadout step that carries the turn's note (its first real action), -1 if none. */
  noteStep: number;
  /** Position on the timeline, from the start of its part (opener or loop). */
  startMs: number;
  endMs: number;
  planMs: number;
  /** Measured this run; null when none of its steps were. */
  actualMs: number | null;
  /** Time each item takes on the timeline, aligned with `items`; sums to `endMs - startMs`. */
  stepMs: number[];
  /** The tail of each `stepMs` spent on the step's own attack string; the rest is the wait before it. */
  actMs: number[];
}

export interface Breakdown {
  rows: TurnRow[];
  /** Timeline positions come from this run (`run`) or from the plan. */
  source: 'run' | 'plan';
  /** Plan is scaled to the rotation time (`target`) or is the player's learned pace. */
  plan: 'target' | 'pace';
}

/**
 * Splits `steps` into turns. `durMs`/`durN` are the run's measured step durations
 * (time from the previous input to this one); `timings` gives the planned ones.
 */
export function breakdown(
  steps: FlatStep[],
  loop: boolean,
  timings: Timings,
  targetMs: number | null,
  durMs?: number[],
  durN?: number[],
): Breakdown {
  const loopAt = Math.max(0, steps.findIndex((s) => s.loopEntry));
  const n = steps.length;

  // Planned duration of step i: the gap after the step played before it, plus its own attack
  // string. A lap of the loop follows the end of the previous lap.
  const prev = (i: number) => {
    if (i === loopAt && loop) return n - 1;
    return i === 0 ? -1 : i - 1;
  };
  const raw = steps.map((_, i) => {
    const p = prev(i);
    return (p >= 0 ? timings.gap[p] : 0) + timings.span[i];
  });
  const loopRaw = raw.slice(loopAt).reduce((a, b) => a + b, 0);
  const scale = targetMs && loopRaw > 0 ? targetMs / loopRaw : 1;
  const plan = raw.map((d) => d * scale);

  const measured = (i: number) => !!durN?.[i] && durMs !== undefined;
  const anyRun = steps.some((_, i) => measured(i));

  const rows: TurnRow[] = [];
  steps.forEach((s, i) => {
    const last = rows[rows.length - 1];
    if (last && last.items[last.items.length - 1].s.block === s.block) last.items.push({ s, i });
    else
      rows.push({
        slot: s.slot,
        items: [{ s, i }],
        opener: loopAt > 0 && i < loopAt,
        noteStep: -1,
        startMs: 0,
        endMs: 0,
        planMs: 0,
        actualMs: null,
        stepMs: [],
        actMs: [],
      });
  });

  let t = 0;
  let opener = true;
  for (const r of rows) {
    if (opener && !r.opener) {
      opener = false;
      t = 0;
    }
    r.noteStep = r.items.find((x) => x.s.src >= 0)?.s.src ?? -1;
    r.planMs = r.items.reduce((a, x) => a + plan[x.i], 0);
    const got = r.items.filter((x) => measured(x.i));
    r.actualMs = got.length ? r.items.reduce((a, x) => a + (measured(x.i) ? durMs![x.i] : plan[x.i]), 0) : null;
    r.stepMs = r.items.map((x) => (r.actualMs !== null && measured(x.i) ? durMs![x.i] : plan[x.i]));
    r.actMs = r.items.map((x, k) => (raw[x.i] > 0 ? (r.stepMs[k] * timings.span[x.i]) / raw[x.i] : 0));
    const len = anyRun ? (r.actualMs ?? r.planMs) : r.planMs;
    r.startMs = t;
    r.endMs = t + len;
    t += len;
  }

  return { rows, source: anyRun ? 'run' : 'plan', plan: targetMs ? 'target' : 'pace' };
}
