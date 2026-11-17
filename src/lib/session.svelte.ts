import { AudioOut } from './audio';
import { CueDirector } from './cues';
import { flatten, Tracker } from './engine';
import type { FlatStep, LapRecord, OffReason, StepStat, StepStatus, Totals, TrackerEvent, TrackerStatus } from './engine';
import { Interpreter } from './interpreter';
import { charName, stepLabel } from './notation';
import { resolveTimings, TimingLearner, timingSig } from './timing';
import { nowMs, startCapture, type StopCapture } from './platform';
import { MetricsCollector } from './metrics';
import { arrange, buildTrack, LapRecorder, validTrack, type CleanLap } from './music/arrange';
import { TrackPlayer } from './music/player';
import { LOST_AFTER, RhythmJudge, type Judgement } from './rhythm';
import { isNoise } from './types';
import type { GameAction, Grade, Loadout, RawEvent, RhythmTrack, SessionSummary, Settings, Slot, Timings } from './types';

/** Practice: cues follow the player. Rhythm: a backing track the player keeps up with. */
export type SessionMode = 'practice' | 'rhythm';

export interface MusicSnap {
  /** Beat in the bar, 0..3. */
  beat: number;
  /** 16th in the lap while the track plays, else null. */
  lapStep: number | null;
  bars: number;
}

/** Rhythm mode: the latest judgement and running totals, for the live view. */
export interface JudgeSnap {
  last: (Judgement & { id: number }) | null;
  counts: Record<Grade, number>;
  streak: number;
}

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
  /** Rhythm mode only. */
  music: MusicSnap | null;
}

export interface Report {
  summary: SessionSummary;
  steps: FlatStep[];
  stats: StepStat[];
  laps: LapRecord[];
  totals: Totals;
  /** The player's rhythm, updated by this run; null when nothing new was learned. */
  timings: Timings | null;
  /** Rhythm track from this run's last clean lap, if there was one. */
  track: RhythmTrack | null;
  mode: SessionMode;
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
  private recorder: LapRecorder;
  private player: TrackPlayer | null = null;
  /** Track built from this run's latest clean lap. */
  private newTrack: RhythmTrack | null = null;
  private newTrackMeasured = false;
  readonly targetMs: number | null;
  /** Rhythm mode: whether a track is playing (false while the first clean lap is recorded). */
  hasTrack = $state(false);
  private judge: RhythmJudge | null = null;
  private judgeId = 0;
  judged = $state<JudgeSnap | null>(null);

  constructor(
    readonly loadout: Loadout,
    /** A private copy: the director and audio read it live, so guidance can change mid-run. */
    readonly settings: Settings,
    private onStopHotkey: () => void,
    readonly mode: SessionMode = 'practice',
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
    // In rhythm mode the music is the cue.
    if (mode === 'rhythm') settings.audio.guidance = 'off';
    this.director = new CueDirector(this.tracker, timings, settings.audio, this.audio);
    this.recorder = new LapRecorder(this.steps, loadout.loop, (lap) => this.onCleanLap(lap));
    if (mode === 'rhythm') {
      const track = validTrack(loadout.track, this.steps, sig);
      this.player = new TrackPlayer(
        settings.music,
        track ? arrange(this.steps, track) : null,
        loadout.loop,
        () => settings.audio.cueSound,
        () => settings.audio.latencyMs,
      );
      this.hasTrack = !!track;
      this.judge = new RhythmJudge(this.steps, sig, settings.audio.latencyMs);
      this.judged = { last: null, counts: { ...this.judge.counts }, streak: 0 };
    }
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
      await this.player?.start();
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
    this.recorder.flush();
    this.stopCapture?.();
    this.stopCapture = null;
    this.audio.close();
    this.player?.stop();
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
      metrics: { ...this.metrics.result(), ...(this.judge?.total ? { rhythm: this.judge.result() } : {}) },
    };
    const timings = this.learner.learned ? this.learner.timings : null;
    return { summary, steps: this.steps, stats: t.stats, laps: t.laps, totals: { ...t.totals }, timings, track: this.newTrack, mode: this.mode };
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
      music: this.player?.position() ?? null,
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

  private onCleanLap(lap: CleanLap): void {
    // A lap cut off by the end of the run has an estimated length; keep a measured one over it.
    if (lap.next === null && this.newTrackMeasured) return;
    this.newTrack = buildTrack(this.steps, this.loadout.loop, lap, this.learner.timings);
    this.newTrackMeasured = lap.next !== null;
    if (this.player && !this.player.arrangement) {
      this.player.setArrangement(arrange(this.steps, this.newTrack));
      this.hasTrack = true;
      this.push('ok', `Track recorded · ${this.newTrack.bars} bar${this.newTrack.bars === 1 ? '' : 's'} — the music joins on your next step`);
    }
  }

  /** Rhythm mode: tells the music where the player is. */
  private onRhythm(e: TrackerEvent): void {
    const p = this.player;
    if (!p) return;
    let started: { index: number; t: number } | null = null;
    if (e.kind === 'progress' && e.clicks === 1) started = e;
    else if (e.kind === 'hit') {
      const s = this.steps[e.index];
      if (!(s.action === 'na' && s.count > 1)) started = e;
    } else if (e.kind === 'offtrack' || e.kind === 'resync' || e.kind === 'done') p.dropActions();
    if (started) {
      const pos = p.arrangement?.targets[started.index] ?? -1;
      const delta = p.stepStarted(started.t, pos >= 0 ? pos : null);
      if (delta !== null && this.judge) this.onJudged(this.judge.hit(started.index, delta));
    } else if (e.kind === 'skip' && e.missed > 0 && p.playing && this.judge) {
      // Skipped steps are misses; one sound for the lot.
      let last: Judgement | null = null;
      for (const i of e.indices) if ((p.arrangement?.targets[i] ?? -1) >= 0) last = this.judge.skipped(i) ?? last;
      if (last) this.onJudged(last);
    }
  }

  private onJudged(j: Judgement): void {
    const judge = this.judge!;
    if (this.settings.audio.judgeSounds) this.player?.judged(j.grade);
    this.judged = { last: { ...j, id: ++this.judgeId }, counts: { ...judge.counts }, streak: judge.streak };
    if (judge.missStreak >= LOST_AFTER) {
      judge.missStreak = 0;
      // They have lost the beat: drop the cues, and the next step they play brings them back
      // aligned to it (that step is not judged).
      this.player?.dropActions();
      this.push('warn', 'Lost the beat — the track re-joins on your next step');
    }
  }

  private onTrackerEvent(e: TrackerEvent): void {
    this.recorder.onEvent(e);
    this.onRhythm(e);
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
