// AudioWorklet "clock". The audio render thread keeps running even when a phone
// screen turns off (a page is exempt from freezing while it plays audio) and is
// NOT subject to the page-visibility timer throttling that strangles setInterval
// on hidden tabs. So we use it purely as a metronome: every ~25ms of rendered
// audio it pings the main thread, which drives the lookahead scheduler. It makes
// no sound (never writes its output) and stays alive for the life of the context.

class ClockProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._acc = 0;
    this._interval = Math.max(128, Math.round(sampleRate * 0.025)); // ~25ms in frames
  }

  process() {
    this._acc += 128; // one render quantum
    if (this._acc >= this._interval) {
      this._acc -= this._interval;
      this.port.postMessage(0);
    }
    return true; // keep the processor alive
  }
}

registerProcessor('aeon-clock', ClockProcessor);
