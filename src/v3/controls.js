// v3 controls — grade cards (top), core bar (bottom), fitting panel (right).
// Visual design intentionally plain (PRD v0.5: design decided during build).
// Double-tap a slider label to reset that parameter to standard.

import { state, update, subscribe, resetFitting } from '../wavefront/state.js';
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
  .v3-flash { animation: v3flash 1.4s ease; border-radius: 8px; }
  @keyframes v3flash {
    0%, 55% { background: rgba(56,189,248,0.20); box-shadow: 0 0 0 2px rgba(56,189,248,0.45); }
    100% { background: transparent; box-shadow: none; }
  }

  .v3-panel { top: 186px; right: 14px; width: 250px; padding: 12px 14px;
    display: flex; flex-direction: column; gap: 9px; max-height: calc(100vh - 278px);
    overflow-y: auto; scrollbar-gutter: stable; }
  .v3-resetbar { position: fixed; z-index: 10; top: 14px; right: 14px; width: 250px;
    padding: 10px 14px; border-radius: 14px;
    background: rgba(16, 19, 26, 0.74); backdrop-filter: blur(10px);
    font-family: 'Pretendard', system-ui, sans-serif; user-select: none; -webkit-user-select: none; }
  .v3-presetbar { position: fixed; z-index: 10; top: 72px; right: 14px; width: 250px;
    padding: 10px 14px; border-radius: 14px;
    background: rgba(16, 19, 26, 0.74); backdrop-filter: blur(10px);
    font-family: 'Pretendard', system-ui, sans-serif; user-select: none; -webkit-user-select: none;
    display: flex; flex-direction: column; gap: 8px; }
  .v3-presetbar .v3-sec { margin-top: 0; }
  .v3-sec { font-size: 10px; letter-spacing: 0.12em; color: #8b93a7; font-weight: 800; margin-top: 4px; }
  .v3-row { display: flex; align-items: center; gap: 8px; }
  .v3-row label { flex: 0 0 78px; font-size: 11.5px; color: #cfd6e4; font-weight: 600; cursor: pointer;
    white-space: nowrap; }
  .v3-row input[type=range] { flex: 1; min-width: 0; accent-color: #e8ecf4; }
  .v3-row .num { flex: 0 0 56px; text-align: right; font-size: 11.5px; color: #fff;
    font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .v3-mini { display: flex; gap: 6px; flex-wrap: wrap; }
  .v3-mini .v3-btn { flex: 1; padding: 7px 4px; font-size: 11.5px; text-align: center; }
  .v3-row.hidden { display: none; }
  .v3-row input[type=checkbox].v3-asym { flex: 0 0 16px; width: 16px; height: 16px; margin: 0;
    accent-color: #f5b64e; cursor: pointer; }
  .v3-cbpad { flex: 0 0 16px; }
  .v3-sub label { color: #9aa3b5; border-left: 2px solid rgba(245,182,78,0.45); padding-left: 6px; }
  .v3-sub .num { color: #f5b64e; }
`;

const SLIDERS = [
  { key: 'vd',    label: '정점간거리', min: 5,   max: 20, step: 0.5, unit: 'mm', std: STANDARD_FIT.vd,
    edu: '정점간거리: 멀수록 착용 여유↑ · 시야각↓ · 왜곡 노출↑' },
  { key: 'panto', label: '경사각',     min: -15, max: 15, step: 1,   unit: '°',  std: STANDARD_FIT.panto,
    edu: '경사각: 부족하면 근용 손실 · 과다하면 원용 손실 (표준 8~12°)' },
  { key: 'wrap',  label: '안면각',     min: -15, max: 15, step: 1,   unit: '°',  std: STANDARD_FIT.wrap,
    edu: '안면각: 표준(5°)에서 벗어날수록 주변부 수차·시야 왜곡↑' },
  { key: 'pdErr', label: 'PD 오차',    min: -10, max: 10, step: 0.5, unit: 'mm', std: 0,
    edu: 'PD: 십자(광학중심)가 동공과 어긋난 만큼 통로 폭↓·양안 겹침↓ — 프레임 유래 편심과 합산' },
  { key: 'oh',    label: 'OH 높이',    min: -8,  max: 8,  step: 0.5, unit: 'mm', std: 0,
    edu: 'OH: 낮으면 근용 도달 어려움 · 높으면 원용 침범 — 양쪽 다 대가' },
  { key: 'bSize', label: '프레임 크기', min: 10, max: 40, step: 1,   unit: 'mm', std: STANDARD_FIT.bSize,
    edu: '프레임: 클수록 시야↑·왜곡↑ + 가공 전엔 광학중심(십자)이 동공에서 벌어짐 — PD로 보정' },
];

// 프레임 피팅 커스텀 — 광학 무관, 순수 다리 지오메트리 (state.v3frame)
const FRAME_SLIDERS = [
  { key: 'templeAngle', label: '다리 경사각', min: -20, max: 20, step: 1,   unit: '°',  std: 0,   asym: true },
  { key: 'templeLen',   label: '다리 길이',   min: -20, max: 20, step: 1,   unit: 'mm', std: 0 },
  { key: 'templeGap',   label: '옆면 간격',   min: -10, max: 10, step: 0.5, unit: 'mm', std: 0,   asym: true },
  { key: 'templeBend',  label: '다리 밴딩',   min: 0,   max: 90, step: 2,   unit: '°',  std: 20,  asym: true },
  { key: 'earTipAngle', label: '귀팁각',      min: 90,  max: 180, step: 2,  unit: '°',  std: 118, asym: true },
  { key: 'earConverge', label: '귀모임각',    min: -25, max: 25, step: 1,   unit: '°',  std: 0,   asym: true },
  { key: 'endpiece',    label: '엔드피스 높이', min: -6, max: 6,  step: 0.5, unit: 'mm', std: 0 },
];

// 코받침(코패드) — state.v3frame, data-frame 네임스페이스 재사용
const PAD_SLIDERS = [
  { key: 'padSpacing',  label: '좌우 간격', min: -4, max: 10, step: 0.5, unit: 'mm', std: 0 },
  { key: 'padVertical', label: '상하 위치', min: -10, max: 10, step: 0.5, unit: 'mm', std: 0 },
  { key: 'padArm',      label: '전후',      min: -10, max: 10, step: 0.5, unit: 'mm', std: 0 },
];

// 두상 조정 — 얼굴 메시 변형 (state.v3head). 광학 무관. 귀는 좌우 개별 조정 가능.
const HEAD_SLIDERS = [
  { key: 'earY', label: '귀 상하', min: -10, max: 25, step: 0.5, unit: 'mm', std: 7, asym: true },
  { key: 'earZ', label: '귀 앞뒤', min: -10, max: 10, step: 0.5, unit: 'mm', std: 0, asym: true },
  { key: 'faceWidth', label: '옆통수 폭', min: -6, max: 10, step: 0.5, unit: 'mm', std: 0, asym: true },
  { key: 'noseBridge', label: '콧대', min: -8, max: 8, step: 0.5, unit: 'mm', std: 0 },
];
const HEAD_ASYM_KEYS = new Set(['earY', 'earZ', 'faceWidth']);   // change 핸들러 네임스페이스 판별

const SHAPES = [
  { id: 'square', label: '사각' }, { id: 'round', label: '원형' },
  { id: 'boston', label: '보스턴' }, { id: 'aviator', label: '애비에이터' },
];

const CAM_PRESETS = [
  { id: 'quarter', label: '¾', pos: [0.62, 0.18, 0.72], tgt: [0.05, -0.02, 0.28] },
  { id: 'front', label: '정면', pos: [0.02, 0.02, 0.55], tgt: [0, 0, 0] },
  { id: 'side', label: '측면', pos: [0.52, 0.02, 0.03], tgt: [0, 0, 0.01] },
  { id: 'top', label: '상면', pos: [0.02, 0.45, 0.335], tgt: [0, 0, 0.02] },   // polar ~35° (minPolarAngle 32.4° 안쪽)
];

// 피팅 프리셋 3슬롯 — 올바른/잘못된 피팅 빠른 비교용. 인메모리(모듈 스코프)라
// 페이지 새로고침 시 초기화. 각 슬롯 = { v3fit, v3frame, v3head } 스냅샷.
const fitPresets = [null, null, null];


export function mountControls(root, { stage, getDemo, getMulti, setCaption } = {}) {
  const cap = (t) => { if (setCaption) setCaption(t); };
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
    if (b) {
      const id = Number(b.dataset.grade);
      update({ grade: id });
      const g = GRADES.find((x) => x.id === id);
      if (g) cap(`${g.bpCode} ${g.name}: ${g.description} — 왜곡은 재분배될 뿐 0이 되진 않음`);
    }
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
      cap('ADD: 높을수록 통로가 좁아지고 주변부 왜곡 구배가 급해짐');
    }
    const corr = e.target.closest('[data-corr]');
    if (corr) {
      update({ corridor: Number(corr.dataset.corr) });
      cap('누진대: 길수록 왜곡 완만↓ · 근용까지 시선을 더 내려야 함');
    }
  });

  // ── Right: fitting panel ──
  const panel = document.createElement('div');
  panel.className = 'v3-panel';
  panel.innerHTML = `
    <div class="v3-sec">시야 존 표시</div>
    <div class="v3-mini">
      <button class="v3-btn" data-zone="distance">원거리</button>
      <button class="v3-btn" data-zone="intermediate">중간</button>
      <button class="v3-btn" data-zone="near">근거리</button>
    </div>
    <div class="v3-mini">
      <button class="v3-btn" data-multiview>▣ 시야 멀티뷰 (정면·하단·측면)</button>
    </div>
    <div class="v3-sec">기준선 (정렬 확인)</div>
    <div class="v3-mini">
      <button class="v3-btn" data-guide-mode="h">가로선</button>
      <button class="v3-btn" data-guide-mode="v">세로선</button>
      <button class="v3-btn" data-guide-clear>모두 지우기</button>
    </div>
    <div class="v3-sec">광학 피팅 (라벨 더블탭 = 표준 복귀)</div>
    ${SLIDERS.map((sl) => `
      <div class="v3-row">
        <label data-reset="${sl.key}" title="더블탭: 표준 복귀">${sl.label}</label>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" data-fit="${sl.key}">
        <span class="num" data-num="${sl.key}"></span>
        <span class="v3-cbpad"></span>
      </div>
    `).join('')}
    <div class="v3-sec">프레임 피팅 커스텀</div>
    ${FRAME_SLIDERS.map((sl) => sl.asym ? `
      <div class="v3-row">
        <label data-freset="${sl.key}" title="더블탭: 표준 복귀">${sl.label}</label>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" data-frame="${sl.key}">
        <span class="num" data-fnum="${sl.key}"></span>
        <input type="checkbox" class="v3-asym" data-asym="${sl.key}" title="좌우 개별 조정">
      </div>
      <div class="v3-row v3-sub hidden" data-subrow="${sl.key}">
        <label data-freset="${sl.key}_R" title="더블탭: 표준 복귀">우 ${sl.label}</label>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" data-frame="${sl.key}_R">
        <span class="num" data-fnum="${sl.key}_R"></span>
        <span class="v3-cbpad"></span>
      </div>
    ` : `
      <div class="v3-row">
        <label data-freset="${sl.key}" title="더블탭: 표준 복귀">${sl.label}</label>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" data-frame="${sl.key}">
        <span class="num" data-fnum="${sl.key}"></span>
        <span class="v3-cbpad"></span>
      </div>
    `).join('')}
    <div class="v3-sec">코받침</div>
    <div class="v3-mini">
      <button class="v3-btn" data-padon>코받침 표시</button>
    </div>
    ${PAD_SLIDERS.map((sl) => `
      <div class="v3-row">
        <label data-freset="${sl.key}" title="더블탭: 표준 복귀">${sl.label}</label>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" data-frame="${sl.key}">
        <span class="num" data-fnum="${sl.key}"></span>
        <span class="v3-cbpad"></span>
      </div>
    `).join('')}
    <div class="v3-sec">두상 조정</div>
    ${HEAD_SLIDERS.map((sl) => sl.asym ? `
      <div class="v3-row">
        <label data-hreset="${sl.key}" title="더블탭: 표준 복귀">${sl.label}</label>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" data-head="${sl.key}">
        <span class="num" data-hnum="${sl.key}"></span>
        <input type="checkbox" class="v3-asym" data-asym="${sl.key}" title="좌우 개별 조정">
      </div>
      <div class="v3-row v3-sub hidden" data-subrow="${sl.key}">
        <label data-hreset="${sl.key}_R" title="더블탭: 표준 복귀">우 ${sl.label}</label>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" data-head="${sl.key}_R">
        <span class="num" data-hnum="${sl.key}_R"></span>
        <span class="v3-cbpad"></span>
      </div>
    ` : `
      <div class="v3-row">
        <label data-hreset="${sl.key}" title="더블탭: 표준 복귀">${sl.label}</label>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" data-head="${sl.key}">
        <span class="num" data-hnum="${sl.key}"></span>
        <span class="v3-cbpad"></span>
      </div>
    `).join('')}
    <div class="v3-sec">프레임 형상</div>
    <div class="v3-mini">
      ${SHAPES.map((s) => `<button class="v3-btn" data-shape="${s.id}">${s.label}</button>`).join('')}
    </div>
    <div class="v3-sec">카메라</div>
    <div class="v3-mini">
      ${CAM_PRESETS.map((c) => `<button class="v3-btn" data-cam="${c.id}">${c.label}</button>`).join('')}
    </div>
    <div class="v3-sec">데모</div>
    <div class="v3-mini">
      <button class="v3-btn" data-demo>▶ 시선 데모</button>
      <button class="v3-btn" data-turntable>턴테이블</button>
    </div>
  `;
  root.appendChild(panel);

  // ── 최상단 별도 패널: 전체 기본값 복귀 — 항상 같은 자리에서 즉시 접근.
  // 누르면 '표준 피팅' 상태가 된다: 전체 기본값 + 렌즈 구성(누진대·ADD) 기준
  // + 시야 존 3종·타깃 표시 (구 교육 케이스 '표준 피팅'과 동일 — 케이스 기능은
  // 사용자 요청으로 제거, 이 버튼이 그 역할을 흡수).
  const resetBar = document.createElement('div');
  resetBar.className = 'v3-resetbar';
  resetBar.innerHTML = `
    <div class="v3-mini">
      <button class="v3-btn warn" data-resetall>전체 기본값 복귀 (표준 피팅)</button>
    </div>
  `;
  root.appendChild(resetBar);
  resetBar.addEventListener('click', (e) => {
    if (!e.target.closest('[data-resetall]')) return;
    resetFitting();
    update({
      corridor: 12, add: 2.0,
      v3view: { zones: { distance: true, intermediate: true, near: true }, targets: false },
    });
    cap('표준 피팅 — 기준 상태 복귀');
  });

  // ── HUD 요인 분해 → 조절 UI 플래시 — HUD에서 요인을 클릭하면 그 요인을
  // 조절하는 슬라이더/버튼 행이 빛나며 스크롤로 노출("이걸 고치면 회복").
  window.addEventListener('v3:flash-control', (e) => {
    const k = e.detail?.ctrl;
    if (!k) return;
    let target = null;
    if (k === 'shape') target = panel.querySelector('[data-shape]')?.closest('.v3-mini');
    else {
      const input = panel.querySelector(`[data-fit="${k}"]`) || panel.querySelector(`[data-frame="${k}"]`);
      target = input?.closest('.v3-row');
    }
    if (!target) return;
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    target.classList.remove('v3-flash');
    void target.offsetWidth;   // 연속 클릭 시 애니메이션 재시작
    target.classList.add('v3-flash');
    setTimeout(() => target.classList.remove('v3-flash'), 1500);
  });

  // ── 기준선(정렬 확인) — '선 배치' 모드에서 화면 클릭 지점마다 수직·수평선
  // 한 쌍을 놓는다(수평 정렬·좌우 높이차 확인용 자). 배치 모드 동안은 오버레이가
  // 캔버스 입력을 가로채 카메라/핸들과 충돌하지 않는다(패널은 z-index가 높아
  // 계속 조작 가능). '모두 지우기'로 전체 삭제. 화면(px) 고정 — 카메라를 돌려도
  // 자처럼 제자리에 남는 게 의도.
  const guideLayer = document.createElement('div');
  Object.assign(guideLayer.style, {
    position: 'fixed', inset: '0', zIndex: 5, pointerEvents: 'none', cursor: 'crosshair',
  });
  root.appendChild(guideLayer);
  // 배치 모드: 'h'(가로선) | 'v'(세로선) | null — 가로/세로 각각 따로 배치
  // (사용자 요청: 십자 쌍이 아니라 개별 선). 두 버튼은 상호 배타 토글.
  let guideMode = null;
  const guideBtns = [...panel.querySelectorAll('[data-guide-mode]')];
  guideBtns.forEach((btn) => btn.addEventListener('click', () => {
    guideMode = guideMode === btn.dataset.guideMode ? null : btn.dataset.guideMode;
    guideBtns.forEach((b) => b.classList.toggle('on', b.dataset.guideMode === guideMode));
    guideLayer.style.pointerEvents = guideMode ? 'auto' : 'none';
    cap(guideMode
      ? `기준선: 원하는 위치를 클릭하면 ${guideMode === 'h' ? '가로선' : '세로선'}이 놓입니다 (다시 누르면 배치 종료)`
      : '');
  }));
  panel.querySelector('[data-guide-clear]').addEventListener('click', () => {
    guideLayer.replaceChildren();
  });
  guideLayer.addEventListener('click', (e) => {
    if (!guideMode) return;
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'fixed', pointerEvents: 'none',
      background: 'rgba(56,189,248,0.7)', boxShadow: '0 0 3px rgba(56,189,248,0.45)',
    }, guideMode === 'h'
      ? { left: '0', top: e.clientY + 'px', width: '100vw', height: '1px' }
      : { left: e.clientX + 'px', top: '0', width: '1px', height: '100vh' });
    guideLayer.appendChild(d);
  });

  // ── 상단 개별 패널: 피팅 프리셋 (자주 쓰는 기능 — 스크롤 없이 즉시 접근) ──
  const presetBar = document.createElement('div');
  presetBar.className = 'v3-presetbar';
  presetBar.innerHTML = `
    <div class="v3-sec">피팅 프리셋 (비교용 · 새로고침 시 초기화)</div>
    <div class="v3-mini">
      <button class="v3-btn" data-preset-load="0">프리셋 1</button>
      <button class="v3-btn" data-preset-load="1">프리셋 2</button>
      <button class="v3-btn" data-preset-load="2">프리셋 3</button>
    </div>
    <div class="v3-mini">
      <button class="v3-btn" data-preset-save="0">1 저장</button>
      <button class="v3-btn" data-preset-save="1">2 저장</button>
      <button class="v3-btn" data-preset-save="2">3 저장</button>
    </div>
  `;
  root.appendChild(presetBar);
  presetBar.addEventListener('click', (e) => {
    const pSave = e.target.closest('[data-preset-save]');
    if (pSave) {
      fitPresets[+pSave.dataset.presetSave] = {
        v3fit: JSON.parse(JSON.stringify(state.v3fit)),
        v3frame: JSON.parse(JSON.stringify(state.v3frame)),
        v3head: JSON.parse(JSON.stringify(state.v3head)),
      };
      refresh(state);   // 채워진 슬롯 표시 갱신(저장은 state 변경이 아니라 수동 호출)
    }
    const pLoad = e.target.closest('[data-preset-load]');
    if (pLoad) {
      const snap = fitPresets[+pLoad.dataset.presetLoad];
      if (snap) update({ v3fit: snap.v3fit, v3frame: snap.v3frame, v3head: snap.v3head });
    }
  });

  // ── 코받침 → VD·OH 라이트스루(사용자 결정 2026-07-19) ──
  // 코받침 조정은 프레임 위치 이동과 물리적으로 같은 축이다. 예전(B-2)처럼
  // 숨은 파생값(eff)으로 광학에만 반영하면 "코받침 전후를 늘렸는데 VD 슬라
  // 이더는 그대로"라는 이중 장부가 생긴다 — 이제 코받침을 움직이면 VD·OH
  // 슬라이더 값 자체가 함께 이동하고, 이후 VD/OH 조정은 그 위에 투명하게
  // 누적된다. 코받침이 꺼져 있으면(padOn=0) 물리 접점이 없으므로 연동 없음.
  // 슬라이더 입력과 더블탭 복귀가 모두 이 경로를 지나야 장부가 안 갈라진다.
  const PAD_COUPLE = {
    padVertical: { oh: -0.8 },              // 패드 위로 = 프레임 내려앉음
    padSpacing: { oh: -0.5, vd: -0.4 },     // 넓힘 = 내려앉고 가까워짐
    padArm: { vd: 0.4 },                    // 전후 연장 = 프레임 밀어냄
  };
  function padWrite(key, newVal) {
    const prev = state.v3frame[key] ?? 0;
    const dv = newVal - prev;
    const patch = { v3frame: { [key]: newVal } };
    const c = PAD_COUPLE[key];
    if (c && state.v3frame.padOn && dv) {
      const cur = { ...STANDARD_FIT, ...state.v3fit };
      const fitP = {};
      // 0.01 단위 유지 — 0.1로 반올림하면 왕복(조정→복귀)에서 잔차가 쌓인다.
      if (c.vd) fitP.vd = Math.round(Math.min(20, Math.max(5, cur.vd + dv * c.vd)) * 100) / 100;
      if (c.oh) fitP.oh = Math.round(Math.min(8, Math.max(-8, cur.oh + dv * c.oh)) * 100) / 100;
      patch.v3fit = fitP;
      const parts = [];
      if (fitP.vd !== undefined) parts.push(`정점간거리 → ${fitP.vd}mm`);
      if (fitP.oh !== undefined) parts.push(`OH → ${fitP.oh >= 0 ? '+' : ''}${fitP.oh}mm`);
      cap(`코받침 조정 = 프레임 이동: ${parts.join(' · ')} 함께 반영`);
    }
    update(patch);
  }

  panel.addEventListener('input', (e) => {
    const key = e.target.dataset?.fit;
    if (key) {
      update({ v3fit: { [key]: Number(e.target.value) } });
      const sl = SLIDERS.find((x) => x.key === key);
      if (sl?.edu) cap(sl.edu);
    }
    const fkey = e.target.dataset?.frame;
    if (fkey) {
      if (PAD_COUPLE[fkey]) padWrite(fkey, Number(e.target.value));
      else {
        update({ v3frame: { [fkey]: Number(e.target.value) } });
        if (fkey === 'templeAngle' || fkey === 'templeAngle_R') {
          cap('다리 경사각: 실제 조제에선 경사각(panto)을 바꾸는 1차 수단 — 본 앱에선 광학과 독립(경사각 슬라이더로 재현)');
        }
      }
    }
    const hkey = e.target.dataset?.head;
    if (hkey) update({ v3head: { [hkey]: Number(e.target.value) } });
  });
  // 좌우 비대칭 체크박스 — 플래그 토글. 켤 때 오른쪽(_R)을 현재 왼쪽값으로 시드.
  panel.addEventListener('change', (e) => {
    const cb = e.target;
    if (cb?.type !== 'checkbox' || cb.dataset?.asym == null) return;
    const key = cb.dataset.asym;
    const ns = HEAD_ASYM_KEYS.has(key) ? 'v3head' : 'v3frame';
    const patch = { [`${key}Asym`]: cb.checked ? 1 : 0 };
    if (cb.checked) patch[`${key}_R`] = state[ns][key];
    update({ [ns]: patch });
  });
  panel.addEventListener('dblclick', (e) => {
    const key = e.target.dataset?.reset;
    if (key) update({ v3fit: { [key]: SLIDERS.find((s) => s.key === key).std } });
    const fkey = e.target.dataset?.freset;
    if (fkey) {
      const std = [...FRAME_SLIDERS, ...PAD_SLIDERS].find((s) => s.key === fkey.replace(/_R$/, ''))?.std ?? 0;
      // 코받침 키는 라이트스루 경로로 — 복귀도 VD·OH를 함께 되돌린다
      if (PAD_COUPLE[fkey]) padWrite(fkey, std);
      else update({ v3frame: { [fkey]: std } });
    }
    const hkey = e.target.dataset?.hreset;
    if (hkey) {
      const std = HEAD_SLIDERS.find((s) => s.key === hkey.replace(/_R$/, ''))?.std ?? 0;
      update({ v3head: { [hkey]: std } });
    }
  });
  // 형상 → 광학 원리 캡션 (같은 크기라도 실면적·잘림이 다르다)
  const SHAPE_EDU = {
    square: '사각: 박스 면적을 가장 넓게 사용 — 기준 형상',
    round: '원형: 하부·코너가 잘려 근용 여유↓ — 대신 왜곡 날개도 함께 잘려 노출↓',
    boston: '보스턴: 하부가 완만히 잘림 — 근용·왜곡 모두 중간 수준',
    aviator: '애비에이터: 위는 넓고 아래가 좁아 근용 여유↓ · 왜곡 날개 일부 잘림',
  };
  panel.addEventListener('click', (e) => {
    const shape = e.target.closest('[data-shape]');
    if (shape) {
      update({ v3fit: { shape: shape.dataset.shape } });
      cap(SHAPE_EDU[shape.dataset.shape] || '');
    }
    const zone = e.target.closest('[data-zone]');
    if (zone) {
      const k = zone.dataset.zone;
      update({ v3view: { zones: { [k]: !state.v3view.zones[k] } } });
    }
    const mv = e.target.closest('[data-multiview]');
    if (mv && getMulti) {
      const multi = getMulti();
      if (multi) {
        multi.toggle();
        mv.classList.toggle('on', multi.isOpen);
      }
    }
    const padBtn = e.target.closest('[data-padon]');
    if (padBtn) update({ v3frame: { padOn: state.v3frame.padOn ? 0 : 1 } });
    const cam = e.target.closest('[data-cam]');
    if (cam && stage) {
      const c = CAM_PRESETS.find((x) => x.id === cam.dataset.cam);
      stage.camera.position.set(...c.pos);
      stage.controls.target.set(...c.tgt);
      stage.controls.autoRotate = false;   // 프리셋 이동 시 턴테이블 정지(계속 도는 것 방지)
      panel.querySelector('[data-turntable]')?.classList.remove('on');
      stage.controls.update();
    }
    // ── 데모 ──
    const demoBtn = e.target.closest('[data-demo]');
    if (demoBtn) getDemo?.()?.play();
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
    const rVar = (sl) => ({ ...sl, key: sl.key + '_R' });   // 오른쪽 슬라이더(std/unit 상속)
    for (const sl of [...FRAME_SLIDERS, ...PAD_SLIDERS, ...FRAME_SLIDERS.filter((x) => x.asym).map(rVar)]) {
      const input = panel.querySelector(`[data-frame="${sl.key}"]`);
      const num = panel.querySelector(`[data-fnum="${sl.key}"]`);
      const val = fr[sl.key] ?? sl.std;
      if (document.activeElement !== input) input.value = val;
      num.textContent = `${val}${sl.unit}`;
      num.style.color = val === sl.std ? '#fff' : '#f5b64e';
    }
    panel.querySelector('[data-padon]').classList.toggle('on', !!fr.padOn);
    // 좌우 비대칭 (frame): 체크박스·오른쪽 서브행 표시·프라이머리 라벨(좌 표기)
    for (const sl of FRAME_SLIDERS.filter((x) => x.asym)) {
      const flag = !!fr[`${sl.key}Asym`];
      panel.querySelector(`[data-asym="${sl.key}"]`).checked = flag;
      panel.querySelector(`[data-subrow="${sl.key}"]`).classList.toggle('hidden', !flag);
      panel.querySelector(`[data-freset="${sl.key}"]`).textContent = flag ? `좌 ${sl.label}` : sl.label;
    }
    const hd = s.v3head || {};
    for (const sl of [...HEAD_SLIDERS, ...HEAD_SLIDERS.filter((x) => x.asym).map(rVar)]) {
      const input = panel.querySelector(`[data-head="${sl.key}"]`);
      const num = panel.querySelector(`[data-hnum="${sl.key}"]`);
      const val = hd[sl.key] ?? sl.std;
      if (document.activeElement !== input) input.value = val;
      num.textContent = `${val}${sl.unit}`;
      num.style.color = val === sl.std ? '#fff' : '#f5b64e';
    }
    // 좌우 비대칭 (head): 체크박스·오른쪽 서브행 표시·프라이머리 라벨(좌 표기)
    for (const sl of HEAD_SLIDERS.filter((x) => x.asym)) {
      const flag = !!hd[`${sl.key}Asym`];
      panel.querySelector(`[data-asym="${sl.key}"]`).checked = flag;
      panel.querySelector(`[data-subrow="${sl.key}"]`).classList.toggle('hidden', !flag);
      panel.querySelector(`[data-hreset="${sl.key}"]`).textContent = flag ? `좌 ${sl.label}` : sl.label;
    }
    panel.querySelectorAll('[data-shape]').forEach((b) =>
      b.classList.toggle('on', b.dataset.shape === f.shape));
    panel.querySelectorAll('[data-zone]').forEach((b) =>
      b.classList.toggle('on', !!s.v3view?.zones?.[b.dataset.zone]));
    // 멀티뷰 버튼 — 팝업 X로 닫으면 존 복원(=state 변경)이 refresh를 부르므로
    // 여기서 isOpen에 동기화하면 버튼 클릭·X 닫기 양쪽이 일관.
    const mvBtn = panel.querySelector('[data-multiview]');
    if (mvBtn && getMulti) mvBtn.classList.toggle('on', !!getMulti()?.isOpen);
    // 피팅 프리셋: 채워진 슬롯은 강조(불러오기 가능), 빈 슬롯은 흐리게
    fitPresets.forEach((snap, i) => {
      const b = presetBar.querySelector(`[data-preset-load="${i}"]`);
      if (b) { b.classList.toggle('on', !!snap); b.style.opacity = snap ? '1' : '0.45'; }
    });
  }
  refresh(state);
  subscribe(refresh);
}
