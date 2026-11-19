<script lang="ts">
  import { setStepNote } from '../lib/app.svelte';
  import { breakdown, type TurnRow } from '../lib/breakdown';
  import { coach } from '../lib/coach';
  import { flatten, type FlatStep } from '../lib/engine';
  import { clock, pct, secs } from '../lib/format';
  import { charName, stepLabel } from '../lib/notation';
  import { GRADE_LABEL, GRADES, grade, WINDOWS } from '../lib/rhythm';
  import { resolveTimings, timingSig } from '../lib/timing';
  import { isNoise } from '../lib/types';
  import type { Loadout, SessionSummary, Slot, StepAction } from '../lib/types';
  import Avatar from './Avatar.svelte';
  import LapChart from './LapChart.svelte';

  let { loadout, run }: { loadout: Loadout; run: SessionSummary } = $props();

  const ls = $derived(loadout.loop ? (loadout.loopStart ?? 0) : 0);
  const steps = $derived(flatten(loadout.steps, loadout.loop, ls));
  const m = $derived(run.metrics);
  /** Step statistics only mean something for the rotation they were recorded on. */
  const sameRotation = $derived(!!m && m.steps.sig === timingSig(loadout.steps, loadout.loop, ls));
  const names = $derived([0, 1, 2, 3].map((i) => charName(loadout.characters, i as Slot)));

  const describe = (i: number) => {
    const s = steps[i];
    return s.action === 'swap' ? `the swap to ${names[s.slot]}` : `${names[s.slot]}'s ${stepLabel(s.action, s.count)}`;
  };

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
  const avgLap = $derived(m && m.laps.length ? m.laps.reduce((s, l) => s + l.ms, 0) / m.laps.length : run.avgLapMs);
  const vsTarget = $derived(m?.targetMs && avgLap !== null ? avgLap - m.targetMs : null);

  const rh = $derived(m?.rhythm ?? null);
  const judgedTotal = $derived(rh ? GRADES.reduce((s, g) => s + rh.counts[g], 0) : 0);
  const rhSteps = $derived(rh && sameRotation && rh.steps.sig === m!.steps.sig ? rh.steps : null);

  // ---- Rotation map: the rotation as played, each step tinted by how often it went wrong.
  const errs = $derived(sameRotation && m ? steps.map((_, i) => (m.steps.missed[i] ?? 0) + (m.steps.wrong[i] ?? 0)) : []);
  const maxErr = $derived(Math.max(1, ...errs));
  const totalErr = $derived(errs.reduce((a, b) => a + b, 0));
  const heat = (e: number) => (e === 0 ? 0 : e / maxErr > 0.66 ? 3 : e / maxErr > 0.33 ? 2 : 1);
  const loopAt = $derived(steps.findIndex((s) => s.loopEntry));

  // ---- Rotation breakdown: one row per character turn.
  const sig = $derived(timingSig(loadout.steps, loadout.loop, ls));
  const bd = $derived(
    breakdown(
      steps,
      loadout.loop,
      resolveTimings(loadout.timings, steps, sig),
      loadout.rotationSec ? loadout.rotationSec * 1000 : null,
      sameRotation ? m?.steps.durMs : undefined,
      sameRotation ? m?.steps.durN : undefined,
    ),
  );
  // ---- Timeline: one lane per character, the opener followed by one lap of the loop.
  const openerEnd = $derived(bd.rows.reduce((m, r) => (r.opener ? Math.max(m, r.endMs) : m), 0));
  const lanes = $derived(([0, 1, 2, 3] as Slot[]).filter((sl) => bd.rows.some((r) => r.slot === sl)));
  /**
   * When each input lands on the timeline. A step's duration is the wait before it, so it is
   * pressed at the end of its slice and lasts until the next press; a character holds the field
   * from the swap in to the next swap. The last input of a lap lasts until the next lap's first
   * swap, which takes as long as the wait before the loop's first input.
   */
  const tl = $derived.by(() => {
    const presses: { s: FlatStep; i: number; slot: Slot; opener: boolean; at: number }[] = [];
    for (const r of bd.rows) {
      let at = (r.opener ? 0 : openerEnd) + r.startMs;
      r.items.forEach(({ s, i }, k) => {
        at += r.stepMs[k];
        presses.push({ s, i, slot: r.slot, opener: r.opener, at: at - r.actMs[k] });
      });
    }
    const firstLoop = presses.find((p) => !p.opener);
    const lead = firstLoop ? firstLoop.at - openerEnd : 0;
    // Without an opener, start the picture at the first input rather than at the empty lead-in.
    const shift = openerEnd > 0 ? 0 : lead;
    const until = (k: number) => {
      const p = presses[k];
      const next = presses[k + 1];
      return next ? next.at : p.at + lead;
    };
    const acts = presses
      .map((p, k) => ({ ...p, at: p.at - shift, end: until(k) - shift }))
      .filter((p) => p.s.action !== 'swap');
    const turns: { slot: Slot; opener: boolean; start: number; end: number }[] = [];
    presses.forEach((p, k) => {
      const last = turns[turns.length - 1];
      if (last && last.slot === p.slot) last.end = until(k) - shift;
      else turns.push({ slot: p.slot, opener: p.opener, start: p.at - shift, end: until(k) - shift });
    });
    return { acts, turns, loopAt: openerEnd > 0 && firstLoop ? firstLoop.at : null, total: Math.max(1, ...turns.map((t) => t.end)) };
  });
  const tlPct = (ms: number) => (ms / tl.total) * 100;
  const tickStep = $derived([1000, 2000, 5000, 10000, 15000, 30000].find((t) => tl.total / t <= 8) ?? 60000);
  const ticks = $derived(Array.from({ length: Math.floor(tl.total / tickStep) + 1 }, (_, k) => k * tickStep));

  const stamp = (ms: number) => {
    const s = ms / 1000;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  };
  const verdict = $derived(coach({ run, steps, names, sameRotation, describe, turns: bd.rows }));
  const focusStep = $derived(verdict.tips.find((t) => t.step !== undefined)?.step ?? null);
  /** Time over the plan that is worth pointing out. */
  const slow = (r: TurnRow) => (r.actualMs !== null && r.actualMs - r.planMs > Math.max(300, r.planMs * 0.15) ? r.actualMs - r.planMs : 0);

  /** What went wrong in a turn this run, in a few words per step. */
  const turnIssues = (r: TurnRow) => {
    const out: { text: string; bad: boolean }[] = [];
    for (const { s, i } of r.items) {
      const label = s.action === 'swap' ? 'swap' : stepLabel(s.action, s.count);
      const missed = m?.steps.missed[i] ?? 0;
      const wrong = m?.steps.wrong[i] ?? 0;
      if (missed) out.push({ text: `${label} skipped ${missed}×`, bad: true });
      if (wrong) out.push({ text: `${wrong}× wrong input at ${label === 'swap' ? 'the swap' : label}`, bad: true });
      if (rhSteps && (rhSteps.n[i] ?? 0) >= 2 && Math.abs(rhSteps.meanMs[i]) >= 40)
        out.push({ text: `${label} ${msWord(rhSteps.meanMs[i])}`, bad: false });
    }
    const late = slow(r);
    if (late) out.push({ text: `${(late / 1000).toFixed(1)}s over plan`, bad: false });
    return out;
  };

  // Player notes per turn, kept on the loadout's first step of the turn.
  let notes = $state<Record<number, string>>({});
  $effect.pre(() => {
    notes = Object.fromEntries(loadout.steps.map((s, i) => [i, s.note ?? '']));
  });
  const saveNote = (step: number, text: string) => {
    notes[step] = text;
    loadout.steps[step].note = text.trim() || undefined;
    setStepNote(loadout.id, step, text);
  };

  const stepTip = (i: number) => {
    const missed = m?.steps.missed[i] ?? 0;
    const wrong = m?.steps.wrong[i] ?? 0;
    let t = describe(i);
    t = t[0].toUpperCase() + t.slice(1);
    t += missed || wrong ? ` — skipped ${missed}, wrong ${wrong}` : ' — no mistakes';
    if (rhSteps?.n[i]) t += ` · ${msWord(rhSteps.meanMs[i])} on average`;
    return t;
  };

  // ---- Timing ruler (rhythm).
  const RANGE = 200;
  const RW = 640;
  const RH = 92;
  const rx = (ms: number) => RW / 2 + (Math.max(-RANGE, Math.min(RANGE, ms)) / RANGE) * (RW / 2 - 16);
  const msWord = (x: number) => (Math.abs(x) < 5 ? 'on the beat' : `${Math.abs(Math.round(x))} ms ${x < 0 ? 'early' : 'late'}`);
  const dots = $derived(
    rhSteps
      ? steps
          .map((s, i) => ({ i, n: rhSteps.n[i] ?? 0, mean: rhSteps.meanMs[i] ?? 0, loose: isNoise(s.action) }))
          .filter((d) => d.n > 0)
      : [],
  );

  // ---- Score ring.
  const R = 52;
  const C = 2 * Math.PI * R;
