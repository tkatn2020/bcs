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
//   · 편심(decMm) → corridor 축소 + 좌우 콘 발산(양안 겹침 손실).
//     이 앱은 '가공 전' 기준(사용자 결정 2026-07-18): 렌즈 광학중심은 박스
//     중앙에 있고, 프레임이 커지면 중앙이 동공 밖으로 벌어진다 — 그 프레임
//     유래 편심을 PD 오차와 합산해 그대로 광학에 반영한다(인셋 가공으로
//     이미 보정됐다는 전제 폐기). PD·OH를 동공에 맞추면 회복되는 게 교육 포인트.
//   · OH    → 존 지도 수직 이동 + 근용 잘림
//   · 프레임 크기(B) → 렌즈 = 시야의 개구(aperture):
//       원거리·근거리 시야는 프레임에 비례해 커지고/잘리고,
//       corridor 폭은 누진면 속성이라 프레임 크기와 무관 (핵심 교육 포인트)

import { getGrade } from '../optics/grades.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const rad2deg = (r) => (r * 180) / Math.PI;

export const STANDARD_FIT = {
  vd: 12, panto: 8, wrap: 5, pdErr: 0, oh: 0, bSize: 26, shape: 'square', headPitch: 0, headRoll: 0,
};

// Baseline half-angles at BP30 · ADD +2.00 · corridor 12mm · standard fit
const BASE = {
  distance:     { h: 38, v: 24, pitch: -2,  len: 1.5 },
  intermediate: { h: 11, v: 8,  pitch: -15, len: 0.68 },
  near:         { h: 15, v: 10, pitch: -33, len: 0.42 },
};

// 존 모델의 프레임 크기 기준(중립 100%) — 표준 피팅 bSize=26에 맞춤(A1: 26 통일).
// 렌즈 치수는 bSize 26일 때 실제 렌더값(app.js 0.046·0.031 × 26/31)이라 개구
// (aperture) 계산이 렌더 렌즈와 일치. (glassesBuilder는 이 상수를 안 쓰고 자체 스케일.)
export const FRAME_BASE = { lensW: 0.03858, lensH: 0.026, bSize: 26 };

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
  // 가공 미보정 편심(per eye, mm) = PD 오차 + 프레임 유래(박스 중앙 이탈).
  // 31 = 모델 반동공거리 mm — FRAME_BASE.lensW(0.046·26/31)와 같은 앵커.
  const decMm = f.pdErr + 31 * (f.bSize - 26) / 26;
  // 편심 → 통로 폭: 쌍곡선 감쇠 — 프레임 유래 편심(최대 ~17mm)까지 단조
  // 감소해야 'PD 보정 → 회복'이 전 구간에서 보인다(선형+바닥 0.45는 4mm에
  // 서 포화돼 보정 효과가 안 보였음).
  const pdCorridor = clamp(1 / (1 + 0.13 * Math.abs(decMm)), 0.28, 1);
  const pitchShift = f.oh * 2.0;                                   // deg/mm
  // OH 과다(+2mm 초과)는 원용부를 침범 — "OH는 높을수록 좋다"가 되지 않게
  // 원용 페널티를 준다(양면 트레이드오프). 부족(−)의 근용 페널티는 nearRoom이 담당.
  const ohHigh = Math.max(0, f.oh - 2);
  const distOh = clamp(1 - ohHigh * 0.04, 0.6, 1);
  // 근용 수직 여유 = OH + 프레임 B 여유 − 누진대 잠식. 누진대가 길수록 피팅
  // 높이를 더 요구한다("짧은 프레임에 긴 누진대 금기") — corridor 항이 그 규칙.
  const nearRoom = clamp(1 + (f.oh + (f.bSize - 26) / 2 - (corr - 12) / 2) * 0.10, 0.3, 1.12);

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
    h: Math.min(BASE.distance.h * (0.45 + 0.55 * gradeScale) * vdFactor * distFit * distOh * wrapFactor * frameFactor, apertureH * 0.95),
    v: Math.min(BASE.distance.v * vdFactor * distFit * distOh * frameFactor, apertureV),
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
    v: BASE.near.v * (0.75 + 0.25 * nearAdd) * nearRoom * vdFactor,
    pitch: BASE.near.pitch - nearPitchShift + pitchShift,
    len: BASE.near.len * clamp(nearRoom + 0.15, 0.5, 1),
  };

  // ── 주변부 왜곡(비점수차) 지표 ──
  //   area    : 렌즈 위 왜곡 날개의 면적 — 렌즈(프레임)가 클수록↑, 작은 프레임은
  //             잘려나가↓. 렌즈 속성이므로 프레임 크기에만 의존.
  //   density : 왜곡 구배의 급함 — 누진면 설계 속성. Minkwitz(Add÷corridor) ×
  //             설계 등급(재분배 — cylReductionFactor, BP30=1 기준, 0은 불가).
  //             ⚠️ 프레임 크기와 무관(같은 렌즈 설계면 구배 동일 — 프레임을 넣던
  //             거짓 인과 제거: 큰 프레임=날개가 '넓어질' 뿐 '옅어지지' 않는다).
  //   exposure: 착용자가 '체감'하는 왜곡 노출 — 날개 면적 × 정점간거리(멀수록
  //             시야에서 왜곡영역 비중↑). HUD 등 착용자-관점 지표용.
  const minkGrad = (add / corr);                          // 도수변화율 (D/mm)
  const gradeCyl = g.cylReductionFactor / 0.78;           // BP30 기준 정규화
  const distortion = {
    area: clamp(frameScale * 1.0, 0.55, 1.4),
    density: clamp((minkGrad / (2.0 / 12)) * gradeCyl, 0.5, 2.2),
    exposure: clamp(frameScale * ((f.vd + 13) / 25) * (minkGrad / (2.0 / 12)) * gradeCyl, 0.3, 2.5),
  };

  return {
    distance, intermediate, near, distortion,
    // 편심 → 좌우 콘이 어긋남. +(광학중심이 동공 바깥) = 발산, −(안쪽) =
    // 수렴 — 부호로 방향이 구분되며 둘 다 양안 겹침이 줄어든다.
    // 프레임 유래 편심까지 합산돼 최대 ~27mm → ±22° 클램프(화면 이탈 방지).
    eyeYawDeg: clamp(decMm * 1.4, -22, 22),
    decMm,     // 가공 미보정 편심 (per eye, mm; + = 바깥) — HUD 표시용
  };
}
