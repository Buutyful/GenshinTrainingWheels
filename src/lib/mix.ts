/**
 * Live volume levels for everything that makes sound. The top-bar mixer writes the settings;
 * App pushes them here; synths that are already running subscribe, so moving a fader is heard
 * at once, even mid-run (a session works on its own copy of the settings).
 */
export interface Mix {
  master: number;
  muted: boolean;
  cues: number;
  music: number;
}

let current: Mix = { master: 1, muted: false, cues: 0.6, music: 0.7 };
const listeners = new Set<(m: Mix) => void>();

export function setMix(m: Mix): void {
  current = { ...m };
  for (const f of listeners) f(current);
}

export function getMix(): Mix {
  return current;
}

/** Calls `f` now and on every change; returns the unsubscribe function. */
export function onMix(f: (m: Mix) => void): () => void {
  listeners.add(f);
  f(current);
  return () => listeners.delete(f);
}

export const cueGain = (m: Mix) => (m.muted ? 0 : m.master * m.cues);
export const musicGain = (m: Mix) => (m.muted ? 0 : m.master * m.music);
