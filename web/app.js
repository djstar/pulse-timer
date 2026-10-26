import * as E from './engine.js';
import { CuePlayer } from './audio.js';

const STORE_KEY = 'workout-timer.v1';
const CUE_HORIZON_MS = 2500;
const HISTORY_CAP = 500;

const BUILTIN_PRESETS = [
  { id: 'tabata', name: 'Tabata', cfg: { prepSec: 10, workSec: 20, restSec: 10, rounds: 8, cycles: 1, setRestSec: 60, coolSec: 0, workMode: 'timed' } },
  { id: 'hiit', name: 'HIIT 40/20', cfg: { prepSec: 10, workSec: 40, restSec: 20, rounds: 10, cycles: 1, setRestSec: 60, coolSec: 0, workMode: 'timed' } },
  { id: 'emom', name: 'EMOM 10', cfg: { prepSec: 10, workSec: 60, restSec: 0, rounds: 10, cycles: 1, setRestSec: 0, coolSec: 0, workMode: 'timed' } },
  { id: 'boxing', name: 'Boxing rounds', cfg: { prepSec: 10, workSec: 180, restSec: 60, rounds: 12, cycles: 1, setRestSec: 0, coolSec: 0, workMode: 'timed' } },
  { id: 'sets', name: 'Sets & rest', cfg: { prepSec: 5, workSec: 60, restSec: 90, rounds: 5, cycles: 1, setRestSec: 0, coolSec: 0, workMode: 'open' } },
];

const FIELDS = [
  { key: 'prepSec', label: 'Get ready', unit: 's', step: 5, min: 0 },
  { key: 'workSec', label: 'Work', unit: 's', step: 5, min: 1 },
  { key: 'restSec', label: 'Rest', unit: 's', step: 5, min: 0 },
  { key: 'rounds', label: 'Rounds', unit: '', step: 1, min: 1 },
  { key: 'cycles', label: 'Sets', unit: '', step: 1, min: 1, hint: 'Repeat all rounds this many times' },
  { key: 'setRestSec', label: 'Rest between sets', unit: 's', step: 15, min: 0, hint: 'Only used with 2 or more sets' },
  { key: 'coolSec', label: 'Cool down', unit: 's', step: 15, min: 0 },
];

const ICON = {
  play: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>',
  pause: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
  lap: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 3h2v18H5zm3 1h11l-2.5 4L19 12H8z"/></svg>',
  reset: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
  trash: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z"/></svg>',
  plus: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  minus: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 11h14v2H5z"/></svg>',
  skip: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5v14l10-7zm11 0h3v14h-3z"/></svg>',
  back: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 5v14L9 12zM5 5h3v14H5z"/></svg>',
  lock: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3h1v11H6V10zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>',
  check: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 16.2-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  // Phase icons: shape differs per phase, so colour is never the only signal.
  work: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  rest: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.5 0-1-.1-1.4A5.5 5.5 0 0 1 13.4 3.1 9 9 0 0 0 12 3z"/></svg>',
  prep: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z"/></svg>',
  setrest: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 18h18v2H3zm2-9h4v7H5zm5-4h4v11h-4zm5 7h4v4h-4z"/></svg>',
  cool: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M11 2h2v4.6l3.3-2 1 1.7L13 9v2h2l2.7-4.3 1.7 1-2 3.3H22v2h-4.6l2 3.3-1.7 1L15 13h-2v2l4.3 2.7-1 1.7-3.3-2V22h-2v-4.6l-3.3 2-1-1.7L11 15v-2H9l-2.7 4.3-1.7-1 2-3.3H2v-2h4.6l-2-3.3 1.7-1L9 11h2V9L6.7 6.3l1-1.7 3.3 2z"/></svg>',
  done: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 16.2-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
};

const TAB_TITLES = { stopwatch: 'Stopwatch', interval: 'Tabata & intervals', timers: 'Timers', history: 'History' };

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtSec = (s) => E.fmtCount(s * 1000);

// ---------------------------------------------------------------- state

function defaults() {
  return {
    version: 1,
    tab: 'stopwatch',
    swCounter: 1,
    stopwatches: [{ ...E.newStopwatch(uid(), 'Stopwatch 1') }],
    timers: [],
    customPresets: [],
    draft: { presetId: 'tabata', name: 'Tabata', cfg: { ...BUILTIN_PRESETS[0].cfg } },
    run: null,
    history: [],
    settings: { voice: true, beeps: true, volume: 0.8, flash: true, wake: true, soundMode: 'always' },
    settingsRev: 2,
  };
}

function load() {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved?.version === 1) {
      const settings = { ...base.settings, ...saved.settings };
      // Rev 2: cues default to audible on silent. Earlier saves stored the old 'mix' default.
      if ((saved.settingsRev ?? 1) < 2) settings.soundMode = 'always';
      return { ...base, ...saved, settings, settingsRev: 2 };
    }
  } catch { /* storage blocked or corrupt: start fresh */ }
  return base;
}

