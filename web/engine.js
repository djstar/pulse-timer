// Pure timing engine. No DOM, no timers: every function takes `now` (epoch ms)
// explicitly and returns new objects, so it can be unit-tested with a fake clock.
//
// Time is never counted by a ticking loop. Every clock is
//   { accumulated: ms banked while paused, runningSince: epoch ms | null }
// and elapsed time is derived from it on demand.

export const PHASES = {
  prep: { label: 'Get ready', short: 'PREP' },
  work: { label: 'Work', short: 'WORK' },
  rest: { label: 'Rest', short: 'REST' },
  setrest: { label: 'Set rest', short: 'SET REST' },
  cool: { label: 'Cooldown', short: 'COOL DOWN' },
};

const START_CUE_GRACE_MS = 300; // a cue this late still plays; later ones are dropped

const toMs = (s) => Math.max(0, Math.round(Number(s) || 0)) * 1000;
const toCount = (n) => Math.max(1, Math.floor(Number(n) || 0));

export function elapsedOf(clock, now) {
  if (clock.runningSince == null) return clock.accumulated;
  return clock.accumulated + Math.max(0, now - clock.runningSince);
}

const isRunning = (clock) => clock.runningSince != null;

function pauseClock(clock, now) {
  if (!isRunning(clock)) return clock;
  return { ...clock, accumulated: elapsedOf(clock, now), runningSince: null };
}

function resumeClock(clock, now) {
  if (isRunning(clock)) return clock;
  return { ...clock, runningSince: now };
}

// ---------------------------------------------------------------- interval

/**
 * Compile an interval config into a flat list of segments.
 * cfg: { prepSec, workSec, restSec, rounds, cycles, setRestSec, coolSec, workMode: 'timed'|'open' }
 * An 'open' work segment has durationMs === null and ends only when the user taps Done.
 * The rest after the last round of each cycle is omitted.
 */
export function compileInterval(cfg) {
  const rounds = toCount(cfg.rounds);
  const cycles = toCount(cfg.cycles);
  const open = cfg.workMode === 'open';
  const segments = [];
  const push = (phase, durationMs, round = 0, cycle = 0) => {
    if (durationMs === null || durationMs > 0) {
      segments.push({ phase, durationMs, round, rounds, cycle, cycles });
    }
  };
  push('prep', toMs(cfg.prepSec));
  for (let c = 1; c <= cycles; c++) {
    for (let r = 1; r <= rounds; r++) {
      push('work', open ? null : toMs(cfg.workSec), r, c);
      if (r < rounds) push('rest', toMs(cfg.restSec), r, c);
    }
    if (c < cycles) push('setrest', toMs(cfg.setRestSec), 0, c);
  }
  push('cool', toMs(cfg.coolSec));
  return segments;
}

/** Total planned duration, or null if any work segment is open-ended. */
export function plannedDuration(segments) {
  let total = 0;
  for (const s of segments) {
    if (s.durationMs == null) return null;
    total += s.durationMs;
  }
  return total;
}

export function startRun(cfg, name, now) {
  const segments = compileInterval(cfg);
  const run = {
    name,
    cfg: { ...cfg },
    segments,
    index: 0,
    segStart: 0, // run-elapsed ms at which the current segment began
    accumulated: 0,
    runningSince: now,
    startedAt: now,
    finishedAt: null,
    done: false,
    revision: 0, // bumped by every user command; invalidates scheduled cues
  };
  return segments.length === 0 ? finish(run, 0, now) : normalize(run, now);
}

function finish(run, total, now) {
  return { ...run, index: run.segments.length, segStart: total, accumulated: total, runningSince: null, done: true, finishedAt: now };
}

export function runElapsed(run, now) {
  const r = normalize(run, now);
  return r.done ? r.accumulated : elapsedOf(r, now);
}

/** Advance past every timed segment that has fully elapsed by `now`. */
export function normalize(run, now) {
  if (run.done) return run;
  const t = elapsedOf(run, now);
  let { index, segStart } = run;
  while (index < run.segments.length) {
    const d = run.segments[index].durationMs;
    if (d == null || t - segStart < d) break;
    segStart += d;
    index++;
  }
  if (index === run.index) return run;
  if (index >= run.segments.length) {
    return finish({ ...run, index }, segStart, now - (t - segStart));
  }
  return { ...run, index, segStart };
}

