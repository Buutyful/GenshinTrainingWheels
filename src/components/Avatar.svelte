<script lang="ts">
  import { portraitUrl } from '../lib/roster';
  import type { Character } from '../lib/types';

  interface Props {
    character: Character | undefined;
    size?: number;
    /** Slot number shown in the corner (1-4). */
    slot?: number;
    dim?: boolean;
  }
  let { character, size = 32, slot, dim = false }: Props = $props();

  const url = $derived(portraitUrl(character?.id));
  const initials = $derived(
    (character?.name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?',
  );
</script>

<span class="avatar el-{character?.element ?? 'none'}" class:dim style:--size="{size}px" title={character?.name || undefined}>
  {#if url}
    <img src={url} alt="" draggable="false" loading="lazy" />
  {:else}
    <span class="initials">{initials}</span>
  {/if}
  {#if slot}<span class="slot">{slot}</span>{/if}
</span>

<style>
  .avatar {
    position: relative;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 28%;
    background: color-mix(in srgb, var(--el) 22%, var(--panel-2));
    display: inline-grid;
    place-items: center;
    overflow: visible;
  }
  img {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    object-fit: cover;
  }
  .initials {
    font-weight: 700;
    font-size: calc(var(--size) * 0.36);
    color: var(--el);
  }
  .slot {
    position: absolute;
    right: -4px;
    bottom: -4px;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    border-radius: 5px;
    background: var(--bg);
    color: var(--text);
    font-size: 10.5px;
    font-weight: 700;
    display: grid;
    place-items: center;
    box-shadow: 0 0 0 2px var(--bg);
  }
  .dim {
    opacity: 0.45;
    filter: grayscale(0.6);
  }
</style>
