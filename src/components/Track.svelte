<script lang="ts">
  import type { FlatStep, StepStatus } from '../lib/engine';
  import { charName, stepLabel } from '../lib/notation';
  import type { Character } from '../lib/types';

  interface Props {
    steps: FlatStep[];
    characters: Character[];
    statuses?: StepStatus[];
    pointer?: number;
    naClicks?: number;
    compact?: boolean;
    /** Show only the block the pointer is in. */
    currentOnly?: boolean;
  }
  let { steps, characters, statuses, pointer = -1, naClicks = 0, compact = false, currentOnly = false }: Props = $props();

  const blocks = $derived.by(() => {
    const out: { slot: number; swap: number; items: { step: FlatStep; index: number }[] }[] = [];
    steps.forEach((step, index) => {
      let b = out[step.block];
      if (!b) b = out[step.block] = { slot: step.slot, swap: -1, items: [] };
      if (step.implicit) b.swap = index;
      else b.items.push({ step, index });
    });
    return out;
  });
  const currentBlock = $derived(pointer >= 0 ? steps[pointer]?.block : -1);
</script>

<div class="track" class:compact>
  {#each blocks as b, bi (bi)}
    {#if !currentOnly || bi === currentBlock}
      <div
        class="block el-{characters[b.slot]?.element ?? 'none'}"
        class:active={bi === currentBlock}
        class:swap-now={b.swap >= 0 && b.swap === pointer}
        class:swap-missed={b.swap >= 0 && statuses?.[b.swap] === 'missed'}
      >
        <div class="who">
          <span class="key">{b.slot + 1}</span>{charName(characters, b.slot as 0 | 1 | 2 | 3)}
        </div>
        <div class="chips">
          {#each b.items as { step, index } (index)}
            <span class="chip st-{statuses?.[index] ?? 'pending'}" class:current={index === pointer}>
              {stepLabel(step.action, step.count)}{#if index === pointer && step.action === 'na' && step.count > 1}<small>{naClicks}/{step.count}</small>{/if}
            </span>
          {/each}
        </div>
      </div>
    {/if}
  {/each}
</div>
