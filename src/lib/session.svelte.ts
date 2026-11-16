import { AudioOut } from './audio';
import { CueDirector } from './cues';
import { flatten, Tracker } from './engine';
import type { FlatStep, LapRecord, OffReason, StepStat, StepStatus, Totals, TrackerEvent, TrackerStatus } from './engine';
import { Interpreter } from './interpreter';
import { charName, stepLabel } from './notation';
import { resolveTimings, TimingLearner, timingSig } from './timing';
import { nowMs, startCapture, type StopCapture } from './platform';
import { MetricsCollector } from './metrics';
import { isNoise } from './types';
import type { GameAction, Loadout, RawEvent, SessionSummary, Settings, Slot, Timings } from './types';

export interface FeedItem {
  id: number;
  tone: 'ok' | 'bad' | 'warn' | 'info';
  text: string;
}

export interface Snapshot {
  status: TrackerStatus;
  offReason: OffReason | null;
  pointer: number;
  lap: number;
  statuses: StepStatus[];
  naClicks: number;
  totals: Totals;
  accuracy: number | null;
  elapsedMs: number;
  activeSlot: Slot;
  /** Time into the current lap, for pacing against the rotation time. */
  lapMs: number;
}

export interface Report {
  summary: SessionSummary;
  steps: FlatStep[];
  stats: StepStat[];
  laps: LapRecord[];
  totals: Totals;
  /** The player's rhythm, updated by this run; null when nothing new was learned. */
  timings: Timings | null;
}

/** One practice run: wires input capture, interpreter, tracker and audio together. */
export class Session {
  readonly steps: FlatStep[];
  snap = $state<Snapshot>(null!);
  feed = $state<FeedItem[]>([]);
  error = $state<string | null>(null);

  private tracker: Tracker;
  private interp: Interpreter;
  private audio: AudioOut;
  private director: CueDirector;
  private learner: TimingLearner;
  private stopCapture: StopCapture | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private feedId = 0;
  private metrics: MetricsCollector;
  readonly targetMs: number | null;

  constructor(
    readonly loadout: Loadout,
    /** A private copy: the director and audio read it live, so guidance can change mid-run. */
    readonly settings: Settings,
    private onStopHotkey: () => void,
  ) {
    const loopStart = loadout.loop ? (loadout.loopStart ?? 0) : 0;
    this.steps = flatten(loadout.steps, loadout.loop, loopStart);
    this.tracker = new Tracker(this.steps, loadout.loop, settings.tracker, (e) => this.onTrackerEvent(e));
    this.interp = this.makeInterpreter();
    this.audio = new AudioOut(settings.audio);
    const sig = timingSig(loadout.steps, loadout.loop, loopStart);
    this.targetMs = loadout.rotationSec ? loadout.rotationSec * 1000 : null;
    this.metrics = new MetricsCollector(this.steps, this.tracker, sig, this.targetMs);
    const timings = resolveTimings(loadout.timings, this.steps, sig);
    this.learner = new TimingLearner(this.steps, timings);
    this.director = new CueDirector(this.tracker, timings, settings.audio, this.audio);
    this.snap = this.read(nowMs());
  }

  private makeInterpreter(): Interpreter {
    const first = this.loadout.steps[0]?.slot ?? 0;
    const { holdSkillMs, holdAttackMs, bindings } = this.settings;
    return new Interpreter(bindings, { holdSkillMs, holdAttackMs }, first, (a: GameAction) => {
      this.metrics.onAction(a);
      this.tracker.handle(a);
    });
  }

