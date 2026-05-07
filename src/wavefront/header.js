// Top bar — minimal brand, persistent Rx readout, settings + reset.

import { state, update, reset, subscribe } from './state.js';

export function mountHeader(root) {
  root.innerHTML = `
    <div class="topbar-brand">
      <img class="brand-logo" src="src/wavefront/assets/logo.png" alt="breezm" />
      <span class="brand-text-en">PROGRESSIVE LENS · CONSULTATION</span>
    </div>
    <div class="rx-chip" id="rx-chip"></div>
    <div class="topbar-actions">
      <button class="topbar-btn" id="btn-settings" title="설정" aria-label="설정">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      <button class="topbar-btn" id="btn-reset" title="새 상담 시작" aria-label="새 상담 시작">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7"></path>
          <path d="M3 4v5h5"></path>
        </svg>
      </button>
    </div>
  `;

  const chip = root.querySelector('#rx-chip');
  function fmt(d) {
    const v = Number(d);
    if (Number.isNaN(v) || v === 0) return '0.00';
    return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2);
  }
  function refreshChip(s) {
    chip.innerHTML = `
      <span><span class="rx-eye-tag os">OS</span><strong>S${fmt(s.os.sphere)}</strong> C${fmt(s.os.cylinder)} <span style="color:var(--ink-4)">ax</span>${s.os.axis}°</span>
      <span class="rx-chip-sep">·</span>
      <span><span class="rx-eye-tag od">OD</span><strong>S${fmt(s.od.sphere)}</strong> C${fmt(s.od.cylinder)} <span style="color:var(--ink-4)">ax</span>${s.od.axis}°</span>
      <span class="rx-chip-sep">·</span>
      <span><span style="color:var(--ink-4);font-weight:500;letter-spacing:0.04em">ADD</span> <strong>+${s.add.toFixed(2)}</strong></span>
      <span class="rx-chip-sep">·</span>
      <span><span style="color:var(--ink-4);font-weight:500;letter-spacing:0.04em">누진</span> <strong>${s.corridor}mm</strong></span>
    `;
  }
  refreshChip(state);
  subscribe(refreshChip);

  root.querySelector('#btn-settings').addEventListener('click', () => {
    update({ settingsOpen: true });
  });
  root.querySelector('#btn-reset').addEventListener('click', () => {
    if (confirm('새 상담을 시작합니다. 현재 입력값이 모두 초기화됩니다.')) {
      reset();
      update({ activeTab: 'input' });
    }
  });
}
