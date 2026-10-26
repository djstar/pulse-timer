import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileInterval, plannedDuration, startRun, runView, pauseRun, resumeRun, skipRun, backRun, adjustRun,
  intervalCues, normalize, runElapsed, newStopwatch, swToggle, swSetEvery, stopwatchCues, swLap, swReset, swElapsed, lapRows,
  newTimer, tmToggle, tmAdjust, tmRemaining, timerCues, tmReset, fmtClock, fmtCount, fmtSpoken, phaseSpeech,
} from './engine.js';

const TABATA = { prepSec: 10, workSec: 20, restSec: 10, rounds: 8, cycles: 1, setRestSec: 0, coolSec: 0, workMode: 'timed' };
const T0 = 1_700_000_000_000;

test('tabata compiles to prep + 8 work + 7 rest, 4:00 total', () => {
  const segs = compileInterval(TABATA);
  assert.equal(segs.length, 1 + 8 + 7);
  assert.equal(segs[0].phase, 'prep');
  assert.equal(segs.at(-1).phase, 'work');
  assert.equal(plannedDuration(segs), 10_000 + 8 * 20_000 + 7 * 10_000);
});

test('cycles insert set rest between cycles only, and cooldown at the end', () => {
  const segs = compileInterval({ ...TABATA, prepSec: 0, rounds: 2, cycles: 3, setRestSec: 60, coolSec: 30 });
  assert.deepEqual(segs.map((s) => s.phase), [
    'work', 'rest', 'work', 'setrest', 'work', 'rest', 'work', 'setrest', 'work', 'rest', 'work', 'cool',
  ]);
});

test('zero-length phases are dropped; open work has null duration', () => {
  const segs = compileInterval({ ...TABATA, prepSec: 0, restSec: 0, rounds: 3, workMode: 'open' });
  assert.equal(segs.length, 3);
  assert.ok(segs.every((s) => s.durationMs === null));
  assert.equal(plannedDuration(segs), null);
});

test('run advances through phases by wall time alone', () => {
  const run = startRun(TABATA, 'Tabata', T0);
  assert.equal(runView(run, T0 + 9_999).seg.phase, 'prep');
  const v = runView(run, T0 + 10_000);
  assert.equal(v.seg.phase, 'work');
  assert.equal(v.seg.round, 1);
  assert.equal(v.segRemaining, 20_000);
  assert.equal(runView(run, T0 + 30_500).seg.phase, 'rest');
  const done = runView(run, T0 + 250_000);
  assert.ok(done.done);
  assert.equal(done.elapsed, 240_000);
  assert.equal(done.run.finishedAt, T0 + 240_000);
});

test('pause across a boundary freezes time; resume continues', () => {
  let run = startRun(TABATA, 'T', T0);
  run = pauseRun(run, T0 + 5_000);
  assert.equal(runView(run, T0 + 999_999).seg.phase, 'prep');
  assert.equal(runView(run, T0 + 999_999).segRemaining, 5_000);
  run = resumeRun(run, T0 + 1_000_000);
  assert.equal(runView(run, T0 + 1_005_000).seg.phase, 'work');
});

test('skip and back', () => {
  let run = startRun(TABATA, 'T', T0);
  run = skipRun(run, T0 + 2_000);
  let v = runView(run, T0 + 2_000);
  assert.equal(v.seg.phase, 'work');
  assert.equal(v.segRemaining, 20_000);
  run = backRun(run, T0 + 3_000); // within 3 s → previous segment
  v = runView(run, T0 + 3_000);
  assert.equal(v.seg.phase, 'prep');
  assert.equal(v.segRemaining, 10_000);
  run = backRun(run, T0 + 8_000); // 5 s in → restart current
  assert.equal(runView(run, T0 + 8_000).segRemaining, 10_000);
});

test('adjust adds time and removing past zero advances', () => {
  let run = startRun(TABATA, 'T', T0);
  run = adjustRun(run, T0 + 4_000, 10_000);
  assert.equal(runView(run, T0 + 4_000).segRemaining, 16_000);
  run = adjustRun(run, T0 + 5_000, -60_000);
  assert.equal(runView(run, T0 + 5_000).seg.phase, 'work');
});

