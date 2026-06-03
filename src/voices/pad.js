// Pad swells: diatonic chords that fade in and out over many seconds. Triggered
// occasionally by the scheduler; density sets how often a new swell begins.

import { midiToFreq, scaleChord } from '../engine/theory.js';

export function createPad(ctx, graph, system, rng, _noise, emit) {
  const out = ctx.createGain();
  out.gain.value = 0.5;

  const muteGain = ctx.createGain();
  muteGain.gain.value = 1;

  // Gentle shared low-pass shaped by brightness.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1200;
  lp.Q.value = 0.4;

  lp.connect(muteGain);
  muteGain.connect(out);
  out.connect(graph.dry);
  const rev = ctx.createGain();
  rev.gain.value = 0.85;
  out.connect(rev);
  rev.connect(graph.reverbSend);

  let level = 0;

  // Cap concurrent oscillators. Swells are long (up to ~27s) and overlap freely;
  // at high density they'd stack into dozens of triangle oscillators and starve
  // the audio thread on mobile. Past the cap we skip the whole swell (never a
  // partial chord) — they overlap so densely that a dropped one isn't missed.
  const MAX_OSC = 24;
  let activeOsc = 0;

  // Swells are scheduled ahead of when they sound, so defer the visual level
  // bump until its `time` arrives (drained in updateFrame) — same reason the
  // ripple emit is deferred by the event bus. Bumps are pushed in time order.
  const bumps = [];

  function trigger(time) {
    if (activeOsc >= MAX_OSC) return;
    const center = 52 + Math.floor(system.val('brightness') * 12); // ~E3..E4
    const size = rng.int(3, 4);
    const chord = scaleChord(system.rootPc, system.scaleName, center, size, rng);

    const attack = rng.range(3, 7);
    const sustain = rng.range(4, 9);
    const release = rng.range(5, 11);
    const peak = 0.06 + rng.range(0, 0.05);

    lp.frequency.setTargetAtTime(700 + system.val('brightness') * 2200, time, 1.0);

    for (const midi of chord) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midiToFreq(midi);
      o.detune.value = rng.range(-6, 6);
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(lp);
      o.start(time);
      // Long ADSR-ish swell.
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + attack);
      g.gain.setValueAtTime(peak, time + attack + sustain);
      g.gain.exponentialRampToValueAtTime(0.0001, time + attack + sustain + release);
      o.stop(time + attack + sustain + release + 0.2);
      activeOsc++;
      o.onended = () => { activeOsc--; };
    }

    bumps.push(time);
    if (bumps.length > 64) bumps.shift(); // backstop while hidden (updateFrame paused)
    if (emit) emit('pad', { time, strength: 0.6 });
  }

  function nextEvent() {
    // Sparser than motes; density shortens the wait.
    const d = system.val('density');
    return rng.range(10, 26) * (1.3 - d);
  }

  return {
    name: 'pad',
    out,
    trigger,
    nextEvent,
    setMuted(m) {
      muteGain.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.2);
    },
    updateFrame(now) {
      // Apply bumps now due; drop any that missed their moment (page was hidden)
      // so we don't snap the orb on return.
      while (bumps.length && bumps[0] <= now) {
        if (bumps.shift() >= now - 0.3) level = Math.min(1, level + 0.5);
      }
      level *= 0.985; // visual envelope decay
    },
    getLevel: () => level,
  };
}
