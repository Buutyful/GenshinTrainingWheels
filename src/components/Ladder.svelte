<script lang="ts">
  import { app, findLoadout, importResult, removeLadderEntry, setPlayerName } from '../lib/app.svelte';
  import { pct, secs } from '../lib/format';
  import { bestRun, encodeResult, entryFromRun, ranking } from '../lib/ladder';

  let { id }: { id: string } = $props();

  const l = $derived(findLoadout(id));
  const me = $derived(app.data.settings.playerName ?? '');
  const rows = $derived(l ? ranking(l, me) : []);
  const leader = $derived(rows[0]?.entry.bestLapMs ?? null);
  const own = $derived(l ? bestRun(l) : null);
  const friends = $derived(rows.filter((r) => !r.mine).length);

  let mode = $state<'share' | 'add' | null>(null);
  let name = $state('');
  let paste = $state('');
  let message = $state<{ text: string; ok: boolean; neutral?: boolean } | null>(null);
  let copied = $state(false);

  const code = $derived(l && own && name.trim() ? encodeResult($state.snapshot(l), entryFromRun(own, name.trim())) : '');

  function open(m: 'share' | 'add') {
    mode = mode === m ? null : m;
    name = me;
    paste = '';
    message = null;
  }

  async function copy() {
    setPlayerName(name);
    await navigator.clipboard.writeText(code).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function add() {
    const r = importResult(paste, id);
    if ('message' in r) {
      message = { text: r.message, ok: false };
      return;
    }
    const what = { added: 'is on the ladder', improved: 'has a new best', kept: 'already has a better result here', created: 'is on the ladder' }[r.kind];
    message = { text: `${r.player} ${what}.`, ok: r.kind !== 'kept', neutral: r.kind === 'kept' };
    paste = '';
  }

  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const gap = (ms: number | null) => (ms === null || leader === null ? '' : ms === leader ? '' : `+${((ms - leader) / 1000).toFixed(1)}s`);
  const slowest = $derived(Math.max(...rows.map((r) => r.entry.bestLapMs ?? 0)));
  /** Bar length: the leader's lap fills the bar's base share, slower laps add the gap. */
  const bar = (ms: number | null) => (ms === null || !slowest || leader === null ? 0 : 55 + (45 * (ms - leader)) / Math.max(1, slowest - leader));
</script>

<section class="panel">
  <div class="head">
    <div>
      <h2>Ladder</h2>
      <p class="muted small">You and friends on this exact rotation and team, ranked by best clean lap.</p>
    </div>
    <div class="actions">
      <button class:on={mode === 'share'} onclick={() => open('share')}>Share my result</button>
      <button class:on={mode === 'add'} onclick={() => open('add')}>Add a friend's result</button>
    </div>
  </div>

  {#if mode === 'share'}
    <div class="drawer">
      {#if !own}
        <p class="muted">Finish at least one lap on this rotation to have a result to share.</p>
      {:else}
        <label class="name">
          <span class="muted small">Your name on friends' ladders</span>
          <input bind:value={name} maxlength="32" placeholder="e.g. Mante" />
        </label>
        {#if code}
          <textarea readonly rows="3" value={code} onfocus={(e) => e.currentTarget.select()}></textarea>
          <div class="row">
            <span class="muted small">
              Your best run: {secs(own.bestLapMs)} best clean lap, {pct(own.accuracy)} accuracy. The code carries the loadout too, so friends without it can
              import it from the home screen.
            </span>
            <button class="primary" onclick={copy}>{copied ? 'Copied' : 'Copy code'}</button>
          </div>
        {:else}
          <p class="muted small">Enter a name to get your code.</p>
        {/if}
      {/if}
    </div>
  {:else if mode === 'add'}
    <div class="drawer">
      <textarea rows="3" bind:value={paste} placeholder="Paste the GTW-RESULT:… code a friend sent you" spellcheck="false"></textarea>
      <div class="row">
        {#if message}<span class="small" class:error={!message.ok && !message.neutral} class:ok={message.ok} class:muted={message.neutral}>{message.text}</span>{:else}<span class="muted small">Only results on this same rotation and team are accepted.</span>{/if}
        <button class="primary" disabled={!paste.trim()} onclick={add}>Add to ladder</button>
      </div>
    </div>
  {/if}

  {#if rows.length}
    <div class="ladder" role="table" aria-label="Ladder">
      <div class="lrow lhead muted small" role="row">
        <span role="columnheader">#</span>
        <span role="columnheader">Player</span>
        <span role="columnheader">Best clean lap</span>
        <span role="columnheader" class="r">Accuracy</span>
        <span role="columnheader" class="r">Clean laps</span>
        <span role="columnheader" class="r">Played</span>
        <span></span>
      </div>
      {#each rows as r (r.mine ? '\u0000me' : r.entry.player)}
        <div class="lrow" class:mine={r.mine} class:top={r.rank === 1 && rows.length > 1} role="row">
          <span class="rank" role="cell">{r.rank}</span>
          <span class="player" role="cell">
            <b>{r.entry.player}</b>
            {#if r.mine}<span class="tag">you</span>{/if}
            {#if r.entry.mode === 'rhythm'}<span class="tag rhythm" title={r.entry.onBeat != null ? `${pct(r.entry.onBeat)} on the beat` : undefined}>♪ rhythm</span>{/if}
          </span>
          <span class="best" role="cell">
            {#if r.entry.bestLapMs !== null}
              <span class="lap-bar"><i style:width="{bar(r.entry.bestLapMs)}%"></i></span>
              <b>{secs(r.entry.bestLapMs)}</b>
              <small class="muted">{gap(r.entry.bestLapMs)}</small>
            {:else}
              <span class="muted small">no clean lap</span>
            {/if}
          </span>
          <span class="r num" role="cell">{pct(r.entry.accuracy)}</span>
          <span class="r num" role="cell">{r.entry.cleanLaps}/{r.entry.laps}</span>
          <span class="r muted small" role="cell">{day(r.entry.date)}</span>
          <span class="r" role="cell">
            {#if !r.mine}
              <button class="ghost" title="Remove {r.entry.player} from this ladder" aria-label="Remove {r.entry.player}" onclick={() => removeLadderEntry(id, r.entry.player)}>×</button>
            {/if}
          </span>
        </div>
      {/each}
    </div>
    {#if !friends}
      <p class="muted small">Just you so far. Share your code with friends who play this loadout and add theirs when they send it back.</p>
    {/if}
  {:else}
    <p class="muted">Nobody is on this ladder yet. Finish a lap to get on it, then share your code with friends who play the same loadout.</p>
  {/if}
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
  }
  .head p {
    margin: 2px 0 0;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions .on {
    border-color: var(--accent);
  }
  .drawer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 8px;
    background: var(--panel-2);
  }
  .drawer textarea {
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    word-break: break-all;
  }
  .drawer .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .name {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 280px;
  }
  .ok {
    color: var(--ok);
  }
  .ladder {
    display: flex;
    flex-direction: column;
  }
  .lrow {
    display: grid;
    grid-template-columns: 28px minmax(120px, 1.2fr) minmax(160px, 1.6fr) 70px 70px 64px 28px;
    gap: 12px;
    align-items: center;
    padding: 9px 8px;
    border-bottom: 1px solid #20242f;
    border-radius: 6px;
  }
  .lrow:last-child {
    border-bottom: 0;
  }
  .lhead {
    padding-top: 0;
  }
  .lrow.mine {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .r {
    text-align: right;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .rank {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    text-align: center;
  }
  .top .rank {
    color: #f2c14e;
  }
  .player {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .player b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    flex: none;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--panel-2);
    color: var(--muted);
  }
  .tag.rhythm {
    color: #c4b5fd;
  }
  .best {
    display: flex;
    align-items: center;
    gap: 8px;
    font-variant-numeric: tabular-nums;
  }
  .lap-bar {
    flex: 1;
    height: 6px;
    border-radius: 99px;
    background: var(--panel-2);
    overflow: hidden;
    min-width: 40px;
  }
  .lap-bar i {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: var(--accent);
  }
  .top .lap-bar i {
    background: #f2c14e;
  }
  .best small {
    width: 40px;
  }
  .ghost {
    padding: 0 6px;
    background: transparent;
    border-color: transparent;
    color: var(--muted);
    opacity: 0;
  }
  .lrow:hover .ghost,
  .ghost:focus-visible {
    opacity: 1;
  }
  @media (max-width: 640px) {
    .lhead {
      display: none;
    }
    .lrow {
      grid-template-columns: 24px 1fr auto 28px;
      grid-template-areas: 'rank player acc x' 'rank lap lap lap';
      row-gap: 4px;
    }
    .rank {
      grid-area: rank;
    }
    .player {
      grid-area: player;
    }
    .best {
      grid-area: lap;
    }
    .lrow > :nth-child(4) {
      grid-area: acc;
    }
    .lrow > :nth-child(5),
    .lrow > :nth-child(6) {
      display: none;
    }
    .lrow > :nth-child(7) {
      grid-area: x;
    }
    .ghost {
      opacity: 1;
    }
    .drawer .row {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