let state = load();
const ui = { locked: false, settingsOpen: false };
const player = new CuePlayer();
player.configure(state.settings);

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch { /* private mode or quota: keep running in memory */ }
}

function commit(mutate) {
  const next = mutate(state);
  if (next) state = next;
  save();
  render();
  syncCues();
  player.setActive(isAnythingRunning());
  updateWakeLock();
}

function addHistory(h, entry) {
  return [{ id: uid(), ...entry }, ...h].slice(0, HISTORY_CAP);
}

const announcer = $('#announcer');
function announce(text) {
  announcer.textContent = '';
  setTimeout(() => { announcer.textContent = text; }, 50);
}

// ---------------------------------------------------------------- rendering

function render() {
  const active = document.activeElement?.dataset?.key;

  document.querySelectorAll('.tabbar [data-tab]').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('#view-title').textContent = TAB_TITLES[state.tab];
  document.title = `${TAB_TITLES[state.tab]} · Workout Timer`;

  const main = $('#main');
  main.innerHTML = { stopwatch: viewStopwatch, interval: viewInterval, timers: viewTimers, history: viewHistory }[state.tab]();
  renderRun();
  frame(true);

  if (active) {
    const el = document.querySelector(`[data-key="${CSS.escape(active)}"]`);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }
}

function viewStopwatch() {
  const cards = state.stopwatches.map((sw) => {
    const running = sw.runningSince != null;
    const elapsed = E.swElapsed(sw, Date.now());
    const rows = E.lapRows(sw.laps);
    const every = sw.everyMin || 0;
    const laps = rows.length
      ? `<ol class="laps" aria-label="Laps, newest first">${rows.map((r) => `
          <li>
            <span>Lap ${r.n}${r.best ? '<span class="tag best">Fastest</span>' : ''}${r.worst ? '<span class="tag worst">Slowest</span>' : ''}</span>
            <span class="digits ${r.best ? 'best' : r.worst ? 'worst' : ''}">${E.fmtClock(r.split)}</span>
            <span class="digits muted">${E.fmtClock(r.total)}</span>
          </li>`).join('')}</ol>`
      : '';
    return `
      <article class="card" aria-label="${esc(sw.name)}">
        <div class="row spread">
          <button type="button" class="name-btn" data-action="sw-rename" data-id="${sw.id}" data-key="swn-${sw.id}" aria-label="${esc(sw.name)}, rename">${esc(sw.name)}</button>
          <button type="button" class="icon-btn" data-action="sw-delete" data-id="${sw.id}" data-key="swd-${sw.id}" aria-label="Delete ${esc(sw.name)}">${ICON.trash}</button>
        </div>
        <div class="digits sw-time" role="timer" data-live="sw:${sw.id}">${E.fmtClock(elapsed)}</div>
        ${sw.laps.length ? `<p class="muted" style="margin:0 0 .5rem">Current lap <span class="digits sw-lap-now" data-live="swlap:${sw.id}"></span></p>` : ''}
        <div class="row">
          <button type="button" class="btn ${running ? 'stop' : 'go'}" data-action="sw-toggle" data-id="${sw.id}" data-key="swt-${sw.id}">${running ? `${ICON.pause} Stop` : `${ICON.play} ${elapsed ? 'Resume' : 'Start'}`}</button>
          <button type="button" class="btn" data-action="sw-lap" data-id="${sw.id}" data-key="swl-${sw.id}" ${running ? '' : 'disabled'}>${ICON.lap} Lap</button>
          <button type="button" class="btn ghost" data-action="sw-reset" data-id="${sw.id}" data-key="swr-${sw.id}" ${elapsed ? '' : 'disabled'}>${ICON.reset} Reset</button>
        </div>
        <div class="field">
          <label for="swe-${sw.id}">Sound every <span class="muted">(minutes)</span><span class="hint">${every ? `Beeps and says the time every ${every === 1 ? 'minute' : `${every} minutes`}` : 'Off. Set above 0 to turn on'}</span></label>
          <span class="stepper">
            <button type="button" class="icon-btn" data-action="sw-every" data-id="${sw.id}" data-delta="-1" data-key="swe-dec-${sw.id}" aria-label="Decrease sound interval" ${every ? '' : 'disabled'}>${ICON.minus}</button>
            <input id="swe-${sw.id}" type="number" inputmode="numeric" min="0" max="${E.SW_EVERY_MAX_MIN}" step="1" value="${every}" data-sw-every="${sw.id}" data-key="swe-in-${sw.id}">
            <button type="button" class="icon-btn" data-action="sw-every" data-id="${sw.id}" data-delta="1" data-key="swe-inc-${sw.id}" aria-label="Increase sound interval" ${every >= E.SW_EVERY_MAX_MIN ? 'disabled' : ''}>${ICON.plus}</button>
          </span>
        </div>
        ${laps}
      </article>`;
  }).join('');
  return `
    ${cards || '<p class="empty">No stopwatches.</p>'}
    <p><button type="button" class="btn primary block" data-action="sw-add" data-key="sw-add">${ICON.plus} Add stopwatch</button></p>`;
}

