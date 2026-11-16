<script lang="ts">
  import { app, initApp, queueSave } from './lib/app.svelte';
  import Editor from './views/Editor.svelte';
  import Home from './views/Home.svelte';
  import SessionView from './views/SessionView.svelte';
  import SettingsView from './views/SettingsView.svelte';

  void initApp();

  $effect(() => {
    if (app.loaded) queueSave(JSON.stringify(app.data));
  });
</script>

{#if !app.loaded}
  <div class="boot">Loading…</div>
{:else if app.view.name === 'home'}
  <Home />
{:else if app.view.name === 'edit'}
  {#key app.view.id}<Editor id={app.view.id} />{/key}
{:else if app.view.name === 'session'}
  {#key app.view.id}<SessionView id={app.view.id} />{/key}
{:else}
  <SettingsView />
{/if}
