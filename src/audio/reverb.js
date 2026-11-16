// Algorithmic reverb: a feedback delay network computed by an AudioWorklet
// (reverb-worklet.js). "Space" controls the wet return level (the decay time is
// fixed; bigger spaces are conveyed by more wet + the parallel delay).
//
// Why a worklet and not a ConvolverNode: the browser computes only the first
// ~0.25 s of a long impulse response on the real-time audio thread; the rest runs
// on a normal-priority background thread. On a phone, when the CPU is slowed
// (startup, screen off, unlock) that thread falls behind and the reverb tail
// breaks up — audible stutter with no output underrun. A worklet runs wholly on
// the real-time thread. (And not native delay/gain nodes either: a mixing matrix
// built from them inside a feedback cycle was unstable in Chrome.)
//
// Worklets need a secure context (HTTPS or localhost). Where one can't load, we
// fall back to the old convolver — it sounds right, but can stutter on phones.
// `rng` is a dedicated generator used only for that fallback's impulse, so the
// main random stream (and so the evolution) is the same on both paths.

export function createReverb(ctx, rng, { rt60 = 6.5, level = 0.14 } = {}) {
  const input = ctx.createGain(); // voices' reverbSend connects here

  // Tame the very high end of the reverb so it stays soft.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 6500;

  // Wet return level (driven by the "Space" macro).
  const wet = ctx.createGain();
  wet.gain.value = 0.0;
  tone.connect(wet);

  // The module loads asynchronously; the reverb is silent for that moment, which
  // falls inside the start fade-in.
  (async () => {
    try {
      await ctx.audioWorklet.addModule(new URL('./reverb-worklet.js', import.meta.url));
      const node = new AudioWorkletNode(ctx, 'aeon-fdn-reverb', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { rt60, level },
      });
      input.connect(node);
      node.connect(tone);
    } catch (e) {
      console.warn('Aeon: reverb worklet unavailable; using the convolution reverb (may stutter on phones)', e);
      input.connect(createConvolver(ctx, rng)).connect(tone);
    }
  })();

  return {
    input,
    output: wet,
    setSpace(amount) {
      // amount 0..1 -> wet gain.
      wet.gain.setTargetAtTime(0.15 + amount * 0.85, ctx.currentTime, 0.4);
    },
  };
}

// Fallback: a synthesized impulse response (decaying, decorrelated stereo noise)
// in a ConvolverNode.
function createConvolver(ctx, rng, { seconds = 5.5, decay = 3.2 } = {}) {
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
  return convolver;
}
