<script lang="ts">
  import Mixer from '../components/Mixer.svelte';
  import { onDestroy } from 'svelte';
  import { app, go } from '../lib/app.svelte';
  import { DEFAULT_SETTINGS } from '../lib/defaults';
  import { encodeWav, levels, mono, spectrogram, type LevelStats } from '../lib/music/analysis';
  import { DEMO } from '../lib/music/arrange';
  import { GROOVE_CREDIT, grooves, STYLE_IDS, STYLES } from '../lib/music/band';
  import { CUE_GUIDE, type Trigger } from '../lib/music/cuelayer';
  import { drawAnalysis } from '../lib/music/draw';
  import { BPM } from '../lib/music/patterns';
  import { renderMusic, TrackPlayer } from '../lib/music/player';
  import { nowMs } from '../lib/platform';
  import type { MusicSettings, MusicStyle } from '../lib/types';

  const m = $derived(app.data.settings.music);

  let demo = $state(true);
  let playing = $state(false);
  let beat = $state(-1);
  let player: TrackPlayer | null = null;
  let beatTimer: ReturnType<typeof setInterval> | undefined;

  async function start() {
    const p = new TrackPlayer(app.data.settings.music, demo ? DEMO : null, true, () => app.data.settings.audio.cueSound);
    player = p;
    playing = true;
    await p.start();
    if (player !== p) return;
    p.stepStarted(nowMs(), demo ? 0 : null);
    beatTimer = setInterval(() => (beat = player?.position()?.beat ?? -1), 30);
  }

  function stop() {
    player?.stop();
    player = null;
    playing = false;
    beat = -1;
    clearInterval(beatTimer);
  }

  function setDemo(on: boolean) {
    demo = on;
    player?.setArrangement(on ? DEMO : null);
    if (on) player?.alignNextBar();
  }

  function setStyle(s: MusicStyle) {
    m.style = s;
    m.groove = -1;
  }

  async function cue(t: Trigger) {
    if (!playing) await start();
    player?.trigger(t);
  }

  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (e.repeat || tag === 'INPUT' || tag === 'SELECT') return;
    if (e.code === 'Enter') {
      e.preventDefault();
      if (playing) stop();
      else void start();
      return;
    }
    const c = CUE_GUIDE.find((x) => x.key === e.code);
    if (c) {
      e.preventDefault();
      void cue(c.trigger);
    }
  }
  window.addEventListener('keydown', onKey);

  type Knob = { key: 'drums' | 'bass' | 'keys' | 'reverb'; label: string };
  const LEVELS: Knob[] = [
    { key: 'drums', label: 'Drums' },
    { key: 'bass', label: 'Bass' },
    { key: 'keys', label: 'Keys' },
    { key: 'reverb', label: 'Room' },
  ];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const keyLabel = (code: string) => code.replace('Digit', '').replace('Key', '');

  function resetSound() {
    const { style, volume } = m;
    app.data.settings.music = { ...structuredClone(DEFAULT_SETTINGS.music), style, volume };
  }

  // ---------------------------------------------------------------- offline analysis

  let canvas = $state<HTMLCanvasElement | null>(null);
  let busy = $state(false);
  let report = $state<{ rows: { name: string; s: LevelStats }[]; renderMs: number; seconds: number } | null>(null);
  let lastWav: AudioBuffer | null = null;
  /** A full Runway cycle (verse, build, lift); 8 bars for the other styles. */
  const BARS = $derived(STYLES[m.style].programmed ? 32 : 8);

  async function analyse() {
    busy = true;
    try {
      const settings = $state.snapshot(app.data.settings.music) as MusicSettings;
      const cuesAt = (i: number) => DEMO.at.get(i % DEMO.length);
      const t0 = performance.now();
      const cueSound = app.data.settings.audio.cueSound;
      const mix = await renderMusic(settings, { bars: BARS, cuesAt, cueSound });
      const renderMs = performance.now() - t0;
      lastWav = mix;
      const st = (b: AudioBuffer) => levels(b.getChannelData(0), b.getChannelData(1));
      const rows = [
        { name: 'Mix', s: st(mix) },
        { name: 'Music only', s: st(await renderMusic(settings, { bars: BARS, cues: false })) },
        { name: 'Cues only', s: st(await renderMusic(settings, { bars: BARS, cuesAt, music: false, cueSound })) },
      ];
      report = { rows, renderMs, seconds: mix.duration };
      const wave = mono([mix.getChannelData(0), mix.getChannelData(1)]);
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
    a.download = `training-wheels-${m.style}-${BARS}bars.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const db = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} dB` : '—');

  onDestroy(() => {
    window.removeEventListener('keydown', onKey);
    stop();
  });
</script>

<header class="bar">
  <button onclick={() => go({ name: 'settings' })}>Back</button>
  <h1>Music lab · rhythm mode</h1>
  <div class="spacer"></div>
  <Mixer />
  <button onclick={resetSound}>Reset sound</button>
</header>

<main class="page narrow">
  <section class="panel">
    <h2>Style</h2>
    <p class="muted">Only the music behind changes. The cues for your inputs sound the same in every style.</p>
    <div class="styles">
      {#each STYLE_IDS as id (id)}
        <button class="style" class:on={m.style === id} onclick={() => setStyle(id)}>
          <b>{STYLES[id].label}</b>
          <span class="muted small">{STYLES[id].blurb}</span>
        </button>
      {/each}
    </div>
    {#if STYLES[m.style].programmed}
      <p class="muted small">
        Programmed straight and mechanical, in a 32-bar cycle: 16 bars of verse, an 8-bar string build, an 8-bar supersaw lift.
      </p>
    {:else}
    <div class="row wrap">
      <label class="field grow">
        <span>Groove</span>
        <select bind:value={m.groove}>
          <option value={-1}>A new groove every 4 bars ({grooves(m.style).beats.length} grooves)</option>
          {#each grooves(m.style).beats as g, i (g.id)}
            <option value={i}>{i + 1}. {g.genre.replace('/', ' · ')} drummer, recorded at {g.bpm} BPM</option>
          {/each}
        </select>
      </label>
      <label class="check"><input type="checkbox" bind:checked={m.fills} /><span>Drum fills</span></label>
    </div>
    {/if}
    <div class="row wrap">
      <button class="primary" onclick={() => (playing ? stop() : start())}>{playing ? 'Stop' : 'Play'}</button>
      <span class="muted small">Enter · {BPM} BPM{STYLES[m.style].scale === 2 ? ', half-time feel' : ''}</span>
      <div class="beats" aria-hidden="true">
        {#each [0, 1, 2, 3] as b (b)}<span class:on={beat === b} class:one={b === 0}></span>{/each}
      </div>
      <div class="spacer"></div>
      <label class="check"><input type="checkbox" checked={demo} onchange={(e) => setDemo(e.currentTarget.checked)} /><span>Demo rotation cues</span></label>
    </div>
  </section>

  <section class="panel">
    <h2>Cues</h2>
    <p class="muted">One cue per key, each with a sharp start. Press the keys to play along; hits land on the next 16th.</p>
    <div class="row wrap">
      <label class="check"><input type="radio" name="cuesound" value="sounds" bind:group={app.data.settings.audio.cueSound} /><span>Distinct sounds</span></label>
      <label class="check"><input type="radio" name="cuesound" value="voice" bind:group={app.data.settings.audio.cueSound} /><span>Voice calls the keys</span></label>
    </div>
    <div class="row wrap">
      {#each CUE_GUIDE as c (c.label)}
        <button onclick={() => cue(c.trigger)}>{c.label} <kbd>{keyLabel(c.key)}</kbd></button>
      {/each}
    </div>
  </section>

  <section class="panel">
    <h2>Band levels</h2>
    <p class="muted">Overall music and cue volume are in the speaker menu at the top.</p>
    <div class="form">
      {#each LEVELS as k (k.key)}
        <label class="field">
          <span>{k.label} · {pct(m[k.key])}</span>
          <input type="range" min="0" max="1" step="0.01" bind:value={m[k.key]} />
        </label>
      {/each}
    </div>
  </section>

  <section class="panel">
    <h2>Render and measure</h2>
    <p class="muted">
      Renders {BARS} bars of this style with the demo cues offline, then measures levels. The picture shows the waveform and a
      spectrogram; lines mark beats, bright lines bars.
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
      <p class="muted small">{report.seconds.toFixed(1)} s rendered in {Math.round(report.renderMs)} ms</p>
    {/if}
    <canvas bind:this={canvas} width="1000" height="420" class="spec" class:hidden={!report}></canvas>
  </section>

  <p class="muted small credit">{GROOVE_CREDIT}</p>
</main>

<style>
  .styles { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
  .style { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; white-space: normal; padding: 10px 12px; }
  .style.on { border-color: #a78bfa; background: #1d1630; }
  .grow { flex: 1; min-width: 240px; }
  kbd { font-size: 11px; opacity: 0.7; margin-left: 4px; }
  .levels { border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .levels th, .levels td { text-align: left; padding: 3px 14px 3px 0; }
  .levels th { color: var(--muted); font-weight: 500; }
  .bad { color: var(--bad); }
  .spec { width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--line); }
  .hidden { display: none; }
  .credit { text-align: center; padding: 4px 20px 16px; }
</style>
