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
/** Browser build only; the desktop window's URL is in tauri.conf.json. */
const URL = 'index.html#presentation';

export interface PresentationState {
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

/** What the overlay's own buttons ask the session to do. */
export type PresentationCommand = 'start' | 'stop';
const COMMAND_EVENT = 'presentation:command';

type Message =
  | { kind: typeof STATE_EVENT; state: PresentationState }
  | { kind: typeof COMMAND_EVENT; command: PresentationCommand }
  | { kind: typeof READY_EVENT | typeof CLOSED_EVENT };

let channel: BroadcastChannel | null = null;
const bus = () => (channel ??= new BroadcastChannel('genshin-training-wheels-presentation'));
let popup: Window | null = null;

/** A starting size; the height then follows the panel and the width is the user's to drag. */
export function presentationSize(p: PresentationSettings): { width: number; height: number } {
  return p.layout === 'vertical' ? { width: Math.round(300 * p.scale), height: 400 } : { width: 1100, height: 120 };
}

/** Overlay: make the window exactly as tall as its panel (plus the frame), optionally changing the width. */
export async function fitOverlayHeight(width: number | null, panelHeight: number): Promise<void> {
  if (!panelHeight) return;
  const height = Math.ceil(panelHeight) + 8;
  const w = width ?? window.innerWidth;
  if (Math.abs(height - window.innerHeight) < 1 && w === window.innerWidth) return;
  if (!isTauri) return window.resizeTo(w + (window.outerWidth - window.innerWidth), height + (window.outerHeight - window.innerHeight));
  const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setSize(new LogicalSize(w, height));
}

/** Overlay: close itself. The session notices and its button turns back to "Overlay". */
export async function closeOverlay(): Promise<void> {
  if (!isTauri) return window.close();
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

/** Overlay: ask the session to start or stop the run. */
export async function sendPresentationCommand(command: PresentationCommand): Promise<void> {
  if (!isTauri) return bus().postMessage({ kind: COMMAND_EVENT, command } satisfies Message);
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('main', COMMAND_EVENT, command);
}

/** Main window: run the overlay's Start / Stop. */
export async function onPresentationCommand(cb: (c: PresentationCommand) => void): Promise<() => void> {
  if (!isTauri) {
    const onMsg = (e: MessageEvent<Message>) => e.data.kind === COMMAND_EVENT && cb(e.data.command);
    bus().addEventListener('message', onMsg);
    return () => bus().removeEventListener('message', onMsg);
  }
  const { listen } = await import('@tauri-apps/api/event');
  return listen<PresentationCommand>(COMMAND_EVENT, (e) => cb(e.payload));
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
  // The window is described in tauri.conf.json (always transparent: the page paints the chosen
  // background, so it can change live) and built by the shell with the main window's browser
  // arguments, which WebView2 requires of windows sharing a profile.
  const { invoke } = await import('@tauri-apps/api/core');
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  await invoke('open_presentation', { width, height });
  const w = await WebviewWindow.getByLabel(PRESENTATION_LABEL);
  if (!w) throw new Error('the window did not open');
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
