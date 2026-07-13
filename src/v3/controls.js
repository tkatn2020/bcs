// v3 controls — grade cards (top), core bar (bottom), fitting panel (right).
// Visual design intentionally plain (PRD v0.5: design decided during build).
// Double-tap a slider label to reset that parameter to standard.

import { state, update, subscribe } from '../wavefront/state.js';
import { GRADES } from '../optics/grades.js';
import { STANDARD_FIT } from './fittingModel.js';

const CSS = `
  .v3-top, .v3-bottom, .v3-panel {
    position: fixed; z-index: 10;
    background: rgba(16, 19, 26, 0.74); backdrop-filter: blur(10px);
    border-radius: 14px; font-family: 'Pretendard', system-ui, sans-serif;
    user-select: none; -webkit-user-select: none;
  }
  .v3-top { top: 14px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 8px; align-items: center; padding: 10px 14px; }
  .v3-bottom { bottom: 16px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 8px; align-items: center; padding: 10px 14px; }
  .v3-grade { min-width: 72px; padding: 8px 10px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.14); background: transparent; color: #cfd6e4;
    font-size: 13px; font-weight: 700; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .v3-grade small { font-size: 10px; font-weight: 500; opacity: 0.65; }
  .v3-grade.on { background: #e8ecf4; color: #10131a; border-color: #e8ecf4; }
  .v3-label { font-size: 11px; letter-spacing: 0.06em; color: #8b93a7; font-weight: 700; margin-left: 8px; }
  .v3-step { width: 32px; height: 32px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.14);
    background: transparent; color: #e8ecf4; font-size: 15px; cursor: pointer; }
  .v3-val { min-width: 54px; text-align: center; color: #fff; font-weight: 800; font-size: 14px;
    font-variant-numeric: tabular-nums; }
  .v3-btn { padding: 8px 11px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.14);
    background: transparent; color: #cfd6e4; font-size: 12px; font-weight: 700; cursor: pointer; }
  .v3-btn.on { background: #e8ecf4; color: #10131a; border-color: #e8ecf4; }
  .v3-btn.warn { border-color: rgba(239,68,68,0.55); color: #f0a0a0; }

  .v3-panel { top: 78px; right: 14px; width: 250px; padding: 12px 14px;
    display: flex; flex-direction: column; gap: 9px; max-height: calc(100vh - 170px);
    overflow-y: auto; scrollbar-gutter: stable; }
  .v3-sec { font-size: 10px; letter-spacing: 0.12em; color: #8b93a7; font-weight: 800; margin-top: 4px; }
  .v3-row { display: flex; align-items: center; gap: 8px; }
  .v3-row label { flex: 0 0 64px; font-size: 11.5px; color: #cfd6e4; font-weight: 600; cursor: pointer; }
  .v3-row input[type=range] { flex: 1; min-width: 0; accent-color: #e8ecf4; }
  .v3-row .num { flex: 0 0 56px; text-align: right; font-size: 11.5px; color: #fff;
    font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .v3-mini { display: flex; gap: 6px; flex-wrap: wrap; }
  .v3-mini .v3-btn { flex: 1; padding: 7px 4px; font-size: 11.5px; text-align: center; }
`;

const SLIDERS = [
  { key: 'vd',    label: '정점간거리', min: 0,   max: 16, step: 0.5, unit: 'mm', std: STANDARD_FIT.vd },
  { key: 'panto', label: '경사각',     min: -15, max: 15, step: 1,   unit: '°',  std: STANDARD_FIT.panto },
  { key: 'wrap',  label: '안면각',     min: -15, max: 15, step: 1,   unit: '°',  std: STANDARD_FIT.wrap },
  { key: 'pdErr', label: 'PD 오차',    min: -4,  max: 4,  step: 0.5, unit: 'mm', std: 0 },
  { key: 'oh',    label: 'OH 높이',    min: -4,  max: 4,  step: 0.5, unit: 'mm', std: 0 },
  { key: 'bSize', label: '프레임 크기', min: 26, max: 40, step: 1,   unit: 'mm', std: STANDARD_FIT.bSize },
];

