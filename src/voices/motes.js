// Motes: short FM "bell/droplet" plucks with long tails, sprinkled in
// probabilistically and panned across the field. Each goes through the delay send
// so they bounce and trail. Density sets how often they fire; brightness sets the
// FM index (sparkle); a small voice pool caps polyphony.

import { midiToFreq, scaleNotes } from '../engine/theory.js';

export function createMotes(ctx, graph, system, rng, _noise, emit) {
  const out = ctx.createGain();
  out.gain.value = 0.5;

  const muteGain = ctx.createGain();
  muteGain.gain.value = 1;

  // Gentle low-pass on the motes' output. The FM bells are the only source with
  // significant high-frequency content on the dry path; at high Brightness their
  // sidebands reach toward Nyquist. This trims the very top octave so the highest
  // (and any near-/above-Nyquist) sidebands don't fizz or alias. Sits above the
  // musical content (~6-10 kHz), so it cleans the air without dulling the bells.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 16000;
  lp.Q.value = 0.5;

  muteGain.connect(lp);
  lp.connect(out);
  // Dedicated dry-path gain so the direct signal can be trimmed independently of
  // the delay/reverb sends (which tap from `out` below at full level). At 1.0 now,
  // but lower it here to push the motes back without drying out their tails.
  const dryGain = ctx.createGain();
  dryGain.gain.value = 1.0;
  out.connect(dryGain);
  dryGain.connect(graph.dry);
  // Motes lean on both delay (movement) and reverb (tail).
  const toDelay = ctx.createGain();
  toDelay.gain.value = 0.9;
  out.connect(toDelay);
  toDelay.connect(graph.delaySend);
  const toRev = ctx.createGain();
  toRev.gain.value = 0.6;
  out.connect(toRev);
  toRev.connect(graph.reverbSend);

  let level = 0;

  function trigger(time) {
    // Choose a note from the upper register of the current scale.
    const pool = scaleNotes(system.rootPc, system.scaleName, 60, 88);
    if (!pool.length) return;
    // Bias toward the middle of the available range.
    const idx = Math.floor((rng.next() ** 1.4) * pool.length);
    const midi = pool[Math.min(pool.length - 1, idx)];
    const freq = midiToFreq(midi);

    const bright = system.val('brightness');
    const decay = rng.range(1.5, 4.5);
    const peak = 0.10 + rng.range(0, 0.06);

    // FM: modulator -> carrier frequency.
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;

    const mod = ctx.createOscillator();
    const ratio = rng.pick([1, 2, 3, 3.5]);
    mod.frequency.value = freq * ratio;
    const modGain = ctx.createGain();
    // Brightness drives FM index; it also decays so the tail mellows.
    const index = freq * (0.4 + bright * 2.2);
    modGain.gain.setValueAtTime(index, time);
    modGain.gain.exponentialRampToValueAtTime(index * 0.05 + 0.001, time + decay * 0.6);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(peak, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, time + decay);

    const pan = ctx.createStereoPanner();
    pan.pan.value = rng.range(-0.8, 0.8);

    carrier.connect(env);
    env.connect(pan);
    pan.connect(muteGain);

    carrier.start(time);
    mod.start(time);
    carrier.stop(time + decay + 0.1);
    mod.stop(time + decay + 0.1);

    level = Math.min(1, level + 0.6);
    if (emit) emit('mote', { time, pan: pan.pan.value, midi, strength: peak * 6 });
  }

  function nextEvent() {
    const d = system.val('density');
    // High density -> short gaps; low density -> long, sparse drips.
    const base = rng.range(0.6, 4.0);
    return base * (1.25 - d) ** 2 + 0.15;
  }

  return {
    name: 'motes',
    out,
    trigger,
    nextEvent,
    setMuted(m) {
      muteGain.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.15);
    },
    updateFrame() {
      level *= 0.93;
    },
    getLevel: () => level,
  };
}
