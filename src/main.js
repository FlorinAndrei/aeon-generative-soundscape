// Bootstrap. Builds the audio graph behind a start gesture, instantiates the
// evolving system + voices + visuals, wires the UI, and runs the two loops: the
// lookahead scheduler (audio events) and the rAF frame loop (system inertia +
// canvas). The whole thing is reproducible from a seed carried in the URL hash.

import { makeRng, randomSeedToken } from './engine/rng.js';
import { createSystem } from './engine/system.js';
import { createScheduler } from './engine/scheduler.js';
import { createAudioGraph } from './audio/context.js';
import { createNoiseBuffers } from './audio/noise.js';
import { createReverb } from './audio/reverb.js';
import { createDelay } from './audio/delay.js';
import { createRecorder } from './audio/recorder.js';
import { createDrone } from './voices/drone.js';
import { createSub } from './voices/sub.js';
import { createPad } from './voices/pad.js';
import { createMotes } from './voices/motes.js';
import { createAir } from './voices/air.js';
import { createCanvas } from './visuals/canvas.js';
import { createControls } from './ui/controls.js';

// Resolve the seed: URL hash wins, else a fresh random token (written back to the
// hash so the link reproduces this exact evolution).
function resolveSeed() {
  const h = location.hash.replace(/^#/, '').trim();
  if (h) return h;
  const t = randomSeedToken();
  history.replaceState(null, '', '#' + t);
  return t;
}

function start() {
  const seedToken = resolveSeed();
  const rng = makeRng(seedToken);

  const graph = createAudioGraph();
  const { ctx } = graph;

  // Sends.
  const reverb = createReverb(ctx, rng);
  const delay = createDelay(ctx);
  graph.reverbSend.connect(reverb.input);
  reverb.output.connect(graph.master);
  graph.delaySend.connect(delay.input);
  delay.output.connect(graph.master);
  // Also feed the ping-pong echoes into the reverb, so they sit *in* the shared
  // room rather than floating dry in front of it (helps the motes blend in).
  // One-way path (reverb never feeds back to the delay), so no feedback loop.
  delay.output.connect(graph.reverbSend);

  const noise = createNoiseBuffers(ctx, rng);
  const system = createSystem(rng);

  // Simple event bus for visual ripples emitted by triggering voices.
  const events = { handlers: [], on(fn) { this.handlers.push(fn); }, emit(t, d) { for (const h of this.handlers) h(t, d); } };
  const emit = (t, d) => events.emit(t, d);

  const voices = [
    createDrone(ctx, graph, system, rng),
    createSub(ctx, graph, system, rng),
    createPad(ctx, graph, system, rng, noise, emit),
    createMotes(ctx, graph, system, rng, noise, emit),
    createAir(ctx, graph, system, rng, noise),
  ];

  const scheduler = createScheduler(ctx, voices);
  const recorder = createRecorder(graph.recordDest.stream);

  // Visuals.
  const canvasEl = document.getElementById('scene');
  createCanvas(canvasEl, system, voices, graph.analyser, events);

  // Controls.
  createControls(document.getElementById('panel'), {
    system,
    voices,
    recorder,
    graph,
    seedToken,
    onReseed(tok) {
      history.replaceState(null, '', '#' + tok);
      location.reload();
    },
  });

  // Resume + fade up + run loops.
  ctx.resume();
  graph.fadeIn(5, 0.85);
  scheduler.start();

  // Keep the sound alive with the screen off (mobile). Chrome suspends a bare
  // AudioContext when the screen locks, but keeps an <audio> element playing. So
  // we pipe the final mix through one via recordDest.stream; once it's playing,
  // drop the direct speaker path so output isn't doubled. If the browser refuses
  // element playback, the direct path stays and desktop is unaffected.
  const sink = new Audio();
  sink.srcObject = graph.recordDest.stream;
  const played = sink.play();
  if (played && played.then) played.then(() => graph.detachSpeakers()).catch(() => {});
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Aeon', artist: 'generative ambient soundscape' });
    navigator.mediaSession.playbackState = 'playing';
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    system.update(dt);
    // Push live macros to the continuous parameters + sends.
    reverb.setSpace(system.val('space'));
    delay.setMotion(system.val('motion'));
    for (const v of voices) if (v.updateFrame) v.updateFrame();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Coming back from a screen-off / backgrounded state, make sure both the
  // context and the <audio> sink are running again (some mobile builds pause
  // one or the other regardless of the keepalive above).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (sink.paused) sink.play().catch(() => {});
  });

  // Hide/show the control panel. H on desktop; a tap target on mobile (no
  // keyboard) — without it the full-width mobile panel hides the whole canvas.
  const togglePanel = () => document.body.classList.toggle('panel-hidden');
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'panel-toggle';
  toggleBtn.setAttribute('aria-label', 'show or hide controls');
  toggleBtn.textContent = '☰';
  toggleBtn.addEventListener('click', togglePanel);
  document.body.appendChild(toggleBtn);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') togglePanel();
  });
}

// Gate everything behind a user gesture (required to start an AudioContext).
const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => {
  overlay.classList.add('gone');
  start();
}, { once: true });
