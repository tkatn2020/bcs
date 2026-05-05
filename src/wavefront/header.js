// Top bar — brand, persistent Rx summary chip, settings + reset buttons.

import { state, update, reset, subscribe } from './state.js';

export function mountHeader(root) {
  root.innerHTML = `
    <div class="topbar-brand">
      <span class="topbar-brand-icon">👁</span>
      <span>누진다초점 시뮬레이터</span>
    </div>
    <div class="rx-chip" id="rx-chip"></div>
    <div class="topbar-actions">
      <button class="topbar-btn" id="btn-settings" title="설정">⚙</button>
      <button class="topbar-btn" id="btn-reset" title="새 상담 시작">🔄</button>
    </div>
  `;

  const chip = root.querySelector('#rx-chip');
  function fmt(d) {
    const v = Number(d);
    if (Number.isNaN(v) || v === 0) return '0.00';
    return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2);
  }
  function refreshChip(s) {
    // OS first, OD second — matches the visual binocular layout
    // (OS on left of screen, OD on right — view of the wearer from optician's POV).
    chip.innerHTML = `
      <span><span class="rx-eye-tag os">OS</span> <strong>S${fmt(s.os.sphere)}</strong> C${fmt(s.os.cylinder)} ax${s.os.axis}°</span>
      <span style="opacity:0.4">|</span>
      <span><span class="rx-eye-tag od">OD</span> <strong>S${fmt(s.od.sphere)}</strong> C${fmt(s.od.cylinder)} ax${s.od.axis}°</span>
      <span style="opacity:0.4">|</span>
      <span>ADD <strong>+${s.add.toFixed(2)}</strong></span>
      <span style="opacity:0.4">·</span>
      <span>누진 <strong>${s.corridor}mm</strong></span>
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
