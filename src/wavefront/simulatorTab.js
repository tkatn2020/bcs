// Tab 2 — Simulator (main customer-facing screen).
// Layout (iPad landscape, content area ~1180×~656):
//   ┌──────────────────────────────────────────┬──────────┐
//   │  HUD: OD/OS Rx ± steppers (S/C/Ax)       │  비율    │
//   │              Lens viewer                 │  패널    │
//   │     (large binocular, OD + OS)           │ (접이식) │
//   ├──────────────────────────────────────────┴──────────┤
//   │ [등급 5-pill] [ADD ±] [누진대 3-pill] [환경 3-pill]  │
//   └──────────────────────────────────────────────────────┘

import { state, update, subscribe } from './state.js';
import { GRADES } from '../optics/grades.js';
import { getGeom, CORRIDOR_OPTIONS } from './helpers.js';
import { createBinocularLenses } from './lensBox.js';
import { createRatioPanel, createCombinedRatioBar } from './ratioPanel.js';
import { ENVIRONMENTS } from './environments.js';

// Match Tab 1 limits so the steppers behave the same on both screens.
const RX_LIMITS = {
  sphere:   { min: -10,  max: 6,   step: 0.25 },
  cylinder: { min: -4,   max: 0,   step: 0.25 },
  axis:     { min: 0,    max: 180, step: 5    },
};

export function mountSimulatorTab(root) {
  root.innerHTML = `
    <div class="sim-shell">
      <!-- LEFT: Lens viewer -->
      <div class="sim-stage">
        <div class="sim-hud" id="sim-hud"></div>
        <div class="sim-lens-wrap" id="sim-lens-wrap"></div>
      </div>

      <!-- RIGHT: Ratio panel (collapsible) -->
      <aside class="sim-aside" id="sim-aside">
        <button class="sim-aside-toggle" id="sim-aside-toggle" title="비율 패널 접기/펴기">
          <span id="sim-aside-toggle-icon">›</span>
        </button>
        <div class="sim-aside-content" id="sim-aside-content"></div>
      </aside>
    </div>

    <!-- BOTTOM: Control strip -->
    <div class="sim-controls">
      <div class="sim-ctrl-block">
        <div class="sim-ctrl-label">렌즈 등급</div>
        <div class="grade-pills-lg" id="sim-grades"></div>
      </div>

      <div class="sim-ctrl-block sim-ctrl-add">
        <div class="sim-ctrl-label">ADD (가입도)</div>
        <div class="add-control">
          <button class="stepper" id="sim-add-minus">−</button>
          <div class="add-display" id="sim-add-display">+2.00</div>
          <button class="stepper" id="sim-add-plus">+</button>
        </div>
      </div>

      <div class="sim-ctrl-block">
        <div class="sim-ctrl-label">누진대</div>
        <div class="corridor-pills-lg" id="sim-corridors"></div>
      </div>

      <div class="sim-ctrl-block">
        <div class="sim-ctrl-label">환경</div>
        <div class="env-pills-lg" id="sim-envs"></div>
      </div>
    </div>
  `;

  // ── Lens viewer (mount inside sim-lens-wrap, sized by container) ──
  const lensWrap = root.querySelector('#sim-lens-wrap');
  // We sense the available width AND height on first paint after the panel
  // becomes visible — fitting both dimensions prevents the lens from being
  // taller than its wrap (which on shorter viewports like iPad Pro 11"
  // landscape would otherwise overflow upward and hide the Rx HUD).
  let dual = null;
  function buildLens() {
    const ASPECT = 0.56;  // h/w of the binocular lens viewer (~16:9)
    const availW = lensWrap.clientWidth  - 8;
    const availH = lensWrap.clientHeight - 8;
    let w = Math.min(960, availW);
    let h = w * ASPECT;
    if (h > availH) {           // height-bound → scale down so it fits
      h = availH;
      w = h / ASPECT;
    }
    w = Math.max(200, Math.round(w));
    h = Math.max(120, Math.round(h));
    if (lensWrap.firstChild) lensWrap.removeChild(lensWrap.firstChild);
    dual = createBinocularLenses(
      w, h,
      geomFor(state, 'OD'),
      geomFor(state, 'OS'),
      { showIso: state.showIso, showBands: state.showBands, environment: state.environment },
    );
    lensWrap.appendChild(dual.el);
  }

  // Initial build (deferred so layout settles)
  requestAnimationFrame(() => {
    requestAnimationFrame(buildLens);
  });

  // ── Right aside: ratio panels ──
  const asideContent = root.querySelector('#sim-aside-content');
  const odPanel = createRatioPanel(geomFor(state, 'OD'), { eyeLabel: 'OD · 우안', threshold: state.threshold });
  const osPanel = createRatioPanel(geomFor(state, 'OS'), { eyeLabel: 'OS · 좌안', threshold: state.threshold });
  const ouBar = createCombinedRatioBar(geomFor(state, 'OD'), geomFor(state, 'OS'), state.threshold);
  asideContent.appendChild(odPanel.el);
  asideContent.appendChild(osPanel.el);
  asideContent.appendChild(ouBar.el);

  // Aside collapse
  const aside = root.querySelector('#sim-aside');
  const toggleIcon = root.querySelector('#sim-aside-toggle-icon');
  let collapsed = false;
  root.querySelector('#sim-aside-toggle').addEventListener('click', () => {
    collapsed = !collapsed;
    aside.classList.toggle('collapsed', collapsed);
    toggleIcon.textContent = collapsed ? '‹' : '›';
    // Lens needs re-build to fit new width
    requestAnimationFrame(() => requestAnimationFrame(buildLens));
  });

  // ── Grade pills ──
  const gradeBox = root.querySelector('#sim-grades');
  GRADES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'grade-pill-lg';
    btn.dataset.grade = g.id;
    btn.dataset.active = String(state.grade === g.id);
    btn.innerHTML = `
      <span class="gp-num">${g.id}</span>
      <span class="gp-bp">${g.bpCode}</span>
      <span class="gp-name">${g.name}</span>
    `;
    btn.addEventListener('click', () => update({ grade: g.id }));
    gradeBox.appendChild(btn);
  });

  // ── ADD ± ──
  const addDisplay = root.querySelector('#sim-add-display');
  root.querySelector('#sim-add-minus').addEventListener('click', () => {
    const v = clamp(state.add - 0.25, 0.5, 3.5);
    update({ add: v });
  });
  root.querySelector('#sim-add-plus').addEventListener('click', () => {
    const v = clamp(state.add + 0.25, 0.5, 3.5);
    update({ add: v });
  });

  // ── Corridor pills ──
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

  // ── Env pills (quick switch) ──
  const envBox = root.querySelector('#sim-envs');
  ENVIRONMENTS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'pill env-quick';
    btn.dataset.env = e.id;
    btn.dataset.active = String(state.environment === e.id);
    btn.innerHTML = `<span style="font-size:18px">${e.icon}</span> <span>${e.label.replace(' 환경', '')}</span>`;
    btn.addEventListener('click', () => update({ environment: e.id }));
    envBox.appendChild(btn);
  });

  // ── HUD: live Rx steppers (per-eye S/C/Ax) ──
  // Lets the optician tweak the Rx while watching the lens render update,
  // without leaving the simulator tab. Honors state.syncEyes.
  const hud = root.querySelector('#sim-hud');
  hud.innerHTML = `
    ${rxRowHud('od', 'OD · 우안', state.od)}
    ${rxRowHud('os', 'OS · 좌안', state.os)}
  `;

  // Wire the ± steppers
  hud.querySelectorAll('.hud-step').forEach(btn => {
    const eye = btn.dataset.eye;
    const field = btn.dataset.field;
    const dir = Number(btn.dataset.dir);
    const lim = RX_LIMITS[field];
    btn.addEventListener('click', () => {
      const cur = state[eye][field];
      const v = clampStep(cur + dir * lim.step, lim);
      const patch = { [eye]: { [field]: v } };
      if (state.syncEyes) patch[eye === 'od' ? 'os' : 'od'] = { [field]: v };
      update(patch);
    });
  });

  function refreshHud(s) {
    ['od', 'os'].forEach(eye => {
      ['sphere', 'cylinder', 'axis'].forEach(field => {
        const span = hud.querySelector(`[data-eye="${eye}"][data-field="${field}"][data-role="val"]`);
        if (span) span.textContent = formatRx(s[eye][field], field);
      });
    });
  }
  refreshHud(state);

  // ── Subscribe ──
  subscribe(s => {
    // Active states for pills
    root.querySelectorAll('[data-grade]').forEach(b => b.dataset.active = String(s.grade === Number(b.dataset.grade)));
    root.querySelectorAll('[data-corridor]').forEach(b => b.dataset.active = String(s.corridor === Number(b.dataset.corridor)));
    root.querySelectorAll('[data-env]').forEach(b => b.dataset.active = String(s.environment === b.dataset.env));
    addDisplay.textContent = '+' + s.add.toFixed(2);
    refreshHud(s);

    // Update lens + panels
    if (dual) {
      const od = geomFor(s, 'OD');
      const os = geomFor(s, 'OS');
      dual.update({ od, os, opts: { showIso: s.showIso, showBands: s.showBands, environment: s.environment } });
      odPanel.update({ geom: od, threshold: s.threshold });
      osPanel.update({ geom: os, threshold: s.threshold });
      ouBar.update({ od, os, threshold: s.threshold });
    }
  });

  // Re-build lens when this tab becomes active (it's hidden initially)
  let lastActive = state.activeTab;
  subscribe(s => {
    if (s.activeTab === 'simulator' && lastActive !== 'simulator') {
      requestAnimationFrame(() => requestAnimationFrame(buildLens));
    }
    lastActive = s.activeTab;
  });

  // Window resize → rebuild lens
  window.addEventListener('resize', () => {
    if (state.activeTab === 'simulator') requestAnimationFrame(buildLens);
  });
}

