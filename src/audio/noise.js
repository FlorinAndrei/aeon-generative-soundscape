// Runtime-generated noise buffers. No samples on disk — these are filled with
// math at startup and looped by the voices. Pink noise (Paul Kellet's economy
// filter) for air/wind; brown noise for low-end texture.

export function createNoiseBuffers(ctx, rng) {
  const seconds = 3;
  const len = ctx.sampleRate * seconds;

  const pink = ctx.createBuffer(1, len, ctx.sampleRate);
  const brown = ctx.createBuffer(1, len, ctx.sampleRate);
  const pinkData = pink.getChannelData(0);
  const brownData = brown.getChannelData(0);

  // Pink: Paul Kellet's refined method.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  // Brown: integrated white noise, leaky to avoid DC runaway.
  let last = 0;

  for (let i = 0; i < len; i++) {
    const white = rng.next() * 2 - 1;

    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    let p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    pinkData[i] = p * 0.11;

    last = (last + 0.02 * white) / 1.02;
    brownData[i] = last * 3.5;
  }

  return { pink, brown };
}

// Convenience: a looping buffer source already started.
export function loopingSource(ctx, buffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}
