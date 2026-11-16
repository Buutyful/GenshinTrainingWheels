import { describe, expect, it } from 'vitest';
import { CueDirector, type CueOutput, type Sfx } from './cues';
import { DEFAULT_SETTINGS } from './defaults';
import { flatten, Tracker, type FlatStep, type TrackerEvent } from './engine';
import { parseRotation } from './notation';
import { defaultTimings, resolveTimings, TimingLearner, timingSig } from './timing';
import type { ActionType, AudioSettings, Character, Slot } from './types';

const team: Character[] = ['A', 'B', 'C', 'D'].map((name) => ({ name, element: 'none' }));

interface Played {
  what: string;
  at: number;
  due: number | null;
}

/** 1: E > 2: Q E, looping. Default gaps: swap 300, skill 700, burst 1700. */
function rig(audio: Partial<AudioSettings> = {}, text = '1: E > 2: Q E') {
  const steps = parseRotation(text, team).steps;
  const flat = flatten(steps, true);
  const timings = defaultTimings(flat, timingSig(steps, true));
  const cues: Played[] = [];
  const sfx: Sfx[] = [];
  let cuts = 0;
  const out: CueOutput = {
    cue: (s: FlatStep, at, due) => cues.push({ what: `${s.action}${s.slot}`, at, due }),
    cutBuildup: () => cuts++,
    sfx: (n) => sfx.push(n),
  };
  const events: TrackerEvent[] = [];
  let director: CueDirector;
  const learner = new TimingLearner(flat, timings);
  const tracker = new Tracker(flat, true, DEFAULT_SETTINGS.tracker, (e) => {
    events.push(e);
    learner.onEvent(e);
    director.onEvent(e);
  });
  director = new CueDirector(tracker, timings, { ...DEFAULT_SETTINGS.audio, ...audio }, out);
  const act = (type: ActionType, slot: Slot, t: number) => {
    tracker.handle({ type, slot, t });
    director.update(t);
  };
  return { tracker, director, timings, cues, sfx, act, cuts: () => cuts };
}