export function runView(run, now) {
  const r = normalize(run, now);
  const t = runElapsed(r, now);
  const seg = r.segments[r.index] ?? null;
  const segElapsed = Math.max(0, t - r.segStart);
  const segRemaining = seg && seg.durationMs != null ? Math.max(0, seg.durationMs - segElapsed) : null;
  let remainingTotal = seg ? segRemaining : 0;
  for (let k = r.index + 1; k < r.segments.length && remainingTotal != null; k++) {
    const d = r.segments[k].durationMs;
    remainingTotal = d == null ? null : remainingTotal + d;
  }
  return {
    run: r,
    elapsed: t,
    seg,
    segElapsed,
    segRemaining,
    remainingTotal,
    next: r.segments[r.index + 1] ?? null,
    paused: !r.done && !isRunning(r),
    done: r.done,
  };
}

const bump = (run, patch) => ({ ...run, ...patch, revision: run.revision + 1 });

export function pauseRun(run, now) {
  const r = normalize(run, now);
  if (r.done || !isRunning(r)) return r;
  return bump(r, pauseClock(r, now));
}

export function resumeRun(run, now) {
  if (run.done || isRunning(run)) return run;
  return bump(run, resumeClock(run, now));
}

/** Skip the current segment (also ends an open-ended work segment). */
export function skipRun(run, now) {
  const r = normalize(run, now);
  if (r.done) return r;
  const t = elapsedOf(r, now);
  const index = r.index + 1;
  if (index >= r.segments.length) return bump(finish(r, t, now), {});
  return bump(r, { index, segStart: t });
}

/** Restart the current segment, or go to the previous one if within 3 s of its start. */
export function backRun(run, now) {
  const r = normalize(run, now);
  const t = runElapsed(r, now);
  const intoSegment = t - r.segStart;
  if (r.done) {
    // Reopen the last segment, paused.
    return bump(r, { done: false, finishedAt: null, index: r.segments.length - 1, segStart: t });
  }
  const index = intoSegment > 3000 || r.index === 0 ? r.index : r.index - 1;
  return bump(r, { index, segStart: t });
}

/** Add or remove time from the current timed segment. */
export function adjustRun(run, now, deltaMs) {
  const r = normalize(run, now);
  if (r.done) return r;
  const seg = r.segments[r.index];
  if (seg.durationMs == null) return r;
  const into = elapsedOf(r, now) - r.segStart;
  const durationMs = Math.max(into, seg.durationMs + deltaMs);
  const segments = r.segments.map((s, k) => (k === r.index ? { ...s, durationMs } : s));
  return normalize(bump(r, { segments }), now);
}

export function phaseSpeech(seg) {
  switch (seg.phase) {
    case 'work': {
      const set = seg.cycles > 1 && seg.round === 1 ? `Set ${seg.cycle}. ` : '';
      const last = seg.round === seg.rounds && seg.cycle === seg.cycles;
      return `${set}${last ? 'Last round' : `Round ${seg.round}`}. Work`;
    }
    case 'rest':
      return 'Rest';
    case 'setrest':
      return 'Set rest';
    case 'cool':
      return 'Cool down';
    default:
      return 'Get ready';
  }
}

/**
 * Cues for an interval run, due within `horizonMs` of `now`.
 * Each cue: { key, wall (epoch ms), kind: 'tick'|'start'|'speak'|'end', phase, text }.
 * Keys embed the run revision, so a user command invalidates every pending cue.
 */
export function intervalCues(run, now, horizonMs) {
  const r = normalize(run, now);
  if (r.done || !isRunning(r)) return [];
  const t = elapsedOf(r, now);
  const out = [];
  const add = (key, at, kind, phase, text = null) => {
    if (at >= t - START_CUE_GRACE_MS && at <= t + horizonMs) {
      out.push({ key: `run:${r.revision}:${key}`, wall: now + (at - t), kind, phase, text });
    }
  };
  let start = r.segStart;
  let k = r.index;
  for (; k < r.segments.length; k++) {
    if (start - t > horizonMs) return out;
    const s = r.segments[k];
    add(`${k}:start`, start, 'start', s.phase, phaseSpeech(s));
    const d = s.durationMs;
    if (d == null) return out; // nothing after an open segment can be predicted
    if (d >= 4000) for (const n of [3, 2, 1]) add(`${k}:t${n}`, start + d - n * 1000, 'tick', s.phase);
    if (s.phase === 'work' && d >= 30000) add(`${k}:half`, start + d / 2, 'speak', s.phase, 'Halfway');
    start += d;
  }
  add('end', start, 'end', 'end', 'Workout complete');
  return out;
}

