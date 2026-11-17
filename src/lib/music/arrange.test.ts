import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../defaults';
import { flatten, Tracker, type FlatStep } from '../engine';
import { parseRotation } from '../notation';
import { defaultTimings, TimingLearner, timingSig } from '../timing';
import type { ActionType, Character, Slot } from '../types';
import { arrange, buildTrack, lapRange, LapRecorder, validTrack, type CleanLap } from './arrange';
import { stepSec } from './patterns';
import { beatOffset, mod } from './player';

const team: Character[] = ['A', 'B', 'C', 'D'].map((name) => ({ name, element: 'none' }));
const S = stepSec() * 1000; // one 16th in ms

/** Plays a looping rotation through a real tracker and records clean laps. */
function rig(text: string) {
  const parsed = parseRotation(text, team);
  const loopStart = parsed.loopStart ?? 0;
  const flat = flatten(parsed.steps, true, loopStart);
  const timings = defaultTimings(flat, timingSig(parsed.steps, true, loopStart));
  const learner = new TimingLearner(flat, timings);
  const laps: CleanLap[] = [];
  const recorder = new LapRecorder(flat, true, (l) => laps.push(l));
  const tracker = new Tracker(flat, true, DEFAULT_SETTINGS.tracker, (e) => {
    recorder.onEvent(e);
    learner.onEvent(e);
  });
  const act = (type: ActionType, slot: Slot, t: number) => tracker.handle({ type, slot, t });
  return { flat, timings, laps, recorder, act };
}

// "1: E > 2: Q E" flattens to: swap→A, E(A), swap→B, Q(B), E(B).
// A 2-bar lap with each step on these 16ths:
const GRID = [0, 2, 8, 10, 20];
const ACTS: [ActionType, Slot][] = [
  ['swap', 0],
  ['skill', 0],
  ['swap', 1],
  ['burst', 1],
  ['skill', 1],
];

function playLaps(r: ReturnType<typeof rig>, laps: number, jitter: (lap: number, i: number) => number = () => 0) {
  const base = 1000;
  for (let lap = 0; lap < laps; lap++) {
    ACTS.forEach(([type, slot], i) => {
      if (lap === 0 && i === 0) return; // the player starts standing on A
      r.act(type, slot, base + (lap * 32 + GRID[i]) * S + jitter(lap, i));
    });
  }
}

describe('lap recorder', () => {
  it('hands over each clean lap once the next one starts, with its true length', () => {
    const r = rig('1: E > 2: Q E');
    playLaps(r, 3);
    expect(r.laps).toHaveLength(2);
    const lap2 = r.laps[1];
    expect(lap2.start.map((t) => (t === null ? null : Math.round((t - lap2.start[0]!) / S)))).toEqual(GRID);
    expect(Math.round((lap2.next! - lap2.start[lap2.ref!]!) / S)).toBe(32);
  });

  it('flushes a held lap when the run stops', () => {
    const r = rig('1: E > 2: Q E');
    playLaps(r, 2);
    expect(r.laps).toHaveLength(1);
    r.recorder.flush();
    expect(r.laps).toHaveLength(2);
    expect(r.laps[1].next).toBeNull();
  });

  it('drops laps with a mistake', () => {
    const r = rig('1: E > 2: Q E');
    r.act('skill', 0, 1000);
    r.act('swap', 1, 1000 + 8 * S);
    r.act('skill', 1, 1000 + 9 * S); // E before Q: wrong
    r.act('burst', 1, 1000 + 10 * S);
    r.act('skill', 1, 1000 + 20 * S);
    r.act('swap', 0, 1000 + 32 * S);
    r.recorder.flush();
    expect(r.laps).toHaveLength(0);
  });
});

