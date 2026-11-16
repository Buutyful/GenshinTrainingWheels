// Regenerates src/lib/music/grooves.json from the Groove MIDI Dataset.
//
//   1. Download https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip
//      and unzip it into .cache/groove/ (git-ignored), so .cache/groove/groove/info.csv exists.
//   2. node scripts/extract-grooves.mjs
//
// The dataset (Google LLC, CC BY 4.0) holds real drummers playing to a click. This keeps, per
// style, a handful of steady 2-bar loops and 1-bar fills as compact hit lists: the 16th each hit
// is nearest to, how far off it the drummer was (as a fraction of a 16th, so the feel survives a
// tempo change) and how hard. No audio is used or shipped; the app synthesises every hit.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, '.cache/groove/groove');
const out = join(root, 'src/lib/music/grooves.json');

/** Which dataset genres feed each app style, at which source tempos. */
const STYLES = {
  // Laid-back hip-hop played half-time on the app's 128 BPM grid (a 64 BPM feel).
  hiphop: { genres: ['hiphop'], bpm: [64, 100], beats: 10, fills: 5, backbeat: true },
  funk: { genres: ['funk', 'soul', 'dance'], bpm: [96, 140], beats: 10, fills: 5, backbeat: true },
  // House keeps a programmed four-on-the-floor kick; these give it hats and percussion.
  house: { genres: ['latin', 'afrocuban', 'afrobeat'], bpm: [90, 132], beats: 8, fills: 4 },
  rock: { genres: ['rock', 'pop', 'punk'], bpm: [110, 145], beats: 10, fills: 5, backbeat: true },
};

/** Roland TD-11 note numbers (as documented with the dataset) → drum pieces. */
const PIECE = {
  36: 'kick',
  38: 'snare', 40: 'snare', 37: 'stick',
  48: 'tomHi', 50: 'tomHi', 45: 'tomMid', 47: 'tomMid', 43: 'tomLow', 58: 'tomLow',
  42: 'hat', 22: 'hat', 44: 'pedal', 46: 'open', 26: 'open',
  49: 'crash', 55: 'crash', 57: 'crash', 52: 'crash',
  51: 'ride', 59: 'ride', 53: 'bell',
};
const PIECES = ['kick', 'snare', 'stick', 'hat', 'pedal', 'open', 'ride', 'bell', 'crash', 'tomHi', 'tomMid', 'tomLow'];

// ---------------------------------------------------------------- MIDI

function parseMidi(buf) {
  let p = 0;
  const u32 = () => (buf[p++] << 24) | (buf[p++] << 16) | (buf[p++] << 8) | buf[p++];
  const u16 = () => (buf[p++] << 8) | buf[p++];
  const vlq = () => {
    let v = 0;
    let b;
    do {
      b = buf[p++];
      v = (v << 7) | (b & 0x7f);
    } while (b & 0x80);
    return v;
  };
  if (String.fromCharCode(...buf.slice(0, 4)) !== 'MThd') throw new Error('not a MIDI file');
  p = 8;
  u16(); // format
  const tracks = u16();
  const ppq = u16();
  const notes = [];
  for (let t = 0; t < tracks; t++) {
    while (String.fromCharCode(...buf.slice(p, p + 4)) !== 'MTrk') p++;
    p += 4;
    const len = u32();
    const stop = p + len;
    let tick = 0;
    let status = 0;
    while (p < stop) {
      tick += vlq();
      let b = buf[p];
      if (b & 0x80) {
        status = b;
        p++;
      }
      const hi = status & 0xf0;
      if (status === 0xff) {
        p++; // meta type
        const n = vlq(); // not `p += vlq()`: that reads p before vlq moves it
        p += n;
      } else if (status === 0xf0 || status === 0xf7) {
        const n = vlq();
        p += n;
      } else if (hi === 0x90 || hi === 0x80 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
        const note = buf[p++];
        const vel = buf[p++];
        if (hi === 0x90 && vel > 0) notes.push({ beat: tick / ppq, note, vel });
      } else {
        p += 1; // program change / channel pressure
      }
    }
  }
  return align(notes.sort((a, b) => a.beat - b.beat));
}

/**
 * Recordings do not start on a downbeat, and every drummer sits a little ahead of or behind the
 * click. Remove the constant lag (median offset from the 16ths), then find where bars begin: the
 * phase that puts kicks on 1 (and 3) and snares on 2 and 4.
 */
function align(notes) {
  const s = notes.map((n) => n.beat * 4);
  const offs = s.map((x) => x - Math.round(x)).sort((a, b) => a - b);
  const lag = offs[Math.floor(offs.length / 2)] ?? 0;
  let best = { phase: 0, score: -1 };
  for (let phase = 0; phase < 16; phase++) {
    let score = 0;
    notes.forEach((n, i) => {
      const pos = (((Math.round(s[i] - lag) - phase) % 16) + 16) % 16;
      const piece = PIECE[n.note];
      // Loud hits count far more than ghost notes, which sit anywhere.
      const w = (n.vel / 127) ** 2;
      if (piece === 'kick') score += w * (pos === 0 ? 3 : pos === 8 ? 1 : 0);
      if (piece === 'snare') score += w * (pos === 4 || pos === 12 ? 2 : pos === 8 ? 1 : 0);
      if (piece === 'crash') score += w * (pos === 0 ? 1 : 0);
    });
    if (score > best.score) best = { phase, score };
  }
  return notes.map((n, i) => ({ ...n, beat: (s[i] - lag - best.phase) / 4 }));
}