function presetSummary(cfg) {
  const work = cfg.workMode === 'open' ? 'until done' : fmtSec(cfg.workSec);
  return `${work} / ${fmtSec(cfg.restSec)} × ${cfg.rounds}${cfg.cycles > 1 ? ` × ${cfg.cycles} sets` : ''}`;
}

function viewInterval() {
  const d = state.draft;
  const presets = [...BUILTIN_PRESETS, ...state.customPresets];
  const segs = E.compileInterval(d.cfg);
  const total = E.plannedDuration(segs);
  const fields = FIELDS.map((f) => {
    const v = d.cfg[f.key];
    const isWork = f.key === 'workSec';
    const disabled = isWork && d.cfg.workMode === 'open';
    const id = `f-${f.key}`;
    return `
      <div class="field">
        <label for="${id}">${f.label}${f.unit ? ` <span class="muted">(seconds)</span>` : ''}${f.hint ? `<span class="hint">${f.hint}</span>` : ''}
          ${f.unit && !disabled ? `<span class="hint">${fmtSec(v)}</span>` : ''}</label>
        <span class="stepper">
          <button type="button" class="icon-btn" data-action="step" data-field="${f.key}" data-delta="${-f.step}" data-key="dec-${f.key}" aria-label="Decrease ${f.label}" ${disabled || v <= f.min ? 'disabled' : ''}>${ICON.minus}</button>
          <input id="${id}" type="number" inputmode="numeric" min="${f.min}" step="1" value="${v}" data-field="${f.key}" data-key="in-${f.key}" ${disabled ? 'disabled' : ''}>
          <button type="button" class="icon-btn" data-action="step" data-field="${f.key}" data-delta="${f.step}" data-key="inc-${f.key}" aria-label="Increase ${f.label}" ${disabled ? 'disabled' : ''}>${ICON.plus}</button>
        </span>
      </div>
      ${isWork ? `
      <div class="field">
        <span id="wm-label"><strong>Work ends</strong><span class="hint">“When I tap” counts up for rep-based sets</span></span>
        <span class="seg-toggle" role="group" aria-labelledby="wm-label">
          <button type="button" data-action="workmode" data-mode="timed" data-key="wm-timed" aria-pressed="${d.cfg.workMode !== 'open'}">On time</button>
          <button type="button" data-action="workmode" data-mode="open" data-key="wm-open" aria-pressed="${d.cfg.workMode === 'open'}">When I tap</button>
        </span>
      </div>` : ''}`;
  }).join('');
  const isCustom = state.customPresets.some((p) => p.id === d.presetId);
  return `
    <h2 class="section-title" id="presets-h">Presets</h2>
    <div class="preset-list" role="group" aria-labelledby="presets-h">
      ${presets.map((p) => `
        <button type="button" class="preset" data-action="preset" data-id="${p.id}" data-key="pr-${p.id}" aria-pressed="${d.presetId === p.id}">
          <strong>${esc(p.name)}</strong><span>${presetSummary(p.cfg)}</span>
        </button>`).join('')}
    </div>
    <h2 class="section-title">${esc(d.name)}</h2>
    <div class="card">${fields}</div>
    <p class="summary" aria-live="polite">${total == null ? `${segs.filter((s) => s.phase === 'work').length} sets, open-ended` : `Total ${E.fmtCount(total)} · ${segs.filter((s) => s.phase === 'work').length} work intervals`}</p>
    <p><button type="button" class="btn primary block" data-action="run-start" data-key="run-start" style="min-height:3.75rem;font-size:1.2rem" ${segs.length ? '' : 'disabled'}>${ICON.play} Start ${esc(d.name)}</button></p>
    <div class="row">
      <button type="button" class="btn" data-action="preset-save" data-key="preset-save">Save as preset</button>
      ${isCustom ? `<button type="button" class="btn ghost" data-action="preset-delete" data-key="preset-delete">${ICON.trash} Delete preset</button>` : ''}
    </div>`;
}