test('open work waits for skip, then rest is timed', () => {
  let run = startRun({ ...TABATA, prepSec: 0, workMode: 'open', rounds: 2, restSec: 30 }, 'Sets', T0);
  const v = runView(run, T0 + 600_000);
  assert.equal(v.seg.phase, 'work');
  assert.equal(v.segElapsed, 600_000);
  assert.equal(v.remainingTotal, null);
  run = skipRun(run, T0 + 45_000);
  assert.equal(runView(run, T0 + 45_000).seg.phase, 'rest');
  assert.equal(runView(run, T0 + 75_000).seg.phase, 'work');
  run = skipRun(run, T0 + 80_000);
  assert.ok(runView(run, T0 + 80_000).done);
});

test('back from done reopens the last segment paused', () => {
  let run = startRun(TABATA, 'T', T0);
  run = normalize(run, T0 + 500_000);
  assert.ok(run.done);
  run = backRun(run, T0 + 500_000);
  const v = runView(run, T0 + 600_000);
  assert.ok(!v.done && v.paused);
  assert.equal(v.seg.round, 8);
});

test('cues: 3-2-1 ticks, start speech, halfway, end; keys change with revision', () => {
  const cfg = { ...TABATA, prepSec: 5, workSec: 40, rounds: 1 };
  const run = startRun(cfg, 'T', T0);
  const cues = intervalCues(run, T0, 60_000);
  const keys = cues.map((c) => c.key.split(':').slice(2).join(':'));
  assert.deepEqual(keys, ['0:start', '0:t3', '0:t2', '0:t1', '1:start', '1:t3', '1:t2', '1:t1', '1:half', 'end']);
  assert.equal(cues.find((c) => c.key.endsWith('1:start')).wall, T0 + 5_000);
  assert.equal(cues.find((c) => c.key.endsWith('end')).wall, T0 + 45_000);
  const paused = pauseRun(run, T0 + 1_000);
  assert.deepEqual(intervalCues(paused, T0 + 1_000, 60_000), []);
  const resumed = resumeRun(paused, T0 + 2_000);
  assert.ok(intervalCues(resumed, T0 + 2_000, 60_000).every((c) => c.key.startsWith('run:2:')));
});

test('cues stop at an open segment and respect the horizon', () => {
  const run = startRun({ ...TABATA, prepSec: 10, workMode: 'open' }, 'T', T0);
  const cues = intervalCues(run, T0 + 8_000, 60_000);
  assert.deepEqual(cues.map((c) => c.kind), ['tick', 'tick', 'start']);
  assert.deepEqual(intervalCues(run, T0, 1_000).map((c) => c.kind), ['start']);
});

test('speech text', () => {
  assert.equal(phaseSpeech({ phase: 'work', round: 3, rounds: 8, cycle: 1, cycles: 1 }), 'Round 3. Work');
  assert.equal(phaseSpeech({ phase: 'work', round: 8, rounds: 8, cycle: 1, cycles: 1 }), 'Last round. Work');
  assert.equal(phaseSpeech({ phase: 'work', round: 1, rounds: 8, cycle: 2, cycles: 3 }), 'Set 2. Round 1. Work');
});

test('stopwatch: toggle, laps, best/worst, reset', () => {
  let sw = newStopwatch('a', 'Stopwatch 1');
  sw = swToggle(sw, T0);
  sw = swLap(sw, T0 + 10_000);
  sw = swLap(sw, T0 + 10_000); // zero-length lap ignored
  sw = swLap(sw, T0 + 25_000);
  sw = swToggle(sw, T0 + 30_000);
  assert.equal(swElapsed(sw, T0 + 99_000), 30_000);
  sw = swToggle(sw, T0 + 100_000);
  sw = swLap(sw, T0 + 102_000);
  const rows = lapRows(sw.laps);
  assert.deepEqual(rows.map((r) => r.split), [7_000, 15_000, 10_000]);
  assert.ok(rows[0].best && rows[1].worst);
  assert.equal(swReset(sw).laps.length, 0);
});

