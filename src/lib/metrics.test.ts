import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { flatten, Tracker } from './engine';
import { MetricsCollector } from './metrics';
import type { GameAction, RotationStep, Slot } from './types';

describe('metrics', () => {
  it('credits field time to whoever is on field and counts actions per character', () => {
    const steps: RotationStep[] = [
      { slot: 0, action: 'skill' },
      { slot: 1, action: 'burst' },
      { slot: 1, action: 'na', count: 2 },
    ];
    const flat = flatten(steps, true);
    let m: MetricsCollector;
    const tr = new Tracker(flat, true, DEFAULT_SETTINGS.tracker, (e) => m.onEvent(e));
    m = new MetricsCollector(flat, tr, 'sig', 3000);
    let active: Slot = 0;
    const play = (a: GameAction) => {
      m.accrue(a.t, active);
      if (a.type === 'swap') active = a.slot;
      m.onAction(a);
      tr.handle(a);
    };
    play({ type: 'skill', slot: 0, t: 1000 });
    play({ type: 'swap', slot: 1, t: 2000 });
    play({ type: 'burst', slot: 1, t: 2500 });
    play({ type: 'na', slot: 1, t: 4000 });
    play({ type: 'na', slot: 1, t: 5000 });
    play({ type: 'swap', slot: 0, t: 5500 });
    m.accrue(6000, active);
    const r = m.result();
    expect(r.chars[0].fieldMs).toBe(1000 + 500);
    expect(r.chars[1].fieldMs).toBe(3500);
    expect(r.chars[1].actions).toEqual({ burst: 1, na: 2 });
    expect(r.chars[0].entries).toBe(2);
    expect(r.chars[1].entries).toBe(1);
    expect(r.laps).toHaveLength(1);
    expect(r.swaps).toBe(2);
  });

  it('averages how long each step takes over laps played through', () => {
    const steps: RotationStep[] = [
      { slot: 0, action: 'skill' },
      { slot: 1, action: 'burst' },
    ];
    const flat = flatten(steps, true);
    let m: MetricsCollector;
    const tr = new Tracker(flat, true, DEFAULT_SETTINGS.tracker, (e) => m.onEvent(e));
    m = new MetricsCollector(flat, tr, 'sig', null);
    let active: Slot = 1;
    const play = (a: GameAction) => {
      m.accrue(a.t, active);
      if (a.type === 'swap') active = a.slot;
      m.onAction(a);
      tr.handle(a);
    };
    // flat: swap→0, E, swap→1, Q. Two laps, the second slower on Q.
    let t = 1000;
    for (const qGap of [600, 1000]) {
      play({ type: 'swap', slot: 0, t });
      play({ type: 'skill', slot: 0, t: (t += 400) });
      play({ type: 'swap', slot: 1, t: (t += 800) });
      play({ type: 'burst', slot: 1, t: (t += qGap) });
      t += 300;
    }
    const r = m.result();
    const q = flat.findIndex((s) => s.action === 'burst');
    const e = flat.findIndex((s) => s.action === 'skill');
    expect(r.steps.durMs![q]).toBe(800);
    expect(r.steps.durMs![e]).toBe(400);
    expect(r.steps.durN![q]).toBe(2);
    expect(r.steps.durN![e]).toBe(1);
  });
});
