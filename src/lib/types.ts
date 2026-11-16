export type Slot = 0 | 1 | 2 | 3;

export type Element = 'pyro' | 'hydro' | 'electro' | 'cryo' | 'anemo' | 'geo' | 'dendro' | 'none';

/** Actions a rotation author can put in a rotation. */
export type StepAction = 'skill' | 'skillHold' | 'burst' | 'na' | 'ca' | 'dash' | 'jump';

/** Everything the input interpreter can recognise. Swaps are implied by the rotation. */
export type ActionType = StepAction | 'swap';

export interface Character {
  name: string;
  element: Element;
  /** Roster id (also the portrait's file name); absent for names the roster does not know. */
  id?: string;
}

export interface RotationStep {
  slot: Slot;
  action: StepAction;
  /** Number of normal attacks, only meaningful for `na`. */
  count?: number;
}

/** What one character did during a run. */
export interface CharMetrics {
  /** Time on field while the rotation was being tracked. */
  fieldMs: number;
  /** Inputs made on this character; `na` counts clicks. */
  actions: Partial<Record<StepAction, number>>;
  /** Judged steps of this character: done, skipped, and wrong inputs made while on it. */
  hits: number;
  missed: number;
  wrong: number;
  /** Times this character came on field. */
  entries: number;
}

export interface LapMetric {
  ms: number;
  clean: boolean;
  errors: number;
}

export interface RunMetrics {
  chars: CharMetrics[];
  laps: LapMetric[];
  /** Rotation time the loadout aimed for, when set. */
  targetMs: number | null;
  trackedMs: number;
  offTrackMs: number;
  pausedMs: number;
  swaps: number;
  inputs: number;
  /** Per flattened step, so the metrics view can say which steps keep going wrong. */
  steps: { sig: string; missed: number[]; wrong: number[] };
}

export interface SessionSummary {
  date: number;
  durationMs: number;
  laps: number;
  cleanLaps: number;
  accuracy: number;
  bestLapMs: number | null;
  avgLapMs: number | null;
  metrics?: RunMetrics;
}

export interface Loadout {
  id: string;
  name: string;
  characters: Character[];
  /** Opener steps first, then the looping part; see `loopStart`. */
  steps: RotationStep[];
  /** Index in `steps` where the looping part begins (0: the whole rotation loops). */
  loopStart?: number;
  loop: boolean;
  /** How long one rotation should take, in seconds. */
  rotationSec?: number | null;
  history: SessionSummary[];
  timings?: Timings;
}

/** A semantic in-game action derived from raw input. For `swap`, `slot` is the target. */
export interface GameAction {
  type: ActionType;
  slot: Slot;
  t: number;
  viaAlt?: boolean;
}

/** Normalised raw input. `code` follows KeyboardEvent.code, mouse buttons are `Mouse0..4`. */
export interface RawEvent {
  code: string;
  down: boolean;
  t: number;
}

export type BindKey =
  | 'swap1'
  | 'swap2'
  | 'swap3'
  | 'swap4'
  | 'skill'
  | 'burst'
  | 'attack'
  | 'dash'
  | 'jump'
  | 'burstMod'
  | 'hkRestart'
  | 'hkStop';

export type Bindings = Record<BindKey, string[]>;

export type Guidance = 'full' | 'swaps' | 'adaptive' | 'off';
export type OffTrackPolicy = 'resync' | 'restart';

export interface AudioSettings {
  volume: number;
  guidance: Guidance;
  /** How long before a step is due its cue starts: ears and hands need time to react. */
  leadMs: number;
  /** Rising sweep from the cue to the moment the key is due. */
  buildup: boolean;
  /** How late the player may be before the pending step is cued again. */
  hesitateMs: number;
  feedback: boolean;
  hitTick: boolean;
}

/** How long the player takes between steps; learned from their own clean play. */
export interface Timings {
  /** Rotation these numbers were measured on; they are discarded when it changes. */
  sig: string;
  /** gap[i]: from landing step i to starting the next one. */
  gap: number[];
  /** span[i]: from the first to the last click of an attack string, 0 otherwise. */
  span: number[];
}

export interface TrackerSettings {
  /** How many important steps may be skipped before an action counts as wrong. */
  maxSkip: number;
  /** Consecutive wrong actions before the tracker declares the player off track. */
  offTrackAfter: number;
  /** Mashing the same key again within this window is not an error. */
  repeatWindowMs: number;
  /** No input at all for this long pauses tracking without penalty. */
  idleMs: number;
  policy: OffTrackPolicy;
}

export interface Settings {
  bindings: Bindings;
  holdSkillMs: number;
  holdAttackMs: number;
  tracker: TrackerSettings;
  audio: AudioSettings;
  music: MusicSettings;
}

/** Sound of the rhythm-mode backing track; tuned by ear on the Jam screen. */
export interface MusicSettings {
  /** Music bus level, 0..1. */
  volume: number;
  /** Acid filter resting cut-off, Hz. */
  cutoff: number;
  /** Acid filter resonance, 0..1. */
  resonance: number;
  /** How far the acid filter envelope opens, 0..1. */
  envMod: number;
  /** Acid filter envelope decay, seconds. */
  decay: number;
  /** Acid saturation, 0..1. */
  drive: number;
  /** Detune of the stab saws, cents. */
  stabDetune: number;
  /** Total spread of the supersaw, cents. */
  sawDetune: number;
  /** How far the kick ducks the tonal layers, 0..1. */
  sidechain: number;
  /** Per-instrument levels, 0..1. */
  kick: number;
  hat: number;
  acid: number;
  stab: number;
  lift: number;
}

export interface AppData {
  version: 1;
  loadouts: Loadout[];
  settings: Settings;
}

export const NOISE_ACTIONS: ReadonlySet<ActionType> = new Set(['na', 'ca', 'dash', 'jump']);

/** Attacks and movement are too fuzzy to judge strictly; skills, bursts and swaps are not. */
export function isNoise(a: ActionType): boolean {
  return NOISE_ACTIONS.has(a);
}
