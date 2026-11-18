// Turns a run's numbers into a verdict and a short list of things to work on next. Pure, so the
// wording rules are tested without the UI.

import type { TurnRow } from './breakdown';
import type { FlatStep } from './engine';
import { onBeat } from './rhythm';
import type { SessionSummary } from './types';

export type Tone = 'good' | 'ok' | 'bad';

export interface Tip {
  /** `fix`: something to work on; `good`: something that went well. */
  kind: 'fix' | 'good';
  title: string;
  detail: string;
  /** Flattened step the tip is about, highlighted on the rotation map. */
  step?: number;
}

export interface Verdict {
  score: number | null;
  scoreLabel: string;
  tone: Tone;
  headline: string;
  sub: string;
  tips: Tip[];
}

export interface CoachInput {
  run: SessionSummary;
  steps: FlatStep[];
  /** Character names by slot. */
  names: string[];
  /** Per-step statistics were recorded on the current rotation. */
  sameRotation: boolean;
  /** Human description of a flattened step, e.g. "Xingqiu's Q". */
  describe: (i: number) => string;
  /** Character turns with planned and measured times, when known. */
  turns?: TurnRow[];
}

const toneOf = (v: number | null): Tone => (v === null ? 'ok' : v >= 0.9 ? 'good' : v >= 0.75 ? 'ok' : 'bad');
const s1 = (ms: number) => `${(Math.abs(ms) / 1000).toFixed(1)}s`;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const msWord = (x: number) => `${Math.abs(Math.round(x))} ms ${x < 0 ? 'early' : 'late'}`;

