import type { FlatStep } from './engine';

/** One character's turn in the rotation: the swap onto them and what they do. */
export interface Block {
  slot: number;
  /** Index of the implicit swap that starts the block, -1 when there is none. */
  swap: number;
  /** Every lap after the first starts at this block. */
  loopEntry: boolean;
  items: { step: FlatStep; index: number }[];
}

export function blocksOf(steps: FlatStep[]): Block[] {
  const out: Block[] = [];
  steps.forEach((step, index) => {
    let b = out[step.block];
    if (!b) b = out[step.block] = { slot: step.slot, swap: -1, loopEntry: false, items: [] };
    if (step.loopEntry) b.loopEntry = true;
    if (step.implicit) b.swap = index;
    else b.items.push({ step, index });
  });
  return out;
}
