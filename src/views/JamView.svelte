<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app, go } from '../lib/app.svelte';
  import { DEFAULT_SETTINGS } from '../lib/defaults';
  import { encodeWav, gridOffsets, levels, mono, onsets, spectrogram, type LevelStats } from '../lib/music/analysis';
  import { drawAnalysis } from '../lib/music/draw';
  import { Groove, LAYERS, renderGroove, type Layer, type Trigger } from '../lib/music/groove';
  import { BPM, stepSec, STEPS_PER_BAR } from '../lib/music/patterns';
  import { Scheduler } from '../lib/music/scheduler';
  import type { MusicSettings } from '../lib/types';

  const m = $derived(app.data.settings.music);

  const LAYER_LABEL: Record<Layer, string> = {
    kick: 'Kick',
    hat: 'Hats',
    acid: 'Acid bass',
    stab: 'Swap stabs',
    clap: 'Skill clap',
    lift: 'Burst drop',
  };
  let layers = $state<Record<Layer, boolean>>(Object.fromEntries(LAYERS.map((l) => [l, true])) as Record<Layer, boolean>);
  let demo = $state(true);
  let playing = $state(false);
  let beat = $state(-1);

  let ctx: AudioContext | null = null;
  let groove: Groove | null = null;
  let sched: Scheduler | null = null;
  let beatTimer: ReturnType<typeof setInterval> | undefined;

  const activeLayers = () => LAYERS.filter((l) => layers[l]);

  $effect(() => {
    if (!groove) return;
    groove.layers = new Set(activeLayers());
    groove.demo = demo;
  });

  async function start() {
    if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state !== 'running') await ctx.resume();
    groove = new Groove(ctx, ctx.destination, app.data.settings.music);
    groove.layers = new Set(activeLayers());
    groove.demo = demo;
    sched = new Scheduler(ctx, (step, t) => groove?.play(step, t));
    sched.begin();
    playing = true;
    beatTimer = setInterval(() => {
      if (sched && ctx) beat = Math.floor(sched.position(ctx.currentTime - ctx.outputLatency) / 4);
    }, 30);
  }

  function stop() {
    sched?.stop();
    groove?.bus.disconnect();
    sched = null;
    groove = null;
    playing = false;
    beat = -1;
    clearInterval(beatTimer);
  }

  function hit(t: Trigger) {
    if (!playing) void start().then(() => groove?.trigger(t));
    else groove?.trigger(t);
  }

  const KEYS: Record<string, Trigger> = {
    Digit1: { kind: 'stab', slot: 0 },
    Digit2: { kind: 'stab', slot: 1 },
    Digit3: { kind: 'stab', slot: 2 },
    Digit4: { kind: 'stab', slot: 3 },
    KeyE: { kind: 'clap' },
    KeyQ: { kind: 'drop' },
  };
  function onKey(e: KeyboardEvent) {
    if (e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (playing) stop();
      else void start();
    } else if (KEYS[e.code]) hit(KEYS[e.code]);
  }
  window.addEventListener('keydown', onKey);

  type Knob = { key: keyof MusicSettings; label: string; min: number; max: number; step: number; fmt?: (v: number) => string };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const KNOBS: Knob[] = [
    { key: 'cutoff', label: 'Acid cut-off', min: 80, max: 3000, step: 10, fmt: (v) => `${v} Hz` },
    { key: 'resonance', label: 'Acid resonance', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'envMod', label: 'Acid envelope', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'decay', label: 'Acid decay', min: 0.05, max: 0.8, step: 0.01, fmt: (v) => `${Math.round(v * 1000)} ms` },
    { key: 'drive', label: 'Acid drive', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'stabDetune', label: 'Stab detune', min: 0, max: 30, step: 1, fmt: (v) => `±${v} ct` },
    { key: 'sawDetune', label: 'Supersaw spread', min: 0, max: 80, step: 1, fmt: (v) => `${v} ct` },
    { key: 'sidechain', label: 'Sidechain pump', min: 0, max: 0.95, step: 0.01, fmt: pct },
  ];
  const LEVELS: Knob[] = [
    { key: 'volume', label: 'Music volume', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'kick', label: 'Kick', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'hat', label: 'Hats & clap', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'acid', label: 'Acid', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'stab', label: 'Stabs', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'lift', label: 'Drop', min: 0, max: 1, step: 0.01, fmt: pct },
  ];

  function resetSound() {
    app.data.settings.music = structuredClone(DEFAULT_SETTINGS.music);
  }

  // ---------------------------------------------------------------- offline analysis

  let canvas = $state<HTMLCanvasElement | null>(null);
  let busy = $state(false);
  let report = $state<{ rows: { name: string; s: LevelStats }[]; kicks: number; meanMs: number; jitterMs: number; renderMs: number; seconds: number } | null>(null);
  let lastWav: AudioBuffer | null = null;
  const BARS = 4;

  async function analyse() {
    busy = true;
    try {
      const settings = $state.snapshot(app.data.settings.music);
      const t0 = performance.now();
      const mix = await renderGroove(settings, { bars: BARS, layers: activeLayers(), demo });
      const renderMs = performance.now() - t0;
      lastWav = mix;
      const chans = [mix.getChannelData(0), mix.getChannelData(1)];
      const rows: { name: string; s: LevelStats }[] = [{ name: 'Mix', s: levels(...chans) }];
      for (const l of activeLayers()) {
        const solo = await renderGroove(settings, { bars: BARS, layers: [l], demo: true });
        rows.push({ name: LAYER_LABEL[l], s: levels(solo.getChannelData(0), solo.getChannelData(1)) });
      }
      const kickOnly = await renderGroove(settings, { bars: BARS, layers: ['kick'] });
      const ks = onsets(kickOnly.getChannelData(0), kickOnly.sampleRate);
      const offs = gridOffsets(ks, stepSec()).map((x) => x * 1000);
      const meanMs = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : NaN;
      report = {
        rows,
        kicks: ks.length,
        meanMs,
        jitterMs: offs.length ? Math.max(...offs.map((x) => Math.abs(x - meanMs))) : NaN,
        renderMs,
        seconds: mix.duration,
      };
      const wave = mono(chans);
      if (canvas) drawAnalysis(canvas, wave, mix.sampleRate, spectrogram(wave, mix.sampleRate, 2048, 256), { beatSec: 60 / BPM });
    } finally {
      busy = false;
    }
  }

  function saveWav() {
    if (!lastWav) return;
    const wav = encodeWav([lastWav.getChannelData(0), lastWav.getChannelData(1)], lastWav.sampleRate);
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `training-wheels-jam-${BARS}bars.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const db = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} dB` : '—');

  onDestroy(() => {
    window.removeEventListener('keydown', onKey);
    stop();
    void ctx?.close();
  });
