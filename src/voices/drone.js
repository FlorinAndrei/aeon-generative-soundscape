// Drone bed: 2–3 detuned oscillators an octave or two below the current root,
// through a slow low-pass that breathes with a sub-audio LFO. This is the ground
// the rest of the soundscape floats on. Continuous — modulated every frame.

import { midiToFreq } from '../engine/theory.js';

export function createDrone(ctx, graph, system, rng) {
  const out = ctx.createGain();
  out.gain.value = 0.0;

  const muteGain = ctx.createGain();
  muteGain.gain.value = 1;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 400;
  lp.Q.value = 0.6;

  // Slow filter LFO.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.03;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 120;
  lfo.connect(lfoGain);
  lfoGain.connect(lp.frequency);
  lfo.start();

  const oscs = [];
  const detunes = [-7, 5, 0.5];
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator();
    o.type = i === 2 ? 'sine' : 'sawtooth';
    o.detune.value = detunes[i];
    const g = ctx.createGain();
    g.gain.value = i === 2 ? 0.5 : 0.3;
    o.connect(g);
    g.connect(lp);
    o.start();
    oscs.push(o);
  }

  lp.connect(muteGain);
  muteGain.connect(out);
  out.connect(graph.dry);
  // A touch of reverb keeps it from sounding dry/static.
  const rev = ctx.createGain();
  rev.gain.value = 0.5;
  out.connect(rev);
  rev.connect(graph.reverbSend);

  let level = 0;
  let currentRoot = -1;

  function setBase() {
    // Pin the drone low: root pitch class, octaves 2–3.
    const baseMidi = 36 + system.rootPc; // C2- based
    const t = ctx.currentTime;
    oscs.forEach((o, i) => {
      const m = baseMidi + (i === 2 ? 12 : 0);
      o.frequency.setTargetAtTime(midiToFreq(m), t, 1.5);
    });
    currentRoot = system.rootPc;
  }
  setBase();

  return {
    name: 'drone',
    out,
    setMuted(m) {
      muteGain.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.2);
    },
    updateFrame() {
      // Follow key drift.
      if (system.rootPc !== currentRoot) setBase();
      const t = ctx.currentTime;
      // Brightness opens the low-pass; drone stays subdued overall.
      const bright = system.val('brightness');
      lp.frequency.setTargetAtTime(260 + bright * 900, t, 0.6);
      // Always present, gently louder when density is low (fills the space).
      const target = 0.16 + (1 - system.val('density')) * 0.08;
      out.gain.setTargetAtTime(target, t, 1.2);
      level = target;
    },
    getLevel: () => level,
  };
}
