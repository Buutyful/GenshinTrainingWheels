/**
 * Rotation formats the community already uses, so a rotation can be pasted from wherever
 * it was written:
 *
 * - KQM / Hexenzirkel notation: `Odette EE > Yae EEE > Sucrose N1E > Mitya hECQC`, with
 *   optional `1st rotation:` / `2nd onwards:` lines, `3x[...]` repeats and `Rotation time: 72 s`.
 * - gcsim configs: `raiden char ...;`, `active raiden;`, `raiden skill, burst, attack:3;`
 *   with the loop body in `while` / `for` blocks.
 * - Genshin Optimizer multi-target JSON (what Hexenzirkel's "Export rotation" downloads): its
 *   `description` holds the rotation of one character in the same notation.
 * - This app's own JSON export.
 */
import { newLoadout } from './defaults';
import { norm, resolveCharacter, rosterById } from './roster';
import type { Character, Loadout, RotationStep, Slot, StepAction } from './types';

export interface ParsedRotation {
  characters: Character[];
  steps: RotationStep[];
  loopStart: number;
  rotationSec: number | null;
  name?: string;
  loop?: boolean;
  errors: string[];
  /** Things that were understood but dropped or guessed. */
  notes: string[];
}

type Tok = { action: StepAction; count?: number };

// ---------------------------------------------------------------- action notation

const WORDS: [string, Tok[] | null][] = [
  ['e(hold)', [{ action: 'skillHold' }]],
  ['holde', [{ action: 'skillHold' }]],
  ['ehold', [{ action: 'skillHold' }]],
  ['skill', [{ action: 'skill' }]],
  ['burst', [{ action: 'burst' }]],
  ['plunge', [{ action: 'jump' }, { action: 'na', count: 1 }]],
  ['dash', [{ action: 'dash' }]],
  ['jump', [{ action: 'jump' }]],
  ['walk', null],
  ['wait', null],
  ['aim', [{ action: 'ca' }]],
  ['he', [{ action: 'skillHold' }]],
  ['le', [{ action: 'skillHold' }]],
  ['te', [{ action: 'skill' }]],
  ['se', [{ action: 'skill' }]],
  ['ca', [{ action: 'ca' }]],
  ['hp', [{ action: 'jump' }, { action: 'na', count: 1 }]],
  ['lp', [{ action: 'jump' }, { action: 'na', count: 1 }]],
  ['e', [{ action: 'skill' }]],
  ['q', [{ action: 'burst' }]],
  ['c', [{ action: 'ca' }]],
  ['d', [{ action: 'dash' }]],
  ['j', [{ action: 'jump' }]],
  ['p', [{ action: 'jump' }, { action: 'na', count: 1 }]],
];

/** Reads `hECQC`, `N3C`, `E Q N2 CA`, `E(hold) Q`; null when something is not an action. */
export function lexActions(text: string): Tok[] | null {
  const s = text.toLowerCase().replace(/[\s,;.+]+/g, '');
  const out: Tok[] = [];
  let i = 0;
  outer: while (i < s.length) {
    // `N`, `NA`, `N3`, `A3`; a bare `a` is not an attack, so names do not lex as actions.
    const n = s.slice(i).match(/^na?(\d)?|^a(\d)/);
    if (n) {
      out.push({ action: 'na', count: Math.max(1, Number(n[1] ?? n[2] ?? 1)) });
      i += n[0].length;
      continue;
    }
    for (const [w, toks] of WORDS) {
      if (s.startsWith(w, i)) {
        if (toks) out.push(...toks.map((t) => ({ ...t })));
        i += w.length;
        continue outer;
      }
    }
    return null;
  }
  return out;
}

const label = (t: RotationStep) =>
  t.action === 'skillHold' ? 'hE' : t.action === 'na' ? `N${t.count ?? 1}` : { skill: 'E', burst: 'Q', ca: 'C', dash: 'D', jump: 'J' }[t.action];

