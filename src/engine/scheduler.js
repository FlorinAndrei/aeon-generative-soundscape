// The "Tale of Two Clocks" lookahead scheduler (after Chris Wilson). A timer
// peeks a little into the future and asks each triggering voice to schedule any
// events due in that window on the precise AudioContext clock. Continuous voices
// (drone, sub, air) ignore this and are modulated per-frame instead.
//
// Two clocks drive the tick, on purpose:
//   1. a setInterval — cheap and precise enough in the foreground, but Chrome
//      throttles it to ~1Hz on a hidden page (e.g. phone screen off), and
//   2. an AudioWorklet clock (clock-worklet.js) that pings from the audio render
//      thread, which keeps running and is NOT timer-throttled when hidden.
// They run redundantly so whichever survives backgrounding keeps the triggered
// voices fed. We also widen the lookahead when the page is hidden: a single
// sparse wakeup then schedules enough audio to bridge the gap to the next one,
// instead of leaving ~900ms holes that break the sound up.

export function createScheduler(ctx, voices) {
  const LOOKAHEAD_FG = 0.2; // seconds scheduled ahead when visible (absorbs main-thread jank)
  const LOOKAHEAD_BG = 1.5; // ...when hidden, to bridge throttled wakeups
  const TICK = 25; // ms between setInterval checks

  let timer = null;
  let clockNode = null;
  // Each triggering voice tracks its own nextEventTime.
  const triggers = voices.filter((v) => typeof v.nextEvent === 'function');
  for (const v of triggers) v._next = ctx.currentTime + 0.5;

  function tick() {
    const horizon = ctx.currentTime + (document.hidden ? LOOKAHEAD_BG : LOOKAHEAD_FG);
    for (const v of triggers) {
      // Fire (and reschedule) every event that falls before the horizon. The
      // guard is generous because the wide background horizon can hold many
      // closely-spaced motes.
      let guard = 0;
      while (v._next < horizon && guard++ < 96) {
        v.trigger(v._next);
        const gap = v.nextEvent(); // voice returns its next inter-onset interval
        v._next += Math.max(0.02, gap);
      }
    }
  }

  // Best-effort: load the worklet clock and let it drive ticks too. If anything
  // fails (older browser, blocked module), the setInterval clock still runs and
  // the foreground is unaffected — only background resilience is lost.
  async function attachWorkletClock() {
    try {
      await ctx.audioWorklet.addModule(new URL('./clock-worklet.js', import.meta.url));
      clockNode = new AudioWorkletNode(ctx, 'aeon-clock', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      clockNode.port.onmessage = tick;
      clockNode.connect(ctx.destination); // silent; just needs to be pulled to run
    } catch (e) {
      console.warn('Aeon: audio-worklet clock unavailable; using timer only (background audio may break up)', e);
    }
  }

  return {
    start() {
      if (timer) return;
      const base = ctx.currentTime + 0.3;
      for (const v of triggers) v._next = base + Math.random() * 1.5;
      timer = setInterval(tick, TICK);
      attachWorkletClock();
    },
    stop() {
      clearInterval(timer);
      timer = null;
      if (clockNode) {
        clockNode.port.onmessage = null;
        clockNode.disconnect();
        clockNode = null;
      }
    },
  };
}
