import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, DEFAULT_SETTINGS } from './defaults';
import { flatten, Tracker, type TrackerEvent } from './engine';
import { Interpreter } from './interpreter';
import { formatRotation, parseRotation } from './notation';
import type { ActionType, Character, GameAction, RotationStep, Slot, TrackerSettings } from './types';

const team: Character[] = [
  { name: 'Raiden', element: 'electro' },
  { name: 'Xingqiu', element: 'hydro' },
  { name: 'Bennett', element: 'pyro' },
  { name: 'Xiangling', element: 'pyro' },
];

// Raiden: E > Xingqiu: E Q > Bennett: Q E > Raiden: Q N3
const rotation: RotationStep[] = parseRotation('Raiden: E > Xingqiu: E Q > Bennett: Q E > Raiden: Q N3', team).steps;

function setup(opts: Partial<TrackerSettings> = {}, steps = rotation, loop = true) {
  const events: TrackerEvent[] = [];
  const tracker = new Tracker(flatten(steps, loop), loop, { ...DEFAULT_SETTINGS.tracker, ...opts }, (e) => events.push(e));
  let t = 1000;
  const act = (type: ActionType, slot: Slot, dt = 400): GameAction => {
    t += dt;
    const a = { type, slot, t };
    tracker.handle(a);
    return a;
  };
  const kinds = () => events.map((e) => e.kind);
  return { tracker, events, act, kinds, now: () => t };
}

/** One clean pass of the test rotation, starting on Raiden. */
function cleanLap(act: ReturnType<typeof setup>['act'], first: boolean) {
  if (!first) act('swap', 0);
  act('skill', 0);
  act('swap', 1);
  act('skill', 1);
  act('burst', 1);
  act('swap', 2);
  act('burst', 2);
  act('skill', 2);
  act('swap', 0);
  act('burst', 0);
  act('na', 0);
  act('na', 0);
  act('na', 0);
}

describe('flatten', () => {
  it('adds a swap whenever the character changes', () => {
    const flat = flatten(rotation, false);
    expect(flat.map((s) => `${s.action}${s.slot}`)).toEqual([
      'skill0', 'swap1', 'skill1', 'burst1', 'swap2', 'burst2', 'skill2', 'swap0', 'burst0', 'na0',
    ]);
    expect(flat.at(-1)!.count).toBe(3);
  });

  it('adds the wrap-around swap only when the loop ends on another character', () => {
    expect(flatten(rotation, true)[0].implicit).toBe(false);
    const ends = parseRotation('1: E > 2: Q', team).steps;
    expect(flatten(ends, true)[0]).toMatchObject({ action: 'swap', slot: 0, implicit: true });
    expect(flatten(ends, false)[0]).toMatchObject({ action: 'skill', slot: 0 });
  });
});

