<script lang="ts">
  interface Series {
    name: string;
    color: string;
    values: (number | null)[];
  }
  interface Props {
    labels: string[];
    series: Series[];
    format: (v: number) => string;
    /** Fixed y range; defaults to 0..max. */
    yMax?: number;
    reference?: { value: number; label: string } | null;
  }
  let { labels, series, format, yMax, reference = null }: Props = $props();

  const W = 640;
  const H = 170;
  const PAD = { l: 44, r: 12, t: 12, b: 22 };
  let hover = $state<number | null>(null);

  const max = $derived(
    yMax ?? Math.max(1e-9, reference?.value ?? 0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))) * 1.12,
  );
  const n = $derived(labels.length);
  const x = (i: number) => PAD.l + (n <= 1 ? (W - PAD.l - PAD.r) / 2 : ((W - PAD.l - PAD.r) * i) / (n - 1));
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const ticks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => f * max));

  function path(values: (number | null)[]) {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  }

  function onmove(e: MouseEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    hover = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
  }
</script>

<div class="chart">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={series.map((s) => s.name).join(', ')} onmousemove={onmove} onmouseleave={() => (hover = null)}>
    {#each ticks as t (t)}
      <line class="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
      <text class="axis" x={PAD.l - 6} y={y(t) + 4} text-anchor="end">{format(t)}</text>
    {/each}
    {#if reference}
      <line class="ref" x1={PAD.l} x2={W - PAD.r} y1={y(reference.value)} y2={y(reference.value)} />
      <text class="axis" x={W - PAD.r} y={y(reference.value) - 5} text-anchor="end">{reference.label}</text>
    {/if}
    {#if hover !== null}<line class="cross" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} />{/if}
    {#each series as s (s.name)}
      <path d={path(s.values)} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      {#each s.values as v, i (i)}
        {#if v !== null && (n <= 12 || hover === i)}
          <circle cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4} fill={s.color} stroke="var(--panel)" stroke-width="2" />
        {/if}
      {/each}
    {/each}
  </svg>
  {#if hover !== null}
    <div class="tip" style:left="{(x(hover) / W) * 100}%">
      <b>{labels[hover]}</b>
      {#each series as s (s.name)}
        <div><i style:background={s.color}></i>{s.name}: {s.values[hover] === null ? '—' : format(s.values[hover]!)}</div>
      {/each}
    </div>
  {/if}
  {#if series.length > 1 || reference}
    <div class="legend">
      {#each series as s (s.name)}<span><i style:background={s.color}></i>{s.name}</span>{/each}
      {#if reference}<span><i class="line"></i>{reference.label}</span>{/if}
    </div>
  {/if}
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
  }
  .axis {
    fill: var(--muted);
    font-size: 10.5px;
  }
  .ref {
    stroke: var(--text);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
    opacity: 0.6;
  }
  .cross {
    stroke: var(--muted);
    stroke-width: 1;
    opacity: 0.6;
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
  i {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 6px;
  }
  i.line {
    width: 12px;
    height: 0;
    border-radius: 0;
    border-top: 2px dashed var(--text);
    opacity: 0.6;
    vertical-align: 3px;
  }
  .legend {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--muted);
    margin-top: 4px;
  }
</style>
