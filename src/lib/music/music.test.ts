import { describe, expect, it } from 'vitest';
import { encodeWav, fft, gridOffsets, levels, onsets, spectrogram } from './analysis';
import { BASE, demoTriggers, LIFT_CHORD, SLOT_CHORDS } from './groove';
import { acidPhrase, barSec, midiToHz, noteToMidi, notes, stepSec, steps } from './patterns';
import { dueSteps, nextGridStep, Scheduler, stepTime } from './scheduler';

describe('patterns', () => {
  it('reads step strings', () => {
    expect(steps('x.X. |9..1')).toEqual([0.75, 0, 1, 0, 1, 0, 0, 1 / 9]);
    expect(() => steps('x?')).toThrow();
  });

  it('names notes', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('Eb2')).toBe(39);
    expect(noteToMidi('F#3')).toBe(54);
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(57)).toBeCloseTo(220);
    expect(notes('C2 . G1')).toEqual([36, null, 31]);
  });

  it('has 128 BPM timing', () => {
    expect(stepSec() * 1000).toBeCloseTo(117.1875);
    expect(barSec()).toBeCloseTo(1.875);
  });

  it('folds slides into one voice', () => {
    const v = acidPhrase({ notes: 'C2 G2 . C3 Eb3 C2', accent: 'x.....', slide: '...xx.' });
    expect(v).toEqual([
      { step: 0, length: 1, pitches: [{ midi: 36, at: 0 }], accent: true },
      { step: 1, length: 1, pitches: [{ midi: 43, at: 0 }], accent: false },
      {
        step: 3,
        length: 3,
        pitches: [
          { midi: 48, at: 0 },
          { midi: 51, at: 1 },
          { midi: 36, at: 2 },
        ],
        accent: false,
      },
    ]);
  });

  it('does not slide into a rest', () => {
    const v = acidPhrase({ notes: 'C2 . C2', accent: '...', slide: 'x..' });
    expect(v.map((n) => n.length)).toEqual([1, 1]);
  });

  it('base loop is one bar of 16ths', () => {
    for (const p of [BASE.kick, BASE.hat, BASE.tick, BASE.acid.accent, BASE.acid.slide]) expect(steps(p)).toHaveLength(16);
    expect(notes(BASE.acid.notes)).toHaveLength(16);
    // Kick on every beat: four-on-the-floor.
    expect(steps(BASE.kick).map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([0, 4, 8, 12]);
  });

  it('gives every slot its own chord, rising with the slot', () => {
    const tops = SLOT_CHORDS.map((c) => Math.max(...c));
    expect(new Set(SLOT_CHORDS.map((c) => c.join())).size).toBe(4);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(LIFT_CHORD.length).toBeGreaterThanOrEqual(3);
  });

  it('demo arrangement fires every action type within 4 bars', () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 64; i++) for (const t of demoTriggers(i)) kinds.add(t.kind === 'stab' ? `stab${t.slot}` : t.kind);
    expect([...kinds].sort()).toEqual(['clap', 'drop', 'stab0', 'stab1', 'stab2', 'stab3']);
    expect(demoTriggers(64)).toEqual(demoTriggers(0));
  });
});

