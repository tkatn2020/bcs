// v3 피팅 스냅샷 — 피팅 상태를 저장·불러오기·표시하는 순수 정의 (import 없음).
//
// 브리즘 임상 컨퍼런스 앱이 이 파일을 그대로 복사해 서버 검사·값 표·바뀐 값 목록에 쓴다
// (그쪽 scripts/sync-fitting-studio.mjs). 그래서 three·DOM·다른 모듈을 import 하지 않는다.
// 키·기본값·뜻을 바꾸면 SNAPSHOT_VERSION 을 올리고, 예전 스냅샷을 읽는 규칙을 남긴다.
//
// ⚠️ 좌우: 저장 키는 기본 키 = 좌(아바타 왼쪽 · +x · OS), `_R` = 우(아바타 오른쪽 · −x · OD) —
//   state.js 주석·컨트롤 패널의 「우 …」 줄과 같다. 안쪽 측정 이름 earR·eyeR 만 +x 라 반대로 읽히니
//   섞지 말 것(topics/bcs-v3-fitting 좌표계 함정).
// ⚠️ 값: v3fit 의 vd·oh·panto 는 라이트스루 장부 원값이다(코받침·다리·귀·콧대·흘러내림 연동분 포함,
//   미클램프). 저장할 때 반올림·클램프하지 않고, 불러올 때는 resetFitting() 뒤 통째로 쓴다 — 컨트롤
//   경로(padWrite 등)로 다시 재생하면 연동이 두 번 들어간다. 화면 표시만 스튜디오와 같은 규칙
//   (물리 한계로 자르고 0.1 단위, 좌우 따로가 꺼져 있으면 `_R` 대신 기본 키)을 쓴다.

export const SNAPSHOT_VERSION = 1;

// 값 표·바뀐 값 목록의 묶음 순서
export const GROUPS = [
  { id: 'lens', label: '렌즈 설계' },
  { id: 'fit', label: '착용 위치' },
  { id: 'frame', label: '프레임·다리' },
  { id: 'pad', label: '코받침' },
  { id: 'head', label: '두상' },
];

