// Algorithmic reverb: a synthesized impulse response (decaying, decorrelated
// stereo noise) feeding a ConvolverNode. No IR files — the buffer is generated
// at startup. "Space" controls the wet return level (IR length is fixed; bigger
// spaces are conveyed by more wet + the parallel delay).

export function createReverb(ctx, rng, { seconds = 5.5, decay = 3.2 } = {}) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Exponential decay envelope with a short build at the very start.
      const env = Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      data[i] = (rng.next() * 2 - 1) * env;
    }
  }

  const convolver = ctx.createConvolver();
  convolver.buffer = ir;

  // Tame the very high end of the reverb so it stays soft.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 6500;

  // Wet return level (driven by the "Space" macro).
  const wet = ctx.createGain();
  wet.gain.value = 0.0;

  convolver.connect(tone);
  tone.connect(wet);

  return {
    input: convolver, // voices' reverbSend connects here
    output: wet,
    setSpace(amount) {
      // amount 0..1 -> wet gain.
      const t = ctx.currentTime;
      wet.gain.setTargetAtTime(0.15 + amount * 0.85, t, 0.4);
    },
  };
}
