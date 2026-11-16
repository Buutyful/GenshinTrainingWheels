# Genshin Training Wheels

Training wheels for Genshin Impact team rotations. You describe your team and its rotation
once; then the app listens to your keys while you play, follows where you are in the rotation,
and cues the next move through your headphones — early enough to react to. Once the rotation
is in your hands, turn the cues down and ride without them.

It only reads your keyboard and mouse. It does not read the game's memory or screen, inject
anything, or send any input.

## Install

Download the installer from the [Releases](../../releases) page and run it. The app is free,
open and **not code-signed**, so Windows does not know the publisher:

- **SmartScreen** shows "Windows protected your PC". Choose *More info → Run anyway*.
- **Smart App Control** (Windows 11, only if it is switched on) blocks unsigned apps outright
  and offers no "run anyway". The app cannot start while it is on; you can check it under
  Windows Security → App & browser control → Smart App Control.

## How it works

1. **Create a loadout**: four characters in party order and the rotation, either with the
   buttons or by typing it:

   ```
   Raiden E > Xingqiu EQ > Bennett QE > Xiangling QE > Raiden Q N3C N3C
   Rotation time: 21 s
   ```

   This is the notation leaderboards such as Hexenzirkel and KQM guides use. Characters by
   name, nickname or slot number (`1`–`4`), picked from a searchable roster with portraits.
   Actions: `E`, `hE` (hold), `Q`, `N1`–`N9`, `C` / `CA`, `D` (dash), `J` (jump), `P`
   (plunge); `2x[…]` repeats. Swaps are implied. Lines starting with `1st rotation:` and
   `2nd onwards:` give a first rotation that differs from the rest.

   **Import** also reads gcsim configs (team from the `char` lines, the loop body from the
   first `while`/`for`) and Genshin Optimizer target configs (what Hexenzirkel's
   "Export rotation" downloads). **Export** writes the rotation text, a gcsim action list or a
   full loadout.

2. **Set the rotation time** — how long one lap should take. Runs show a pace bar against it.

3. **Press Start**, switch to the game, and play. The tutor knows who is on field from your swap
   keys, reads Alt+number as "swap and burst", tells a tap from a hold, and counts attacks.

4. **Stop** (F10 by default) to see the run's metrics: laps against the rotation time, field
   time and every input per character, accuracy per character and the steps you miss most.
   **Metrics** on a loadout shows the same for every past run, plus trends over runs.

The character roster and portraits ship with the app (regenerate them with
`node scripts/update-roster.mjs`); nothing is downloaded at run time.

### What counts as a mistake

Skills, bursts and swaps are judged strictly. Attacks, dashes and jumps are not: click counts
and movement cannot be verified from input alone, so extra or missing ones never count against
you. Mashing a key, or swapping back to the right character, is not an error either.

### When you lose the thread

- Skip a step or two and the tutor marks them missed and carries on from where you are.
- After several wrong inputs in a row it declares you **off track**: it stops judging, and
  picks you up again as soon as you start any character's block (or, optionally, only when you
  restart from step one).
- Stop pressing keys for a few seconds and the run is **paused** without penalty.

### Audio cues

Cues are short, synthesised, arcade-style sounds — no voices. They play **ahead of time**
(500 ms by default), because a cue that sounds at the instant a key is due arrives too late to
act on. A soft build-up rises from the cue to the moment to press.

To cue ahead, the tutor needs to know the rhythm of the rotation. It starts from typical
values and then learns the timing of your own clean, consecutive steps, per loadout.

| Cue | Sound |
| --- | --- |
| Swap to slot N | Arpeggio climbing N notes |
| Skill / hold skill | Rising "bloop" / the same, sustained |
| Burst | Fast high trill ending on a sparkle |
| Attacks / charged | One "tok" per hit / tok and a low drop |
| Dash / jump | Breath of noise / upward chirp |

Every sound can be auditioned under Settings → Sound guide.

## Things to know

- **Administrator rights.** Genshin Impact runs elevated, and Windows hides input from
  non-elevated apps while an elevated window has focus. The app starts normally and offers a
  "Restart as administrator" button for in-game tracking.
- **Antivirus and SmartScreen.** The app uses Windows Raw Input (a read-only copy of input
  events) rather than a keyboard hook, registers for input only while a run is active, makes no
  network connections and never writes keystrokes to disk. Build from source if you would
  rather not trust a download.
- **Game terms.** This is an unofficial third-party tool. It does not interact with the game
  client, but HoYoverse's terms do not approve third-party tools in general; use it at your own
  discretion.
- **Windowed or borderless** is needed to see the compact overlay; audio cues work in any mode.
- Input-only tracking cannot see cooldowns, energy or a swap the game refused.

## Development

Requires Node.js, Rust and the Microsoft C++ Build Tools. Smart App Control also blocks the
helper programs Rust generates while compiling, so the desktop app only builds locally with it
switched off; the browser UI and the tests are not affected.

```bash
npm install
npm test            # tracker, interpreter, cue timing
npm run dev         # UI in a browser (practice mode: keys only while the page has focus)
npm run tauri dev   # the desktop app
npm run tauri build # installer in src-tauri/target/release/bundle
```

- `src/lib/interpreter.ts` — raw input to game actions
- `src/lib/engine.ts` — rotation tracking, skips, off-track and resync
- `src/lib/cues.ts`, `src/lib/timing.ts`, `src/lib/audio.ts` — when to cue, learned rhythm, sound
- `src-tauri/src/capture.rs` — Raw Input listener

Releases are built by GitHub Actions when a `v*` tag is pushed.

Not affiliated with HoYoverse.
