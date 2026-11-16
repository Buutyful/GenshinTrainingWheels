<script lang="ts">
  import type { LapMetric } from '../lib/types';

  let { laps, targetMs }: { laps: LapMetric[]; targetMs: number | null } = $props();

  const W = 640;
  const H = 180;
  const PAD = { l: 40, r: 10, t: 12, b: 22 };
  let hover = $state<number | null>(null);

  const max = $derived(Math.max(1000, targetMs ?? 0, ...laps.map((l) => l.ms)) * 1.1);
  const ticks = $derived.by(() => {
    const stepS = [1, 2, 5, 10, 15, 30, 60].find((s) => (max / 1000) / s <= 5) ?? 120;
    const out: number[] = [];
    for (let v = 0; v <= max / 1000; v += stepS) out.push(v * 1000);
    return out;
  });
  const y = (ms: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - ms / max);
  const band = $derived((W - PAD.l - PAD.r) / Math.max(laps.length, 1));
  const barW = $derived(Math.max(4, Math.min(36, band - 4)));
</script>

<div class="chart">
  <svg viewBox="0 0 {W} {H}" role="img" aria-label="Lap times">
    {#each ticks as t (t)}
      <line class="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
      <text class="axis" x={PAD.l - 6} y={y(t) + 4} text-anchor="end">{t / 1000}s</text>
    {/each}
    {#each laps as lap, i (i)}
      {@const x = PAD.l + band * i + (band - barW) / 2}
      {@const top = y(lap.ms)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)}>
        <rect class="hit" x={PAD.l + band * i} y={PAD.t} width={band} height={H - PAD.t - PAD.b} />
        <path
          class="bar"
          class:clean={lap.clean}
          class:dim={hover !== null && hover !== i}
          d="M{x},{y(0)} V{top + 4} Q{x},{top} {x + 4},{top} H{x + barW - 4} Q{x + barW},{top} {x + barW},{top + 4} V{y(0)} Z"
        />
        {#if laps.length <= 24}
          <text class="axis" x={x + barW / 2} y={H - 6} text-anchor="middle">{i + 1}</text>
        {/if}
      </g>
    {/each}
    {#if targetMs}
      <line class="target" x1={PAD.l} x2={W - PAD.r} y1={y(targetMs)} y2={y(targetMs)} />
      <text class="target-label" x={W - PAD.r} y={y(targetMs) - 5} text-anchor="end">target {targetMs / 1000}s</text>
    {/if}
  </svg>
  {#if hover !== null}
    {@const lap = laps[hover]}
    <div class="tip" style:left="{((PAD.l + band * (hover + 0.5)) / W) * 100}%">
      <b>Lap {hover + 1}</b> · {(lap.ms / 1000).toFixed(1)}s
      {#if targetMs}<span class:late={lap.ms > targetMs}>{lap.ms > targetMs ? '+' : '−'}{(Math.abs(lap.ms - targetMs) / 1000).toFixed(1)}s</span>{/if}
      <br /><span class="muted">{lap.clean ? 'Clean' : `${lap.errors} error${lap.errors === 1 ? '' : 's'}`}</span>
    </div>
  {/if}
  <div class="legend">
    <span><i class="sw clean"></i>Clean lap</span>
    <span><i class="sw"></i>Lap with errors</span>
    {#if targetMs}<span><i class="sw line"></i>Rotation time</span>{/if}
  </div>
</div>

<style>
  .chart {
    position: relative;
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .grid {
    stroke: #232837;
    stroke-width: 1;
  }
  .axis {
    fill: var(--muted);
    font-size: 10.5px;
  }
  .hit {
    fill: transparent;
  }
  .bar {
    fill: #5b6378;
    transition: opacity 0.1s;
  }
  .bar.clean {
    fill: var(--accent);
  }
  .bar.dim {
    opacity: 0.45;
  }
  .target {
    stroke: var(--text);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
    opacity: 0.7;
  }
  .target-label {
    fill: var(--muted);
    font-size: 10.5px;
  }
  .tip {
    position: absolute;
    top: 0;
    transform: translate(-50%, -100%);
    background: #0b0d13;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 9px;
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  .late {
    color: var(--warn);
  }
  .legend {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--muted);
    margin-top: 4px;
  }
  .sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: #5b6378;
    margin-right: 6px;
    vertical-align: -1px;
  }
  .sw.clean {
    background: var(--accent);
  }
  .sw.line {
    height: 0;
    border-top: 2px dashed var(--text);
    border-radius: 0;
    opacity: 0.7;
    vertical-align: 3px;
  }
</style>
