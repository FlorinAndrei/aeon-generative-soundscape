// AudioContext + master bus. The musical voices (drone, pad, motes, air) feed a
// dry bus and two sends (reverb, delay) into the MAIN limiter. The sub runs on
// its own parallel bus through its OWN limiter, bypassing the main limiter — so a
// loud sub can't duck the rest of the mix (low frequencies otherwise dominate the
// peaks a single shared limiter reacts to). Both buses meet at a final brick-wall
// limiter near 0 dBFS that only catches true peaks, then master volume, then the
// analyser (for visuals) and the speakers. A recording tap sits at the very end.

export function createAudioGraph() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Dry bus: where every musical voice's direct signal lands.
  const dry = ctx.createGain();
  dry.gain.value = 1;

  // Reverb + delay sends are filled in by their modules; voices connect to these.
  const reverbSend = ctx.createGain();
  const delaySend = ctx.createGain();
  reverbSend.gain.value = 1;
  delaySend.gain.value = 1;

  // Master + soft limiter so stacked voices never clip harshly.
  const master = ctx.createGain();
  master.gain.value = 0.0; // faded up on start

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 24;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.005;
  limiter.release.value = 0.25;

  // --- Sub bus: parallel low-end path, decoupled from the main limiter --------
  // The sub connects here instead of `dry`. The bus gain is the master "how loud
  // is the sub" knob; subLimiter is a gentle catch so big swells stay controlled.
  const subBus = ctx.createGain();
  subBus.gain.value = 2.0; // ~+6 dB over the old in-mix level

  const subLimiter = ctx.createDynamicsCompressor();
  subLimiter.threshold.value = -3;
  subLimiter.knee.value = 6;
  subLimiter.ratio.value = 8;
  subLimiter.attack.value = 0.004;
  subLimiter.release.value = 0.18;

  // --- Final safety: brick wall near 0 dBFS on the combined output ------------
  // Engages only on true peaks, so it rarely ducks anything audibly.
  const outLimiter = ctx.createDynamicsCompressor();
  outLimiter.threshold.value = -0.8;
  outLimiter.knee.value = 0;
  outLimiter.ratio.value = 20;
  outLimiter.attack.value = 0.002;
  outLimiter.release.value = 0.1;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.85;

  // Recording tap.
  const recordDest = ctx.createMediaStreamDestination();

  // "Evening" low-pass: warms/darkens the musical mix when engaged. Sits wide
  // open by default (effectively a bypass). Only on the main bus — the sub is
  // below its cutoff anyway and stays clean.
  const evening = ctx.createBiquadFilter();
  evening.type = 'lowpass';
  evening.frequency.value = 20000;
  evening.Q.value = 0.3;

  // User-facing master volume, placed after all limiting so it can't reintroduce
  // clipping. Independent of the start fade-in on `master`.
  const userVol = ctx.createGain();
  userVol.gain.value = 1;

  // Main path:  dry -> master(fade) -> evening(tone) -> mainLimiter ┐
  // Sub path:   subBus -> subLimiter ------------------------------ ┤
  //             both -> outLimiter(safety) -> userVol -> analyser -> out / record
  dry.connect(master);
  master.connect(evening);
  evening.connect(limiter);

  subBus.connect(subLimiter);

  limiter.connect(outLimiter);
  subLimiter.connect(outLimiter);
  outLimiter.connect(userVol);
  userVol.connect(analyser);
  analyser.connect(ctx.destination);
  userVol.connect(recordDest);

  return {
    ctx,
    dry,
    reverbSend,
    delaySend,
    subBus,
    master,
    evening,
    userVol,
    limiter,
    subLimiter,
    outLimiter,
    analyser,
    recordDest,
    // Smoothly bring the whole instrument up from silence.
    fadeIn(seconds = 4, level = 0.85) {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t);
      master.gain.linearRampToValueAtTime(level, t + seconds);
    },
    // 0..1 master volume (eased, so dragging doesn't zipper).
    setVolume(v) {
      userVol.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.08);
    },
    // Sub bus level (how loud the low end sits), eased. Default 2.0 (~+6 dB).
    setSubLevel(v) {
      subBus.gain.setTargetAtTime(Math.max(0, v), ctx.currentTime, 0.1);
    },
    // Engage/disengage the evening low-pass.
    setEvening(on) {
      evening.frequency.setTargetAtTime(on ? 1500 : 20000, ctx.currentTime, 0.6);
    },
  };
}
