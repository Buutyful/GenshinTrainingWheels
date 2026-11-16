<script lang="ts">
  import { flatten } from '../lib/engine';
  import { clock, pct, secs } from '../lib/format';
  import { charName, stepLabel } from '../lib/notation';
  import { timingSig } from '../lib/timing';
  import type { Loadout, SessionSummary, StepAction } from '../lib/types';
  import Avatar from './Avatar.svelte';
  import LapChart from './LapChart.svelte';

  let { loadout, run }: { loadout: Loadout; run: SessionSummary } = $props();

  const ls = $derived(loadout.loop ? (loadout.loopStart ?? 0) : 0);
  const steps = $derived(flatten(loadout.steps, loadout.loop, ls));
  const m = $derived(run.metrics);
  /** Step statistics only mean something for the rotation they were recorded on. */
  const sameRotation = $derived(!!m && m.steps.sig === timingSig(loadout.steps, loadout.loop, ls));

  const ACTS: { a: StepAction; label: string }[] = [
    { a: 'skill', label: 'E' },
    { a: 'skillHold', label: 'Hold E' },
    { a: 'burst', label: 'Q' },
    { a: 'na', label: 'Attacks' },
    { a: 'ca', label: 'CA' },
    { a: 'dash', label: 'Dash' },
    { a: 'jump', label: 'Jump' },
  ];

  const fieldTotal = $derived(m ? m.chars.reduce((s, c) => s + c.fieldMs, 0) : 0);
  const avgLap = $derived(m && m.laps.length ? m.laps.reduce((s, l) => s + l.ms, 0) / m.laps.length : null);
  const vsTarget = $derived(m?.targetMs && avgLap !== null ? avgLap - m.targetMs : null);
  const onTarget = $derived(m?.targetMs ? m.laps.filter((l) => l.ms <= m.targetMs! * 1.05).length : 0);

  const troubled = $derived(
    m && sameRotation
      ? steps
          .map((step, i) => ({ step, i, missed: m.steps.missed[i] ?? 0, wrong: m.steps.wrong[i] ?? 0 }))
          .filter((r) => r.missed + r.wrong > 0)
          .sort((a, b) => b.missed + b.wrong - (a.missed + a.wrong))
          .slice(0, 8)
      : [],
  );
</script>

