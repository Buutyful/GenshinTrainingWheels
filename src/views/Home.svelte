<script lang="ts">
  import Mixer from '../components/Mixer.svelte';
  import Avatar from '../components/Avatar.svelte';
  import Track from '../components/Track.svelte';
  import { onDestroy } from 'svelte';
  import { addImported, app, createLoadout, currentTrack, deleteLoadout, duplicateLoadout, exportLoadout, go, importResult, type ExportFormat } from '../lib/app.svelte';
  import { decodeResult, looksLikeResult, sameLoadout } from '../lib/ladder';
  import { arrange } from '../lib/music/arrange';
  import { TrackPlayer } from '../lib/music/player';
  import type { Loadout } from '../lib/types';
  import { flatten } from '../lib/engine';
  import { IMPORT_EXAMPLES } from '../lib/examples';
  import { importAny } from '../lib/formats';
  import { pct, secs } from '../lib/format';
  import { isTauri, nowMs, relaunchAsAdmin } from '../lib/platform';

  type Dialog = { mode: 'export'; id: string; format: ExportFormat } | { mode: 'import'; text: string };
  let dialog = $state<Dialog | null>(null);
  let confirming = $state<string | null>(null);
  let copied = $state(false);
  let example = $state<string | null>(null);

  const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
    { id: 'notation', label: 'Rotation text', hint: 'KQM / Hexenzirkel notation. Paste it anywhere people share rotations.' },
    { id: 'gcsim', label: 'gcsim', hint: 'The action list of a gcsim config. Add char, weapon and set lines to simulate it.' },
    { id: 'json', label: 'Full loadout', hint: 'Everything, for importing into Genshin Training Wheels on another PC.' },
  ];

  const isResult = $derived(dialog?.mode === 'import' && looksLikeResult(dialog.text));
  const preview = $derived(dialog?.mode === 'import' && dialog.text.trim() && !isResult ? importAny(dialog.text) : null);
  /** A friend's result code pasted into Import: goes on a ladder rather than becoming a loadout to edit. */
  const shared = $derived(isResult && dialog?.mode === 'import' ? decodeResult(dialog.text) : null);
  const sharedTarget = $derived(shared?.result ? app.data.loadouts.find((l) => sameLoadout(shared.result!.loadout, l)) : undefined);
  let resultError = $state<string | null>(null);

  function doImportResult() {
    if (dialog?.mode !== 'import') return;
    const r = importResult(dialog.text);
    if ('message' in r) {
      resultError = r.message;
      return;
    }
    dialog = null;
    resultError = null;
    go({ name: 'metrics', id: r.loadoutId });
  }
  const exported = $derived(dialog?.mode === 'export' ? exportLoadout(dialog.id, dialog.format) : '');

  // Preview of a loadout's rhythm track.
  let listening = $state<string | null>(null);
  let player: TrackPlayer | null = null;
  function stopListening() {
    player?.stop();
    player = null;
    listening = null;
  }
  async function listen(l: Loadout) {
    const wasThis = listening === l.id;
    stopListening();
    const track = currentTrack(l);
    if (wasThis || !track) return;
    const steps = flatten(l.steps, l.loop, l.loop ? (l.loopStart ?? 0) : 0);
    const p = new TrackPlayer(app.data.settings.music, arrange(steps, track), true, () => app.data.settings.audio.cueSound);
    player = p;
    listening = l.id;
    await p.start();
    if (player === p) p.stepStarted(nowMs(), 0);
  }
  onDestroy(stopListening);
  const ago = (t: number) => {
    const d = Math.round((Date.now() - t) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  };

  async function copy(text: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function doImport() {
    if (!preview?.loadout) return;
    const id = addImported(preview.loadout);
    dialog = null;
    go({ name: 'edit', id });
  }
</script>

<header class="bar">
  <h1>Genshin Training Wheels</h1>
  <div class="spacer"></div>
  <Mixer />
  <button onclick={() => (dialog = { mode: 'import', text: '' })}>Import</button>
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
      <p>A loadout is a team of four and the rotation you want to drill. Paste one from a leaderboard, KQM or gcsim with Import.</p>
      <div class="row center">
        <button class="primary" onclick={() => createLoadout()}>Create a loadout</button>
        <button onclick={() => (dialog = { mode: 'import', text: '' })}>Import</button>
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
            <div class="team-strip">
              {#each l.characters as c, i (i)}<Avatar character={c} size={36} />{/each}
            </div>
            <div class="title">
              <h3>{l.name || 'Untitled'}</h3>
              <span class="muted small">
                {l.loop ? ((l.loopStart ?? 0) > 0 ? 'Opener + loop' : 'Loop') : 'One-shot'}{#if l.rotationSec}{' · '}{l.rotationSec}s rotation{/if}
              </span>
            </div>
          </div>
          {#if l.steps.length}
            <Track steps={flatten(l.steps, l.loop, l.loop ? (l.loopStart ?? 0) : 0)} characters={l.characters} compact />
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
          {#if l.steps.length}
            {@const track = currentTrack(l)}
            <div class="track-line small">
              {#if track}
                <span>♪ Rhythm track · {track.bars} bar{track.bars === 1 ? '' : 's'} at {track.bpm} BPM · recorded {ago(track.recordedAt)}</span>
                <button class="ghost" onclick={() => listen(l)}>{listening === l.id ? '■ Stop' : '▶ Listen'}</button>
              {:else}
                <span class="muted">♪ No rhythm track yet. Your first clean lap records one.</span>
              {/if}
            </div>
          {/if}
          <div class="row wrap">
            <button class="primary" disabled={!l.steps.length} title="Audio cues guide you and wait for you" onclick={() => go({ name: 'session', id: l.id, mode: 'practice' })}>Practice</button>
            <button class="rhythm" disabled={!l.steps.length} title="Play over a backing track made from your own clean lap" onclick={() => { stopListening(); go({ name: 'session', id: l.id, mode: 'rhythm' }); }}>♪ Rhythm</button>
            <button onclick={() => go({ name: 'edit', id: l.id })}>Edit</button>
            <button disabled={!l.history.length && !l.ladder?.length} onclick={() => go({ name: 'metrics', id: l.id })}>Metrics</button>
            <div class="spacer"></div>
            {#if confirming === l.id}
              <span class="muted small">Delete?</span>
              <button class="danger" onclick={() => deleteLoadout(l.id)}>Yes</button>
              <button onclick={() => (confirming = null)}>No</button>
            {:else}
              <button class="ghost" onclick={() => duplicateLoadout(l.id)}>Duplicate</button>
              <button class="ghost" onclick={() => (dialog = { mode: 'export', id: l.id, format: 'notation' })}>Export</button>
              <button class="ghost" onclick={() => (confirming = l.id)}>Delete</button>
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
        {@const d = dialog}
        <h2>Export loadout</h2>
        <div class="tabs" role="tablist">
          {#each FORMATS as f (f.id)}
            <button class:on={d.format === f.id} onclick={() => (d.format = f.id)}>{f.label}</button>
          {/each}
        </div>
        <p class="muted">{FORMATS.find((f) => f.id === d.format)?.hint}</p>
        <textarea readonly rows="10" value={exported}></textarea>
        <div class="row end">
          <button onclick={() => (dialog = null)}>Close</button>
          <button class="primary" onclick={() => copy(exported)}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      {:else}
        {@const d = dialog}
        <h2>Import a rotation</h2>
        <p class="muted">
          Paste a rotation you found somewhere, or open a file. The app recognises the format by itself. Not sure what to paste? Pick a kind below
          to see where to find it and try an example.
        </p>
        <div class="tabs examples" role="tablist">
          {#each IMPORT_EXAMPLES as ex (ex.id)}
            <button class:on={example === ex.id} onclick={() => (example = example === ex.id ? null : ex.id)}>{ex.label}</button>
          {/each}
        </div>
        {#if example}
          {@const ex = IMPORT_EXAMPLES.find((e) => e.id === example)!}
          <div class="howto">
            <p>{ex.where}</p>
            <pre>{ex.text}</pre>
            <button onclick={() => (d.text = ex.text)}>Use this example</button>
          </div>
        {/if}
        <textarea rows="8" bind:value={dialog.text} placeholder="Paste here, e.g.  Raiden E > Xingqiu EQ > Bennett QE > Xiangling QE > Raiden Q N3C N3C" spellcheck="false"></textarea>
        <div class="row">
          <label class="file-btn">
            <input
              type="file"
              accept=".json,.txt,.cfg,.gcsim,text/plain,application/json"
              onchange={async (e) => {
                const f = e.currentTarget.files?.[0];
                if (f) d.text = await f.text();
              }}
            />
            Open file…
          </label>
          <span class="muted small">A Genshin Optimizer .json, a gcsim config, or a loadout exported from this app.</span>
        </div>
        {#if shared}
          <div class="import-preview">
            <span class="muted small">Read as <b>a friend's result</b></span>
            {#if shared.result}
              {@const r = shared.result}
              <p>
                <b>{r.entry.player}</b>: {secs(r.entry.bestLapMs)} best clean lap, {pct(r.entry.accuracy)} accuracy, {r.entry.cleanLaps}/{r.entry.laps} clean laps
                on <b>{r.loadout.name}</b>.
              </p>
              <Track steps={flatten(r.loadout.steps, r.loadout.loop, r.loadout.loopStart ?? 0)} characters={r.loadout.characters} compact />
              <span class="muted small">
                {sharedTarget ? `It goes on the ladder of your loadout “${sharedTarget.name}”.` : 'You do not have this loadout yet: it will be added, with this result on its ladder.'}
              </span>
            {:else}
              <p class="error small">{shared.error}</p>
            {/if}
            {#if resultError}<p class="error small">{resultError}</p>{/if}
          </div>
        {/if}
        {#if preview}
          <div class="import-preview">
            <span class="muted small">Read as <b>{preview.format}</b></span>
            {#if preview.loadout}
              {@const l = preview.loadout}
              <Track steps={flatten(l.steps, l.loop, l.loopStart ?? 0)} characters={l.characters} compact />
              <span class="muted small">
                {l.steps.length} actions{#if l.rotationSec}{' · '}{l.rotationSec}s rotation{/if}{#if (l.loopStart ?? 0) > 0}{' · '}different first rotation{/if}. Team order follows
                the order characters first appear in; you can reorder them next.
              </span>
            {/if}
            {#each preview.errors as err (err)}<p class="error small">{err}</p>{/each}
            {#each preview.notes as n (n)}<p class="muted small">{n}</p>{/each}
          </div>
        {/if}
        <div class="row end">
          <button onclick={() => (dialog = null)}>Cancel</button>
          {#if isResult}
            <button class="primary" disabled={!shared?.result} onclick={doImportResult}>{sharedTarget ? 'Add to ladder' : 'Add loadout and ladder'}</button>
          {:else}
            <button class="primary" disabled={!preview?.loadout} onclick={doImport}>Import and review</button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