describe('scheduler', () => {
  it('lists the steps inside the lookahead window', () => {
    const s = stepSec();
    expect(dueSteps(0, 1, 1)).toEqual([]);
    expect(dueSteps(0, 1, 1 + 2.5 * s)).toEqual([0, 1, 2]);
    expect(dueSteps(2, 1, 1 + 2.5 * s)).toEqual([2]);
  });

  it('finds the next grid line', () => {
    const s = stepSec();
    expect(nextGridStep(0, 0)).toBe(0);
    expect(nextGridStep(0, 0.01)).toBe(1);
    expect(nextGridStep(0, 5 * s)).toBe(5);
    expect(nextGridStep(0, 5.2 * s, 4)).toBe(8);
    expect(nextGridStep(10, 3)).toBe(0);
  });

  it('queues each step exactly once at its audio time', () => {
    const clock = { currentTime: 0 };
    const played: [number, number][] = [];
    const sch = new Scheduler(clock, (i, t) => played.push([i, t]), { lookahead: 0.1 });
    sch.begin(0.05, false);
    for (let t = 0; t < 1; t += 0.025) {
      clock.currentTime = t;
      sch.tick();
    }
    const idx = played.map(([i]) => i);
    expect(idx).toEqual([...idx.keys()]);
    for (const [i, t] of played) expect(t).toBeCloseTo(stepTime(0.05, i));
    // Everything up to now + lookahead has been queued, nothing further.
    expect(played.at(-1)![1]).toBeLessThan(clock.currentTime + 0.1);
    expect(stepTime(0.05, played.length)).toBeGreaterThanOrEqual(clock.currentTime + 0.1 - 1e-9);
  });

  it('skips steps it is too late for instead of playing them late', () => {
    const clock = { currentTime: 0 };
    const played: number[] = [];
    const sch = new Scheduler(clock, (i) => played.push(i));
    sch.begin(0, false);
    clock.currentTime = 1; // the main thread stalled for a second
    sch.tick();
    expect(played[0]).toBe(0);
    expect(played.slice(1).every((i) => stepTime(0, i) >= 1 - 0.03)).toBe(true);
    expect(played.length).toBeLessThan(5);
  });

  it('stop ends scheduling', () => {
    const clock = { currentTime: 0 };
    let n = 0;
    const sch = new Scheduler(clock, () => n++);
    sch.begin(0, false);
    const before = n;
    sch.stop();
    clock.currentTime = 2;
    sch.tick();
    expect(n).toBe(before);
    expect(sch.running).toBe(false);
  });
});

describe('analysis', () => {
  const sr = 8000;
  const sine = (hz: number, sec: number, amp = 1) => Float32Array.from({ length: sr * sec }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));

  it('measures levels and clipping', () => {
    const s = levels(sine(100, 1, 0.5));
    expect(s.peak).toBeCloseTo(0.5, 2);
    expect(s.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(s.clipped).toBe(0);
    expect(levels(Float32Array.from([1, -1, 0.2])).clipped).toBe(2);
  });

  it('fft finds a pure tone', () => {
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    const mags = [...re].map((r, i) => Math.hypot(r, im[i]));
    expect(mags[5]).toBeCloseTo(n / 2);
    expect(mags[6]).toBeLessThan(1e-9);
  });

  it('spectrogram peaks at the tone, near 0 dB for full scale', () => {
    const sp = spectrogram(sine(1000, 1), sr, 1024, 512);
    const f = sp.frames[3];
    const peak = f.indexOf(Math.max(...f));
    expect(peak * sp.binHz).toBeCloseTo(1000, -1);
    expect(f[peak]).toBeGreaterThan(-2);
    expect(f[peak]).toBeLessThan(1);
  });

  it('finds low hits and their offset from the grid', () => {
    const x = new Float32Array(sr * 2);
    const hits = [0.1, 0.6, 1.105, 1.6];
    for (const h of hits) for (let i = 0; i < sr * 0.15; i++) x[Math.round(h * sr) + i] = Math.sin((2 * Math.PI * 60 * i) / sr) * Math.exp(-i / (sr * 0.05));
    const found = onsets(x, sr);
    expect(found).toHaveLength(4);
    found.forEach((t, i) => expect(Math.abs(t - hits[i])).toBeLessThan(0.002));
    const off = gridOffsets(found, 0.5, 0.1);
    expect(Math.abs(off[2] - 0.005)).toBeLessThan(0.002);
  });

  it('writes a valid WAV header', () => {
    const wav = new DataView(encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0, 0.5, -0.5])], 44100));
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(o + i)));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(wav.getUint16(22, true)).toBe(2);
    expect(wav.getUint32(24, true)).toBe(44100);
    expect(wav.byteLength).toBe(44 + 3 * 2 * 2);
    expect(wav.getInt16(44 + 4, true)).toBe(0x7fff);
    expect(wav.getInt16(44 + 8, true)).toBe(-0x8000);
  });
});
