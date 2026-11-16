<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Avatar from '../components/Avatar.svelte';
  import RunReport from '../components/RunReport.svelte';
  import Track from '../components/Track.svelte';
  import { app, findLoadout, go, recordSession } from '../lib/app.svelte';
  import { clock, pct } from '../lib/format';
  import { prettyCode } from '../lib/keycodes';
  import { charName, stepLabel } from '../lib/notation';
  import { isTauri, setCompact } from '../lib/platform';
  import { Session, type Report } from '../lib/session.svelte';
  import type { Guidance, SessionSummary } from '../lib/types';

  let { id }: { id: string } = $props();

  // svelte-ignore state_referenced_locally -- the parent re-creates this view per loadout
  const found = findLoadout(id);
  const loadout = found ? $state.snapshot(found) : null;
  const keys = app.data.settings.bindings;

  let session = $state.raw<Session | null>(null);
  let report = $state.raw<Report | null>(null);
  let lastRun = $state.raw<SessionSummary | null>(null);
  let compact = $state(false);
  let guidance = $state<Guidance>(app.data.settings.audio.guidance);

  function begin() {
    if (!loadout) return;
    report = null;
    const s = new Session(loadout, $state.snapshot(app.data.settings), finish);
    session = s;
    void s.start();
  }

  function finish() {
    if (!session) return;
    const r = session.stop();
    session = null;
    if (r.summary.durationMs > 0) recordSession(id, r.summary, r.timings);
    report = r;
    lastRun = r.summary;
    applyCompact(false);
  }

  function applyCompact(on: boolean) {
    if (compact === on) return;
    compact = on;
    document.body.classList.toggle('compact-mode', on);
    void setCompact(on);
  }

  function setGuidance(g: Guidance) {
    guidance = g;
    app.data.settings.audio.guidance = g;
    if (session) session.settings.audio.guidance = g;
  }

  onMount(() => {
    if (loadout?.steps.length) begin();
    else go({ name: 'home' });
  });

  onDestroy(() => {
    session?.stop();
    applyCompact(false);
  });

</script>