/** Expands `3x[...]`, `[...]x3` and `(...)x3`. */
function expandRepeats(text: string): string {
  let prev = '';
  let s = text;
  // Repeated actions stay in one block; repeated blocks (they name someone) get separators.
  const rep = (inner: string, n: string) => Array(Math.min(20, Number(n))).fill(inner.trim()).join(lexActions(inner) ? ' ' : ' > ');
  while (prev !== s) {
    prev = s;
    s = s
      .replace(/(\d+)\s*[x×*]\s*[[(]([^[\]()]*)[\])]/gi, (_, n, inner) => rep(inner, n))
      .replace(/[[(]([^[\]()]*)[\])]\s*[x×*]\s*(\d+)/gi, (_, inner, n) => rep(inner, n));
  }
  return s;
}

// ---------------------------------------------------------------- team handling

class Team {
  characters: Character[];
  constructor(
    initial: Character[] | null,
    private errors: string[],
  ) {
    this.characters = initial ? initial.map((c) => ({ ...c })) : [0, 1, 2, 3].map(() => ({ name: '', element: 'none' as const }));
  }

  /** Slot for a name: a team member if it names one, otherwise the next free slot. */
  slotFor(who: string): Slot | null {
    const raw = who.trim();
    if (/^[1-4]$/.test(raw)) return (Number(raw) - 1) as Slot;
    const q = norm(raw);
    if (!q) return null;
    const entry = resolveCharacter(raw);
    let i = this.characters.findIndex((c) => (entry && c.id === entry.id) || (c.name && norm(c.name) === q));
    if (i < 0) i = this.characters.findIndex((c) => c.name && q.length >= 2 && norm(c.name).startsWith(q));
    if (i >= 0) return i as Slot;
    const free = this.characters.findIndex((c) => !c.name.trim());
    if (free < 0) {
      this.errors.push(`"${raw}" is not in the team, and the team is full.`);
      return null;
    }
    this.characters[free] = entry ? { name: entry.name, element: entry.element, id: entry.id } : { name: raw, element: 'none' };
    return free as Slot;
  }

  /** Splits `Hu Tao N2C` into a name and its actions. */
  split(block: string): { who: string; toks: Tok[] } | null {
    const colon = block.indexOf(':');
    if (colon > 0) {
      const toks = lexActions(block.slice(colon + 1));
      return toks ? { who: block.slice(0, colon), toks } : null;
    }
    // The name is the shortest run of leading words that is a known character and leaves
    // only actions behind; failing that, the shortest that leaves only actions.
    const words = block.trim().split(/\s+/);
    let fallback: { who: string; toks: Tok[] } | null = null;
    for (let k = 1; k <= Math.min(4, words.length); k++) {
      const who = words.slice(0, k).join(' ');
      const toks = lexActions(words.slice(k).join(' '));
      if (!toks) continue;
      if (this.knows(who)) return { who, toks };
      if (toks.length) fallback ??= { who, toks };
    }
    return fallback;
  }

  private knows(who: string): boolean {
    if (/^[1-4]$/.test(who)) return true;
    const q = norm(who);
    return !!resolveCharacter(who) || this.characters.some((c) => c.name && norm(c.name) === q);
  }
}

// ---------------------------------------------------------------- KQM / Hexenzirkel text

const OPENER_RE = /^\s*(?:1st|first|opener|opening|initial)(?:\s+(?:rotation|rot))?\s*[:-]\s*/i;
const LOOP_RE = /^\s*(?:2nd(?:\s+(?:rotation|rot))?(?:\s+onwards?)?|subsequent(?:\s+rotations?)?|loop|rotation|rot)\s*[:-]\s*/i;
const TIME_RE = /(?:rotation\s+(?:time|length|duration)|duration|time)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|seconds)?\b/i;