// 저장 키 정의 — 스튜디오 패널(controls.js SLIDERS·FRAME_SLIDERS·PAD_SLIDERS·HEAD_SLIDERS)과 같은 이름·단위.
//   ns    : 저장 위치 (lens = 최상위 grade·add·corridor · fit = v3fit · frame = v3frame · head = v3head)
//   std   : 기본값(처음 상태·표준 피팅) — embed.js 가 로드 때 실제 상태와 대조한다
//   limit : 물리 한계 — 장부는 미클램프, 표시·광학에서만 자른다(fittingModel FIT_LIMITS)
//   asym  : 좌우 따로 조정 가능 → `${key}_R`·`${key}Asym` 키가 함께 있다
//   kind  : num(기본) · int · enum · flag(0/1) · hidden(값 표에 안 보이는 내부 값)
export const FIELDS = [
  { key: 'grade', ns: 'lens', group: 'lens', label: '렌즈 등급', kind: 'int', std: 3, min: 1, max: 5 },
  { key: 'add', ns: 'lens', group: 'lens', label: 'ADD', unit: 'D', std: 2.0, min: 0.75, max: 3.5 },
  { key: 'corridor', ns: 'lens', group: 'lens', label: '누진대', unit: 'mm', kind: 'enum', std: 12, options: [10, 12, 14] },

  { key: 'vd', ns: 'fit', group: 'fit', label: '정점간거리', unit: 'mm', std: 12, min: 5, max: 20, limit: [5, 20] },
  { key: 'panto', ns: 'fit', group: 'fit', label: '경사각', unit: '°', std: 8, min: -15, max: 15, limit: [-15, 15] },
  { key: 'wrap', ns: 'fit', group: 'fit', label: '안면각', unit: '°', std: 5, min: -15, max: 15 },
  { key: 'pdErr', ns: 'fit', group: 'fit', label: 'PD 오차', unit: 'mm', std: 0, min: -10, max: 10, asym: true },
  { key: 'oh', ns: 'fit', group: 'fit', label: 'OH 높이', unit: 'mm', std: 0, min: -8, max: 8, limit: [-8, 8] },
  { key: 'bSize', ns: 'fit', group: 'fit', label: '프레임 크기', unit: 'mm', std: 26, min: 10, max: 40 },
  { key: 'shape', ns: 'fit', group: 'fit', label: '프레임 형상', kind: 'enum', std: 'square',
    options: ['square', 'round', 'boston', 'aviator'],
    names: { square: '사각', round: '원형', boston: '보스턴', aviator: '애비에이터' } },
  { key: 'finish', ns: 'fit', group: 'fit', label: '프레임 마감', kind: 'enum', std: 'silver',
    options: ['silver', 'gold', 'black', 'tortoise', 'matte'],
    names: { silver: '실버', gold: '골드', black: '블랙', tortoise: '토터스', matte: '무광' } },
  { key: 'headPitch', ns: 'fit', group: 'fit', label: '고개 숙임', unit: '°', std: 0, min: -12, max: 28 },
  { key: 'headRoll', ns: 'fit', group: 'fit', label: '머리 기울임', unit: '°', std: 0, min: -15, max: 15 },
  { key: 'slip', ns: 'fit', group: 'fit', label: '흘러내림', unit: 'mm', std: 0, min: 0, max: 8 },

  { key: 'templeAngle', ns: 'frame', group: 'frame', label: '다리 경사각', unit: '°', std: 0, min: -6, max: 6, asym: true },
  { key: 'templeLen', ns: 'frame', group: 'frame', label: '다리 길이', unit: 'mm', std: 0, min: -20, max: 20 },
  { key: 'templeGap', ns: 'frame', group: 'frame', label: '옆면 간격', unit: 'mm', std: 0, min: -10, max: 10, asym: true },
  { key: 'templeBend', ns: 'frame', group: 'frame', label: '다리 밴딩', unit: '°', std: 20, min: 0, max: 90, asym: true },
  { key: 'earTipAngle', ns: 'frame', group: 'frame', label: '귀팁각', unit: '°', std: 118, min: 90, max: 180, asym: true },
  { key: 'earConverge', ns: 'frame', group: 'frame', label: '귀모임각', unit: '°', std: 0, min: -25, max: 25, asym: true },
  { key: 'endpiece', ns: 'frame', group: 'frame', label: '엔드피스 높이', unit: 'mm', std: 0, min: -6, max: 6 },
  { key: 'padOn', ns: 'frame', group: 'pad', label: '코받침', kind: 'hidden', std: 1 },
  { key: 'padSpacing', ns: 'frame', group: 'pad', label: '좌우 간격', unit: 'mm', std: 0, min: -4, max: 10 },
  { key: 'padVertical', ns: 'frame', group: 'pad', label: '상하 위치', unit: 'mm', std: 0, min: -10, max: 10 },
  { key: 'padArm', ns: 'frame', group: 'pad', label: '전후', unit: 'mm', std: 0, min: -10, max: 10 },

  { key: 'earY', ns: 'head', group: 'head', label: '귀 상하', unit: 'mm', std: 7, min: -10, max: 25, asym: true },
  { key: 'earZ', ns: 'head', group: 'head', label: '귀 앞뒤', unit: 'mm', std: 0, min: -10, max: 10, asym: true },
  { key: 'faceWidth', ns: 'head', group: 'head', label: '옆통수 폭', unit: 'mm', std: 0, min: -6, max: 10, asym: true },
  { key: 'noseBridge', ns: 'head', group: 'head', label: '콧대', unit: 'mm', std: 0, min: -8, max: 8 },
];

export const ZONES = ['distance', 'intermediate', 'near'];

