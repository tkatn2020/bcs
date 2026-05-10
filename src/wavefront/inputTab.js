// Tab 1 — Prescription input.
// Single-environment notice (office scene only).

import { state, update, subscribe } from './state.js';

const RX_LIMITS = {
  sphere:   { min: -10,  max: 6,   step: 0.25 },
  cylinder: { min: -4,   max: 0,   step: 0.25 },
  axis:     { min: 0,    max: 180, step: 5    },
  add:      { min: 0.5,  max: 3.5, step: 0.25 },
};

// Force-set environment to 'driving' (only env remaining; id retained for compat).
if (state.environment !== 'driving') update({ environment: 'driving' });

export function mountInputTab(root) {
  root.innerHTML = `
    <div class="input-shell">
      <p class="tab-eyebrow">STEP 01 · PRESCRIPTION</p>
      <h2 class="tab-title">도수 입력</h2>
      <p class="tab-subtitle">고객의 양안 도수(구면·난시·축)와 가입도(ADD)를 입력하세요. 입력값은 시뮬레이션 화면에서 실시간 반영됩니다.</p>

      <div class="input-rx-grid">
        ${rxCard('od', 'OD · 우안', state.od)}
        ${rxCard('os', 'OS · 좌안', state.os)}
        ${addCard(state.add)}
      </div>

      <div class="sync-row">
        <label class="sync-label">
          <span class="switch">
            <input type="checkbox" id="sync-eyes" ${state.syncEyes ? 'checked' : ''}>
            <span class="switch-track"></span>
          </span>
          <span class="sync-text">양안 동기화 — 우안 변경 시 좌안에도 자동 적용</span>
        </label>
      </div>

      <div class="env-section">
        <div class="section-h-lg">사용 환경</div>
        <div class="env-driving-card">
          <div class="env-driving-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 17h14l-1.4-5.6A2 2 0 0 0 15.66 10H8.34a2 2 0 0 0-1.94 1.4L5 17z"></path>
              <circle cx="7" cy="17" r="2"></circle>
              <circle cx="17" cy="17" r="2"></circle>
              <path d="M5 17H3"></path>
              <path d="M21 17h-2"></path>
            </svg>
          </div>
          <div class="env-driving-text">
            <div class="env-driving-title">운전 환경</div>
            <div class="env-driving-desc">도로 표지판(원거리) · 대시보드(중간거리) · 휴대폰(근거리)</div>
          </div>
        </div>
      </div>

      <div class="cta-row">
        <button class="btn cta-btn" id="cta-next">
          <span>시뮬레이션 보기</span>
          <span class="cta-arrow">→</span>
        </button>
      </div>
    </div>
  `;

  ['od', 'os'].forEach(eye => {
    ['sphere', 'cylinder', 'axis'].forEach(field => {
      const lim = RX_LIMITS[field];
      root.querySelectorAll(`.stepper[data-eye="${eye}"][data-field="${field}"]`).forEach(btn => {
        const dir = Number(btn.dataset.dir);
        btn.addEventListener('click', () => stepRx(eye, field, dir, lim));
      });
      const inp = root.querySelector(`input.num-input[data-eye="${eye}"][data-field="${field}"]`);
      if (inp) {
        inp.addEventListener('change', () => {
          const v = clampStep(parseRxText(inp.value), lim);
          patchRx(eye, field, v);
        });
        inp.addEventListener('focus', () => inp.select());
      }
    });
  });

  root.querySelectorAll('.stepper[data-field="add"]').forEach(btn => {
    const dir = Number(btn.dataset.dir);
    btn.addEventListener('click', () => {
      const v = clampStep(state.add + dir * RX_LIMITS.add.step, RX_LIMITS.add);
      update({ add: v });
    });
  });
  const addInput = root.querySelector('input.num-input[data-field="add"]');
  if (addInput) {
    addInput.addEventListener('change', () => {
      const v = clampStep(parseRxText(addInput.value), RX_LIMITS.add);
      update({ add: v });
    });
    addInput.addEventListener('focus', () => addInput.select());
  }

  root.querySelector('#sync-eyes').addEventListener('change', e => {
    update({ syncEyes: e.target.checked });
  });

  root.querySelector('#cta-next').addEventListener('click', () => {
    update({ activeTab: 'simulator' });
  });

  subscribe(s => {
    ['od', 'os'].forEach(eye => {
      ['sphere', 'cylinder', 'axis'].forEach(field => {
        const inp = root.querySelector(`input.num-input[data-eye="${eye}"][data-field="${field}"]`);
        if (inp && document.activeElement !== inp) {
          inp.value = field === 'axis' ? String(s[eye][field]) : fmt(s[eye][field]);
        }
      });
    });
    const addInp = root.querySelector('input.num-input[data-field="add"]');
    if (addInp && document.activeElement !== addInp) {
      addInp.value = '+' + s.add.toFixed(2);
    }
    root.querySelector('#sync-eyes').checked = s.syncEyes;
  });

  function stepRx(eye, field, dir, lim) {
    const cur = state[eye][field];
    const v = clampStep(cur + dir * lim.step, lim);
    patchRx(eye, field, v);
  }

  function patchRx(eye, field, v) {
    const patch = { [eye]: { [field]: v } };
    if (state.syncEyes) patch[eye === 'od' ? 'os' : 'od'] = { [field]: v };
    update(patch);
  }
}