describe('buildTrack', () => {
  it('lands steps played on the grid exactly on their 16ths', () => {
    const r = rig('1: E > 2: Q E');
    playLaps(r, 3);
    const t = buildTrack(r.flat, true, r.laps[1], r.timings, 0);
    expect(t.bars).toBe(2);
    expect(t.pos).toEqual(GRID);
    expect(t.sig).toBe(r.timings.sig);
  });

  it('snaps human timing (±40 ms per press) to the nearest 16th', () => {
    const r = rig('1: E > 2: Q E');
    // Two presses can be 80 ms apart from where they belong, more than half a 16th (58 ms).
    const wobble = [0, 35, -30, 22, -40, 28, -15, 38];
    playLaps(r, 4, (lap, i) => wobble[(lap * 5 + i) % wobble.length]);
    r.recorder.flush();
    for (const lap of r.laps) {
      const t = buildTrack(r.flat, true, lap, r.timings, 0);
      expect(t.bars).toBe(2);
      expect(t.pos).toEqual(GRID);
    }
  });

  it('fits a player who is steadily slower than 128 BPM, stretching to whole bars', () => {
    const r = rig('1: E > 2: Q E');
    const slow = 1.08;
    const wobble = [0, 25, -20, 15, -25, 20, -10, 22];
    const base = 1000;
    for (let lap = 0; lap < 4; lap++) {
      ACTS.forEach(([type, slot], i) => {
        if (lap === 0 && i === 0) return;
        r.act(type, slot, base + (lap * 32 + GRID[i]) * S * slow + wobble[(lap * 5 + i) % wobble.length]);
      });
    }
    expect(r.laps.length).toBeGreaterThanOrEqual(3);
    for (const lap of r.laps) {
      const t = buildTrack(r.flat, true, lap, r.timings, 0);
      expect(t.bars).toBe(2);
      expect(t.pos).toEqual(GRID);
    }
  });

  it('places the swap the first lap never had without shifting the real steps', () => {
    const r = rig('1: E > 2: Q E');
    playLaps(r, 2);
    expect(r.laps).toHaveLength(1);
    const lap1 = r.laps[0];
    expect(lap1.start[0]).toBeNull(); // the player started on A, no swap
    expect(lap1.ref).toBe(1); // measured between the two Es instead
    const t = buildTrack(r.flat, true, lap1, r.timings, 0);
    expect(t.bars).toBe(2);
    expect(t.pos).toEqual(GRID);
  });

  it('rounds the lap to whole bars and stretches to fit', () => {
    const flat = flatten(parseRotation('1: E > 2: E', team).steps, true);
    const timings = defaultTimings(flat, 'x');
    // 4 steps over 1.75 bars: rounds to 2 bars, stretched by 8 %.
    const lapMs = 1.75 * 16 * S;
    const at = [0, 0.25, 0.5, 0.75].map((f) => 5000 + f * lapMs);
    const t = buildTrack(flat, true, { start: at, end: at, ref: 0, next: 5000 + lapMs }, timings, 0);
    expect(t.bars).toBe(2);
    expect(t.pos).toEqual([0, 8, 16, 24]);
  });

  it('keeps every step on its own 16th, inside the lap', () => {
    const flat = flatten(parseRotation('1: E Q > 2: E Q', team).steps, true);
    const timings = defaultTimings(flat, 'x');
    const at = [0, 10, 20, 30, 40, 50].map((ms) => 100 + ms); // far too fast for the grid
    const t = buildTrack(flat, true, { start: at, end: at, ref: 0, next: 3000 }, timings, 0);
    for (let i = 1; i < t.pos.length; i++) expect(t.pos[i]).toBeGreaterThan(t.end[i - 1]);
    expect(Math.max(...t.end)).toBeLessThan(t.bars * 16);
  });

  it('spreads an attack string from its first to its last click', () => {
    const r = rig('1: E N3 > 2: Q');
    // swap→A, E, N3, swap→B, Q
    const flat = r.flat;
    const timings = r.timings;
    const ms = (p: number) => 1000 + p * S;
    const lap: CleanLap = {
      start: [ms(0), ms(2), ms(4), ms(12), ms(14)],
      end: [ms(0), ms(2), ms(8), ms(12), ms(14)],
      ref: 0,
      next: ms(32),
    };
    const t = buildTrack(flat, true, lap, timings, 0);
    expect(t.pos).toEqual([0, 2, 4, 12, 14]);
    expect(t.end[2]).toBe(8);
    const clicks = arrange(flat, t).events.filter((e) => e.trigger.kind === 'attack');
    expect(clicks.map((e) => e.pos)).toEqual([4, 6, 8]);
    // Only the first click of the string is "N" in the voice set.
    expect(clicks.map((e) => (e.trigger.kind === 'attack' ? !!e.trigger.first : null))).toEqual([true, false, false]);
  });

  it('covers only the looping part when there is an opener', () => {
    const parsed = parseRotation('1st rotation: 1: Q E > 2: E\n1: E > 2: E', team);
    const flat = flatten(parsed.steps, true, parsed.loopStart ?? 0);
    const [from, to] = lapRange(flat, true);
    expect(from).toBeGreaterThan(0);
    expect(to).toBe(flat.length);
    const timings = defaultTimings(flat, 'x');
    const start: (number | null)[] = flat.map(() => null);
    for (let i = from, p = 0; i < to; i++, p += 4) start[i] = 2000 + p * S;
    const t = buildTrack(flat, true, { start, end: [...start], ref: from, next: 2000 + 16 * S }, timings, 0);
    expect(t.pos.slice(0, from).every((p) => p === -1)).toBe(true);
    expect(t.pos.slice(from)).toEqual([0, 4, 8, 12].slice(0, to - from));
  });
});