// 스냅샷 안의 칸 이름 ↔ 스튜디오 상태 이름
const STATE_NS = { fit: 'v3fit', frame: 'v3frame', head: 'v3head' };

// 서버 검사의 넉넉한 한계 — 장부(VD·OH·경사각 ±40/±60, controls.js LEDGER)에 흘러내림(8mm)이
// 더해져도 넘지 않을 만큼. 이 밖이면 자르지 않고 거절한다.
const NUM_BOUND = 200;

/** 한 칸이 저장 객체에 갖는 키 목록 (좌우 따로면 3개) */
export function keysOf(f) {
  return f.asym ? [f.key, `${f.key}_R`, `${f.key}Asym`] : [f.key];
}

/** 한 칸의 기본값 (좌우 따로면 `_R` 은 기본 키와 같고 Asym 은 0) */
export function defaultsOf(f) {
  return f.asym ? { [f.key]: f.std, [`${f.key}_R`]: f.std, [`${f.key}Asym`]: 0 } : { [f.key]: f.std };
}

/** 스냅샷 칸(lens·fit·frame·head)별 기본값 */
export function defaultSnapshot() {
  const out = { v: SNAPSHOT_VERSION, lens: {}, fit: {}, frame: {}, head: {}, zones: {} };
  for (const f of FIELDS) Object.assign(out[f.ns], defaultsOf(f));
  for (const z of ZONES) out.zones[z] = false;
  return out;
}

/**
 * 스튜디오 상태 → 스냅샷 v1. 아는 키만 원값 그대로 담는다(반올림·클램프 없음).
 * fitDefaults = fittingModel STANDARD_FIT — 처음 v3fit 에 finish·headRoll 이 없어서 그 기본을 채운다.
 */
export function toSnapshot(s, fitDefaults = {}) {
  const base = defaultSnapshot();
  const src = {
    lens: { grade: s.grade, add: s.add, corridor: s.corridor },
    fit: { ...fitDefaults, ...(s.v3fit || {}) },
    frame: s.v3frame || {},
    head: s.v3head || {},
  };
  for (const f of FIELDS) {
    for (const k of keysOf(f)) {
      const v = src[f.ns][k];
      if (v !== undefined && v !== null) base[f.ns][k] = v;
    }
  }
  for (const z of ZONES) base.zones[z] = !!s.v3view?.zones?.[z];
  return base;
}

/**
 * 스냅샷 → 스튜디오 상태 패치(통째로). 빠진 키는 기본값으로 채운다 —
 * earConverge* 처럼 빠지면 다리 기하가 NaN 이 되는 키가 있다.
 * 쓰는 쪽: resetFitting() 뒤 update(fromSnapshot(data)).
 */
