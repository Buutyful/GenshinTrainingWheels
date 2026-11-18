// Takes the README screenshots: drives headless Microsoft Edge (or Chrome) over the DevTools
// protocol against the dev server, with demo loadouts and runs, and writes docs/screenshots/*.png.
//
//   npm run dev                         (in another terminal)
//   node scripts/screenshots.mjs        [http://localhost:1420]
//
// Needs no packages: Node's built-in WebSocket speaks to the browser. The browser profile is a
// throwaway folder, so nothing touches your own data.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_BASE = process.argv[2] ?? 'http://localhost:1420';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/screenshots');
const PORT = 9333;
const WIDTH = 1280;
const HEIGHT = 860;
const SCALE = 2;

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- browser

const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('No Edge or Chrome found.');
const profile = mkdtempSync(join(tmpdir(), 'gtw-shots-'));
const browser = spawn(exe, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  '--hide-scrollbars',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  'about:blank',
]);

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    /* not up yet */
  }
}
if (!target) throw new Error('The browser did not start.');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
let seq = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    const { ok, fail } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((ok, fail) => {
    const id = ++seq;
    waiting.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });

/** Runs `fn` (async, no closures) in the page with `args`, returns its JSON result. */
async function run(fn, ...args) {
  const r = await send('Runtime.evaluate', {
    expression: `(${fn.toString()})(...${JSON.stringify(args)})`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function load(path = '/') {
  await send('Page.navigate', { url: URL_BASE + path });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if (await run(() => document.readyState === 'complete' && !!document.querySelector('header.bar')).catch(() => false)) break;
  }
  await hideBrowserNotice();
  await sleep(400);
}

/** The browser build warns that it only hears keys while focused; the desktop app does not. */
const hideBrowserNotice = () =>
  run(() => {
    const hide = () =>
      document.querySelectorAll('.notice').forEach((n) => {
        if (n.textContent.trim().startsWith('Practice mode.')) n.style.display = 'none';
      });
    hide();
    new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
    // A sticky header would cover the top of shots taken further down the page.
    const css = document.createElement('style');
    css.textContent = 'header.bar { position: static !important; }';
    document.head.append(css);
  });

/** Clicks a button by its text, inside the loadout card titled `card` when given. */
const click = (text, card) =>
  run(
    (text, card) => {
      const scope = card ? [...document.querySelectorAll('article.card')].find((a) => a.querySelector('h3')?.textContent === card) : document;
      const b = [...(scope?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === text);
      if (!b) throw new Error(`No button "${text}"`);
      b.click();
    },
    text,
    card ?? null,
  ).then(() => sleep(350));

/**
 * Saves a screenshot. `from`/`to` are selectors whose boxes bound the shot vertically (the
 * whole viewport when omitted); the width is always the full page.
 */
async function shot(name, { from, to, pad = 20, top, tight = false } = {}) {
  await sleep(300);
  const box = await run(
    (from, to, pad, top, tight) => {
      const el = (s) => (s ? document.querySelector(s) : null);
      const a = el(from);
      const b = el(to) ?? a;
      if (from && !a) throw new Error(`Nothing matches ${from}`);
      if (a) a.scrollIntoView({ block: 'start' });
      const y0 = top ?? (a ? a.getBoundingClientRect().top + scrollY - pad : scrollY);
      const y1 = b ? b.getBoundingClientRect().bottom + scrollY + pad : y0 + innerHeight;
      // Tight: only the page's content column, without the empty sides.
      const col = document.querySelector('main.page')?.getBoundingClientRect();
      const x = tight && col ? Math.max(0, col.left - pad) : 0;
      const w = tight && col ? Math.min(innerWidth, col.right + pad) - x : innerWidth;
      return { x, w, y: Math.max(0, y0), h: y1 - Math.max(0, y0) };
    },
    from ?? null,
    to ?? null,
    pad,
    top ?? null,
    tight,
  );
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: box.x, y: box.y, width: Math.round(box.w), height: Math.round(box.h), scale: 1 },
  });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  ${name}.png  ${Math.round(box.w * SCALE)}×${Math.round(box.h * SCALE)}`);
}

// ---------------------------------------------------------------- demo data

/** Builds the demo loadouts with the app's own modules, so they are always valid. */
async function seed() {
  const { flatten } = await import('/src/lib/engine.ts');
  const { timingSig, resolveTimings } = await import('/src/lib/timing.ts');
  const { buildTrack } = await import('/src/lib/music/arrange.ts');
  const { ladderKey } = await import('/src/lib/ladder.ts');
  const { DEFAULT_SETTINGS } = await import('/src/lib/defaults.ts');

  let rnd = 7;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const DAY = 86400000;
  const now = Date.now();
  const C = {
    raiden: { name: 'Raiden Shogun', element: 'electro', id: 'raiden-shogun' },
    xingqiu: { name: 'Xingqiu', element: 'hydro', id: 'xingqiu' },
    bennett: { name: 'Bennett', element: 'pyro', id: 'bennett' },
    xiangling: { name: 'Xiangling', element: 'pyro', id: 'xiangling' },
    hutao: { name: 'Hu Tao', element: 'pyro', id: 'hu-tao' },
    yelan: { name: 'Yelan', element: 'hydro', id: 'yelan' },
    zhongli: { name: 'Zhongli', element: 'geo', id: 'zhongli' },
    neuv: { name: 'Neuvillette', element: 'hydro', id: 'neuvillette' },
    furina: { name: 'Furina', element: 'hydro', id: 'furina' },
    kazuha: { name: 'Kaedehara Kazuha', element: 'anemo', id: 'kaedehara-kazuha' },
  };
  const S = (slot, action, extra = {}) => ({ slot, action, ...extra });

  function loadout(id, name, characters, steps, rotationSec) {
    const l = { id, name, characters, steps, loop: true, loopStart: 0, rotationSec, history: [] };
    const fl = flatten(steps, true, 0);
    const sig = timingSig(steps, true, 0);
    const t = resolveTimings(undefined, fl, sig);
    // Planned step durations scaled to the rotation time: the "learned" pace.
    const raw = fl.map((_, i) => t.gap[i === 0 ? fl.length - 1 : i - 1] + t.span[i]);
    const k = (rotationSec * 1000) / raw.reduce((a, b) => a + b, 0);
    t.gap = t.gap.map((g) => Math.round(g * k));
    t.span = t.span.map((s) => Math.round(s * k));
    l.timings = t;
    return { l, fl, sig, plan: raw.map((d) => d * k) };
  }

  /** One run: `pace` scales lap time, `slow` marks steps that drag, `errs` [step, missed, wrong]. */
  function addRun(d, { daysAgo, laps, clean, pace, slow = [], errs = [], rhythm = null }) {
    const { l, fl, sig, plan } = d;
    const dur = plan.map((p, i) => Math.round(p * pace * (slow.includes(i) ? 1.45 : 1) * (0.96 + rand() * 0.08)));
    const lapBase = dur.reduce((a, b) => a + b, 0);
    const lapMs = Array.from({ length: laps }, (_, i) => Math.round(lapBase * (1.04 - (0.08 * i) / laps + rand() * 0.04)));
    const cleanIdx = new Set([...lapMs.keys()].sort((a, b) => lapMs[a] - lapMs[b]).slice(0, clean));
    const missed = fl.map(() => 0);
    const wrong = fl.map(() => 0);
    for (const [i, m, w] of errs) {
      missed[i] = m;
      wrong[i] = w;
    }
    const chars = [0, 1, 2, 3].map(() => ({ fieldMs: 0, actions: {}, hits: 0, missed: 0, wrong: 0, entries: 0 }));
    fl.forEach((s, i) => {
      const c = chars[s.slot];
      c.fieldMs += dur[i] * laps;
      if (s.action === 'swap') c.entries += laps;
      else c.actions[s.action] = (c.actions[s.action] ?? 0) + laps * (s.action === 'na' ? s.count : 1);
      if (!['na', 'ca', 'dash', 'jump'].includes(s.action)) c.hits += laps - missed[i];
      c.missed += missed[i];
      c.wrong += wrong[i];
    });
    const hits = chars.reduce((a, c) => a + c.hits, 0);
    const bad = chars.reduce((a, c) => a + c.missed + c.wrong, 0);
    const best = Math.min(...lapMs.filter((_, i) => cleanIdx.has(i)));
    const metrics = {
      chars,
      laps: lapMs.map((ms, i) => ({ ms, clean: cleanIdx.has(i), errors: cleanIdx.has(i) ? 0 : 1 + Math.floor(rand() * 2) })),
      targetMs: l.rotationSec * 1000,
      trackedMs: lapMs.reduce((a, b) => a + b, 0),
      offTrackMs: Math.round(rand() * 6000),
      pausedMs: Math.round(rand() * 4000),
      swaps: chars.reduce((a, c) => a + c.entries, 0),
      inputs: chars.reduce((a, c) => a + Object.values(c.actions).reduce((x, y) => x + y, 0), 0),
      steps: { sig, missed, wrong, durMs: dur, durN: fl.map(() => laps) },
    };
    if (rhythm) {
      const means = fl.map((s, i) => Math.round(rhythm.mean + (rand() - 0.5) * rhythm.spread * 1.6 + (slow.includes(i) ? 55 : 0)));
      metrics.rhythm = {
        counts: rhythm.counts,
        meanMs: rhythm.mean,
        spreadMs: rhythm.spread,
        bestStreak: rhythm.streak,
        latencyMs: 40,
        steps: { sig, n: fl.map(() => laps), meanMs: means, misses: missed },
      };
    }
    l.history.push({
      date: now - daysAgo * DAY - Math.round(rand() * 6) * 3600000,
      durationMs: metrics.trackedMs + metrics.offTrackMs + metrics.pausedMs,
      laps,
      cleanLaps: clean,
      accuracy: hits / Math.max(1, hits + bad),
      bestLapMs: clean ? best : null,
      avgLapMs: Math.round(lapMs.reduce((a, b) => a + b, 0) / laps),
      metrics,
    });
    return { dur, lapBase };
  }

  /** A rhythm track made by the app from one of the demo's clean laps. */
  function track(d, dur) {
    const start = [];
    let t = 0;
    d.fl.forEach((_, i) => {
      t += dur[i];
      start.push(t);
    });
    const end = start.map((s, i) => s + d.l.timings.span[i]);
    d.l.track = buildTrack(d.fl, true, { start, end, ref: null, next: null }, d.l.timings, now - 3 * DAY);
  }

  // --- Raiden National: the star of the screenshots.
  const ra = loadout(
    'demo-raiden',
    'Raiden National',
    [C.raiden, C.xingqiu, C.bennett, C.xiangling],
    [
      S(0, 'skill', { note: 'Eye of Stormy Judgement: burst DMG bonus for the whole team for 25 s.' }),
      S(1, 'burst', { note: 'Rain Swords up first so Xiangling and Raiden get Hydro to react with.' }),
      S(1, 'skill'),
      S(2, 'burst', { note: 'ATK buff field: everyone after this has to stand in it.' }),
      S(2, 'skill'),
      S(3, 'burst', { note: 'Pyronado then Guoba: off-field Pyro for the next ~10 s.' }),
      S(3, 'skill'),
      S(0, 'burst', { note: 'Musou Isshin damage window: stay inside Bennett’s circle until the CA.' }),
      S(0, 'na', { count: 3 }),
      S(0, 'ca'),
      S(0, 'na', { count: 3 }),
      S(0, 'ca'),
    ],
    21,
  );
  const plan = [
    [13, 6, 2, 1.18, [7], [[7, 2, 1], [5, 1, 0], [9, 0, 1]]],
    [11, 8, 3, 1.14, [7], [[7, 2, 0], [9, 1, 1]]],
    [9, 7, 3, 1.1, [7, 9], [[7, 1, 1], [3, 0, 1]]],
    [6, 9, 5, 1.07, [7], [[7, 2, 0], [12, 1, 0]]],
    [3, 8, 5, 1.05, [7], [[7, 1, 1]]],
  ];
  let lastDur;
  for (const [daysAgo, laps, clean, pace, slow, errs] of plan) lastDur = addRun(ra, { daysAgo, laps, clean, pace, slow, errs }).dur;
  const fin = addRun(ra, { daysAgo: 0, laps: 9, clean: 6, pace: 1.03, slow: [7, 8], errs: [[7, 3, 1], [5, 1, 0], [11, 0, 1]] });
  track(ra, fin.dur ?? lastDur);
  const key = ladderKey(ra.l);
  const friend = (player, bestLapMs, accuracy, cleanLaps, laps, daysAgo, mode = 'practice', onBeat) => ({
    player,
    key,
    date: now - daysAgo * DAY,
    mode,
    bestLapMs,
    avgLapMs: bestLapMs ? bestLapMs + 900 : null,
    accuracy,
    cleanLaps,
    laps,
    durationMs: laps * 23000,
    ...(mode === 'rhythm' ? { onBeat } : {}),
  });
  ra.l.ladder = [
    friend('Kiri', 20100, 0.97, 8, 10, 1),
    friend('mossy', 21900, 0.93, 5, 9, 2, 'rhythm', 0.81),
    friend('Aether_Main', 23400, 0.88, 3, 7, 4),
    friend('nyx', null, 0.71, 0, 5, 6),
  ];

  // --- Hu Tao: played in rhythm mode.
  const ht = loadout(
    'demo-hutao',
    'Hu Tao Double Hydro',
    [C.hutao, C.xingqiu, C.yelan, C.zhongli],
    [S(2, 'burst'), S(2, 'skill'), S(1, 'burst'), S(1, 'skill'), S(3, 'skillHold'), S(0, 'skill'), S(0, 'na', { count: 1 }), S(0, 'ca'), S(0, 'na', { count: 1 }), S(0, 'ca'), S(0, 'na', { count: 1 }), S(0, 'ca'), S(0, 'burst')],
    20,
  );
  addRun(ht, { daysAgo: 5, laps: 6, clean: 3, pace: 1.1, slow: [5], errs: [[5, 1, 1], [9, 0, 1]] });
  const hr = addRun(ht, {
    daysAgo: 1,
    laps: 8,
    clean: 5,
    pace: 1.02,
    slow: [5],
    errs: [[5, 1, 0], [11, 0, 1]],
    rhythm: { counts: { perfect: 41, good: 33, early: 6, late: 14, miss: 3 }, mean: 31, spread: 58, streak: 22 },
  });
  track(ht, hr.dur);

  // --- Neuvillette: imported, barely practised.
  const nv = loadout(
    'demo-neuv',
    'Neuvillette Hypercarry',
    [C.neuv, C.furina, C.kazuha, C.zhongli],
    [S(3, 'skillHold'), S(1, 'skill'), S(1, 'burst'), S(2, 'skill'), S(2, 'burst'), S(0, 'skill'), S(0, 'burst'), S(0, 'ca'), S(0, 'ca')],
    22,
  );
  addRun(nv, { daysAgo: 2, laps: 4, clean: 1, pace: 1.2, slow: [3], errs: [[3, 2, 1], [7, 1, 0]] });

  const data = {
    version: 1,
    loadouts: [ra.l, ht.l, nv.l],
    settings: { ...structuredClone(DEFAULT_SETTINGS), playerName: 'Traveler' },
  };
  localStorage.setItem('genshin-training-wheels-data', JSON.stringify(data));
}

// ---------------------------------------------------------------- scenes

/** Plays keys in the browser build: it listens on the page while it has focus. */
const play = (moves) =>
  run(async (moves) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const [code, gap] of moves) {
      if (code.startsWith('Mouse')) {
        document.body.dispatchEvent(new MouseEvent('mousedown', { button: Number(code.slice(5)), bubbles: true }));
        await wait(60);
        document.body.dispatchEvent(new MouseEvent('mouseup', { button: Number(code.slice(5)), bubbles: true }));
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        await wait(70);
        window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      }
      await wait(gap);
    }
  }, moves);

try {
  mkdirSync(OUT, { recursive: true });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  console.log(`Screenshots from ${URL_BASE} into ${OUT}`);
  await load('/');
  await run(seed);
  await load('/');

  // Home: the loadouts.
  await shot('home', { top: 0, to: 'main .grid' });

  // Editor.
  await click('Edit', 'Raiden National');
  await hideBrowserNotice();
  await shot('editor', { top: 0 });

  // A practice run in progress.
  await load('/');
  await click('Practice', 'Raiden National');
  await hideBrowserNotice();
  await click('Start');
  await play([
    ['KeyE', 900],
    ['Digit2', 300],
    ['KeyQ', 1300],
    ['KeyE', 600],
    ['Digit3', 300],
    ['KeyQ', 1200],
    ['KeyE', 600],
    ['Digit4', 400],
  ]);
  await shot('practice', { top: 0, to: 'section.feed' });
  await play([['F10', 300]]);

  // The run recap and ladder, from the seeded history (the practice run above is dropped).
  await run(seed);
  await load('/');
  await click('Metrics', 'Raiden National');
  await shot('ladder', { from: 'main .panel:has(.ladder)', pad: 16, tight: true });
  await shot('recap', { from: 'section.hero', to: 'main .panel:has(.bd)', pad: 16, tight: true });

  // Rhythm timing, from the Hu Tao rhythm run.
  await load('/');
  await click('Metrics', 'Hu Tao Double Hydro');
  await shot('timing', { from: 'main .panel:has(.ruler)', pad: 16, tight: true });
} finally {
  ws.close();
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
