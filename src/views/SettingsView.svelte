<script lang="ts">
  import Mixer from '../components/Mixer.svelte';
  import { onDestroy } from 'svelte';
  import { app, go } from '../lib/app.svelte';
  import { AudioOut } from '../lib/audio';
  import type { Sfx } from '../lib/cues';
  import type { FlatStep } from '../lib/engine';
  import { nowMs } from '../lib/platform';
  import { DEFAULT_SETTINGS } from '../lib/defaults';
  import { GROOVE_CREDIT, STYLE_IDS, STYLES } from '../lib/music/band';
  import { prettyCode } from '../lib/keycodes';
  import type { ActionType, BindKey, Slot } from '../lib/types';

  const s = $derived(app.data.settings);

  const BINDS: { key: BindKey; label: string }[] = [
    { key: 'swap1', label: 'Character 1' },
    { key: 'swap2', label: 'Character 2' },
    { key: 'swap3', label: 'Character 3' },
    { key: 'swap4', label: 'Character 4' },
    { key: 'skill', label: 'Elemental skill' },
    { key: 'burst', label: 'Elemental burst' },
    { key: 'burstMod', label: 'Burst-on-swap modifier' },
    { key: 'attack', label: 'Attack' },
    { key: 'dash', label: 'Dash' },
    { key: 'jump', label: 'Jump' },
    { key: 'hkRestart', label: 'Restart run (hotkey)' },
    { key: 'hkStop', label: 'Stop run (hotkey)' },
  ];

  let capturing = $state<BindKey | null>(null);

  function assign(code: string) {
    if (!capturing) return;
    if (code !== 'Escape' && !s.bindings[capturing].includes(code)) s.bindings[capturing].push(code);
    capturing = null;
  }
  const onKey = (e: KeyboardEvent) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    assign(e.code);
  };
  const onMouse = (e: MouseEvent) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    assign(`Mouse${e.button}`);
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('mousedown', onMouse, true);

  const mk = (action: ActionType, slot: Slot = 0, count = 1): FlatStep => ({ action, slot, count, implicit: action === 'swap', src: -1, block: 0 });
  const CUES: { label: string; step: FlatStep }[] = [
    { label: 'Swap → 1', step: mk('swap', 0) },
    { label: 'Swap → 2', step: mk('swap', 1) },
    { label: 'Swap → 3', step: mk('swap', 2) },
    { label: 'Swap → 4', step: mk('swap', 3) },
    { label: 'E', step: mk('skill') },
    { label: 'Hold E', step: mk('skillHold') },
    { label: 'Q', step: mk('burst') },
    { label: 'N3', step: mk('na', 0, 3) },
    { label: 'CA', step: mk('ca') },
    { label: 'Dash', step: mk('dash') },
    { label: 'Jump', step: mk('jump') },
  ];
  const FEEDBACK: { label: string; sfx: Sfx }[] = [
    { label: 'Mistake', sfx: 'error' },
    { label: 'Off track', sfx: 'offtrack' },
    { label: 'Back on track', sfx: 'resync' },
    { label: 'Lap', sfx: 'lap' },
    { label: 'Clean lap', sfx: 'lapClean' },
  ];

  // One synth for all previews; its settings object is refreshed before every sound.
  const previewCfg = $state.snapshot(app.data.settings.audio);
  const preview = new AudioOut(previewCfg);
  async function ready() {
    Object.assign(previewCfg, $state.snapshot(s.audio));
    await preview.unlock();
  }
  async function playCue(step: FlatStep, leadIn = false) {
    await ready();
    const now = nowMs();
    preview.cue(step, now, leadIn ? now + s.audio.leadMs : null);
  }
  async function playSfx(name: Sfx) {
    await ready();
    preview.sfx(name);
  }

  function reset() {
    app.data.settings = structuredClone(DEFAULT_SETTINGS);
  }

  onDestroy(() => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    preview.close();
  });
</script>

<header class="bar">
  <button onclick={() => go({ name: 'home' })}>Back</button>
  <h1>Settings</h1>
  <div class="spacer"></div>
  <Mixer />
  <button onclick={reset}>Reset to defaults</button>
</header>

