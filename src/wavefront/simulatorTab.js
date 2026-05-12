// Tab 2 — Simulator (the customer-facing surface).
// Single-piece HUD bar + lens stage + score panel aside + bottom controls.

import { state, update, subscribe } from './state.js';
import { GRADES } from '../optics/grades.js';
import { getGeom, CORRIDOR_OPTIONS } from './helpers.js';
import { createBinocularLenses } from './lensBox.js';
import { createCombinedRatioBar, createRatioPanel } from './ratioPanel.js';
import { mountRecommender, mountGradeSpecCard } from './lifestyleRecommender.js';

const RX_LIMITS = {
  sphere:   { min: -10,  max: 6,   step: 0.25 },
  cylinder: { min: -4,   max: 0,   step: 0.25 },
  axis:     { min: 0,    max: 180, step: 5    },
};

export function mountSimulatorTab(root) {
  root.innerHTML = `
    <div class="sim-shell">
      <aside class="sim-side-panel sim-side-os" id="sim-side-os"></aside>
      <div class="sim-stage">
        <div class="sim-hud" id="sim-hud"></div>
        <div class="sim-lens-wrap" id="sim-lens-wrap"></div>
      </div>
      <aside class="sim-side-panel sim-side-od" id="sim-side-od"></aside>
      <aside class="sim-aside">
        <div class="sim-aside-content" id="sim-aside-content"></div>
      </aside>
    </div>
    <div class="sim-controls">
      <div class="sim-ctrl-block">
        <div class="sim-ctrl-label">렌즈 등급 · GRADE</div>
        <div class="grade-pills-lg" id="sim-grades"></div>
      </div>
      <div class="sim-ctrl-block sim-ctrl-add">
        <div class="sim-ctrl-label">ADD · 가입도</div>
        <div class="add-control">
          <button class="stepper" id="sim-add-minus">−</button>
          <div class="add-display" id="sim-add-display">+2.00</div>
          <button class="stepper" id="sim-add-plus">+</button>
        </div>
      </div>
      <div class="sim-ctrl-block">
        <div class="sim-ctrl-label">누진대 · CORRIDOR</div>
        <div class="sim-ctrl-corridor-row">
          <div class="corridor-pills-lg" id="sim-corridors"></div>
          <div class="corridor-note">
            <div class="corridor-note-h">ⓘ 길수록 좋은 건 아닙니다</div>
            <div class="corridor-note-body">왜곡은 줄지만 근거리를 볼 때 눈을 더 아래로 내려야 합니다.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Lens viewer
  const lensWrap = root.querySelector('#sim-lens-wrap');
  let dual = null;
  function buildLens() {
    const ASPECT = 0.56;
    const availW = lensWrap.clientWidth - 4;
    const availH = lensWrap.clientHeight - 4;
    let w = Math.min(960, availW);
    let h = w * ASPECT;
    if (h > availH) { h = availH; w = h / ASPECT; }
    w = Math.max(200, Math.round(w));
    h = Math.max(120, Math.round(h));
    if (lensWrap.firstChild) lensWrap.removeChild(lensWrap.firstChild);
    dual = createBinocularLenses(w, h, geomFor(state, 'OD'), geomFor(state, 'OS'),
      { showIso: state.showIso, showBands: state.showBands, showMarkings: state.showMarkings, environment: 'driving' });
    lensWrap.appendChild(dual.el);
  }
  requestAnimationFrame(() => requestAnimationFrame(buildLens));

  // Right aside (top→bottom): OU 양안 평균 → 추천 등급 spec 카드 → 추천 결과 카드.
  // (OD/OS 점수 패널은 stage 양옆 gutter로 이동 — iPad Safari fold 회피)
  const aside = root.querySelector('#sim-aside-content');
  const ouBar = createCombinedRatioBar(geomFor(state, 'OD'), geomFor(state, 'OS'), state.threshold);
  aside.appendChild(ouBar.el);
  mountGradeSpecCard(aside);
  mountRecommender(aside);

  // Side panels — OD/OS individual Clear Vision Field in stage gutters.
  // Lens widget convention is OS-left / OD-right (1인칭 뷰).
  const odPanel = createRatioPanel(geomFor(state, 'OD'), { eyeLabel: 'OD · 우안', threshold: state.threshold });
  const osPanel = createRatioPanel(geomFor(state, 'OS'), { eyeLabel: 'OS · 좌안', threshold: state.threshold });
  root.querySelector('#sim-side-od').appendChild(odPanel.el);
  root.querySelector('#sim-side-os').appendChild(osPanel.el);

  // Grade pills
  const gradeBox = root.querySelector('#sim-grades');
  GRADES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'grade-pill-lg';
    btn.dataset.grade = g.id;
    btn.dataset.active = String(state.grade === g.id);
    btn.innerHTML = `<span class="gp-num">${g.id}</span><span class="gp-bp">${g.bpCode}</span><span class="gp-name">${g.name}</span>`;
    btn.addEventListener('click', () => update({ grade: g.id }));
    gradeBox.appendChild(btn);
  });

  // ADD steppers
  const addDisplay = root.querySelector('#sim-add-display');
  root.querySelector('#sim-add-minus').addEventListener('click', () => update({ add: clamp(state.add - 0.25, 0.5, 3.5) }));
  root.querySelector('#sim-add-plus').addEventListener('click', () => update({ add: clamp(state.add + 0.25, 0.5, 3.5) }));

  // Corridor pills
  const corBox = root.querySelector('#sim-corridors');
  CORRIDOR_OPTIONS.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.dataset.corridor = c;
    btn.dataset.active = String(state.corridor === c);
    btn.textContent = `${c}mm`;
    btn.addEventListener('click', () => update({ corridor: c }));
    corBox.appendChild(btn);
  });

  // HUD
  const hud = root.querySelector('#sim-hud');
  hud.innerHTML = `
    ${rxRowHud('od', 'OD', state.od)}
    <label class="hud-sync" title="양안 동기화: 한쪽을 바꾸면 반대쪽도 같이 변경됩니다">
      <input type="checkbox" id="hud-sync" ${state.syncEyes ? 'checked' : ''}>
      <span class="hud-sync-track"></span>
      <span class="hud-sync-label">양안 동기화</span>
    </label>
    ${rxRowHud('os', 'OS', state.os)}
  `;

  // ± steppers
  hud.querySelectorAll('.hud-step').forEach(btn => {
    const eye = btn.dataset.eye, field = btn.dataset.field, dir = Number(btn.dataset.dir);
    const lim = RX_LIMITS[field];
    btn.addEventListener('click', () => {
      const v = clampStep(state[eye][field] + dir * lim.step, lim);
      const patch = { [eye]: { [field]: v } };
      if (state.syncEyes) patch[eye === 'od' ? 'os' : 'od'] = { [field]: v };
      update(patch);
    });
  });

  // Direct-edit Rx inputs — fast jumping for high prescriptions.
  // User can tap the value to edit; Enter or blur commits the clamped value,
  // Escape cancels.
  hud.querySelectorAll('input.hud-rx-input').forEach(inp => {
    const eye = inp.dataset.eye, field = inp.dataset.field;
    const lim = RX_LIMITS[field];
    inp.addEventListener('focus', () => inp.select());
    const commit = () => {
      const v = clampStep(parseRxText(inp.value), lim);
      inp.value = formatRx(v, field);
      const patch = { [eye]: { [field]: v } };
      if (state.syncEyes) patch[eye === 'od' ? 'os' : 'od'] = { [field]: v };
      update(patch);
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { inp.value = formatRx(state[eye][field], field); inp.blur(); }
    });
  });

  // Sync-eyes toggle
  hud.querySelector('#hud-sync').addEventListener('change', (e) => {
    const on = e.target.checked;
    const patch = { syncEyes: on };
    // When turning ON, immediately mirror OD → OS so the two eyes match
    if (on) patch.os = { ...state.od };
    update(patch);
  });

  function refreshHud(s) {
    ['od', 'os'].forEach(eye => {
      ['sphere', 'cylinder', 'axis'].forEach(field => {
        const inp = hud.querySelector(`input.hud-rx-input[data-eye="${eye}"][data-field="${field}"]`);
        if (inp && document.activeElement !== inp) {
          inp.value = formatRx(s[eye][field], field);
        }
      });
    });
    const sync = hud.querySelector('#hud-sync');
    if (sync) sync.checked = s.syncEyes;
  }
  refreshHud(state);

  subscribe(s => {
    root.querySelectorAll('[data-grade]').forEach(b => b.dataset.active = String(s.grade === Number(b.dataset.grade)));
    root.querySelectorAll('[data-corridor]').forEach(b => b.dataset.active = String(s.corridor === Number(b.dataset.corridor)));
    addDisplay.textContent = '+' + s.add.toFixed(2);
    refreshHud(s);
    if (dual) {
      const od = geomFor(s, 'OD'), os = geomFor(s, 'OS');
      dual.update({ od, os, opts: { showIso: s.showIso, showBands: s.showBands, showMarkings: s.showMarkings, environment: 'driving' } });
      ouBar.update({ od, os, threshold: s.threshold });
      odPanel.update({ geom: od, threshold: s.threshold });
      osPanel.update({ geom: os, threshold: s.threshold });
    }
  });

  let lastActive = state.activeTab;
  subscribe(s => {
    if (s.activeTab === 'simulator' && lastActive !== 'simulator') {
      requestAnimationFrame(() => requestAnimationFrame(buildLens));
    }
    lastActive = s.activeTab;
  });
  window.addEventListener('resize', () => {
    if (state.activeTab === 'simulator') requestAnimationFrame(buildLens);
  });
}

function geomFor(s, eye) {
  const rx = eye === 'OS' ? s.os : s.od;
  return getGeom({ grade: s.grade, corridorLength: s.corridor, add: s.add,
    sphere: rx.sphere, cylinder: rx.cylinder, axis: rx.axis, eye });
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, Math.round(v / 0.25) * 0.25)); }
function rxRowHud(eye, label, val) {
  return `
    <div class="hud-rx-row">
      <span class="hud-rx-tag ${eye}">${label}</span>
      ${hudField(eye, 'sphere',   'S',  val.sphere)}
      ${hudField(eye, 'cylinder', 'C',  val.cylinder)}
      ${hudField(eye, 'axis',     'Ax', val.axis)}
    </div>
  `;
}
function hudField(eye, field, label, value) {
  return `<span class="hud-rx-field"><span class="hud-rx-label">${label}</span>
    <button class="hud-step" data-eye="${eye}" data-field="${field}" data-dir="-1">−</button>
    <input class="hud-rx-input" type="text" inputmode="decimal" autocomplete="off"
           data-eye="${eye}" data-field="${field}"
           value="${formatRx(value, field)}">
    <button class="hud-step" data-eye="${eye}" data-field="${field}" data-dir="1">+</button>
  </span>`;
}
function formatRx(v, field) {
  if (field === 'axis') return `${v}°`;
  const n = Number(v);
  if (n === 0 || Number.isNaN(n)) return '0.00';
  return (n > 0 ? '+' : '−') + Math.abs(n).toFixed(2);
}
// Parse user-typed value: tolerant of "+2.00", "-2.00", "−2.00" (typographic
// minus), bare "2", trailing "°" or "D" units, whitespace.
function parseRxText(text) {
  if (typeof text !== 'string') return parseFloat(text);
  const cleaned = text
    .replace(/−/g, '-')
    .replace(/[+\s°dD]/g, '')
    .trim();
  return parseFloat(cleaned);
}
function clampStep(v, lim) {
  if (Number.isNaN(v)) return lim.min;
  const stepped = Math.round(v / lim.step) * lim.step;
  return Math.max(lim.min, Math.min(lim.max, stepped));
}