describe('tracker', () => {
  it('stays armed until the first step is performed', () => {
    const { tracker, act } = setup();
    act('dash', 0);
    act('burst', 0);
    expect(tracker.status).toBe('armed');
    expect(tracker.totals.wrong).toBe(0);
    act('skill', 0);
    expect(tracker.status).toBe('tracking');
  });

  it('counts clean laps and keeps looping', () => {
    const { tracker, act, events } = setup();
    cleanLap(act, true);
    cleanLap(act, false);
    expect(tracker.lap).toBe(2);
    expect(tracker.laps.every((l) => l.clean)).toBe(true);
    expect(tracker.accuracy).toBe(1);
    expect(events.filter((e) => e.kind === 'lap')).toHaveLength(2);
  });

  it('expects the swap back to the first character from the second lap on', () => {
    const ends = parseRotation('1: E > 2: Q', team).steps;
    const { tracker, act } = setup({}, ends);
    act('skill', 0);
    act('swap', 1);
    act('burst', 1);
    expect(tracker.lap).toBe(1);
    expect(tracker.steps[tracker.pointer]).toMatchObject({ action: 'swap', slot: 0 });
    act('swap', 0);
    act('skill', 0);
    expect(tracker.totals.wrong).toBe(0);
  });

  it('never punishes attack mashing or a short attack string', () => {
    const { tracker, act } = setup();
    act('skill', 0);
    act('na', 0); // stray click
    act('dash', 0);
    act('swap', 1);
    expect(tracker.totals.wrong + tracker.totals.missed).toBe(0);
    act('skill', 1);
    act('burst', 1);
    act('swap', 2);
    act('burst', 2);
    act('skill', 2);
    act('swap', 0);
    act('burst', 0);
    act('na', 0); // only one of three
    expect(tracker.lap).toBe(0);
    act('skill', 0); // next lap starts: the unfinished N3 is partial, not an error
    expect(tracker.lap).toBe(1);
    expect(tracker.laps[0].clean).toBe(true);
  });

  it('lets a charged attack follow an unfinished attack string', () => {
    const steps = parseRotation('1: E N3C > 2: E', team).steps;
    const { tracker, act } = setup({}, steps, false);
    act('skill', 0);
    act('na', 0);
    act('ca', 0);
    expect(tracker.statuses.slice(0, 3)).toEqual(['ok', 'partial', 'ok']);
  });

  it('marks a skipped step as missed and carries on', () => {
    const { tracker, act, kinds } = setup();
    act('skill', 0);
    act('swap', 1);
    act('burst', 1); // forgot Xingqiu E
    expect(tracker.totals.missed).toBe(1);
    expect(tracker.status).toBe('tracking');
    expect(kinds()).toContain('skip');
    act('swap', 2);
    expect(tracker.totals.wrong).toBe(0);
  });

  it('tolerates key mashing and swapping back to the right character', () => {
    const { tracker, act } = setup();
    act('skill', 0);
    act('skill', 0, 150); // mash
    act('swap', 1);
    act('swap', 3); // slip: one error
    act('swap', 1); // back where the rotation wants us
    act('skill', 1);
    expect(tracker.totals.wrong).toBe(1);
    expect(tracker.consecutiveErrors).toBe(0);
  });

  it('goes off track after repeated errors, then resyncs on a block start', () => {
    const { tracker, act, kinds } = setup();
    act('skill', 0);
    act('swap', 3);
    act('skill', 3);
    act('burst', 3);
    expect(tracker.status).toBe('offtrack');
    act('skill', 3); // nothing is judged while off track
    expect(tracker.totals.wrong).toBe(3);
    act('swap', 2); // Bennett's block
    expect(tracker.status).toBe('tracking');
    expect(kinds()).toContain('resync');
    act('burst', 2);
    act('skill', 2);
    expect(tracker.totals.wrong).toBe(3);
    expect(tracker.statuses[2]).toBe('missed'); // Xingqiu E was never done
  });

  it('pauses without penalty when the player stops, and resumes anywhere', () => {
    const { tracker, act, now } = setup();
    act('skill', 0);
    act('swap', 1);
    tracker.tick(now() + 9000);
    expect(tracker.status).toBe('offtrack');
    expect(tracker.offReason).toBe('idle');
    act('skill', 0, 12000); // starts over from the top
    expect(tracker.status).toBe('tracking');
    expect(tracker.totals.missed).toBe(0);
    expect(tracker.laps[0].aborted).toBe(true);
    expect(tracker.pointer).toBe(1);
  });

  it('restart policy only resumes from the beginning', () => {
    const { tracker, act } = setup({ policy: 'restart' });
    act('skill', 0);
    act('swap', 3);
    act('skill', 3);
    act('burst', 3);
    expect(tracker.status).toBe('offtrack');
    act('swap', 2);
    act('burst', 2);
    expect(tracker.status).toBe('offtrack');
    act('swap', 0);
    act('skill', 0);
    expect(tracker.status).toBe('tracking');
    expect(tracker.pointer).toBe(1);
  });

  it('finishes a one-shot rotation', () => {
    const { tracker, act, kinds } = setup({}, parseRotation('1: E Q', team).steps, false);
    act('skill', 0);
    act('burst', 0);
    expect(tracker.status).toBe('done');
    expect(kinds().at(-1)).toBe('done');
    act('skill', 0);
    expect(tracker.totals.hits).toBe(2);
  });
});

