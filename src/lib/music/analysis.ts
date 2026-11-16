// Measurements on rendered audio, so the track can be checked without listening to it.
// Pure functions on Float32Arrays: they run in tests (Node) as well as in the app.

export interface LevelStats {
  peak: number;
  rms: number;
  peakDb: number;
  rmsDb: number;
  /** Samples at or beyond full scale. */
  clipped: number;
}

export const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

export function levels(...channels: Float32Array[]): LevelStats {
  let peak = 0;
  let sum = 0;
  let n = 0;
  let clipped = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += ch[i] * ch[i];
    }
    n += ch.length;
  }
  const rms = n ? Math.sqrt(sum / n) : 0;
  return { peak, rms, peakDb: toDb(peak), rmsDb: toDb(rms), clipped };
}

export function mono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** In-place iterative radix-2 FFT; `re.length` must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface Spectrogram {
  /** frames[t][bin], magnitude in dB relative to a full-scale sine. */
  frames: Float32Array[];
  binHz: number;
  hopSec: number;
}

export function spectrogram(x: Float32Array, sampleRate: number, size = 2048, hop = 512): Spectrogram {
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const norm = size / 4; // Hann window gain × one-sided spectrum
  const frames: Float32Array[] = [];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = 0; start + size <= x.length; start += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = x[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const frame = new Float32Array(size / 2);
    for (let k = 0; k < size / 2; k++) frame[k] = toDb(Math.hypot(re[k], im[k]) / norm + 1e-12);
    frames.push(frame);
  }
  return { frames, binHz: sampleRate / size, hopSec: hop / sampleRate };
}

/**
 * Onset times (seconds) of low-frequency hits such as kicks: a one-pole lowpass, an envelope
 * follower, and a rising edge through a fraction of the loudest envelope value.
 */
export function onsets(x: Float32Array, sampleRate: number, o: { lowpassHz?: number; threshold?: number; minGapSec?: number } = {}): number[] {
  const a = Math.exp((-2 * Math.PI * (o.lowpassHz ?? 150)) / sampleRate);
  const release = Math.exp(-1 / (0.02 * sampleRate));
  const envl = new Float32Array(x.length);
  let lp = 0;
  let e = 0;
  let max = 0;
  for (let i = 0; i < x.length; i++) {
    lp = (1 - a) * x[i] + a * lp;
    const v = Math.abs(lp);
    e = v > e ? v : e * release;
    envl[i] = e;
    if (e > max) max = e;
  }
  const thr = max * (o.threshold ?? 0.35);
  // The threshold is crossed some way up the attack; the onset is where the rise began.
  const floor = max * 0.02;
  const gap = Math.round((o.minGapSec ?? 0.1) * sampleRate);
  const out: number[] = [];
  let last = -gap;
  for (let i = 1; i < envl.length; i++) {
    if (envl[i] >= thr && envl[i - 1] < thr && i - last >= gap) {
      const limit = Math.max(0, i - Math.round(0.05 * sampleRate), last + 1);
      let j = i;
      while (j > limit && envl[j - 1] > floor) j--;
      out.push(j / sampleRate);
      last = i;
    }
  }
  return out;
}

/** How far each time is from the nearest grid line (seconds; positive = late). */
export function gridOffsets(times: number[], gridSec: number, start = 0): number[] {
  return times.map((t) => {
    const r = (t - start) / gridSec;
    return (r - Math.round(r)) * gridSec;
  });
}

/** 16-bit PCM WAV. */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const nch = channels.length;
  const len = channels[0].length;
  const buf = new ArrayBuffer(44 + len * nch * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + len * nch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, len * nch * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}