// 프레임 피팅 커스텀 — 광학 무관, 순수 다리 지오메트리 (state.v3frame)
const FRAME_SLIDERS = [
  { key: 'templeAngle', label: '다리 경사각', min: -20, max: 20, step: 1,   unit: '°',  std: 0 },
  { key: 'templeLen',   label: '다리 길이',   min: -20, max: 20, step: 1,   unit: 'mm', std: 0 },
  { key: 'templeGap',   label: '옆면 간격',   min: 0,   max: 10, step: 0.5, unit: 'mm', std: 0 },
  { key: 'templeBend',  label: '다리 밴딩',   min: 0,   max: 90, step: 2,   unit: '°',  std: 60 },
  { key: 'endpiece',    label: '엔드피스 높이', min: -6, max: 6,  step: 0.5, unit: 'mm', std: 0 },
];

const SHAPES = [
  { id: 'square', label: '사각' }, { id: 'round', label: '원형' },
  { id: 'boston', label: '보스턴' }, { id: 'aviator', label: '애비에이터' },
];

const CAM_PRESETS = [
  { id: 'quarter', label: '¾', pos: [0.62, 0.18, 0.72], tgt: [0.05, -0.02, 0.28] },
  { id: 'front', label: '정면', pos: [0.02, 0.02, 0.55], tgt: [0, 0, 0] },
  { id: 'side', label: '측면', pos: [0.52, 0.02, 0.03], tgt: [0, 0, 0.01] },
  { id: 'top', label: '상면', pos: [0.02, 0.55, 0.14], tgt: [0, 0, 0.03] },
];

