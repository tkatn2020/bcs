// Settings modal — opened via the ⚙ button in the top bar.
// Toggles for iso/bands display + the photo uploader for environment scenes.

import { state, update, subscribe } from './state.js';
import { mountSceneUploader } from './sceneUploader.js';

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
                <div class="stt-sub">cyl 0.25/0.50/1.00/2.00 D 등고선 표시</div>
              </div>
            </label>
            <label class="settings-toggle-row">
              <span class="switch">
                <input type="checkbox" id="set-bands" ${s.showBands ? 'checked' : ''}>
                <span class="switch-track"></span>
              </span>
              <div>
                <div class="stt-title">영역 분할선·화살표</div>
                <div class="stt-sub">원/근용 시야 화살표, 누진대 통로, 영역 분할선</div>
              </div>
            </label>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-h">배경 사진</div>
          <p class="hint" style="margin-bottom:10px">3개 환경에 사용할 사진을 드래그-드롭 또는 클릭해서 업로드하세요. 비워두면 자동으로 디스크의 scenes/{env}.jpg를 시도하고, 그것도 없으면 절차생성 씬을 사용합니다.</p>
          <div id="settings-uploader"></div>
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

    mountSceneUploader(root.querySelector('#settings-uploader'));
  }

  subscribe(render);
  render(state);
}
