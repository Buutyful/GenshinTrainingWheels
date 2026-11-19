<script lang="ts">
  import { blocksOf } from '../lib/blocks';
  import type { FlatStep, StepStatus } from '../lib/engine';
  import { stepLabel } from '../lib/notation';
  import type { Character } from '../lib/types';
  import Avatar from './Avatar.svelte';

  interface Props {
    steps: FlatStep[];
    characters: Character[];
    statuses?: StepStatus[];
    pointer?: number;
    naClicks?: number;
    compact?: boolean;
  }
  let { steps, characters, statuses, pointer = -1, naClicks = 0, compact = false }: Props = $props();

  const blocks = $derived(blocksOf(steps));
  const currentBlock = $derived(pointer >= 0 ? steps[pointer]?.block : -1);
  const hasOpener = $derived(blocks.some((b) => b.loopEntry));
</script>

<div class="track" class:compact>
  {#if hasOpener}<span class="part-label">Opener</span>{/if}
  {#each blocks as b, bi (bi)}
    {#if b.loopEntry}<span class="part-label loop" title="Every lap after the first starts here">↻ Loop</span>{/if}
    {@const done = statuses && b.items.every((it) => statuses[it.index] === 'skipped')}
    <div
      class="block el-{characters[b.slot]?.element ?? 'none'}"
      class:active={bi === currentBlock}
      class:swap-now={b.swap >= 0 && b.swap === pointer}
      class:swap-missed={b.swap >= 0 && statuses?.[b.swap] === 'missed'}
      class:past={done}
    >
      <Avatar character={characters[b.slot]} size={compact ? 26 : 34} slot={b.slot + 1} />
      <div class="chips">
        {#each b.items as { step, index } (index)}
          <span class="chip st-{statuses?.[index] ?? 'pending'}" class:current={index === pointer}>
            {stepLabel(step.action, step.count)}{#if index === pointer && step.action === 'na' && step.count > 1}<small>{naClicks}/{step.count}</small>{/if}
          </span>
        {/each}
      </div>
    </div>
  {/each}
</div>
