<script lang="ts">
  import { portraitUrl, searchRoster, type RosterEntry } from '../lib/roster';
  import type { Character, Element } from '../lib/types';

  interface Props {
    /** Team as it is now, so members already in it can be shown as taken. */
    team: Character[];
    slot: number;
    onpick: (c: Character) => void;
    onclose: () => void;
  }
  let { team, slot, onpick, onclose }: Props = $props();

  let query = $state('');
  let element = $state<Element | 'all'>('all');
  let input: HTMLInputElement;

  const ELEMENTS: Element[] = ['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'];
  const taken = $derived(new Set(team.filter((c, i) => i !== slot && c.id).map((c) => c.id)));
  const results = $derived(
    searchRoster(query)
      .filter((c) => element === 'all' || c.element === element)
      .sort((a, b) => (query ? 0 : b.rarity - a.rarity || a.name.localeCompare(b.name))),
  );

  function pick(c: RosterEntry) {
    if (taken.has(c.id)) return;
    onpick({ name: c.name, element: c.element, id: c.id });
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
    if (e.key === 'Enter') {
      const first = results.find((c) => !taken.has(c.id));
      if (first) pick(first);
      else if (query.trim()) onpick({ name: query.trim().slice(0, 40), element: 'none' });
    }
  }

  $effect(() => input?.focus());
</script>

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog picker" role="dialog" aria-modal="true" aria-label="Choose a character">
    <div class="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input bind:this={input} bind:value={query} onkeydown={onkey} placeholder="Search characters: name, nickname, gcsim key…" spellcheck="false" />
    </div>
    <div class="filters" role="radiogroup" aria-label="Element">
      <button class="flt" class:on={element === 'all'} onclick={() => (element = 'all')}>All</button>
      {#each ELEMENTS as el (el)}
        <button class="flt el-{el}" class:on={element === el} onclick={() => (element = el)}>
          <span class="dot"></span>{el[0].toUpperCase() + el.slice(1)}
        </button>
      {/each}
    </div>

    <div class="grid-chars">
      {#each results as c (c.id)}
        <button class="char el-{c.element}" class:taken={taken.has(c.id)} disabled={taken.has(c.id)} onclick={() => pick(c)} title={taken.has(c.id) ? 'Already in the team' : c.name}>
          <img src={portraitUrl(c.id)} alt="" loading="lazy" draggable="false" class:r5={c.rarity === 5} />
          <span class="nm">{c.name}</span>
          {#if c.upcoming}<span class="new">{c.upcoming}</span>{/if}
        </button>
      {:else}
        <div class="none muted">
          No character matches “{query}”.
          {#if query.trim()}
            <button onclick={() => onpick({ name: query.trim().slice(0, 40), element: 'none' })}>Use “{query.trim()}” as a custom name</button>
          {/if}
        </div>
      {/each}
    </div>
    <div class="row end">
      <span class="muted small">Enter picks the first result</span>
      <div class="spacer"></div>
      <button onclick={onclose}>Cancel</button>
    </div>
  </div>
</div>

<style>
  .picker {
    width: min(760px, 100%);
    max-height: min(680px, calc(100vh - 40px));
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--panel-2);
    border-radius: 9px;
    padding: 0 12px;
    border: 1px solid var(--line);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .search input {
    border: 0;
    background: transparent;
    padding: 10px 0;
    font-size: 15px;
  }
  .search input:focus-visible {
    outline: none;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .flt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 12.5px;
    border-radius: 99px;
    background: transparent;
  }
  .flt .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--el);
  }
  .flt.on {
    background: var(--panel-2);
    color: var(--text);
    border-color: color-mix(in srgb, var(--el, var(--accent)) 60%, var(--line));
  }
  .grid-chars {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
    gap: 8px;
    overflow-y: auto;
    padding: 2px;
    min-height: 200px;
    align-content: start;
  }
  .char {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 6px 7px;
    border-radius: 10px;
    background: var(--panel-2);
    border-color: transparent;
  }
  .char:hover:not(:disabled) {
    background: color-mix(in srgb, var(--el) 14%, var(--panel-2));
    border-color: color-mix(in srgb, var(--el) 50%, transparent);
  }
  .char img {
    width: 64px;
    height: 64px;
    border-radius: 12px;
    background: linear-gradient(160deg, #3b3f55, #23263a);
  }
  .char img.r5 {
    background: linear-gradient(160deg, #8a5a2b, #3b2a1d);
  }
  .nm {
    font-size: 12px;
    line-height: 1.2;
    text-align: center;
    white-space: normal;
    color: var(--text);
  }
  .new {
    position: absolute;
    top: 5px;
    right: 5px;
    font-size: 10px;
    font-weight: 700;
    padding: 0 5px;
    border-radius: 5px;
    background: var(--accent);
    color: #0b1020;
  }
  .none {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 30px;
  }
</style>