<main class="page narrow">
  <section class="panel">
    <h2>Key bindings</h2>
    <p class="muted">Match these to your in-game controls. Each action can have several keys.</p>
    <div class="binds">
      {#each BINDS as b (b.key)}
        <div class="bind">
          <span>{b.label}</span>
          <div class="row wrap">
            {#each s.bindings[b.key] as code (code)}
              <button class="chip removable" title="Remove" onclick={() => (s.bindings[b.key] = s.bindings[b.key].filter((c) => c !== code))}>
                {prettyCode(code)}<span class="x">×</span>
              </button>
            {/each}
            <button class="ghost" class:on={capturing === b.key} onclick={() => (capturing = b.key)}>
              {capturing === b.key ? 'Press a key or button… (Esc cancels)' : '+ Add'}
            </button>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="panel">
    <h2>Audio cues</h2>
    <p class="muted">
      Cues play ahead of time, so you can hear them, understand them and still press on the beat. The timing follows your
      own rhythm: it starts from typical values and adjusts to your clean laps.
    </p>
    <div class="form">
      <label class="field">
        <span>Cue</span>
        <select bind:value={s.audio.guidance}>
          <option value="full">Every step, ahead of time</option>
          <option value="swaps">Character swaps only, ahead of time</option>
          <option value="adaptive">Only when I am late or slip</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label class="field">
        <span>Lead time · {s.audio.leadMs} ms before the key is due</span>
        <input type="range" min="200" max="1000" step="50" bind:value={s.audio.leadMs} />
      </label>
      <label class="field">
        <span>Repeat the cue when I am {(s.audio.hesitateMs / 1000).toFixed(1)}s late</span>
        <input type="range" min="500" max="4000" step="100" bind:value={s.audio.hesitateMs} />
      </label>
      <label class="field">
        <span>Volume · {Math.round(s.audio.volume * 100)}%</span>
        <input type="range" min="0" max="1" step="0.05" bind:value={s.audio.volume} />
      </label>
    </div>
    <label class="check"><input type="checkbox" bind:checked={s.audio.buildup} /><span>Build-up: a rising sweep from the cue to the moment to press</span></label>
    <label class="check"><input type="checkbox" bind:checked={s.audio.feedback} /><span>Sounds for mistakes, going off track, rejoining and finished laps</span></label>
    <label class="check"><input type="checkbox" bind:checked={s.audio.hitTick} /><span>Tick on every correct step</span></label>

    <h2>Sound guide</h2>
    <p class="muted">Learn the vocabulary: a swap climbs one note per slot, so slot 3 is three notes.</p>
    <div class="row wrap">
      {#each CUES as c (c.label)}<button onclick={() => playCue(c.step)}>{c.label}</button>{/each}
    </div>
    <div class="row wrap">
      {#each FEEDBACK as f (f.sfx)}<button class="ghost" onclick={() => playSfx(f.sfx)}>{f.label}</button>{/each}
      <div class="spacer"></div>
      <button onclick={() => playCue(CUES[2].step, true)}>Hear a cue with its build-up</button>
    </div>

    <h2>Rhythm mode music</h2>
    <p class="muted">
      Rhythm mode plays your rotation as cues over a band. The cues are the same in every style; pick the music you can listen
      to for a long time.
    </p>
    <div class="row wrap">
      <label class="field">
        <span>Style</span>
        <select bind:value={s.music.style} onchange={() => (s.music.groove = -1)}>
          {#each STYLE_IDS as id (id)}<option value={id}>{STYLES[id].label}</option>{/each}
        </select>
      </label>
      <div class="spacer"></div>
      <button onclick={() => go({ name: 'jam' })}>Open the Music lab</button>
    </div>
    <p class="muted small">{GROOVE_CREDIT}</p>
  </section>

  <section class="panel">
    <h2>Tracking</h2>
    <div class="form">
      <label class="field">
        <span>When you go off track</span>
        <select bind:value={s.tracker.policy}>
          <option value="resync">Rejoin at any character's block</option>
          <option value="restart">Wait until you restart from step one</option>
        </select>
      </label>
      <label class="field">
        <span>Off track after {s.tracker.offTrackAfter} wrong inputs in a row</span>
        <input type="range" min="1" max="8" step="1" bind:value={s.tracker.offTrackAfter} />
      </label>
      <label class="field">
        <span>Steps you may skip before an input counts as wrong · {s.tracker.maxSkip}</span>
        <input type="range" min="0" max="5" step="1" bind:value={s.tracker.maxSkip} />
      </label>
      <label class="field">
        <span>Pause after {(s.tracker.idleMs / 1000).toFixed(0)}s without input</span>
        <input type="range" min="3000" max="30000" step="1000" bind:value={s.tracker.idleMs} />
      </label>
      <label class="field">
        <span>Hold skill threshold · {s.holdSkillMs} ms</span>
        <input type="range" min="150" max="800" step="10" bind:value={s.holdSkillMs} />
      </label>
      <label class="field">
        <span>Charged attack threshold · {s.holdAttackMs} ms</span>
        <input type="range" min="150" max="800" step="10" bind:value={s.holdAttackMs} />
      </label>
    </div>
  </section>
</main>
