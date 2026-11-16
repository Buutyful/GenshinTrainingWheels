import { defaultData, exampleLoadout, migrate, newId, newLoadout } from './defaults';
import { backupData, isElevated, loadData, saveData } from './platform';
import type { AppData, Loadout, SessionSummary, Timings } from './types';

export type View =
  | { name: 'home' }
  | { name: 'edit'; id: string }
  | { name: 'session'; id: string }
  | { name: 'settings' };

export const app = $state<{ loaded: boolean; data: AppData; view: View; elevated: boolean | null }>({
  loaded: false,
  data: defaultData(),
  view: { name: 'home' },
  elevated: null,
});

export async function initApp(): Promise<void> {
  const raw = await loadData().catch(() => null);
  const data = migrate(raw);
  // Unreadable save: set it aside instead of silently replacing it with an empty one.
  if (!data && raw) await backupData(raw).catch(() => {});
  app.data = data ?? defaultData();
  app.elevated = await isElevated().catch(() => null);
  app.loaded = true;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced so dragging a slider does not rewrite the file on every pixel. */
export function queueSave(json: string): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveData(json).catch((e) => console.error('save failed', e)), 250);
}

export function go(view: View): void {
  app.view = view;
}

export function findLoadout(id: string): Loadout | undefined {
  return app.data.loadouts.find((l) => l.id === id);
}

export function createLoadout(example = false): void {
  // A blank loadout only joins the list once the editor saves it.
  if (example) app.data.loadouts.push(exampleLoadout());
  else go({ name: 'edit', id: newLoadout().id });
}

export function saveLoadout(l: Loadout): void {
  const i = app.data.loadouts.findIndex((x) => x.id === l.id);
  if (i >= 0) app.data.loadouts[i] = l;
  else app.data.loadouts.push(l);
}

export function duplicateLoadout(id: string): void {
  const src = findLoadout(id);
  if (!src) return;
  const copy: Loadout = { ...$state.snapshot(src), id: newId(), name: `${src.name} (copy)`, history: [] };
  app.data.loadouts.splice(app.data.loadouts.indexOf(src) + 1, 0, copy);
}

export function deleteLoadout(id: string): void {
  app.data.loadouts = app.data.loadouts.filter((l) => l.id !== id);
}

export function recordSession(id: string, summary: SessionSummary, timings: Timings | null): void {
  const l = findLoadout(id);
  if (!l) return;
  if (timings) l.timings = timings;
  l.history = [...l.history, summary].slice(-30);
}

/** Loadouts travel as JSON text so they can be pasted in chat or committed to a repo. */
export function exportLoadout(id: string): string {
  const l = findLoadout(id);
  if (!l) return '';
  const { name, characters, steps, loop } = $state.snapshot(l);
  return JSON.stringify({ genshinTrainingWheels: 1, name, characters, steps, loop }, null, 2);
}

export function importLoadout(text: string): string | null {
  try {
    const p = JSON.parse(text);
    if (!p || !Array.isArray(p.steps) || !Array.isArray(p.characters)) return 'This is not a Genshin Training Wheels loadout.';
    const base = newLoadout();
    const okActions = new Set(['skill', 'skillHold', 'burst', 'na', 'ca', 'dash', 'jump']);
    const steps = p.steps.filter(
      (s: { slot?: unknown; action?: unknown }) =>
        typeof s.slot === 'number' && s.slot >= 0 && s.slot <= 3 && okActions.has(String(s.action)),
    );
    app.data.loadouts.push({
      ...base,
      name: String(p.name ?? 'Imported loadout').slice(0, 80),
      characters: base.characters.map((c, i) => ({
        name: String(p.characters[i]?.name ?? '').slice(0, 40),
        element: p.characters[i]?.element ?? c.element,
      })),
      steps,
      loop: p.loop !== false,
    });
    return null;
  } catch {
    return 'Could not read that text as JSON.';
  }
}
