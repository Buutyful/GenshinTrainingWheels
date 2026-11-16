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

const TOKEN: Record<string, StepAction> = {
  e: 'skill',
  skill: 'skill',
  he: 'skillHold',
  ehold: 'skillHold',
  holde: 'skillHold',
  'e(hold)': 'skillHold',
  q: 'burst',
  burst: 'burst',
  n: 'na',
  na: 'na',
  c: 'ca',
  ca: 'ca',
  d: 'dash',
  dash: 'dash',
  j: 'jump',
  jump: 'jump',
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

function resolveSlot(token: string, characters: Character[]): Slot | null {
  const t = norm(token);
  if (/^[1-4]$/.test(t)) return (Number(t) - 1) as Slot;
  const names = characters.map((c) => norm(c.name));
  let i = names.findIndex((n) => n && n === t);
  if (i < 0) i = names.findIndex((n) => n && t.length >= 2 && n.startsWith(t));
  return i >= 0 ? (i as Slot) : null;
}

/** `Raiden: E > Xingqiu: E Q > 1: Q N3 CA` — one block per character, separated by `>` or new lines. */
export function formatRotation(steps: RotationStep[], characters: Character[]): string {
  const blocks: string[] = [];
  let slot: Slot | null = null;
  let cur: string[] = [];
  const flush = () => {
    if (slot === null) return;
    const name = characters[slot]?.name.trim();
    const usable = name && resolveSlot(name, characters) === slot && !name.includes(':');
    blocks.push(`${usable ? name : slot + 1}: ${cur.join(' ')}`);
  };
  for (const s of steps) {
    if (s.slot !== slot) {
      flush();
      slot = s.slot;
      cur = [];
    }
    cur.push(s.action === 'skillHold' ? 'hE' : stepLabel(s.action, s.count ?? 1));
  }
  flush();
  return blocks.join(' > ');
}

export interface ParseResult {
  steps: RotationStep[];
  errors: string[];
}

export function parseRotation(text: string, characters: Character[]): ParseResult {
  const steps: RotationStep[] = [];
  const errors: string[] = [];
  const blocks = text
    .split(/>|\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks) {
    let who: string;
    let rest: string;
    const colon = block.indexOf(':');
    if (colon >= 0) {
      who = block.slice(0, colon);
      rest = block.slice(colon + 1);
    } else {
      const m = block.match(/^(\S+)\s*(.*)$/)!;
      who = m[1];
      rest = m[2];
    }
    const slot = resolveSlot(who, characters);
    if (slot === null) {
      errors.push(`Unknown character "${who.trim()}" — use a team member's name or 1-4.`);
      continue;
    }
    for (const raw of rest.split(/[\s,]+/).filter(Boolean)) {
      const tok = raw.toLowerCase();
      const combo = tok.match(/^n(\d)?(c)?$/);
      if (combo && (combo[1] || combo[2])) {
        steps.push({ slot, action: 'na', count: Math.max(1, Number(combo[1] ?? 1)) });
        if (combo[2]) steps.push({ slot, action: 'ca' });
        continue;
      }
      const action = TOKEN[tok];
      if (!action) {
        errors.push(`Unknown action "${raw}" for ${who.trim()}.`);
        continue;
      }
      steps.push(action === 'na' ? { slot, action, count: 1 } : { slot, action });
    }
  }
  return { steps, errors };
}
