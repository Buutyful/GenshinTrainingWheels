import { describe, expect, it } from 'vitest';
import { breakdown } from './breakdown';
import { flatten } from './engine';
import type { RotationStep, Timings } from './types';

const rot: RotationStep[] = [
  { slot: 0, action: 'skill' },
  { slot: 1, action: 'burst' },
  { slot: 1, action: 'skill' },
];
const flat = flatten(rot, true); // swap→0, E, swap→1, Q, E
const timings: Timings = { sig: 's', gap: [100, 300, 200, 1000, 400], span: [0, 0, 0, 0, 0] };

describe('breakdown', () => {
  it('groups steps into turns with a planned timeline', () => {
    const b = breakdown(flat, true, timings, null);
    expect(b.source).toBe('plan');
    expect(b.rows.map((r) => r.slot)).toEqual([0, 1]);
    // swap→0 follows the last E (400), E follows the swap (100): 500. Then 300 + 200 + 1000.
    expect(b.rows[0].planMs).toBe(500);
    expect(b.rows[1].planMs).toBe(1500);
    expect(b.rows[1].startMs).toBe(500);
    expect(b.rows[1].noteStep).toBe(1);
  });

  it('scales the plan to the rotation time', () => {
    const b = breakdown(flat, true, timings, 4000);
    expect(b.plan).toBe('target');
    expect(b.rows[0].planMs + b.rows[1].planMs).toBeCloseTo(4000);
  });

  it('uses measured durations for the timeline when the run has them', () => {
    const dur = [600, 100, 300, 2000, 400];
    const n = [1, 1, 1, 1, 1];
    const b = breakdown(flat, true, timings, null, dur, n);
    expect(b.source).toBe('run');
    expect(b.rows[1].actualMs).toBe(2700);
    expect(b.rows[1].startMs).toBe(700);
    expect(b.rows[1].stepMs).toEqual([300, 2000, 400]);
    for (const r of b.rows) expect(r.stepMs.reduce((a, x) => a + x, 0)).toBeCloseTo(r.endMs - r.startMs);
  });

  it('restarts the timeline for the loop after an opener', () => {
    const f = flatten(rot, true, 1);
    const t: Timings = { sig: 's', gap: f.map(() => 100), span: f.map(() => 0) };
    const b = breakdown(f, true, t, null);
    expect(b.rows[0].opener).toBe(true);
    expect(b.rows[1].opener).toBe(false);
    expect(b.rows[1].startMs).toBe(0);
  });
});
