// Local ladders: friends share their best run on a loadout as a text code; importing it ranks
// them against you, but only when the code was played on exactly the same rotation and team.
// Codes are not signed: this is for friends comparing notes, not a tamper-proof leaderboard.

import { newId, newLoadout } from './defaults';
import { onBeat } from './rhythm';
import { resolveCharacter, rosterById } from './roster';
import { timingSig } from './timing';
import type { Character, LadderEntry, Loadout, RotationStep, SessionSummary } from './types';

export const CODE_PREFIX = 'GTW-RESULT:';
const ACTIONS = new Set(['skill', 'skillHold', 'burst', 'na', 'ca', 'dash', 'jump']);

export interface SharedResult {
  loadout: Pick<Loadout, 'name' | 'characters' | 'steps' | 'loop' | 'loopStart' | 'rotationSec'>;
  entry: LadderEntry;
}

export const loadoutSig = (l: Pick<Loadout, 'steps' | 'loop' | 'loopStart'>) => timingSig(l.steps, l.loop, l.loop ? (l.loopStart ?? 0) : 0);

/** Identifies the rotation (actions, order, opener) and the character in every slot. */
export function ladderKey(l: Pick<Loadout, 'steps' | 'loop' | 'loopStart' | 'characters'>): string {
  // Through the roster, so "raiden", "Raiden" and "Raiden Shogun" are the same character
  // whatever roster version or spelling each player has.
  const who = l.characters
    .map((c) => rosterById(c.id)?.id ?? (c.name.trim() ? resolveCharacter(c.name)?.id : undefined) ?? c.name.trim().toLowerCase())
    .join('/');
  return `${loadoutSig(l)}#${who}`;
}

export const sameLoadout = (a: SharedResult['loadout'], b: Loadout) => ladderKey(a) === ladderKey(b);

/** Better first: faster best clean lap, then higher accuracy, then more clean laps. */
export function compareEntries(a: LadderEntry, b: LadderEntry): number {
  if (a.bestLapMs !== b.bestLapMs) {
    if (a.bestLapMs === null) return 1;
    if (b.bestLapMs === null) return -1;
    return a.bestLapMs - b.bestLapMs;
  }
  return b.accuracy - a.accuracy || b.cleanLaps - a.cleanLaps;
}

export function entryFromRun(run: SessionSummary, player: string): LadderEntry {
  const rh = run.metrics?.rhythm;
  return {
    player,
    date: run.date,
    mode: rh ? 'rhythm' : 'practice',
    bestLapMs: run.bestLapMs,
    avgLapMs: run.avgLapMs,
    accuracy: run.accuracy,
    cleanLaps: run.cleanLaps,
    laps: run.laps,
    durationMs: run.durationMs,
    ...(rh ? { onBeat: onBeat(rh.counts) } : {}),
  };
}

/**
 * The player's best run on the loadout as it is now. Only runs whose metrics prove they were
 * played on this rotation count, and only runs with at least one finished lap.
 */
export function bestRun(l: Loadout): SessionSummary | null {
  const sig = loadoutSig(l);
  const runs = l.history.filter((h) => h.metrics?.steps.sig === sig && h.laps > 0);
  if (!runs.length) return null;
  return runs.reduce((best, h) => (compareEntries(entryFromRun(h, ''), entryFromRun(best, '')) < 0 ? h : best));
}

// ---------------------------------------------------------------- codes