describe('cue director', () => {
  it('announces the opening move once while armed', () => {
    const r = rig();
    r.director.update(0);
    r.director.update(50);
    expect(r.cues).toEqual([{ what: 'skill0', at: 0, due: null }]);
  });

  it('cues the next step a full lead time before it is due, with a build-up', () => {
    const r = rig();
    r.act('skill', 0, 1000); // swap to B is due at 1700
    r.director.update(1100);
    expect(r.cues).toHaveLength(0);
    r.director.update(1150); // inside the scheduling window for a cue at 1200
    expect(r.cues).toEqual([{ what: 'swap1', at: 1200, due: 1700 }]);
    r.director.update(1200);
    expect(r.cues).toHaveLength(1);
  });

  it('cues fast follow-ups back to back and gives the build-up only to the first', () => {
    const r = rig();
    r.act('skill', 0, 1000);
    r.director.update(1150);
    r.director.update(1450); // burst on B is due at 2000, 300 ms after the swap
    expect(r.cues[1]).toEqual({ what: 'burst1', at: 1500, due: null });
  });

  it('never runs more than one lead ahead of a player who is late', () => {
    const r = rig();
    r.act('skill', 0, 1000);
    for (let t = 1050; t <= 2600; t += 50) r.director.update(t);
    // swap (due 1700) and the burst right behind it, nothing further down the rotation
    expect(r.cues.map((c) => c.what)).toEqual(['swap1', 'burst1']);
  });

  it('repeats the pending cue once when the player hesitates', () => {
    const r = rig();
    r.act('skill', 0, 1000);
    for (let t = 1050; t <= 4000; t += 50) r.director.update(t);
    expect(r.cues.map((c) => c.what)).toEqual(['swap1', 'burst1', 'swap1']);
    expect(r.cues[2]).toMatchObject({ at: 3200, due: null }); // 1.5 s after it was due
  });

  it('plays a soft error and repeats the expected step after a mistake', () => {
    const r = rig();
    r.act('skill', 0, 1000);
    r.act('burst', 0, 1300);
    expect(r.sfx).toEqual(['error']);
    expect(r.cues.at(-1)).toEqual({ what: 'swap1', at: 1520, due: null });
  });

  it('cuts the build-up as soon as the step lands', () => {
    const r = rig();
    r.act('skill', 0, 1000);
    r.director.update(1150);
    const before = r.cuts();
    r.act('swap', 1, 1500); // early
    expect(r.cuts()).toBe(before + 1);
  });

  it('adaptive mode stays silent while the player keeps pace', () => {
    const r = rig({ guidance: 'adaptive' });
    r.director.update(0);
    r.act('skill', 0, 1000);
    for (let t = 1050; t <= 1700; t += 50) r.director.update(t);
    r.act('swap', 1, 1700);
    r.act('burst', 1, 2000);
    expect(r.cues).toHaveLength(0);
    for (let t = 2050; t <= 5300; t += 50) r.director.update(t);
    expect(r.cues.map((c) => c.what)).toEqual(['skill1']);
  });

  it('swaps mode only cues character changes', () => {
    const r = rig({ guidance: 'swaps' });
    r.act('skill', 0, 1000);
    for (let t = 1050; t <= 1700; t += 50) r.director.update(t);
    r.act('swap', 1, 1700);
    r.act('burst', 1, 2000);
    for (let t = 2050; t <= 3700; t += 50) r.director.update(t);
    r.act('skill', 1, 3700);
    for (let t = 3750; t <= 4400; t += 50) r.director.update(t);
    expect(r.cues.map((c) => c.what)).toEqual(['swap1', 'swap0']);
  });

  it('cues an attack string at its first click and waits for it to finish', () => {
    const r = rig({}, '1: E N3 > 2: E');
    r.act('skill', 0, 1000); // N3 due at 1700
    r.director.update(1200);
    expect(r.cues).toEqual([{ what: 'na0', at: 1200, due: 1700 }]);
    r.act('na', 0, 1700); // string should finish at 1700 + 660, swap at +350
    r.director.update(2000);
    expect(r.cues).toHaveLength(1);
    r.director.update(2200);
    expect(r.cues[1]).toMatchObject({ what: 'swap1', at: 2210, due: 2710 });
  });
});

describe('timing learner', () => {
  it('moves the gaps toward the rhythm of consecutive correct steps', () => {
    const r = rig();
    r.act('skill', 0, 1000);
    r.act('swap', 1, 2000); // 1000 ms instead of the default 700
    expect(r.timings.gap[1]).toBe(805);
    r.act('burst', 1, 2200);
    expect(r.timings.gap[2]).toBe(265);
  });

  it('ignores intervals that contain a mistake', () => {
    const r = rig();
    r.act('skill', 0, 1000);
    r.act('burst', 0, 1500); // wrong
    r.act('swap', 1, 4000);
    expect(r.timings.gap[1]).toBe(700);
  });

  it('measures how long an attack string takes', () => {
    const r = rig({}, '1: E N3 > 2: E');
    r.act('skill', 0, 1000);
    r.act('na', 0, 1600);
    r.act('na', 0, 1800);
    r.act('na', 0, 2000);
    // Index 0 is the wrap-around swap back to A, so the skill is step 1 and the string step 2.
    expect(r.timings.gap[1]).toBe(665); // skill to first click: 700 default toward 600
    expect(r.timings.span[2]).toBe(569); // 660 default toward 400
  });

  it('keeps saved timings only for the same rotation', () => {
    const steps = parseRotation('1: E > 2: Q', team).steps;
    const flat = flatten(steps, true);
    const sig = timingSig(steps, true);
    const saved = { sig, gap: flat.map(() => 111), span: flat.map(() => 0) };
    expect(resolveTimings(saved, flat, sig).gap[0]).toBe(111);
    expect(resolveTimings({ ...saved, sig: 'other' }, flat, sig).gap).toEqual(defaultTimings(flat, sig).gap);
  });
});
