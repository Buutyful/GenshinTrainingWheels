// A tiny formant voice that calls the keys: "one" … "four", "E", "Eee" (hold), "Q", "N", "C",
// "dash", "jump". No speech engine and no recordings: a buzzing source shaped by three resonant
// filters that move from vowel to vowel, plus filtered noise for consonants. The OS speech engine
// cannot be timed to the beat; this can, to the sample, so it works in rhythm mode.
//
// It sounds synthetic (close to an 80s talking toy), but short key names are easy to recognise.

type Ctx = BaseAudioContext;

/** Formant frequencies (F1, F2, F3) for a female-range voice, with how strongly each sound is voiced. */
interface Voiced {
  f: [number, number, number];
  /** Voicing level 0..1 (vowels 1, nasals quieter). */
  amp: number;
  vowel?: boolean;
}

/** Noise for consonants: a band of hiss, or a short burst for plosives. */
interface Noisy {
  hz: number;
  q: number;
  amp: number;
  /** Breath through the vowel filters (an "h") instead of a separate hiss. */
  aspirate?: boolean;
}

interface Phone {
  v?: Voiced;
  n?: Noisy;
}

const P: Record<string, Phone> = {
  i: { v: { f: [310, 2790, 3310], amp: 1, vowel: true } },
  ɛ: { v: { f: [610, 2330, 2990], amp: 1, vowel: true } },
  æ: { v: { f: [860, 2050, 2850], amp: 1, vowel: true } },
  ʌ: { v: { f: [760, 1400, 2780], amp: 1, vowel: true } },
  ɔ: { v: { f: [590, 920, 2710], amp: 1, vowel: true } },
  o: { v: { f: [500, 900, 2800], amp: 1, vowel: true } },
  u: { v: { f: [370, 950, 2670], amp: 1, vowel: true } },
  r: { v: { f: [450, 1350, 1800], amp: 0.7 } },
  w: { v: { f: [350, 700, 2400], amp: 0.6 } },
  j: { v: { f: [300, 2600, 3200], amp: 0.6 } },
  l: { v: { f: [380, 1100, 2900], amp: 0.6 } },
  n: { v: { f: [300, 1700, 2700], amp: 0.35 } },
  m: { v: { f: [300, 1100, 2500], amp: 0.3 } },
  s: { n: { hz: 6500, q: 1.5, amp: 0.35 } },
  ʃ: { n: { hz: 3000, q: 1.2, amp: 0.4 } },
  f: { n: { hz: 7000, q: 0.8, amp: 0.15 } },
  θ: { n: { hz: 6500, q: 0.7, amp: 0.12 } },
  h: { n: { hz: 0, q: 0, amp: 0.3, aspirate: true } },
  k: { n: { hz: 2200, q: 2, amp: 0.55 } },
  t: { n: { hz: 4500, q: 1.5, amp: 0.5 } },
  p: { n: { hz: 1000, q: 1, amp: 0.4 } },
  d: { v: { f: [300, 1700, 2600], amp: 0.3 }, n: { hz: 3500, q: 1.5, amp: 0.3 } },
  dʒ: { v: { f: [300, 2000, 2700], amp: 0.25 }, n: { hz: 3000, q: 1.2, amp: 0.45 } },
};

/** A word: phones with durations in seconds, and the pitch contour (start, end) in Hz. */
interface Word {
  phones: [string, number][];
  pitch: [number, number];
}

export type VoiceWord = 'one' | 'two' | 'three' | 'four' | 'E' | 'Eee' | 'Q' | 'N' | 'C' | 'dash' | 'jump';

// Delivery: a deadpan runway announcer. Female range, almost flat pitch (a small, clipped fall),
// short vowels, crisp consonants, dry and close.
export const WORDS: Record<VoiceWord, Word> = {
  one: { phones: [['w', 0.05], ['ʌ', 0.11], ['n', 0.07]], pitch: [196, 184] },
  two: { phones: [['t', 0.025], ['h', 0.02], ['u', 0.15]], pitch: [198, 184] },
  three: { phones: [['θ', 0.07], ['r', 0.045], ['i', 0.14]], pitch: [198, 186] },
  four: { phones: [['f', 0.07], ['ɔ', 0.13], ['r', 0.05]], pitch: [196, 182] },
  E: { phones: [['i', 0.14]], pitch: [200, 188] },
  // Hold skill: the same vowel, drawn out and lifting slightly, so it reads as "keep holding".
  Eee: { phones: [['i', 0.5]], pitch: [192, 214] },
  Q: { phones: [['k', 0.03], ['j', 0.045], ['u', 0.15]], pitch: [200, 186] },
  N: { phones: [['ɛ', 0.1], ['n', 0.08]], pitch: [198, 186] },
  C: { phones: [['s', 0.08], ['i', 0.13]], pitch: [200, 188] },
  dash: { phones: [['d', 0.025], ['æ', 0.11], ['ʃ', 0.1]], pitch: [198, 184] },
  jump: { phones: [['dʒ', 0.06], ['ʌ', 0.09], ['m', 0.055], ['p', 0.025]], pitch: [198, 184] },
};

