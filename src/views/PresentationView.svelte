<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Avatar from '../components/Avatar.svelte';
  import { blocksOf } from '../lib/blocks';
  import { clock } from '../lib/format';
  import { charName, stepLabel } from '../lib/notation';
  import { isTauri } from '../lib/platform';
  import { followPresentation, presentationSize, type PresentationState } from '../lib/presentation';

  let st = $state.raw<PresentationState | null>(null);
  let root = $state<HTMLElement | null>(null);

  const blocks = $derived(st ? blocksOf(st.steps) : []);
  const prefs = $derived(st?.prefs);
  const live = $derived(!!st && st.status !== 'idle' && st.status !== 'done');
  const current = $derived(st && st.status !== 'done' ? st.pointer : -1);
  const currentBlock = $derived(current >= 0 ? (st?.steps[current]?.block ?? -1) : -1);
  const hasOpener = $derived(blocks.some((b) => b.loopEntry));

  const statusText = $derived.by(() => {
    if (!st) return '';
    if (st.status === 'idle' || st.status === 'armed') return 'Ready';
    if (st.status === 'done') return 'Complete';
    if (st.status === 'offtrack') return st.offReason === 'idle' ? 'Paused' : 'Off track';
    return '';
  });

  function chipState(index: number): string {
    if (index === current) return 'current';
    const s = st?.statuses?.[index] ?? 'pending';
    return s === 'ok' || s === 'partial' ? 'done' : s;
  }

  /** The window has no title bar: dragging anywhere moves it. */
  async function drag(e: MouseEvent) {
    if (e.button !== 0 || !isTauri) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  }

  // Switching layout resizes the window to fit it; any other size the user set is kept.
  let lastLayout: string | null = null;
  $effect(() => {
    const p = prefs;
    if (!p) return;
    if (lastLayout !== null && lastLayout !== p.layout) {
      const { width, height } = presentationSize(p);
      if (!isTauri) window.resizeTo(width, height);
      else void import('@tauri-apps/api/window').then(({ getCurrentWindow, LogicalSize }) =>
        getCurrentWindow().setSize(new LogicalSize(width, height)),
      );
    }
    lastLayout = p.layout;
  });

  // A long rotation in a small window: keep the current block in view.
  $effect(() => {
    const b = currentBlock;
    if (b < 0 || !root) return;
    void tick().then(() =>
      root?.querySelector(`[data-block="${b}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }),
    );
  });

  onMount(() => {
    document.documentElement.classList.add('presentation');
    let stop: (() => void) | null = null;
    void followPresentation((s) => (st = s)).then((f) => (stop = f));
    return () => stop?.();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pres bg-{prefs?.background ?? 'dark'}"
  class:vertical={prefs?.layout === 'vertical'}
  style:--s={prefs?.scale ?? 1}
  bind:this={root}
  onmousedown={drag}
>
  {#if !st}
    <div class="waiting">Waiting for a loadout…</div>
  {:else}
    {#if prefs?.header}
      <div class="head">
        <span class="name">{st.name}</span>
        {#if st.status !== 'idle'}
          <span class="stat">Lap <b>{st.lap + (st.status === 'done' ? 0 : 1)}</b></span>
          <span class="stat"><b>{clock(st.elapsedMs)}</b></span>
        {/if}
        {#if statusText}<span class="state s-{st.status}">{statusText}</span>{/if}
      </div>
    {/if}
    <div class="rotation">
      {#if hasOpener}<span class="p-part">Opener</span>{/if}
      {#each blocks as b, bi (bi)}
        {#if b.loopEntry}<span class="p-part loop">↻ Loop</span>{/if}
        {@const past = live && currentBlock >= 0 && bi < currentBlock}
        <div
          class="p-block el-{st.characters[b.slot]?.element ?? 'none'}"
          class:active={bi === currentBlock}
          class:past
          class:swap-now={b.swap >= 0 && b.swap === current}
          data-block={bi}
        >
          <Avatar character={st.characters[b.slot]} size={Math.round(40 * (prefs?.scale ?? 1))} />
          <div class="p-body">
            {#if prefs?.layout === 'vertical'}<span class="p-who">{charName(st.characters, b.slot as 0 | 1 | 2 | 3)}</span>{/if}
            <div class="p-chips">
              {#each b.items as { step, index } (index)}
                <span class="p-chip c-{chipState(index)}">
                  {stepLabel(step.action, step.count)}{#if index === current && step.action === 'na' && step.count > 1 && st.naClicks > 0}<small>{st.naClicks}/{step.count}</small>{/if}
                </span>
              {/each}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  :global(html.presentation),
  :global(html.presentation body) {
    background: transparent;
    overflow: hidden;
  }
  :global(html.presentation #app) {
    height: 100%;
  }

  .pres {
    --s: 1;
    height: 100%;
    overflow: auto;
    scrollbar-width: none;
    padding: calc(10px * var(--s)) calc(12px * var(--s));
    display: flex;
    flex-direction: column;
    gap: calc(8px * var(--s));
    font-size: calc(16px * var(--s));
    cursor: default;
  }
  .bg-dark { background: var(--bg); }
  .bg-green { background: #00b140; }
  .bg-transparent { background: transparent; }
  /* Over green or the game itself, text needs its own contrast. */
  .bg-green .head,
  .bg-transparent .head,
  .bg-green .p-part,
  .bg-transparent .p-part { text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); }

  .waiting { margin: auto; color: var(--muted); }

  .head { display: flex; align-items: baseline; gap: 1em; white-space: nowrap; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .stat { color: var(--muted); font-variant-numeric: tabular-nums; }
  .stat b { color: var(--text); font-weight: 600; }
  .state { margin-left: auto; font-size: 0.8em; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .state.s-offtrack { color: var(--warn); }
  .state.s-done { color: var(--ok); }

  .rotation { display: flex; flex-wrap: wrap; align-items: center; gap: calc(8px * var(--s)); }
  .vertical .rotation { flex-direction: column; flex-wrap: nowrap; align-items: stretch; }

  .p-part { font-size: 0.72em; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .p-part.loop { color: var(--accent); }

  .p-block {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.35em 0.6em 0.35em 0.4em;
    border-radius: 0.6em;
    background: var(--panel-2);
    transition: background 0.15s, opacity 0.15s;
  }
  .p-block.active { background: color-mix(in srgb, var(--el) 24%, var(--panel-2)); }
  /* Dim the content, not the block: a see-through block would let a green screen bleed in. */
  .p-block.past > * { opacity: 0.5; }
  .p-block.swap-now { animation: swap 0.9s ease-in-out infinite; }
  @keyframes swap {
    50% { background: color-mix(in srgb, var(--el) 40%, var(--panel-2)); }
  }

  .p-body { display: flex; flex-direction: column; gap: 0.2em; min-width: 0; }
  .p-who { font-size: 0.8em; font-weight: 600; color: var(--el); }
  .p-chips { display: flex; flex-wrap: wrap; gap: 0.3em; }
  .p-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3em;
    padding: 0.15em 0.55em;
    border-radius: 0.4em;
    background: #272c3b;
    font-weight: 600;
    white-space: nowrap;
  }
  .p-chip small { font-size: 0.8em; font-weight: 500; opacity: 0.8; }
  .p-chip.c-current { background: var(--accent); color: #0e1016; transform: scale(1.08); }
  .p-chip.c-done { background: #1f2a26; color: #8fcfa8; }
  .p-chip.c-missed { background: #3d1d20; color: var(--bad); text-decoration: line-through; }
  .p-chip.c-skipped { opacity: 0.4; }
</style>
