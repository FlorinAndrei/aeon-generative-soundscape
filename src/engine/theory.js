// Musical scaffolding: scales/modes, MIDI->frequency, and scale-constrained note
// selection so the instrument is always consonant. The root and mode can drift
// during "regime changes" driven by the evolving system.

export const A4 = 440;

// Scale degrees as semitone offsets from the root.
export const SCALES = {
  'major-pentatonic': [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export const SCALE_NAMES = Object.keys(SCALES);

// Roots labelled for the UI (C..B), stored as MIDI pitch-class 0..11.
export const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFreq(midi) {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

// Collect every in-scale MIDI note within [minMidi, maxMidi].
export function scaleNotes(rootPc, scaleName, minMidi, maxMidi) {
  const degrees = SCALES[scaleName] || SCALES['minor-pentatonic'];
  const notes = [];
  for (let m = minMidi; m <= maxMidi; m++) {
    if (degrees.includes(((m - rootPc) % 12 + 12) % 12)) notes.push(m);
  }
  return notes;
}

// Build a gentle, mostly-stacked-thirds chord rooted near `centerMidi`,
// snapped to the current scale (so it stays diatonic).
export function scaleChord(rootPc, scaleName, centerMidi, size, rng) {
  const pool = scaleNotes(rootPc, scaleName, centerMidi - 5, centerMidi + 16);
  if (pool.length === 0) return [centerMidi];
  // Start from the scale tone nearest the center.
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const d = Math.abs(pool[i] - centerMidi);
    if (d < best) { best = d; idx = i; }
  }
  const chord = [];
  let i = idx;
  for (let n = 0; n < size && i < pool.length; n++) {
    chord.push(pool[i]);
    i += 2; // skip a scale degree -> thirds-ish voicing
  }
  // Occasionally drop the lowest note an octave for weight.
  if (chord.length && rng.chance(0.4)) chord[0] -= 12;
  return chord;
}

// A scale-friendly root drift used during regime changes: move around the
// circle of fifths-ish by picking a small interval that tends to sound related.
export function driftRoot(rootPc, rng) {
  const moves = [0, 5, 7, 2, 10, 3, 9]; // unison, IV, V, II, bVII, bIII, VI
  return (rootPc + rng.pick(moves)) % 12;
}