/** `Raiden E > Xingqiu EQ > ...`; `team` is the editor's current team, null when importing. */
export function parseNotation(text: string, team: Character[] | null = null): ParsedRotation {
  const errors: string[] = [];
  const notes: string[] = [];
  const t = new Team(team, errors);
  let rotationSec: number | null = null;
  const opener: RotationStep[] = [];
  const body: RotationStep[] = [];
  let target = body;
  let sawOpener = false;

  for (let line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const time = line.match(TIME_RE);
    if (time && !/[>→]/.test(line)) {
      rotationSec = Number(time[1].replace(',', '.'));
      continue;
    }
    if (OPENER_RE.test(line)) {
      line = line.replace(OPENER_RE, '');
      target = opener;
      sawOpener = true;
    } else if (LOOP_RE.test(line)) {
      line = line.replace(LOOP_RE, '');
      target = body;
    } else if (sawOpener && target === opener && opener.length) {
      target = body;
    }

    const blocks = expandRepeats(line)
      .split(/>|→|->|\|/)
      .map((b) => b.trim())
      .filter(Boolean);
    // Leaderboards put notes under the rotation; a line with no ">" that is not a block is prose.
    if (!team && blocks.length === 1 && !t.split(blocks[0])) {
      notes.push(`Ignored: "${line.trim().slice(0, 60)}"`);
      continue;
    }
    for (const block of blocks) {
      const parsed = t.split(block);
      if (!parsed) {
        errors.push(`Could not read "${block}". Write a name followed by actions, like "Raiden EQ".`);
        continue;
      }
      const slot = t.slotFor(parsed.who);
      if (slot === null) continue;
      if (!parsed.toks.length) notes.push(`"${block}" has no actions.`);
      for (const tok of parsed.toks) target.push(tok.action === 'na' ? { slot, action: 'na', count: tok.count ?? 1 } : { slot, action: tok.action });
    }
  }

  // An opener without a "2nd onwards" line is just the rotation.
  if (!body.length && opener.length) return { characters: t.characters, steps: opener, loopStart: 0, rotationSec, errors, notes };
  return { characters: t.characters, steps: [...opener, ...body], loopStart: opener.length, rotationSec, errors, notes };
}

/** One line per part, in the notation Hexenzirkel and KQM use. */
export function formatNotation(steps: RotationStep[], characters: Character[], loopStart = 0, rotationSec?: number | null): string {
  const line = (part: RotationStep[]) => {
    const blocks: string[] = [];
    let slot: Slot | null = null;
    for (const s of part) {
      if (s.slot !== slot) {
        slot = s.slot;
        const name = characters[slot]?.name.trim();
        blocks.push(`${name && !/[:>]/.test(name) ? name : slot + 1} `);
      }
      blocks[blocks.length - 1] += label(s);
    }
    return blocks.join(' > ');
  };
  const out =
    loopStart > 0 && loopStart < steps.length
      ? [`1st rotation: ${line(steps.slice(0, loopStart))}`, `2nd onwards: ${line(steps.slice(loopStart))}`]
      : [line(steps)];
  if (rotationSec) out.push(`Rotation time: ${rotationSec} s`);
  return out.join('\n');
}

// ---------------------------------------------------------------- gcsim

const GCSIM_ACTION: Record<string, Tok[] | null> = {
  skill: [{ action: 'skill' }],
  burst: [{ action: 'burst' }],
  attack: [{ action: 'na', count: 1 }],
  charge: [{ action: 'ca' }],
  aim: [{ action: 'ca' }],
  dash: [{ action: 'dash' }],
  jump: [{ action: 'jump' }],
  high_plunge: [{ action: 'jump' }, { action: 'na', count: 1 }],
  low_plunge: [{ action: 'jump' }, { action: 'na', count: 1 }],
  walk: null,
  swap: null,
  wait: null,
};

export function looksLikeGcsim(text: string): boolean {
  return /\bchar\s+lvl\s*=/.test(text) || /^\s*active\s+\w+\s*;/m.test(text) || /^\s*\w+\s+(skill|burst|attack|charge)\b[^;\n]*;/m.test(text);
}

