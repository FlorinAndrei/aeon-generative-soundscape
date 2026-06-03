# Aeon — generative ambient soundscape instrument

A browser instrument that synthesizes an endlessly evolving ambient soundscape
**live** with the Web Audio API. No samples, no recordings — every sound is
generated from oscillators and runtime-built noise buffers. A slowly evolving
system drives it on its own; the user nudges tendencies (it's never directly
"played").

## Running it

No build step, no dependencies, no package.json. It's plain ES modules served as
static files. **Always serve with caching disabled.** Because there's no build
step, a cache-enabled server lets the browser keep stale ES modules across
reloads — you can edit a file, reload, and still run the old code (a real
debugging trap: it once looked like a fix wasn't working when the browser was
silently running the previous `canvas.js`). `http.server` has no cache flag, so
send `Cache-Control: no-store` ourselves:

```
python3 -c "import http.server as s; H=s.SimpleHTTPRequestHandler; _e=H.end_headers; H.end_headers=lambda self:(self.send_header('Cache-Control','no-store'),_e(self)); s.test(HandlerClass=H,port=8137)"
# open http://localhost:8137/index.html
```

`AudioContext` requires a user gesture, so nothing starts until you click the
"tap to begin" overlay. Press **H** (or tap the **☰** button — for phones, which
have no keyboard) to hide/show the control panel.

To test on a phone, serve on all interfaces and open `http://<your-LAN-IP>:8137/`
from the phone (same Wi-Fi) — still with caching disabled:

```
python3 -c "import http.server as s; H=s.SimpleHTTPRequestHandler; _e=H.end_headers; H.end_headers=lambda self:(self.send_header('Cache-Control','no-store'),_e(self)); s.test(HandlerClass=H,port=8137,bind='0.0.0.0')"
```

## Verifying changes

There are no automated tests. Verify by driving the real app in a browser
(Playwright MCP is the tool used during development):

