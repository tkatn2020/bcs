// v3 Fitting model — qualitative zone math (PRD §8.2).
// Pure functions: state → per-zone cone spec { h, v, pitch, len } + eyeYawDeg.
//
// Directionally clinical (research anchors, PRD §8.1) — magnitudes for
// education, calibration reviewed by Joel before v1.0.
//   · grade → zone width via grades.js clearZoneScale (BP30 = 1.15 baseline)
//   · ADD   → Minkwitz: corridor width ∝ corridorLen / ADD
//   · VD    → 시야각 ∝ 1/(눈회전점~렌즈 거리): 0mm(눈 밀착)까지 확대 허용.
//     시선 하강각(중간·근용 pitch)도 같은 기하로 재계산 — VD가 멀수록 같은
//     설계 지점이 작은 하강각에 닿는다(2026-07-19 동기화 감사).
//   · panto → 표준(8~12°) 밖 양방향 페널티. 음수(retroscopic)는 근용 악화 + 원용 수차.
//     코리도 정렬 틀어짐은 중간부도 약하게 깎는다(근용의 절반 수준).
//   · wrap  → 5° 기준 양방향 이탈 페널티 (−15° 역랩까지) — 원·중·근 모두
//     (근용은 수렴 시선의 사선 통과라 제외할 이유가 없음)
//   · 편심(decMm) → corridor 축소 + 좌우 콘 발산(양안 겹침 손실).
//     이 앱은 '가공 전' 기준(사용자 결정 2026-07-18): 렌즈 광학중심은 박스
//     중앙에 있고, 프레임이 커지면 중앙이 동공 밖으로 벌어진다 — 그 프레임
//     유래 편심을 PD 오차와 합산해 그대로 광학에 반영한다(인셋 가공으로
//     이미 보정됐다는 전제 폐기). PD·OH를 동공에 맞추면 회복되는 게 교육 포인트.
//   · OH    → 존 지도 수직 이동 + 근용 잘림 + 체감 중간 시야 증감(사용자
//     결정 2026-07-19: 착용자 관점 — OH가 높으면 습관적 중간거리 시선이
//     모래시계형 코리도의 더 아래·넓은 구간을 지나 체감 폭↑, 낮으면 좁은
//     목(심하면 원용부)을 지나 체감 폭↓. 렌즈의 코리도 폭 자체는 불변)
//   · 프레임 크기(B) → 렌즈 = 시야의 개구(aperture):
//       원거리·근거리 시야는 프레임에 비례해 커지고/잘리고,
//       corridor 폭은 누진면 속성이라 프레임 크기와 무관 (핵심 교육 포인트)
//   · 렌즈 형상 → 같은 B라도 실면적이 다르다(2026-07-19): 원형·보스턴·
//     애비에이터는 박스(사각) 대비 개구가 좁고 하부가 잘려 근용 여유↓,
//     대신 하부 측면 코너의 왜곡 날개도 함께 잘려 왜곡 노출↓ (양면 트레이드오프)

import { getGrade } from '../optics/grades.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const rad2deg = (r) => (r * 180) / Math.PI;

export const STANDARD_FIT = {
  vd: 12, panto: 8, wrap: 5, pdErr: 0, oh: 0, bSize: 26, shape: 'square', headPitch: 0, headRoll: 0,
};

// 피팅 값의 물리 한계. ⚠️ 라이트스루 '장부'(state.v3fit.oh/vd)는 이 밖으로
// 나갈 수 있고, 클램프는 **소비 지점에서만** 한다(광학 계산·3D 배치·캡션 표시).
// 장부를 미리 클램프하면 포화된 뒤 되돌릴 때 역연산이 깨진다 — 경사각을 −15로
// 밀었다 표준 8로 되돌리면 OH가 0이 아니라 +3.5mm로 남아 "표준 피팅인데 성능
// 손실"이라는 물리적으로 불가능한 상태를 가르쳤다(2026-07-25 감사 A-2).
export const FIT_LIMITS = { oh: [-8, 8], vd: [5, 20], panto: [-15, 15] };
export const fitLimit = (key, v) => {
  const lim = FIT_LIMITS[key];
  return lim ? clamp(v, lim[0], lim[1]) : v;
};

