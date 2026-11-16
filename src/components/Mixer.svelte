<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app, go } from '../lib/app.svelte';
  import { AudioOut } from '../lib/audio';

  let { compactHidden = false }: { compactHidden?: boolean } = $props();

  const a = $derived(app.data.settings.audio);
  const music = $derived(app.data.settings.music);
  let open = $state(false);
  let root = $state<HTMLElement | null>(null);

  /** Loudness the icon shows: what actually comes out of the speakers. */
  const level = $derived(a.muted ? 0 : a.master * Math.max(a.volume, music.volume));

  const pct = (v: number) => `${Math.round(v * 100)}`;

  function onDocDown(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
  function onKey(e: KeyboardEvent) {
    if (open && e.key === 'Escape') open = false;
  }
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey);

  /** Scrolling over a fader nudges it, like a hardware mixer's wheel. */
  function wheel(e: WheelEvent, set: (v: number) => void, v: number) {
    e.preventDefault();
    set(Math.max(0, Math.min(1, Math.round((v - Math.sign(e.deltaY) * 0.05) * 100) / 100)));
  }

  let tester: AudioOut | null = null;
  async function testCue() {
    tester ??= new AudioOut($state.snapshot(app.data.settings.audio));
    await tester.unlock();
    tester.sfx('lapClean');
  }

  onDestroy(() => {
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey);
    tester?.close();
  });
</script>

<div class="mixer" class:hide-compact={compactHidden} bind:this={root}>
  <button class="ghost icon" class:on={open} title="Volume" aria-label="Volume mixer" aria-expanded={open} onclick={() => (open = !open)}>
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
      {#if level === 0}
        <path d="M16 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />
      {:else}
        <path d="M15.2 9.2a4 4 0 0 1 0 5.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />
        {#if level > 0.33}<path d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />{/if}
        {#if level > 0.66}<path d="M20 4.4a10.8 10.8 0 0 1 0 15.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />{/if}
      {/if}
    </svg>
  </button>

  {#if open}
    <div class="pop" role="dialog" aria-label="Volume mixer">
      <div class="strips">
        <div class="strip master">
          <span class="val">{a.muted ? 'muted' : `${pct(a.master)}%`}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            aria-label="Master volume"
            bind:value={a.master}
            onwheel={(e) => wheel(e, (v) => (a.master = v), a.master)}
            class:dim={a.muted}
          />
          <span class="name">Master</span>
          <button class="mute" class:on={a.muted} onclick={() => (a.muted = !a.muted)}>{a.muted ? 'Unmute' : 'Mute'}</button>
        </div>
        <div class="strip">
          <span class="val">{pct(a.volume)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            aria-label="Cue volume"
            bind:value={a.volume}
            onwheel={(e) => wheel(e, (v) => (a.volume = v), a.volume)}
            class:dim={a.muted}
          />
          <span class="name">Cues</span>
          <button class="mute" onclick={testCue}>Test</button>
        </div>
        <div class="strip">
          <span class="val">{pct(music.volume)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            aria-label="Music volume"
            bind:value={music.volume}
            onwheel={(e) => wheel(e, (v) => (music.volume = v), music.volume)}
            class:dim={a.muted}
          />
          <span class="name">Music</span>
          <button
            class="mute"
            onclick={() => {
              open = false;
              go({ name: 'jam' });
            }}>Lab</button
          >
        </div>
      </div>
      <p class="hint">Drag or scroll a fader. Cues are the arcade sounds; music is the rhythm-mode track.</p>
    </div>
  {/if}
</div>

<style>
  .mixer { position: relative; }
  .icon { display: grid; place-items: center; padding: 5px 7px; }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    z-index: 20;
    width: 268px;
    padding: 14px 14px 10px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  }
  .strips { display: flex; justify-content: space-between; gap: 8px; }
  .strip { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 1; }
  .strip.master { border-right: 1px solid var(--line); padding-right: 8px; }
  .val { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text); min-height: 16px; }
  .name { font-size: 12px; color: var(--muted); font-weight: 600; }
  .strip.master .name { color: var(--accent); }
  input[type='range'] {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 28px;
    height: 150px;
    cursor: grab;
  }
  input[type='range']:active { cursor: grabbing; }
  input.dim { opacity: 0.4; }
  .mute { font-size: 12px; padding: 3px 8px; }
  .hint { margin-top: 10px; font-size: 11.5px; color: var(--muted); line-height: 1.35; }
</style>
