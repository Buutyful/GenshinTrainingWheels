<script lang="ts">
  import { findLoadout, go, saveLoadout } from '../lib/app.svelte';
  import { newLoadout } from '../lib/defaults';
  import { charName, formatRotation, parseRotation, stepLabel } from '../lib/notation';
  import type { Element, Loadout, Slot, StepAction } from '../lib/types';

  let { id }: { id: string } = $props();

  // svelte-ignore state_referenced_locally -- the parent re-creates this view per loadout
  const source = findLoadout(id);
  // svelte-ignore state_referenced_locally
  let draft = $state<Loadout>(source ? $state.snapshot(source) : { ...newLoadout(), id });
  let slot = $state<Slot>(0);
  let naCount = $state(3);
  let text = $state(formatRotation(draft.steps, draft.characters));
  let textErrors = $state<string[]>([]);
  let textFocused = false;

  const ELEMENTS: Element[] = ['none', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'];
  const SLOTS: Slot[] = [0, 1, 2, 3];
  const ACTIONS: { action: StepAction; label: string; hint: string }[] = [
    { action: 'skill', label: 'E', hint: 'Elemental skill, tap' },
    { action: 'skillHold', label: 'Hold E', hint: 'Elemental skill, hold' },
    { action: 'burst', label: 'Q', hint: 'Elemental burst' },
    { action: 'ca', label: 'CA', hint: 'Charged attack' },
    { action: 'dash', label: 'Dash', hint: 'Dash' },
    { action: 'jump', label: 'Jump', hint: 'Jump' },
  ];

  const groups = $derived.by(() => {
    const out: { slot: Slot; items: { index: number; label: string }[] }[] = [];
    draft.steps.forEach((s, index) => {
      if (!out.length || out[out.length - 1].slot !== s.slot) out.push({ slot: s.slot, items: [] });
      out[out.length - 1].items.push({ index, label: stepLabel(s.action, s.count ?? 1) });
    });
    return out;
  });

  function syncText() {
    if (textFocused) return;
    text = formatRotation(draft.steps, draft.characters);
    textErrors = [];
  }

  function add(action: StepAction) {
    draft.steps.push(action === 'na' ? { slot, action, count: naCount } : { slot, action });
    syncText();
  }

  function remove(index: number) {
    draft.steps.splice(index, 1);
    syncText();
  }

  function onText() {
    const r = parseRotation(text, draft.characters);
    textErrors = r.errors;
    if (!r.errors.length) draft.steps = r.steps;
  }

  function save() {
    saveLoadout($state.snapshot(draft));
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
    <label class="field">
      <span>Loadout name</span>
      <input bind:value={draft.name} maxlength="80" />
    </label>
  </section>

  <section class="panel">
    <h2>Team</h2>
    <p class="muted">Same order as in game: slot 1 is the character on key 1.</p>
    <div class="team">
      {#each draft.characters as c, i (i)}
        <div class="member el-{c.element}">
          <span class="key">{i + 1}</span>
          <input bind:value={c.name} placeholder="Character name" maxlength="40" oninput={syncText} />
          <select bind:value={c.element} aria-label="Element">
            {#each ELEMENTS as el (el)}<option value={el}>{el === 'none' ? 'Element' : el[0].toUpperCase() + el.slice(1)}</option>{/each}
          </select>
        </div>
      {/each}
    </div>
  </section>

  <section class="panel">
    <h2>Rotation</h2>
    <p class="muted">Pick a character, then add their actions in order. Swaps are added for you.</p>

    <div class="palette">
      <div class="seg">
        {#each SLOTS as s (s)}
          <button class="el-{draft.characters[s].element} who-btn" class:on={slot === s} onclick={() => (slot = s)}>
            <span class="key">{s + 1}</span>{charName(draft.characters, s)}
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

    <div class="sequence">
      {#each groups as g, gi (gi)}
        <div class="block el-{draft.characters[g.slot].element}">
          <div class="who"><span class="key">{g.slot + 1}</span>{charName(draft.characters, g.slot)}</div>
          <div class="chips">
            {#each g.items as it (it.index)}
              <button class="chip removable" title="Remove" onclick={() => remove(it.index)}>{it.label}<span class="x">Ã—</span></button>
            {/each}
          </div>
        </div>
      {:else}
        <p class="muted">Nothing here yet.</p>
      {/each}
    </div>

    <label class="field">
      <span>Or type it</span>
      <textarea
        rows="3"
        bind:value={text}
        oninput={onText}
        onfocus={() => (textFocused = true)}
        onblur={() => {
          textFocused = false;
          if (!textErrors.length) syncText();
        }}
        placeholder="Raiden: E > Xingqiu: E Q > Bennett: Q E > Raiden: Q N3 CA"
        spellcheck="false"
      ></textarea>
    </label>
    {#each textErrors as err (err)}<p class="error">{err}</p>{/each}
    <p class="muted small">
      Characters by name or slot number. Actions: E, hE (hold), Q, N1â€“N9, CA, N2C, Dash, Jump. Separate characters with &gt;.
    </p>

    <label class="check">
      <input type="checkbox" bind:checked={draft.loop} />
      <span>Loop â€” after the last step the rotation starts again</span>
    </label>
  </section>
</main>
