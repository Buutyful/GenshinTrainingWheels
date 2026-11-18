<script lang="ts">
  import { coach } from '../lib/coach';
  import { flatten, type FlatStep } from '../lib/engine';
  import { clock, pct, secs } from '../lib/format';
  import { charName, stepLabel } from '../lib/notation';
  import { GRADE_LABEL, GRADES, grade, WINDOWS } from '../lib/rhythm';
  import { timingSig } from '../lib/timing';
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
  const verdict = $derived(coach({ run, steps, names, sameRotation, describe }));
  const focusStep = $derived(verdict.tips.find((t) => t.step !== undefined)?.step ?? null);

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

  interface Turn {
    block: number;
    slot: Slot;
    opener: boolean;
    items: { s: FlatStep; i: number }[];
  }
  const turns = $derived.by(() => {
    const out: Turn[] = [];
    steps.forEach((s, i) => {
      const last = out[out.length - 1];
      if (last && last.block === s.block) last.items.push({ s, i });
      else out.push({ block: s.block, slot: s.slot, opener: loopAt > 0 && i < loopAt, items: [{ s, i }] });
    });
    return out;
  });

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

  <!-- Rotation map -->
  <section class="panel">
    <div class="head-row">
      <h2>Where in the rotation</h2>
      {#if sameRotation}<span class="muted small">{totalErr ? `${totalErr} mistake${totalErr === 1 ? '' : 's'}` : 'no mistakes'}</span>{/if}
    </div>
    {#if !sameRotation}
      <p class="muted">The rotation has changed since this run, so its steps can't be mapped any more.</p>
    {:else}
      <div class="map">
        {#each turns as turn, ti (ti)}
          {#if loopAt > 0 && ti === 0}<span class="part-label">Opener</span>{/if}
          {#if loopAt > 0 && turn.items[0].i === loopAt}<span class="part-label loop">Loop ↻</span>{/if}
          <div class="turn el-{loadout.characters[turn.slot]?.element ?? 'none'}" class:opener={turn.opener}>
            <Avatar character={loadout.characters[turn.slot]} size={26} />
            {#each turn.items as { s, i } (i)}
              <div class="cell" class:focus={focusStep === i} title={stepTip(i)}>
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
              </div>
            {/each}
          </div>
        {/each}
      </div>
      <div class="legend">
        <span><i class="sw heat-0"></i>Clean</span>
        <span><i class="sw heat-1"></i>Some mistakes</span>
        <span><i class="sw heat-3"></i>Most mistakes</span>
        {#if rhSteps}<span><i class="sw mini-sw"></i>Average timing, early ← → late</span>{/if}
      </div>
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
    {#if fieldTotal > 0}
      <div class="share" role="img" aria-label="Field time by character">
        {#each m.chars as c, i (i)}
          {#if c.fieldMs > 0}
            <div class="seg el-{loadout.characters[i]?.element ?? 'none'}" style:flex-grow={c.fieldMs} title="{names[i]}: {pct(c.fieldMs / fieldTotal)}">
              {#if c.fieldMs / fieldTotal >= 0.12}<span>{pct(c.fieldMs / fieldTotal)}</span>{/if}
            </div>
          {/if}
        {/each}
      </div>
      <p class="muted small share-cap">Share of field time</p>
    {/if}
    <div class="team">
      {#each m.chars as c, i (i)}
        {@const judged = c.hits + c.missed + c.wrong}
        {@const acc = judged ? c.hits / judged : null}
        <div class="mate el-{loadout.characters[i]?.element ?? 'none'}">
          <div class="member-head">
            <Avatar character={loadout.characters[i]} size={40} slot={i + 1} />
            <div class="member-name">
              <b>{names[i]}</b>
              <span class="muted small">{clock(c.fieldMs)} · {c.entries}× on field</span>
            </div>
            <div class="member-acc tone-{acc === null ? 'none' : acc >= 0.9 ? 'good' : acc >= 0.75 ? 'ok' : 'bad'}">
              {@render ring(acc, 44, 5, '')}
              <span>{acc === null ? '—' : Math.round(acc * 100)}</span>
            </div>
          </div>
          <div class="acts">
            {#each ACTS as a (a.a)}
              {#if c.actions[a.a]}<span class="act"><b>{c.actions[a.a]}</b> {a.label}</span>{/if}
            {/each}
            {#if !Object.values(c.actions).some(Boolean)}<span class="muted small">no inputs</span>{/if}
          </div>
          {#if c.missed || c.wrong}
            <div class="muted small">{c.missed ? `${c.missed} skipped` : ''}{c.missed && c.wrong ? ' · ' : ''}{c.wrong ? `${c.wrong} wrong` : ''}</div>
          {/if}
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
  .map {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
  }
  .map .part-label {
    align-self: center;
  }
  .turn {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    padding: 6px 8px 6px 6px;
    border-radius: 10px;
    background: var(--panel-2);
    border-top: 2px solid var(--el);
  }
  .turn.opener {
    opacity: 0.85;
    border-top-style: dashed;
  }
  .turn > :global(.avatar) {
    margin-top: 2px;
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
  .share {
    display: flex;
    gap: 2px;
    height: 22px;
    border-radius: 7px;
    overflow: hidden;
  }
  .share .seg {
    background: var(--el);
    min-width: 2px;
    display: grid;
    place-items: center;
    color: #10131b;
    font-size: 11.5px;
    font-weight: 700;
  }
  .share-cap {
    margin-top: -6px;
  }
  .team {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .mate {
    background: var(--panel-2);
    border-radius: 10px;
    border-left: 3px solid var(--el);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .member-head {
    display: flex;
    align-items: center;
    gap: 10px;
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
    width: 44px;
    height: 44px;
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
    background: var(--panel);
    font-size: 12px;
    color: var(--muted);
  }
  .act b {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 560px) {
    .hero {
      flex-direction: column;
      align-items: flex-start;
    }
    .team {
      grid-template-columns: 1fr;
    }
  }
</style>