export function coach({ run, steps, names, sameRotation, describe, turns }: CoachInput): Verdict {
  const m = run.metrics;
  const rh = m?.rhythm ?? null;
  const beat = rh ? onBeat(rh.counts) : null;
  const score = beat ?? run.accuracy;
  const tone = toneOf(score);
  const tips: Tip[] = [];

  const laps = m?.laps ?? [];
  const avgLap = laps.length ? avg(laps.map((l) => l.ms)) : null;
  const over = m?.targetMs && avgLap !== null ? (avgLap - m.targetMs) / m.targetMs : null;

  // Headline: one sentence on what kind of run this was.
  let headline: string;
  let sub: string;
  if (rh && beat !== null) {
    if (beat >= 0.85 && (rh.meanMs === null || Math.abs(rh.meanMs) < 30)) headline = 'Locked to the beat';
    else if (rh.meanMs !== null && Math.abs(rh.meanMs) >= 30) headline = rh.meanMs > 0 ? 'Dragging behind the beat' : 'Rushing ahead of the beat';
    else if (tone === 'bad') headline = 'Lost the groove';
    else headline = 'Mostly in time';
    sub = `${Math.round(beat * 100)}% of steps on the beat, best streak ${rh.bestStreak}.`;
  } else if (!laps.length) {
    headline = tone === 'bad' ? 'The rotation fell apart' : 'No full lap yet';
    sub = 'Finish a whole rotation to get lap times.';
  } else if (tone === 'good' && (over === null || over <= 0.05)) {
    headline = over === null ? 'Clean execution' : 'Clean and on pace';
    sub = `${run.cleanLaps} of ${run.laps} laps without a mistake.`;
  } else if (tone === 'good') {
    headline = 'Right inputs, too slow';
    sub = `Laps average ${s1(avgLap! - m!.targetMs!)} over the ${m!.targetMs! / 1000}s target.`;
  } else if (tone === 'bad') {
    headline = 'The rotation is breaking down';
    sub = `${Math.round(run.accuracy * 100)}% of judged steps went right.`;
  } else {
    headline = 'Getting there';
    sub = `${run.cleanLaps} of ${run.laps} laps clean.`;
  }

  if (!m) return { score, scoreLabel: rh ? 'on beat' : 'accuracy', tone, headline, sub, tips };

  // 1. The step that keeps going wrong.
  if (sameRotation) {
    const errs = steps.map((_, i) => (m.steps.missed[i] ?? 0) + (m.steps.wrong[i] ?? 0));
    const total = errs.reduce((a, b) => a + b, 0);
    const worst = errs.reduce((best, e, i) => (e > errs[best] ? i : best), 0);
    if (total > 0 && errs[worst] >= 2) {
      const missed = m.steps.missed[worst] ?? 0;
      const wrong = m.steps.wrong[worst] ?? 0;
      const parts = [missed && `skipped ${missed}×`, wrong && `wrong input ${wrong}×`].filter(Boolean).join(', ');
      tips.push({
        kind: 'fix',
        title: `Drill ${describe(worst)}`,
        detail: `${parts[0].toUpperCase()}${parts.slice(1)}: ${Math.round((errs[worst] / total) * 100)}% of this run's mistakes happen here.`,
        step: worst,
      });
    }
  }

  // 2. Timing bias and consistency (rhythm only).
  if (rh?.meanMs != null && Math.abs(rh.meanMs) >= 30) {
    tips.push({
      kind: 'fix',
      title: `You play ${msWord(rh.meanMs)}`,
      detail: `If that felt on time, recalibrate latency in Settings (now ${rh.latencyMs} ms). Otherwise aim ${rh.meanMs > 0 ? 'earlier' : 'later'}.`,
    });
  }
  if (rh?.spreadMs != null && rh.spreadMs >= 70) {
    tips.push({
      kind: 'fix',
      title: `Timing wanders ±${Math.round(rh.spreadMs)} ms`,
      detail: 'Press with the cue, not after hearing it. Steady beats fast here.',
    });
  }

  // 3. Pace against the target.
  if (over !== null && over > 0.05) {
    tips.push({
      kind: 'fix',
      title: `${s1(avgLap! - m.targetMs!)} slower than target per lap`,
      detail:
        run.accuracy >= 0.9
          ? 'Inputs are right, so the time is lost between them: swap the moment an animation can be cancelled.'
          : 'Get the order clean first; speed comes once the inputs stop going wrong.',
    });
  }

  // 3b. The turn that loses the most time against the plan.
  const longest = (turns ?? [])
    .filter((t) => t.actualMs !== null)
    .map((t) => ({ t, over: t.actualMs! - t.planMs }))
    .sort((a, b) => b.over - a.over)[0];
  if (longest && longest.over >= 600 && longest.over >= longest.t.planMs * 0.25) {
    tips.push({
      kind: 'fix',
      title: `${names[longest.t.slot]}'s turn runs ${s1(longest.over)} long`,
      detail: `It takes ${s1(longest.t.actualMs!)} against ${s1(longest.t.planMs)} planned: the biggest time sink in the rotation.`,
      step: longest.t.items.find((x) => x.s.action !== 'swap')?.i,
    });
  }

  // 4. Weakest character.
  const judged = m.chars.map((c, i) => ({ i, n: c.hits + c.missed + c.wrong, acc: c.hits / Math.max(1, c.hits + c.missed + c.wrong) }));
  const weak = judged.filter((c) => c.n >= 4).sort((a, b) => a.acc - b.acc)[0];
  if (weak && weak.acc < 0.8 && run.accuracy - weak.acc >= 0.1) {
    tips.push({
      kind: 'fix',
      title: `${names[weak.i]} is the weak link`,
      detail: `${Math.round(weak.acc * 100)}% of their steps went right, against ${Math.round(run.accuracy * 100)}% overall.`,
    });
  }

  // 5. How lap times moved through the run.
  if (laps.length >= 4) {
    const half = Math.floor(laps.length / 2);
    const first = avg(laps.slice(0, half).map((l) => l.ms));
    const last = avg(laps.slice(-half).map((l) => l.ms));
    if (last > first * 1.08) {
      tips.push({ kind: 'fix', title: 'Laps got slower as you went', detail: `${s1(last - first)} slower by the end. Shorter runs with breaks may train better.` });
    } else if (last < first * 0.92) {
      tips.push({ kind: 'good', title: 'Laps got faster as you went', detail: `${s1(first - last)} quicker by the end of the run.` });
    }
  }

  // 6. Time spent lost.
  if (m.trackedMs > 0 && m.offTrackMs > m.trackedMs * 0.15) {
    tips.push({
      kind: 'fix',
      title: 'Lost the rotation often',
      detail: `${Math.round((m.offTrackMs / (m.trackedMs + m.offTrackMs)) * 100)}% of the run was spent off track. Slow down until the order sticks.`,
    });
  }

  if (!tips.some((t) => t.kind === 'fix')) {
    tips.push({
      kind: 'good',
      title: 'Nothing to fix this run',
      detail: rh
        ? 'Keep it up, then record a faster clean lap as the new track.'
        : m.targetMs
          ? 'Push it: lower the rotation time in the editor, or try Rhythm mode.'
          : 'Set a rotation time in the editor to start training pace.',
    });
  }

  const fixes = tips.filter((t) => t.kind === 'fix').slice(0, 3);
  const goods = tips.filter((t) => t.kind === 'good').slice(0, 3 - fixes.length || 1);
  return { score, scoreLabel: rh ? 'on beat' : 'accuracy', tone, headline, sub, tips: [...fixes, ...goods].slice(0, 3) };
}