// Baseline half-angles at BP30 · ADD +2.00 · corridor 12mm · standard fit
const BASE = {
  distance:     { h: 38, v: 24, pitch: -2,  len: 1.5 },
  intermediate: { h: 11, v: 8,  pitch: -15, len: 0.68 },
  near:         { h: 15, v: 10, pitch: -33, len: 0.42 },
};

// 렌즈 형상 → 실면적 계수 (박스 사각 = 1 앵커, 정성 캘리브레이션).
//   ap      : 개구(수평/수직) — 상·측면이 곡선으로 깎이는 만큼
//   nearCut : 하부(근용 영역) 잘림 — 원형·티어드롭은 바닥이 좁다
//   wing    : 하부 측면 코너(왜곡 날개 자리) 잘림 — 착용자 왜곡 체감↓.
//     날개의 '시각' 잘림은 렌즈 외곽 지오메트리가 존맵을 물리적으로 크롭해
//     자동 표현되므로 여기서는 체감 지표(exposure)에만 곱한다.
const SHAPE_FACTORS = {
  square:  { ap: 1.00, nearCut: 1.00, wing: 1.00 },
  round:   { ap: 0.93, nearCut: 0.85, wing: 0.75 },
  boston:  { ap: 0.95, nearCut: 0.90, wing: 0.82 },
  aviator: { ap: 0.97, nearCut: 0.88, wing: 0.80 },
};

// 존 모델의 프레임 크기 기준(중립 100%) — 표준 피팅 bSize=26에 맞춤(A1: 26 통일).
// 렌즈 치수는 bSize 26일 때 실제 렌더값(app.js 0.046·0.031 × 26/31)이라 개구
// (aperture) 계산이 렌더 렌즈와 일치. (glassesBuilder는 이 상수를 안 쓰고 자체 스케일.)
export const FRAME_BASE = { lensW: 0.03858, lensH: 0.026, bSize: 26 };