function viewTimers() {
  const now = Date.now();
  const cards = state.timers.map((tm) => {
    const running = tm.runningSince != null;
    const rem = E.tmRemaining(tm, now);
    const untouched = rem === tm.durationMs && !running;
    return `
      <article class="card" aria-label="${esc(tm.name)}">
        <div class="row spread">
          <button type="button" class="name-btn" data-action="tm-rename" data-id="${tm.id}" data-key="tmn-${tm.id}" aria-label="${esc(tm.name)}, rename">${esc(tm.name)}</button>
          <button type="button" class="icon-btn" data-action="tm-delete" data-id="${tm.id}" data-key="tmd-${tm.id}" aria-label="Delete ${esc(tm.name)}">${ICON.trash}</button>
        </div>
        <div class="digits tm-time" role="timer" data-live="tm:${tm.id}">${E.fmtCount(rem)}</div>
        <p class="muted" style="margin:0 0 .5rem" data-live="tmnote:${tm.id}"></p>
        <div class="row">
          <button type="button" class="btn ${running ? 'stop' : 'go'}" data-action="tm-toggle" data-id="${tm.id}" data-key="tmt-${tm.id}">${running ? `${ICON.pause} Pause` : `${ICON.play} ${untouched ? 'Start' : 'Resume'}`}</button>
          <button type="button" class="btn ghost" data-action="tm-reset" data-id="${tm.id}" data-key="tmr-${tm.id}" ${untouched ? 'disabled' : ''}>${ICON.reset} Reset</button>
          <button type="button" class="btn small" data-action="tm-adjust" data-delta="-30000" data-id="${tm.id}" data-key="tmm-${tm.id}" aria-label="Subtract 30 seconds">−30 s</button>
          <button type="button" class="btn small" data-action="tm-adjust" data-delta="30000" data-id="${tm.id}" data-key="tmp-${tm.id}" aria-label="Add 30 seconds">+30 s</button>
        </div>
      </article>`;
  }).join('');
  const quick = [1, 3, 5, 10, 15, 30];
  return `
    ${cards || '<p class="empty">No timers yet. Start a quick one or make your own below.</p>'}
    <h2 class="section-title" id="quick-h">Quick start</h2>
    <div class="row" role="group" aria-labelledby="quick-h">
      ${quick.map((m) => `<button type="button" class="btn" data-action="tm-quick" data-min="${m}" data-key="q-${m}" aria-label="Start a ${m} minute timer">${m} min</button>`).join('')}
    </div>
    <h2 class="section-title">New timer</h2>
    <form class="card" data-form="tm-new">
      <div class="field"><label for="tm-name">Name</label><input id="tm-name" class="text-input" style="width:12rem" name="name" placeholder="Timer" autocomplete="off"></div>
      <div class="field"><label for="tm-h">Hours</label><input id="tm-h" class="text-input" style="width:5.5rem" name="h" type="number" inputmode="numeric" min="0" max="2376" value="0"></div>
      <div class="field"><label for="tm-m">Minutes</label><input id="tm-m" class="text-input" style="width:5.5rem" name="m" type="number" inputmode="numeric" min="0" max="59" value="5"></div>
      <div class="field"><label for="tm-s">Seconds</label><input id="tm-s" class="text-input" style="width:5.5rem" name="s" type="number" inputmode="numeric" min="0" max="59" value="0"></div>
      <p><button class="btn primary block" type="submit" data-key="tm-add">${ICON.plus} Add and start</button></p>
    </form>`;
}

function viewHistory() {
  if (!state.history.length) return '<p class="empty">Finished stopwatches, workouts and timers show up here.</p>';
  const items = state.history.map((h) => `
    <li class="card history-item">
      <strong>${esc(h.name)}</strong>
      <span class="digits">${h.kind === 'stopwatch' ? E.fmtClock(h.durationMs) : E.fmtCount(h.durationMs)}</span>
      <span class="muted">${esc(h.detail)}</span>
      <span class="when">${new Date(h.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
    </li>`).join('');
  return `
    <ul style="list-style:none;padding:0;margin:.5rem 0">${items}</ul>
    <p><button type="button" class="btn ghost block" data-action="history-clear" data-key="history-clear">${ICON.trash} Clear history</button></p>`;
}

// ---------------------------------------------------------------- run screen

