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
  /** Player's note on the character turn this step starts (buffs, cooldowns, what it sets up). */
  note?: string;
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
  steps: {
    sig: string;
    missed: number[];
    wrong: number[];
    /**
     * Average time from the previous step's input (or the lap's start) to this step's, over laps
     * that were not abandoned; 0 where never measured. Absent on runs recorded before it existed.
     */
    durMs?: number[];
    /** Laps each `durMs` entry was averaged over. */
    durN?: number[];
  };
  /** Rhythm mode only. */
  rhythm?: RhythmMetrics;
}

/** Rhythm-mode judgement of one step. */
export type Grade = 'perfect' | 'good' | 'early' | 'late' | 'miss';

/** How a rhythm-mode run sat on the beat. */
export interface RhythmMetrics {
  counts: Record<Grade, number>;
  /** Average offset of the steps played, ms; negative means early. */
  meanMs: number | null;
  /** Standard deviation of those offsets, ms. */
  spreadMs: number | null;
  /** Longest run of perfect or good steps. */
  bestStreak: number;
  /** Calibrated latency the run was judged with, ms. */
  latencyMs: number;
  /** Per flattened step: steps played (not missed), their average offset, and misses. */
  steps: { sig: string; n: number[]; meanMs: number[]; misses: number[] };
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
  /** Rhythm-mode backing track, built from one of the player's clean laps. */
  track?: RhythmTrack;
}

/**
 * One clean lap quantised onto the 128 BPM grid. Positions are 16th notes from the start of the
 * lap (the looping part of the rotation, or all of it for a one-shot).
 */
export interface RhythmTrack {
  /** Rotation this was recorded on (`timingSig`); the track is ignored when it changes. */
  sig: string;
  bpm: number;
  bars: number;
  /** Per flattened step: the 16th where it starts, -1 for steps outside the lap (an opener). */
  pos: number[];
  /** Per flattened step: the 16th of its last click (attack strings), else equal to `pos`. */
  end: number[];
  /** Length of the recorded lap, ms. */
  lapMs: number;
  recordedAt: number;
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

/** How cues sound: a distinct sound per key, or a voice calling the key. */
export type CueSound = 'sounds' | 'voice';

export interface AudioSettings {
  cueSound: CueSound;
  /** Whole-app level, 0..1; multiplies cues and music. */
  master: number;
  muted: boolean;
  /** Level of the arcade cues and feedback sounds, 0..1. */
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
  /** Rhythm mode: perfect / good / early / late / miss sounds. */
  judgeSounds: boolean;
  /**
   * How late this device's presses land after the sound they answer, ms (output plus input
   * latency plus the player's own habit). Measured by the tap-along calibration; per device.
   */
  latencyMs: number;
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

export type MusicStyle = 'runway' | 'hiphop' | 'funk' | 'house' | 'rock';

/** The rhythm-mode backing band; the action cues are the same in every style. */
export interface MusicSettings {
  style: MusicStyle;
  /** Which of the style's grooves plays; -1 moves on to the next one every phrase. */
  groove: number;
  /** A drum fill at the end of every phrase. */
  fills: boolean;
  /** Music level, 0..1 (the mixer's Music fader). */
  volume: number;
  /** Levels inside the band, 0..1. */
  drums: number;
  bass: number;
  keys: number;
  /** Room size, 0..1 (0.5 is the style's own). */
  reverb: number;
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
