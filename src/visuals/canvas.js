// Reactive canvas. A calm, slow scene that mirrors the system rather than
// analysing it literally: one drifting orb per voice (color from mood/brightness,
// size from that voice's level), a low-opacity analyser haze across the bottom,
// and expanding ripples emitted when motes/pads fire. Steered the same way you
// steer the sound — by tendency, not by frame.

// Visual palette — the canvas's color identity in one place (its half of the
// theme; the UI chrome's half lives in styles.css :root). Hue comes from the
// musical scale (mood) plus a per-voice offset; the saturation/lightness here are
// each layer's static character. The opacities and the lightness that track
// brightness/level/space stay inline in the draw loop — those are behavior, not
// palette. Saturation/lightness are percentages.
const PALETTE = {
  // Base hue per scale (mood color); fallback when a scale isn't mapped.
  scaleHue: {
    'major-pentatonic': 200,
    'minor-pentatonic': 260,
    dorian: 170,
    aeolian: 285,
    lydian: 50,
  },
  fallbackHue: 220,
  // Hue offset per voice orb, relative to the base hue.
  voiceHueOffset: { motes: 60, air: -30, sub: -70 },
  bg: { sat: 40 },                                  // background fill
  glow: { hueShift: 20, sat: 50 },                  // radial mood glow over it
  haze: { hueSpread: 1.5, sat: 70, light: 55 },     // analyser haze; hue fans out per bin
  orb: { sat: 80, light: 65 },                      // drifting per-voice orbs
  ripple: { hueShift: 40, sat: 85, light: 70 },     // mote/pad ripples
};

