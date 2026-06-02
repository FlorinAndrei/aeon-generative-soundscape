// Air: pink noise through a band-pass filter that slowly sweeps — the "wind" of
// the soundscape. Continuous; the sweep rate and band follow brightness/motion.

import { loopingSource } from '../audio/noise.js';

export function createAir(ctx, graph, system, rng, noise) {
  const out = ctx.createGain();
  out.gain.value = 0.0;

  const muteGain = ctx.createGain();
  muteGain.gain.value = 1;

  const src = loopingSource(ctx, noise.pink);

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700;
  bp.Q.value = 1.2;

  // Slow sweep LFO on the band center.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 400;
  lfo.connect(lfoGain);
  lfoGain.connect(bp.frequency);
  lfo.start();

  src.connect(bp);
  bp.connect(muteGain);
  muteGain.connect(out);
  out.connect(graph.dry);
  // Air is heavily reverbed — it's mostly atmosphere.
  const rev = ctx.createGain();
  rev.gain.value = 0.9;
  out.connect(rev);
  rev.connect(graph.reverbSend);
  src.start();

  let level = 0;

  return {
    name: 'air',
    out,
    setMuted(m) {
      muteGain.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.3);
    },
    updateFrame() {
      const t = ctx.currentTime;
      const bright = system.val('brightness');
      const motion = system.val('motion');
      // Brighter -> higher band; more motion -> faster sweep.
      bp.frequency.setTargetAtTime(450 + bright * 1600, t, 0.8);
      lfo.frequency.setTargetAtTime(0.02 + motion * 0.12, t, 1.0);
      const target = 0.05 + bright * 0.07;
      out.gain.setTargetAtTime(target, t, 1.5);
      level = target;
    },
    getLevel: () => level,
  };
}
