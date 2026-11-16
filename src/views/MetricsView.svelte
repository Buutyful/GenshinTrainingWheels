<script lang="ts">
  import Avatar from '../components/Avatar.svelte';
  import RunReport from '../components/RunReport.svelte';
  import TrendChart from '../components/TrendChart.svelte';
  import { findLoadout, go } from '../lib/app.svelte';
  import { clock, pct, secs } from '../lib/format';
  import type { Loadout } from '../lib/types';

  let { id }: { id: string } = $props();

  // svelte-ignore state_referenced_locally -- the parent re-creates this view per loadout
  const found = findLoadout(id);
  const loadout = found ? ($state.snapshot(found) as Loadout) : null;
  const history = loadout?.history ?? [];
  let selected = $state(history.length - 1);

  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const labels = history.map((h, i) => `Run ${i + 1} · ${day(h.date)}`);

  const totals = {
    time: history.reduce((s, h) => s + h.durationMs, 0),
    laps: history.reduce((s, h) => s + h.laps, 0),
    clean: history.reduce((s, h) => s + h.cleanLaps, 0),
    best: history.reduce<number | null>((m, h) => (h.bestLapMs !== null && (m === null || h.bestLapMs < m) ? h.bestLapMs : m), null),
  };
  const recent = history.slice(-5);
  const recentAcc = recent.length ? recent.reduce((s, h) => s + h.accuracy, 0) / recent.length : null;
  const target = loadout?.rotationSec ? loadout.rotationSec * 1000 : null;

  /** Field time per character summed over every run that recorded it. */
  const fieldTotals = [0, 1, 2, 3].map((i) => history.reduce((s, h) => s + (h.metrics?.chars[i]?.fieldMs ?? 0), 0));
  const fieldAll = fieldTotals.reduce((a, b) => a + b, 0);
</script>

<header class="bar">
  <button onclick={() => go({ name: 'home' })}>Back</button>
  <h1>{loadout?.name ?? 'Loadout'} — metrics</h1>
  <div class="spacer"></div>
  {#if loadout?.steps.length}<button class="primary" onclick={() => go({ name: 'session', id })}>Practise</button>{/if}
</header>

<main class="page narrow">
  {#if !loadout || !history.length}
    <div class="empty"><h2>No runs yet</h2><p>Metrics appear after the first practice run.</p></div>
  {:else}
    <div class="tiles">
      <div class="tile"><b>{history.length}</b><span>runs</span></div>
      <div class="tile"><b>{clock(totals.time)}</b><span>time practised</span></div>
      <div class="tile"><b>{totals.clean}/{totals.laps}</b><span>clean laps</span></div>
      <div class="tile"><b>{secs(totals.best)}</b><span>best clean lap ever</span></div>
      <div class="tile"><b>{pct(recentAcc)}</b><span>accuracy, last {recent.length} runs</span></div>
    </div>

    {#if fieldAll > 0}
      <section class="panel">
        <h2>Time on field, all runs</h2>
        <div class="field-all">
          {#each loadout.characters as c, i (i)}
            <div class="fa-row">
              <Avatar character={c} size={28} />
              <span class="fa-name">{c.name || `Slot ${i + 1}`}</span>
              <div class="fa-track"><div class="fa-fill el-{c.element}" style:width="{(fieldTotals[i] / fieldAll) * 100}%"></div></div>
              <span class="fa-val">{pct(fieldTotals[i] / fieldAll)}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if history.length > 1}
      <section class="panel">
        <h2>Accuracy over runs</h2>
        <TrendChart {labels} series={[{ name: 'Accuracy', color: 'var(--accent)', values: history.map((h) => h.accuracy) }]} yMax={1} format={(v) => `${Math.round(v * 100)}%`} />
      </section>
      <section class="panel">
        <h2>Lap time over runs</h2>
        <TrendChart
          {labels}
          series={[
            { name: 'Average lap', color: '#8fa6ff', values: history.map((h) => h.avgLapMs) },
            { name: 'Best clean lap', color: '#4fd1a5', values: history.map((h) => h.bestLapMs) },
          ]}
          reference={target ? { value: target, label: `target ${loadout.rotationSec}s` } : null}
          format={(v) => `${(v / 1000).toFixed(v < 10000 ? 1 : 0)}s`}
        />
      </section>
    {/if}

    <section class="panel">
      <h2>Runs</h2>
      <div class="runs">
        {#each [...history].reverse() as h, ri (h.date)}
          {@const i = history.length - 1 - ri}
          <button class="run" class:on={selected === i} onclick={() => (selected = i)}>
            <span>{when(h.date)}</span>
            <span class="muted">{clock(h.durationMs)}</span>
            <span class="muted">{h.cleanLaps}/{h.laps} clean</span>
            <b>{pct(h.accuracy)}</b>
          </button>
        {/each}
      </div>
    </section>

    {#if history[selected]}
      <h2 class="section-title">Run of {when(history[selected].date)}</h2>
      <RunReport {loadout} run={history[selected]} />
    {/if}
  {/if}
</main>

<style>
  .field-all {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fa-row {
    display: grid;
    grid-template-columns: 28px 140px 1fr 48px;
    gap: 10px;
    align-items: center;
  }
  .fa-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fa-track {
    height: 8px;
    border-radius: 99px;
    background: var(--panel-2);
    overflow: hidden;
  }
  .fa-fill {
    height: 100%;
    border-radius: 99px;
    background: var(--el);
  }
  .fa-val {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .runs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 260px;
    overflow-y: auto;
  }
  .run {
    display: grid;
    grid-template-columns: 1.4fr 1fr 1fr auto;
    gap: 10px;
    text-align: left;
    border-color: transparent;
    background: transparent;
    font-variant-numeric: tabular-nums;
  }
  .run.on {
    background: var(--panel-2);
    border-color: var(--line);
  }
  .section-title {
    margin-top: 8px;
  }
</style>
