<script lang="ts">
  import Mixer from '../components/Mixer.svelte';
  import { onDestroy, onMount } from 'svelte';
  import Avatar from '../components/Avatar.svelte';
  import RunReport from '../components/RunReport.svelte';
  import Track from '../components/Track.svelte';
  import { app, currentTrack, findLoadout, go, recordSession, setTrack } from '../lib/app.svelte';
  import { clock, pct } from '../lib/format';
  import { prettyCode } from '../lib/keycodes';
  import { charName, stepLabel } from '../lib/notation';
  import { isTauri, setCompact } from '../lib/platform';
  import { Session, type Report, type SessionMode } from '../lib/session.svelte';
  import { STYLE_IDS, STYLES } from '../lib/music/band';
  import { GRADE_LABEL, GRADES } from '../lib/rhythm';
  import type { Guidance, MusicStyle, SessionSummary } from '../lib/types';

  let { id, mode = 'practice' }: { id: string; mode?: SessionMode } = $props();

  // svelte-ignore state_referenced_locally -- the parent re-creates this view per loadout
  const found = findLoadout(id);
  const loadout = found ? $state.snapshot(found) : null;
  const keys = app.data.settings.bindings;

  let session = $state.raw<Session | null>(null);
  let report = $state.raw<Report | null>(null);
  let lastRun = $state.raw<SessionSummary | null>(null);
  let compact = $state(false);
  let guidance = $state<Guidance>(app.data.settings.audio.guidance);
  /** Whether this run's clean lap became the loadout's rhythm track. */
  let trackSaved = $state(false);
  let trackReplaced = $state(false);

  /** A run that is ready but not started: nothing is captured or played until Start. */
  function prepare() {
    if (!loadout) return;
    report = null;
    trackSaved = false;
    trackReplaced = false;
    // Fresh copy: the previous run may have saved a rhythm track or new timings.
    const now = findLoadout(id);
    if (!now) return;
    session = new Session($state.snapshot(now), $state.snapshot(app.data.settings), finish, mode);
  }

  /** Start: capture input; the run itself (clock, music) begins on the first valid step. */
  function begin() {
    if (!session) prepare();
    void session?.start();
  }

  function finish() {
    if (!session?.started) return;
    if (!session.begun) {
      // Stopped before the first step: nothing to report, back to ready.
      session.stop();
      prepare();
      return;
    }
    const r = session.stop();
    session = null;
    // Stopped right after the first step: no time passed, nothing worth a report.
    if (r.summary.durationMs === 0) return prepare();
    if (r.summary.durationMs > 0) trackSaved = recordSession(id, r.summary, r.timings, r.track);
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

  let musicStyle = $state<MusicStyle>(app.data.settings.music.style);
  /** Changing the style mid-run is heard on the next 16th; the cues stay the same. */
  function setStyle(st: MusicStyle) {
    musicStyle = st;
    app.data.settings.music.style = st;
    app.data.settings.music.groove = -1;
    if (session) {
      session.settings.music.style = st;
      session.settings.music.groove = -1;
    }
  }

  function setGuidance(g: Guidance) {
    guidance = g;
    app.data.settings.audio.guidance = g;
    if (session) session.settings.audio.guidance = g;
  }

  onMount(() => {
    if (loadout?.steps.length) prepare();
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
    {#if session.started}
      <button class="danger" onclick={finish}>Stop</button>
    {:else}
      <button class="hide-compact" onclick={() => go({ name: 'home' })}>Back</button>
      <button class="primary" onclick={begin}>Start</button>
    {/if}
    <h1 data-tauri-drag-region>{loadout.name}</h1>
    <span class="pill s-{s.status}">
      {!session.started ? 'Not started' : s.status === 'armed' ? 'Waiting for first step' : s.status === 'tracking' ? 'Tracking' : s.status === 'done' ? 'Done' : s.offReason === 'idle' ? 'Paused' : 'Off track'}
    </span>
    <div class="spacer" data-tauri-drag-region></div>
    <div class="stats">
      <span><b>{s.lap}</b> lap{s.lap === 1 ? '' : 's'}</span>
      <span><b>{clock(s.elapsedMs)}</b></span>
      <span><b>{pct(s.accuracy)}</b> accuracy</span>
    </div>
    {#if mode === 'rhythm'}
      <span class="pill rhythm" title="Rhythm mode">
        ♪ {session.hasTrack ? `Rhythm · ${session.trackBars} bar${session.trackBars === 1 ? '' : 's'}` : 'Recording track'}
      </span>
      <select class="hide-compact" value={musicStyle} onchange={(e) => setStyle(e.currentTarget.value as MusicStyle)} aria-label="Music style">
        {#each STYLE_IDS as id (id)}<option value={id}>♪ {STYLES[id].label}</option>{/each}
      </select>
      <div class="beats hide-compact" aria-hidden="true">
        {#each [0, 1, 2, 3] as b (b)}<span class:on={s.music?.beat === b} class:one={b === 0}></span>{/each}
      </div>
    {:else}
    <select class="hide-compact" value={guidance} onchange={(e) => setGuidance(e.currentTarget.value as Guidance)} aria-label="Audio guidance">
      <option value="adaptive">Audio: only when late</option>
      <option value="full">Audio: every step</option>
      <option value="swaps">Audio: swaps only</option>
      <option value="off">Audio: off</option>
    </select>
    {/if}
    <Mixer compactHidden />
    {#if session.started}<button class="hide-compact" onclick={() => session?.restart()}>Restart</button>{/if}
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
          {#if !session.started}
            Press Start, then play. The run begins on your first {stepLabel(cur.action, cur.count)}{cur.action === 'swap' ? '' : ` on ${charName(loadout.characters, cur.slot)}`}; nothing before it counts.
          {:else if s.status === 'armed'}
            Waiting for it: the clock{mode === 'rhythm' ? ' and the music start' : ' starts'} when you do this. Stand on {charName(loadout.characters, cur.slot)} first.
          {:else if next}
            then {next.action === 'swap' ? `swap to ${charName(loadout.characters, next.slot)}` : stepLabel(next.action, next.count)}
          {/if}
        </div>
      {/if}
      </div>
    </section>

    {#if mode === 'rhythm'}
      <div class="pace rhythm-bar">
        {#if !session.hasTrack}
          <span class="muted">No rhythm track yet. Play one <b>clean lap</b> over the beat; the music builds from it and joins on your next step.</span>
        {:else if s.music?.lapStep != null}
          {@const len = s.music.bars * 16}
          <span>Bar <b>{Math.floor(s.music.lapStep / 16) + 1}</b> / {s.music.bars}</span>
          <div class="bar-track"><div class="bar-fill" style:width="{((s.music.lapStep + 1) / len) * 100}%"></div></div>
          <span class="muted">the music keeps going: stay with it</span>
        {:else}
          <span class="muted">{s.status === 'armed' ? 'The track starts on your first step.' : 'Beat only. The track comes back when you are on a step again.'}</span>
        {/if}
      </div>
      {#if session.judged && session.hasTrack}
        {@const j = session.judged}
        <div class="judge-row">
          {#key j.last?.id}
            <span class="grade g-{j.last?.grade ?? 'none'}">
              {j.last ? GRADE_LABEL[j.last.grade] : '—'}
              {#if j.last?.deltaMs != null}<small>{j.last.deltaMs > 0 ? '+' : '−'}{Math.abs(Math.round(j.last.deltaMs))} ms</small>{/if}
            </span>
          {/key}
          {#if j.streak >= 3}<span class="streak">{j.streak} in a row</span>{/if}
          <div class="spacer"></div>
          <span class="counts hide-compact">
            {#each GRADES as g (g)}<span class="g-{g}" title={GRADE_LABEL[g]}><b>{j.counts[g]}</b> {GRADE_LABEL[g].toLowerCase()}</span>{/each}
          </span>
        </div>
      {/if}
    {/if}

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
          {#if !session.started}Press Start when you are ready.{/if}
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
    <h1>{loadout.name} — {mode === 'rhythm' ? 'rhythm ' : ''}results</h1>
    <div class="spacer"></div>
    <Mixer />
    {#if mode === 'practice'}<button onclick={() => go({ name: 'session', id, mode: 'rhythm' })}>♪ Rhythm</button>{/if}
    <button class="primary" onclick={begin}>Run again</button>
  </header>

  <main class="page narrow">
    {#if sum.durationMs === 0 || !lastRun}
      <div class="empty"><h2>Nothing recorded</h2><p>The run was stopped before the first step.</p></div>
    {:else}
      {@const found2 = findLoadout(id)}
      {#if report.track && trackSaved}
        <div class="notice">
          <div><strong>Rhythm track recorded.</strong> Your last clean lap became a {report.track.bars}-bar track for this loadout.</div>
          {#if mode === 'practice'}<button class="primary" onclick={() => go({ name: 'session', id, mode: 'rhythm' })}>Play it in Rhythm</button>{/if}
        </div>
      {:else if report.track && found2 && currentTrack(found2)}
        <div class="notice">
          <div>
            {#if trackReplaced}
              <strong>Rhythm track replaced</strong> with this run's last clean lap ({report.track.bars} bars).
            {:else}
              This run had a clean lap. Use it as the rhythm track? The current one has {currentTrack(found2)!.bars} bars; this one
              {report.track.bars}.
            {/if}
          </div>
          {#if !trackReplaced}
            <button onclick={() => { setTrack(id, report!.track); trackReplaced = true; }}>Replace the track</button>
          {/if}
        </div>
      {:else if !report.track && found2 && !currentTrack(found2)}
        <div class="notice"><div>No clean lap this run, so no rhythm track yet. One clean lap records it.</div></div>
      {/if}
      <RunReport {loadout} run={lastRun} />
      <div class="row center">
        <button onclick={() => go({ name: 'metrics', id })}>All metrics for this loadout</button>
      </div>
    {/if}
  </main>
{/if}
