// Sub: deep, near-pure sine bass below the drone, breathing in and out like a
// tide. A primary sine sits an octave under the drone (~33–62 Hz, tracking the
// key); a second sine an octave lower again swells in only occasionally, dipping
// toward ~16–31 Hz for moments of real weight. Continuous and gently ramped —
// never hard-started, so there are no clicks at these frequencies. Kept almost
// dry, since reverb at these frequencies just turns to mud.

import { midiToFreq } from '../engine/theory.js';

export function createSub(ctx, graph, system, rng) {
  const out = ctx.createGain();
  out.gain.value = 0.0;

  const muteGain = ctx.createGain();
  muteGain.gain.value = 1;

  // A gentle low-pass keeps it pure and tames anything incidental up top.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 160;
  lp.Q.value = 0.5;

  // Primary sub (one octave below the drone) and the deeper octave dip.
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  const g1 = ctx.createGain();
  g1.gain.value = 0.0;

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  const g2 = ctx.createGain();
  g2.gain.value = 0.0; // the deep dip — mostly at rest, swells in now and then

  osc1.connect(g1); g1.connect(lp);
  osc2.connect(g2); g2.connect(lp);
  lp.connect(muteGain);
  muteGain.connect(out);
  out.connect(graph.subBus); // dedicated low-end bus, decoupled from the main limiter
  // Only a whisper of reverb — too much smears the low end.
  const rev = ctx.createGain();
  rev.gain.value = 0.1;
  out.connect(rev);
  rev.connect(graph.reverbSend);

  osc1.start();
  osc2.start();

  let currentRoot = -1;
  let level = 0;

  function setBase() {
    const t = ctx.currentTime;
    const m1 = 24 + system.rootPc; // C1-based: ~33–62 Hz
    osc1.frequency.setTargetAtTime(midiToFreq(m1), t, 2.0);
    osc2.frequency.setTargetAtTime(midiToFreq(m1 - 12), t, 2.0); // octave down: ~16–31 Hz
    currentRoot = system.rootPc;
  }
  setBase();

  return {
    name: 'sub',
    out,
    setMuted(m) {
      muteGain.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.3);
    },
    updateFrame() {
      if (system.rootPc !== currentRoot) setBase();
      const t = ctx.currentTime;
      // Always-present body, a touch fuller when the texture is sparse.
      const body = 0.1 + (1 - system.val('density')) * 0.05;
      g1.gain.setTargetAtTime(body, t, 1.5);
      // The deep octave breathes very slowly (~2 min cycle) and mostly rests near
      // zero, swelling toward the sub-20s only now and then. More "space" opens it.
      const swell = Math.max(0, Math.sin(t * 0.05)) ** 3;
      const deep = swell * (0.05 + system.val('space') * 0.07);
      g2.gain.setTargetAtTime(deep, t, 1.2);
      // Ramp the whole voice up from silence to match the master fade-in.
      out.gain.setTargetAtTime(0.9, t, 2.0);
      level = body + deep;
    },
    getLevel: () => level,
  };
}
