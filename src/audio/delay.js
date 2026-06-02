// Ping-pong delay: two DelayNodes cross-fed so echoes bounce L<->R. Adds motion
// and depth to sparse events (motes, pads) without any reverb-style smearing.

export function createDelay(ctx, { time = 0.42, feedback = 0.45 } = {}) {
  const splitGainL = ctx.createGain();
  const splitGainR = ctx.createGain();

  const delayL = ctx.createDelay(5.0);
  const delayR = ctx.createDelay(5.0);
  delayL.delayTime.value = time;
  delayR.delayTime.value = time * 1.5; // slightly uneven -> livelier bounce

  const fbL = ctx.createGain();
  const fbR = ctx.createGain();
  fbL.gain.value = feedback;
  fbR.gain.value = feedback;

  const panL = ctx.createStereoPanner();
  const panR = ctx.createStereoPanner();
  panL.pan.value = -0.7;
  panR.pan.value = 0.7;

  const wet = ctx.createGain();
  wet.gain.value = 0.0;

  // Tame echoes' high end a touch.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 4500;

  // Cross-feedback network.
  splitGainL.connect(delayL);
  splitGainR.connect(delayR);
  delayL.connect(tone);
  delayR.connect(tone);
  tone.connect(panL);
  tone.connect(panR);

  delayL.connect(fbL);
  fbL.connect(delayR); // L feeds R
  delayR.connect(fbR);
  fbR.connect(delayL); // R feeds L

  panL.connect(wet);
  panR.connect(wet);

  // input fans into both delay lines
  const input = ctx.createGain();
  input.connect(splitGainL);
  input.connect(splitGainR);

  return {
    input,
    output: wet,
    setMotion(amount) {
      const t = ctx.currentTime;
      wet.gain.setTargetAtTime(amount * 0.5, t, 0.5);
      fbL.gain.setTargetAtTime(0.3 + amount * 0.35, t, 0.5);
      fbR.gain.setTargetAtTime(0.3 + amount * 0.35, t, 0.5);
    },
  };
}
