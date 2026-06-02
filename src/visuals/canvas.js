// Reactive canvas. A calm, slow scene that mirrors the system rather than
// analysing it literally: one drifting orb per voice (color from mood/brightness,
// size from that voice's level), a low-opacity analyser haze across the bottom,
// and expanding ripples emitted when motes/pads fire. Steered the same way you
// steer the sound — by tendency, not by frame.

const HUES = {
  'major-pentatonic': 200,
  'minor-pentatonic': 260,
  dorian: 170,
  aeolian: 285,
  lydian: 50,
};

export function createCanvas(canvas, system, voices, analyser, events) {
  const ctx = canvas.getContext('2d');
  const freqData = new Uint8Array(analyser.frequencyBinCount);

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
        hue: HUES[system.scaleName] ?? 220,
      });
    } else if (type === 'pad') {
      ripples.push({
        x: 0.5 + (Math.random() - 0.5) * 0.3,
        y: 0.5,
        r: 0,
        max: 0.5,
        life: 1,
        slow: true,
        hue: HUES[system.scaleName] ?? 220,
      });
    }
    if (ripples.length > 80) ripples.splice(0, ripples.length - 80);
  }
  if (events) events.on(emit);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const baseHue = HUES[system.scaleName] ?? 220;
    const bright = system.val('brightness');
    const space = system.val('space');

    // Background: deep gradient that shifts with mood + brightness.
    const bgL = 4 + bright * 8;
    ctx.fillStyle = `hsl(${baseHue}, 40%, ${bgL}%)`;
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createRadialGradient(W * 0.5, H * 0.55, 0, W * 0.5, H * 0.55, Math.max(W, H) * 0.7);
    grad.addColorStop(0, `hsla(${baseHue + 20}, 50%, ${10 + bright * 12}%, 0.6)`);
    grad.addColorStop(1, 'hsla(0,0%,0%,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Analyser haze along the bottom.
    analyser.getByteFrequencyData(freqData);
    ctx.globalCompositeOperation = 'lighter';
    const bins = 64;
    for (let i = 0; i < bins; i++) {
      const v = freqData[i] / 255;
      const x = (i / bins) * W;
      const h = v * H * 0.25;
      ctx.fillStyle = `hsla(${baseHue + i * 1.5}, 70%, 55%, ${0.04 + v * 0.06})`;
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
      const hue = baseHue + (o.voice.name === 'motes' ? 60 : o.voice.name === 'air' ? -30 : o.voice.name === 'sub' ? -70 : 0);
      g.addColorStop(0, `hsla(${hue}, 80%, 65%, ${0.10 + lvl * 0.35})`);
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
      ctx.strokeStyle = `hsla(${rp.hue + 40}, 85%, 70%, ${rp.life * 0.5})`;
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
