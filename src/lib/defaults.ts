import type { AppData, Bindings, Character, Loadout, Settings } from './types';

export const DEFAULT_BINDINGS: Bindings = {
  swap1: ['Digit1'],
  swap2: ['Digit2'],
  swap3: ['Digit3'],
  swap4: ['Digit4'],
  skill: ['KeyE'],
  burst: ['KeyQ'],
  attack: ['Mouse0'],
  dash: ['Mouse2', 'ShiftLeft'],
  jump: ['Space'],
  burstMod: ['AltLeft'],
  hkRestart: ['F9'],
  hkStop: ['F10'],
};

export const DEFAULT_SETTINGS: Settings = {
  bindings: DEFAULT_BINDINGS,
  holdSkillMs: 300,
  holdAttackMs: 300,
  tracker: {
    maxSkip: 2,
    offTrackAfter: 3,
    repeatWindowMs: 1200,
    idleMs: 8000,
    policy: 'resync',
  },
  audio: {
    volume: 0.6,
    guidance: 'full',
    leadMs: 500,
    buildup: true,
    hesitateMs: 1500,
    feedback: true,
    hitTick: false,
  },
};

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function emptyCharacters(): Character[] {
  return [0, 1, 2, 3].map(() => ({ name: '', element: 'none' as const }));
}

export function newLoadout(): Loadout {
  return { id: newId(), name: 'New loadout', characters: emptyCharacters(), steps: [], loop: true, history: [] };
}

export function exampleLoadout(): Loadout {
  return {
    id: newId(),
    name: 'Raiden National (example)',
    characters: [
      { name: 'Raiden', element: 'electro' },
      { name: 'Xingqiu', element: 'hydro' },
      { name: 'Bennett', element: 'pyro' },
      { name: 'Xiangling', element: 'pyro' },
    ],
    steps: [
      { slot: 0, action: 'skill' },
      { slot: 1, action: 'skill' },
      { slot: 1, action: 'burst' },
      { slot: 2, action: 'burst' },
      { slot: 2, action: 'skill' },
      { slot: 3, action: 'burst' },
      { slot: 3, action: 'skill' },
      { slot: 0, action: 'burst' },
      { slot: 0, action: 'na', count: 3 },
      { slot: 0, action: 'ca' },
      { slot: 0, action: 'na', count: 3 },
      { slot: 0, action: 'ca' },
      { slot: 0, action: 'na', count: 3 },
      { slot: 0, action: 'ca' },
    ],
    loop: true,
    history: [],
  };
}

export function defaultData(): AppData {
  return { version: 1, loadouts: [], settings: structuredClone(DEFAULT_SETTINGS) };
}

/** Saved values for the keys this version knows; options that no longer exist are dropped. */
function known<T extends object>(base: T, saved: Partial<T> | undefined): T {
  const out = { ...base };
  for (const k of Object.keys(base) as (keyof T)[]) {
    if (saved && typeof saved[k] === typeof base[k]) out[k] = saved[k] as T[keyof T];
  }
  return out;
}

/**
 * Accepts whatever was saved earlier and fills in anything a newer version added.
 * Returns null when the saved text cannot be read, so the caller can keep a copy before
 * anything overwrites it.
 */
export function migrate(raw: string | null): AppData | null {
  const base = defaultData();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<AppData>;
    const s = (parsed.settings ?? {}) as Partial<Settings>;
    return {
      version: 1,
      loadouts: (parsed.loadouts ?? []).map((l) => ({
        ...newLoadout(),
        ...l,
        characters: [0, 1, 2, 3].map((i) => l.characters?.[i] ?? { name: '', element: 'none' as const }),
        history: l.history ?? [],
      })),
      settings: {
        ...base.settings,
        ...s,
        bindings: { ...base.settings.bindings, ...(s.bindings ?? {}) },
        tracker: { ...base.settings.tracker, ...(s.tracker ?? {}) },
        audio: known(base.settings.audio, s.audio),
      },
    };
  } catch {
    return null;
  }
}
