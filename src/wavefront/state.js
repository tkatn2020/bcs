// Shared reactive state — single source of truth across all sections.
// Section 1 (playground) edits this directly.
// Section 2 (A↔B compare) inherits Rx + may override grade/add/corridor per side.
// Section 3 (sweep) uses this as the BASE config; sweep replaces one variable.

const subscribers = new Set();

// RAF batching for subscribers — multiple update() calls within the same JS
// tick (e.g., sync-eyes patch that updates OD then OS sequentially, or
// multi-field state changes from a single user action) fire subscribers
// only ONCE per animation frame. On iPad this halves the rendering work for
// common interaction patterns.
let _rafScheduled = false;
function _flushSubscribers() {
  _rafScheduled = false;
  subscribers.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
}
function _scheduleNotify() {
  if (_rafScheduled) return;
  _rafScheduled = true;
  requestAnimationFrame(_flushSubscribers);
}

const initial = {
  // Lens config (used by Section 1; Section 2/3 may override locally)
  grade: 3,
  add: 2.0,
  corridor: 12,
  threshold: 0.25,        // locked to 0.25D steps (slider step=0.25)

  // Display options — iso contours ON by default. The contours are now
  // color/width/style coded (cyan→emerald→orange→coral, thin→thick) so
  // they actively communicate severity zones to the customer rather than
  // being an opticians-only analytical layer.
  showIso: true,
  showBands: true,
  // Progressive lens manufacturing markings (DRP / FC / PRP / corridor dots /
  // NRP / side alignment marks / ADD label). OFF by default — used as an
  // in-house training overlay so staff learn what each engraving means.
  showMarkings: false,
  syncEyes: true,
  // Adaptation modeling — first-time progressive wearers take significantly
  // longer to adapt than experienced wearers. Defaults to true (safer assumption
  // for cold leads — adjusts down when staff confirms prior wearer status).
  firstTimeWearer: true,
  environment: 'driving',  // single env ('driving' id retained for compat — content is office scene)

  // Lens purchase options — surfaced in the options panel, affect tier prices.
  // Refractive index is derived from sphere (see optics/pricing.js), not stored.
  tint: false,                  // 착색 toggle (+0, free)
  protection: 'uv',             // 'uv' | 'blue' — radio, both free
  signatureGens: false,         // 시그니처 GENS option (+150,000)
  baseColor: 'BROWN',           // 'BROWN' | 'GRAY' | 'GREEN' — only when signatureGens=true

  // ── v3 아바타 피팅 스튜디오 ─────────────────────────────
  // Fitting parameters (mm/deg, UI-friendly units — converted at use sites)
  v3fit: {
    vd: 12,          // 정점간거리 표시값 (물리 = 표시 − 5; 표준 표시 12 = 물리 7)
    panto: 8,        // 경사각 (0~15°, 표준 8~12)
    wrap: 5,         // 안면각 (0~15°, 표준 ~5)
    pdErr: 0,        // PD 오차 (좌 = 아바타 왼쪽/+x; 실제 PD는 단안 측정)
    pdErr_R: 0,      // 우(아바타 오른쪽/−x) — pdErrAsym일 때만 사용
    pdErrAsym: 0,    // 단안(좌우 개별) 모드
    oh: 0,           // 피팅 높이 오프셋 (-4~+4mm)
    bSize: 26,       // 렌즈 B치수 (10~40mm, 표준 26)
    shape: 'square', // 'square' | 'round' | 'boston' | 'aviator'
    headPitch: 0,    // 고개 끄덕임 (deg, + = 숙임/아래 — group.rotation.x 기준. 데모/타깃은 별도 캘리브레이션)
    slip: 0,         // 흘러내림 누적(mm, slipSim 전용 — 광학은 안 읽음. 리셋 시 v3fit 통째 교체로 자동 0)
  },
  // View toggles
  v3view: {
    zones: { distance: false, intermediate: false, near: false },
    targets: false,
  },
  // 프레임 피팅 커스텀 (광학 요소와 무관 — 순수 물리 조정, 존에 영향 없음)
  // 값은 측정된 기본 피팅 대비 오프셋 (안전한 베이스라인 유지)
  v3frame: {
    templeAngle: 0,   // 다리 경사각 오프셋 (-20~+20°, + = 끝이 아래로)
    templeLen: 0,     // 다리 길이 오프셋 (-20~+20mm, − = 귀 앞에서 끝남)
    templeGap: 0,     // 얼굴 옆면 간격 (0~+10mm, + = 다리가 벌어짐)
    templeBend: 20,   // 다리 몸통 밴딩 (0~90°, 0 = 직선, 90 = 머리 곡률 밀착)
    earTipAngle: 118, // 귀팁각(귀 꺾임부) (90~180°, 180 = 직선, 90 = 수직)
    earConverge: 0,   // 귀모임각 (드롭 옆기울기, + = 안쪽/모아짐, − = 바깥/벌어짐)
    endpiece: 0,      // 엔드피스(힌지) 높이 오프셋 (-6~+6mm)
    // 좌우 비대칭 (base = 왼쪽, _R = 오른쪽, Asym = 개별 조정 토글 0/1)
    templeAngle_R: 0,   templeAngleAsym: 0,
    templeGap_R: 0,     templeGapAsym: 0,
    templeBend_R: 20,   templeBendAsym: 0,
    earTipAngle_R: 118, earTipAngleAsym: 0,
    earConverge_R: 0,   earConvergeAsym: 0,
    // 코받침(코패드)
    padOn: 1,         // 상시 1 — 표시 토글 UI 제거(2026-07-25). 코받침은 흘러내림
                      // 지지의 핵심 축이라 끌 수 있으면 안 된다(slipSim 참조).
    padSpacing: 0,    // 좌우 간격 (mm, + = 넓게)
    padVertical: 0,   // 상하 위치 (mm, + = 위)
    padArm: 0,        // 코받침 전후 표시값 (물리 = 표시 − 10; 표준 표시 0 = 물리 -10)
  },
  // 두상 조정 (얼굴 메시 변형 — 광학 무관, 시각/피팅 물리). 귀는 좌우 대칭.
  v3head: {
    earY: 7,       // 양쪽 귀 상하 (mm, + = 위) — base=왼쪽. 기본 7mm (사용자 캘리브레이션)
    earZ: 0,       // 양쪽 귀 앞뒤 (mm, + = 앞/눈쪽, − = 뒤/뒤통수) — base=왼쪽
    earY_R: 7, earYAsym: 0,   // 좌우 비대칭 (_R = 오른쪽)
    earZ_R: 0, earZAsym: 0,
    faceWidth: 0,     // 옆통수(측두부) 폭 (mm, + = 넓게) — base=왼쪽
    faceWidth_R: 0, faceWidthAsym: 0,   // 좌우 비대칭 (_R = 오른쪽)
    noseBridge: 0, // 콧대 표시값 (물리 = 표시 − 4; 표준 표시 0 = 물리 -4)
  },

  // iPad tab navigation
  activeTab: 'simulator', // 'simulator' | 'compare'
  settingsOpen: false,

  // Lens stage mode (v2 design — 4 modes for the main visualization)
  lensMode: '2d',          // '2d' | '3d' | 'ba' | 'ar'

  // Prescription — shared across all sections (same patient)
  od: { sphere: -2.00, cylinder: 0, axis: 0 },
  os: { sphere: -2.00, cylinder: 0, axis: 0 },
};

export const state = JSON.parse(JSON.stringify(initial));

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function update(patch) {
  applyPatch(state, patch);
  _scheduleNotify();
}

export function reset() {
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, JSON.parse(JSON.stringify(initial)));
  _scheduleNotify();
}

// v3 피팅 조정 전체를 초기 기본값으로 복귀 — 광학 피팅(v3fit)·프레임 커스텀
// (v3frame)·두상 조정(v3head). 처방(grade/add/corridor)·시야존·카메라는 유지.
export function resetFitting() {
  const init = JSON.parse(JSON.stringify(initial));
  state.v3fit = init.v3fit;
  state.v3frame = init.v3frame;
  state.v3head = init.v3head;
  _scheduleNotify();
}

function applyPatch(target, patch) {
  for (const k in patch) {
    const v = patch[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {};
      applyPatch(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

// Helper to read just the prescription for a given eye.
export function getRx(eye) {
  return JSON.parse(JSON.stringify(state[eye === 'OS' ? 'os' : 'od']));
}