test('timer: remaining, overtime, adjust, cues', () => {
  let tm = newTimer('t', 'Tea', 180_000);
  tm = tmToggle(tm, T0);
  assert.equal(tmRemaining(tm, T0 + 60_000), 120_000);
  assert.equal(tmRemaining(tm, T0 + 200_000), -20_000);
  tm = tmAdjust(tm, T0 + 60_000, 30_000);
  assert.equal(tmRemaining(tm, T0 + 60_000), 150_000);
  const cues = timerCues(tm, T0 + 207_500, 5_000);
  assert.deepEqual(cues.map((c) => c.kind), ['tick', 'tick', 'end']);
  assert.equal(cues.at(-1).text, 'Tea finished');
  assert.equal(tmRemaining(tmReset(tm), T0 + 999_999), 210_000);
});

test('formatting', () => {
  assert.equal(fmtClock(0), '00:00.00');
  assert.equal(fmtClock(83_456), '01:23.45');
  assert.equal(fmtClock(3_723_450), '1:02:03.45');
  assert.equal(fmtCount(400), '0:01');
  assert.equal(fmtCount(0), '0:00');
  assert.equal(fmtCount(65_000), '1:05');
  assert.equal(fmtCount(-12_300), '+0:12');
  assert.equal(fmtSpoken(65_000), '1 minute 5 seconds');
  assert.equal(fmtSpoken(0), '0 seconds');
});

test('property: random command sequences keep invariants', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let trial = 0; trial < 300; trial++) {
    const cfg = {
      prepSec: Math.floor(rand() * 15), workSec: 1 + Math.floor(rand() * 60), restSec: Math.floor(rand() * 30),
      rounds: 1 + Math.floor(rand() * 8), cycles: 1 + Math.floor(rand() * 3), setRestSec: Math.floor(rand() * 60),
      coolSec: Math.floor(rand() * 30), workMode: rand() < 0.2 ? 'open' : 'timed',
    };
    let now = T0;
    let run = startRun(cfg, 'P', now);
    let lastElapsed = 0;
    for (let step = 0; step < 60; step++) {
      now += Math.floor(rand() * 20_000);
      const ops = [pauseRun, resumeRun, skipRun, backRun, (r, n) => adjustRun(r, n, rand() < 0.5 ? 10_000 : -10_000), normalize];
      run = ops[Math.floor(rand() * ops.length)](run, now);
      const v = runView(run, now);
      assert.ok(v.elapsed >= lastElapsed, 'elapsed never goes backwards');
      lastElapsed = v.elapsed;
      assert.equal(v.done, run.index >= run.segments.length || v.run.index >= run.segments.length);
      if (!v.done) {
        assert.ok(v.seg, 'a live run always has a segment');
        assert.ok(v.segElapsed >= 0);
        if (v.segRemaining != null) assert.ok(v.segRemaining >= 0 && v.segRemaining <= v.seg.durationMs);
      }
      for (const c of intervalCues(run, now, 5_000)) assert.ok(c.wall >= now - 300 && c.wall <= now + 5_000);
      assert.equal(runElapsed(run, now), v.elapsed);
    }
  }
});

test('stopwatch sounds every X minutes of elapsed time, not wall time', () => {
  let sw = swSetEvery(newStopwatch('a', 'A'), 2);
  assert.deepEqual(stopwatchCues(sw, T0, 600_000), [], 'silent while stopped');
  sw = swToggle(sw, T0);
  const cues = stopwatchCues(sw, T0, 300_000);
  assert.deepEqual(cues.map((c) => c.wall - T0), [120_000, 240_000]);
  assert.equal(cues[0].text, '2 minutes');
  assert.equal(cues[0].kind, 'chime');
  // Stop at 1:00, resume 10 minutes later: next cue is 1:00 of running time away.
  sw = swToggle(sw, T0 + 60_000);
  sw = swToggle(sw, T0 + 660_000);
  const after = stopwatchCues(sw, T0 + 660_000, 61_000);
  assert.deepEqual(after.map((c) => c.wall - T0), [720_000]);
  assert.notEqual(after[0].key, cues[0].key, 'resume invalidates old keys');
  assert.deepEqual(stopwatchCues(swSetEvery(sw, 0), T0 + 700_000, 600_000), [], '0 is off');
  assert.equal(swSetEvery(sw, 999).everyMin, 180);
  assert.equal(swSetEvery(sw, -3).everyMin, 0);
  assert.equal(stopwatchCues({ ...sw, everyMin: undefined }, T0 + 700_000, 600_000).length, 0, 'old saved stopwatches stay silent');
});
