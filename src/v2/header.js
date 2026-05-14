// Top bar — brand + Rx readout + simulator/compare tabs + actions.

import { state, update, subscribe } from '../wavefront/state.js';

export function mountHeader(root) {
  root.innerHTML = `
    <div class="brand">
      <img class="brand-logo" src="src/wavefront/assets/logo.png" alt="breezm" />
      <span class="brand-sep"></span>
      <div class="brand-product">
        <span class="brand-product-ko">다초점 시뮬레이터 — v5</span>
        <span class="brand-product-en">Progressive Lens · Consultation</span>
      </div>
      <div class="topbar-tabs">
        <button class="topbar-tab" data-tab="simulator">
          <span class="topbar-tab-num">01</span>
          <span>시뮬레이터</span>
        </button>
        <button class="topbar-tab" data-tab="compare">
          <span class="topbar-tab-num">02</span>
          <span>A↔B 비교</span>
        </button>
      </div>
    </div>
    <div class="rx-readout" id="rx-readout"></div>
    <div class="topbar-actions">
      <button class="icon-btn" id="btn-reset" title="새 상담 시작" aria-label="새 상담 시작">
        <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
      </button>
      <button class="icon-btn" id="btn-settings" title="설정" aria-label="설정">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </div>
  `;

  const chip = root.querySelector('#rx-readout');
  function fmt(d) {
    const v = Number(d);
    if (Number.isNaN(v) || v === 0) return '0.00';
    return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2);
  }
  function refresh(s) {
    chip.innerHTML = `
      <span><span class="rx-eye-tag os">OS</span><strong>S${fmt(s.os.sphere)}</strong> C${fmt(s.os.cylinder)} <span style="color:var(--ink-5)">${s.os.axis}°</span></span>
      <span class="rx-sep">▪</span>
      <span><span class="rx-eye-tag od">OD</span><strong>S${fmt(s.od.sphere)}</strong> C${fmt(s.od.cylinder)} <span style="color:var(--ink-5)">${s.od.axis}°</span></span>
      <span class="rx-sep">▪</span>
      <span><span class="rx-eye-tag add">ADD</span><strong>+${s.add.toFixed(2)}</strong></span>
      <span class="rx-sep">▪</span>
      <span style="color:var(--ink-4);font-weight:500">CORRIDOR <strong style="color:var(--ink)">${s.corridor}mm</strong></span>
    `;
    root.querySelectorAll('.topbar-tab').forEach(b => {
      b.dataset.active = String(s.activeTab === b.dataset.tab);
    });
  }
  refresh(state);
  subscribe(refresh);

  root.querySelectorAll('.topbar-tab').forEach(b => {
    b.addEventListener('click', () => update({ activeTab: b.dataset.tab }));
  });
  root.querySelector('#btn-reset').addEventListener('click', () => {
    if (confirm('새 상담을 시작합니다. 현재 입력값이 모두 초기화됩니다.')) {
      // Soft reset — keep tab on simulator
      import('../wavefront/state.js').then(m => { m.reset(); update({ activeTab: 'simulator' }); });
    }
  });
  root.querySelector('#btn-settings').addEventListener('click', () => {
    update({ settingsOpen: true });
  });
}
