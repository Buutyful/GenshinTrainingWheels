// Tiny pattern notation for the rhythm engine, in the spirit of live-coding tools.
//
//   kick: 'x...x...x...x...'          one character per 16th; '.' rest, 'x' hit, 'X' accent,
//                                      '1'..'9' explicit velocity (n / 9). Spaces and '|' are ignored.
//   acid: 'C2 C2 Eb2 C3 . G1 ...'     one token per 16th; '.' rest. Note names use b / # for
//                                      flats and sharps; octave 4 holds middle C (C4 = MIDI 60).

export const BPM = 128;
export const STEPS_PER_BAR = 16;

/** Length of one 16th note in seconds (~117 ms at 128 BPM). */
export const stepSec = (bpm = BPM) => 60 / bpm / 4;
export const barSec = (bpm = BPM) => stepSec(bpm) * STEPS_PER_BAR;

/** Velocity per step, 0 for a rest. */
export function steps(pattern: string): number[] {
  const out: number[] = [];
  for (const ch of pattern) {
    if (ch === ' ' || ch === '|') continue;
    if (ch === '.' || ch === '-') out.push(0);
    else if (ch === 'x') out.push(0.75);
    else if (ch === 'X') out.push(1);
    else if (ch >= '1' && ch <= '9') out.push(Number(ch) / 9);
    else throw new Error(`Unknown step character "${ch}" in "${pattern}"`);
  }
  return out;
}

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteToMidi(name: string): number {
  const m = /^([A-Ga-g])(b|#)?(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Not a note: "${name}"`);
  const acc = m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0;
  return 12 * (Number(m[3]) + 1) + PITCH[m[1].toUpperCase()] + acc;
}

export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** MIDI note per step, null for a rest. */
export function notes(pattern: string): (number | null)[] {
  return pattern
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => (tok === '.' || tok === '-' ? null : noteToMidi(tok)));
}

export interface AcidPattern {
  notes: string;
  accent: string;
  /** A slide on step i glides into the note on step i + 1 without retriggering it. */
  slide: string;
}

/** One acid voice: a gate that may glide through several pitches. */
export interface AcidNote {
  step: number;
  /** Gate length in steps. */
  length: number;
  /** Pitches with their offset from `step`, in steps; the first is at 0. */
  pitches: { midi: number; at: number }[];
  accent: boolean;
}

/** Groups a 303-style pattern into voices, folding slid notes into the one before them. */
export function acidPhrase(p: AcidPattern): AcidNote[] {
  const ns = notes(p.notes);
  const acc = steps(p.accent);
  const sl = steps(p.slide);
  const out: AcidNote[] = [];
  for (let i = 0; i < ns.length; i++) {
    const first = ns[i];
    if (first === null) continue;
    const voice: AcidNote = { step: i, length: 1, pitches: [{ midi: first, at: 0 }], accent: (acc[i] ?? 0) > 0 };
    let j = i;
    while ((sl[j] ?? 0) > 0 && j + 1 < ns.length && ns[j + 1] !== null) {
      j++;
      voice.pitches.push({ midi: ns[j]!, at: j - i });
    }
    voice.length = j - i + 1;
    out.push(voice);
    i = j;
  }
  return out;
}
