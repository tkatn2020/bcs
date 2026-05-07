// Settings modal — opened via the ⚙ button in the top bar.
// Toggles for iso contours and zone bands display.

import { state, update, subscribe } from './state.js';

export function mountSettingsModal(root) {
  function render(s) {
    if (!s.settingsOpen) {
      root.classList.add('hidden');
      root.innerHTML = '';
      return;
    }
    root.classList.remove('hidden');
    root.innerHTML = `
      <div class="modal-card" id="modal-card">
        <div class="modal-header">
          <h2 class="modal-title">⚙ 설정</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>

        <div class="settings-section">
          <div class="settings-section-h">표시 옵션</div>
          <div class="settings-toggles">
            <label class="settings-toggle-row">
              <span class="switch">
                <input type="checkbox" id="set-iso" ${s.showIso ? 'checked' : ''}>
                <span class="switch-track"></span>
              </span>
              <div>
                <div class="stt-title">iso 등고선</div>
                <div class="stt-sub">cyl 0.25/0.50/1.00/2.00 D 등고선 (청록·에메랄드·오렌지·코랄 색상 코딩)</div>
              </div>
            </label>
            <label class="settings-toggle-row">
              <span class="switch">
                <input type="checkbox" id="set-bands" ${s.showBands ? 'checked' : ''}>
                <span class="switch-track"></span>
              </span>
              <div>
                <div class="stt-title">영역 분할선·화살표</div>
                <div class="stt-sub">원/중/근거리 시야 화살표, 영역 컬러 밴드, 분할선</div>
              </div>
            </label>
            <label class="settings-toggle-row">
              <span class="switch">
                <input type="checkbox" id="set-markings" ${s.showMarkings ? 'checked' : ''}>
                <span class="switch-track"></span>
              </span>
              <div>
                <div class="stt-title">누진 마킹 (사내 교육용)</div>
                <div class="stt-sub">DRP·FC·PRP·NRP·corridor dots·정렬마크 — 실제 누진렌즈의 표준 마킹을 시뮬렌즈에 오버레이</div>
              </div>
            </label>
          </div>
        </div>

        <div class="settings-footer">
          <button class="btn btn-primary" id="modal-done" style="min-height:var(--touch-comfort);padding:0 28px;font-size:16px">완료</button>
        </div>
      </div>
    `;

    root.querySelector('#modal-close').addEventListener('click', () => update({ settingsOpen: false }));
    root.querySelector('#modal-done').addEventListener('click', () => update({ settingsOpen: false }));
    // Click outside the card to close
    root.addEventListener('click', e => {
      if (e.target === root) update({ settingsOpen: false });
    });

    root.querySelector('#set-iso').addEventListener('change', e => update({ showIso: e.target.checked }));
    root.querySelector('#set-bands').addEventListener('change', e => update({ showBands: e.target.checked }));
    root.querySelector('#set-markings').addEventListener('change', e => update({ showMarkings: e.target.checked }));
  }

  subscribe(render);
  render(state);
}
