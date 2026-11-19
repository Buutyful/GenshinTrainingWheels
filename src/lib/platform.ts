import { scancodeToCode } from './keycodes';
import type { RawEvent } from './types';

/** True inside the desktop app; false when the UI runs in a plain browser (practice mode). */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const STORAGE_KEY = 'genshin-training-wheels-data';

export const nowMs = () => performance.timeOrigin + performance.now();

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

export async function loadData(): Promise<string | null> {
  if (isTauri) return invoke<string | null>('load_data');
  return localStorage.getItem(STORAGE_KEY);
}

export async function saveData(json: string): Promise<void> {
  if (isTauri) return invoke('save_data', { json });
  localStorage.setItem(STORAGE_KEY, json);
}

/** Keeps a copy of a save file this version could not read. */
export async function backupData(raw: string): Promise<void> {
  if (isTauri) return invoke('backup_data', { raw });
  localStorage.setItem(`${STORAGE_KEY}-unreadable`, raw);
}

/** null means "not applicable" (browser). */
export async function isElevated(): Promise<boolean | null> {
  return isTauri ? invoke<boolean>('is_elevated') : null;
}

export async function relaunchAsAdmin(): Promise<void> {
  if (isTauri) await invoke('relaunch_as_admin');
}

interface RawPayload {
  sc: number;
  e0: boolean;
  down: boolean;
  mouse: number | null;
  t: number;
}

export type StopCapture = () => void;

/**
 * Desktop: system-wide input through Windows Raw Input, so it works while the game has focus.
 * Browser: only input that reaches this page, which is enough to rehearse a rotation dry.
 */
export async function startCapture(cb: (e: RawEvent) => void): Promise<StopCapture> {
  if (isTauri) {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<RawPayload>('raw-input', ({ payload: p }) => {
      cb({ code: p.mouse !== null ? `Mouse${p.mouse}` : scancodeToCode(p.sc, p.e0), down: p.down, t: p.t });
    });
    await invoke('start_capture');
    return () => {
      unlisten();
      void invoke('stop_capture');
    };
  }

  const key = (down: boolean) => (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    cb({ code: e.code, down, t: nowMs() });
  };
  const mouse = (down: boolean) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest?.('button, select, input, a')) return;
    cb({ code: `Mouse${e.button}`, down, t: nowMs() });
  };
  const menu = (e: Event) => e.preventDefault();
  const handlers: [string, EventListener][] = [
    ['keydown', key(true) as EventListener],
    ['keyup', key(false) as EventListener],
    ['mousedown', mouse(true) as EventListener],
    ['mouseup', mouse(false) as EventListener],
    ['contextmenu', menu],
  ];
  handlers.forEach(([n, h]) => window.addEventListener(n, h));
  return () => handlers.forEach(([n, h]) => window.removeEventListener(n, h));
}
