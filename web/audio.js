// Cue playback: beeps on the Web Audio clock (sample-accurate, immune to JS jank)
// and speech via speechSynthesis. iOS only allows audio after a user gesture,
// so `unlock()` must be called from a tap handler.

const TONES = {
  tick: [{ f: 880, d: 0.12 }],
  start: [{ f: 1320, d: 0.35 }],
  rest: [{ f: 660, d: 0.35 }],
  chime: [{ f: 990, d: 0.2 }, { f: 1320, d: 0.3, at: 0.24 }],
  end: [{ f: 880, d: 0.18 }, { f: 1100, d: 0.18, at: 0.22 }, { f: 1320, d: 0.4, at: 0.44 }],
};

const KEEP_FIRED_MS = 10_000;

/** A short silent WAV as a blob URL: playing it on loop moves iOS into the media
 * ("playback") audio category, which ignores the silent switch. Web Audio alone
 * stays in the ambient category on engines without navigator.audioSession. */
function silentWavUrl(seconds = 1, rate = 8000) {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128); // 8-bit PCM midpoint = silence
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export class CuePlayer {
  constructor() {
    this.ctx = null;
    this.pending = new Map(); // key -> { wall, nodes: [], timeout }
    this.settings = { beeps: true, voice: true, volume: 0.8, soundMode: 'always' };
    this.active = false;
    this.carrier = null; // silent looping <audio>, see silentWavUrl
  }

  get unlocked() {
    return this.ctx?.state === 'running';
  }

  configure(settings) {
    this.settings = { ...this.settings, ...settings };
    // WebKit's Audio Session API: 'ambient' mixes with music but obeys the silent
    // switch; 'playback' is audible on silent but pauses other apps' audio.
    if (navigator.audioSession) {
      try {
        navigator.audioSession.type = this.settings.soundMode === 'always' ? 'playback' : 'ambient';
      } catch { /* unsupported value on this engine */ }
    }
    this.#updateCarrier();
  }

  /** Tell the player whether anything is timing; the silent carrier only plays then. */
  setActive(active) {
    this.active = active;
    this.#updateCarrier();
  }

  #updateCarrier() {
    const want = this.active && this.settings.soundMode === 'always' && (this.settings.beeps || this.settings.voice);
    if (want) {
      if (!this.carrier) {
        this.carrier = new Audio(silentWavUrl());
        this.carrier.loop = true;
        this.carrier.setAttribute('playsinline', '');
      }
      // play() needs a user gesture the first time; unlock() retries on every tap.
      if (this.carrier.paused) this.carrier.play().catch(() => {});
    } else if (this.carrier && !this.carrier.paused) {
      this.carrier.pause();
    }
  }

  unlock() {
    this.#updateCarrier();
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    // Play one silent sample so iOS treats the context as user-started.
    const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start();
    if ('speechSynthesis' in window && !this.speechPrimed) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
      this.speechPrimed = true;
    }
  }

  /** Make the pending set match `cues`: schedule new ones, cancel ones no longer wanted. */
  sync(cues) {
    const now = Date.now();
    const wanted = new Set(cues.map((c) => c.key));
    for (const [key, h] of this.pending) {
      if (h.wall > now && !wanted.has(key)) {
        this.#cancel(h);
        this.pending.delete(key);
      } else if (h.wall < now - KEEP_FIRED_MS) {
        this.pending.delete(key);
      }
    }
    for (const cue of cues) {
      if (this.pending.has(cue.key)) continue;
      this.pending.set(cue.key, this.#schedule(cue, now));
    }
  }

  cancelAll() {
    for (const h of this.pending.values()) this.#cancel(h);
    this.pending.clear();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  test() {
    this.unlock();
    const now = Date.now();
    this.#schedule({ kind: 'start', phase: 'work', wall: now + 50, text: 'Sound check. Work' }, now);
  }

  #schedule(cue, now) {
    const handle = { wall: cue.wall, nodes: [], timeout: null };
    const delayMs = Math.max(0, cue.wall - now);
    if (this.settings.beeps && cue.kind !== 'speak' && this.unlocked) {
      const tone = cue.kind === 'start' && cue.phase !== 'work' ? TONES.rest : TONES[cue.kind];
      if (tone) handle.nodes = this.#beep(tone, delayMs / 1000);
    }
    if (this.settings.voice && cue.text && 'speechSynthesis' in window) {
      handle.timeout = setTimeout(() => this.#speak(cue.text), delayMs);
    }
    return handle;
  }

  #beep(tone, delayS) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delayS;
    const vol = Math.max(0.0001, this.settings.volume);
    return tone.map(({ f, d, at = 0 }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const s = t0 + at;
      gain.gain.setValueAtTime(0.0001, s);
      gain.gain.exponentialRampToValueAtTime(vol, s + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, s + d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(s);
      osc.stop(s + d + 0.02);
      return osc;
    });
  }

  #speak(text) {
    // One announcement at a time: a newer cue replaces an older one still talking.
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.volume = Math.min(1, this.settings.volume + 0.2);
    speechSynthesis.speak(u);
  }

  #cancel(h) {
    for (const n of h.nodes) {
      try { n.stop(0); } catch { /* already stopped */ }
    }
    if (h.timeout) clearTimeout(h.timeout);
  }
}