<div class="tiles">
  <div class="tile"><b>{pct(run.accuracy)}</b><span>accuracy</span></div>
  <div class="tile"><b>{run.cleanLaps}/{run.laps}</b><span>clean laps</span></div>
  <div class="tile"><b>{secs(run.bestLapMs)}</b><span>best clean lap</span></div>
  <div class="tile"><b>{secs(run.avgLapMs)}</b><span>average lap</span></div>
  {#if vsTarget !== null}
    <div class="tile">
      <b class:late={vsTarget > 0}>{vsTarget > 0 ? '+' : '−'}{(Math.abs(vsTarget) / 1000).toFixed(1)}s</b>
      <span>vs {m!.targetMs! / 1000}s target · {onTarget}/{m!.laps.length} on time</span>
    </div>
  {/if}
  <div class="tile"><b>{clock(run.durationMs)}</b><span>time tracked</span></div>
  {#if m && m.trackedMs > 0}
    <div class="tile"><b>{Math.round((m.inputs + m.swaps) / (m.trackedMs / 60000))}</b><span>inputs per minute</span></div>
  {/if}
</div>

{#if !m}
  <p class="muted small">This run was recorded before detailed metrics existed; only the totals above were kept.</p>
{:else}
  {#if m.laps.length}
    <section class="panel">
      <h2>Laps</h2>
      <LapChart laps={m.laps} targetMs={m.targetMs} />
    </section>
  {/if}

  <section class="panel">
    <h2>Characters</h2>
    {#if fieldTotal > 0}
      <div class="share" role="img" aria-label="Field time by character">
        {#each m.chars as c, i (i)}
          {#if c.fieldMs > 0}
            <div class="seg el-{loadout.characters[i].element}" style:flex-grow={c.fieldMs} title="{charName(loadout.characters, i as 0)}: {pct(c.fieldMs / fieldTotal)}"></div>
          {/if}
        {/each}
      </div>
    {/if}
    <div class="chars">
      {#each m.chars as c, i (i)}
        {@const judged = c.hits + c.missed + c.wrong}
        <div class="char-row">
          <div class="who">
            <Avatar character={loadout.characters[i]} size={44} slot={i + 1} />
            <div>
              <div class="nm">{charName(loadout.characters, i as 0)}</div>
              <div class="muted small">
                {fieldTotal ? pct(c.fieldMs / fieldTotal) : '—'} of field time · {clock(c.fieldMs)} · {c.entries}× on field
              </div>
            </div>
          </div>
          <div class="acts">
            {#each ACTS as a (a.a)}
              {#if c.actions[a.a]}<span class="act"><b>{c.actions[a.a]}</b> {a.label}</span>{/if}
            {:else}
              <span class="muted">—</span>
            {/each}
          </div>
          <div class="judged">
            {#if judged}
              <b>{pct(c.hits / judged)}</b>
              <span class="muted small">{c.hits} ok{#if c.missed}{' · '}{c.missed} skipped{/if}{#if c.wrong}{' · '}{c.wrong} wrong{/if}</span>
            {:else}
              <span class="muted small">nothing judged</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    <p class="muted small">
      Skills, bursts and swaps are judged; attacks, dashes and jumps are counted but never judged. Wrong inputs count against the character you
      were on.
    </p>
  </section>

  <section class="panel">
    <h2>Where it went wrong</h2>
    {#if troubled.length}
      <table>
        <thead><tr><th>Step</th><th class="num">Skipped</th><th class="num">Wrong input here</th></tr></thead>
        <tbody>
          {#each troubled as r (r.i)}
            <tr>
              <td>
                <span class="step-cell">
                  <Avatar character={loadout.characters[r.step.slot]} size={22} />
                  {r.step.action === 'swap' ? 'Swap to' : stepLabel(r.step.action, r.step.count) + ' on'}
                  {charName(loadout.characters, r.step.slot)}
                  {#if r.i < steps.findIndex((s) => s.loopEntry)}<span class="muted small">(first rotation)</span>{/if}
                </span>
              </td>
              <td class="num">{r.missed || ''}</td>
              <td class="num">{r.wrong || ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if !sameRotation}
      <p class="muted">The rotation has changed since this run.</p>
    {:else}
      <p class="muted">No skipped or wrong skills, bursts or swaps.</p>
    {/if}
    {#if m.offTrackMs + m.pausedMs > 0}
      <p class="muted small">Off track for {clock(m.offTrackMs)}, paused for {clock(m.pausedMs)}.</p>
    {/if}
  </section>
{/if}

<style>
  .late {
    color: var(--warn);
  }
  .share {
    display: flex;
    gap: 2px;
    height: 10px;
    border-radius: 99px;
    overflow: hidden;
  }
  .share .seg {
    background: var(--el);
    min-width: 2px;
  }
  .chars {
    display: flex;
    flex-direction: column;
  }
  .char-row {
    display: grid;
    grid-template-columns: minmax(200px, 1.3fr) 2fr minmax(110px, auto);
    gap: 14px;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid #20242f;
  }
  .char-row:last-child {
    border-bottom: 0;
  }
  .who {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }
  .nm {
    font-weight: 600;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .act {
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--panel-2);
    font-size: 12.5px;
    color: var(--muted);
  }
  .act b {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .judged {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
  }
  .judged b {
    font-size: 18px;
    font-variant-numeric: tabular-nums;
  }
  .step-cell {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  @media (max-width: 640px) {
    .char-row {
      grid-template-columns: 1fr;
    }
    .judged {
      align-items: flex-start;
      text-align: left;
    }
  }
</style>