{#if session && loadout}
  {@const s = session.snap}
  {@const cur = session.steps[s.pointer]}
  {@const nextIndex = s.pointer + 1 < session.steps.length ? s.pointer + 1 : loadout.loop ? Math.max(0, session.steps.findIndex((f) => f.loopEntry)) : -1}
  {@const next = nextIndex >= 0 ? session.steps[nextIndex] : null}
  {@const focus = s.status === 'offtrack' ? s.activeSlot : cur.slot}

  <header class="bar" data-tauri-drag-region>
    <button class="danger" onclick={finish}>Stop</button>
    <h1 data-tauri-drag-region>{loadout.name}</h1>
    <span class="pill s-{s.status}">
      {s.status === 'armed' ? 'Ready' : s.status === 'tracking' ? 'Tracking' : s.status === 'done' ? 'Done' : s.offReason === 'idle' ? 'Paused' : 'Off track'}
    </span>
    <div class="spacer" data-tauri-drag-region></div>
    <div class="stats">
      <span><b>{s.lap}</b> lap{s.lap === 1 ? '' : 's'}</span>
      <span><b>{clock(s.elapsedMs)}</b></span>
      <span><b>{pct(s.accuracy)}</b> accuracy</span>
    </div>
    <select class="hide-compact" value={guidance} onchange={(e) => setGuidance(e.currentTarget.value as Guidance)} aria-label="Audio guidance">
      <option value="adaptive">Audio: only when late</option>
      <option value="full">Audio: every step</option>
      <option value="swaps">Audio: swaps only</option>
      <option value="off">Audio: off</option>
    </select>
    <button class="hide-compact" onclick={() => session?.restart()}>Restart</button>
    {#if isTauri}<button onclick={() => applyCompact(!compact)}>{compact ? 'Expand' : 'Overlay'}</button>{/if}
  </header>

  <main class="page live">
    {#if session.error}<div class="notice warn">{session.error}</div>{/if}

    <section class="now el-{loadout.characters[focus].element} s-{s.status}">
      <Avatar character={loadout.characters[focus]} size={compact ? 44 : 84} dim={s.status === 'offtrack'} />
      <div class="now-text">
      {#if s.status === 'offtrack'}
        <div class="now-label">{s.offReason === 'idle' ? 'Paused' : 'Off track'}</div>
        <div class="now-main">
          {app.data.settings.tracker.policy === 'restart' ? 'Start again from the first step' : "Start any character's block to rejoin"}
        </div>
        <div class="now-sub">Nothing is being judged right now.</div>
      {:else if s.status === 'done'}
        <div class="now-label">Complete</div>
        <div class="now-main">Rotation finished</div>
      {:else}
        <div class="now-label">{s.status === 'armed' ? 'Start with' : 'Now'}</div>
        <div class="now-main">
          {#if cur.action === 'swap'}
            <span class="arrow">→</span>
            <span class="who-big">{charName(loadout.characters, cur.slot)}</span>
            <kbd>{prettyCode(keys[`swap${(cur.slot + 1) as 1 | 2 | 3 | 4}`][0] ?? '')}</kbd>
          {:else}
            <span class="act">{stepLabel(cur.action, cur.count)}</span>
            {#if cur.action === 'na' && cur.count > 1}<span class="count">{s.naClicks}/{cur.count}</span>{/if}
            <span class="who-big dim">{charName(loadout.characters, cur.slot)}</span>
          {/if}
        </div>
        <div class="now-sub">
          {#if s.status === 'armed'}
            The clock starts when you do this. Stand on {charName(loadout.characters, cur.slot)} first.
          {:else if next}
            then {next.action === 'swap' ? `swap to ${charName(loadout.characters, next.slot)}` : stepLabel(next.action, next.count)}
          {/if}
        </div>
      {/if}
      </div>
    </section>

    {#if session.targetMs && s.status === 'tracking'}
      {@const over = s.lapMs > session.targetMs}
      <div class="pace" class:over>
        <span>Lap <b>{s.lap + 1}</b></span>
        <div class="bar-track"><div class="bar-fill" style:width="{Math.min(100, (s.lapMs / session.targetMs) * 100)}%"></div></div>
        <span><b>{(s.lapMs / 1000).toFixed(1)}</b> / {session.targetMs / 1000}s{#if over}{' · '}over{/if}</span>
      </div>
    {/if}

    <div class="hide-compact">
      <Track steps={session.steps} characters={loadout.characters} statuses={s.statuses} pointer={s.pointer} naClicks={s.naClicks} />
    </div>

    <section class="feed hide-compact" aria-live="polite">
      {#each session.feed as f (f.id)}
        <div class="feed-item t-{f.tone}">{f.text}</div>
      {:else}
        <div class="muted">
          {isTauri ? 'Switch to the game and play your rotation.' : 'Click this page, then play the rotation on your keyboard and mouse.'}
          {prettyCode(keys.hkRestart[0] ?? '')} restarts, {prettyCode(keys.hkStop[0] ?? '')} stops.
        </div>
      {/each}
    </section>
  </main>
{:else if report && loadout}
  {@const sum = report.summary}
  <header class="bar">
    <button onclick={() => go({ name: 'home' })}>Back</button>
    <h1>{loadout.name} — results</h1>
    <div class="spacer"></div>
    <button class="primary" onclick={begin}>Run again</button>
  </header>

  <main class="page narrow">
    {#if sum.durationMs === 0 || !lastRun}
      <div class="empty"><h2>Nothing recorded</h2><p>The run was stopped before the first step.</p></div>
    {:else}
      <RunReport {loadout} run={lastRun} />
      <div class="row center">
        <button onclick={() => go({ name: 'metrics', id })}>All metrics for this loadout</button>
      </div>
    {/if}
  </main>
{/if}