function geomFor(s, eye) {
  const rx = eye === 'OS' ? s.os : s.od;
  return getGeom({
    grade: s.grade, corridorLength: s.corridor, add: s.add,
    sphere: rx.sphere, cylinder: rx.cylinder, axis: rx.axis, eye,
  });
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Math.round(v / 0.25) * 0.25));
}

// HUD Rx row: tag + S/C/Ax mini-stepper groups.
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
  return `
    <span class="hud-rx-field">
      <span class="hud-rx-label">${label}</span>
      <button class="hud-step" data-eye="${eye}" data-field="${field}" data-dir="-1">−</button>
      <span class="hud-rx-val" data-eye="${eye}" data-field="${field}" data-role="val">${formatRx(value, field)}</span>
      <button class="hud-step" data-eye="${eye}" data-field="${field}" data-dir="1">+</button>
    </span>
  `;
}
function formatRx(v, field) {
  if (field === 'axis') return `${v}°`;
  const n = Number(v);
  if (n === 0 || Number.isNaN(n)) return '0.00';
  return (n > 0 ? '+' : '−') + Math.abs(n).toFixed(2);
}
function clampStep(v, lim) {
  if (Number.isNaN(v)) return lim.min;
  const stepped = Math.round(v / lim.step) * lim.step;
  return Math.max(lim.min, Math.min(lim.max, stepped));
}