export function fromSnapshot(data) {
  const d = defaultSnapshot();
  const merged = {
    lens: { ...d.lens, ...(data?.lens || {}) },
    fit: { ...d.fit, ...(data?.fit || {}) },
    frame: { ...d.frame, ...(data?.frame || {}) },
    head: { ...d.head, ...(data?.head || {}) },
  };
  const zones = {};
  for (const z of ZONES) zones[z] = !!data?.zones?.[z];
  return {
    grade: merged.lens.grade,
    add: merged.lens.add,
    corridor: merged.lens.corridor,
    v3fit: merged.fit,
    v3frame: merged.frame,
    v3head: merged.head,
    v3view: { zones },
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 값 하나 검사 — 맞으면 null, 아니면 이유 */
function checkValue(f, k, v) {
  if (k.endsWith('Asym')) return v === 0 || v === 1 ? null : `${k}: 0 또는 1`;
  const kind = f.kind || 'num';
  if (kind === 'enum') return f.options.includes(v) ? null : `${k}: 목록 밖`;
  if (kind === 'hidden') return v === 0 || v === 1 ? null : `${k}: 0 또는 1`;
  if (!isNum(v)) return `${k}: 숫자가 아님`;
  if (kind === 'int') return Number.isInteger(v) && v >= f.min && v <= f.max ? null : `${k}: 범위 밖`;
  if (f.ns === 'lens') return v >= f.min && v <= f.max ? null : `${k}: 범위 밖`;
  return Math.abs(v) <= NUM_BOUND ? null : `${k}: 범위 밖`;
}

/**
 * 스냅샷 검사·정리 — 모르는 키·잘못된 값은 거절(자르지 않는다), 빠진 키는 기본값으로 채운다.
 * 두 번 거쳐도 같다. 반환: { ok: true, data } | { ok: false, error }
 */
export function cleanSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: '객체가 아님' };
  if (input.v !== SNAPSHOT_VERSION) return { ok: false, error: '버전이 다름' };
  const allowedTop = new Set(['v', 'lens', 'fit', 'frame', 'head', 'zones']);
  for (const k of Object.keys(input)) if (!allowedTop.has(k)) return { ok: false, error: `모르는 칸: ${k}` };
  const out = defaultSnapshot();
  for (const ns of ['lens', 'fit', 'frame', 'head']) {
    const src = input[ns];
    if (src === undefined) continue;
    if (!src || typeof src !== 'object' || Array.isArray(src)) return { ok: false, error: `${ns}: 객체가 아님` };
    const known = new Map();
    for (const f of FIELDS) if (f.ns === ns) for (const k of keysOf(f)) known.set(k, f);
    for (const [k, v] of Object.entries(src)) {
      const f = known.get(k);
      if (!f) return { ok: false, error: `모르는 키: ${ns}.${k}` };
      const err = checkValue(f, k, v);
      if (err) return { ok: false, error: err };
      out[ns][k] = v;
    }
  }
  if (input.zones !== undefined) {
    const z = input.zones;
    if (!z || typeof z !== 'object' || Array.isArray(z)) return { ok: false, error: 'zones: 객체가 아님' };
    for (const [k, v] of Object.entries(z)) {
      if (!ZONES.includes(k)) return { ok: false, error: `모르는 시야존: ${k}` };
      if (typeof v !== 'boolean') return { ok: false, error: `zones.${k}: 참/거짓이 아님` };
      out.zones[k] = v;
    }
  }
  return { ok: true, data: out };
}

// ── 표시 규칙 (스튜디오 패널과 같은 숫자) ──
const round1 = (v) => Math.round(v * 10) / 10;
const clampTo = (v, lim) => (lim ? Math.max(lim[0], Math.min(lim[1], v)) : v);

/** 표시용 값 — 물리 한계로 자르고 0.1 단위(controls.js refresh 와 같다) */
export function displayValue(f, v) {
  const kind = f.kind || 'num';
  if (kind === 'enum' || kind === 'hidden') return v;
  if (f.key === 'add') return Math.round(v * 100) / 100;
  return round1(clampTo(v, f.limit));
}

/** 표시 글자 — 「12.5mm」「8°」「+2.00」「3단계」「원형」 */
export function formatValue(f, v) {
  const kind = f.kind || 'num';
  if (kind === 'enum') return f.names ? (f.names[v] ?? String(v)) : `${v}${f.unit || ''}`;
  if (f.key === 'grade') return `${v}단계`;
  if (f.key === 'add') return `+${Number(v).toFixed(2)}`;
  return `${displayValue(f, v)}${f.unit || ''}`;
}

/** 좌우 값 — 좌우 따로가 꺼져 있으면 우 = 좌(스튜디오가 실제로 쓰는 값, app.js glassesParams) */
export function sidesOf(data, f) {
  const src = data?.[f.ns] || {};
  const l = src[f.key] ?? f.std;
  if (!f.asym) return { asym: false, l, r: l };
  const on = !!src[`${f.key}Asym`];
  return { asym: on, l, r: on ? (src[`${f.key}_R`] ?? l) : l };
}

