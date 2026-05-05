// Section 1 — interactive binocular playground.
// Edits the SHARED state (state.js) directly so Sections 2 and 3 stay in sync.

import { state, update, reset, subscribe } from './state.js';
import { getGeom, CORRIDOR_OPTIONS, REFERENCE_CYL, ISO_LEVELS_D } from './helpers.js';
import { GRADES } from '../optics/grades.js';
import { createBinocularLenses } from './lensBox.js';
import { createRatioPanel, createCombinedRatioBar } from './ratioPanel.js';
import { ENVIRONMENTS } from './environments.js';
import { mountSceneUploader } from './sceneUploader.js';

export function mountPlayground(root) {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'playground-wrap';
  wrap.style.cssText = 'display:grid;grid-template-columns:300px 1fr 320px;gap:20px;align-items:start';
  root.appendChild(wrap);

  // ── Left: controls ──
  const controls = document.createElement('div');
  controls.style.cssText = 'background:#fff;border-radius:12px;padding:18px;box-shadow:0 4px 14px rgba(0,0,0,0.06);max-height:calc(100vh - 180px);overflow-y:auto';
  wrap.appendChild(controls);

  controls.innerHTML = `
    <h3 class="section-h">공통 설정 <span style="font-weight:400;font-size:10px;color:#94a3b8">· 모든 섹션 연동</span></h3>

    <div class="ctrl-block">
      <label class="ctrl-label">렌즈 등급</label>
      <div id="grade-buttons" class="grade-grid"></div>
    </div>

    <div class="ctrl-block">
      <label class="ctrl-label">ADD (가입도)</label>
      <div class="ctrl-row">
        <input type="range" id="add-range" min="0.50" max="3.50" step="0.25" value="${state.add}" />
        <span class="ctrl-val" id="add-val">+${state.add.toFixed(2)}</span>
      </div>
    </div>

    <div class="ctrl-block">
      <label class="ctrl-label">누진대 길이 (mm)</label>
      <div id="corridor-buttons" class="pill-row"></div>
      <p class="hint">짧음 = 하드(샤프), 김 = 소프트(부드러움)</p>
    </div>

    <div class="ctrl-block">
      <label class="ctrl-label">사용 환경</label>
      <div id="env-buttons" class="env-grid"></div>
      <p class="hint" id="env-hint"></p>
    </div>

    <div class="ctrl-block">
      <label class="ctrl-label">배경 사진 (드래그-드롭 또는 클릭)</label>
      <div id="scene-uploader"></div>
      <p class="hint">사진 없으면 자동 폴백. 매핑이 틀리면 드래그로 교체.</p>
    </div>

    <div class="ctrl-block">
      <label class="ctrl-label">표시 옵션</label>
      <label class="check-row"><input type="checkbox" id="iso-toggle" ${state.showIso ? 'checked' : ''}> 등고선 (iso ${ISO_LEVELS_D.map(l => l.toFixed(2)).join('·')} D)</label>
      <label class="check-row"><input type="checkbox" id="bands-toggle" ${state.showBands ? 'checked' : ''}> 영역 분할선</label>
      <label class="check-row"><input type="checkbox" id="sync-toggle" ${state.syncEyes ? 'checked' : ''}> 양안 동기화</label>
    </div>

    <div class="rx-card" id="od-card">
      <div class="rx-card-h"><span class="rx-eye od">OD</span> 우안 도수</div>
      ${rxRow('od', 'sphere', 'S', state.od.sphere, -10, 6, 0.25)}
      ${rxRow('od', 'cylinder', 'C', state.od.cylinder, -4, 0, 0.25)}
      ${rxRow('od', 'axis', 'Ax', state.od.axis, 0, 180, 5)}
    </div>

    <div class="rx-card" id="os-card">
      <div class="rx-card-h"><span class="rx-eye os">OS</span> 좌안 도수</div>
      ${rxRow('os', 'sphere', 'S', state.os.sphere, -10, 6, 0.25)}
      ${rxRow('os', 'cylinder', 'C', state.os.cylinder, -4, 0, 0.25)}
      ${rxRow('os', 'axis', 'Ax', state.os.axis, 0, 180, 5)}
    </div>

    <button id="reset-btn" class="reset-btn">초기화</button>
  `;

  // Grade buttons
  const gradeBox = controls.querySelector('#grade-buttons');
  GRADES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'grade-pill';
    btn.dataset.grade = String(g.id);
    btn.dataset.active = String(state.grade === g.id);
    btn.innerHTML = `<span class="g-num">${g.id}단계</span><span class="g-bp">${g.bpCode}</span><span class="g-name">${g.name}</span>`;
    btn.addEventListener('click', () => update({ grade: g.id }));
    gradeBox.appendChild(btn);
  });

  // Corridor buttons
  const corBox = controls.querySelector('#corridor-buttons');
  CORRIDOR_OPTIONS.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'btn-pill';
    btn.dataset.corridor = String(c);
    btn.dataset.active = String(state.corridor === c);
    btn.textContent = `${c}mm`;
    btn.addEventListener('click', () => update({ corridor: c }));
    corBox.appendChild(btn);
  });

  // Environment buttons
  const envBox = controls.querySelector('#env-buttons');
  ENVIRONMENTS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'env-pill';
    btn.dataset.env = e.id;
    btn.dataset.active = String(state.environment === e.id);
    btn.innerHTML = `<span class="env-icon">${e.icon}</span><span class="env-label">${e.label}</span>`;
    btn.addEventListener('click', () => update({ environment: e.id }));
    envBox.appendChild(btn);
  });

  controls.querySelector('#add-range').addEventListener('input', e => update({ add: Number(e.target.value) }));
  controls.querySelector('#iso-toggle').addEventListener('change', e => update({ showIso: e.target.checked }));
  controls.querySelector('#bands-toggle').addEventListener('change', e => update({ showBands: e.target.checked }));
  controls.querySelector('#sync-toggle').addEventListener('change', e => update({ syncEyes: e.target.checked }));

  // Rx steppers + numeric inputs
  controls.querySelectorAll('.rx-step[data-eye]').forEach(btn => {
    const eye = btn.dataset.eye, field = btn.dataset.field, dir = Number(btn.dataset.dir);
    const step = field === 'axis' ? 5 : 0.25;
    btn.addEventListener('click', () => {
      const min = Number(btn.dataset.min), max = Number(btn.dataset.max);
      const cur = state[eye][field];
      const next = clampVal(cur + dir * step, min, max, step);
      const patch = { [eye]: { [field]: next } };
      if (state.syncEyes) patch[eye === 'od' ? 'os' : 'od'] = { [field]: next };
      update(patch);
    });
  });
  controls.querySelectorAll('input[data-eye][data-field]').forEach(inp => {
    const eye = inp.dataset.eye, field = inp.dataset.field;
    const step = field === 'axis' ? 5 : 0.25;
    inp.addEventListener('change', () => {
      const min = Number(inp.dataset.min), max = Number(inp.dataset.max);
      const v = clampVal(parseFloat(inp.value), min, max, step);
      const patch = { [eye]: { [field]: v } };
      if (state.syncEyes) patch[eye === 'od' ? 'os' : 'od'] = { [field]: v };
      update(patch);
    });
  });
  controls.querySelector('#reset-btn').addEventListener('click', reset);

  // Mount the photo uploader (drag-drop / click to upload)
  mountSceneUploader(controls.querySelector('#scene-uploader'));

  // ── Middle: dual lens viewer ──
  const lensWrap = document.createElement('div');
  lensWrap.style.cssText = 'background:#0b1220;border-radius:14px;padding:24px;display:flex;flex-direction:column;align-items:center;gap:14px';
  wrap.appendChild(lensWrap);

  const lensCaption = document.createElement('div');
  lensCaption.style.cssText = 'color:#94a3b8;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;display:flex;gap:12px;align-items:center';
  lensWrap.appendChild(lensCaption);

  const dual = createBinocularLenses(620, 380, geomFor(state, 'OD'), geomFor(state, 'OS'), {
    showIso: state.showIso, showBands: state.showBands, environment: state.environment,
  });
  lensWrap.appendChild(dual.el);

  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:14px;align-items:center;font-size:10.5px;color:#cbd5e1;flex-wrap:wrap;justify-content:center';
  legend.innerHTML = `
    <span style="font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8">웨이브프론트 범례</span>
    ${gradient('iso')}
    <span>← 0D / 주변부 cyl / ${REFERENCE_CYL.toFixed(1)}D 이상 →</span>
    <span style="opacity:0.7">| iso ${ISO_LEVELS_D.map(l => l.toFixed(2)).join('·')}D | 영역 분할선</span>
  `;
  lensWrap.appendChild(legend);

  // ── Right: ratio panels ──
  const right = document.createElement('div');
  right.style.cssText = 'display:flex;flex-direction:column;gap:12px;position:sticky;top:20px';
  wrap.appendChild(right);

  const odPanel = createRatioPanel(geomFor(state, 'OD'), { eyeLabel: 'OD · 우안', threshold: state.threshold });
  const osPanel = createRatioPanel(geomFor(state, 'OS'), { eyeLabel: 'OS · 좌안', threshold: state.threshold });
  const ouBar = createCombinedRatioBar(geomFor(state, 'OD'), geomFor(state, 'OS'), state.threshold);
  right.appendChild(odPanel.el);
  right.appendChild(osPanel.el);
  right.appendChild(ouBar.el);

  // Subscribe — re-render whenever shared state changes
  function refresh(s) {
    controls.querySelectorAll('[data-grade]').forEach(b => b.dataset.active = String(s.grade === Number(b.dataset.grade)));
    controls.querySelectorAll('[data-corridor]').forEach(b => b.dataset.active = String(s.corridor === Number(b.dataset.corridor)));
    controls.querySelector('#add-val').textContent = `+${s.add.toFixed(2)}`;
    controls.querySelector('#add-range').value = s.add;
    controls.querySelector('#iso-toggle').checked = s.showIso;
    controls.querySelector('#bands-toggle').checked = s.showBands;
    controls.querySelector('#sync-toggle').checked = s.syncEyes;

    ['od', 'os'].forEach(eye => {
      ['sphere', 'cylinder', 'axis'].forEach(field => {
        const inp = controls.querySelector(`input[data-eye="${eye}"][data-field="${field}"]`);
        if (inp && document.activeElement !== inp) {
          inp.value = field === 'axis' ? String(s[eye][field]) : s[eye][field].toFixed(2);
        }
        const valSpan = controls.querySelector(`[data-eye="${eye}"][data-field="${field}"][data-role="valspan"]`);
        if (valSpan) {
          valSpan.textContent = field === 'axis' ? `${s[eye][field]}°` : (s[eye][field] >= 0 ? '+' : '') + s[eye][field].toFixed(2);
        }
      });
    });

    const od = geomFor(s, 'OD');
    const os = geomFor(s, 'OS');
    dual.update({ od, os, opts: { showIso: s.showIso, showBands: s.showBands, environment: s.environment } });
    odPanel.update({ geom: od, threshold: s.threshold });
    osPanel.update({ geom: os, threshold: s.threshold });
    ouBar.update({ od, os, threshold: s.threshold });

    // Environment buttons + hint
    controls.querySelectorAll('[data-env]').forEach(b => b.dataset.active = String(s.environment === b.dataset.env));
    const envInfo = ENVIRONMENTS.find(e => e.id === s.environment);
    controls.querySelector('#env-hint').textContent = envInfo ? envInfo.desc : '';

    const envLabel = envInfo ? `${envInfo.icon} ${envInfo.label}` : '';
    lensCaption.innerHTML = `
      <span>OS · 좌안</span><span style="opacity:0.4">|</span><span>OD · 우안</span>
      <span style="margin-left:8px;color:#cbd5e1">${envLabel} · ADD +${s.add.toFixed(2)} · 누진 ${s.corridor}mm · ${od.grade.bp}</span>
    `;
  }

  subscribe(refresh);
  refresh(state);
}

