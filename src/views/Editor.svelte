<script lang="ts">
  import Avatar from '../components/Avatar.svelte';
  import CharacterPicker from '../components/CharacterPicker.svelte';
  import { findLoadout, go, saveLoadout } from '../lib/app.svelte';
  import { newLoadout } from '../lib/defaults';
  import { NOTATION_HELP } from '../lib/examples';
  import { charName, formatRotation, parseRotation, stepLabel } from '../lib/notation';
  import { rosterById } from '../lib/roster';
  import type { Character, Loadout, Slot, StepAction } from '../lib/types';

  let { id }: { id: string } = $props();

  // svelte-ignore state_referenced_locally -- the parent re-creates this view per loadout
  const source = findLoadout(id);
  // svelte-ignore state_referenced_locally
  let draft = $state<Loadout>(source ? { loopStart: 0, rotationSec: null, ...$state.snapshot(source) } : { ...newLoadout(), id });
  let slot = $state<Slot>(0);
  let naCount = $state(3);
  /** Which part new actions go to when the rotation has an opener. */
  let part = $state<'opener' | 'loop'>('loop');
  let picking = $state<number | null>(null);
  let text = $state(fmt());
  let textErrors = $state<string[]>([]);
  let textFocused = false;

  const SLOTS: Slot[] = [0, 1, 2, 3];
  const ACTIONS: { action: StepAction; label: string; hint: string }[] = [
    { action: 'skill', label: 'E', hint: 'Elemental skill, tap' },
    { action: 'skillHold', label: 'Hold E', hint: 'Elemental skill, hold' },
    { action: 'burst', label: 'Q', hint: 'Elemental burst' },
    { action: 'ca', label: 'CA', hint: 'Charged attack' },
    { action: 'dash', label: 'Dash', hint: 'Dash' },
    { action: 'jump', label: 'Jump', hint: 'Jump' },
  ];

  const loopStart = $derived(draft.loop ? Math.min(draft.loopStart ?? 0, draft.steps.length) : 0);
  const hasOpener = $derived(loopStart > 0);

  function groupsOf(from: number, to: number) {
    const out: { slot: Slot; items: { index: number; label: string }[] }[] = [];
    for (let index = from; index < to; index++) {
      const s = draft.steps[index];
      if (!out.length || out[out.length - 1].slot !== s.slot) out.push({ slot: s.slot, items: [] });
      out[out.length - 1].items.push({ index, label: stepLabel(s.action, s.count ?? 1) });
    }
    return out;
  }
  const openerGroups = $derived(groupsOf(0, loopStart));
  const loopGroups = $derived(groupsOf(loopStart, draft.steps.length));

  function fmt() {
    return formatRotation(draft.steps, draft.characters, draft.loop ? (draft.loopStart ?? 0) : 0, null);
  }

  function syncText() {
    if (textFocused) return;
    text = fmt();
    textErrors = [];
  }

  function add(action: StepAction) {
    const step = action === 'na' ? { slot, action, count: naCount } : { slot, action };
    if (hasOpener && part === 'opener') {
      draft.steps.splice(loopStart, 0, step);
      draft.loopStart = loopStart + 1;
    } else draft.steps.push(step);
    syncText();
  }

  function remove(index: number) {
    draft.steps.splice(index, 1);
    if (index < loopStart) draft.loopStart = loopStart - 1;
    syncText();
  }

  function setOpener(on: boolean) {
    if (on) {
      // Start the opener as a copy of the first lap; players usually tweak a few steps.
      draft.steps = [...draft.steps.map((s) => ({ ...s })), ...draft.steps.map((s) => ({ ...s }))];
      draft.loopStart = draft.steps.length / 2;
      part = 'opener';
    } else {
      draft.steps = draft.steps.slice(loopStart);
      draft.loopStart = 0;
      part = 'loop';
    }
    syncText();
  }

  function onText() {
    const r = parseRotation(text, draft.characters);
    textErrors = r.errors;
    if (r.errors.length) return;
    draft.steps = r.steps;
    draft.loopStart = r.loopStart;
    // Names typed that were not in the team fill its empty slots.
    r.characters.forEach((c, i) => {
      if (!draft.characters[i].name && c.name) draft.characters[i] = c;
    });
    if (r.rotationSec) draft.rotationSec = r.rotationSec;
  }

  function setMember(i: number, c: Character) {
    draft.characters[i] = c;
    picking = null;
    syncText();
  }

  function clearMember(i: number) {
    draft.characters[i] = { name: '', element: 'none' };
    syncText();
  }

  /** Swaps two slots and keeps the rotation pointing at the same characters. */
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j > 3) return;
    const cs = draft.characters;
    [cs[i], cs[j]] = [cs[j], cs[i]];
    for (const s of draft.steps) {
      if (s.slot === i) s.slot = j as Slot;
      else if (s.slot === j) s.slot = i as Slot;
    }
    syncText();
  }

  function save() {
    const out = $state.snapshot(draft) as Loadout;
    if (!out.loop) out.loopStart = 0;
    saveLoadout(out);
    go({ name: 'home' });
  }