export function createCanvas(canvas, system, voices, analyser, events, clock) {
  const ctx = canvas.getContext('2d');
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  // The analyser taps the signal ~0.3s before it leaves the speaker, so a live
  // haze would lead the sound like everything else. We keep a short history of
  // the bins we plot and draw the snapshot from `clock.audible()` ago — the one
  // currently being heard. Preallocated ring (no per-frame allocation/GC, which
  // matters on mobile); `audible`/`now` come from main.js so the delay tracks the
  // device's real output latency. Falls back to the live spectrum with no clock.
  const HAZE_BINS = 64;
  const HIST = 64; // ~1s at 60fps / ~0.5s at 120fps — comfortably covers the latency
  const hazeRing = Array.from({ length: HIST }, () => new Uint8Array(HAZE_BINS));
  const hazeAt = new Float64Array(HIST);
  let hazeHead = 0, hazeCount = 0;

  const ripples = [];
  // One orb per voice with a slow independent drift.
  const orbs = voices.map((v, i) => ({
    voice: v,
    x: 0.3 + (i / voices.length) * 0.4,
    y: 0.4 + Math.sin(i) * 0.1,
    vx: (i % 2 ? 1 : -1) * 0.00004,
    vy: (i % 3 ? 1 : -1) * 0.00003,
    phase: i * 1.7,
  }));

  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function emit(type, data) {
    if (type === 'mote') {
      ripples.push({
        x: 0.5 + data.pan * 0.4,
        y: 0.2 + Math.random() * 0.6,
        r: 0,
        max: 0.12 + (data.strength || 0.5) * 0.1,
        life: 1,
        hue: PALETTE.scaleHue[system.scaleName] ?? PALETTE.fallbackHue,
      });
    } else if (type === 'pad') {
      ripples.push({
        x: 0.5 + (Math.random() - 0.5) * 0.3,
        y: 0.5,
        r: 0,
        max: 0.5,
        life: 1,
        slow: true,
        hue: PALETTE.scaleHue[system.scaleName] ?? PALETTE.fallbackHue,
      });
    }
    if (ripples.length > 80) ripples.splice(0, ripples.length - 80);
  }
  if (events) events.on(emit);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const baseHue = PALETTE.scaleHue[system.scaleName] ?? PALETTE.fallbackHue;
    const bright = system.val('brightness');
    const space = system.val('space');

    // Background: deep gradient that shifts with mood + brightness.
    const bgL = 4 + bright * 8;
    ctx.fillStyle = `hsl(${baseHue}, ${PALETTE.bg.sat}%, ${bgL}%)`;
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createRadialGradient(W * 0.5, H * 0.55, 0, W * 0.5, H * 0.55, Math.max(W, H) * 0.7);
    grad.addColorStop(0, `hsla(${baseHue + PALETTE.glow.hueShift}, ${PALETTE.glow.sat}%, ${10 + bright * 12}%, 0.6)`);
    grad.addColorStop(1, 'hsla(0,0%,0%,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Analyser haze along the bottom, delayed to the audible spectrum.
    analyser.getByteFrequencyData(freqData);
    let haze = freqData; // live fallback if no clock
    if (clock) {
      const slot = hazeRing[hazeHead];
      for (let i = 0; i < HAZE_BINS; i++) slot[i] = freqData[i];
      hazeAt[hazeHead] = clock.now();
      hazeHead = (hazeHead + 1) % HIST;
      if (hazeCount < HIST) hazeCount++;
      // Pick the most recent snapshot at or before the audible time. If the
      // buffer doesn't reach that far back (only possible at very high latency +
      // refresh rate), fall back to the OLDEST snapshot we have — the maximum
      // delay available — rather than the live spectrum, so it degrades toward
      // more compensation, never back to none.
      const want = clock.audible();
      let chosen = null, oldest = null;
      let bestT = -Infinity, oldestT = Infinity;
      for (let k = 0; k < hazeCount; k++) {
        const t = hazeAt[k];
        if (t <= want && t > bestT) { bestT = t; chosen = hazeRing[k]; }
        if (t < oldestT) { oldestT = t; oldest = hazeRing[k]; }
      }
      haze = chosen || oldest || freqData;
    }
    ctx.globalCompositeOperation = 'lighter';
    const bins = HAZE_BINS;
    for (let i = 0; i < bins; i++) {
      const v = haze[i] / 255;
      const x = (i / bins) * W;
      const h = v * H * 0.25;
      ctx.fillStyle = `hsla(${baseHue + i * PALETTE.haze.hueSpread}, ${PALETTE.haze.sat}%, ${PALETTE.haze.light}%, ${0.04 + v * 0.06})`;
      ctx.fillRect(x, H - h, W / bins + 1, h);
    }

    // Drifting orbs, one per voice.
    for (const o of orbs) {
      o.x += o.vx + Math.sin(now * 0.0001 + o.phase) * 0.00006;
      o.y += o.vy + Math.cos(now * 0.00013 + o.phase) * 0.00005;
      if (o.x < 0.12 || o.x > 0.88) o.vx *= -1;
      if (o.y < 0.15 || o.y > 0.85) o.vy *= -1;
      o.x = Math.max(0.1, Math.min(0.9, o.x));
      o.y = Math.max(0.12, Math.min(0.88, o.y));

      const lvl = o.voice.getLevel ? o.voice.getLevel() : 0.1;
      const r = (0.04 + lvl * 0.16) * Math.min(W, H);
      const cx = o.x * W;
      const cy = o.y * H;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const hue = baseHue + (PALETTE.voiceHueOffset[o.voice.name] ?? 0);
      g.addColorStop(0, `hsla(${hue}, ${PALETTE.orb.sat}%, ${PALETTE.orb.light}%, ${0.10 + lvl * 0.35})`);
      g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ripples.
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += (rp.slow ? 0.06 : 0.25) * dt;
      rp.life -= (rp.slow ? 0.12 : 0.45) * dt;
      if (rp.life <= 0) { ripples.splice(i, 1); continue; }
      const rr = rp.r * Math.min(W, H);
      ctx.strokeStyle = `hsla(${rp.hue + PALETTE.ripple.hueShift}, ${PALETTE.ripple.sat}%, ${PALETTE.ripple.light}%, ${rp.life * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rp.x * W, rp.y * H, rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    // Soft vignette grows with "space".
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'hsla(0,0%,0%,0)');
    vg.addColorStop(1, `hsla(0,0%,0%,${0.3 + space * 0.4})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
