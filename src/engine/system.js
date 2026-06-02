// The evolving system. Holds the macro parameters as {value, target} pairs and a
// discrete musical state (root + mode). Every animation frame it:
//   1. eases each value toward its target (inertia),
//   2. nudges each target with a slow bounded random walk (autonomy),
//   3. occasionally triggers a "regime change" (key/mode drift, density bloom).
// User controls write to `target`, so a nudge leans the system gradually rather
// than snapping it — you steer tendencies, not values.

import { SCALE_NAMES, driftRoot } from './theory.js';

const MACROS = {
  density: 0.4, // how often pads/motes fire
  brightness: 0.5, // filter openness / partial content
  space: 0.55, // reverb wetness
  drift: 0.35, // how fast the system mutates itself
  motion: 0.4, // delay amount / stereo movement
};

export function createSystem(rng) {
  const params = {};
  for (const [k, v] of Object.entries(MACROS)) {
    params[k] = { value: v, target: v, min: 0, max: 1, locked: false };
  }

  const state = {
    rootPc: rng.int(0, 11),
    scaleName: rng.pick(SCALE_NAMES),
    // Seconds until the next autonomous regime change.
    nextRegime: rng.range(25, 50),
    elapsed: 0,
    // Bumped whenever the key/mode changes, so visuals/voices can react.
    regimeEpoch: 0,
    // When true, the system stops drifting on its own — the moment is held.
    // User nudges still apply (values keep easing toward their targets).
    frozen: false,
  };

  function val(name) {
    return params[name].value;
  }

  // External nudge from the UI: set a target (the value eases toward it).
  function nudge(name, target) {
    if (params[name]) params[name].target = Math.max(0, Math.min(1, target));
  }

  // Lock a macro so its autonomous walk pauses (used while a slider is held).
  function setLocked(name, locked) {
    if (params[name]) params[name].locked = locked;
  }

  function regimeChange() {
    state.regimeEpoch++;
    // Drift the key, and sometimes the mode.
    state.rootPc = driftRoot(state.rootPc, rng);
    if (rng.chance(0.5)) state.scaleName = rng.pick(SCALE_NAMES);
    // A bloom or lull in density makes the texture come and go.
    const bloom = rng.range(-0.25, 0.3);
    params.density.target = Math.max(0.08, Math.min(1, params.density.target + bloom));
    // Occasionally shift brightness mood.
    params.brightness.target = Math.max(0.1, Math.min(1, params.brightness.target + rng.walk(0.25)));
    state.nextRegime = rng.range(22, 55);
  }

  // Advance by dt seconds (called each animation frame).
  function update(dt) {
    const driftRate = val('drift');

    for (const name of Object.keys(params)) {
      const p = params[name];
      // Inertia: ease value toward target. Lower drift -> slower easing.
      // This always runs so user nudges take effect even while frozen.
      const ease = 1 - Math.pow(0.001, dt * (0.4 + driftRate));
      p.value += (p.target - p.value) * ease;
      // Autonomous walk on the target — paused while frozen or while the user
      // is holding this macro.
      if (!p.locked && !state.frozen) {
        const step = rng.walk(dt * driftRate * 0.06);
        p.target = Math.max(p.min, Math.min(p.max, p.target + step));
      }
    }

    // No autonomous evolution while frozen: hold the current key/mode/density.
    if (state.frozen) return;

    // Regime-change clock, accelerated by drift.
    state.elapsed += dt;
    if (state.elapsed * (0.5 + driftRate) >= state.nextRegime) {
      state.elapsed = 0;
      regimeChange();
    }
  }

  return {
    params,
    state,
    val,
    nudge,
    setLocked,
    setFrozen(b) { state.frozen = !!b; },
    update,
    forceRegime: regimeChange,
    get frozen() { return state.frozen; },
    get rootPc() { return state.rootPc; },
    get scaleName() { return state.scaleName; },
    get regimeEpoch() { return state.regimeEpoch; },
  };
}