export function computeZones(s) {
  const g = getGrade(s.grade);
  // 장부(v3fit)는 미클램프 — 물리 한계는 여기 '소비 지점'에서 적용(FIT_LIMITS 주석 참조)
  const fRaw = { ...STANDARD_FIT, ...(s.v3fit || {}) };
  const f = { ...fRaw, oh: fitLimit('oh', fRaw.oh), vd: fitLimit('vd', fRaw.vd), panto: fitLimit('panto', fRaw.panto) };
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
  // 경사각 정렬 틀어짐은 코리도(중간부)도 깎는다 — 근용(0.04/°)의 절반 수준,
  // 과다 쪽은 원용이 주 피해라 더 약하게.
  const interFit = clamp(1 - pantoLow * 0.02 - pantoHigh * 0.015, 0.6, 1);
  const wrapDev = Math.max(0, Math.abs(f.wrap - 5) - 2);           // ±2° 허용, −15°까지
  const wrapFactor = clamp(1 - wrapDev * 0.03, 0.5, 1);
  // 기울기 유발 비점수차(Martin tilt, 2026-07-19): 표준 자세(경사 8~12°·
  // 안면각 5±2°)를 벗어난 총 이탈량만큼 주변부 수차가 커져 착용자의 왜곡
  // 체감(exposure)이 증가. 시야 폭 페널티(distFit·wrapFactor 등)와 별개 축.
  const tiltDev = wrapDev + pantoLow + pantoHigh;
  // ⚠️ Martin tilt 법칙: 기울기 유발 비점수차 ≈ D·sin²θ — 크기가 렌즈 도수
  // D에 정비례한다. 같은 경사·안면각 이탈이라도 강한 가입도(ADD↑)일수록
  // 유발 비점이 커야 한다("강한 가입도 + steep 경사 = 왜곡 급증", 2026-07-23
  // 교차결합 감사). SPH 입력이 없어 add를 도수 프록시로: add 2.0에서 계수
  // 1(현행 무변), 3.0에서 이탈민감도 ×1.2, 0.75에서 ×0.75.
  const tiltAstig = clamp(1 + tiltDev * 0.02 * (0.6 + 0.4 * add / 2.0), 1, 1.6);
  // 가공 미보정 편심(per eye, mm) = PD 오차 + 프레임 유래(박스 중앙 이탈).
  // 31 = 모델 반동공거리 mm — FRAME_BASE.lensW(0.046·26/31)와 같은 앵커.
  const decMm = f.pdErr + 31 * (f.bSize - 26) / 26;
  // 편심 → 통로 폭: 쌍곡선 감쇠 — 프레임 유래 편심(최대 ~17mm)까지 단조
  // 감소해야 'PD 보정 → 회복'이 전 구간에서 보인다(선형+바닥 0.45는 4mm에
  // 서 포화돼 보정 효과가 안 보였음).
  const pdCorridor = clamp(1 / (1 + 0.13 * Math.abs(decMm)), 0.28, 1);
  // 안면각 유래 유효 편심(2026-07-25 감사 B-1): 렌즈를 감으면 정면 시선이
  // 광학중심을 벗어나 수평 프리즘이 유발된다 — 랩 프레임을 조제할 때 광학중심을
  // 코쪽으로 편심(실무 근사 2°당 1mm)하고 도수를 보상(as-worn Rx)하는 이유.
  // Martin 기울기 비점수차(tiltAstig = 도수 변형 축)와는 별개인 '양안 정렬' 축.
  // ⚠️ pdCorridor(통로 폭)에는 태우지 않는다 — wrapFactor가 이미 폭을 깎고 있어
  // 이중 페널티가 된다. 콘 발산(eyeYaw)만 구동해 "PD 보정이 필요하다"를 보인다.
  const wrapDec = (f.wrap - 5) * 0.5;                              // mm/° (표준 5°에서 0)
  const pitchShift = f.oh * 2.0;                // deg/mm, 존지도 수직이동
  // 경사각↔OH는 이제 controls.js의 '라이트스루'로 통합(사용자 결정 2026-07-23):
  // 경사각을 스팁하게 하면 실제 OH 값이 올라가(프레임이 코 위로 올라앉음) 아래
  // 원용 침범(distOh)을 raw oh 그대로 구동한다. 예전 추상 커플(ohEquiv, distOh
  // 전용)은 제거 — 이제 경사각이 실제 프레임(OH·VD)을 움직여 근용/중간/시선
  // 하강까지 물리적으로 연동. (경사각의 사선 비점수차 nearFit·distFit·tiltAstig는
  // 별개 축이라 그대로 유지.)
  // OH 과다(+2mm 초과)는 원용부를 침범 — "OH는 높을수록 좋다"가 되지 않게
  // 원용 페널티를 준다(양면 트레이드오프). 부족(−)의 근용 페널티는 nearRoom이 담당.
  // 원용 침범: OH가 0에서 올라가는 순간부터 누진 시작부가 정면 시선에
  // 다가와 원용이 완만히 흐려진다(0.025/mm). +2mm 초과부터 본격 침범(합산 0.05/mm).
  const distOh = clamp(1 - Math.max(0, f.oh) * 0.025 - Math.max(0, f.oh - 2) * 0.025, 0.55, 1);
  // 착용자 체감 중간 시야(헤더 OH 항 참조): OH ±1mm당 ∓4.5%. 상한 1.25 —
  // OH 과다 시 근용부가 정면까지 침범해 '중간 창'이 무한정 넓어지진 않는다
  // (그 대가는 distOh가 담당). OH 0 = 1 → 표준 회귀 무변.
  const interOh = clamp(1 + f.oh * 0.045, 0.7, 1.25);
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
  // 형상 개구 계수: 곡선 외곽이 박스 대비 깎는 만큼 — 캡에 곱하면 표준(사각)
  // 에서 이미 캡에 물린 원용이 형상 변경 시 즉시 반응한다(캡 은폐 없음).
  const shp = SHAPE_FACTORS[f.shape] || SHAPE_FACTORS.square;
  const apertureH = rad2deg(Math.atan((lensWm / 2) / eyeDist)) * shp.ap;
  const apertureV = (rad2deg(Math.atan((lensHm / 2) / eyeDist)) + 12) * shp.ap; // +12 = 존 지도 수직 여유

  // 시선 하강각 = 눈에서 본 기하(2026-07-19): 기준 VD 12(눈회전점까지 25mm)
  // 에서 캘리브레이션된 각도를 렌즈 위 드롭(mm)으로 환산해 실제 VD로 재계산.
  // VD 12에서 항등(기존 값 그대로), VD가 멀수록 하강각↓ — 대신 근용 콘이
  // 위를 향해 40cm 책 타깃을 놓친다("긴 VD는 근용 찾기 어려움"의 기하 재현).
  // 입력 ±85° 가드: 코받침 커플링 경유 시 eff.oh가 슬라이더 범위를 넘어
  // |pAt12|가 커질 수 있다 — tan 특이점(90°)의 소리 없는 부호 반전 방지.
  const eyePitch = (pAt12) => rad2deg(Math.atan(Math.tan((clamp(pAt12, -85, 85) * Math.PI) / 180) * 25 / (f.vd + 13)));

  // 비측 인셋 = 폭주(2026-07-25 감사 B-2): 가까운 곳을 볼수록 양안 시선이 코쪽으로
  // 모인다 — 누진렌즈 근용부가 설계상 코쪽(약 2.5mm)에 놓이는 이유다. 콘을 아래로
  // 평행 하강만 시키면 "왜 근용부가 코쪽에 있나"를 못 보여준다. 대상거리 대비
  // 반동공거리의 순수 기하라 VD·프레임·설계와 무관(편심 발산과는 반대 방향 축).
  const HALF_PD_MM = 31;                                     // FRAME_BASE와 같은 앵커
  const convergeDeg = (distMm) => rad2deg(Math.atan(HALF_PD_MM / distMm));

  // rawD/rawN(캡 이전 곱)과 capD/capN(개구 한계 배율)을 분리해 두면 요인
  // 분해(HUD 드릴다운)가 화면 값과 정확히 일치한다: h = raw × cap × 사후항.
  const rawD = BASE.distance.h * (0.45 + 0.55 * gradeScale) * vdFactor * distFit * wrapFactor * frameFactor;
  const capD = Math.min(1, (apertureH * 0.95) / rawD);
  const distance = {
    // distOh(원용 침범)는 개구 캡 '밖'에서 곱한다 — 캡 안에 두면 기저값이
    // 이미 캡에 물려 있어 oh +3.5mm까지 페널티가 화면에 안 나타나고 interOh
    // 이득만 보이는 비대칭이 생긴다(리뷰 2026-07-19). 침범은 프레임 개구와
    // 무관한 착용자 체감 손실이라 캡 이후가 물리적으로도 맞다.
    h: rawD * capD * distOh,
    v: Math.min(BASE.distance.v * vdFactor * distFit * frameFactor, apertureV) * distOh,
    pitch: eyePitch(BASE.distance.pitch + pitchShift * 0.35),
    len: BASE.distance.len,
    inset: 0,                                   // 원거리 = 시선 평행(폭주 없음)
  };
  const intermediate = {
    // corridor 폭은 프레임 크기와 무관 (Minkwitz — 누진면 속성)
    h: BASE.intermediate.h * gradeScale * mink * vdFactor * wrapFactor * pdCorridor * interFit * interOh,
    v: BASE.intermediate.v * (0.7 + 0.3 * mink) * vdFactor,
    pitch: eyePitch(BASE.intermediate.pitch - nearPitchShift * 0.5 + pitchShift),
    len: BASE.intermediate.len,
    inset: convergeDeg(650),                    // 중간거리 65cm 폭주
  };
  const rawN = BASE.near.h * gradeScale * nearAdd * vdFactor * nearFit * nearRoom * pdCorridor * Math.sqrt(wrapFactor) * Math.sqrt(frameFactor);
  const capN = Math.min(1, (apertureH * 0.85) / rawN);
  const near = {
    // 안면각은 근용에 √(절반 가중) — 수렴 시선의 사선 통과라 영향은 있지만
    // 주 피해는 원용 주변부(임상 위계: wrap 과다→원용, panto 부족→근용)라
    // 풀계수를 주면 화면상 위계가 역전된다(리뷰 2026-07-19).
    // shp.nearCut: 원형·티어드롭은 바닥이 좁아 근용 영역이 형상만으로 잘린다.
    h: rawN * capN * shp.nearCut,
    v: BASE.near.v * (0.75 + 0.25 * nearAdd) * nearRoom * vdFactor,
    pitch: eyePitch(BASE.near.pitch - nearPitchShift + pitchShift),
    len: BASE.near.len * clamp(nearRoom + 0.15, 0.5, 1),
    inset: convergeDeg(400),                    // 근거리 40cm 폭주 = 설계 인셋의 근거
  };

  // ── 주변부 왜곡(비점수차) 지표 ──
  //   area    : 렌즈 위 왜곡 날개의 면적 — 렌즈(프레임)가 클수록↑, 작은 프레임은
  //             잘려나가↓. 렌즈 속성이므로 프레임 크기에만 의존.
  //   density : 왜곡 구배의 급함 — 누진면 설계 속성. Minkwitz(Add÷corridor) ×
  //             설계 등급(재분배 — cylReductionFactor, BP30=1 기준, 0은 불가).
  //             ⚠️ 프레임 크기와 무관(같은 렌즈 설계면 구배 동일 — 프레임을 넣던
  //             거짓 인과 제거: 큰 프레임=날개가 '넓어질' 뿐 '옅어지지' 않는다).
  //   exposure: 착용자가 '체감'하는 왜곡 노출 — 날개 면적 × 정점간거리(멀수록
  //             시야에서 왜곡영역 비중↑) × 형상(날개 코너 잘림) × 기울기
  //             비점수차(경사·안면각 이탈). HUD 등 착용자-관점 지표용.
  //             (area는 존맵 텍스처-공간 의미라 형상을 안 곱는다 — 형상의
  //             시각 잘림은 렌즈 외곽이 존맵을 크롭해 자동 표현.)
  const minkGrad = (add / corr);                          // 도수변화율 (D/mm)
  const gradeCyl = g.cylReductionFactor / 0.78;           // BP30 기준 정규화
  const distortion = {
    area: clamp(frameScale * 1.0, 0.55, 1.4),
    density: clamp((minkGrad / (2.0 / 12)) * gradeCyl, 0.5, 2.2),
    exposure: clamp(frameScale * shp.wing * ((f.vd + 13) / 25) * (minkGrad / (2.0 / 12)) * gradeCyl * tiltAstig, 0.3, 2.5),
  };

  return {
    distance, intermediate, near, distortion,
    // 렌즈 표면(존맵 텍스처) 전용 폭 — '설계 속성'만(등급·ADD·누진대).
    // 피팅 요인(VD·경사·안면각·편심·OH 체감)은 착용자 뷰(콘·HUD)에만 —
    // 렌즈에 새겨진 존맵까지 변하면 'OH를 올리면 렌즈 통로가 넓어진다'는
    // 오개념을 그리게 된다(리뷰 2026-07-19). 표준에서 corrH 11 · nearH 15.
    lensDesign: {
      corrH: BASE.intermediate.h * gradeScale * mink,
      nearH: BASE.near.h * gradeScale * nearAdd,
    },
    // 편심 → 좌우 콘이 어긋남. +(광학중심이 동공 바깥) = 발산, −(안쪽) =
    // 수렴 — 부호로 방향이 구분되며 둘 다 양안 겹침이 줄어든다.
    // 프레임 유래 편심까지 합산돼 최대 ~27mm → ±22° 클램프(화면 이탈 방지).
    // ⚠️ 편심 각도는 눈회전점 거리(VD+13)에 반비례 — 먼 VD일수록 같은 편심이
    // 작은 요각(발산)을 이룬다(atan(dec/(vd+13))). pitch·개구캡과 동일한
    // 25/(vd+13) 기하로 대칭(2026-07-23 교차결합 감사). VD12에서 항등.
    // 편심 요각 — 가공 미보정 편심(decMm) + 안면각 유래 유효 편심(wrapDec).
    eyeYawDeg: clamp((decMm + wrapDec) * 1.4 * 25 / (f.vd + 13), -22, 22),
    decMm,     // 가공 미보정 편심 (per eye, mm; + = 바깥) — HUD 표시용
    // 요인 분해(HUD 드릴다운) — m = 그 지표에 곱해진 배율(1 = 무영향),
    // v = 가산 성분. ctrl = 해당 조절 UI 키(클릭 시 하이라이트; 설계 축은 없음).
    // 곱 지표는 h = Π(m)·BASE 가 화면 값과 정확히 일치하도록 위 수식의 항을
    // 그대로 재사용한다(별도 근사 금지).
    breakdown: {
      dec: [
        { label: 'PD 오차', v: f.pdErr, unit: 'mm', ctrl: 'pdErr' },
        { label: '프레임 유래(가공 미보정)', v: 31 * (f.bSize - 26) / 26, unit: 'mm', ctrl: 'bSize' },
      ],
      distance: [
        { label: '설계 등급', m: 0.45 + 0.55 * gradeScale },
        { label: '정점간거리', m: vdFactor, ctrl: 'vd' },
        { label: '경사각', m: distFit, ctrl: 'panto' },
        { label: '안면각', m: wrapFactor, ctrl: 'wrap' },
        { label: '프레임 크기', m: frameFactor, ctrl: 'bSize' },
        { label: '개구 한계(프레임·형상)', m: capD, ctrl: 'bSize' },
        { label: 'OH 원용 침범', m: distOh, ctrl: 'oh' },
      ],
      intermediate: [
        { label: '설계 등급', m: gradeScale },
        { label: '누진대·ADD(Minkwitz)', m: mink },
        { label: '정점간거리', m: vdFactor, ctrl: 'vd' },
        { label: '안면각', m: wrapFactor, ctrl: 'wrap' },
        { label: '광학중심 편심', m: pdCorridor, ctrl: 'pdErr' },
        { label: '경사각', m: interFit, ctrl: 'panto' },
        { label: 'OH 체감(시선 깊이)', m: interOh, ctrl: 'oh' },
      ],
      near: [
        { label: '설계 등급', m: gradeScale },
        { label: 'ADD', m: nearAdd },
        { label: '정점간거리', m: vdFactor, ctrl: 'vd' },
        { label: '경사각', m: nearFit, ctrl: 'panto' },
        { label: '높이 여유(OH·프레임·누진대)', m: nearRoom, ctrl: 'oh' },
        { label: '광학중심 편심', m: pdCorridor, ctrl: 'pdErr' },
        { label: '안면각', m: Math.sqrt(wrapFactor), ctrl: 'wrap' },
        { label: '프레임 크기', m: Math.sqrt(frameFactor), ctrl: 'bSize' },
        { label: '개구 한계(프레임·형상)', m: capN, ctrl: 'bSize' },
        { label: '형상 하부 잘림', m: shp.nearCut, ctrl: 'shape' },
      ],
      nearPitch: [
        { label: '누진대 길이', v: nearPitchShift, unit: '°' },
        { label: 'OH(존 지도 이동)', v: -pitchShift, unit: '°', ctrl: 'oh' },
        { label: 'VD 기하(재계산)', v: Math.abs(near.pitch) - Math.abs(clamp(BASE.near.pitch - nearPitchShift + pitchShift, -85, 85)), unit: '°', ctrl: 'vd' },
      ],
      exposure: [
        { label: '프레임 크기', m: frameScale, ctrl: 'bSize' },
        { label: '형상 날개 잘림', m: shp.wing, ctrl: 'shape' },
        { label: '정점간거리', m: (f.vd + 13) / 25, ctrl: 'vd' },
        { label: '설계 구배(ADD/누진대)', m: minkGrad / (2.0 / 12) },
        { label: '설계 등급(수차 재분배)', m: gradeCyl },
        { label: '기울기 비점수차(경사·안면각×도수)', m: tiltAstig, ctrl: 'panto' },
      ],
    },
  };
}
