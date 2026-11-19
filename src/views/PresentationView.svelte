<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Avatar from '../components/Avatar.svelte';
  import { blocksOf } from '../lib/blocks';
  import { clock } from '../lib/format';
  import { stepLabel } from '../lib/notation';
  import { isTauri } from '../lib/platform';
  import { closeOverlay, fitOverlayHeight, followPresentation, presentationSize, sendPresentationCommand, type PresentationState } from '../lib/presentation';

  let st = $state.raw<PresentationState | null>(null);
  let panel = $state<HTMLElement | null>(null);
  let rotation = $state<HTMLElement | null>(null);

  const blocks = $derived(st ? blocksOf(st.steps) : []);
  const prefs = $derived(st?.prefs);
  const running = $derived(!!st && st.status !== 'idle' && st.status !== 'done');
  const current = $derived(st && st.status !== 'done' ? st.pointer : -1);
  const currentBlock = $derived(current >= 0 ? (st?.steps[current]?.block ?? -1) : -1);
  const hasOpener = $derived(blocks.some((b) => b.loopEntry));

  const status = $derived.by((): { text: string; tone: string } => {
    if (!st || st.status === 'idle') return { text: 'Ready', tone: 'idle' };
    if (st.status === 'armed') return { text: 'Waiting for your first step', tone: 'idle' };
    if (st.status === 'done') return { text: 'Done', tone: 'ok' };
    if (st.status === 'offtrack') return { text: st.offReason === 'idle' ? 'Paused' : 'Off track', tone: 'warn' };
    return { text: 'Live', tone: 'live' };
  });

  function chipState(index: number): string {
    if (index === current) return 'current';
    const s = st?.statuses?.[index] ?? 'pending';
    return s === 'ok' || s === 'partial' ? 'done' : s;
  }

  /** The window has no title bar: dragging the panel moves it. */
  async function drag(e: MouseEvent) {
    if (e.button !== 0 || !isTauri || (e.target as HTMLElement).closest('button')) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  }

  // Switching layout sets a width that suits it; the height always follows the panel.
  let lastLayout: string | null = null;
  $effect(() => {
    const p = prefs;
    if (!p) return;
    if (lastLayout !== null && lastLayout !== p.layout) void fitOverlayHeight(presentationSize(p).width, panel?.offsetHeight ?? 0);
    lastLayout = p.layout;
  });

  // The window is as tall as the panel: no empty space below it, however the rotation wraps.
  $effect(() => {
    const el = panel;
    if (!el) return;
    const ro = new ResizeObserver(() => void fitOverlayHeight(null, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  });

  // A long rotation in a narrow window: keep the current block in view.
  $effect(() => {
    const b = currentBlock;
    if (b < 0 || !rotation) return;
    void tick().then(() =>
      rotation?.querySelector(`[data-block="${b}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }),
    );
  });

  onMount(() => {
    document.documentElement.classList.add('presentation');
    let stop: (() => void) | null = null;
    void followPresentation((s) => (st = s)).then((f) => (stop = f));
    return () => stop?.();
  });
</script>

<div class="frame" class:green={prefs?.background === 'green'} style:--s={prefs?.scale ?? 1}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ov-panel" class:vertical={prefs?.layout === 'vertical'} bind:this={panel} onmousedown={drag}>
    <div class="head">
      <span class="status t-{status.tone}"><i></i>{status.text}</span>
      {#if st && prefs?.header && st.status !== 'idle'}
        <span class="stat">Lap <b>{Math.max(1, st.lap + (st.status === 'done' ? 0 : 1))}</b></span>
        <span class="stat"><b>{clock(st.elapsedMs)}</b></span>
      {/if}
      <span class="spacer"></span>
      {#if st}
        {#if running}
          <button class="danger" onclick={() => sendPresentationCommand('stop')}>Stop</button>
        {:else}
          <button class="primary" onclick={() => sendPresentationCommand('start')}>Start</button>
        {/if}
      {/if}
      <button class="ghost close" title="Close the overlay" aria-label="Close the overlay" onclick={closeOverlay}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </button>
    </div>

    {#if !st}
      <div class="waiting">Open a loadout in Genshin Training Wheels.</div>
    {:else}
      <div class="rotation" bind:this={rotation}>
        {#if hasOpener}<span class="part">Opener</span>{/if}
        {#each blocks as b, bi (bi)}
          {#if b.loopEntry}<span class="part loop">↻ Loop</span>{/if}
          <div
            class="turn el-{st.characters[b.slot]?.element ?? 'none'}"
            class:active={bi === currentBlock}
            class:past={running && currentBlock >= 0 && bi < currentBlock}
            class:swap-now={b.swap >= 0 && b.swap === current}
            data-block={bi}
          >
            <Avatar character={st.characters[b.slot]} size={Math.round(34 * (prefs?.scale ?? 1))} />
            <div class="ov-chips">
              {#each b.items as { step, index } (index)}
                <span class="ov-chip c-{chipState(index)}">
                  {stepLabel(step.action, step.count)}{#if index === current && step.action === 'na' && step.count > 1 && st.naClicks > 0}<small>{st.naClicks}/{step.count}</small>{/if}
                </span>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  :global(html.presentation),
  :global(html.presentation body) {
    background: transparent;
    overflow: hidden;
    height: auto;
    min-height: 0;
  }
  :global(html.presentation #app) {
    min-height: 0;
  }

  /* Around the panel: transparent, or green for a chroma key. */
  .frame {
    --s: 1;
    padding: 4px;
    font-size: calc(15px * var(--s));
  }
  .frame.green { background: #00b140; }

  .ov-panel {
    display: flex;
    flex-direction: column;
    gap: calc(10px * var(--s));
    padding: calc(10px * var(--s)) calc(12px * var(--s)) calc(12px * var(--s));
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    cursor: default;
  }

  .head { display: flex; align-items: center; gap: 0.9em; min-height: 28px; white-space: nowrap; }
  .spacer { flex: 1; }
  .status { display: inline-flex; align-items: center; gap: 0.45em; font-size: 0.85em; font-weight: 600; color: var(--muted); }
  .status i { width: 0.55em; height: 0.55em; border-radius: 50%; background: currentColor; }
  .status.t-live { color: var(--ok); }
  .status.t-warn { color: var(--warn); }
  .status.t-ok { color: var(--ok); }
  .stat { font-size: 0.85em; color: var(--muted); font-variant-numeric: tabular-nums; }
  .stat b { color: var(--text); font-weight: 600; }
  .head button { padding: 3px 12px; font-size: 13px; }
  .head .close { padding: 5px; display: inline-grid; place-items: center; }

  .waiting { color: var(--muted); font-size: 0.9em; }

  .rotation { display: flex; flex-wrap: wrap; align-items: center; gap: calc(6px * var(--s)); }
  .ov-panel.vertical .rotation { flex-direction: column; align-items: stretch; flex-wrap: nowrap; }

  .part { font-size: 0.7em; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .part.loop { color: var(--accent); }

  .turn {
    display: flex;
    align-items: center;
    gap: 0.45em;
    padding: 0.3em 0.5em 0.3em 0.3em;
    border-radius: 0.55em;
    background: var(--panel-2);
    transition: background 0.15s;
  }
  .turn.active { background: color-mix(in srgb, var(--el) 22%, var(--panel-2)); }
  /* Dim the content, not the turn: a see-through turn would let a green screen bleed in. */
  .turn.past > * { opacity: 0.45; }
  .turn.swap-now { animation: swap 0.9s ease-in-out infinite; }
  @keyframes swap {
    50% { background: color-mix(in srgb, var(--el) 40%, var(--panel-2)); }
  }

  .ov-chips { display: flex; flex-wrap: wrap; gap: 0.3em; }
  .ov-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3em;
    padding: 0.12em 0.5em;
    border-radius: 0.4em;
    background: #272c3b;
    font-weight: 600;
    white-space: nowrap;
  }
  .ov-chip small { font-size: 0.8em; font-weight: 500; opacity: 0.8; }
  .ov-chip.c-current { background: var(--accent); color: #0e1016; }
  .ov-chip.c-done { color: #8fcfa8; background: #1f2a26; }
  .ov-chip.c-missed { background: #3d1d20; color: var(--bad); text-decoration: line-through; }
  .ov-chip.c-skipped { opacity: 0.4; }
</style>
