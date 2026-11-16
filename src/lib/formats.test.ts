import { describe, expect, it } from 'vitest';
import { flatten, Tracker } from './engine';
import { DEFAULT_SETTINGS } from './defaults';
import { formatGcsim, formatNotation, importAny, lexActions, parseGcsim, parseNotation } from './formats';
import { resolveCharacter, searchRoster } from './roster';

describe('roster', () => {
  it('finds characters by name, alias, key and typo', () => {
    expect(resolveCharacter('Raiden')?.name).toBe('Raiden Shogun');
    expect(resolveCharacter('kazuha')?.name).toBe('Kaedehara Kazuha');
    expect(resolveCharacter('xq')?.name).toBe('Xingqiu');
    expect(resolveCharacter('RaidenShogun')?.name).toBe('Raiden Shogun');
    expect(resolveCharacter('Valery')?.name).toBe('Valeriy');
    expect(resolveCharacter('Tsar')?.name).toBe('Tsaritsa');
    expect(resolveCharacter('Danica')?.element).toBe('electro');
    expect(searchRoster('hu')[0].name).toBe('Hu Tao');
  });
});

describe('notation', () => {
  it('lexes compact KQM tokens', () => {
    expect(lexActions('hECQC')).toEqual([{ action: 'skillHold' }, { action: 'ca' }, { action: 'burst' }, { action: 'ca' }]);
    expect(lexActions('N1E')).toEqual([{ action: 'na', count: 1 }, { action: 'skill' }]);
    expect(lexActions('N3 CA')).toEqual([{ action: 'na', count: 3 }, { action: 'ca' }]);
    expect(lexActions('Tao')).toBeNull();
  });

  it('reads a Hexenzirkel leaderboard rotation with opener, notes and time', () => {
    const text = [
      '1st rotation: Odette EE > Yae EEE > Sucrose N1E > Mitya hECQC > Sucrose E > Mitya C',
      '2nd onwards: Odette EE > Sucrose E > Mitya hEC > Yae EEE > Sucrose N1E > Mitya CQC',
      'Counted over 4 rotations.',
      'Rotation time: 72 s',
    ].join('\n');
    const r = parseNotation(text);
    expect(r.errors).toEqual([]);
    expect(r.characters.map((c) => c.name)).toEqual(['Odette', 'Yae Miko', 'Sucrose', 'Mitya']);
    expect(r.rotationSec).toBe(72);
    expect(r.loopStart).toBe(13);
    expect(r.steps[0]).toEqual({ slot: 0, action: 'skill' });
    expect(formatNotation(r.steps, r.characters, r.loopStart, r.rotationSec)).toContain('2nd onwards: Odette EE > Sucrose E > Mitya hEC');
  });

  it('expands repeats and multi-word names', () => {
    const r = parseNotation('Hu Tao E > 2x[Hu Tao N2C] > Kaedehara Kazuha hEQ');
    expect(r.errors).toEqual([]);
    expect(r.characters[0].name).toBe('Hu Tao');
    expect(r.steps.filter((s) => s.action === 'ca')).toHaveLength(2);
    expect(r.characters[1].name).toBe('Kaedehara Kazuha');
  });

  it('round-trips', () => {
    const r = parseNotation('Raiden E > Xingqiu EQ > Bennett QE > Xiangling QE > Raiden Q N3C N3C');
    const again = parseNotation(formatNotation(r.steps, r.characters), r.characters);
    expect(again.steps).toEqual(r.steps);
  });
});

describe('gcsim', () => {
  const cfg = `
raiden char lvl=90/90 cons=0 talent=9,9,9;
raiden add weapon="engulfinglightning" refine=1 lvl=90/90;
xingqiu char lvl=90/90 cons=6 talent=9,9,9;
bennett char lvl=90/90 cons=5 talent=9,9,9;
xiangling char lvl=90/90 cons=6 talent=9,9,9;
options iteration=1000 duration=90;
active raiden;
raiden skill;
while 1 {
  xingqiu skill, burst;
  bennett burst, skill;
  xiangling burst, skill[hold=1];
  raiden burst, attack:3, charge, attack:3, charge;
  wait(10);
}`;
  it('reads team order, opener and loop body', () => {
    const r = parseGcsim(cfg);
    expect(r.characters.map((c) => c.name)).toEqual(['Raiden Shogun', 'Xingqiu', 'Bennett', 'Xiangling']);
    expect(r.loopStart).toBe(1);
    expect(r.steps.find((s) => s.action === 'skillHold')?.slot).toBe(3);
    expect(r.steps.filter((s) => s.action === 'na').map((s) => s.count)).toEqual([3, 3]);
  });
  it('is detected by importAny and exported back', () => {
    const { loadout, format } = importAny(cfg);
    expect(format).toBe('gcsim');
    const out = formatGcsim(loadout!.steps, loadout!.characters, loadout!.loopStart);
    expect(out).toContain('xiangling burst, skill[hold=1];');
    expect(out).toContain('while 1 {');
  });
});

describe('imports', () => {
  it('reads a Genshin Optimizer target config description', () => {
    const { loadout, notes } = importAny(JSON.stringify({ name: 'MDPS C0', description: 'hECQC C 3x[hEC CQC]', targets: [] }));
    expect(loadout?.steps.length).toBe(4 + 1 + 3 * 5);
    expect(notes[0]).toMatch(/pick who/);
  });
});

describe('opener', () => {
  it('plays the opener once and loops the rest', () => {
    // 1: E > 2: Q (opener) then 2: E > 1: Q looping. The swap into the loop is moot.
    const steps = [
      { slot: 0, action: 'skill' },
      { slot: 1, action: 'burst' },
      { slot: 1, action: 'skill' },
      { slot: 0, action: 'burst' },
    ] as const;
    const flat = flatten([...steps], true, 2);
    const tr = new Tracker(flat, true, DEFAULT_SETTINGS.tracker);
    expect(tr.loopStart).toBe(flat.findIndex((s) => s.loopEntry));
    let t = 0;
    const act = (type: 'swap' | 'skill' | 'burst', slot: 0 | 1) => tr.handle({ type, slot, t: (t += 500) });
    act('skill', 0);
    act('swap', 1);
    act('burst', 1);
    // The first rotation is a lap of its own.
    expect(tr.lap).toBe(1);
    act('skill', 1);
    act('swap', 0);
    act('burst', 0);
    expect(tr.lap).toBe(2);
    expect(tr.totals.wrong + tr.totals.missed).toBe(0);
    // Second lap starts at the loop: swap to 2, E.
    act('swap', 1);
    act('skill', 1);
    act('swap', 0);
    act('burst', 0);
    expect(tr.lap).toBe(3);
    expect(tr.totals.wrong + tr.totals.missed).toBe(0);
  });
});

describe('import examples', async () => {
  const { IMPORT_EXAMPLES } = await import('./examples');
  it.each(IMPORT_EXAMPLES.map((e) => [e.id, e.text]))('%s imports', (_, text) => {
    const r = importAny(text);
    expect(r.errors).toEqual([]);
    expect(r.loadout?.steps.length).toBeGreaterThan(3);
  });
});
