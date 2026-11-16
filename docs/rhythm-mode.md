# Rhythm mode — design brief

Status: **milestone 1 done** (engine + Jam lab), milestones 2–4 open. This is the hand-off
document for building it. Read it whole before writing code; the "Constraints" section is not
optional.

### Milestone 1 notes

- Code lives in `src/lib/music/`: `patterns.ts` (notation, 128 BPM grid), `instruments.ts`
  (kick, hat, clap, crash, acid, stab, supersaw), `bus.ts` (sidechain duck + compressor),
  `scheduler.ts` (lookahead scheduler), `groove.ts` (base loop, slot chords, offline render),
  `analysis.ts` + `draw.ts` (levels, FFT, spectrogram, onsets, WAV). Tests in `music.test.ts`.
- Jam lab: Settings → "Open the Jam lab" (`src/views/JamView.svelte`). Knobs are saved in
  `settings.music` (`MusicSettings`).
- Slot chords rise with the slot number (Cm, Eb, Fm, Gm), matching the existing cue vocabulary.
- Measured: the music bus compressor (Chromium `DynamicsCompressorNode`) delays everything by a
  constant ~6 ms; kick jitter offline is < 0.5 ms. Judging (milestone 3) must account for this
  constant, or the calibration clicks must go through the same chain.
- The Tauri window already disables background timer throttling, so a plain `setInterval`
  drives the scheduler; blob Workers would be blocked by the CSP anyway.

## The idea in one paragraph

Today the audio *follows* the player: cues are predicted from their own rhythm and wait when
they are late. Rhythm mode adds the opposite: the rotation itself becomes a **backing track**
that the player plays on top of, like a rhythm game. The track is generated from the
player's **own clean lap**, quantised to a 128 BPM grid, and every rotation action has its own
musical block (a swap is a synth stab, a burst is the drop, …). On top of the music sit short
judgement sounds — perfect / good / early / late / miss. The existing adaptive cue mode stays
as the "learning" mode; rhythm mode is for once the rotation is known.

## What exists today (read these files first)

| File | Role |
| --- | --- |
| `src/lib/engine.ts` | `flatten()` turns a loadout into `FlatStep[]` (with implicit swaps, `loopEntry`); `Tracker` decides which step the player is on and emits `TrackerEvent`s (`start`, `progress`, `hit`, `skip`, `wrong`, `offtrack`, `resync`, `lap`, `done`). |
| `src/lib/timing.ts` | `TimingLearner`: learns `gap[i]` (time after step *i* to the next) and `span[i]` (duration of an attack string) from consecutive correct steps only; blends 35 % per sample; saved per loadout under a rotation signature (`timingSig`). Defaults in `DEFAULT_GAP`. |
| `src/lib/cues.ts` | `CueDirector`: walks the predicted timeline and schedules each step's cue `leadMs` (500 ms) early, with a build-up riser; reminders when late; modes `full` / `swaps` / `adaptive` / `off`. |
| `src/lib/audio.ts` | `AudioOut`: Web Audio synthesiser. Master gain → lowpass 5.2 kHz → compressor. Pentatonic C palette, `note()`, `whoosh()`, `riser()`, `sfx()`. No sample files. |
| `src/lib/session.svelte.ts` | Wires it together: raw input → interpreter → tracker → learner + director + metrics; 50 ms tick; `audio.unlock()` on Start (user gesture). |
| `src/lib/metrics.ts` | Per-run metrics (field time, actions, laps). Rhythm judgements should feed into it. |
| `src/lib/types.ts` | `AudioSettings` (`volume`, `guidance`, `leadMs`, `buildup`, `hesitateMs`, `feedback`, `hitTick`), `Timings`, `Loadout`. Defaults in `src/lib/defaults.ts`. |

Input timestamps come from Windows Raw Input in the Tauri shell (`src-tauri/src/capture.rs`)
and use the same clock as `nowMs()` in `src/lib/platform.ts`.

## Musical style

The user's reference is a style prompt; build towards it:

> fashion show electroclash techno, 128 BPM, 4/4, dry analog kick, rolling acid bassline,
> cold detuned synth stabs, sweeping orchestral strings on the builds, deadpan female
> spoken-word verses, close and dry, clipped and confident, euphoric sung female trance chorus
> with a supersaw lift and big clear vowels, crowd call-and-response shouts, stacked chanted
> vocals in the drop, a key change up into the last chorus, catwalk energy, cold, luxurious,
> optimistic, Berlin minimal austerity, clean modern mix

(The user called this "slopcore". The term is loose internet slang, so go by the description
above, not the word.)

Everything except worded vocals can be synthesised; the genre's sounds are synthesisers in
the first place.

## Mapping rotation → music

| Rotation | Music | Synthesis sketch |
| --- | --- | --- |
| Lap | N whole bars at 128 BPM; base loop runs throughout | — |
| Pulse | Dry analog kick on every beat, hats on off-beats | Kick: sine, fast pitch drop ~150→45 Hz, short decay, no reverb. Hat: high-passed noise, very short |
| Base | Rolling acid bassline | 303-style: saw → resonant lowpass with envelope, accents, slides (portamento); filter opens gradually across the lap |
| Swap to slot N | Cold detuned stab, **one chord per slot** | 2–3 saws detuned ±8–15 cents, short, dry |
| E / hold E | Clap/snare / held stab | Noise burst + body tone / stab with sustain |
| Normal attacks | Hat or acid 16ths, one per click | — |
| Charged attack | Accented acid note with filter snap | — |
| Bars before a Q | **Build**: sweeping strings + rising filter | Slow-attack detuned saw pad, lowpass sweeping up |
| Q (burst) | **Drop**: impact + supersaw lift | 7 detuned saws, wide; crash = noise with long decay |
| Dash / jump | Filter sweep / pitch blip | — |
| Clean lap | Stacked chanted vowels in the next drop | Formant synthesis ("ah"/"oh"/"ey"), no words |
| Perfect judgement | Crowd "hey!" shout | Shaped noise burst with a vowel formant |
| 3rd clean lap in a row | Key change up a whole step into the next lap | Transpose every pitched voice +2 semitones |
| Mix | Clean, minimal, little reverb, kick sidechain | Duck bass/pads on each kick; keep the existing compressor last |

