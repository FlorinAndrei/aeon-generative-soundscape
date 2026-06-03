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

  // The single visual-timing offset. Sound scheduled at AudioContext time `time`
  // is not *heard* until `time + outputLatency`: the render clock (ctx.currentTime,
  // where triggered events are scheduled AND where the analyser taps) leads the
  // speaker by the whole output buffer — ~0.3s here, because we deliberately run a
  // large buffer for mobile stability (see audio/context.js). Left uncompensated,
  // every visual leads the sound by that much. `audibleTime()` is the context time
  // currently *leaving the device*; driving all visuals off it (instead of
  // currentTime) lands them with what you hear. Re-read each frame — it's
  // device-dependent and can drift.
  function audibleTime() {
    const l = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    if (l > 0) return ctx.currentTime - l;
    // Browsers without outputLatency (e.g. older Safari): fall back to the spec's
    // currentTime/contextTime correlation, then to currentTime (no compensation).
    const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
    if (ts && ts.contextTime > 0) return ts.contextTime;
    return ctx.currentTime;
  }

  // Event bus for visual ripples emitted by triggering voices. A voice is
  // triggered a lookahead *before* its sound's scheduled `time`, and that sound is
  // then only heard `outputLatency` later again — so we queue each visual and
  // release it once `audibleTime()` reaches its `time` (drained by the rAF loop
  // below). That single condition absorbs both leads: the lookahead (handled by
  // queuing at all) and the output latency (handled by the audible clock).
  // Events with no `time` dispatch immediately; ones that miss their moment (page
  // hidden, big jank) are dropped rather than fired late in a burst.
  const events = {
    handlers: [],
    queue: [],
    on(fn) { this.handlers.push(fn); },
    dispatch(t, d) { for (const h of this.handlers) h(t, d); },
    emit(t, d) {
      if (!d || typeof d.time !== 'number') { this.dispatch(t, d); return; }
      this.queue.push({ t, d });
      if (this.queue.length > 256) this.queue.shift(); // backstop while hidden (no flush)
    },
    flush(now) {
      if (!this.queue.length) return;
      const due = [];
      this.queue = this.queue.filter((e) => {
        if (e.d.time > now) return true;            // not yet
        if (e.d.time >= now - 0.3) due.push(e);     // due and still fresh -> draw
        return false;                               // else missed its moment -> drop
      });
      for (const e of due) this.dispatch(e.t, e.d);
    },
  };
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
  // `clock` lets the canvas delay the analyser haze to match the sound (same
  // offset as the triggered visuals): `now` tags each captured spectrum, `audible`
  // says which past spectrum is the one currently leaving the speaker.
  const clock = { now: () => ctx.currentTime, audible: audibleTime };
  createCanvas(canvasEl, system, voices, graph.analyser, events, clock);

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

  // Keep the sound alive with the screen off — touch devices only. A phone
  // backgrounds/locks the tab; routing the mix through an <audio> element fed by
  // recordDest.stream keeps it playing as active media. Once it's playing we drop
  // the direct speaker path so output isn't doubled. Desktop has no such problem,
  // so the (pointer: coarse) gate keeps the clean direct ctx.destination path.
  // With caching off, fresh code plays smoothly on a phone both unlocked and
  // locked (the stutter we once chased here was a stale-cached-module artifact).
  // KNOWN OPEN ISSUE: the <audio>/MediaStream sink adds latency that
  // ctx.outputLatency does not report, so the A/V-sync compensation under-covers
  // on mobile and visuals there lead the sound. Unsolved — see CLAUDE.md.
  let sink = null;
  const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (touch) {
    sink = new Audio();
    sink.srcObject = graph.recordDest.stream;
    const played = sink.play();
    if (played && played.then) played.then(() => graph.detachSpeakers()).catch(() => {});
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Aeon', artist: 'generative ambient soundscape' });
      navigator.mediaSession.playbackState = 'playing';
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    system.update(dt);
    // Push live macros to the continuous parameters + sends.
    reverb.setSpace(system.val('space'));
    delay.setMotion(system.val('motion'));
    const audible = audibleTime();
    for (const v of voices) if (v.updateFrame) v.updateFrame(audible);
    events.flush(audible); // release visuals whose sound is now leaving the speaker
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Coming back from a screen-off / backgrounded state, make sure both the
  // context and the <audio> sink are running again (some mobile builds pause
  // one or the other regardless of the keepalive above).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (sink && sink.paused) sink.play().catch(() => {});
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