function renderRun() {
  let el = $('#run');
  const behind = ['.app-header', '#main', '.tabbar', '#sound-banner', '.skip-link'].map((s) => $(s));
  if (!state.run) {
    if (el) el.remove();
    behind.forEach((b) => b && (b.inert = false));
    document.body.style.overflow = '';
    return;
  }
  const isNew = !el;
  if (isNew) {
    el = document.createElement('section');
    el.id = 'run';
    el.className = 'run';
    el.setAttribute('aria-label', 'Workout');
    document.body.append(el);
  }
  behind.forEach((b) => b && (b.inert = true));
  document.body.style.overflow = 'hidden';

  const v = E.runView(state.run, Date.now());
  const phase = v.done ? 'done' : v.seg.phase;
  el.dataset.phase = phase;
  el.classList.toggle('locked', ui.locked && !v.done);
  el.dataset.renderKey = renderKey(v);

  if (v.done) {
    const works = v.run.segments.filter((s, k) => s.phase === 'work' && k < v.run.index).length;
    el.innerHTML = `
      <div class="center">
        <h2 class="phase-name" id="phase-h" tabindex="-1">${ICON.done} DONE</h2>
        <div class="digits run-time" style="font-size:clamp(3.5rem,20vw,7rem)">${E.fmtCount(v.elapsed)}</div>
        <p class="run-meta">${esc(v.run.name)} complete · ${works} work intervals</p>
      </div>
      <div class="controls">
        <button type="button" class="btn" data-action="run-back" data-key="run-back">${ICON.back} Back</button>
        <button type="button" class="btn primary" data-action="run-again" data-key="run-again">${ICON.reset} Again</button>
        <button type="button" class="btn" data-action="run-close" data-key="run-close">${ICON.check} Close</button>
      </div>`;
  } else {
    const s = v.seg;
    const open = s.durationMs == null;
    const meta = s.round
      ? `Round ${s.round} of ${s.rounds}${s.cycles > 1 ? ` · Set ${s.cycle} of ${s.cycles}` : ''}`
      : s.phase === 'setrest' ? `Set ${s.cycle} of ${s.cycles} done` : '';
    const next = v.next ? `Next: ${E.PHASES[v.next.phase].label}${v.next.durationMs != null ? ` ${E.fmtCount(v.next.durationMs)}` : ''}` : 'Last interval';
    el.innerHTML = `
      <div class="top">
        <span class="run-sub">${esc(v.run.name)}${v.paused ? ' · <strong>Paused</strong>' : ''}</span>
        <button type="button" class="btn small" data-action="run-end" data-key="run-end">End</button>
      </div>
      <button type="button" class="btn primary" data-action="sound-enable" data-live="run-sound" hidden style="margin-top:.5rem">Tap to turn on sound</button>
      <div class="center">
        <h2 class="phase-name" id="phase-h" tabindex="-1">${ICON[s.phase]} ${E.PHASES[s.phase].short}</h2>
        <div class="digits run-time" role="timer" data-live="run-time"></div>
        ${open ? '<p class="run-sub">Counting up. Tap Done when you finish the set.</p>' : ''}
        ${meta ? `<p class="run-meta">${meta}</p>` : ''}
        ${open ? '' : '<div class="progress" aria-hidden="true"><div data-live="run-progress"></div></div>'}
        <p class="run-sub" data-live="run-total"></p>
        <p class="run-sub">${next}</p>
      </div>
      <div class="controls">
        ${open ? `<button type="button" class="btn primary wide" data-action="run-skip" data-key="run-done">${ICON.check} Done with set</button>` : ''}
        <button type="button" class="btn" data-action="run-back" data-key="run-back">${ICON.back} Back</button>
        <button type="button" class="btn ${open ? '' : 'primary'}" data-action="run-toggle" data-key="run-toggle">${v.paused ? `${ICON.play} Resume` : `${ICON.pause} Pause`}</button>
        <button type="button" class="btn" data-action="run-skip" data-key="run-skip">${ICON.skip} Skip</button>
        <button type="button" class="btn" data-action="run-adjust" data-delta="-10000" data-key="run-minus" aria-label="Subtract 10 seconds" ${open ? 'disabled' : ''}>−10 s</button>
        <button type="button" class="btn unlock" data-action="run-lock" data-key="run-lock" aria-pressed="${ui.locked}">${ICON.lock} ${ui.locked ? 'Unlock' : 'Lock'}</button>
        <button type="button" class="btn" data-action="run-adjust" data-delta="10000" data-key="run-plus" aria-label="Add 10 seconds" ${open ? 'disabled' : ''}>+10 s</button>
      </div>`;
  }
  if (isNew) $('#phase-h', el)?.focus({ preventScroll: true });
}

const renderKey = (v) => `${v.run.index}:${v.done}:${v.paused}:${v.run.revision}`;

// ---------------------------------------------------------------- per-frame updates

function setText(sel, text) {
  const el = document.querySelector(sel);
  if (el && el.textContent !== text) el.textContent = text;
  return el;
}

/** Update live digits; commit state when a run changes phase or a timer expires. */
function frame(skipTransitions = false) {
  const now = Date.now();

  if (state.run && !skipTransitions) {
    const prev = state.run;
    const next = E.normalize(prev, now);
    if (next !== prev) {
      onPhaseChange(prev, next);
      return;
    }
  }

  for (const sw of state.stopwatches) {
    const t = E.swElapsed(sw, now);
    setText(`[data-live="sw:${sw.id}"]`, E.fmtClock(t));
    if (sw.laps.length) setText(`[data-live="swlap:${sw.id}"]`, E.fmtClock(t - sw.laps.at(-1).at));
  }

  for (const tm of state.timers) {
    const rem = E.tmRemaining(tm, now);
    const el = setText(`[data-live="tm:${tm.id}"]`, E.fmtCount(rem));
    el?.classList.toggle('overtime', rem < 0);
    setText(`[data-live="tmnote:${tm.id}"]`, rem < 0 ? `Finished. Overtime ${E.fmtCount(rem).slice(1)}` : `of ${E.fmtCount(tm.durationMs)}`);
    if (!skipTransitions && rem <= 0 && !tm.alerted && tm.runningSince != null) {
      announce(`${tm.name} finished`);
      flash();
      commit((s) => ({
        ...s,
        timers: s.timers.map((x) => (x.id === tm.id ? { ...x, alerted: true } : x)),
        history: addHistory(s.history, { kind: 'timer', name: tm.name, at: now - tm.durationMs, durationMs: tm.durationMs, detail: 'Timer finished' }),
      }));
      return;
    }
  }

  if (state.run) {
    const v = E.runView(state.run, now);
    const runEl = $('#run');
    if (runEl && runEl.dataset.renderKey !== renderKey(v)) renderRun();
    if (!v.done) {
      const open = v.segRemaining == null;
      setText('[data-live="run-time"]', E.fmtCount(open ? v.segElapsed : v.segRemaining));
      const bar = $('[data-live="run-progress"]');
      if (bar) bar.style.width = `${Math.min(100, (v.segElapsed / v.seg.durationMs) * 100)}%`;
      setText('[data-live="run-total"]', `Elapsed ${E.fmtCount(v.elapsed)}${v.remainingTotal != null ? ` · Left ${E.fmtCount(v.remainingTotal)}` : ''}`);
    }
  }

  const anyRunning = isAnythingRunning();
  const needsSound = anyRunning && !player.unlocked && (state.settings.beeps || state.settings.voice);
  $('#sound-banner').hidden = !needsSound || !!state.run;
  const runSound = $('[data-live="run-sound"]');
  if (runSound) runSound.hidden = !needsSound;
}