export function parseGcsim(text: string): ParsedRotation {
  const errors: string[] = [];
  const notes: string[] = [];
  const t = new Team(null, errors);
  const clean = text.replace(/#[^\n]*/g, '').replace(/\/\/[^\n]*/g, '');

  // Team order is the order characters are declared in.
  for (const m of clean.matchAll(/^\s*([a-z0-9_]+)\s+char\b/gim)) t.slotFor(m[1]);

  const opener: RotationStep[] = [];
  const body: RotationStep[] = [];
  let target = opener;
  let depth = 0;
  let loopDepth = -1;
  let skipped = 0;

  // Statements end with ';', blocks open with '{' and close with '}'.
  for (const raw of clean.split(/(;|\{|\})/)) {
    const st = raw.trim();
    if (!st) continue;
    if (st === '{') {
      depth++;
      continue;
    }
    if (st === '}') {
      depth--;
      // Only the first loop is the rotation; whatever follows an endless loop never runs.
      if (loopDepth >= 0 && depth < loopDepth) {
        loopDepth = -2;
        target = [];
      }
      continue;
    }
    if (st === ';') continue;
    if (/^(while|for)\b/.test(st) && loopDepth === -1) {
      loopDepth = depth + 1;
      target = body;
      continue;
    }
    if (/^(while|for|if|else|fn|let|options|target|energy|hurt|print|return|break|continue|set_|delay|wait\s*\()/.test(st)) continue;
    const m = st.match(/^([a-z0-9_]+)\s+(.+)$/is);
    if (!m) continue;
    if (/^(char|add|stats)\b/.test(m[2])) continue;
    if (m[1] === 'active') {
      const slot = t.slotFor(m[2]);
      if (slot !== null && t.characters[slot]) notes.push(`Starts on ${t.characters[slot].name}.`);
      continue;
    }
    const slot = t.slotFor(m[1]);
    if (slot === null) continue;
    for (const part of m[2].split(',')) {
      const a = part.trim().match(/^([a-z_]+)(\[[^\]]*\])?(?::(\d+))?$/i);
      if (!a) {
        skipped++;
        continue;
      }
      const [, name, params = '', times = '1'] = a;
      const toks = GCSIM_ACTION[name.toLowerCase()];
      if (toks === undefined) {
        skipped++;
        continue;
      }
      if (!toks) continue;
      const n = Math.max(1, Math.min(20, Number(times)));
      const hold = /hold\s*=\s*[1-9]/.test(params);
      if (name === 'attack') {
        const last = target.at(-1);
        if (last && last.slot === slot && last.action === 'na') last.count = (last.count ?? 1) + n;
        else target.push({ slot, action: 'na', count: n });
        continue;
      }
      for (let i = 0; i < n; i++)
        for (const tok of toks) target.push(hold && tok.action === 'skill' ? { slot, action: 'skillHold' } : tok.action === 'na' ? { slot, action: 'na', count: 1 } : { slot, action: tok.action });
    }
  }
  if (skipped) notes.push(`${skipped} gcsim action${skipped === 1 ? '' : 's'} could not be mapped to an input and were left out.`);
  if (!body.length) return { characters: t.characters, steps: opener, loopStart: 0, rotationSec: null, errors, notes };
  return { characters: t.characters, steps: [...opener, ...body], loopStart: opener.length, rotationSec: null, errors, notes };
}

const gcsimKey = (c: Character) => {
  const r = rosterById(c.id);
  // gcsim accepts the lower-cased Genshin Optimizer key for every character it knows.
  return r ? norm(r.key) : norm(c.name) || 'unknown';
};

export function formatGcsim(steps: RotationStep[], characters: Character[], loopStart = 0, loop = true): string {
  const lines: string[] = ['# Exported from Genshin Training Wheels: actions only, add char/weapon/set lines to simulate.'];
  if (steps.length) lines.push(`active ${gcsimKey(characters[steps[0].slot])};`);
  const part = (ps: RotationStep[], indent: string) => {
    let slot: Slot | null = null;
    let acts: string[] = [];
    const flush = () => slot !== null && acts.length && lines.push(`${indent}${gcsimKey(characters[slot])} ${acts.join(', ')};`);
    for (const s of ps) {
      if (s.slot !== slot) {
        flush();
        slot = s.slot;
        acts = [];
      }
      const a = { skill: 'skill', skillHold: 'skill[hold=1]', burst: 'burst', ca: 'charge', dash: 'dash', jump: 'jump', na: `attack:${s.count ?? 1}` }[s.action];
      acts.push(s.action === 'na' && (s.count ?? 1) === 1 ? 'attack' : a);
    }
    flush();
  };
  const ls = loop ? loopStart : 0;
  part(steps.slice(0, ls), '');
  if (loop) {
    lines.push('while 1 {');
    part(steps.slice(ls), '  ');
    lines.push('}');
  } else part(steps, '');
  return lines.join('\n');
}

// ---------------------------------------------------------------- import entry point

const OK_ACTIONS = new Set(['skill', 'skillHold', 'burst', 'na', 'ca', 'dash', 'jump']);

/** Accepts any supported format and returns a new loadout, or the reasons it could not. */
export function importAny(text: string): { loadout: Loadout | null; errors: string[]; notes: string[]; format: string } {
  const base = newLoadout();
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(trimmed);
    } catch {
      return { loadout: null, errors: ['This looks like JSON but cannot be read.'], notes: [], format: 'JSON' };
    }
    if (Array.isArray(p.steps) && Array.isArray(p.characters)) {
      const chars = p.characters as Partial<Character>[];
      const steps = (p.steps as Partial<RotationStep>[]).filter(
        (s) => typeof s.slot === 'number' && s.slot >= 0 && s.slot <= 3 && OK_ACTIONS.has(String(s.action)),
      ) as RotationStep[];
      return {
        loadout: {
          ...base,
          name: String(p.name ?? 'Imported loadout').slice(0, 80),
          characters: base.characters.map((c, i) => {
            const name = String(chars[i]?.name ?? '').slice(0, 40);
            const r = rosterById(chars[i]?.id) ?? (name ? resolveCharacter(name) : undefined);
            return r && (!name || norm(r.name) === norm(name) || chars[i]?.id === r.id)
              ? { name: r.name, element: r.element, id: r.id }
              : { name, element: chars[i]?.element ?? c.element };
          }),
          steps,
          loopStart: Math.min(Number(p.loopStart) || 0, steps.length),
          loop: p.loop !== false,
          rotationSec: typeof p.rotationSec === 'number' ? p.rotationSec : null,
        },
        errors: [],
        notes: [],
        format: 'Genshin Training Wheels',
      };
    }
    if (typeof p.description === 'string' && Array.isArray(p.targets)) {
      const r = parseNotation(`1: ${p.description}`);
      return finish(r, String(p.name ?? 'GO rotation'), 'Genshin Optimizer target config', [
        'Genshin Optimizer configs describe one character and do not name them: pick who slot 1 is.',
      ]);
    }
    return { loadout: null, errors: ['This JSON is not a loadout or a Genshin Optimizer target config.'], notes: [], format: 'JSON' };
  }
  if (looksLikeGcsim(trimmed)) return finish(parseGcsim(trimmed), 'gcsim rotation', 'gcsim');
  return finish(parseNotation(trimmed), 'Imported rotation', 'KQM / Hexenzirkel notation');

  function finish(r: ParsedRotation, name: string, format: string, extra: string[] = []) {
    if (r.errors.length || !r.steps.length) {
      return { loadout: null, errors: r.errors.length ? r.errors : ['No actions found.'], notes: r.notes, format };
    }
    const names = r.characters.map((c) => c.name).filter(Boolean);
    return {
      loadout: {
        ...base,
        name: format === 'gcsim' || format.startsWith('KQM') ? names.join(' · ') || name : name,
        characters: r.characters,
        steps: r.steps,
        loopStart: r.loopStart,
        rotationSec: r.rotationSec,
      },
      errors: [],
      notes: [...extra, ...r.notes],
      format,
    };
  }
}

export function exportJson(l: Loadout): string {
  const { name, characters, steps, loop, loopStart, rotationSec } = l;
  return JSON.stringify({ genshinTrainingWheels: 2, name, characters, steps, loopStart: loopStart ?? 0, loop, rotationSec: rotationSec ?? null }, null, 2);
}
