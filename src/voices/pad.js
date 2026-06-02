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

  function trigger(time) {
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
    }

    level = Math.min(1, level + 0.5);
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
    updateFrame() {
      level *= 0.985; // visual envelope decay
    },
    getLevel: () => level,
  };
}