function onPhaseChange(prev, next) {
  const v = E.runView(next, Date.now());
  if (v.done) {
    const works = next.segments.filter((s) => s.phase === 'work').length;
    announce(`${next.name} complete`);
    commit((s) => ({
      ...s,
      run: next,
      history: addHistory(s.history, { kind: 'interval', name: next.name, at: next.startedAt, durationMs: v.elapsed, detail: `Completed · ${works} work intervals` }),
    }));
  } else {
    if (!state.settings.voice) announce(`${E.PHASES[v.seg.phase].label}${v.seg.round ? `, round ${v.seg.round} of ${v.seg.rounds}` : ''}`);
    commit((s) => ({ ...s, run: next }));
  }
  flash();
}

function flash() {
  if (!state.settings.flash || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const f = $('#flash');
  f.classList.remove('on');
  void f.offsetWidth; // restart the animation
  f.classList.add('on');
}

function loop() {
  frame();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- cues, wake lock

function isAnythingRunning() {
  return (state.run && !state.run.done && state.run.runningSince != null)
    || state.stopwatches.some((s) => s.runningSince != null)
    || state.timers.some((t) => t.runningSince != null);
}

function syncCues() {
  const now = Date.now();
  const cues = [];
  if (state.run) cues.push(...E.intervalCues(state.run, now, CUE_HORIZON_MS));
  for (const tm of state.timers) if (!tm.alerted) cues.push(...E.timerCues(tm, now, CUE_HORIZON_MS));
  const named = state.stopwatches.length > 1;
  for (const sw of state.stopwatches) {
    for (const c of E.stopwatchCues(sw, now, CUE_HORIZON_MS)) cues.push(named ? { ...c, text: `${sw.name}, ${c.text}` } : c);
  }
  player.sync(cues);
}

let wakeLock = null;
async function updateWakeLock() {
  const want = state.settings.wake && isAnythingRunning() && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; /* denied (e.g. Low Power Mode) */ }
}

// ---------------------------------------------------------------- actions

const mapById = (list, id, fn) => list.map((x) => (x.id === id ? fn(x) : x));

function swHistory(s, sw, now) {
  const t = E.swElapsed(sw, now);
  if (!t) return s.history;
  const rows = E.lapRows(sw.laps);
  const best = rows.find((r) => r.best);
  const detail = sw.laps.length ? `${sw.laps.length} laps${best ? ` · fastest ${E.fmtClock(best.split)}` : ''}` : 'No laps';
  return addHistory(s.history, { kind: 'stopwatch', name: sw.name, at: now - t, durationMs: t, detail, laps: sw.laps });
}

function setDraftField(s, key, value) {
  const f = FIELDS.find((x) => x.key === key);
  const v = Math.max(f.min, Math.min(key.endsWith('Sec') ? 86_400 : 999, Math.round(Number(value) || 0)));
  return { ...s, draft: { presetId: null, name: 'Custom', cfg: { ...s.draft.cfg, [key]: v } } };
}

const actions = {
  'sw-add': () => commit((s) => ({
    ...s,
    swCounter: s.swCounter + 1,
    stopwatches: [...s.stopwatches, E.newStopwatch(uid(), `Stopwatch ${s.swCounter + 1}`)],
  })),
  'sw-toggle': (id) => {
    const sw = state.stopwatches.find((x) => x.id === id);
    announce(sw.runningSince != null ? `${sw.name} stopped at ${E.fmtSpoken(E.swElapsed(sw, Date.now()))}` : `${sw.name} started`);
    commit((s) => ({ ...s, stopwatches: mapById(s.stopwatches, id, (x) => E.swToggle(x, Date.now())) }));
  },
  'sw-lap': (id) => {
    const now = Date.now();
    commit((s) => ({ ...s, stopwatches: mapById(s.stopwatches, id, (x) => E.swLap(x, now)) }));
    const sw = state.stopwatches.find((x) => x.id === id);
    const r = E.lapRows(sw.laps)[0];
    if (r) announce(`Lap ${r.n}, ${E.fmtSpoken(r.split)}`);
  },
  'sw-reset': (id) => {
    const now = Date.now();
    commit((s) => {
      const sw = s.stopwatches.find((x) => x.id === id);
      return { ...s, history: swHistory(s, sw, now), stopwatches: mapById(s.stopwatches, id, E.swReset) };
    });
    announce('Reset. Saved to history');
  },
  'sw-every': (id, el) => setSwEvery(id, (state.stopwatches.find((x) => x.id === id).everyMin || 0) + Number(el.dataset.delta)),
  'sw-rename': (id) => {
    const sw = state.stopwatches.find((x) => x.id === id);
    const name = prompt('Stopwatch name', sw.name)?.trim();
    if (name) commit((s) => ({ ...s, stopwatches: mapById(s.stopwatches, id, (x) => ({ ...x, name: name.slice(0, 40) })) }));
  },
  'sw-delete': (id) => {
    const sw = state.stopwatches.find((x) => x.id === id);
    if (!confirm(`Delete ${sw.name}?`)) return;
    const now = Date.now();
    commit((s) => ({ ...s, history: swHistory(s, sw, now), stopwatches: s.stopwatches.filter((x) => x.id !== id) }));
    announce(`${sw.name} deleted`);
  },

  preset: (id) => {
    const p = [...BUILTIN_PRESETS, ...state.customPresets].find((x) => x.id === id);
    commit((s) => ({ ...s, draft: { presetId: p.id, name: p.name, cfg: { ...p.cfg } } }));
  },
  step: (_, el) => commit((s) => setDraftField(s, el.dataset.field, s.draft.cfg[el.dataset.field] + Number(el.dataset.delta))),
  workmode: (_, el) => commit((s) => ({ ...s, draft: { ...s.draft, presetId: null, name: 'Custom', cfg: { ...s.draft.cfg, workMode: el.dataset.mode } } })),
  'preset-save': () => {
    const name = prompt('Preset name', state.draft.name === 'Custom' ? '' : `${state.draft.name} (copy)`)?.trim();
    if (!name) return;
    const p = { id: `c-${uid()}`, name: name.slice(0, 40), cfg: { ...state.draft.cfg } };
    commit((s) => ({ ...s, customPresets: [...s.customPresets, p], draft: { presetId: p.id, name: p.name, cfg: { ...p.cfg } } }));
    announce(`Saved preset ${p.name}`);
  },
  'preset-delete': () => {
    const p = state.customPresets.find((x) => x.id === state.draft.presetId);
    if (!p || !confirm(`Delete preset ${p.name}?`)) return;
    commit((s) => ({ ...s, customPresets: s.customPresets.filter((x) => x.id !== p.id), draft: { ...s.draft, presetId: null, name: 'Custom' } }));
  },

  'run-start': () => {
    ui.locked = false;
    commit((s) => ({ ...s, run: E.startRun(s.draft.cfg, s.draft.name, Date.now()) }));
  },
  'run-toggle': () => commit((s) => ({ ...s, run: s.run.runningSince != null ? E.pauseRun(s.run, Date.now()) : E.resumeRun(s.run, Date.now()) })),
  'run-skip': () => commit((s) => ({ ...s, run: E.skipRun(s.run, Date.now()) })),
  'run-back': () => commit((s) => ({ ...s, run: E.backRun(s.run, Date.now()) })),
  'run-adjust': (_, el) => commit((s) => ({ ...s, run: E.adjustRun(s.run, Date.now(), Number(el.dataset.delta)) })),
  'run-lock': () => {
    ui.locked = !ui.locked;
    announce(ui.locked ? 'Controls locked' : 'Controls unlocked');
    renderRun();
    $('[data-key="run-lock"]')?.focus();
  },
  'run-end': () => {
    if (!confirm('End this workout?')) return;
    const now = Date.now();
    commit((s) => {
      const v = E.runView(s.run, now);
      const works = s.run.segments.filter((x, k) => x.phase === 'work' && k < v.run.index).length;
      return { ...s, run: null, history: addHistory(s.history, { kind: 'interval', name: s.run.name, at: s.run.startedAt, durationMs: v.elapsed, detail: `Ended early · ${works} work intervals done` }) };
    });
    player.cancelAll();
    $('[data-key="run-start"]')?.focus();
  },
  'run-again': () => commit((s) => ({ ...s, run: E.startRun(s.run.cfg, s.run.name, Date.now()) })),
  'run-close': () => {
    commit((s) => ({ ...s, run: null }));
    $('[data-key="run-start"]')?.focus();
  },

  'tm-quick': (_, el) => {
    const m = Number(el.dataset.min);
    addTimer(`${m} min`, m * 60_000);
  },
  'tm-toggle': (id) => commit((s) => ({ ...s, timers: mapById(s.timers, id, (x) => E.tmToggle(x, Date.now())) })),
  'tm-reset': (id) => commit((s) => ({ ...s, timers: mapById(s.timers, id, E.tmReset) })),
  'tm-adjust': (id, el) => commit((s) => ({ ...s, timers: mapById(s.timers, id, (x) => E.tmAdjust(x, Date.now(), Number(el.dataset.delta))) })),
  'tm-rename': (id) => {
    const tm = state.timers.find((x) => x.id === id);
    const name = prompt('Timer name', tm.name)?.trim();
    if (name) commit((s) => ({ ...s, timers: mapById(s.timers, id, (x) => ({ ...x, name: name.slice(0, 40) })) }));
  },
  'tm-delete': (id) => {
    const tm = state.timers.find((x) => x.id === id);
    if (!confirm(`Delete ${tm.name}?`)) return;
    commit((s) => ({ ...s, timers: s.timers.filter((x) => x.id !== id) }));
    announce(`${tm.name} deleted`);
  },

  'history-clear': () => {
    if (confirm('Clear all history?')) commit((s) => ({ ...s, history: [] }));
  },
  'sound-enable': () => {
    player.unlock();
    syncCues();
    announce('Sound on');
  },
};

function setSwEvery(id, value) {
  commit((s) => ({ ...s, stopwatches: mapById(s.stopwatches, id, (x) => E.swSetEvery(x, value)) }));
  const m = state.stopwatches.find((x) => x.id === id).everyMin;
  announce(m ? `Sound every ${m === 1 ? 'minute' : `${m} minutes`}` : 'Interval sound off');
}

function addTimer(name, durationMs) {
  const tm = E.tmToggle(E.newTimer(uid(), name, durationMs), Date.now());
  commit((s) => ({ ...s, timers: [...s.timers, tm] }));
  announce(`${name} timer started`);
}

// ---------------------------------------------------------------- settings dialog

function openSettings() {
  const st = state.settings;
  const dlg = document.createElement('dialog');
  dlg.setAttribute('aria-labelledby', 'settings-h');
  dlg.innerHTML = `
    <div class="dlg-body">
      <div class="row spread"><h2 id="settings-h">Settings</h2><button type="button" class="btn small" data-close>Done</button></div>
      <div class="card">
        <label class="switch-row">Spoken cues <input type="checkbox" name="voice" ${st.voice ? 'checked' : ''}></label>
        <label class="switch-row">Beeps <input type="checkbox" name="beeps" ${st.beeps ? 'checked' : ''}></label>
        <label class="switch-row">Volume <input type="range" name="volume" min="0.1" max="1" step="0.1" value="${st.volume}"></label>
        <label class="switch-row">Flash the screen on each phase <input type="checkbox" name="flash" ${st.flash ? 'checked' : ''}></label>
        <label class="switch-row">Keep screen on while timing <input type="checkbox" name="wake" ${st.wake ? 'checked' : ''}></label>
      </div>
      <h3 class="section-title" id="sm-h">Sound with music</h3>
      <div class="card" role="radiogroup" aria-labelledby="sm-h">
        <label class="switch-row"><span>Mix with my music<span class="hint">Keeps your music playing; the silent switch mutes cues</span></span><input type="radio" name="soundMode" value="mix" ${st.soundMode !== 'always' ? 'checked' : ''}></label>
        <label class="switch-row"><span>Always audible<span class="hint">Plays even on silent; pauses other audio while timing</span></span><input type="radio" name="soundMode" value="always" ${st.soundMode === 'always' ? 'checked' : ''}></label>
      </div>
      <p><button type="button" class="btn block" data-test>Play a test cue</button></p>
      <p class="muted">Keep this page open with the screen on. iPhone pauses web pages when the screen locks, so cues stop until you come back. The timers themselves stay correct.</p>
    </div>`;
  document.body.append(dlg);
  dlg.addEventListener('change', (e) => {
    const t = e.target;
    const value = t.type === 'checkbox' ? t.checked : t.type === 'range' ? Number(t.value) : t.value;
    state = { ...state, settings: { ...state.settings, [t.name]: value } };
    player.configure(state.settings);
    save();
    updateWakeLock();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) dlg.close();
    if (e.target.closest('[data-test]')) player.test();
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    $('#settings-btn').focus();
  });
  dlg.showModal();
}