  async start(): Promise<void> {
    try {
      await this.audio.unlock();
      this.stopCapture = await startCapture((e) => this.onRaw(e));
    } catch (e) {
      this.error = `Could not start input capture: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    // The interval only makes holds, pauses and hesitation cues timely; correctness never
    // depends on it because every input event advances the same clocks first.
    this.timer = setInterval(() => this.onTick(), 50);
    this.director.update(nowMs());
  }

  /** Stops capturing and returns the run's results. */
  stop(): Report {
    clearInterval(this.timer);
    this.stopCapture?.();
    this.stopCapture = null;
    this.audio.close();
    const t = this.tracker;
    const timed = t.laps.filter((l) => !l.aborted);
    const clean = timed.filter((l) => l.clean);
    const summary: SessionSummary = {
      date: Date.now(),
      durationMs: t.startT === null ? 0 : Math.max(0, t.lastActivityT - t.startT),
      laps: timed.length,
      cleanLaps: clean.length,
      accuracy: t.accuracy ?? 0,
      bestLapMs: clean.length ? Math.min(...clean.map((l) => l.durationMs)) : null,
      avgLapMs: timed.length ? timed.reduce((s, l) => s + l.durationMs, 0) / timed.length : null,
      metrics: this.metrics.result(),
    };
    const timings = this.learner.learned ? this.learner.timings : null;
    return { summary, steps: this.steps, stats: t.stats, laps: t.laps, totals: { ...t.totals }, timings };
  }

  restart(): void {
    this.tracker.restart();
    this.interp = this.makeInterpreter();
    this.push('info', 'Restarted — begin from the first step');
    this.snap = this.read(nowMs());
  }

  private onRaw(e: RawEvent): void {
    const { hkRestart, hkStop } = this.settings.bindings;
    if (e.down && hkRestart.includes(e.code)) return this.restart();
    if (e.down && hkStop.includes(e.code)) return this.onStopHotkey();
    this.metrics.accrue(e.t, this.interp.active);
    this.interp.feed(e);
    this.director.update(e.t);
    this.snap = this.read(e.t);
  }

  private onTick(): void {
    const now = nowMs();
    this.metrics.accrue(now, this.interp.active);
    this.interp.advance(now);
    this.tracker.tick(now);
    this.director.update(now);
    this.snap = this.read(now);
  }

  private read(now: number): Snapshot {
    const t = this.tracker;
    return {
      status: t.status,
      offReason: t.offReason,
      pointer: t.pointer,
      lap: t.lap,
      statuses: [...t.statuses],
      naClicks: t.naClicks,
      totals: { ...t.totals },
      accuracy: t.accuracy,
      elapsedMs: t.startT === null ? 0 : Math.max(0, (t.status === 'done' ? t.lastActivityT : now) - t.startT),
      activeSlot: this.interp.active,
      lapMs: t.status === 'tracking' ? Math.max(0, now - t.lapStartT) : 0,
    };
  }

  describe(i: number): string {
    const s = this.steps[i];
    const name = charName(this.loadout.characters, s.slot);
    return s.action === 'swap' ? `swap to ${name}` : `${stepLabel(s.action, s.count)} on ${name}`;
  }

  private push(tone: FeedItem['tone'], text: string): void {
    this.feed = [{ id: ++this.feedId, tone, text }, ...this.feed].slice(0, 6);
  }

  private onTrackerEvent(e: TrackerEvent): void {
    this.learner.onEvent(e);
    this.metrics.onEvent(e);
    this.director.onEvent(e);
    switch (e.kind) {
      case 'start':
        return this.push('info', 'Tracking started');
      case 'skip':
        if (e.missed > 0) {
          const majors = e.indices.filter((i) => !isNoise(this.steps[i].action)).map((i) => this.describe(i));
          this.push('bad', `Skipped: ${majors.join(', ')}`);
        }
        return;
      case 'wrong': {
        const a = e.action;
        const name = charName(this.loadout.characters, a.slot);
        const did = a.type === 'swap' ? `swapped to ${name}` : `${stepLabel(a.type)} on ${name}`;
        return this.push('bad', `You ${did} — expected ${this.describe(e.expected)}`);
      }
      case 'offtrack':
        return this.push('warn', e.reason === 'idle' ? 'Paused — no input' : 'Off track — waiting for you to rejoin');
      case 'resync':
        return this.push('ok', `Back on track at ${this.describe(e.index)}`);
      case 'lap':
        return this.push(e.clean ? 'ok' : 'info', `Lap ${e.lap} · ${(e.durationMs / 1000).toFixed(1)}s${e.clean ? ' · clean' : ''}`);
      case 'done':
        return this.push('ok', 'Rotation complete');
    }
  }
}
