# Aeon — generative ambient soundscape instrument

A browser instrument that synthesizes an endlessly evolving ambient soundscape
**live** with the Web Audio API. No samples, no recordings — every sound is
generated from oscillators and runtime-built noise buffers. A slowly evolving
system drives it on its own; the user nudges tendencies (it's never directly
"played").

## Running it

No build step, no dependencies, no package.json. It's plain ES modules served as
static files. Serve the directory and open it:

```
python3 -m http.server 8137
# open http://localhost:8137/index.html
```

`AudioContext` requires a user gesture, so nothing starts until you click the
"tap to begin" overlay. Press **H** to hide/show the control panel.

## Verifying changes

There are no automated tests. Verify by driving the real app in a browser
(Playwright MCP is the tool used during development):

1. Navigate to the served URL, click `#overlay` to start.
2. Check the console — the only expected error is a `favicon.ico` 404.
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
- `engine/scheduler.js` — a `setInterval` lookahead (~25 ms) that schedules
  *triggered* audio events ~120 ms ahead on the precise `AudioContext` clock.
- a `requestAnimationFrame` loop in `main.js` — advances the system's inertia,
  pushes live macros to the continuous voices/sends, and drives the canvas.

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
1.5 kHz when toggled on. The recording tap (`recordDest`) is at the very end.

Sends and effects:
- `reverb.js` — a *synthesized* impulse response (decaying stereo noise) into a
  `ConvolverNode`. The "Space" macro sets the wet return.
- `delay.js` — ping-pong delay (cross-fed delay lines). The "Motion" macro sets
  wet/feedback. Its output goes to master **and** into `reverbSend`, so echoes sit
  in the shared room (this is what blends the motes spatially — don't remove it
  without understanding why it's there).
- `noise.js` — pink + brown noise buffers generated once at startup.

### Visuals (`src/visuals/canvas.js`) & UI (`src/ui/controls.js`)

Visual ripples flow over a tiny event bus created in `main.js`: triggered voices
`emit('mote'|'pad', …)`, the canvas subscribes via `events.on`. The canvas reads
each voice's `getLevel()` for its drifting orb and the analyser for the haze.

Controls write to `system.nudge(...)` (macros), `system.setFrozen`, and the
`graph.set*` helpers (`setVolume`, `setSubLevel`, `setEvening`). Sliders lock a
macro's autonomous walk only while held. The panel is built imperatively from the
voices array and macro list, so adding a voice or macro propagates automatically.

## Conventions

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
