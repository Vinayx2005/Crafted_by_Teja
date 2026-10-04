// Book sounds, synthesised with Web Audio — no audio files to load.
// A real page turn is three things layered: dozens of tiny crackles as the
// paper bends, a soft whoosh of air, and a light flap as the page lands.
//   turn   crackle + whoosh + flap
//   open   gentler turn with a low cover thump at the start
//   close  cover thump + muffled slap as the book shuts
let ctx, noise, out;

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // keeps stacked grains from clipping
    out = ctx.createDynamicsCompressor();
    out.threshold.value = -18; out.ratio.value = 4;
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

const rand = (a, b) => a + Math.random() * (b - a);

// One short burst of filtered noise.
function grain(t, len, freq, q, vol, type = 'bandpass') {
  const src = ctx.createBufferSource(); src.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.004, len / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(out);
  src.start(t, rand(0, 0.9), len + 0.01);
}

// Paper bending: crackles bunched toward the middle of the turn.
function crackle(t, dur, vol) {
  const n = Math.round(dur * 110);
  for (let i = 0; i < n; i++) {
    const x = Math.random();
    const at = t + dur * (0.5 + (x - 0.5) * Math.abs(x - 0.5) * 2); // denser in the middle
    const env = Math.sin(Math.PI * Math.min(1, Math.max(0, (at - t) / dur)));
    grain(at, rand(0.004, 0.018), rand(1800, 7500), rand(0.8, 2.5), vol * env * rand(0.15, 1));
  }
}

// Air moving past the page: broad noise swelling and fading.
function whoosh(t, dur, vol) {
  const src = ctx.createBufferSource(); src.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.5;
  f.frequency.setValueAtTime(700, t);
  f.frequency.linearRampToValueAtTime(1900, t + dur * 0.5);
  f.frequency.linearRampToValueAtTime(800, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + dur * 0.45);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, rand(0, 0.4), dur + 0.02);
}

// Page landing: a soft low slap.
function flap(t, vol) {
  grain(t, 0.07, 650, 0.6, vol, 'lowpass');
  grain(t + 0.01, 0.04, 2400, 0.9, vol * 0.35);
}

function thump(t, { from = 120, to = 45, dur = 0.22, vol = 0.35 } = {}) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur);
}

// Overall loudness — one knob for every sound.
const LEVEL = 0.9;

export function play(kind) {
  try {
    const t = audio().currentTime + 0.01, v = LEVEL;
    if (kind === 'turn') {
      const dur = rand(0.42, 0.55); // a little different every time
      crackle(t, dur, 0.5 * v); whoosh(t, dur, 0.12 * v); flap(t + dur * 0.92, 0.35 * v);
    }
    if (kind === 'open') {
      thump(t, { from: 90, to: 50, dur: 0.16, vol: 0.25 * v });
      crackle(t + 0.05, 0.6, 0.3 * v); whoosh(t + 0.05, 0.6, 0.1 * v); flap(t + 0.62, 0.3 * v);
    }
    if (kind === 'close') { flap(t, 0.6 * v); thump(t, { vol: 0.45 * v }); }
  } catch {} // no audio support: stay silent
}