</script>

{#snippet ring(value: number | null, size: number, stroke: number, cls: string)}
  {@const r = (size - stroke) / 2}
  {@const c = 2 * Math.PI * r}
  <svg class="ring {cls}" width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
    <circle class="ring-bg" cx={size / 2} cy={size / 2} {r} stroke-width={stroke} />
    {#if value !== null}
      <circle
        class="ring-fg"
        cx={size / 2}
        cy={size / 2}
        {r}
        stroke-width={stroke}
        stroke-dasharray="{c * value} {c}"
        transform="rotate(-90 {size / 2} {size / 2})"
      />
    {/if}
  </svg>
{/snippet}

<!-- Verdict -->
<section class="panel hero tone-{verdict.tone}">
  <div class="score">
    <svg width="124" height="124" viewBox="0 0 124 124" aria-hidden="true">
      <circle class="ring-bg" cx="62" cy="62" r={R} stroke-width="10" />
      {#if verdict.score !== null}
        <circle
          class="ring-fg"
          cx="62"
          cy="62"
          r={R}
          stroke-width="10"
          stroke-dasharray="{C * verdict.score} {C}"
          transform="rotate(-90 62 62)"
        />
      {/if}
    </svg>
    <div class="score-txt"><b>{pct(verdict.score)}</b><span>{verdict.scoreLabel}</span></div>
  </div>
  <div class="hero-body">
    <h2 class="headline">{verdict.headline}</h2>
    <p class="muted">{verdict.sub}</p>
    <dl class="stats">
      <div><dt>Clean laps</dt><dd>{run.cleanLaps}/{run.laps}</dd></div>
      <div><dt>Best clean</dt><dd>{secs(run.bestLapMs)}</dd></div>
      <div>
        <dt>Average lap</dt>
        <dd>
          {secs(avgLap)}
          {#if vsTarget !== null}<small class:late={vsTarget > 0.05 * m!.targetMs!} class:early={vsTarget <= 0}>{vsTarget > 0 ? '+' : '−'}{(Math.abs(vsTarget) / 1000).toFixed(1)}s</small>{/if}
        </dd>
      </div>
      <div><dt>Time</dt><dd>{clock(run.durationMs)}</dd></div>
      {#if m && m.trackedMs > 0}
        <div><dt>Inputs/min</dt><dd>{Math.round((m.inputs + m.swaps) / (m.trackedMs / 60000))}</dd></div>
      {/if}
    </dl>
  </div>
</section>

{#if !m}
  <p class="muted small">This run was recorded before detailed metrics existed; only the totals above were kept.</p>
{:else}
  <!-- Focus next -->
  <section class="panel">
    <h2>Focus next</h2>
    <ol class="tips">
      {#each verdict.tips as t, n (t.title)}
        <li class="tip-{t.kind}">
          <span class="tip-mark">{t.kind === 'good' ? '✓' : n + 1}</span>
          <div>
            <b>{t.title}</b>
            <p class="muted">{t.detail}</p>
          </div>
        </li>
      {/each}
    </ol>
  </section>

  <!-- Rotation breakdown -->
  <section class="panel">
    <div class="head-row">
      <h2>Rotation breakdown</h2>
      {#if sameRotation}<span class="muted small">{totalErr ? `${totalErr} mistake${totalErr === 1 ? '' : 's'}` : 'no mistakes'}</span>{/if}
    </div>
    {#if !sameRotation}
      <p class="muted">The rotation has changed since this run, so its steps can't be mapped any more.</p>
    {:else}
      <div class="tl-scroll">
        <div class="tl" role="img" aria-label="Rotation timeline, one lane per character">
          <div class="tl-axis" aria-hidden="true">
            <span></span>
            <div class="tl-scale">
              {#each ticks as t (t)}<span style:left="{tlPct(t)}%">{t / 1000}s</span>{/each}
              {#if tl.loopAt !== null}<b class="tl-loop-label" style:left="{tlPct(tl.loopAt)}%">Loop ↻</b>{/if}
            </div>
          </div>
          {#each lanes as sl (sl)}
            <div class="tl-lane el-{loadout.characters[sl]?.element ?? 'none'}">
              <span class="tl-who">
                <Avatar character={loadout.characters[sl]} size={24} />
                <b>{names[sl]}</b>
              </span>
              <div class="tl-track">
                {#each ticks as t (t)}<i class="tl-grid" style:left="{tlPct(t)}%"></i>{/each}
                {#if tl.loopAt !== null}<i class="tl-loop" style:left="{tlPct(tl.loopAt)}%"></i>{/if}
                {#each tl.turns as t, k (k)}
                  {#if t.slot === sl}
                    <div
                      class="tl-turn"
                      class:opener={t.opener}
                      style:left="{tlPct(t.start)}%"
                      style:width="{tlPct(t.end - t.start)}%"
                      title="{names[sl]} · {stamp(t.start)} – {stamp(t.end)}"
                    ></div>
                  {/if}
                {/each}
                {#each tl.acts as a (a.i)}
                  {#if a.slot === sl}
                    <span
                      class="tl-step heat-{heat(errs[a.i])}"
                      class:opener={a.opener}
                      class:noise={isNoise(a.s.action)}
                      class:focus={focusStep === a.i}
                      style:left="{tlPct(a.at)}%"
                      style:width="{tlPct(a.end - a.at)}%"
                      title={stepTip(a.i)}
                    >
                      <span>{stepLabel(a.s.action, a.s.count)}</span>
                    </span>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="bd" role="table" aria-label="Rotation breakdown by character turn">
        <div class="bd-row bd-head muted small" role="row">
          <span role="columnheader">Time</span>
          <span role="columnheader">Character</span>
          <span role="columnheader">Actions</span>
          <span role="columnheader" class="r">On field</span>
        </div>
        {#each bd.rows as r, ri (ri)}
          {#if loopAt > 0 && ri === 0}<div class="bd-part" role="row"><span class="part-label">Opener · first rotation only</span></div>{/if}
          {#if loopAt > 0 && r.items[0].i === loopAt}<div class="bd-part" role="row"><span class="part-label loop">Loop ↻ · every rotation after</span></div>{/if}
          {@const issues = turnIssues(r)}
          {@const late = slow(r)}
          <div class="bd-row el-{loadout.characters[r.slot]?.element ?? 'none'}" class:opener={r.opener} role="row">
            <span class="bd-time" role="cell">{stamp(r.startMs)} – {stamp(r.endMs)}</span>
            <span class="bd-who" role="cell">
              <Avatar character={loadout.characters[r.slot]} size={28} />
              <b>{names[r.slot]}</b>
            </span>
            <span class="bd-acts" role="cell">
              {#each r.items as { s, i } (i)}
                <span class="cell" class:focus={focusStep === i} title={stepTip(i)}>
                  <span class="chip heat-{heat(errs[i])}" class:swap={s.action === 'swap'} class:noise={isNoise(s.action)}>
                    {s.action === 'swap' ? '⇄' : stepLabel(s.action, s.count)}
                    {#if errs[i]}<i class="badge">{errs[i]}</i>{/if}
                  </span>
                  {#if rhSteps && (rhSteps.n[i] ?? 0) > 0}
                    {@const mean = rhSteps.meanMs[i]}
                    <span class="mini g-{grade(mean, isNoise(s.action))}" aria-hidden="true">
                      <i style:left="{50 + (Math.max(-RANGE, Math.min(RANGE, mean)) / RANGE) * 50}%"></i>
                    </span>
                  {/if}
                </span>
              {/each}
            </span>
            <span class="bd-field r" role="cell">
              <b>~{((r.actualMs ?? r.planMs) / 1000).toFixed(1)}s</b>
              {#if r.actualMs !== null}
                <small class:late={late > 0} class:early={r.actualMs < r.planMs - 300}>
                  plan {(r.planMs / 1000).toFixed(1)}s
                </small>
              {:else}
                <small class="muted">planned</small>
              {/if}
            </span>
            <span class="bd-notes" role="cell">
              {#if issues.length}
                <span class="issues">
                  {#each issues as it, k (k)}<span class:bad={it.bad}>{it.text}</span>{/each}
                </span>
              {:else if r.actualMs !== null}
                <span class="clean">✓ clean</span>
              {/if}
              {#if r.noteStep >= 0}
                <textarea
                  class="note"
                  rows="1"
                  placeholder="Add a note: buffs, cooldowns, what this turn sets up…"
                  value={notes[r.noteStep] ?? ''}
                  onchange={(e) => saveNote(r.noteStep, e.currentTarget.value)}
                ></textarea>
              {/if}
            </span>
          </div>
        {/each}
      </div>
      <div class="legend">
        <span><i class="sw heat-0"></i>Clean</span>
        <span><i class="sw heat-1"></i>Some mistakes</span>
        <span><i class="sw heat-3"></i>Most mistakes</span>
        {#if rhSteps}<span><i class="sw mini-sw"></i>Average timing, early ← → late</span>{/if}
      </div>
      <p class="muted small">
        {bd.source === 'run' ? 'Times are this run’s average over the laps you played through.' : 'Times are the plan; this run has no step timings yet.'}
        The plan is {bd.plan === 'target' ? `your own pace scaled to the ${loadout.rotationSec}s rotation time` : 'your usual pace on clean laps; set a rotation time to plan against it'}.
        Notes are saved with the loadout.
      </p>
    {/if}
  </section>

  <!-- Rhythm timing -->
  {#if rh && judgedTotal}
    <section class="panel">
      <h2>Timing</h2>
      <div class="dist" role="img" aria-label="Judgements">
        {#each GRADES as g (g)}
          {#if rh.counts[g]}<div class="g-{g}" style:flex-grow={rh.counts[g]} title="{GRADE_LABEL[g]}: {rh.counts[g]}"></div>{/if}
        {/each}
      </div>
      <div class="legend">
        {#each GRADES as g (g)}<span class="g-{g}"><i class="gsw"></i><b>{rh.counts[g]}</b> {GRADE_LABEL[g].toLowerCase()}</span>{/each}
      </div>

      <svg class="ruler" viewBox="0 0 {RW} {RH}" role="img" aria-label="Average timing per step">
        <rect class="z-hit" x={rx(-RANGE)} y="14" width={rx(RANGE) - rx(-RANGE)} height="44" />
        <rect class="z-good" x={rx(-WINDOWS.good)} y="14" width={rx(WINDOWS.good) - rx(-WINDOWS.good)} height="44" />
        <rect class="z-perfect" x={rx(-WINDOWS.perfect)} y="14" width={rx(WINDOWS.perfect) - rx(-WINDOWS.perfect)} height="44" />
        <line class="zero" x1={rx(0)} x2={rx(0)} y1="10" y2="62" />
        {#if rh.meanMs !== null && rh.spreadMs !== null}
          <rect class="spread" x={rx(rh.meanMs - rh.spreadMs)} y="30" width={rx(rh.meanMs + rh.spreadMs) - rx(rh.meanMs - rh.spreadMs)} height="12" rx="6" />
        {/if}
        {#each dots as d, k (d.i)}
          <circle class="dot g-{grade(d.mean, d.loose)}" cx={rx(d.mean)} cy={22 + ((k * 7) % 32)} r="3.5">
            <title>{stepTip(d.i)}</title>
          </circle>
        {/each}
        {#if rh.meanMs !== null}
          <path class="mean" d="M{rx(rh.meanMs)},64 l-6,9 h12 z" />
          <text class="mean-label" x={rx(rh.meanMs)} y="86" text-anchor="middle">average {msWord(rh.meanMs)}</text>
        {/if}
        <text class="axis" x="4" y="9">early</text>
        <text class="axis" x={RW - 4} y="9" text-anchor="end">late</text>
        <text class="axis" x={rx(0)} y="9" text-anchor="middle">beat</text>
      </svg>
      <p class="muted small">
        Each dot is one step's average offset; the bar is your spread (±{Math.round(rh.spreadMs ?? 0)} ms). Bands: perfect ±{WINDOWS.perfect} ms, good
        ±{WINDOWS.good} ms. Judged with {rh.latencyMs} ms latency.
      </p>
    </section>
  {/if}

  <!-- Laps -->
  {#if m.laps.length}
    <section class="panel">
      <h2>Laps</h2>
      <LapChart laps={m.laps} targetMs={m.targetMs} />
    </section>
  {/if}

  <!-- Characters -->
  <section class="panel">
    <h2>Team</h2>
    <div class="team">
      <div class="team-cols muted small" aria-hidden="true">
        <span></span><span>Field time</span><span>Inputs</span><span class="r">Right</span>
      </div>
      {#each m.chars as c, i (i)}
        {@const judged = c.hits + c.missed + c.wrong}
        {@const acc = judged ? c.hits / judged : null}
        {@const share = fieldTotal ? c.fieldMs / fieldTotal : 0}
        <div class="mate el-{loadout.characters[i]?.element ?? 'none'}">
          <div class="who">
            <Avatar character={loadout.characters[i]} size={38} slot={i + 1} />
            <div class="member-name">
              <b>{names[i]}</b>
              <span class="muted small">
                {c.entries}× on field{#if c.missed}{' · '}{c.missed} skipped{/if}{#if c.wrong}{' · '}{c.wrong} wrong{/if}
              </span>
            </div>
          </div>
          <div class="field">
            <div class="field-track"><div class="field-fill" style:width="{share * 100}%"></div></div>
            <span class="field-val"><b>{pct(share)}</b> <span class="muted">{clock(c.fieldMs)}</span></span>
          </div>
          <div class="acts">
            {#each ACTS as a (a.a)}
              {#if c.actions[a.a]}<span class="act"><b>{c.actions[a.a]}</b> {a.label}</span>{/if}
            {/each}
            {#if !Object.values(c.actions).some(Boolean)}<span class="muted small">no inputs</span>{/if}
          </div>
          <div class="member-acc tone-{acc === null ? 'none' : acc >= 0.9 ? 'good' : acc >= 0.75 ? 'ok' : 'bad'}">
            {@render ring(acc, 40, 4, '')}
            <span>{acc === null ? '—' : Math.round(acc * 100)}</span>
          </div>
        </div>
      {/each}
    </div>
    <p class="muted small">
      The ring is how many of that character's skills, bursts and swaps went right. Attacks, dashes and jumps are counted but never judged.
      {#if m.offTrackMs + m.pausedMs > 0}Off track for {clock(m.offTrackMs)}, paused for {clock(m.pausedMs)}.{/if}
    </p>
  </section>
{/if}

<style>
  /* Verdict */
  .hero {
    flex-direction: row;
    align-items: center;
    gap: 22px;
    --tone: var(--accent);
  }
  .tone-good {
    --tone: var(--ok);
  }
  .tone-ok {
    --tone: var(--warn);
  }
  .tone-bad {
    --tone: var(--bad);
  }
  .tone-none {
    --tone: var(--muted);
  }
  .hero {
    border-color: color-mix(in srgb, var(--tone) 35%, #20242f);
    background: linear-gradient(120deg, color-mix(in srgb, var(--tone) 10%, var(--panel)), var(--panel) 60%);
  }
  .score {
    position: relative;
    flex: none;
    width: 124px;
    height: 124px;
  }
  .ring-bg {
    fill: none;
    stroke: var(--panel-2);
  }
  .ring-fg {
    fill: none;
    stroke: var(--tone);
    stroke-linecap: round;
  }
  .score-txt {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .score-txt b {
    font-size: 30px;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .score-txt span {
    color: var(--muted);
    font-size: 12px;
    margin-top: 4px;
  }
  .hero-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }
  .headline {
    font-size: 22px;
    color: var(--tone);
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 26px;
    margin: 10px 0 0;
  }
  .stats dt {
    color: var(--muted);
    font-size: 12px;
  }
  .stats dd {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .stats small {
    font-size: 12.5px;
    font-weight: 600;
    margin-left: 4px;
    color: var(--muted);
  }
  .late {
    color: var(--warn) !important;
  }
  .early {
    color: var(--ok) !important;
  }

  /* Focus next */
  .tips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .tips li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .tips p {
    margin: 2px 0 0;
    font-size: 13px;
  }
  .tip-mark {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 13px;
    font-weight: 700;
    background: color-mix(in srgb, var(--warn) 18%, transparent);
    color: var(--warn);
  }
  .tip-good .tip-mark {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
    color: var(--ok);
  }

  /* Rotation map */
  .head-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  /* Timeline */
  .tl-scroll {
    overflow-x: auto;
    margin-bottom: 6px;
  }
  .tl {
    min-width: 560px;
    display: flex;
    flex-direction: column;
  }
  .tl-axis,
  .tl-lane {
    display: grid;
    grid-template-columns: 132px 1fr;
    gap: 12px;
    align-items: center;
  }
  .tl-scale {
    position: relative;
    height: 22px;
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .tl-scale span,
  .tl-loop-label {
    position: absolute;
    top: 2px;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .tl-scale span:first-child {
    transform: none;
  }
  .tl-loop-label {
    transform: none;
    padding-left: 5px;
    top: 2px;
    color: var(--accent);
    font-weight: 600;
    background: var(--panel);
  }
  .tl-lane {
    border-top: 1px solid #20242f;
  }
  .tl-who {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 13px;
  }
  .tl-who b {
    color: var(--el);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tl-track {
    position: relative;
    height: 38px;
  }
  .tl-grid,
  .tl-loop {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: #20242f;
  }
  .tl-loop {
    background: none;
    border-left: 1px dashed color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .tl-turn {
    position: absolute;
    top: 6px;
    bottom: 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--el) 12%, transparent);
  }
  .tl-turn.opener,
  .tl-step.opener {
    opacity: 0.7;
  }
  .tl-step {
    position: absolute;
    top: 6px;
    bottom: 6px;
    min-width: 6px;
    container-type: inline-size;
    padding: 0 1px;
    border-right: 2px solid var(--panel);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    font-size: 11.5px;
    font-weight: 600;
    background: var(--h);
    color: var(--hc, var(--text));
  }
  .tl-step span {
    overflow: hidden;
    white-space: nowrap;
  }
  @container (max-width: 17px) {
    .tl-step span {
      display: none;
    }
  }
  .tl-step.heat-0 {
    --h: color-mix(in srgb, var(--el) 40%, var(--panel-2));
    --hc: #fff;
  }
  .tl-step.noise.heat-0 {
    --h: color-mix(in srgb, var(--el) 22%, var(--panel-2));
    --hc: var(--text);
    font-weight: 500;
  }
  .tl-step.focus {
    box-shadow: inset 0 0 0 2px var(--text);
  }

  .bd {
    display: flex;
    flex-direction: column;
  }
  .bd-row {
    display: grid;
    grid-template-columns: 104px minmax(120px, 0.8fr) minmax(0, 1.4fr) 76px;
    grid-template-areas: 'time who acts field' '. notes notes notes';
    gap: 8px 14px;
    align-items: start;
    padding: 12px 0;
    border-bottom: 1px solid #20242f;
  }
  .bd-row:last-child {
    border-bottom: 0;
  }
  .bd-row.opener {
    opacity: 0.85;
  }
  .bd-head {
    padding: 0 0 8px;
  }
  .bd-part {
    padding: 12px 0 2px;
  }
  .r {
    text-align: right;
  }
  .bd-time {
    grid-area: time;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12.5px;
    color: var(--accent);
    padding-top: 6px;
    white-space: nowrap;
  }
  .bd-who {
    grid-area: who;
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .bd-who b {
    color: var(--el);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bd-acts {
    grid-area: acts;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 1px;
  }
  .bd-field {
    grid-area: field;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    padding-top: 3px;
    font-variant-numeric: tabular-nums;
  }
  .bd-field small {
    font-size: 11.5px;
    color: var(--muted);
  }
  .bd-notes {
    grid-area: notes;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding-top: 3px;
  }
  .issues {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12.5px;
    color: var(--warn);
  }
  .issues .bad {
    color: var(--bad);
  }
  .clean {
    font-size: 12.5px;
    color: var(--ok);
  }
  .note {
    width: 100%;
    resize: none;
    field-sizing: content;
    min-height: 30px;
    padding: 5px 8px;
    font: inherit;
    font-size: 13px;
    line-height: 1.4;
    color: var(--text);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
  }
  .note::placeholder {
    color: #5d6377;
  }
  .note:hover {
    border-color: var(--line);
  }
  .note:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--panel-2);
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    border-radius: 8px;
  }
  .cell.focus .chip {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .chip {
    position: relative;
    min-width: 30px;
    height: 30px;
    padding: 0 7px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    font-size: 12.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    background: var(--h);
    color: var(--hc, var(--text));
  }
  .chip.swap {
    min-width: 22px;
    padding: 0 4px;
    font-weight: 400;
  }
  .chip.noise {
    font-weight: 400;
  }
  .heat-0 {
    --h: #262b39;
    --hc: var(--muted);
  }
  .heat-1 {
    --h: color-mix(in srgb, var(--warn) 30%, #262b39);
  }
  .heat-2 {
    --h: color-mix(in srgb, #fb923c 55%, #262b39);
  }
  .heat-3 {
    --h: color-mix(in srgb, var(--bad) 75%, #262b39);
    --hc: #fff;
  }
  .badge {
    position: absolute;
    top: -7px;
    right: -7px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 99px;
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--text);
    font-size: 10px;
    font-style: normal;
    line-height: 14px;
    text-align: center;
  }
  .mini {
    position: relative;
    width: 28px;
    height: 4px;
    border-radius: 99px;
    background: #2c3242;
  }
  .mini::before {
    content: '';
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: var(--muted);
    opacity: 0.6;
  }
  .mini i {
    position: absolute;
    top: 50%;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--g);
    transform: translate(-50%, -50%);
  }

  /* Legends */
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .legend b {
    color: var(--text);
  }
  .sw,
  .gsw {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    margin-right: 6px;
    vertical-align: -1px;
  }
  .sw {
    background: var(--h);
  }
  .gsw {
    background: var(--g);
  }
  .mini-sw {
    width: 18px;
    height: 4px;
    background: #2c3242;
    border-radius: 99px;
    vertical-align: 2px;
  }

  /* Timing */
  .dist {
    display: flex;
    gap: 2px;
    height: 12px;
    border-radius: 99px;
    overflow: hidden;
  }
  .dist div {
    background: var(--g);
    min-width: 3px;
  }
  .ruler {
    width: 100%;
    height: auto;
    display: block;
  }
  .z-hit {
    fill: #1f2330;
  }
  .z-good {
    fill: color-mix(in srgb, var(--ok) 12%, #1f2330);
  }
  .z-perfect {
    fill: color-mix(in srgb, #5eead4 22%, #1f2330);
  }
  .zero {
    stroke: var(--text);
    stroke-width: 1;
    opacity: 0.5;
  }
  .spread {
    fill: var(--text);
    opacity: 0.12;
  }
  .dot {
    fill: var(--g);
    stroke: var(--panel);
    stroke-width: 1;
  }
  .mean {
    fill: var(--text);
  }
  .mean-label {
    fill: var(--text);
    font-size: 11.5px;
    font-weight: 600;
  }
  .axis {
    fill: var(--muted);
    font-size: 10.5px;
  }

  /* Team */
  .team {
    display: flex;
    flex-direction: column;
  }
  .team-cols,
  .mate {
    display: grid;
    grid-template-columns: minmax(170px, 1.2fr) minmax(130px, 1fr) minmax(0, 1.4fr) 40px;
    gap: 16px;
    align-items: center;
  }
  .team-cols {
    padding-bottom: 6px;
    border-bottom: 1px solid #20242f;
  }
  .team-cols .r {
    text-align: right;
  }
  .mate {
    padding: 10px 0;
    border-bottom: 1px solid #20242f;
  }
  .mate:last-child {
    border-bottom: 0;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .field-track {
    height: 8px;
    border-radius: 99px;
    background: var(--panel-2);
    overflow: hidden;
  }
  .field-fill {
    height: 100%;
    border-radius: 99px;
    background: var(--el);
  }
  .field-val {
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }
  .member-name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .member-name b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .member-acc {
    position: relative;
    width: 40px;
    height: 40px;
    flex: none;
  }
  .member-acc span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .member-acc :global(.ring-bg) {
    fill: none;
    stroke: #2c3242;
  }
  .member-acc :global(.ring-fg) {
    fill: none;
    stroke: var(--tone);
    stroke-linecap: round;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .act {
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--panel-2);
    font-size: 12px;
    color: var(--muted);
  }
  .act b {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 560px) {
    .bd-head {
      display: none;
    }
    .bd-row {
      grid-template-columns: 1fr auto;
      grid-template-areas: 'who field' 'time time' 'acts acts' 'notes notes';
      gap: 6px 12px;
    }
    .bd-time {
      padding-top: 0;
    }
    .hero {
      flex-direction: column;
      align-items: flex-start;
    }
    .team-cols {
      display: none;
    }
    .mate {
      grid-template-columns: 1fr 40px;
      gap: 8px 12px;
    }
    .mate .field,
    .mate .acts {
      grid-column: 1 / -1;
    }
    .mate .member-acc {
      grid-row: 1;
      grid-column: 2;
    }
  }
</style>
