// Simulator screen — orchestrates the lens stage, HUD, controls, hero
// score, recommender, adapt chart, day-in-life. (Per-eye gutter panels
// removed — OU combined score lives in the right hero panel.)

import { state, update, subscribe } from '../wavefront/state.js';
import { GRADES } from '../optics/grades.js';
import { CORRIDOR_OPTIONS } from '../wavefront/helpers.js';
import { mountLensStage } from './lensStage.js?v=18';
import { mountHeroScore } from './heroScore.js?v=18';
import { mountRecommender } from './recommender.js?v=18';
import { mountAdaptChart } from './adaptChart.js?v=18';

const RX_LIMITS = {
  sphere:   { min: -10, max: 6,   step: 0.25 },
  cylinder: { min: -4,  max: 0,   step: 0.25 },
  axis:     { min: 0,   max: 180, step: 5    },
};

export function mountSimulator(root) {
  root.innerHTML = `
    <div class="sim-screen">
      <div class="sim-hud" id="sim-hud"></div>
      <section class="sim-stage-col">
        <div class="sim-lens-wrap" id="sim-lens-wrap"></div>
      </section>
      <aside class="sim-aside">
        <div class="sim-aside-inner" id="sim-aside-inner"></div>
      </aside>
      <div class="sim-controls" id="sim-controls"></div>
    </div>
  `;

  // HUD bar
  const hud = root.querySelector('#sim-hud');
  hud.innerHTML = `
    <div class="hud-rx-group">
      ${rxRow('od', 'OD', state.od)}
      ${rxRow('os', 'OS', state.os)}
    </div>
    <label class="hud-sync" title="양안 동기화 — 한쪽을 바꾸면 반대쪽도 같이 변경됩니다">
      <input type="checkbox" id="hud-sync" ${state.syncEyes ? 'checked' : ''}>
      <span class="hud-sync-track"></span>
      <span class="hud-sync-label">양안 동기화</span>
    </label>
    <div class="hud-mode" data-role="mode-toggle">
      <button class="hud-mode-btn" data-mode="2d">2D 분석</button>
      <button class="hud-mode-btn" data-mode="3d">3D 렌즈</button>
      <button class="hud-mode-btn" data-mode="ar">매장 AR</button>
    </div>
  `;

  // Mode toggle
  hud.querySelectorAll('.hud-mode-btn').forEach(b => {
    b.addEventListener('click', () => update({ lensMode: b.dataset.mode }));
  });

  // Sync toggle
  hud.querySelector('#hud-sync').addEventListener('change', (e) => {
    const on = e.target.checked;
    const patch = { syncEyes: on };
    if (on) patch.os = { ...state.od };
    update(patch);
  });

  // Rx steppers + inputs
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
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { inp.value = formatRx(state[eye][field], field); inp.blur(); }
    });
  });

  // Lens stage
  mountLensStage(root.querySelector('#sim-lens-wrap'));

  // Bottom controls
  const ctrls = root.querySelector('#sim-controls');
  ctrls.innerHTML = `
    <div class="ctrl-block">
      <div class="mono-label">LENS GRADE · 렌즈 등급</div>
      <div class="ctrl-pills" id="ctrl-grades"></div>
    </div>
    <div class="ctrl-block sim-add-emph">
      <div class="mono-label">ADD · 가입도</div>
      <div class="add-control">
        <button class="stepper" id="add-minus">−</button>
        <div class="add-display" id="add-display">+${state.add.toFixed(2)}</div>
        <button class="stepper" id="add-plus">+</button>
      </div>
    </div>
    <div class="ctrl-block ctrl-block-grow">
      <div class="mono-label">CORRIDOR · 누진대</div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="ctrl-pills" id="ctrl-corridors"></div>
        <label class="ctrl-note-switch" title="누진대 안내 보기">
          <span class="ctrl-note-switch-label">안내</span>
          <span class="switch">
            <input type="checkbox" id="ctrl-note-toggle">
            <span class="switch-track"></span>
          </span>
        </label>
      </div>
      <div class="ctrl-note-tip" id="ctrl-note-tip" hidden>
        길수록 좋은 건 아닙니다. 왜곡은 줄지만 근거리를 볼 때 시선을 더 아래로 내려야 합니다.
      </div>
    </div>
  `;

  // Grade pills
  const gradesBox = ctrls.querySelector('#ctrl-grades');
  GRADES.forEach(g => {
    const b = document.createElement('button');
    b.className = 'grade-pill';
    b.dataset.grade = g.id;
    b.dataset.active = String(state.grade === g.id);
    b.innerHTML = `<span class="gp-bp">${g.bpCode}</span><span class="gp-name">${g.name}</span>`;
    b.addEventListener('click', () => update({ grade: g.id }));
    gradesBox.appendChild(b);
  });

  // Corridor pills
  const corBox = ctrls.querySelector('#ctrl-corridors');
  CORRIDOR_OPTIONS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'pill';
    b.dataset.corridor = c;
    b.dataset.active = String(state.corridor === c);
    b.textContent = `${c}mm`;
    b.addEventListener('click', () => update({ corridor: c }));
    corBox.appendChild(b);
  });

  // ADD ±
  ctrls.querySelector('#add-minus').addEventListener('click', () =>
    update({ add: clamp(state.add - 0.25, 0.5, 3.5) }));
  ctrls.querySelector('#add-plus').addEventListener('click', () =>
    update({ add: clamp(state.add + 0.25, 0.5, 3.5) }));

  // Corridor info tip toggle (ON/OFF switch)
  const noteToggle = ctrls.querySelector('#ctrl-note-toggle');
  const noteTip = ctrls.querySelector('#ctrl-note-tip');
  noteToggle?.addEventListener('change', (e) => {
    noteTip.hidden = !e.target.checked;
  });

  // Aside — hero score + recommendation + adapt chart
  const aside = root.querySelector('#sim-aside-inner');
  mountHeroScore(aside);
  mountRecommender(aside);
  mountAdaptChart(aside);

  // Subscriptions for HUD + control active states
  function refreshHud(s) {
    hud.querySelectorAll('input.hud-rx-input').forEach(inp => {
      const eye = inp.dataset.eye, field = inp.dataset.field;
      if (document.activeElement !== inp) inp.value = formatRx(s[eye][field], field);
    });
    const sync = hud.querySelector('#hud-sync');
    if (sync) sync.checked = s.syncEyes;
    hud.querySelectorAll('.hud-mode-btn').forEach(b => {
      b.dataset.active = String(s.lensMode === b.dataset.mode);
    });
  }
  refreshHud(state);

  subscribe(s => {
    root.querySelectorAll('[data-grade]').forEach(b => b.dataset.active = String(s.grade === Number(b.dataset.grade)));
    root.querySelectorAll('[data-corridor]').forEach(b => b.dataset.active = String(s.corridor === Number(b.dataset.corridor)));
    const addEl = ctrls.querySelector('#add-display');
    const prevAdd = addEl.dataset.addVal;
    const nextAdd = '+' + s.add.toFixed(2);
    addEl.textContent = nextAdd;
    if (prevAdd && prevAdd !== nextAdd) {
      addEl.classList.remove('is-pulse');
      void addEl.offsetWidth;
      addEl.classList.add('is-pulse');
    }
    addEl.dataset.addVal = nextAdd;
    refreshHud(s);
  });
}

function rxRow(eye, label, val) {
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
  return `<span class="hud-rx-field">
    <span class="hud-rx-label">${label}</span>
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
function parseRxText(text) {
  if (typeof text !== 'string') return parseFloat(text);
  return parseFloat(text.replace(/−/g, '-').replace(/[+\s°dD]/g, '').trim());
}
function clampStep(v, lim) {
  if (Number.isNaN(v)) return lim.min;
  return Math.max(lim.min, Math.min(lim.max, Math.round(v / lim.step) * lim.step));
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Math.round(v / 0.25) * 0.25));
}