</script>

<header class="bar">
  <button onclick={() => go({ name: 'home' })}>Cancel</button>
  <h1>{source ? 'Edit loadout' : 'New loadout'}</h1>
  <div class="spacer"></div>
  <button class="primary" disabled={textErrors.length > 0} onclick={save}>Save</button>
</header>

<main class="page narrow">
  <section class="panel">
    <div class="form">
      <label class="field">
        <span>Loadout name</span>
        <input bind:value={draft.name} maxlength="80" />
      </label>
      <label class="field">
        <span>Rotation time (seconds)</span>
        <input
          type="number"
          min="1"
          max="600"
          step="0.5"
          placeholder="e.g. 20 — leave empty if you do not time it"
          value={draft.rotationSec ?? ''}
          oninput={(e) => {
            const v = Number(e.currentTarget.value);
            draft.rotationSec = e.currentTarget.value && v > 0 ? v : null;
          }}
        />
      </label>
    </div>
    <p class="muted small">The rotation time is how long one lap should take. Runs show a pace bar against it, and the metrics compare every lap to it.</p>
  </section>

  <section class="panel">
    <h2>Team</h2>
    <p class="muted">Click a slot to search for a character. Same order as in game: slot 1 is the character on key 1.</p>
    <div class="team">
      {#each draft.characters as c, i (i)}
        {@const r = rosterById(c.id)}
        {#if c.name}
          <div class="member el-{c.element}" role="button" tabindex="0" onclick={() => (picking = i)} onkeydown={(e) => e.key === 'Enter' && (picking = i)}>
            <Avatar character={c} size={72} slot={i + 1} />
            <span class="nm">{c.name}</span>
            <span class="meta">{r ? `${c.element} · ${r.weapon}` : 'Custom'}</span>
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="tools" onclick={(e) => e.stopPropagation()}>
              <button class="ghost" title="Move left" disabled={i === 0} onclick={() => move(i, -1)}>‹</button>
              <button class="ghost" title="Move right" disabled={i === 3} onclick={() => move(i, 1)}>›</button>
              <button class="ghost" title="Remove" onclick={() => clearMember(i)}>×</button>
            </div>
          </div>
        {:else}
          <button class="member empty" onclick={() => (picking = i)}>
            <span class="plus">+</span>
            <span>Choose character</span>
            <span class="muted small">slot {i + 1}</span>
          </button>
        {/if}
      {/each}
    </div>
  </section>

  <section class="panel">
    <div class="row">
      <h2>Rotation</h2>
      <div class="spacer"></div>
      <label class="check small">
        <input type="checkbox" bind:checked={draft.loop} onchange={syncText} />
        <span>Loop</span>
      </label>
      {#if draft.loop}
        <label class="check small" title="A first rotation that differs from the ones after it">
          <input type="checkbox" checked={hasOpener} disabled={!draft.steps.length && !hasOpener} onchange={(e) => setOpener(e.currentTarget.checked)} />
          <span>Different first rotation</span>
        </label>
      {/if}
    </div>
    <p class="muted">Pick a character, then add their actions in order. Swaps are added for you.</p>

    <div class="palette">
      {#if hasOpener}
        <div class="tabs" role="tablist">
          <button class:on={part === 'opener'} onclick={() => (part = 'opener')}>Add to first rotation</button>
          <button class:on={part === 'loop'} onclick={() => (part = 'loop')}>Add to loop</button>
        </div>
      {/if}
      <div class="seg">
        {#each SLOTS as s (s)}
          <button class="el-{draft.characters[s].element} who-btn" class:on={slot === s} onclick={() => (slot = s)}>
            <Avatar character={draft.characters[s]} size={26} /><span class="n">{charName(draft.characters, s)}</span>
          </button>
        {/each}
      </div>
      <div class="row wrap">
        {#each ACTIONS.slice(0, 3) as a (a.action)}
          <button title={a.hint} onclick={() => add(a.action)}>{a.label}</button>
        {/each}
        <span class="combo">
          <button title="Normal attacks" onclick={() => add('na')}>N{naCount}</button>
          <input type="number" min="1" max="9" bind:value={naCount} aria-label="Number of normal attacks" />
        </span>
        {#each ACTIONS.slice(3) as a (a.action)}
          <button title={a.hint} onclick={() => add(a.action)}>{a.label}</button>
        {/each}
      </div>
    </div>

    {#snippet sequence(groups: ReturnType<typeof groupsOf>)}
      <div class="sequence">
        {#each groups as g, gi (gi)}
          <div class="block el-{draft.characters[g.slot].element}">
            <Avatar character={draft.characters[g.slot]} size={30} slot={g.slot + 1} />
            <div class="chips">
              {#each g.items as it (it.index)}
                <button class="chip removable" title="Remove" onclick={() => remove(it.index)}>{it.label}<span class="x">×</span></button>
              {/each}
            </div>
          </div>
        {:else}
          <p class="muted">Nothing here yet.</p>
        {/each}
      </div>
    {/snippet}

    {#if hasOpener}
      <span class="part-label">First rotation</span>
      {@render sequence(openerGroups)}
      <span class="part-label loop">↻ Every rotation after</span>
    {/if}
    {@render sequence(loopGroups)}

    <label class="field">
      <span>Or type it — same notation as Hexenzirkel and KQM</span>
      <textarea
        rows="3"
        bind:value={text}
        oninput={onText}
        onfocus={() => (textFocused = true)}
        onblur={() => {
          textFocused = false;
          if (!textErrors.length) syncText();
        }}
        placeholder="Raiden E > Xingqiu EQ > Bennett QE > Xiangling QE > Raiden Q N3C N3C"
        spellcheck="false"
      ></textarea>
    </label>
    {#each textErrors as err (err)}<p class="error">{err}</p>{/each}
    <div class="cheats">
      {#each NOTATION_HELP as [k, v] (k)}<span><code>{k}</code>{v}</span>{/each}
    </div>
    <p class="muted small">
      Write a name (or nickname, or 1–4) followed by its actions, e.g. <code>Bennett QE</code>. Start lines with <code>1st rotation:</code> and
      <code>2nd onwards:</code> for a first rotation that differs. Have a rotation from a leaderboard, gcsim or Genshin Optimizer? Use
      <b>Import</b> on the home screen — it has examples and says where to find each one.
    </p>
  </section>
</main>

{#if picking !== null}
  <CharacterPicker team={draft.characters} slot={picking} onpick={(c) => picking !== null && setMember(picking, c)} onclose={() => (picking = null)} />
{/if}
