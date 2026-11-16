// Feedback-delay-network reverb (see reverb.js for why it is a worklet).
// Stereo in -> three allpass diffusers per channel -> 8 delay lines, mixed by a
// Hadamard matrix and fed back -> signed taps to L/R. The per-line gain sets the
// decay time; a one-pole low-pass in each loop makes the highs die sooner, like
// air in a real room. No allocation in process(), so no GC on the audio thread.

const LINE_MS = [61.3, 71.9, 83.7, 93.1, 107.9, 124.7, 141.9, 160.7]; // mutually non-harmonic
const DIFFUSE_MS = [[7.1, 13.7, 23.3], [8.3, 15.1, 21.1]]; // L, R (different -> decorrelated)
const DIFFUSE_G = 0.6;
const DAMP = 0.2; // one-pole coefficient: higher = highs decay faster
const N = 8;
const NORM = 1 / Math.sqrt(N); // makes the Hadamard mix orthogonal (loop gain < 1)
const ANTI_DENORMAL = 1e-18;

class FdnReverb extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { rt60 = 6.5, level = 0.14 } = (options && options.processorOptions) || {};
    this.level = level;
    const frames = (ms) => Math.max(1, Math.round((ms / 1000) * sampleRate));

    this.lineLen = LINE_MS.map(frames);
    this.lineBuf = this.lineLen.map((n) => new Float32Array(n));
    this.linePos = new Int32Array(N);
    // -60 dB after rt60 seconds of round trips through each line.
    this.lineGain = Float64Array.from(LINE_MS, (ms) => Math.pow(10, (-3 * ms) / 1000 / rt60));
    this.damp = new Float64Array(N); // low-pass state per line
    this.x = new Float64Array(N); // scratch: line outputs, then the mixed feedback

    this.apLen = DIFFUSE_MS.map((ch) => ch.map(frames));
    this.apBuf = this.apLen.map((ch) => ch.map((n) => new Float32Array(n)));
    this.apPos = DIFFUSE_MS.map((ch) => new Int32Array(ch.length));
  }

  // Schroeder allpass chain for one channel.
  diffuse(ch, s) {
    const bufs = this.apBuf[ch];
    const lens = this.apLen[ch];
    const pos = this.apPos[ch];
    for (let k = 0; k < bufs.length; k++) {
      const buf = bufs[k];
      const p = pos[k];
      const delayed = buf[p];
      const v = s + DIFFUSE_G * delayed;
      buf[p] = v;
      pos[k] = p + 1 === lens[k] ? 0 : p + 1;
      s = delayed - DIFFUSE_G * v;
    }
    return s;
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const outL = out[0];
    const outR = out[1];
    const inL = inp && inp[0];
    const inR = inp && (inp[1] || inp[0]);
    const { lineBuf, lineLen, linePos, lineGain, damp, x, level } = this;

    for (let i = 0; i < outL.length; i++) {
      const dl = this.diffuse(0, inL ? inL[i] : 0);
      const dr = this.diffuse(1, inR ? inR[i] : 0);

      // Read each line, damp the highs, apply the decay gain.
      for (let k = 0; k < N; k++) {
        const y = lineBuf[k][linePos[k]];
        damp[k] = y + DAMP * (damp[k] - y);
        x[k] = damp[k] * lineGain[k];
      }

      // Signed taps, four lines per side, for a wide decorrelated image.
      outL[i] = (x[0] - x[3] + x[5] - x[6]) * level;
      outR[i] = (x[1] - x[2] + x[4] - x[7]) * level;

      // Hadamard mix in place (fast Walsh-Hadamard transform, three stages).
      for (let h = 4; h >= 1; h >>= 1) {
        for (let a = 0; a < N; a += h << 1) {
          for (let b = a; b < a + h; b++) {
            const u = x[b];
            const w = x[b + h];
            x[b] = u + w;
            x[b + h] = u - w;
          }
        }
      }

      // Write input + feedback back into the lines (even lines take L, odd R).
      for (let k = 0; k < N; k++) {
        const p = linePos[k];
        lineBuf[k][p] = (k & 1 ? dr : dl) + x[k] * NORM + ANTI_DENORMAL;
        linePos[k] = p + 1 === lineLen[k] ? 0 : p + 1;
      }
    }
    return true; // keep the tail alive when the input goes silent
  }
}

registerProcessor('aeon-fdn-reverb', FdnReverb);