/**
 * 값 표 행 — 보이는 칸만, 좌우 따로면 「좌 …」「우 …」 두 줄.
 * 행: { id, group, label, text, isStd }
 */
export function valueRows(data) {
  const rows = [];
  for (const f of FIELDS) {
    if (f.kind === 'hidden') continue;
    const s = sidesOf(data, f);
    const stdText = formatValue(f, f.std);
    if (s.asym) {
      rows.push({ id: f.key, group: f.group, label: `좌 ${f.label}`, text: formatValue(f, s.l), isStd: formatValue(f, s.l) === stdText });
      rows.push({ id: `${f.key}_R`, group: f.group, label: `우 ${f.label}`, text: formatValue(f, s.r), isStd: formatValue(f, s.r) === stdText });
    } else {
      const text = formatValue(f, s.l);
      rows.push({ id: f.key, group: f.group, label: f.label, text, isStd: text === stdText });
    }
  }
  return rows;
}

/**
 * 바뀐 값 목록 — a(전) → b(후). 표시 글자가 다른 칸만, 한쪽이라도 좌우 따로면 좌·우를 나눠 비교한다.
 * 행: { id, group, label, from, to }
 */
export function diffRows(a, b) {
  const rows = [];
  for (const f of FIELDS) {
    if (f.kind === 'hidden') continue;
    const sa = sidesOf(a, f), sb = sidesOf(b, f);
    if (sa.asym || sb.asym) {
      for (const [side, name] of [['l', '좌'], ['r', '우']]) {
        const from = formatValue(f, sa[side]), to = formatValue(f, sb[side]);
        if (from !== to) rows.push({ id: side === 'l' ? f.key : `${f.key}_R`, group: f.group, label: `${name} ${f.label}`, from, to });
      }
    } else {
      const from = formatValue(f, sa.l), to = formatValue(f, sb.l);
      if (from !== to) rows.push({ id: f.key, group: f.group, label: f.label, from, to });
    }
  }
  return rows;
}

// ── HUD 지표 (app.js mountEduHud 가 쓰는 정의 — 컨퍼런스 앱도 같은 이름·단위로 보여 준다) ──
// 게이지 정규화 범위 = 모델 관측 범위(교육 케이스 전수 기준) — 표시 전용.
// better: true=클수록 좋음 / false=작을수록 좋음 / null=양면적(중립 회색).
export const HUD_METRICS = [
  // 단안 PD로 좌우가 갈리면 평균 대신 '좌/우'를 그대로 보여준다 — 어느 눈이
  // 얼마나 어긋났는지가 단안 처방의 핵심 정보라 평균으로 뭉개면 안 된다.
  { key: 'dec', label: '광학중심 편심', unit: 'mm', min: 0, max: 20, better: false, zone: null,
    val: (s) => s.decMm ?? 0, bar: (s) => Math.abs(s.decMm ?? 0),
    fmt: (s) => (s.decL !== undefined && Math.abs(s.decL - s.decR) > 0.01)
      ? `좌 ${s.decL.toFixed(1)} / 우 ${s.decR.toFixed(1)}mm` : null,
    delta: (s, b) => Math.abs(s.decMm ?? 0) - Math.abs(b.decMm ?? 0) },
  { key: 'distance', label: '원용 시야', unit: '°', min: 30, max: 100, better: true, zone: 'distance', val: (s) => s.distance.h * 2 },
  { key: 'intermediate', label: '중간 시야', unit: '°', min: 5, max: 35, better: true, zone: 'intermediate', val: (s) => s.intermediate.h * 2 },
  { key: 'near', label: '근용 시야', unit: '°', min: 3, max: 45, better: true, zone: 'near', val: (s) => s.near.h * 2 },
  { key: 'nearPitch', label: '근용 시선 하강', unit: '°', min: 20, max: 45, better: null, zone: 'near', val: (s) => Math.abs(s.near.pitch) },
  { key: 'exposure', label: '왜곡 노출', unit: '%', min: 30, max: 250, better: false, zone: null, val: (s) => (s.distortion.exposure ?? 1) * 100 },
];