Every arranged element must *mean* an action — "Berlin minimal" austerity is also what keeps
the track readable as a rotation.

## Architecture

Own engine on plain Web Audio, in TypeScript, in the style of a live-coding tool (patterns +
instruments + scheduler):

```ts
// 1 bar = 16 steps at 128 BPM
kick: 'x...x...x...x...'
hat:  '..x...x...x...x.'
acid: { notes: 'C2 C2 Eb2 C3 . G1 C2 Bb1', accent: 'x..x....', slide: '...x....' }
```

Suggested modules (names are suggestions):

- `src/lib/music/instruments.ts` — functions that build node graphs: `kick`, `hat`, `clap`,
  `acid`, `stab(chord)`, `supersaw(chord)`, `strings(chord)`, `chant(vowel)`, `crowd()`.
  Each takes `(ctx, dest, time, params)`.
- `src/lib/music/patterns.ts` — tiny pattern notation parser (step strings, note lists).
- `src/lib/music/arrange.ts` — **pure function**: `(steps: FlatStep[], timings: Timings,
  loopStart) → Arrangement` (bars, BPM, list of `{ time, instrument, params, stepIndex }`,
  plus `targets[stepIndex] = beat time`). Unit-testable without audio.
- `src/lib/music/scheduler.ts` — lookahead scheduler: every ~25 ms queue events falling in the
  next ~100 ms on `ctx.currentTime`. Never schedule from `setTimeout` timing directly.
- `src/lib/rhythm.ts` — judging (see below), plugs into `Tracker` events.

### Building the arrangement from a clean lap

1. A lap is "clean" by the existing `lap` event (`clean: true`). Record the timestamps of each
   step's `hit` during it (or use learned `Timings`, which are only learned from clean steps).
2. Lap length L → bars = round(L / (4 × 60/128 s)), minimum 1. Keep BPM fixed at 128 and
   **quantise each step to the nearest 16th** (±58 ms max at 128 BPM). Do not change BPM per
   loadout unless the user asks.
3. Store the arrangement per loadout, keyed by `timingSig`, like timings are; invalidate when
   the rotation changes. Let the player re-record from a newer clean lap.

### Judging

- For the step the tracker says the player is on, compare the input time (minus calibrated
  output latency) to its target beat time.
- Windows to start with: perfect ±50 ms, good ±110 ms, beyond that early/late, missing the
  step's window entirely = miss. Make them constants, they will need tuning.
- *Which* step is still the tracker's job; rhythm only adds *when*. Keep the tracker's
  leniency rules (attacks, dashes and jumps are never errors) — judge those loosely or not at
  all.
- The music **does not wait** for the player. Off-track: keep the beat, drop the action layer,
  resume when the tracker resyncs (align to the next bar).

### Latency calibration

One-time "tap along" screen: play a click on beats, the player presses a key for 8–16 beats,
store the median offset in settings. Bluetooth headphones can add 150 ms+; the value must be
per device (settings, not per loadout).

## Verification without ears

The agent cannot hear audio. Check what can be checked, leave taste to the user:

- Render with `OfflineAudioContext` (a bar, a lap) — faster than realtime, deterministic.
- Write a WAV for the user to listen to.
- Measure: peak/RMS per element, clipping, kick onset times vs. the grid, sidechain depth.
- Draw a **spectrogram and waveform to PNG** and look at it: kick boom, acid filter sweep,
  supersaw width, hat harshness, string rise before the drop.
- Unit-test `arrange.ts` (bars, quantisation, targets, key change) and the judging windows
  with synthetic events (Vitest).
- Add a **Jam screen** (dev/settings) that loops the base pattern with a few knobs (acid
  cutoff/resonance, stab detune, drive, volumes) so the user can tune by ear and report back.

## Constraints

- **No TTS, no worded vocals.** The user ruled out speech synthesis. Vowel/chant formants only.
  Real vocals only if the user supplies recordings they have rights to — later, optional.
- **No AGPL dependencies** (Strudel is AGPL). Prefer no new dependency at all; Tone.js (MIT)
  is acceptable if the own engine gets out of hand.
- **Offline, no shipped samples needed.** Everything synthesised; no network at run time.
- **Builds run on GitHub Actions** (`.github/workflows/ci.yml`); Smart App Control blocks
  local Rust builds. Front-end work and tests run locally (`npm test`, `npm run dev`,
  `npx svelte-check --tsconfig ./tsconfig.json`).
- Svelte 5 runes, TypeScript, Vitest; match existing code style.
- Keep the current cue modes intact. Rhythm mode is a new `guidance`-like option or a
  separate session mode, not a replacement.

## Milestones

1. Engine: instruments (kick, hat, acid, stab, supersaw) + scheduler + Jam screen.
   Offline render + spectrogram check.
2. `arrange.ts` from a clean lap, stored per loadout; play the track during a session.
3. Judging + judgement sounds + latency calibration; judgements into metrics/RunReport.
4. Strings builds, chant on clean laps, crowd shouts, key change.

## Open questions for the user

- Rhythm mode as a separate "Mode" on Start, or a fourth `guidance` value?
- Should a miss restart the bar, or always keep going (current plan: keep going)?
- Volume balance music vs. judgement sounds — default 70/30?
