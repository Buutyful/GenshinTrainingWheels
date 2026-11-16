import { defaultData, exampleLoadout, migrate, newId, newLoadout } from './defaults';
import { exportJson, formatGcsim, formatNotation } from './formats';
import { backupData, isElevated, loadData, saveData } from './platform';
import type { AppData, Loadout, SessionSummary, Timings } from './types';

export type View =
  | { name: 'home' }
  | { name: 'edit'; id: string }
  | { name: 'session'; id: string }
  | { name: 'metrics'; id: string }
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

export type ExportFormat = 'notation' | 'gcsim' | 'json';

/** Loadouts travel as text so they can be pasted in chat, on a leaderboard or into gcsim. */
export function exportLoadout(id: string, format: ExportFormat): string {
  const found = findLoadout(id);
  if (!found) return '';
  const l = $state.snapshot(found) as Loadout;
  const ls = l.loop ? (l.loopStart ?? 0) : 0;
  if (format === 'gcsim') return formatGcsim(l.steps, l.characters, ls, l.loop);
  if (format === 'json') return exportJson(l);
  return formatNotation(l.steps, l.characters, ls, l.rotationSec);
}

/** Adds the loadout an import preview produced and returns its id. */
export function addImported(l: Loadout): string {
  app.data.loadouts.push(l);
  return l.id;
}
