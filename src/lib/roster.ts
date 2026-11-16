import data from './roster.json';
import type { Element } from './types';

export interface RosterEntry {
  /** File name of the portrait, also the stable id saved in loadouts. */
  id: string;
  name: string;
  /** Genshin Optimizer / gcsim key, e.g. `RaidenShogun`. */
  key: string;
  element: Element;
  weapon: string;
  rarity: number;
  aliases: string[];
  /** Version a not-yet-released character is expected in. */
  upcoming?: string;
}

export const ROSTER: RosterEntry[] = data as RosterEntry[];
const BY_ID = new Map(ROSTER.map((c) => [c.id, c]));

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');

export function portraitUrl(id: string | undefined): string | null {
  return id && BY_ID.has(id) ? `${import.meta.env.BASE_URL}portraits/${id}.png` : null;
}

export function rosterById(id: string | undefined): RosterEntry | undefined {
  return id ? BY_ID.get(id) : undefined;
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** How well a query names a character; 0 means not at all. */
function score(c: RosterEntry, q: string): number {
  if (!q) return 1;
  const name = norm(c.name);
  const words = c.name.toLowerCase().split(/[\s()]+/).map(norm).filter(Boolean);
  if (name === q || norm(c.key) === q) return 100;
  if (c.aliases.includes(q)) return 90;
  if (words.includes(q)) return 85;
  if (name.startsWith(q)) return 70;
  if (words.some((w) => w.startsWith(q)) || c.aliases.some((a) => a.startsWith(q))) return 60;
  if (q.length >= 3 && name.includes(q)) return 40;
  if (q.length >= 4 && [name, ...words, ...c.aliases].some((w) => distance(w, q) <= (q.length >= 6 ? 2 : 1))) return 20;
  return 0;
}

export function searchRoster(query: string, limit = 200): RosterEntry[] {
  const q = norm(query);
  return ROSTER.map((c) => ({ c, s: score(c, q) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((r) => r.c);
}

/** The character a name, alias, gcsim or GO key refers to, if it is unambiguous enough. */
export function resolveCharacter(text: string): RosterEntry | undefined {
  const q = norm(text);
  if (!q) return undefined;
  const best = searchRoster(q, 2);
  if (!best.length) return undefined;
  const s0 = score(best[0], q);
  const s1 = best[1] ? score(best[1], q) : 0;
  return s0 >= 60 || (s0 > s1 && s0 >= 20) ? best[0] : undefined;
}
