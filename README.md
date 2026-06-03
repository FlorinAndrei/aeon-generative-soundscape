# Aeon

A generative ambient soundscape instrument that runs entirely in the browser.
Every sound is **synthesized live** with the Web Audio API — no samples, no
recordings. Underneath runs a slowly evolving system that wanders on its own;
you nudge its tendencies rather than play notes, so it never quite holds still.

Demo: https://florinandrei.github.io/aeon-generative-soundscape/

## Run it locally

No build step and no dependencies — just static files. Serve the directory and
open it in a browser:

```sh
python3 -m http.server 8137
# then open http://localhost:8137/index.html
```

Click **tap to begin** to start audio (browsers require a gesture). Headphones
recommended.

## What's going on

Five layers, all generated from oscillators and runtime-built noise:

- **Drone** — detuned oscillators, the ground the rest floats on
- **Sub** — deep sine bass that swells in like a tide
- **Pad** — diatonic chords that fade in and out over many seconds
- **Motes** — FM bell/droplets, panned and echoing through the space
- **Air** — filtered noise, the "wind"

Notes stay within a musical scale (so it's always consonant), and the key drifts
on its own over time.

## Controls

Press **H** — or tap the **☰** button — to show/hide the panel.

- **Volume / Sub** — master level and how loud the low end sits
- **Density, Brightness, Space, Drift, Motion** — macro "tendencies" that nudge
  the system; it eases toward them with inertia rather than snapping:
  - **Density** — how often the pads and motes fire (sparse drips → busy texture)
  - **Brightness** — tone and sparkle (filter openness and the motes' FM richness)
  - **Space** — reverb wetness, the sense of a larger room around the sound
  - **Drift** — how fast the system mutates itself (steady → restless, more
    frequent key/mood changes)
  - **Motion** — delay/echo amount and stereo movement across the field
- **Freeze** — hold the current moment (pauses the autonomous drift; you can
  still nudge)
- **Evening** — a warm low-pass over everything
- **Key & Mood** — pick the root and scale (or let it drift)
- **Layers** — mute/solo each voice
- **Seed** — the soundscape's evolution is reproducible from a seed carried in the
  URL hash; share the link to share the exact soundscape, or load a new seed
- **Record** — capture the live output to a downloadable audio file

## Tech

Vanilla JavaScript ES modules, the Web Audio API, and a `<canvas>` for the
reactive visuals. No frameworks, no bundler, no dependencies. See
[CLAUDE.md](CLAUDE.md) for the architecture.
