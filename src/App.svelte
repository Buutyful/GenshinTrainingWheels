<script lang="ts">
  import { app, initApp, queueSave } from './lib/app.svelte';
  import { setMix } from './lib/mix';
  import Editor from './views/Editor.svelte';
  import Home from './views/Home.svelte';
  import CalibrateView from './views/CalibrateView.svelte';
  import JamView from './views/JamView.svelte';
  import MetricsView from './views/MetricsView.svelte';
  import SessionView from './views/SessionView.svelte';
  import SettingsView from './views/SettingsView.svelte';

  void initApp();

  $effect(() => {
    if (app.loaded) queueSave(JSON.stringify(app.data));
  });

  $effect(() => {
    const { audio, music } = app.data.settings;
    setMix({ master: audio.master, muted: audio.muted, cues: audio.volume, music: music.volume });
  });
</script>

{#if !app.loaded}
  <div class="boot">Loading…</div>
{:else if app.view.name === 'home'}
  <Home />
{:else if app.view.name === 'edit'}
  {#key app.view.id}<Editor id={app.view.id} />{/key}
{:else if app.view.name === 'session'}
  {#key `${app.view.id}:${app.view.mode}`}<SessionView id={app.view.id} mode={app.view.mode ?? 'practice'} />{/key}
{:else if app.view.name === 'metrics'}
  {#key app.view.id}<MetricsView id={app.view.id} />{/key}
{:else if app.view.name === 'jam'}
  <JamView />
{:else if app.view.name === 'calibrate'}
  <CalibrateView />
{:else}
  <SettingsView />
{/if}
