import { describe, expect, it } from 'vitest';
import { flatten } from './engine';
import { calibrate, grade, lapDelta, LOOSE, onBeat, RhythmJudge, tapOffsets, WINDOWS } from './rhythm';
import type { RotationStep } from './types';

describe('grade', () => {
  it('uses the windows on both sides', () => {
    expect(grade(0)).toBe('perfect');
    expect(grade(-WINDOWS.perfect)).toBe('perfect');
    expect(grade(WINDOWS.perfect + 1)).toBe('good');
    expect(grade(-WINDOWS.good)).toBe('good');
    expect(grade(-WINDOWS.good - 1)).toBe('early');
    expect(grade(WINDOWS.good + 1)).toBe('late');
    expect(grade(WINDOWS.hit + 1)).toBe('miss');
    expect(grade(-WINDOWS.hit - 1)).toBe('miss');
  });

  it('is loose for attacks and movement, which never miss', () => {
    expect(grade(WINDOWS.perfect * LOOSE, true)).toBe('perfect');
    expect(grade(WINDOWS.good * LOOSE + 1, true)).toBe('late');
    expect(grade(-5000, true)).toBe('early');
  });
});

describe('lapDelta', () => {
  it('measures to the nearest repeat of the 16th', () => {
    // 2-bar lap (32 16ths) starting at global 8; target 16th 4 plays at 12, 44, 76…
    expect(lapDelta(12, 8, 4, 32)).toBe(0);
    expect(lapDelta(44.25, 8, 4, 32)).toBeCloseTo(0.25);
    expect(lapDelta(75.5, 8, 4, 32)).toBeCloseTo(-0.5);
    expect(lapDelta(11, 8, 4, 32)).toBe(-1);
    // Before the offset too (negative positions).
    expect(lapDelta(-20, 8, 4, 32)).toBe(0);
  });
});

describe('RhythmJudge', () => {
  const rot: RotationStep[] = [
    { slot: 0, action: 'skill' },
    { slot: 1, action: 'burst' },
    { slot: 1, action: 'na', count: 3 },
  ];
  const flat = flatten(rot, true);
  const idx = (a: string) => flat.findIndex((s) => s.action === a);

  it('counts grades, offsets and streaks', () => {
    const j = new RhythmJudge(flat, 'sig', 30);
    expect(j.hit(idx('skill'), -10).grade).toBe('perfect');
    expect(j.hit(idx('burst'), 30).grade).toBe('perfect');
    expect(j.hit(idx('skill'), 80).grade).toBe('good');
    expect(j.hit(idx('burst'), 400).grade).toBe('miss');
    const r = j.result();
    expect(r.counts).toEqual({ perfect: 2, good: 1, early: 0, late: 0, miss: 1 });
    // Misses do not pull the average offset.
    expect(r.meanMs).toBeCloseTo(100 / 3);
    expect(r.bestStreak).toBe(3);
    expect(r.latencyMs).toBe(30);
    expect(r.steps.n[idx('skill')]).toBe(2);
    expect(r.steps.meanMs[idx('skill')]).toBe(35);
    expect(r.steps.misses[idx('burst')]).toBe(1);
    expect(onBeat(r.counts)).toBeCloseTo(3 / 4);
  });

  it('tracks misses in a row; skipped attacks are not misses', () => {
    const j = new RhythmJudge(flat, 'sig');
    expect(j.skipped(idx('na'))).toBeNull();
    j.skipped(idx('burst'));
    j.hit(idx('skill'), 300);
    expect(j.missStreak).toBe(2);
    j.hit(idx('skill'), 0);
    expect(j.missStreak).toBe(0);
    expect(j.total).toBe(3);
  });
});

describe('calibration', () => {
  it('finds the median offset and ignores stray taps', () => {
    const beatMs = 60000 / 128;
    const offs = [40, 45, 38, 52, 41, 47, 44, 39, 43, -200];
    const taps = offs.map((o, k) => 1000 + (k + 4) * beatMs + o);
    const measured = tapOffsets(taps, 1000, beatMs);
    measured.forEach((m, k) => expect(m).toBeCloseTo(offs[k]));
    const c = calibrate(measured)!;
    expect(c.used).toBe(9);
    expect(c.latencyMs).toBe(43);
    expect(c.spreadMs).toBeLessThanOrEqual(4);
  });

  it('needs enough taps', () => {
    expect(calibrate([10, 12, 11])).toBeNull();
  });
});