// ---------------------------------------------------------------- stopwatch

export function newStopwatch(id, name) {
  return { id, name, accumulated: 0, runningSince: null, laps: [], createdAt: null };
}

export const swElapsed = elapsedOf;

export function swToggle(sw, now) {
  return isRunning(sw) ? pauseClock(sw, now) : resumeClock(sw, now);
}

export function swLap(sw, now) {
  const at = elapsedOf(sw, now);
  const last = sw.laps.at(-1)?.at ?? 0;
  if (at <= last) return sw;
  return { ...sw, laps: [...sw.laps, { at, label: '' }] };
}

export function swReset(sw) {
  return { ...sw, accumulated: 0, runningSince: null, laps: [] };
}

/** Lap rows newest first: { n, split, total, best, worst }. Best/worst only with 3+ laps. */
export function lapRows(laps) {
  const rows = laps.map((l, i) => ({ n: i + 1, total: l.at, split: l.at - (i ? laps[i - 1].at : 0), label: l.label }));
  if (rows.length >= 3) {
    const splits = rows.map((r) => r.split);
    const min = Math.min(...splits);
    const max = Math.max(...splits);
    for (const r of rows) {
      r.best = r.split === min;
      r.worst = r.split === max;
    }
  }
  return rows.reverse();
}

// ---------------------------------------------------------------- countdown timer

export function newTimer(id, name, durationMs) {
  return { id, name, durationMs, accumulated: 0, runningSince: null, revision: 0, alerted: false };
}

export const tmRemaining = (tm, now) => tm.durationMs - elapsedOf(tm, now);

export function tmToggle(tm, now) {
  const next = isRunning(tm) ? pauseClock(tm, now) : resumeClock(tm, now);
  return { ...next, revision: tm.revision + 1 };
}

export function tmReset(tm) {
  return { ...tm, accumulated: 0, runningSince: null, alerted: false, revision: tm.revision + 1 };
}

export function tmAdjust(tm, now, deltaMs) {
  const durationMs = Math.max(1000, tm.durationMs + deltaMs);
  const alerted = tm.alerted && durationMs <= elapsedOf(tm, now);
  return { ...tm, durationMs, alerted, revision: tm.revision + 1 };
}

export function timerCues(tm, now, horizonMs) {
  if (!isRunning(tm)) return [];
  const t = elapsedOf(tm, now);
  const out = [];
  const add = (key, at, kind, text = null) => {
    if (at >= t - START_CUE_GRACE_MS && at <= t + horizonMs) {
      out.push({ key: `tm:${tm.id}:${tm.revision}:${key}`, wall: now + (at - t), kind, phase: 'end', text });
    }
  };
  const d = tm.durationMs;
  if (d >= 4000) for (const n of [3, 2, 1]) add(`t${n}`, d - n * 1000, 'tick');
  add('end', d, 'end', `${tm.name} finished`);
  return out;
}

// ---------------------------------------------------------------- formatting

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Stopwatch style: floors, with hundredths. 1:02:03.45 or 02:03.45 */
export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 10));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  return `${h ? `${h}:${pad(m)}` : pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** Countdown style: rounds up to whole seconds, so "0:01" shows until it truly hits zero. */
export function fmtCount(ms) {
  const neg = ms < 0;
  const totalS = neg ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const body = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return neg ? `+${body}` : body;
}

/** Words for screen readers: "1 minute 5 seconds". */
export function fmtSpoken(ms) {
  const totalS = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor(totalS / 60) % 60;
  const s = totalS % 60;
  const part = (n, unit) => (n ? `${n} ${unit}${n === 1 ? '' : 's'}` : '');
  return [part(h, 'hour'), part(m, 'minute'), part(s, 'second')].filter(Boolean).join(' ') || '0 seconds';
}
