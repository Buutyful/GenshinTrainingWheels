<script lang="ts">
  import Mixer from '../components/Mixer.svelte';
  import { onDestroy } from 'svelte';
  import { app, go } from '../lib/app.svelte';
  import { cueGain, onMix } from '../lib/mix';
  import { woodTick } from '../lib/music/cuelayer';
  import { BPM } from '../lib/music/patterns';
  import { epochToAudio } from '../lib/music/player';
  import { isTauri, nowMs, startCapture, type StopCapture } from '../lib/platform';
  import { calibrate, MIN_TAPS, tapOffsets, type Calibration } from '../lib/rhythm';

  /** Beats heard before the taps count, then beats to tap along to. */
  const COUNT_IN = 4;
  const BEATS = 16;
  const beatMs = 60000 / BPM;

  const audio = $derived(app.data.settings.audio);

  let phase = $state<'idle' | 'running' | 'done'>('idle');
  /** Beat being heard: below COUNT_IN is the count-in. */
  let beat = $state(-1);
  let taps = $state(0);
  let result = $state<Calibration | null>(null);
  let saved = $state(false);

  let ctx: AudioContext | null = null;
  let stopCapture: StopCapture | null = null;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function run() {
    stop();
    result = null;
    saved = false;
    taps = 0;
    beat = -1;
    // A key that started this would otherwise be read as the first tap (or re-press the button).
    (document.activeElement as HTMLElement | null)?.blur();
    const c = new AudioContext({ latencyHint: 'interactive' });
    ctx = c;
    await c.resume();
    const out = c.createGain();
    out.connect(c.destination);
    // The click is plain Web Audio, without the band's limiter; judging adds that chain's delay itself.
    unsubscribe = onMix((m) => out.gain.setTargetAtTime(cueGain(m) * 1.4, c.currentTime, 0.01));
    const t0 = c.currentTime + 0.4;
    for (let k = 0; k < COUNT_IN + BEATS; k++) woodTick(c, out, t0 + (k * beatMs) / 1000, k % 4 === 0 ? 0.6 : 0.4);

    // Taps are kept in audio time (ms): the same clock the clicks were scheduled on.
    const at: number[] = [];
    const first = t0 * 1000 + (COUNT_IN - 0.5) * beatMs;
    const last = t0 * 1000 + (COUNT_IN + BEATS - 0.5) * beatMs;
    stopCapture = await startCapture((e) => {
      if (!e.down || e.code === 'Escape' || ctx !== c) return;
      const t = epochToAudio(c, e.t) * 1000;
      if (t < first || t > last) return;
      at.push(t);
      taps = at.length;
    });
    phase = 'running';
    timer = setInterval(() => {
      const heard = epochToAudio(c, nowMs()) * 1000;
      beat = Math.floor((heard - t0 * 1000) / beatMs + 0.5);
      if (heard > last + beatMs) {
        result = calibrate(tapOffsets(at, t0 * 1000, beatMs));
        phase = 'done';
        stop();
      }
    }, 20);
  }

  function stop() {
    clearInterval(timer);
    stopCapture?.();
    stopCapture = null;
    unsubscribe?.();
    unsubscribe = null;
    void ctx?.close();
    ctx = null;
  }

  function save() {
    if (!result) return;
    audio.latencyMs = result.latencyMs;
    saved = true;
  }

  onDestroy(stop);
</script>

<header class="bar">
  <button onclick={() => go({ name: 'settings' })}>Back</button>
  <h1>Latency calibration</h1>
  <div class="spacer"></div>
  <Mixer />
</header>

<main class="page narrow">
  <section class="panel">
    <h2>Tap along</h2>
    <p class="muted">
      Rhythm mode judges each step against the beat you hear. Headphones, speakers and keyboards each add their own delay
      (Bluetooth can add 150 ms or more), so measure it once per setup. Use the headphones and keyboard you play with.
    </p>
    <p class="muted">
      You will hear {COUNT_IN} count-in clicks, then {BEATS} more. Press any key {isTauri ? 'or mouse button' : ''} on every click
      after the count-in. Listen to the clicks, don't watch the screen.
    </p>

    <div class="stage" class:live={phase === 'running'}>
      {#if phase === 'running'}
        {#if beat < COUNT_IN}
          <div class="big muted">{beat < 0 ? '…' : beat + 1}</div>
          <div class="muted">count-in — get ready</div>
        {:else}
          <div class="big">{Math.min(BEATS, beat - COUNT_IN + 1)} / {BEATS}</div>
          <div class="muted">{taps} tap{taps === 1 ? '' : 's'}</div>
        {/if}
      {:else if phase === 'done'}
        {#if result}
          <div class="big">{result.latencyMs} ms</div>
          <div>
            Your presses land {Math.abs(result.latencyMs)} ms {result.latencyMs >= 0 ? 'after' : 'before'} the click you hear
            · steady to ±{result.spreadMs} ms · {result.used} taps
          </div>
          {#if result.spreadMs > 35}
            <div class="warn-text">Your taps were spread out. Try again for a steadier number.</div>
          {/if}
        {:else}
          <div class="big muted">—</div>
          <div>Not enough steady taps ({taps}; at least {MIN_TAPS} are needed). Try again.</div>
        {/if}
      {:else}
        <div class="muted">Current setting: <b>{audio.latencyMs} ms</b></div>
      {/if}
    </div>

    <div class="row">
      <button class:primary={phase !== 'done' || !result} onclick={run} disabled={phase === 'running'}>
        {phase === 'idle' ? 'Start' : 'Try again'}
      </button>
      {#if phase === 'done' && result}
        <button class="primary" onclick={save} disabled={saved}>{saved ? 'Saved' : `Use ${result.latencyMs} ms`}</button>
      {/if}
      <div class="spacer"></div>
      <button class="ghost" onclick={() => (audio.latencyMs = 0)}>Reset to 0 ms</button>
    </div>
  </section>
</main>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 28px 12px;
    margin: 8px 0;
    border-radius: var(--radius);
    background: var(--panel-2);
    text-align: center;
    min-height: 130px;
    justify-content: center;
  }
  .big {
    font-size: 44px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .warn-text {
    color: var(--warn);
  }
</style>
