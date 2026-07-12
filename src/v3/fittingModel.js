// v3 Fitting model — qualitative zone math (PRD §8.2).
// Pure functions: state → per-zone cone spec { h, v, pitch, len } + eyeYawDeg.
//
// Directionally clinical (research anchors, PRD §8.1) — magnitudes for
// education, calibration reviewed by Joel before v1.0.
//   · grade → zone width via grades.js clearZoneScale (BP30 = 1.15 baseline)
//   · ADD   → Minkwitz: corridor width ∝ corridorLen / ADD
//   · VD    → 시야각 ∝ 1/(눈회전점~렌즈 거리): 0mm(눈 밀착)까지 확대 허용
//   · panto → 표준(8~12°) 밖 양방향 페널티. 음수(retroscopic)는 근용 악화 + 원용 수차
//   · wrap  → 5° 기준 양방향 이탈 페널티 (−15° 역랩까지)
//   · PD err→ corridor 축소 + 좌우 콘 발산(양안 겹침 손실)
//   · OH    → 존 지도 수직 이동 + 근용 잘림
//   · 프레임 크기(B) → 렌즈 = 시야의 개구(aperture):
//       원거리·근거리 시야는 프레임에 비례해 커지고/잘리고,
//       corridor 폭은 누진면 속성이라 프레임 크기와 무관 (핵심 교육 포인트)

import { getGrade } from '../optics/grades.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const rad2deg = (r) => (r * 180) / Math.PI;

export const STANDARD_FIT = {
  vd: 12, panto: 8, wrap: 5, pdErr: 0, oh: 0, bSize: 31, shape: 'square', headPitch: 0,
};

// Baseline half-angles at BP30 · ADD +2.00 · corridor 12mm · standard fit
const BASE = {
  distance:     { h: 38, v: 24, pitch: -2,  len: 1.5 },
  intermediate: { h: 11, v: 8,  pitch: -15, len: 0.68 },
  near:         { h: 15, v: 10, pitch: -33, len: 0.42 },
};

// Frame size shared by the glasses builder (single source).
export const FRAME_BASE = { lensW: 0.046, lensH: 0.031, bSize: 31 };

export function computeZones(s) {
  const g = getGrade(s.grade);
  const f = { ...STANDARD_FIT, ...(s.v3fit || {}) };
  const gradeScale = g.clearZoneScale / 1.15;
  const add = clamp(s.add ?? 2.0, 0.75, 3.5);
  const corr = s.corridor ?? 12;

  // ── 렌즈 구성 요인 ──
  const mink = clamp((corr / 12) * (2.0 / add), 0.45, 1.7);       // Minkwitz
  const nearAdd = clamp(Math.sqrt(2.0 / add), 0.6, 1.35);
  const nearPitchShift = (corr - 12) * 1.2;                        // deg/mm

  // ── 피팅 요인 ──
  // VD: 시야각 ∝ 1/(VD + 눈회전점 13mm). 0mm(눈 밀착)에서 최대 확대.
  const vdFactor = clamp(25 / (f.vd + 13), 0.75, 1.9);
  const pantoLow = Math.max(0, 8 - f.panto);                       // 부족/음수 → 근용 손실
  const pantoHigh = Math.max(0, f.panto - 12);                     // 과다 → 원용 손실
  const nearFit = clamp(1 - pantoLow * 0.04, 0.35, 1);
  const distFit = clamp(1 - pantoHigh * 0.035, 0.7, 1)
                * clamp(1 + Math.min(0, f.panto) * 0.02, 0.72, 1); // retroscopic 원용 수차
  const wrapDev = Math.max(0, Math.abs(f.wrap - 5) - 2);           // ±2° 허용, −15°까지
  const wrapFactor = clamp(1 - wrapDev * 0.03, 0.5, 1);
  const pdCorridor = clamp(1 - Math.abs(f.pdErr) * 0.13, 0.45, 1); // 1mm ≈ 폭 2mm 손실
  const pitchShift = f.oh * 2.0;                                   // deg/mm
  const nearRoom = clamp(1 + (f.oh + (f.bSize - 31) / 2) * 0.10, 0.3, 1.12);

  // ── 프레임 크기 = 개구(aperture) ──
  // 렌즈 전체가 비례 스케일: 원거리/근거리 시야가 프레임 크기를 따라 변함.
  const frameScale = f.bSize / FRAME_BASE.bSize;
  const frameFactor = clamp(Math.pow(frameScale, 0.85), 0.65, 1.3);
  // 기하 개구 상한: 렌즈 반폭 / (VD + 13mm) — 큰 VD × 작은 렌즈일수록 조임
  const lensWm = FRAME_BASE.lensW * frameScale;
  const lensHm = FRAME_BASE.lensH * frameScale;
  const eyeDist = (f.vd + 13) / 1000;
  const apertureH = rad2deg(Math.atan((lensWm / 2) / eyeDist));
  const apertureV = rad2deg(Math.atan((lensHm / 2) / eyeDist)) + 12; // 존 지도 수직 여유

  const distance = {
    h: Math.min(BASE.distance.h * (0.45 + 0.55 * gradeScale) * vdFactor * distFit * wrapFactor * frameFactor, apertureH * 0.95),
    v: Math.min(BASE.distance.v * vdFactor * distFit * frameFactor, apertureV),
    pitch: BASE.distance.pitch + pitchShift * 0.35,
    len: BASE.distance.len,
  };
  const intermediate = {
    // corridor 폭은 프레임 크기와 무관 (Minkwitz — 누진면 속성)
    h: BASE.intermediate.h * gradeScale * mink * vdFactor * wrapFactor * pdCorridor,
    v: BASE.intermediate.v * (0.7 + 0.3 * mink) * vdFactor,
    pitch: BASE.intermediate.pitch - nearPitchShift * 0.5 + pitchShift,
    len: BASE.intermediate.len,
  };
  const near = {
    h: Math.min(BASE.near.h * gradeScale * nearAdd * vdFactor * nearFit * nearRoom * pdCorridor * Math.sqrt(frameFactor), apertureH * 0.85),
    v: BASE.near.v * (0.75 + 0.25 * nearAdd) * nearRoom,
    pitch: BASE.near.pitch - nearPitchShift + pitchShift,
    len: BASE.near.len * clamp(nearRoom + 0.15, 0.5, 1),
  };

  // ── 주변부 왜곡(비점수차) 지표 — 프레임 크기 트레이드오프 (리서치 §14.1) ──
  //   area    : 착용자 시야에 노출되는 왜곡 날개의 면적 (큰 프레임일수록↑,
  //             작은 프레임은 잘려나가 ↓ — "작은 프레임이 왜곡을 줄인다")
  //   density : 왜곡 구배의 급함/밀집도. Minkwitz(Add÷corridor) × 프레임 반비례
  //             (작은 프레임 → short-corridor 강제 → 밀도↑, 남은 통로 좁아짐)
  // 두 지표를 렌즈 존 맵(베이지 날개)의 크기·짙기·통로 간격에 매핑한다.
  const minkGrad = (add / corr);                          // 도수변화율 (D/mm)
  const distortion = {
    area: clamp(frameScale * 1.0, 0.55, 1.4),             // 큰 프레임 = 더 노출
    density: clamp((minkGrad / (2.0 / 12)) / frameScale, 0.5, 2.2), // 작은 프레임 = 더 밀집
  };

  return {
    distance, intermediate, near, distortion,
    // PD 오차 → 좌우 콘이 바깥으로 벌어져 양안 겹침(additive 밝은 영역) 축소
    eyeYawDeg: Math.abs(f.pdErr) * 1.4,
  };
}