export function geomFor(s, eye) {
  const rx = eye === 'OS' ? s.os : s.od;
  return getGeom({
    grade: s.grade, corridorLength: s.corridor, add: s.add,
    sphere: rx.sphere, cylinder: rx.cylinder, axis: rx.axis, eye,
  });
}

function rxRow(eye, field, label, value, min, max, step) {
  const display = field === 'axis' ? `${value}°` : (value >= 0 ? '+' : '') + value.toFixed(2);
  return `
    <div class="rx-row">
      <span class="rx-label">${label}</span>
      <button class="rx-step" data-eye="${eye}" data-field="${field}" data-dir="-1" data-min="${min}" data-max="${max}">−</button>
      <input type="number" data-eye="${eye}" data-field="${field}" data-min="${min}" data-max="${max}" step="${step}" value="${value}" />
      <button class="rx-step" data-eye="${eye}" data-field="${field}" data-dir="1" data-min="${min}" data-max="${max}">+</button>
      <span class="rx-disp" data-eye="${eye}" data-field="${field}" data-role="valspan">${display}</span>
    </div>
  `;
}

function gradient(name) {
  const stops = name === 'iso'
    ? 'rgb(50,60,160), rgb(70,130,210), rgb(190,220,110), rgb(250,200,90), rgb(220,110,100), rgb(150,50,130)'
    : 'rgb(50,60,160), rgb(255,255,255)';
  return `<span style="display:inline-block;width:120px;height:10px;border-radius:5px;background:linear-gradient(to right, ${stops})"></span>`;
}

function clampVal(v, min, max, step) {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v / step) * step));
}
