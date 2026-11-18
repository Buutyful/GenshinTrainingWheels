import { describe, expect, it } from 'vitest';
import { newLoadout } from './defaults';
import { flatten } from './engine';
import {
  bestRun,
  CODE_PREFIX,
  decodeResult,
  encodeResult,
  entryFromRun,
  ladderKey,
  loadoutFromResult,
  loadoutSig,
  mergeEntry,
  ranking,
  sameLoadout,
} from './ladder';
import type { LadderEntry, Loadout, SessionSummary } from './types';

function loadout(): Loadout {
  return {
    ...newLoadout(),
    name: 'Raiden National',
    characters: [
      { name: 'Raiden Shogun', element: 'electro', id: 'raiden' },
      { name: 'Xingqiu', element: 'hydro', id: 'xingqiu' },
      { name: 'Bennett', element: 'pyro', id: 'bennett' },
      { name: 'Xiangling', element: 'pyro', id: 'xiangling' },
    ],
    steps: [
      { slot: 0, action: 'skill', note: 'private note' },
      { slot: 1, action: 'burst' },
      { slot: 0, action: 'na', count: 3 },
    ],
    rotationSec: 20,
  };
}

function run(l: Loadout, bestLapMs: number | null, accuracy: number, sig = loadoutSig(l)): SessionSummary {
  const flat = flatten(l.steps, l.loop, 0);
  return {
    date: 1_700_000_000_000,
    durationMs: 60000,
    laps: 3,
    cleanLaps: bestLapMs ? 2 : 0,
    accuracy,
    bestLapMs,
    avgLapMs: 21000,
    metrics: {
      chars: [],
      laps: [],
      targetMs: 20000,
      trackedMs: 60000,
      offTrackMs: 0,
      pausedMs: 0,
      swaps: 0,
      inputs: 0,
      steps: { sig, missed: flat.map(() => 0), wrong: flat.map(() => 0) },
    },
  };
}

const entry = (player: string, bestLapMs: number | null, accuracy = 0.9): LadderEntry => ({
  player,
  date: 1,
  mode: 'practice',
  bestLapMs,
  avgLapMs: null,
  accuracy,
  cleanLaps: 1,
  laps: 2,
  durationMs: 1000,
});

describe('result codes', () => {
  it('round-trip a run and its loadout, without private notes', () => {
    const l = loadout();
    const code = encodeResult(l, entry('Ayaka fan ✨', 19800));
    expect(code.startsWith(CODE_PREFIX)).toBe(true);
    expect(code).not.toContain('private');
    const { result, error } = decodeResult(`  ${code.slice(0, 30)}\n${code.slice(30)}  `);
    expect(error).toBeNull();
    expect(result!.entry.player).toBe('Ayaka fan ✨');
    expect(result!.entry.bestLapMs).toBe(19800);
    expect(result!.loadout.steps).toEqual([
      { slot: 0, action: 'skill' },
      { slot: 1, action: 'burst' },
      { slot: 0, action: 'na', count: 3 },
    ]);
    expect(sameLoadout(result!.loadout, l)).toBe(true);
  });

  it('reject damaged codes', () => {
    const code = encodeResult(loadout(), entry('A', 19800));
    expect(decodeResult(code.slice(0, -12)).error).toMatch(/damaged/);
    expect(decodeResult('hello').error).toMatch(/not a result code/);
  });
});

describe('matching', () => {
  it('needs the same rotation and the same team', () => {
    const l = loadout();
    const { result } = decodeResult(encodeResult(l, entry('A', 1)));
    const other = { ...l, steps: [...l.steps, { slot: 1 as const, action: 'skill' as const }] };
    expect(sameLoadout(result!.loadout, other)).toBe(false);
    const swapped = { ...l, characters: [l.characters[1], l.characters[0], l.characters[2], l.characters[3]] };
    expect(sameLoadout(result!.loadout, swapped)).toBe(false);
  });
});

describe('ladder', () => {
  it('ranks by best clean lap, then accuracy; laps without a clean lap go last', () => {
    const base = loadout();
    const key = ladderKey(base);
    const l = { ...base, ladder: [entry('Slow', 23000), entry('None', null, 1), entry('Fast', 19000), entry('Stale', 1000)].map((e) => ({ ...e, key: e.player === 'Stale' ? 'old' : key })) };
    l.history = [run(l, 21000, 0.95)];
    const r = ranking(l, 'Me');
    expect(r.map((x) => x.entry.player)).toEqual(['Fast', 'Me', 'Slow', 'None']);
    expect(r[1].mine).toBe(true);
    expect(r[1].rank).toBe(2);
  });

  it('only counts own runs played on the current rotation', () => {
    const l = loadout();
    l.history = [run(l, 15000, 1, 'old-rotation'), run(l, 21000, 0.9), run(l, 20000, 0.8)];
    expect(bestRun(l)!.bestLapMs).toBe(20000);
    expect(entryFromRun(bestRun(l)!, 'Me').mode).toBe('practice');
  });

  it('keeps one entry per player, the better one', () => {
    let lad = [entry('Ana', 21000)];
    let m = mergeEntry(lad, entry('ana', 22000));
    expect(m.outcome).toBe('kept');
    m = mergeEntry(m.ladder, entry('Ana', 20000));
    expect(m.outcome).toBe('improved');
    expect(m.ladder).toHaveLength(1);
    lad = mergeEntry(m.ladder, entry('Bo', 25000)).ladder;
    expect(lad).toHaveLength(2);
  });

  it('builds a loadout from a code for someone who does not have it', () => {
    const { result } = decodeResult(encodeResult(loadout(), entry('A', 1)));
    const l = loadoutFromResult(result!);
    expect(l.name).toBe('Raiden National');
    expect(l.ladder).toHaveLength(1);
    expect(l.history).toEqual([]);
  });
});

describe('character matching', () => {
  it('treats roster ids, names and nicknames as the same character', () => {
    const a = loadout();
    const b = { ...loadout(), characters: a.characters.map((c, i) => (i === 0 ? { name: 'Raiden Shogun', element: c.element } : c)) };
    const c = { ...loadout(), characters: a.characters.map((ch, i) => (i === 0 ? { ...ch, id: 'raiden-shogun' } : ch)) };
    expect(ladderKey(a)).toBe(ladderKey(b));
    expect(ladderKey(b)).toBe(ladderKey(c));
  });
});