function rxCard(eye, label, val) {
  return `
    <div class="rx-card-lg">
      <div class="rx-card-h-lg">
        <span class="rx-eye-tag-lg ${eye}">${eye.toUpperCase()}</span>
        <span>${label}</span>
      </div>
      ${rxRow(eye, 'sphere',   'S',  val.sphere,   '구면')}
      ${rxRow(eye, 'cylinder', 'C',  val.cylinder, '난시')}
      ${rxRow(eye, 'axis',     'Ax', val.axis,     '축')}
    </div>
  `;
}

function rxRow(eye, field, short, value, longLabel) {
  const display = field === 'axis' ? String(value) : fmt(value);
  return `
    <div class="rx-input-row">
      <div class="rx-input-label">
        <span class="rx-input-short">${short}</span>
        <span class="rx-input-long">${longLabel}</span>
      </div>
      <button class="stepper" data-eye="${eye}" data-field="${field}" data-dir="-1">−</button>
      <input type="text" inputmode="decimal" class="num-input"
             data-eye="${eye}" data-field="${field}" value="${display}">
      <button class="stepper" data-eye="${eye}" data-field="${field}" data-dir="1">+</button>
      <span class="rx-input-unit">${field === 'axis' ? '°' : 'D'}</span>
    </div>
  `;
}

function addCard(value) {
  const display = '+' + Number(value).toFixed(2);
  return `
    <div class="rx-card-lg add-card">
      <div class="rx-card-h-lg">
        <span class="rx-eye-tag-lg add">＋</span>
        <span>ADD · 가입도</span>
      </div>
      <div class="rx-input-row">
        <div class="rx-input-label">
          <span class="rx-input-short">＋</span>
          <span class="rx-input-long">가입도</span>
        </div>
        <button class="stepper" data-field="add" data-dir="-1">−</button>
        <input type="text" inputmode="decimal" class="num-input"
               data-field="add" value="${display}">
        <button class="stepper" data-field="add" data-dir="1">+</button>
        <span class="rx-input-unit">D</span>
      </div>
    </div>
  `;
}

function fmt(v) {
  const n = Number(v);
  if (n === 0 || Number.isNaN(n)) return '0.00';
  return (n > 0 ? '+' : '−') + Math.abs(n).toFixed(2);
}
function parseRxText(text) {
  if (typeof text !== 'string') return parseFloat(text);
  const cleaned = text.replace(/−/g, '-').replace(/[+\s]/g, '').trim();
  return parseFloat(cleaned);
}
function clampStep(v, lim) {
  if (Number.isNaN(v)) return lim.min;
  const stepped = Math.round(v / lim.step) * lim.step;
  return Math.max(lim.min, Math.min(lim.max, stepped));
}