// ---------------------------------------------------------------- wiring

document.addEventListener('click', (e) => {
  player.unlock(); // every tap is a chance to satisfy iOS's gesture rule
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    commit((s) => ({ ...s, tab: tab.dataset.tab }));
    return;
  }
  if (e.target.closest('#settings-btn')) return openSettings();
  if (e.target.closest('#sound-enable')) return actions['sound-enable']();
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled && actions[el.dataset.action]) actions[el.dataset.action](el.dataset.id, el);
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('#main input[data-field]')) commit((s) => setDraftField(s, t.dataset.field, t.value));
  else if (t.matches('#main input[data-sw-every]')) setSwEvery(t.dataset.swEvery, t.value);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form="tm-new"]');
  if (!form) return;
  e.preventDefault();
  const f = new FormData(form);
  const ms = ((Number(f.get('h')) || 0) * 3600 + (Number(f.get('m')) || 0) * 60 + (Number(f.get('s')) || 0)) * 1000;
  if (ms < 1000) {
    announce('Set at least one second');
    return;
  }
  addTimer(String(f.get('name') || '').trim().slice(0, 40) || `Timer ${state.timers.length + 1}`, ms);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    frame();
    syncCues();
  }
  updateWakeLock();
});

setInterval(syncCues, 250);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
updateWakeLock();
requestAnimationFrame(loop);