describe('interpreter', () => {
  function rig(initial: Slot = 0) {
    const out: GameAction[] = [];
    const it = new Interpreter(DEFAULT_BINDINGS, { holdSkillMs: 300, holdAttackMs: 300 }, initial, (a) => out.push(a));
    const key = (code: string, down: boolean, t: number) => it.feed({ code, down, t });
    const tap = (code: string, t: number, len = 60) => {
      key(code, true, t);
      key(code, false, t + len);
    };
    return { it, out, key, tap, types: () => out.map((a) => `${a.type}${a.slot}`) };
  }

  it('separates taps from holds', () => {
    const r = rig();
    r.tap('KeyE', 0);
    r.tap('KeyE', 1000, 500);
    r.tap('Mouse0', 2000);
    r.tap('Mouse0', 3000, 600);
    expect(r.types()).toEqual(['skill0', 'skillHold0', 'na0', 'ca0']);
  });

  it('reports a hold as soon as the threshold passes, not on release', () => {
    const r = rig();
    r.key('KeyE', true, 0);
    r.it.advance(299);
    expect(r.out).toHaveLength(0);
    r.it.advance(300);
    expect(r.types()).toEqual(['skillHold0']);
    r.key('KeyE', false, 900);
    expect(r.out).toHaveLength(1);
  });

  it('ignores auto-repeat and swaps to the character already on field', () => {
    const r = rig();
    r.key('Digit1', true, 0);
    r.key('Digit2', true, 10);
    r.key('Digit2', true, 40);
    r.key('Digit2', true, 70);
    r.key('KeyQ', true, 100);
    expect(r.types()).toEqual(['swap1', 'burst1']);
  });

  it('reads Alt+number as swap plus burst', () => {
    const r = rig();
    r.key('AltLeft', true, 0);
    r.key('Digit3', true, 20);
    expect(r.out).toEqual([
      { type: 'swap', slot: 2, t: 20 },
      { type: 'burst', slot: 2, t: 20, viaAlt: true },
    ]);
  });

  it('drives the tracker end to end', () => {
    const steps = parseRotation('1: E > 2: Q E', team).steps;
    const tracker = new Tracker(flatten(steps, true), true, DEFAULT_SETTINGS.tracker);
    const it = new Interpreter(DEFAULT_BINDINGS, { holdSkillMs: 300, holdAttackMs: 300 }, 0, (a) => tracker.handle(a));
    const tap = (code: string, t: number) => {
      it.feed({ code, down: true, t });
      it.feed({ code, down: false, t: t + 50 });
    };
    tap('KeyE', 0);
    it.feed({ code: 'AltLeft', down: true, t: 500 });
    tap('Digit2', 520); // burst on entry
    it.feed({ code: 'AltLeft', down: false, t: 600 });
    tap('KeyE', 1200);
    expect(tracker.lap).toBe(1);
    expect(tracker.accuracy).toBe(1);
  });
});

describe('notation', () => {
  it('round-trips', () => {
    const text = 'Raiden: E > Xingqiu: E Q > Bennett: Q hE > Raiden: Q N3 CA Dash Jump';
    const { steps, errors } = parseRotation(text, team);
    expect(errors).toEqual([]);
    expect(formatRotation(steps, team)).toBe(text);
  });

  it('accepts slot numbers, prefixes and combo shorthand, and reports what it cannot read', () => {
    const { steps, errors } = parseRotation('1 e q\nxiang: n2c\nzhongli: e\n2: zz', team);
    expect(steps).toEqual([
      { slot: 0, action: 'skill' },
      { slot: 0, action: 'burst' },
      { slot: 3, action: 'na', count: 2 },
      { slot: 3, action: 'ca' },
    ]);
    expect(errors).toHaveLength(2);
  });
});