/**
 * Seconds from the start of a word to where it starts to sound out loud (its first vowel, or the
 * r / w / y gliding into it): the moment a listener hears as "the beat".
 */
export function anchorOf(word: VoiceWord): number {
  let t = 0;
  for (const [ph, dur] of WORDS[word].phones) {
    if ((P[ph].v?.amp ?? 0) >= 0.6) return t;
    t += dur;
  }
  return 0;
}

export function lengthOf(word: VoiceWord): number {
  return WORDS[word].phones.reduce((a, [, d]) => a + d, 0);
}

const noiseBufs = new WeakMap<Ctx, AudioBuffer>();
function noiseBuffer(ctx: Ctx): AudioBuffer {
  let b = noiseBufs.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    let x = 0x51ce;
    for (let i = 0; i < d.length; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (x / 0x7fffffff) * 2 - 1;
    }
    noiseBufs.set(ctx, b);
  }
  return b;
}

const BANDWIDTH = [90, 110, 150];
const FORMANT_GAIN = [1, 0.85, 0.55];

/**
 * Says `word` so that it starts to sound on audio time `beat` (the consonant before it starts
 * a little earlier, like a singer placing a word on the beat). Never starts before `now`.
 */
export function say(ctx: Ctx, dest: AudioNode, word: VoiceWord, beat: number, gain = 0.4): void {
  const w = WORDS[word];
  const start = Math.max(ctx.currentTime, beat - anchorOf(word));
  const total = lengthOf(word);
  const end = start + total;

  // Source: a buzz at the voice's pitch, rounded off like a glottal pulse.
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(w.pitch[0], start);
  src.frequency.linearRampToValueAtTime(w.pitch[1], end);
  const tilt = ctx.createBiquadFilter();
  tilt.type = 'lowpass';
  tilt.frequency.value = 4500;
  tilt.Q.value = 0.5;
  const voicing = ctx.createGain();
  voicing.gain.setValueAtTime(0, start);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  noise.loop = true;
  const hissBand = ctx.createBiquadFilter();
  hissBand.type = 'bandpass';
  const hiss = ctx.createGain();
  hiss.gain.setValueAtTime(0, start);
  const breath = ctx.createGain();
  breath.gain.setValueAtTime(0, start);

  // Three formant resonators shared by voicing and breath.
  const mix = ctx.createGain();
  const formants = BANDWIDTH.map((bw, i) => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    const g = ctx.createGain();
    g.gain.value = FORMANT_GAIN[i] * 6;
    f.connect(g).connect(mix);
    return { f, bw };
  });

  src.connect(tilt).connect(voicing);
  noise.connect(hissBand).connect(hiss).connect(mix);
  noise.connect(breath);
  for (const { f } of formants) {
    voicing.connect(f);
    breath.connect(f);
  }

  // Walk the phones: formants glide into each one, levels fade over ~10 ms.
  let t = start;
  let lastF: [number, number, number] | null = null;
  for (const [ph, dur] of w.phones) {
    const p = P[ph];
    const ramp = Math.min(0.012, dur / 3);
    const voicedAmp = p.v?.amp ?? 0;
    voicing.gain.setTargetAtTime(voicedAmp * 0.5, t, ramp / 3);
    const fTarget = p.v?.f ?? lastF ?? [500, 1500, 2500];
    formants.forEach(({ f, bw }, i) => {
      const hz = fTarget[i];
      if (lastF === null) f.frequency.setValueAtTime(hz, t);
      else f.frequency.linearRampToValueAtTime(hz, t + Math.min(0.04, dur * 0.6));
      f.Q.setValueAtTime(hz / bw, t);
    });
    if (p.v) lastF = p.v.f;
    const n = p.n;
    if (n && !n.aspirate) {
      hissBand.frequency.setValueAtTime(n.hz, t);
      hissBand.Q.setValueAtTime(n.q, t);
      hiss.gain.setTargetAtTime(n.amp * 1.9, t, 0.002);
      hiss.gain.setTargetAtTime(0, t + dur - 0.005, 0.006);
    }
    if (n?.aspirate) {
      breath.gain.setTargetAtTime(n.amp * 0.6, t, 0.004);
      breath.gain.setTargetAtTime(0, t + dur - 0.005, 0.008);
    }
    t += dur;
  }
  voicing.gain.setTargetAtTime(0, end - 0.02, 0.012);

  // Close-miked presence: a lift around 3 kHz, where consonants live. No reverb.
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3000;
  presence.Q.value = 0.9;
  presence.gain.value = 5;
  const out = ctx.createGain();
  out.gain.value = gain;
  mix.connect(presence).connect(out).connect(dest);
  src.start(start);
  noise.start(start, (start * 3.7) % 0.9);
  src.stop(end + 0.1);
  noise.stop(end + 0.1);
}
