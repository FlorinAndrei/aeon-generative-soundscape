// The control surface. Five macro sliders that *nudge* the system (they write to
// targets, and pause that macro's autonomous walk only while held). A key/mood
// selector, per-layer mute/solo toggles, a seed field bound to the URL hash, and
// a record toggle that captures the live output to a downloadable file.

import { SCALE_NAMES, ROOT_NAMES } from '../engine/theory.js';

const MACRO_LABELS = {
  density: 'Density',
  brightness: 'Brightness',
  space: 'Space',
  drift: 'Drift',
  motion: 'Motion',
};

export function createControls(root, { system, voices, recorder, graph, seedToken, onReseed }) {
  root.innerHTML = '';

  // --- Output: master volume + evening tone --------------------------------
  const outGroup = document.createElement('div');
  outGroup.className = 'group';
  const outTitle = document.createElement('div');
  outTitle.className = 'group-title';
  outTitle.textContent = 'Output';
  outGroup.append(outTitle);

  const volRow = document.createElement('label');
  volRow.className = 'slider-row';
  const volSpan = document.createElement('span');
  volSpan.textContent = 'Volume';
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '1';
  vol.step = '0.01';
  vol.value = '1';
  vol.addEventListener('input', () => graph.setVolume(parseFloat(vol.value)));
  volRow.append(volSpan, vol);
  outGroup.append(volRow);

  // Sub level: how loud the low end sits (its own bus, so this won't duck the mix).
  const subRow = document.createElement('label');
  subRow.className = 'slider-row';
  const subSpan = document.createElement('span');
  subSpan.textContent = 'Sub';
  const subLevel = document.createElement('input');
  subLevel.type = 'range';
  subLevel.min = '0';
  subLevel.max = '4';
  subLevel.step = '0.05';
  subLevel.value = '2';
  subLevel.addEventListener('input', () => graph.setSubLevel(parseFloat(subLevel.value)));
  subRow.append(subSpan, subLevel);
  outGroup.append(subRow);

  const evening = document.createElement('button');
  evening.className = 'chip wide';
  evening.textContent = 'evening';
  let eveningOn = false;
  evening.addEventListener('click', () => {
    eveningOn = !eveningOn;
    evening.classList.toggle('on', eveningOn);
    graph.setEvening(eveningOn);
  });
  outGroup.append(evening);
  root.append(outGroup);

  // --- Macro sliders -------------------------------------------------------
  const macros = document.createElement('div');
  macros.className = 'group';
  for (const name of Object.keys(MACRO_LABELS)) {
    const row = document.createElement('label');
    row.className = 'slider-row';
    const span = document.createElement('span');
    span.textContent = MACRO_LABELS[name];
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = String(system.val(name));

    // Hold-to-steer: while dragging, lock the autonomous walk so the nudge sticks.
    const begin = () => system.setLocked(name, true);
    const end = () => system.setLocked(name, false);
    input.addEventListener('pointerdown', begin);
    input.addEventListener('pointerup', end);
    input.addEventListener('pointercancel', end);
    input.addEventListener('input', () => system.nudge(name, parseFloat(input.value)));

    row.append(span, input);
    macros.append(row);
    // Keep the slider thumb loosely in sync with the value as it eases/walks.
    setInterval(() => {
      if (document.activeElement !== input) input.value = String(system.val(name));
    }, 400);
  }
  // Freeze / observe: hold the current moment — pause autonomous drift while
  // still letting the sliders nudge.
  const freeze = document.createElement('button');
  freeze.className = 'chip wide';
  freeze.textContent = '❄ freeze';
  freeze.addEventListener('click', () => {
    const next = !system.frozen;
    system.setFrozen(next);
    freeze.classList.toggle('on', next);
    freeze.textContent = next ? '❄ frozen — observing' : '❄ freeze';
  });
  macros.append(freeze);
  root.append(macros);

  // --- Key / mood ----------------------------------------------------------
  const keyGroup = document.createElement('div');
  keyGroup.className = 'group';
  const keyLabel = document.createElement('div');
  keyLabel.className = 'group-title';
  keyLabel.textContent = 'Key & Mood';
  keyGroup.append(keyLabel);

  const keySel = selector(ROOT_NAMES, ROOT_NAMES[system.rootPc], (i) => {
    system.state.rootPc = i;
  });
  const modeSel = selector(SCALE_NAMES, system.scaleName, (_i, val) => {
    system.state.scaleName = val;
  });
  keyGroup.append(keySel, modeSel);
  // Reflect autonomous regime changes back into the selectors.
  setInterval(() => {
    keySel.value = ROOT_NAMES[system.rootPc];
    modeSel.value = system.scaleName;
  }, 600);
  root.append(keyGroup);

  // --- Layer mute/solo -----------------------------------------------------
  const layerGroup = document.createElement('div');
  layerGroup.className = 'group';
  const lt = document.createElement('div');
  lt.className = 'group-title';
  lt.textContent = 'Layers';
  layerGroup.append(lt);

  const soloState = new Set();
  function applyLayers() {
    const anySolo = soloState.size > 0;
    for (const v of voices) {
      const muted = btnState.get(v.name);
      const solo = soloState.has(v.name);
      const audible = anySolo ? solo : !muted;
      v.setMuted(!audible);
    }
  }
  const btnState = new Map();
  for (const v of voices) {
    btnState.set(v.name, false);
    const row = document.createElement('div');
    row.className = 'layer-row';
    const nm = document.createElement('span');
    nm.textContent = v.name;

    const mute = document.createElement('button');
    mute.textContent = 'mute';
    mute.className = 'chip';
    mute.addEventListener('click', () => {
      const m = !btnState.get(v.name);
      btnState.set(v.name, m);
      mute.classList.toggle('on', m);
      applyLayers();
    });

    const solo = document.createElement('button');
    solo.textContent = 'solo';
    solo.className = 'chip';
    solo.addEventListener('click', () => {
      if (soloState.has(v.name)) soloState.delete(v.name);
      else soloState.add(v.name);
      solo.classList.toggle('on', soloState.has(v.name));
      applyLayers();
    });

    row.append(nm, mute, solo);
    layerGroup.append(row);
  }
  root.append(layerGroup);

  // --- Seed ----------------------------------------------------------------
  const seedGroup = document.createElement('div');
  seedGroup.className = 'group';
  const st = document.createElement('div');
  st.className = 'group-title';
  st.textContent = 'Seed';
  const seedRow = document.createElement('div');
  seedRow.className = 'layer-row';
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.className = 'seed-input';
  seedInput.value = seedToken;
  const reseed = document.createElement('button');
  reseed.className = 'chip';
  reseed.textContent = 'load';
  reseed.addEventListener('click', () => onReseed(seedInput.value.trim() || seedToken));
  seedRow.append(seedInput, reseed);
  seedGroup.append(st, seedRow);
  root.append(seedGroup);

  // --- Record --------------------------------------------------------------
  const recGroup = document.createElement('div');
  recGroup.className = 'group';
  const recBtn = document.createElement('button');
  recBtn.className = 'chip wide';
  recBtn.textContent = '● record';
  let recording = false;
  recBtn.addEventListener('click', async () => {
    if (!recording) {
      recorder.start();
      recording = true;
      recBtn.textContent = '■ stop';
      recBtn.classList.add('on');
    } else {
      await recorder.stop();
      recording = false;
      recBtn.textContent = '● record';
      recBtn.classList.remove('on');
    }
  });
  recGroup.append(recBtn);
  root.append(recGroup);

  // --- Footer hint ---------------------------------------------------------
  const hint = document.createElement('div');
  hint.className = 'panel-hint';
  hint.textContent = 'press H to hide';
  root.append(hint);
}

function selector(items, current, onChange) {
  const sel = document.createElement('select');
  sel.className = 'select';
  items.forEach((it, i) => {
    const opt = document.createElement('option');
    opt.value = it;
    opt.textContent = it;
    sel.append(opt);
  });
  sel.value = current;
  sel.addEventListener('change', () => onChange(items.indexOf(sel.value), sel.value));
  return sel;
}
