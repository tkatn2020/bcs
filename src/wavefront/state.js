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
    vd: 12,          // 정점간거리 (8~16mm, 표준 12)
    panto: 8,        // 경사각 (0~15°, 표준 8~12)
    wrap: 5,         // 안면각 (0~15°, 표준 ~5)
    pdErr: 0,        // PD 오차 (-4~+4mm)
    oh: 0,           // 피팅 높이 오프셋 (-4~+4mm)
    bSize: 31,       // 렌즈 B치수 (26~40mm)
    shape: 'square', // 'square' | 'round' | 'boston' | 'aviator'
    headPitch: 0,    // 고개 숙임 (deg, − = 숙임)
  },
  // View toggles
  v3view: {
    zones: { distance: true, intermediate: true, near: true },
    targets: false,
  },
  // 프레임 피팅 커스텀 (광학 요소와 무관 — 순수 물리 조정, 존에 영향 없음)
  // 값은 측정된 기본 피팅 대비 오프셋 (안전한 베이스라인 유지)
  v3frame: {
    templeAngle: 0,   // 다리 경사각 오프셋 (-20~+20°, + = 끝이 아래로)
    templeLen: 0,     // 다리 길이 오프셋 (-20~+20mm, − = 귀 앞에서 끝남)
    templeGap: 0,     // 얼굴 옆면 간격 (0~+10mm, + = 다리가 벌어짐)
    templeBend: 20,   // 다리 몸통 밴딩 (0~90°, 0 = 직선, 90 = 머리 곡률 밀착)
    endpiece: 0,      // 엔드피스(힌지) 높이 오프셋 (-6~+6mm)
  },
  // 두상 조정 (얼굴 메시 변형 — 광학 무관, 시각/피팅 물리). 귀는 좌우 대칭.
  v3head: {
    earY: 0,       // 양쪽 귀 상하 (mm, + = 위) — 좌우 동기
    earZ: 0,       // 양쪽 귀 앞뒤 (mm, + = 앞/눈쪽, − = 뒤/뒤통수) — 좌우 동기
    noseBridge: 0, // 콧대 (mm, + = 돌출·두꺼움 / − = 낮음·얇음)
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