export function mountControls(root, { stage, getDemo } = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // ── Top: grade cards ──
  const top = document.createElement('div');
  top.className = 'v3-top';
  top.innerHTML = GRADES.map((g) => `
    <button class="v3-grade" data-grade="${g.id}">${g.id}단계<small>${g.name}</small></button>
  `).join('');
  root.appendChild(top);
  top.addEventListener('click', (e) => {
    const b = e.target.closest('[data-grade]');
    if (b) update({ grade: Number(b.dataset.grade) });
  });

  // ── Bottom: ADD · corridor · presets ──
  const bottom = document.createElement('div');
  bottom.className = 'v3-bottom';
  bottom.innerHTML = `
    <span class="v3-label">ADD</span>
    <button class="v3-step" data-add="-0.25">−</button>
    <span class="v3-val" data-role="add">+2.00</span>
    <button class="v3-step" data-add="0.25">＋</button>
    <span class="v3-label">누진대</span>
    ${[10, 12, 14].map((c) => `<button class="v3-btn" data-corr="${c}">${c}mm</button>`).join('')}
  `;
  root.appendChild(bottom);
  bottom.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const next = Math.min(3.5, Math.max(0.75, (state.add ?? 2) + Number(add.dataset.add)));
      update({ add: Math.round(next * 4) / 4 });
    }
    const corr = e.target.closest('[data-corr]');
    if (corr) update({ corridor: Number(corr.dataset.corr) });
  });

  // ── Right: fitting panel ──
  const panel = document.createElement('div');
  panel.className = 'v3-panel';
  panel.innerHTML = `
    <div class="v3-sec">광학 피팅 (라벨 더블탭 = 표준 복귀)</div>
    ${SLIDERS.map((sl) => `
      <div class="v3-row">
        <label data-reset="${sl.key}" title="더블탭: 표준 복귀">${sl.label}</label>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" data-fit="${sl.key}">
        <span class="num" data-num="${sl.key}"></span>
      </div>
    `).join('')}
    <div class="v3-sec">프레임 피팅 커스텀</div>
    ${FRAME_SLIDERS.map((sl) => `
      <div class="v3-row">
        <label data-freset="${sl.key}" title="더블탭: 표준 복귀">${sl.label}</label>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" data-frame="${sl.key}">
        <span class="num" data-fnum="${sl.key}"></span>
      </div>
    `).join('')}
    <div class="v3-sec">프레임 형상</div>
    <div class="v3-mini">
      ${SHAPES.map((s) => `<button class="v3-btn" data-shape="${s.id}">${s.label}</button>`).join('')}
    </div>
    <div class="v3-sec">시야 존 표시</div>
    <div class="v3-mini">
      <button class="v3-btn" data-zone="distance">원거리</button>
      <button class="v3-btn" data-zone="intermediate">중간</button>
      <button class="v3-btn" data-zone="near">근거리</button>
      <button class="v3-btn" data-toggle="targets">타깃</button>
    </div>
    <div class="v3-sec">카메라</div>
    <div class="v3-mini">
      ${CAM_PRESETS.map((c) => `<button class="v3-btn" data-cam="${c.id}">${c.label}</button>`).join('')}
    </div>
    <div class="v3-sec">데모</div>
    <div class="v3-mini">
      <button class="v3-btn" data-demo>▶ 시선 데모</button>
      <button class="v3-btn" data-headdown>고개 숙임</button>
      <button class="v3-btn" data-turntable>턴테이블</button>
    </div>
  `;
  root.appendChild(panel);

  panel.addEventListener('input', (e) => {
    const key = e.target.dataset?.fit;
    if (key) update({ v3fit: { [key]: Number(e.target.value) } });
    const fkey = e.target.dataset?.frame;
    if (fkey) update({ v3frame: { [fkey]: Number(e.target.value) } });
  });
  panel.addEventListener('dblclick', (e) => {
    const key = e.target.dataset?.reset;
    if (key) update({ v3fit: { [key]: SLIDERS.find((s) => s.key === key).std } });
    const fkey = e.target.dataset?.freset;
    if (fkey) update({ v3frame: { [fkey]: FRAME_SLIDERS.find((s) => s.key === fkey).std } });
  });
  panel.addEventListener('click', (e) => {
    const shape = e.target.closest('[data-shape]');
    if (shape) update({ v3fit: { shape: shape.dataset.shape } });
    const zone = e.target.closest('[data-zone]');
    if (zone) {
      const k = zone.dataset.zone;
      update({ v3view: { zones: { [k]: !state.v3view.zones[k] } } });
    }
    const tgl = e.target.closest('[data-toggle="targets"]');
    if (tgl) update({ v3view: { targets: !state.v3view.targets } });
    const cam = e.target.closest('[data-cam]');
    if (cam && stage) {
      const c = CAM_PRESETS.find((x) => x.id === cam.dataset.cam);
      stage.camera.position.set(...c.pos);
      stage.controls.target.set(...c.tgt);
      stage.controls.update();
    }
    // ── 데모 ──
    const demoBtn = e.target.closest('[data-demo]');
    if (demoBtn) getDemo?.()?.play();
    const headBtn = e.target.closest('[data-headdown]');
    if (headBtn) {
      const cur = state.v3fit?.headPitch ?? 0;
      update({ v3fit: { headPitch: cur < -5 ? 0 : -18 } });   // 토글 (D5)
    }
    const turnBtn = e.target.closest('[data-turntable]');
    if (turnBtn && stage) {
      stage.controls.autoRotate = !stage.controls.autoRotate;
      stage.controls.autoRotateSpeed = 1.1;
      turnBtn.classList.toggle('on', stage.controls.autoRotate);
    }
  });

  // ── Reactive refresh ──
  function refresh(s) {
    top.querySelectorAll('[data-grade]').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.grade) === s.grade));
    bottom.querySelector('[data-role="add"]').textContent = '+' + (s.add ?? 2).toFixed(2);
    bottom.querySelectorAll('[data-corr]').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.corr) === s.corridor));
    const f = s.v3fit || {};
    for (const sl of SLIDERS) {
      const input = panel.querySelector(`[data-fit="${sl.key}"]`);
      const num = panel.querySelector(`[data-num="${sl.key}"]`);
      const val = f[sl.key] ?? sl.std;
      if (document.activeElement !== input) input.value = val;
      num.textContent = `${val}${sl.unit}`;
      num.style.color = val === sl.std ? '#fff' : '#f5b64e';
    }
    const fr = s.v3frame || {};
    for (const sl of FRAME_SLIDERS) {
      const input = panel.querySelector(`[data-frame="${sl.key}"]`);
      const num = panel.querySelector(`[data-fnum="${sl.key}"]`);
      const val = fr[sl.key] ?? sl.std;
      if (document.activeElement !== input) input.value = val;
      num.textContent = `${val}${sl.unit}`;
      num.style.color = val === sl.std ? '#fff' : '#f5b64e';
    }
    panel.querySelectorAll('[data-shape]').forEach((b) =>
      b.classList.toggle('on', b.dataset.shape === f.shape));
    panel.querySelectorAll('[data-zone]').forEach((b) =>
      b.classList.toggle('on', !!s.v3view?.zones?.[b.dataset.zone]));
    panel.querySelector('[data-toggle="targets"]')
      .classList.toggle('on', !!s.v3view?.targets);
    panel.querySelector('[data-headdown]')
      .classList.toggle('on', (s.v3fit?.headPitch ?? 0) < -5);
  }
  refresh(state);
  subscribe(refresh);
}
