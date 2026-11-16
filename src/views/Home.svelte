<script lang="ts">
  import Track from '../components/Track.svelte';
  import { app, createLoadout, deleteLoadout, duplicateLoadout, exportLoadout, go, importLoadout } from '../lib/app.svelte';
  import { flatten } from '../lib/engine';
  import { pct, secs } from '../lib/format';
  import { isTauri, relaunchAsAdmin } from '../lib/platform';

  type Dialog = { mode: 'export'; text: string } | { mode: 'import'; text: string; error: string | null };
  let dialog = $state<Dialog | null>(null);
  let confirming = $state<string | null>(null);
  let copied = $state(false);

  async function copy(text: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function doImport() {
    if (dialog?.mode !== 'import') return;
    const error = importLoadout(dialog.text);
    if (error) dialog.error = error;
    else dialog = null;
  }
</script>

<header class="bar">
  <h1>Genshin Training Wheels</h1>
  <div class="spacer"></div>
  <button onclick={() => (dialog = { mode: 'import', text: '', error: null })}>Import</button>
  <button onclick={() => go({ name: 'settings' })}>Settings</button>
  <button class="primary" onclick={() => createLoadout()}>New loadout</button>
</header>

<main class="page">
  {#if !isTauri}
    <div class="notice">
      <strong>Practice mode.</strong> A browser only sees keys while this page has focus, so you can rehearse a rotation
      here but not track it in game. The desktop app listens system-wide.
    </div>
  {:else if app.elevated === false}
    <div class="notice warn">
      <div>
        <strong>Not running as administrator.</strong> Genshin Impact runs elevated, and Windows hides input from
        non-elevated apps while an elevated window has focus. Tracking in game needs admin rights.
      </div>
      <button onclick={() => relaunchAsAdmin()}>Restart as administrator</button>
    </div>
  {/if}

  {#if app.data.loadouts.length === 0}
    <div class="empty">
      <h2>No loadouts yet</h2>
      <p>A loadout is a team of four and the rotation you want to drill.</p>
      <div class="row center">
        <button class="primary" onclick={() => createLoadout()}>Create a loadout</button>
        <button onclick={() => createLoadout(true)}>Add an example</button>
      </div>
    </div>
  {:else}
    <div class="grid">
      {#each app.data.loadouts as l (l.id)}
        {@const last = l.history.at(-1)}
        {@const best = l.history.reduce<number | null>((m, h) => (h.bestLapMs !== null && (m === null || h.bestLapMs < m) ? h.bestLapMs : m), null)}
        <article class="card">
          <div class="card-head">
            <h3>{l.name || 'Untitled'}</h3>
            <span class="tag">{l.loop ? 'Loop' : 'One-shot'}</span>
          </div>
          {#if l.steps.length}
            <Track steps={flatten(l.steps, false)} characters={l.characters} compact />
          {:else}
            <p class="muted">No rotation yet — edit this loadout to add one.</p>
          {/if}
          <p class="muted small">
            {#if last}
              Last run {pct(last.accuracy)} accuracy · best clean lap {secs(best)} · {l.history.length} run{l.history.length === 1 ? '' : 's'}
            {:else}
              Not practised yet
            {/if}
          </p>
          <div class="row">
            <button class="primary" disabled={!l.steps.length} onclick={() => go({ name: 'session', id: l.id })}>Start</button>
            <button onclick={() => go({ name: 'edit', id: l.id })}>Edit</button>
            <div class="spacer"></div>
            {#if confirming === l.id}
              <span class="muted small">Delete?</span>
              <button class="danger" onclick={() => deleteLoadout(l.id)}>Yes</button>
              <button onclick={() => (confirming = null)}>No</button>
            {:else}
              <button class="ghost" title="Duplicate" onclick={() => duplicateLoadout(l.id)}>Duplicate</button>
              <button class="ghost" title="Export" onclick={() => (dialog = { mode: 'export', text: exportLoadout(l.id) })}>Export</button>
              <button class="ghost" title="Delete" onclick={() => (confirming = l.id)}>Delete</button>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</main>

{#if dialog}
  <div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && (dialog = null)}>
    <div class="dialog" role="dialog" aria-modal="true">
      {#if dialog.mode === 'export'}
        <h2>Export loadout</h2>
        <p class="muted">Share this text; anyone can paste it into Import.</p>
        <textarea readonly rows="12" value={dialog.text}></textarea>
        <div class="row end">
          <button onclick={() => (dialog = null)}>Close</button>
          <button class="primary" onclick={() => dialog && copy(dialog.text)}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      {:else}
        <h2>Import loadout</h2>
        <p class="muted">Paste a loadout exported from Genshin Training Wheels.</p>
        <textarea rows="12" bind:value={dialog.text} placeholder="Paste the exported text here"></textarea>
        {#if dialog.error}<p class="error">{dialog.error}</p>{/if}
        <div class="row end">
          <button onclick={() => (dialog = null)}>Cancel</button>
          <button class="primary" disabled={!dialog.text.trim()} onclick={doImport}>Import</button>
        </div>
      {/if}
    </div>
  </div>
{/if}
