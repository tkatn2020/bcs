// Detail modal — popup invoked from the OU bar's "OD/OS 자세히" button.
// Shows the per-eye Clear Vision Field panels (OD + OS) using the same
// `createRatioPanel` component the simulator used to mount inline. Lives
// in a popup so the right aside stays compact for sales by default, with
// detailed asymmetry breakdown available on demand.

import { state, update, subscribe } from './state.js';
import { getGeom } from './helpers.js';
import { createRatioPanel } from './ratioPanel.js';

function geomFor(s, eye) {
  const rx = eye === 'OS' ? s.os : s.od;
  return getGeom({
    grade: s.grade, corridorLength: s.corridor, add: s.add,
    sphere: rx.sphere, cylinder: rx.cylinder, axis: rx.axis, eye,
  });
}

export function mountDetailModal(root) {
  // The two ratio-panel instances are created lazily on first open and
  // then updated on every state change while the modal is mounted.
  let odPanel = null, osPanel = null, panelUnsub = null;

  function open(s) {
    root.classList.remove('hidden');
    root.innerHTML = `
      <div class="modal-card detail-modal-card">
        <div class="modal-header">
          <h2 class="modal-title">OD · OS 개별 시야 분석</h2>
          <button class="modal-close" id="detail-close">✕</button>
        </div>
        <div class="detail-modal-grid">
          <div class="detail-modal-col" id="detail-od"></div>
          <div class="detail-modal-col" id="detail-os"></div>
        </div>
        <div class="detail-modal-foot">
          <p class="detail-modal-hint">
            우측 패널의 OU 양안 평균은 이 두 눈의 점수를 평균낸 값입니다. 좌우격차가 큰 경우(▲ 5점 이상) 처방 정밀도를 점검해보세요.
          </p>
        </div>
      </div>
    `;

    odPanel = createRatioPanel(geomFor(s, 'OD'), { eyeLabel: 'OD · 우안', threshold: s.threshold });
    osPanel = createRatioPanel(geomFor(s, 'OS'), { eyeLabel: 'OS · 좌안', threshold: s.threshold });
    root.querySelector('#detail-od').appendChild(odPanel.el);
    root.querySelector('#detail-os').appendChild(osPanel.el);

    // Subscribe so panels update when grade/ADD/Rx changes mid-modal
    panelUnsub = subscribe((sNew) => {
      if (!sNew.detailModalOpen) return;
      odPanel.update({ geom: geomFor(sNew, 'OD'), threshold: sNew.threshold });
      osPanel.update({ geom: geomFor(sNew, 'OS'), threshold: sNew.threshold });
    });

    root.querySelector('#detail-close').addEventListener('click', () => update({ detailModalOpen: false }));
    root.addEventListener('click', e => { if (e.target === root) update({ detailModalOpen: false }); });
  }

  function close() {
    root.classList.add('hidden');
    root.innerHTML = '';
    odPanel = null;
    osPanel = null;
    if (panelUnsub) { panelUnsub(); panelUnsub = null; }
  }

  function render(s) {
    const isOpen = s.detailModalOpen;
    const isMounted = !!odPanel;
    if (isOpen && !isMounted) open(s);
    if (!isOpen && isMounted) close();
  }

  subscribe(render);
  render(state);
}
