import { describe, expect, it } from 'vitest';
import { coach } from './coach';
import { flatten } from './engine';
import type { RunMetrics, SessionSummary } from './types';

const steps = flatten(
  [
    { slot: 0, action: 'skill' },
    { slot: 1, action: 'burst' },
    { slot: 1, action: 'skill' },
  ],
  true,
);
const names = ['Raiden', 'Xingqiu', 'Bennett', 'Xiangling'];
const describeStep = (i: number) => `${names[steps[i].slot]}'s ${steps[i].action}`;
const char = (hits = 0, missed = 0, wrong = 0) => ({ fieldMs: 1000, actions: {}, hits, missed, wrong, entries: 1 });

function run(acc: number, m: Partial<RunMetrics> = {}): SessionSummary {
  const metrics: RunMetrics = {
    chars: [char(10), char(10), char(), char()],
    laps: [
      { ms: 20000, clean: true, errors: 0 },
      { ms: 20000, clean: true, errors: 0 },
    ],
    targetMs: 20000,
    trackedMs: 60000,
    offTrackMs: 0,
    pausedMs: 0,
    swaps: 10,
    inputs: 30,
    steps: { sig: 'x', missed: steps.map(() => 0), wrong: steps.map(() => 0) },
    ...m,
  };
  return { date: 0, durationMs: 60000, laps: metrics.laps.length, cleanLaps: 2, accuracy: acc, bestLapMs: 20000, avgLapMs: 20000, metrics };
}

const go = (r: SessionSummary) => coach({ run: r, steps, names, sameRotation: true, describe: describeStep });

describe('coach', () => {
  it('praises a clean run on pace', () => {
    const v = go(run(1));
    expect(v.headline).toBe('Clean and on pace');
    expect(v.tone).toBe('good');
    expect(v.tips).toHaveLength(1);
    expect(v.tips[0].kind).toBe('good');
  });

  it('points at the step with most mistakes', () => {
    const missed = steps.map(() => 0);
    const wrong = steps.map(() => 0);
    missed[3] = 3;
    wrong[3] = 1;
    missed[1] = 1;
    const v = go(run(0.7, { steps: { sig: 'x', missed, wrong } }));
    expect(v.tone).toBe('bad');
    expect(v.tips[0].step).toBe(3);
    expect(v.tips[0].detail).toContain('80%');
  });

  it('calls out a slow but accurate run', () => {
    const v = go(run(0.95, { laps: [{ ms: 24000, clean: true, errors: 0 }] }));
    expect(v.headline).toBe('Right inputs, too slow');
    expect(v.tips.some((t) => t.title.includes('slower than target'))).toBe(true);
  });

  it('names the weakest character', () => {
    const v = go(run(0.8, { chars: [char(10), char(2, 3, 1), char(), char()] }));
    expect(v.tips.some((t) => t.title === 'Xingqiu is the weak link')).toBe(true);
  });

  it('reads rhythm bias', () => {
    const v = go(
      run(0.9, {
        rhythm: {
          counts: { perfect: 2, good: 4, early: 0, late: 4, miss: 0 },
          meanMs: 60,
          spreadMs: 30,
          bestStreak: 6,
          latencyMs: 40,
          steps: { sig: 'x', n: [], meanMs: [], misses: [] },
        },
      }),
    );
    expect(v.headline).toBe('Dragging behind the beat');
    expect(v.tips[0].title).toBe('You play 60 ms late');
  });
});

describe('coach turn timing', () => {
  it('names the turn that loses the most time', () => {
    const turns = [
      { slot: 0 as const, items: [{ s: steps[0], i: 0 }, { s: steps[1], i: 1 }], opener: false, noteStep: 0, startMs: 0, endMs: 0, planMs: 2000, actualMs: 2100, stepMs: [], actMs: [] },
      { slot: 1 as const, items: [{ s: steps[2], i: 2 }, { s: steps[3], i: 3 }], opener: false, noteStep: 1, startMs: 0, endMs: 0, planMs: 2000, actualMs: 3200, stepMs: [], actMs: [] },
    ];
    const v = coach({ run: run(0.95, { targetMs: null }), steps, names, sameRotation: true, describe: describeStep, turns });
    const tip = v.tips.find((t) => t.title.includes('turn runs'));
    expect(tip?.title).toBe("Xingqiu's turn runs 1.2s long");
    expect(tip?.step).toBe(3);
  });
});
