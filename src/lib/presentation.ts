import type { FlatStep, OffReason, StepStatus, TrackerStatus } from './engine';
import { isTauri } from './platform';
import type { Character, PresentationSettings } from './types';

/**
 * The presentation window: a second, always-on-top window that shows the whole rotation and
 * where the player is in it, for people recording videos. The main window runs the session and
 * pushes its state here; the presentation window only draws it.
 *
 * Desktop: a borderless Tauri window, talked to with events. Browser: a pop-up, talked to over
 * a BroadcastChannel.
 */
export const PRESENTATION_LABEL = 'presentation';
const STATE_EVENT = 'presentation:state';
const READY_EVENT = 'presentation:ready';
const CLOSED_EVENT = 'presentation:closed';
const URL = 'index.html#presentation';

export interface PresentationState {
  name: string;
  characters: Character[];
  steps: FlatStep[];
  /** Per-step results, null before Start. */
  statuses: StepStatus[] | null;
  pointer: number;
  naClicks: number;
  /** 'idle' until Start is pressed. */
  status: TrackerStatus | 'idle';
  offReason: OffReason | null;
  lap: number;
  elapsedMs: number;
  prefs: PresentationSettings;
}

type Message = { kind: typeof STATE_EVENT; state: PresentationState } | { kind: typeof READY_EVENT | typeof CLOSED_EVENT };

let channel: BroadcastChannel | null = null;
const bus = () => (channel ??= new BroadcastChannel('genshin-training-wheels-presentation'));
let popup: Window | null = null;

/** A starting size that fits the layout; the window can be resized freely after. */
export function presentationSize(p: PresentationSettings): { width: number; height: number } {
  return p.layout === 'vertical'
    ? { width: Math.round(340 * p.scale), height: 640 }
    : { width: 1280, height: Math.round((p.header ? 170 : 130) * p.scale) };
}

/** Opens the window, or does nothing if it is already open. `onClosed` runs however it closes. */
export async function openPresentation(prefs: PresentationSettings, onClosed: () => void): Promise<void> {
  const { width, height } = presentationSize(prefs);
  if (!isTauri) {
    if (popup && !popup.closed) return;
    popup = window.open(URL, PRESENTATION_LABEL, `popup,width=${width},height=${height}`);
    if (!popup) throw new Error('the browser blocked the pop-up');
    const b = bus();
    const onMsg = (e: MessageEvent<Message>) => {
      if (e.data.kind !== CLOSED_EVENT) return;
      b.removeEventListener('message', onMsg);
      popup = null;
      onClosed();
    };
    b.addEventListener('message', onMsg);
    return;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  if (await WebviewWindow.getByLabel(PRESENTATION_LABEL)) return;
  const w = new WebviewWindow(PRESENTATION_LABEL, {
    url: URL,
    title: 'Rotation presentation',
    width,
    height,
    minWidth: 160,
    minHeight: 60,
    decorations: false,
    // Always transparent: the page paints the chosen background, so it can change live.
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    resizable: true,
  });
  await new Promise<void>((resolve, reject) => {
    void w.once('tauri://created', () => resolve());
    void w.once<string>('tauri://error', (e) => reject(new Error(String(e.payload))));
  });
  void w.once('tauri://destroyed', onClosed);
}

export async function closePresentation(): Promise<void> {
  if (!isTauri) {
    popup?.close();
    popup = null;
    return;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  await (await WebviewWindow.getByLabel(PRESENTATION_LABEL))?.close();
}

export async function publishPresentation(state: PresentationState): Promise<void> {
  if (!isTauri) return bus().postMessage({ kind: STATE_EVENT, state } satisfies Message);
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo(PRESENTATION_LABEL, STATE_EVENT, state);
}

/** Main window: the presentation window has loaded and needs the current state. */
export async function onPresentationReady(cb: () => void): Promise<() => void> {
  if (!isTauri) {
    const onMsg = (e: MessageEvent<Message>) => e.data.kind === READY_EVENT && cb();
    bus().addEventListener('message', onMsg);
    return () => bus().removeEventListener('message', onMsg);
  }
  const { listen } = await import('@tauri-apps/api/event');
  return listen(READY_EVENT, () => cb());
}

/** Presentation window: receive state, then ask the main window for it. */
export async function followPresentation(cb: (s: PresentationState) => void): Promise<() => void> {
  if (!isTauri) {
    const b = bus();
    const onMsg = (e: MessageEvent<Message>) => e.data.kind === STATE_EVENT && cb(e.data.state);
    const onUnload = () => b.postMessage({ kind: CLOSED_EVENT } satisfies Message);
    b.addEventListener('message', onMsg);
    window.addEventListener('pagehide', onUnload);
    b.postMessage({ kind: READY_EVENT } satisfies Message);
    return () => {
      b.removeEventListener('message', onMsg);
      window.removeEventListener('pagehide', onUnload);
    };
  }
  const { listen, emitTo } = await import('@tauri-apps/api/event');
  const stop = await listen<PresentationState>(STATE_EVENT, (e) => cb(e.payload));
  await emitTo('main', READY_EVENT);
  return stop;
}
