// Tab 1 — Prescription input.
// Layout (landscape):
//   ┌────────────────────────────────────────────────────────┐
//   │  OD 우안 도수 (S/C/Ax + 큰 스텝퍼)                        │
//   │  [양안 동기화 토글]                                      │
//   │  OS 좌안 도수                                            │
//   │  ADD 가입도                                              │
//   ├────────────────────────────────────────────────────────┤
//   │  사용 환경 (3개 카드)                                    │
//   ├────────────────────────────────────────────────────────┤
//   │                                       [시뮬레이션 →] CTA│
//   └────────────────────────────────────────────────────────┘

import { state, update, subscribe } from './state.js';
import { ENVIRONMENTS } from './environments.js';

const RX_LIMITS = {
  sphere:   { min: -10,  max: 6,   step: 0.25 },
  cylinder: { min: -4,   max: 0,   step: 0.25 },
  axis:     { min: 0,    max: 180, step: 5    },
  add:      { min: 0.5,  max: 3.5, step: 0.25 },
};

export function mountInputTab(root) {
  root.innerHTML = `
    <h2 class="tab-title">📝 도수 입력</h2>
    <p class="tab-subtitle">고객의 양안 도수(구면·난시·축)와 가입도(ADD), 사용 환경을 입력하세요.</p>

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
      <div class="env-grid-lg" id="env-grid"></div>
    </div>

    <div class="cta-row">
      <button class="btn btn-primary cta-btn" id="cta-next">시뮬레이션 보기 →</button>
    </div>
  `;

  // Bind Rx steppers + inputs
  ['od', 'os'].forEach(eye => {
    ['sphere', 'cylinder', 'axis'].forEach(field => {
      const lim = RX_LIMITS[field];
      // Steppers
      root.querySelectorAll(`.stepper[data-eye="${eye}"][data-field="${field}"]`).forEach(btn => {
        const dir = Number(btn.dataset.dir);
        btn.addEventListener('click', () => stepRx(eye, field, dir, lim));
      });
      // Direct input
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

  // ADD steppers
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

  // Sync toggle
  root.querySelector('#sync-eyes').addEventListener('change', e => {
    update({ syncEyes: e.target.checked });
  });

  // Environment cards
  const envGrid = root.querySelector('#env-grid');
  ENVIRONMENTS.forEach(e => {
    const card = document.createElement('button');
    card.className = 'env-card-lg';
    card.dataset.env = e.id;
    card.dataset.active = String(state.environment === e.id);
    card.innerHTML = `
      <div class="ec-icon">${e.icon}</div>
      <div class="ec-label">${e.label}</div>
      <div class="ec-desc">${e.desc}</div>
    `;
    card.addEventListener('click', () => update({ environment: e.id }));
    envGrid.appendChild(card);
  });

  // CTA → switch to simulator tab
  root.querySelector('#cta-next').addEventListener('click', () => {
    update({ activeTab: 'simulator' });
  });

  // Subscribe — refresh fields when state changes
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
    root.querySelectorAll('[data-env]').forEach(el => {
      el.dataset.active = String(s.environment === el.dataset.env);
    });
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
  // Always render diopters with 2 decimals + explicit sign (e.g. "+2.00" or "−2.00").
  // Axis is rendered as integer.
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
  // ADD is always positive — display as "+X.XX" with explicit sign + 2 decimals.
  const display = '+' + Number(value).toFixed(2);
  return `
    <div class="rx-card-lg add-card">
      <div class="rx-card-h-lg">
        <span class="rx-eye-tag-lg" style="background:#f59e0b">+</span>
        <span>ADD · 가입도</span>
      </div>
      <div class="rx-input-row">
        <div class="rx-input-label">
          <span class="rx-input-short">+</span>
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

// Parse a user-typed Rx string. Accepts "+2.00", "-2.00", "−2.00" (U+2212),
// "2", trailing whitespace, etc.
function parseRxText(text) {
  if (typeof text !== 'string') return parseFloat(text);
  const cleaned = text
    .replace(/−/g, '-')   // U+2212 minus → ASCII hyphen
    .replace(/[+\s]/g, '')     // strip plus signs and whitespace
    .trim();
  return parseFloat(cleaned);
}

function clampStep(v, lim) {
  if (Number.isNaN(v)) return lim.min;
  const stepped = Math.round(v / lim.step) * lim.step;
  return Math.max(lim.min, Math.min(lim.max, stepped));
}
