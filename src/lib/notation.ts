import { formatNotation, parseNotation, type ParsedRotation } from './formats';
import type { Character, RotationStep, Slot, StepAction } from './types';

export const ACTION_LABEL: Record<StepAction | 'swap', string> = {
  skill: 'E',
  skillHold: 'Hold E',
  burst: 'Q',
  na: 'N',
  ca: 'CA',
  dash: 'Dash',
  jump: 'Jump',
  swap: 'Swap',
};

export const ACTION_WORD: Record<StepAction | 'swap', string> = {
  skill: 'skill',
  skillHold: 'hold skill',
  burst: 'burst',
  na: 'attack',
  ca: 'charged',
  dash: 'dash',
  jump: 'jump',
  swap: 'swap',
};

export function stepLabel(action: StepAction | 'swap', count = 1): string {
  return action === 'na' ? `N${count}` : ACTION_LABEL[action];
}

export function charName(characters: Character[], slot: Slot): string {
  return characters[slot]?.name.trim() || `Slot ${slot + 1}`;
}

/** Rotation as text, in the KQM / Hexenzirkel notation (`Raiden E > Xingqiu EQ`). */
export function formatRotation(steps: RotationStep[], characters: Character[], loopStart = 0, rotationSec?: number | null): string {
  return formatNotation(steps, characters, loopStart, rotationSec);
}

export interface ParseResult {
  steps: RotationStep[];
  errors: string[];
}

/** Reads rotation text against an existing team (names, aliases or slot numbers 1-4). */
export function parseRotation(text: string, characters: Character[]): ParseResult & ParsedRotation {
  return parseNotation(text, characters);
}
