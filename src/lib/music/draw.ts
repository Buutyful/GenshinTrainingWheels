import type { Spectrogram } from './analysis';

// Dark blue → purple → orange → pale yellow, readable on the app's dark background.
const STOPS: [number, number, number][] = [
  [10, 12, 22],
  [52, 26, 110],
  [160, 40, 120],
  [240, 110, 50],
  [252, 240, 170],
];

function color(v: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, v)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export interface DrawOpts {
  /** Seconds between vertical guide lines (one beat), and how many make a bar. */
  beatSec: number;
  beatsPerBar?: number;
  minHz?: number;
  maxHz?: number;
  floorDb?: number;
}

/** Waveform on top, log-frequency spectrogram below, beat and bar lines across both. */
export function drawAnalysis(canvas: HTMLCanvasElement, wave: Float32Array, sampleRate: number, spec: Spectrogram, o: DrawOpts): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const waveH = Math.round(H * 0.22);
  const specTop = waveH + 6;
  const specH = H - specTop - 14;
  const duration = wave.length / sampleRate;
  const minHz = o.minHz ?? 30;
  const maxHz = o.maxHz ?? 16000;
  const floor = o.floorDb ?? -90;

  g.fillStyle = '#0b0d14';
  g.fillRect(0, 0, W, H);

  // Waveform: min/max per pixel column.
  g.fillStyle = '#7c9cff';
  const per = wave.length / W;
  for (let x = 0; x < W; x++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(wave.length, Math.floor((x + 1) * per));
    for (let i = Math.floor(x * per); i < end; i++) {
      if (wave[i] < lo) lo = wave[i];
      if (wave[i] > hi) hi = wave[i];
    }
    const mid = waveH / 2;
    g.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
  }
  g.fillStyle = 'rgba(248,113,113,0.5)';
  g.fillRect(0, 0, W, 1);
  g.fillRect(0, waveH - 1, W, 1);

  // Spectrogram.
  const img = g.createImageData(W, specH);
  const nFrames = spec.frames.length;
  const nBins = spec.frames[0]?.length ?? 0;
  const lmin = Math.log(minHz);
  const lmax = Math.log(maxHz);
  const binOfRow = new Int32Array(specH);
  for (let y = 0; y < specH; y++) {
    const hz = Math.exp(lmax - (y / (specH - 1)) * (lmax - lmin));
    binOfRow[y] = Math.min(nBins - 1, Math.round(hz / spec.binHz));
  }
  for (let x = 0; x < W; x++) {
    const f = Math.min(nFrames - 1, Math.floor(((x / W) * duration) / spec.hopSec));
    const frame = spec.frames[f];
    if (!frame) continue;
    for (let y = 0; y < specH; y++) {
      const [r, gg, b] = color((frame[binOfRow[y]] - floor) / -floor);
      const p = (y * W + x) * 4;
      img.data[p] = r;
      img.data[p + 1] = gg;
      img.data[p + 2] = b;
      img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, specTop);

  // Frequency labels.
  g.font = '10px system-ui, sans-serif';
  g.fillStyle = 'rgba(231,233,240,0.7)';
  for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const y = specTop + ((lmax - Math.log(hz)) / (lmax - lmin)) * (specH - 1);
    g.fillRect(0, y, 4, 1);
    g.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), 6, y + 3);
  }

  // Beat and bar lines.
  const perBar = o.beatsPerBar ?? 4;
  for (let i = 0, t = 0; t < duration; i++, t = i * o.beatSec) {
    const x = Math.round((t / duration) * W);
    const bar = i % perBar === 0;
    g.fillStyle = bar ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
    g.fillRect(x, 0, 1, H - 12);
    if (bar) {
      g.fillStyle = 'rgba(231,233,240,0.7)';
      g.fillText(String(i / perBar + 1), x + 3, H - 2);
    }
  }
}