// ---------------------------------------------------------------- grooves

/** Hits of one window, quantised: [16th, piece index, velocity 1..127, offset in 1/100 of a 16th]. */
function window(notes, fromBeat, beats) {
  const hits = [];
  for (const n of notes) {
    const piece = PIECE[n.note];
    if (!piece) continue;
    const s = (n.beat - fromBeat) * 4;
    const step = Math.round(s);
    if (step < 0 || step >= beats * 4) continue;
    hits.push([step, PIECES.indexOf(piece), n.vel, Math.round((s - step) * 100)]);
  }
  return hits;
}

/** Kick present, and the loudest snares land on 2 and 4 (or on 3, half-time). */
function hasBackbeat(hits) {
  const kick = PIECES.indexOf('kick');
  const snare = PIECES.indexOf('snare');
  if (!hits.some((h) => h[1] === kick)) return false;
  const snares = hits.filter((h) => h[1] === snare);
  if (!snares.length) return false;
  const max = Math.max(...snares.map((h) => h[2]));
  const loud = snares.filter((h) => h[2] >= max * 0.8);
  return loud.filter((h) => h[0] % 8 === 4 || h[0] % 16 === 8).length >= loud.length * 0.75;
}

/** How alike two bars are (Jaccard of step+piece), i.e. how well the window loops. */
function steadiness(hits, stepsPerBar) {
  const bar = (b) => new Set(hits.filter((h) => Math.floor(h[0] / stepsPerBar) === b).map((h) => `${h[0] % stepsPerBar}:${h[1]}`));
  const a = bar(0);
  const b = bar(1);
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / Math.max(1, new Set([...a, ...b]).size);
}

const csv = (await readFile(join(data, 'info.csv'), 'utf8')).trim().split(/\r?\n/);
const head = csv[0].split(',');
const rows = csv.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));

const result = {
  source: 'Groove MIDI Dataset (Google LLC), https://magenta.tensorflow.org/datasets/groove',
  license: 'CC BY 4.0, https://creativecommons.org/licenses/by/4.0/',
  credit: 'Gillick, Roberts, Engel, Eck and Bamman, "Learning to Groove with Inverse Sequence Transformations", ICML 2019',
  note: 'Hits are [16th, piece, velocity, offset in hundredths of a 16th]. Generated by scripts/extract-grooves.mjs.',
  pieces: PIECES,
  styles: {},
};

for (const [style, cfg] of Object.entries(STYLES)) {
  const pick = (type) =>
    rows.filter((r) => r.beat_type === type && r.time_signature === '4-4' && cfg.genres.includes(r.style.split('/')[0]) && +r.bpm >= cfg.bpm[0] && +r.bpm <= cfg.bpm[1]);

  const beats = [];
  for (const r of pick('beat')) {
    const notes = parseMidi(new Uint8Array(await readFile(join(data, r.midi_filename))));
    const bars = Math.floor((notes.at(-1)?.beat ?? 0) / 4);
    let best = null;
    // Skip the first bar (count-in feel) and the last (ending).
    for (let b = 1; b + 2 < bars; b++) {
      const hits = window(notes, b * 4, 8);
      if (!hits.some((h) => h[0] === 0) || hits.length < 12) continue;
      if (cfg.backbeat && !hasBackbeat(hits)) continue;
      const score = steadiness(hits, 16);
      if (!best || score > best.score) best = { score, hits, bar: b };
    }
    if (best) beats.push({ id: `${r.id}@${best.bar}`, genre: r.style, bpm: +r.bpm, score: +best.score.toFixed(2), hits: best.hits });
  }
  // Steadiest first, at most one per drummer session so the set has variety.
  beats.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const chosenBeats = [];
  for (const g of beats) {
    const key = g.id.split('/').slice(0, 2).join('/') + g.genre;
    if (seen.has(key)) continue;
    seen.add(key);
    chosenBeats.push(g);
    if (chosenBeats.length >= cfg.beats) break;
  }

  const fills = [];
  for (const r of pick('fill')) {
    const notes = parseMidi(new Uint8Array(await readFile(join(data, r.midi_filename))));
    const bars = Math.ceil((notes.at(-1)?.beat ?? 0) / 4);
    let best = null;
    for (let b = 0; b < bars; b++) {
      const hits = window(notes, b * 4, 4);
      const toms = hits.filter((h) => PIECES[h[1]].startsWith('tom') || PIECES[h[1]] === 'snare').length;
      if (!best || toms > best.toms) best = { toms, hits, bar: b };
    }
    if (best && best.toms >= 4) fills.push({ id: `${r.id}@${best.bar}`, genre: r.style, bpm: +r.bpm, hits: best.hits, toms: best.toms });
  }
  fills.sort((a, b) => b.toms - a.toms);
  const chosenFills = fills.filter((_, i) => i % 2 === 0).slice(0, cfg.fills).map(({ toms, ...f }) => f);

  result.styles[style] = { beats: chosenBeats, fills: chosenFills };
  console.log(`${style}: ${chosenBeats.length} beats (of ${beats.length}), ${chosenFills.length} fills (of ${fills.length})`);
}

await writeFile(out, JSON.stringify(result));
console.log(`wrote ${out}`);