/** Short checksum so a code damaged by copy and paste is caught instead of misread. */
function check(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const toB64 = (s: string) => {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function encodeResult(l: Loadout, entry: LadderEntry): string {
  const body = JSON.stringify({
    v: 1,
    loadout: {
      name: l.name,
      characters: l.characters.map(({ name, element, id }) => ({ name, element, ...(id ? { id } : {}) })),
      steps: l.steps.map(({ slot, action, count }) => ({ slot, action, ...(count ? { count } : {}) })),
      loop: l.loop,
      loopStart: l.loopStart ?? 0,
      rotationSec: l.rotationSec ?? null,
    },
    entry,
  });
  return `${CODE_PREFIX}${toB64(body)}.${check(body)}`;
}

export const looksLikeResult = (text: string) => text.trim().startsWith(CODE_PREFIX);

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function decodeResult(text: string): { result: SharedResult | null; error: string | null } {
  const t = text.trim().replace(/\s+/g, '');
  if (!t.startsWith(CODE_PREFIX)) return { result: null, error: 'This is not a result code.' };
  const [b64, sum] = t.slice(CODE_PREFIX.length).split('.');
  let body: string;
  try {
    body = fromB64(b64);
  } catch {
    return { result: null, error: 'The code is damaged: copy it again in full.' };
  }
  if (check(body) !== sum) return { result: null, error: 'The code is damaged or incomplete: copy it again in full.' };
  let p: { v?: number; loadout?: Record<string, unknown>; entry?: Record<string, unknown> };
  try {
    p = JSON.parse(body);
  } catch {
    return { result: null, error: 'The code cannot be read.' };
  }
  if (p.v !== 1 || !p.loadout || !p.entry) return { result: null, error: 'This code comes from a newer version of the app.' };

  const chars = Array.isArray(p.loadout.characters) ? (p.loadout.characters as Partial<Character>[]) : [];
  const steps = (Array.isArray(p.loadout.steps) ? (p.loadout.steps as Partial<RotationStep>[]) : []).filter(
    (s) => typeof s.slot === 'number' && s.slot >= 0 && s.slot <= 3 && ACTIONS.has(String(s.action)),
  ) as RotationStep[];
  if (chars.length !== 4 || !steps.length) return { result: null, error: 'The code has no complete loadout.' };
  const e = p.entry;
  const accuracy = num(e.accuracy);
  if (accuracy === null || typeof e.player !== 'string' || !e.player.trim()) return { result: null, error: 'The code has no result in it.' };

  return {
    error: null,
    result: {
      loadout: {
        name: String(p.loadout.name ?? 'Shared loadout').slice(0, 80),
        characters: chars.map((c) => ({
          name: String(c.name ?? '').slice(0, 40),
          element: (c.element ?? 'none') as Character['element'],
          ...(c.id ? { id: String(c.id) } : {}),
        })),
        steps: steps.map((s) => ({ slot: s.slot, action: s.action, ...(s.count ? { count: Math.max(1, Math.min(9, Number(s.count) || 1)) } : {}) })),
        loop: p.loadout.loop !== false,
        loopStart: Math.max(0, Math.min(Number(p.loadout.loopStart) || 0, steps.length)),
        rotationSec: num(p.loadout.rotationSec),
      },
      entry: {
        player: e.player.trim().slice(0, 32),
        date: num(e.date) ?? Date.now(),
        mode: e.mode === 'rhythm' ? 'rhythm' : 'practice',
        bestLapMs: num(e.bestLapMs),
        avgLapMs: num(e.avgLapMs),
        accuracy: Math.max(0, Math.min(1, accuracy)),
        cleanLaps: Math.max(0, num(e.cleanLaps) ?? 0),
        laps: Math.max(0, num(e.laps) ?? 0),
        durationMs: Math.max(0, num(e.durationMs) ?? 0),
        ...(e.mode === 'rhythm' ? { onBeat: num(e.onBeat) } : {}),
      },
    },
  };
}

// ---------------------------------------------------------------- ladder

export type MergeOutcome = 'added' | 'improved' | 'kept';

/**
 * Adds a friend's entry; one entry per player name, keeping whichever run is better.
 * Returns the new list and what happened.
 */
export function mergeEntry(ladder: LadderEntry[], entry: LadderEntry): { ladder: LadderEntry[]; outcome: MergeOutcome } {
  const key = entry.player.trim().toLowerCase();
  const i = ladder.findIndex((e) => e.player.trim().toLowerCase() === key);
  if (i < 0) return { ladder: [...ladder, entry], outcome: 'added' };
  if (compareEntries(entry, ladder[i]) < 0) return { ladder: ladder.map((e, k) => (k === i ? entry : e)), outcome: 'improved' };
  return { ladder, outcome: 'kept' };
}

export interface Ranked {
  entry: LadderEntry;
  mine: boolean;
  rank: number;
}

/** Friends' entries still valid for the loadout as it is now. */
export function ladderFor(l: Loadout): LadderEntry[] {
  const key = ladderKey(l);
  return (l.ladder ?? []).filter((e) => e.key === key);
}

/** Friends' entries plus the player's own best run, best first. */
export function ranking(l: Loadout, me: string): Ranked[] {
  const own = bestRun(l);
  const rows = [
    ...ladderFor(l).map((entry) => ({ entry, mine: false })),
    ...(own ? [{ entry: entryFromRun(own, me || 'You'), mine: true }] : []),
  ].sort((a, b) => compareEntries(a.entry, b.entry));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** A new loadout built from a shared code, with the sender already on its ladder. */
export function loadoutFromResult(r: SharedResult): Loadout {
  return { ...newLoadout(), id: newId(), ...structuredClone(r.loadout), ladder: [{ ...r.entry, key: ladderKey(r.loadout) }] };
}