1. Navigate to the served URL, click `#overlay` to start.
2. Check the console — it should be clean (no errors).
3. The canvas analyser haze only plots the lowest ~64 FFT bins (≈0–2.7 kHz), so
   it's useful for confirming low-end/soloed-voice energy but **cannot** show
   high-frequency changes (e.g. the motes' 16 kHz low-pass). Those need ears.
4. For anything timbral or spatial (reverb, panning, sub level, blend), confirm
   by listening — describe what to listen for and ask the user to confirm.

Always clean up Playwright artifacts (`.playwright-mcp/`, stray screenshots)
after verifying.

## Architecture

`src/main.js` is the bootstrap: behind the start gesture it builds the audio
graph, instantiates the system + voices + visuals, wires the UI, and runs two
loops.

**Two clocks** (Chris Wilson "Tale of Two Clocks" pattern):
- `engine/scheduler.js` — a lookahead scheduler that schedules *triggered* audio
  events on the precise `AudioContext` clock. It's driven by **two redundant
  clocks**: a `setInterval` (~25 ms) and an AudioWorklet metronome
  (`engine/clock-worklet.js`). The worklet runs on the audio render thread, which
  Chrome does *not* throttle when the page is hidden, so it keeps the scheduler
  ticking with the phone screen off (where `setInterval` is throttled to ~1 Hz).
  The lookahead is visibility-aware: ~0.2 s when visible, 1.5 s when hidden, so a
  single throttled wakeup still buffers enough audio to bridge the gap.
- a `requestAnimationFrame` loop in `main.js` — advances the system's inertia,
  pushes live macros to the continuous voices/sends, and drives the canvas. rAF
  stops entirely when the page is hidden, so autonomous evolution + visuals pause
  with the screen off; the triggered voices keep going via the scheduler above.

**The evolving system** (`engine/system.js`) holds five macros — `density`,
`brightness`, `space`, `drift`, `motion` — as `{value, target}` pairs. Each frame
`value` eases toward `target` (inertia); `target` random-walks on its own
(autonomy). Occasional "regime changes" drift the key/mode and bloom/lull
density. UI controls write to `target`, never `value` — that's why nudges lean
the system gradually instead of snapping it. `frozen` pauses all autonomous drift
while still letting nudges through.

**Determinism**: every random decision comes from one seeded PRNG
(`engine/rng.js`, mulberry32). The seed lives in the URL hash, so a link
reproduces the whole evolution. Never call `Math.random()` in audio/system logic
— thread `rng` through instead. (`Math.random()` is only acceptable in one-off UI
glue like generating a fresh seed token.)

**Music theory** (`engine/theory.js`): scales/modes, MIDI→freq, scale-constrained
note/chord selection so output is always consonant; the root drifts by
scale-friendly intervals.

### Voices (`src/voices/`)

Each voice is a factory returning an object with a common shape:
- `name`, `out` (its output gain), `setMuted(bool)`, `getLevel()` (for visuals).
- **Continuous** voices (`drone`, `sub`, `air`) implement `updateFrame()` —
  called every rAF frame to follow the live macros/key.
- **Triggered** voices (`pad`, `motes`) implement `nextEvent()` (returns the
  seconds until the next onset, scaled by density) and `trigger(time)` (schedules
  one event at an exact AudioContext time). The scheduler only touches voices that
  expose `nextEvent`.

Voices in `main.js` order: `drone`, `sub`, `pad`, `motes`, `air`. This order
drives the Layers list and the canvas orbs.

### Audio graph (`src/audio/context.js`)

Three limiters, each with a distinct job — **important and easy to get wrong**:

- **Main limiter** (−8 dB): the musical voices (drone/pad/motes/air) feed `dry` +
  the reverb/delay sends into this. It glues and protects the mix.
- **Sub bus → sub limiter**: the `sub` voice connects to `graph.subBus` (NOT
  `dry`), running parallel and **bypassing the main limiter**. This is deliberate:
  low frequencies otherwise dominate the peaks a shared limiter reacts to, so a
  loud sub would duck the whole mix. `subBus.gain` is the "Sub" slider.
- **Output limiter** (−0.8 dB brick wall): both buses meet here as a final safety
  near 0 dBFS; engages only on true peaks. Master `volume` sits *after* all
  limiting so it can never reintroduce clipping.

`evening` is a low-pass on the main bus, wide open (20 kHz) by default, clamped to
1.5 kHz when toggled on.

**Output path & background playback.** The final mix runs `userVol -> analyser ->
ctx.destination` (the direct speaker path) and also `userVol -> recordDest` (a
`MediaStreamDestination` used for recording). **On touch devices only**, `main.js`
also plays `recordDest.stream` through an `<audio>` element and calls
`graph.detachSpeakers()` to drop the direct path (so output isn't doubled): a
phone backgrounds/locks the tab, and routing through an `<audio>` media element
keeps the audio running there. Desktop has no such problem, so the `(pointer:
coarse)` gate keeps the clean direct path. With caching off, fresh code plays
smoothly on a phone both unlocked and locked. The context is created with
`latencyHint` set to **2× the platform's `'playback'` buffer** (probed at startup)
— latency is irrelevant here, and the large buffer is headroom against
underrun-crackle on CPU spikes. **Open issue:** the `<audio>`/MediaStream sink
adds latency `ctx.outputLatency` does not report, so the A/V-sync compensation
(see Visuals) under-covers on mobile and visuals there lead the sound.

Sends and effects:
- `reverb.js` — a *synthesized* impulse response (decaying stereo noise) into a
  `ConvolverNode`. The "Space" macro sets the wet return. The IR is **5.5 s** —
  this single always-on convolver is the heaviest node in the graph.
- `delay.js` — ping-pong delay (cross-fed delay lines). The "Motion" macro sets
  wet/feedback. Its output goes to master **and** into `reverbSend`, so echoes sit
  in the shared room (this is what blends the motes spatially — don't remove it
  without understanding why it's there).
- `noise.js` — pink + brown noise buffers generated once at startup.

### Visuals (`src/visuals/canvas.js`) & UI (`src/ui/controls.js`)

Visual ripples flow over a tiny event bus created in `main.js`: triggered voices
`emit('mote'|'pad', …)`, the canvas subscribes via `events.on`. The canvas reads
each voice's `getLevel()` for its drifting orb and the analyser for the haze.

**Audio/visual sync.** All visuals are timed against an *audible* clock, not
`ctx.currentTime`. Triggered voices are scheduled a lookahead ahead of their sound,
and that sound then takes the output buffer (`outputLatency`, ~0.3 s here because
of the big buffer above) to reach the speaker — so naïvely-drawn visuals lead the
sound by a third of a second. `main.js` exposes `audibleTime()` = the context time
*currently leaving the device* (`currentTime − outputLatency`, read live each
frame, so it adapts to the device). The event bus queues each visual and releases
it when `audibleTime()` reaches its scheduled `time`; the orb level bumps
(`motes`/`pad`) defer the same way; the analyser haze is drawn from a short ring
buffer of past spectra, picking the snapshot from `audibleTime()` ago. No hardcoded
latency — the offset is entirely device-derived. This is exact on the **direct**
speaker path (desktop), but on **mobile** the `<audio>`/MediaStream sink adds
latency `ctx.outputLatency` doesn't include, so the offset under-covers and
visuals still lead the sound there — unsolved. (Note: no build step means the
browser caches these ES modules; **always serve with caching off** — a stale
cached module silently runs old code and looked, in one session, like a fix that
"didn't work.")

Controls write to `system.nudge(...)` (macros), `system.setFrozen`, and the
`graph.set*` helpers (`setVolume`, `setSubLevel`, `setEvening`). Sliders lock a
macro's autonomous walk only while held. The panel is built imperatively from the
voices array and macro list, so adding a voice or macro propagates automatically.

## Mobile playback & performance

Chrome on Android is the stress case.

> ⚠️ **Caching caveat (read first).** The older bullets below were debugged while
> the browser was silently running **stale cached ES modules** (no build step →
> aggressive module caching), and on clean re-testing the mobile stutter problems
> **did not reproduce** — so treat them as unverified. Always serve with caching
> disabled (see *Running it*) and re-test with a hard reload. See **What clean
> testing shows** below for the current verified picture.

Older findings from debugging crackle/breakup on a phone (and the fixes in place):

- **Screen-off first broke up badly, then — once the worklet clock landed — kept
  playing.** The breakup was scheduler starvation: `setInterval` is throttled to
  ~1 Hz on a hidden page, so with the old 120 ms lookahead there were ~900 ms holes
  with nothing scheduled. (This bullet *also* claimed a bare AudioContext is
  suspended by Chrome on screen-lock — **not true**; see re-validated findings.)
  Fixed by the AudioWorklet clock + visibility-aware lookahead (keeps triggered
  voices scheduled) and the `<audio>`/MediaStream output path (reduces screen-off
  throttling). Both are described above.
- **Steady crackle was DSP saturation, not underruns.** Doubling the audio buffer
  (`latencyHint`) changed *nothing*; halving the reverb IR (5.5 → 2.5 s) helped a
  lot. So the phone was at/over its real-time DSP budget and the only real lever is
  *doing less work per sample* — more buffering can't help. The convolution reverb
  is the dominant cost (cost scales with IR length and is paid even on silence).
- **Polyphony was uncapped.** `motes.js` and `pad.js` created oscillators per onset
  with no limit; density blooms (regime changes) stacked dozens. Now capped (motes
  14 voices, pad 24 oscillators) — excess onsets are dropped, inaudibly sparse.

### What clean testing shows (June 2026, caching off, hard-reloaded on phone)

The stutter problems above were chased largely under the module-caching bug and
**did not hold up** on clean code (5.5 s reverb, `<audio>` sink enabled, caching
off): the phone plays **smoothly both unlocked and locked** — no startup stutter,
no screen-off stutter. Desktop is smooth and in sync. The mid-investigation
attempts to tie this to the sink pipeline or DSP/reverb load were chasing cache
artifacts, not real behavior.

**One confirmed open issue: on mobile, visuals lead the sound.** The A/V-sync
compensation reads `ctx.outputLatency`, but the `<audio>`/MediaStream sink adds
latency that value doesn't include, so the offset under-covers on the sink path
(it's exact on the desktop direct path). Unsolved.

**Older residual notes (pre-caching-fix, unverified):**

- **Bursts of crackle for a few seconds after the screen toggles on/off.** Mostly
  the Android CPU governor changing clocks/cores across the power transition (hence
  "settles after a few seconds"), plus the `<audio>` pipeline rebuffering and, on
  screen-*on*, the canvas (rAF) resuming abruptly. *Proposed:* lighten the canvas on
  mobile (throttle FPS, stop allocating gradients every frame, ease it in on
  resume). Won't fully vanish — it's partly OS-level.
- **Rare crackle during normal running.** Residual DSP spikes (density blooms; GC
  from per-frame canvas allocation). *Proposed:* the canvas cleanup above + the
  algorithmic reverb below.
- **Biggest remaining lever: replace the convolution reverb with a cheap
  algorithmic one** (Schroeder/FDN — a few delays + filters). Frees the most
  sustained CPU.
- **Last resort:** lower the mobile sample rate (e.g. 32 kHz, broad ~27 % cut),
  avoided so far for the high-end loss (motes are already low-passed at 16 kHz).
- **Out of our control:** the brief glitch when another app's notification sound
  steals audio focus (Android ducking).

## Conventions

- This repo commits **directly to `main`** — no feature branches, no PRs. Commit
  there when asked.
- Vanilla ES modules only. No frameworks, no bundler, no deps. Keep it that way.
- Comment density and naming match the existing files — short "why" comments above
  non-obvious audio routing, not narration of obvious code.
- Smooth every audible parameter change with `setTargetAtTime` /
  `linearRampToValueAtTime`; never hard-set a gain/frequency on a running node
  (clicks — brutal at low frequencies especially). Continuous voices ramp up from
  silence rather than starting at full level.
- When adding a macro: add it to `MACROS` in `system.js`; the UI picks it up.
- When adding a voice: implement the voice interface above, add it to the voices
  array in `main.js`; the scheduler, Layers UI, and canvas orbs follow.
