// The "Tale of Two Clocks" lookahead scheduler (after Chris Wilson). A coarse
// setInterval timer peeks ~120ms into the future and asks each triggering voice
// to schedule any events due in that window on the precise AudioContext clock.
// Continuous voices (drone, air) ignore this and are modulated per-frame instead.

export function createScheduler(ctx, voices) {
  const LOOKAHEAD = 0.12; // seconds scheduled ahead
  const TICK = 25; // ms between checks

  let timer = null;
  // Each triggering voice tracks its own nextEventTime.
  const triggers = voices.filter((v) => typeof v.nextEvent === 'function');
  for (const v of triggers) v._next = ctx.currentTime + 0.5;

  function tick() {
    const horizon = ctx.currentTime + LOOKAHEAD;
    for (const v of triggers) {
      // Fire (and reschedule) every event that falls before the horizon.
      let guard = 0;
      while (v._next < horizon && guard++ < 16) {
        v.trigger(v._next);
        const gap = v.nextEvent(); // voice returns its next inter-onset interval
        v._next += Math.max(0.02, gap);
      }
    }
  }

  return {
    start() {
      if (timer) return;
      const base = ctx.currentTime + 0.3;
      for (const v of triggers) v._next = base + Math.random() * 1.5;
      timer = setInterval(tick, TICK);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