describe('arrange', () => {
  it('gives every action its musical block at its 16th', () => {
    const r = rig('1: E > 2: Q E');
    playLaps(r, 3);
    const a = arrange(r.flat, buildTrack(r.flat, true, r.laps[1], r.timings, 0));
    expect(a.length).toBe(32);
    expect(a.targets).toEqual(GRID);
    const what = (p: number) => a.at.get(p)?.map((x) => (x.kind === 'swap' ? `swap${x.slot}` : x.kind));
    expect(what(0)).toEqual(['swap0']);
    expect(what(2)).toEqual(['skill']);
    expect(what(8)).toEqual(['swap1']);
    expect(what(10)).toEqual(['burst']);
    expect(what(20)).toEqual(['skill']);
    expect(a.at.get(1)).toBeUndefined();
  });

  it('a hold skill has its own cue', () => {
    const flat: FlatStep[] = [{ slot: 2, action: 'skillHold', count: 1, implicit: false, src: 0, block: 0 }];
    const a = arrange(flat, { sig: '', bpm: 128, bars: 1, pos: [0], end: [0], lapMs: 0, recordedAt: 0 });
    expect(a.at.get(0)).toEqual([{ kind: 'hold' }]);
  });

  it('ignores a track recorded on another rotation', () => {
    const r = rig('1: E > 2: Q E');
    playLaps(r, 3);
    const t = buildTrack(r.flat, true, r.laps[1], r.timings, 0);
    expect(validTrack(t, r.flat, r.timings.sig)).toBe(t);
    expect(validTrack(t, r.flat, 'other')).toBeNull();
    expect(validTrack(t, r.flat.slice(1), r.timings.sig)).toBeNull();
    expect(validTrack(undefined, r.flat, r.timings.sig)).toBeNull();
  });
});

describe('player alignment', () => {
  it('rejoins on whole beats, so the groove keeps its feel', () => {
    expect(beatOffset(100, 4)).toBe(96);
    expect(beatOffset(101, 4)).toBe(96);
    expect(beatOffset(103, 4)).toBe(100);
    // Never more than half a beat from where the player actually is.
    for (let g = 50; g < 90; g++) for (let p = 0; p < 32; p++) {
      const o = beatOffset(g, p);
      expect(mod(o, 4)).toBe(0);
      expect(Math.abs(o + p - g)).toBeLessThanOrEqual(2);
    }
    expect(mod(-3, 32)).toBe(29);
  });
});