</script>

<header class="bar">
  <button onclick={() => go({ name: 'settings' })}>Back</button>
  <h1>Jam · rhythm-mode sound lab</h1>
  <div class="spacer"></div>
  <button onclick={resetSound}>Reset sound</button>
</header>

<main class="page narrow">
  <section class="panel">
    <div class="row wrap">
      <button class="primary" onclick={() => (playing ? stop() : start())}>{playing ? 'Stop' : 'Play'}</button>
      <span class="muted">Space · {BPM} BPM</span>
      <div class="beats" aria-hidden="true">
        {#each [0, 1, 2, 3] as b (b)}<span class:on={beat >= 0 && beat % 4 === b} class:one={b === 0}></span>{/each}
      </div>
      <span class="muted small">{beat >= 0 ? `bar ${Math.floor(beat / 4) % 4 + 1} of 4` : ''}</span>
    </div>
    <div class="row wrap">
      {#each LAYERS as l (l)}
        <label class="check"><input type="checkbox" bind:checked={layers[l]} /><span>{LAYER_LABEL[l]}</span></label>
      {/each}
    </div>
    <label class="check"><input type="checkbox" bind:checked={demo} /><span>Demo arrangement: stabs, claps and a drop over 4 bars</span></label>

    <h2>Play along</h2>
    <p class="muted">Hits land on the next 16th, the way rhythm mode will quantise your inputs.</p>
    <div class="row wrap">
      {#each [0, 1, 2, 3] as slot (slot)}
        <button onclick={() => hit({ kind: 'stab', slot })}>Swap → {slot + 1} <span class="muted small">{slot + 1}</span></button>
      {/each}
      <button onclick={() => hit({ kind: 'clap' })}>Skill <span class="muted small">E</span></button>
      <button onclick={() => hit({ kind: 'drop' })}>Burst <span class="muted small">Q</span></button>
    </div>
  </section>

  <section class="panel">
    <h2>Sound</h2>
    <p class="muted">Changes are heard on the next note and saved with your settings.</p>
    <div class="form">
      {#each KNOBS as k (k.key)}
        <label class="field">
          <span>{k.label} · {k.fmt ? k.fmt(m[k.key]) : m[k.key]}</span>
          <input type="range" min={k.min} max={k.max} step={k.step} bind:value={m[k.key]} />
        </label>
      {/each}
    </div>
    <h2>Levels</h2>
    <div class="form">
      {#each LEVELS as k (k.key)}
        <label class="field">
          <span>{k.label} · {k.fmt ? k.fmt(m[k.key]) : m[k.key]}</span>
          <input type="range" min={k.min} max={k.max} step={k.step} bind:value={m[k.key]} />
        </label>
      {/each}
    </div>
  </section>

  <section class="panel">
    <h2>Render and measure</h2>
    <p class="muted">
      Renders {BARS} bars of the current layers offline, then measures levels per instrument and how tightly the kicks sit on
      the grid. The picture shows the waveform and a spectrogram; lines mark beats, bright lines bars.
    </p>
    <div class="row wrap">
      <button onclick={analyse} disabled={busy}>{busy ? 'Rendering…' : 'Render and measure'}</button>
      <button class="ghost" onclick={saveWav} disabled={!report}>Save WAV</button>
    </div>
    {#if report}
      <table class="levels">
        <thead><tr><th>Layer</th><th>Peak</th><th>RMS</th><th>Clipped samples</th></tr></thead>
        <tbody>
          {#each report.rows as r (r.name)}
            <tr><td>{r.name}</td><td>{db(r.s.peakDb)}</td><td>{db(r.s.rmsDb)}</td><td class:bad={r.s.clipped > 0}>{r.s.clipped}</td></tr>
          {/each}
        </tbody>
      </table>
      <p class="muted small">
        {report.kicks} kicks found · {report.meanMs.toFixed(1)} ms after the grid (the compressor's look-ahead), varying by at most
        {report.jitterMs.toFixed(1)} ms ·
        {report.seconds.toFixed(1)} s rendered in {Math.round(report.renderMs)} ms
      </p>
    {/if}
    <canvas bind:this={canvas} width="1000" height="420" class="spec" class:hidden={!report}></canvas>
  </section>
</main>

<style>
  .beats { display: flex; gap: 6px; }
  .beats span { width: 14px; height: 14px; border-radius: 50%; background: var(--panel-2); border: 1px solid var(--line); }
  .beats span.on { background: var(--accent); border-color: var(--accent); }
  .beats span.one.on { background: var(--warn); border-color: var(--warn); }
  .levels { border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .levels th, .levels td { text-align: left; padding: 3px 14px 3px 0; }
  .levels th { color: var(--muted); font-weight: 500; }
  .bad { color: var(--bad); }
  .spec { width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--line); }
  .hidden { display: none; }
</style>