const round2 = (v) => Math.round(v * 100) / 100;

/** computeZones 결과 → 저장용 지표 값(평평한 숫자, 0.01 단위). dec 의 좌우는 decL·decR */
export function metricValues(spec) {
  const out = {};
  for (const m of HUD_METRICS) out[m.key] = round2(m.val(spec));
  out.decL = round2(spec.decL ?? spec.decMm ?? 0);
  out.decR = round2(spec.decR ?? spec.decMm ?? 0);
  return out;
}

const METRIC_KEYS = [...HUD_METRICS.map((m) => m.key), 'decL', 'decR'];

/** 저장된 지표 검사 — 아는 키·유한한 숫자만 */
export function cleanMetrics(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: '지표가 객체가 아님' };
  const out = {};
  for (const k of METRIC_KEYS) {
    const v = input[k];
    if (!isNum(v) || Math.abs(v) > 1000) return { ok: false, error: `지표 ${k}: 숫자가 아님` };
    out[k] = v;
  }
  for (const k of Object.keys(input)) if (!METRIC_KEYS.includes(k)) return { ok: false, error: `모르는 지표: ${k}` };
  return { ok: true, data: out };
}

/**
 * 지표 행 — HUD 와 같은 글자·Δ·색 판단. now·std = metricValues 결과.
 * 행: { key, label, text, delta (null = 차이 없음), good (true/false/null) }
 */
export function metricRows(now, std) {
  return HUD_METRICS.map((m) => {
    const cur = now[m.key], base = std[m.key];
    const delta = m.key === 'dec' ? Math.abs(cur) - Math.abs(base) : cur - base;
    const split = m.key === 'dec' && Math.abs(now.decL - now.decR) > 0.01;
    const text = split ? `좌 ${now.decL.toFixed(1)} / 우 ${now.decR.toFixed(1)}mm` : `${cur.toFixed(1)}${m.unit}`;
    const shown = Math.abs(delta) < 0.05 ? null : Math.round(delta * 10) / 10;
    const good = shown === null || m.better === null ? null : (delta > 0) === m.better;
    return { key: m.key, label: m.label, text, delta: shown, good };
  });
}

// ── 캡처 시점 (화면 카메라 프리셋 CAM_PRESETS 를 바탕으로 한 캡처 전용 상수) ──
// 화면 프리셋을 나중에 바꿔도 저장 사진의 구도는 그대로여야 케이스·답글끼리 비교된다.
// 측면 = 카메라 +x = 아바타 왼쪽(OS) 면. side_R = 그 거울(카메라 −x = 아바타 오른쪽·OD 면) — 좌우 다리·귀·코받침을
// 함께 보이려고 더했다(컨퍼런스 앱 「이 피팅 붙이기」 고정 4장, 2026-10-16). 이름은 저장 키와 같은 규칙(_R = 오른쪽).
// 화면 프리셋보다 가깝게 — 4:3 사진에서 안경·귀·콧대가 크게 보이도록(머리 전체는 들어온다).
export const CAPTURE_VIEWS = [
  { id: 'front', label: '정면', pos: [0, 0.005, 0.40], tgt: [0, -0.005, 0] },
  { id: 'side', label: '측면(왼쪽)', pos: [0.40, 0.01, 0.02], tgt: [0, -0.005, -0.01] },
  { id: 'side_R', label: '측면(오른쪽)', pos: [-0.40, 0.01, 0.02], tgt: [0, -0.005, -0.01] },
  { id: 'top', label: '위', pos: [0, 0.32, 0.33], tgt: [0, -0.02, 0.05] },
];
export const CAPTURE_SIZE = { width: 1200, height: 900, freeLong: 1600, quality: 0.85 };
