// Wavefront-style distortion overlay + clear-vision-field analytics.
//
// Optical model (rev. 2):
//   - Heat color is normalized against an ABSOLUTE reference (REFERENCE_CYL),
//     not the per-config peak. So as ADD rises, heat covers more area
//     (bigger, brighter), matching real Minkwitz scaling.
//   - Iso lines are at absolute D values (0.25, 0.50, 1.00, 2.00) — visible
//     contours expand outward as ADD rises.
//   - Rx cylinder contributes a RADIAL residual (small at center, growing
//     toward periphery) — fixes the bug where high cyl made every pixel
//     "above threshold" even at the lens center.
//   - High |sphere| (>1.5 D) starts shrinking the clear zones modestly,
//     reflecting strong-Rx wearer adaptation difficulty.
//   - High ADD also narrows clear zones: peripheral cyl ramps faster, so
//     visible "clear corridor" gets tighter.

import { getGrade } from '../optics/grades.js';

const GRADE_COLORS = {
  1: '#94a3b8', 2: '#64748b', 3: '#2563eb', 4: '#7c3aed', 5: '#0f766e',
};

export function gradeViz(id) {
  const g = getGrade(id);
  return {
    id, name: g.name, bp: g.bpCode,
    cylRed: g.cylReductionFactor, clearScale: g.clearZoneScale,
    color: GRADE_COLORS[id] ?? '#64748b',
  };
}

// Absolute-D reference for color mapping. Anything at or above this maps
// to the most saturated end of the palette. Tuned so a typical worst-case
// (ADD +3, BP10, 10mm corridor) saturates the lens edges in magenta.
export const REFERENCE_CYL = 3.0;

// Clear-vision threshold default. Pixels with cyl < threshold count as clear.
// Aligned with the emerald (0.5 D) ISO contour — that line is the visible
// clear/blur boundary in the 2D heatmap, AR shader, and score formula.
export const CYL_CLEAR_THRESHOLD = 0.50;

// Absolute iso-cyl contour levels (D). Higher levels appear deeper in the
// soft zone — they MOVE as ADD changes, visualizing the area expansion.
export const ISO_LEVELS_D = [0.25, 0.50, 0.75, 1.00, 2.00];

export const CORRIDOR_OPTIONS = [10, 12, 14];

export const ZONE_COLORS = {
  distance: '#3b82f6',
  intermediate: '#22c55e',
  near: '#f59e0b',
};

// Extended geometry combining lens design + Rx + eye laterality.
//
// Asymmetric sphere handling — hyperopes (plus Rx) adapt notably worse than
// myopes for progressive lenses, per clinical experience and the optics:
//   1. Spectacle magnification — plus lenses enlarge the retinal image
//      (~3.7% per +3D at 12mm vertex), amplifying perceived swim/sway and
//      enlarging the peripheral cyl regions on retina.
//   2. Greater oblique astigmatism at off-axis gaze.
//   3. More pronounced image jump at the ADD progression segment.
//   4. Higher accommodation + convergence demand for near (sphere + ADD).
//   5. Stronger peripheral prism imbalance (yoked prism effect).
// Myopes only see a meaningful penalty above ~−1.5 D and rise gently.
export function getGeom({
  grade = 3, corridorLength = 12, add = 2.0,
  sphere = -2.0, cylinder = 0, axis = 0, eye = 'OD',
} = {}) {
  const g = gradeViz(grade);
  const cs = g.clearScale;
  const hardness = 12 / corridorLength;
  const softness = 1 / hardness;

  // ── Asymmetric sphere penalty ──
  //   hyperopia (positive sphere): grows linearly from 0 D, ~0.30 at +6 D
  //   myopia    (negative sphere): only above 1.5 D, grows gently, ~0.11 at -6 D
  const hyperopiaPenalty = Math.max(0, sphere) * 0.05;
  const myopiaPenalty    = Math.max(0, -sphere - 1.5) * 0.025;
  const sphereHit   = Math.min(0.45, hyperopiaPenalty + myopiaPenalty);
  const sphereScale = 1 - sphereHit;

  // ── Spectacle magnification factor ──
  // Plus lenses magnify the image; same physical mm of peripheral cyl maps
  // to a larger angular extent on retina → effectively higher peak cyl.
  // ~+18% at +6 D, only slightly < 1 for moderate myopia.
  const magnificationFactor = 1 + Math.max(0, sphere) * 0.03
                                - Math.max(0, -sphere) * 0.005;

  // ADD penalty: higher ADD narrows clear zones (peripheral cyl ramps faster)
  const addPenalty = Math.min(0.35, Math.max(0, (add - 1.0) * 0.12));
  const addScale = 1 - addPenalty;

  // ── Non-linear compound penalty for extreme ADD × hyperopia combos ──
  // Clinical reality: ADD > 2.5 D combined with sphere > +2 D compounds
  // non-linearly — peripheral cyl + image jump + magnification stack badly.
  // Single multiplicative addScale·sphereScale undershoots this regime.
  const compoundExcess = Math.max(0, add - 2.5) * Math.max(0, sphere - 2.0);
  const compoundPenalty = Math.min(0.20, compoundExcess * 0.15);

  const combinedScale = sphereScale * addScale * (1 - compoundPenalty);

  // ── Corridor peakCyl mapping ──
  // Strict Minkwitz (cyl × corridor = const) yields a (12/corridor) linear
  // ratio — but in practice the 10/14 mm gap appears overstated because the
  // model ignores the cost side of long corridor (lower near-zone position,
  // frame fit, reading posture). Sublinear exponent 0.6 dampens the gap
  // by ~25% while preserving the physics direction.
  const corridorPeakRatio = Math.pow(12 / corridorLength, 0.6);

  return {
    grade: g, gradeId: grade, add, corridor: corridorLength,
    sphere, cylinder: Math.abs(cylinder), axis, eye,
    hardness, softness,
    distanceHalfMm: 13 * cs * combinedScale * (0.85 + 0.30 * softness),
    corridorHalfMm: 3 * cs * combinedScale * (0.85 + 0.30 * softness),
    nearHalfMm:     9 * cs * combinedScale * (0.85 + 0.30 * softness),
    falloffMm: (4 * softness + 2) * (1 - sphereHit * 0.5) * (1 - addPenalty * 0.4),
    peakCyl: add * corridorPeakRatio * g.cylRed * magnificationFactor,
    sphereHit, hyperopiaPenalty, myopiaPenalty, magnificationFactor, addPenalty, compoundPenalty,
  };
}

// Local unwanted cyl (D) at lens position (mm).
//
// Astigmatism is a vector quantity (Jones / power-vector convention):
// it has both a magnitude and an axis, and adds via cosines of the
// DOUBLED angle (because |cyl| is 180°-symmetric).
//
//   |C_total|² = |C_p|² + |C_r|² + 2·|C_p|·|C_r|·cos(2·Δα)
//
// where Cp = progressive peripheral cyl (axis ≈ tangential to corridor),
// Cr = Rx-induced residual cyl (axis = wearer's prescribed Rx axis).
//   Aligned (Δα = 0):    C_total = Cp + Cr   (worst case, magnitudes add)
//   Perpendicular (90°): C_total = |Cp − Cr| (best case, partial cancellation)
//
// This produces MUCH stronger axis-dependent asymmetry than a simple
// scalar modulation, and matches real eyeglass optics where the Rx cyl
// meridian and the progressive lens's natural cyl meridian interact.
export function sampleUnwantedCyl(xMm, yMm, geom) {
  const xLocal = geom.eye === 'OS' ? -xMm : xMm;
  const yNorm = yMm / 11;
  const wDist = smoothstep(0.0, -0.6, yNorm);
  const wNear = smoothstep(0.6, 1.4, yNorm);
  const wCorr = 1 - wDist - wNear;
  const halfW =
    wDist * geom.distanceHalfMm +
    wCorr * geom.corridorHalfMm +
    wNear * geom.nearHalfMm;
  const ax = Math.abs(xLocal);
  const t = (ax - halfW) / geom.falloffMm;
  const ramp = clamp(t, 0, 1);
  // Vertical scaling of progressive peripheral cyl. Floor raised from 0.05
  // → 0.10 so the distance zone shows realistic Minkwitz residual for
  // strong-Rx (esp. high-plus / high-cyl) wearers — without this, etched
  // grade differences at distance were imperceptible because peripheral
  // cyl never crossed the 0.40 D plateau-width threshold.
  const vScale = clamp(0.05 + (yNorm + 0.3) * 0.85, 0.10, 1.0);
  const r = Math.hypot(xMm, yMm) / 22;

  // ── (a) Progressive peripheral cyl ──
  // Magnitude varies by zone; axis is tangential to the iso-cyl curves
  // around the corridor (≈ radial direction + 90°).
  const cylProgMag = geom.peakCyl * ramp * vScale;
  const positionAngle = Math.atan2(yMm, xLocal);
  const progAxis = positionAngle + Math.PI / 2;

  // ── (b) Rx-induced residual cyl ──
  // Off-axis gaze through the cyl correction breaks down. Pure r² scaling
  // (no base term) so the lens CENTER is perfectly corrected (Cr=0) and
  // the residual rises with the square of radial distance — matching how
  // oblique astigmatism scales with off-axis angle in real spectacle lenses.
  // Coefficient sized so |Cr| at edge is comparable to typical |Cp|, making
  // the cos(2Δα) interaction visually dominant: aligned regions saturate
  // the heat palette while perpendicular regions partially cancel.
  const cylRxMag = Math.abs(geom.cylinder) * 0.30 * r * r;
  const rxAxis = (geom.axis * Math.PI) / 180;

  // ── Astigmatism vector sum ──
  const cos2D = Math.cos(2 * (rxAxis - progAxis));
  const cylTotalSq =
    cylProgMag * cylProgMag +
    cylRxMag   * cylRxMag   +
    2 * cylProgMag * cylRxMag * cos2D;
  const cylTotal = Math.sqrt(Math.max(0, cylTotalSq));

  // ── Sphere swim residual ──
  // Symmetric component (high |sphere| only) + hyperope-specific component
  // (spectacle magnification, image-jump — unique to plus lenses).
  const baseSphereResidual = Math.max(0, Math.abs(geom.sphere) - 2) * 0.04 * r * r;
  const hyperopeSwim       = Math.max(0, geom.sphere) * 0.025 * r;
  const sphereResidual     = baseSphereResidual + hyperopeSwim;

  return cylTotal + sphereResidual;
}

export function smoothstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ── Anisometropia (좌우격차) — power-vector dioptric difference ──────
//
// Long's power-vector decomposition treats each Rx as a 3-component vector
// (M, J0, J45) so sphere/cyl/axis differences combine into a single
// comparable dioptric distance. Standard ophthalmic clinical method.
//
//   M    = S + C/2                      (mean spherical equivalent)
//   J0   = -(C/2) × cos(2 × axis_rad)   (cartesian astigmatism)
//   J45  = -(C/2) × sin(2 × axis_rad)   (oblique astigmatism)
//
// Returns the dioptric distance √(ΔM² + ΔJ0² + ΔJ45²) between the two Rx.
// Clinical reference points:
//   0.50 D — generally tolerated
//   1.00 D — mild anisometropia (peripheral prism noticeable)
//   1.50 D — clinically borderline-significant
//   2.00 D — clinically significant anisometropia
//   3.00 D — severe (often requires Rx modification: slab-off, contact lens)
export function rxDioptricGap(odRx, osRx) {
  const toPV = (rx) => {
    // Convention: cyl is negative. We accept either sign (e.g. geom stores
    // |cyl|, state stores negative) — coerce to negative.
    const cyl = -Math.abs(rx.cylinder);
    const axRad = ((rx.axis ?? 0) * Math.PI) / 180;
    return {
      M:   rx.sphere + cyl / 2,
      J0:  -(cyl / 2) * Math.cos(2 * axRad),
      J45: -(cyl / 2) * Math.sin(2 * axRad),
    };
  };
  const a = toPV(odRx);
  const b = toPV(osRx);
  const dM   = a.M   - b.M;
  const dJ0  = a.J0  - b.J0;
  const dJ45 = a.J45 - b.J45;
  return Math.sqrt(dM * dM + dJ0 * dJ0 + dJ45 * dJ45);
}

// Map a dioptric gap (D) to a 0–100 display score. 18 points/D scale —
// chosen so 100 corresponds to ~5.5 D (extreme anisometropia) while the
// clinical thresholds (1.0/1.5/2.0 D) land at meaningful intervals
// (18/27/36점). Used purely for the displayed "(N점)" suffix.
export function gapScoreFromDioptric(dGap) {
  return Math.min(100, dGap * 18);
}

const _ratiosCache = new Map();

// Comfortable-clarity threshold for the per-zone plateau-width metric.
// Aligned with CYL_CLEAR_THRESHOLD (0.50 D = emerald ISO contour boundary)
// so plateau widths, binary clear ratios, score formula dead zone, and the
// visible heatmap/blur all share the same notion of "clear vs blurred."
// Previously 0.40 (between cyan and emerald) — created an inconsistency
// where a pixel at cyl=0.45 scored 1.0 visually but landed outside the
// plateau-width measurement.
export const COMFORT_THRESHOLD_D = 0.50;

// Reference plateau widths (mm) — per-zone normalization to 0–100 score.
// Distance uses the full lens width (~44mm) so high-Rx wearers see meaningful
// grade differentiation at distance gaze (BP10 might be 36/44=82 while BP50
// extends edge-to-edge at 100). Corridor/near use 26mm because their
// plateaus rarely exceed it and 26 captures their typical 30–95% spread.
export const PLATEAU_REF_MM = { distance: 44, intermediate: 26, near: 26 };

// Canonical gaze heights (yMm in lens coords) used to sample the clear
// plateau for each zone. Negative y = above optical center.
export const ZONE_GAZE_Y_MM = { distance: -10, intermediate: 3, near: 12 };

// Width (mm) of the contiguous clear plateau around x=0 at given yMm.
// Walks outward from center until cyl ≥ threshold on each side. If x=0
// itself is already above threshold (e.g. heavy cyl Rx polluting center),
// returns 0.
export function clearPlateauWidth(yMm, geom, threshold = COMFORT_THRESHOLD_D) {
  if (sampleUnwantedCyl(0, yMm, geom) >= threshold) return 0;
  const STEP = 0.25;
  const MAX = 22;
  let right = 0, left = 0;
  for (let xMm = STEP; xMm <= MAX; xMm += STEP) {
    if (sampleUnwantedCyl(xMm, yMm, geom) >= threshold) break;
    right = xMm;
  }
  for (let xMm = STEP; xMm <= MAX; xMm += STEP) {
    if (sampleUnwantedCyl(-xMm, yMm, geom) >= threshold) break;
    left = xMm;
  }
  return right + left;
}

// Compute clear-vision ratios over the lens disc.
//
// Returns three families of statistics, kept side-by-side because each
// answers a different sales/clinical question:
//
//   (a) Hard-threshold ratios (`distance`/`distanceUtil`/`totalClearPct` …)
//       — pixel-counting against a 0.25 D cyl cutoff. Strict and binary;
//         numbers tank quickly when Rx or ADD rises ("0.26 D = 0 points").
//   (b) Continuous clarity SCORES (`distanceScore`/`totalScore` …)
//       — area-weighted average of (1 − cyl/REFERENCE_CYL) over each band.
//         Mathematically the same data the heatmap already paints. Used as
//         the headline "선명도 지수".
//   (c) Plateau widths (`distanceWidth`/`intermediateWidth`/`nearWidth` mm
//         and the matching `*WidthPct`) — width of the central clear column
//         at each zone's canonical gaze height. This is the metric that
//         actually exposes the corridor's pinched-waist (Minkwitz) shape:
//         distance > near > corridor in width, matching what the wearer
//         sees in the heatmap and the published iso-cyl plots.
//
// The optical model and heatmap rendering are UNCHANGED — only additional
// summary statistics.
export function computeClearRatios(geom, threshold = CYL_CLEAR_THRESHOLD) {
  const key = `${geom.gradeId}|${geom.add}|${geom.corridor}|${geom.sphere}|${geom.cylinder}|${geom.axis}|${geom.eye}|${threshold}`;
  if (_ratiosCache.has(key)) return _ratiosCache.get(key);
  const R = 22, N = 26;
  const step = (2 * R) / N;
  let total = 0;
  // Soft per-zone weights — same wDist/wCorr/wNear that sampleUnwantedCyl uses,
  // so band classification stays consistent with the wavefront model. The
  // corridor zone (wCorr ≈ 1 only at yNorm 0..0.6) is genuinely narrow, so
  // its area-weighted average reflects Minkwitz's pinched-corridor reality.
  let distTotal = 0, midTotal = 0, nearTotal = 0;
  let distClear = 0, midClear = 0, nearClear = 0;
  let distScoreSum = 0, midScoreSum = 0, nearScoreSum = 0;
  for (let i = 0; i < N; i++) {
    const yMm = -R + (i + 0.5) * step;
    for (let j = 0; j < N; j++) {
      const xMm = -R + (j + 0.5) * step;
      if (Math.hypot(xMm, yMm) > R) continue;
      total++;
      const yNorm = yMm / 11;
      const wDist = smoothstep(0.0, -0.6, yNorm);
      const wNear = smoothstep(0.6, 1.4, yNorm);
      const wCorr = Math.max(0, 1 - wDist - wNear);
      distTotal += wDist;
      midTotal  += wCorr;
      nearTotal += wNear;
      const cyl = sampleUnwantedCyl(xMm, yMm, geom);
      const isClear = cyl < threshold ? 1 : 0;
      distClear += isClear * wDist;
      midClear  += isClear * wCorr;
      nearClear += isClear * wNear;
      // Continuous clarity score per pixel: 1 at cyl ≤ CYL_CLEAR_THRESHOLD,
      // then linearly decays to 0 at cyl ≥ REFERENCE_CYL. The dead zone makes
      // the cyan ISO contour (0.25 D) the clear/blur boundary — pixels inside
      // it score perfect, matching the visual heatmap and AR blur convention.
      const cylEff = Math.max(0, cyl - CYL_CLEAR_THRESHOLD);
      const score = clamp(1 - cylEff / (REFERENCE_CYL - CYL_CLEAR_THRESHOLD), 0, 1);
      distScoreSum += score * wDist;
      midScoreSum  += score * wCorr;
      nearScoreSum += score * wNear;
    }
  }
  const totalClear = distClear + midClear + nearClear;
  const safeDiv = (a, b) => b === 0 ? 0 : a / b;

  // Plateau widths — sample at 3 y-rows within each zone and take the MIN.
  // Single-row sampling at zone center can land in a Jones-vector cancellation
  // sweet spot where total cyl never crosses the threshold along that one
  // line, even though the surrounding 2D area shows clear distortion in the
  // heatmap. Multi-row min sampling captures the narrowest plateau anywhere
  // in the zone, restoring agreement between the score and the visualization.
  const zonePlateau = (centerYMm, halfRangeMm) => {
    const ys = [centerYMm - halfRangeMm, centerYMm, centerYMm + halfRangeMm];
    let minMm = clearPlateauWidth(ys[0], geom);
    for (let i = 1; i < ys.length; i++) {
      const w = clearPlateauWidth(ys[i], geom);
      if (w < minMm) minMm = w;
    }
    return minMm;
  };
  const distWidthMm = zonePlateau(ZONE_GAZE_Y_MM.distance,     2.5);  // y -7.5/-10/-12.5
  const midWidthMm  = zonePlateau(ZONE_GAZE_Y_MM.intermediate, 2.0);  // y +1/+3/+5
  const nearWidthMm = zonePlateau(ZONE_GAZE_Y_MM.near,         2.0);  // y +10/+12/+14
  const widthToPct  = (mm, zone) => Math.min(100, Math.round(mm / PLATEAU_REF_MM[zone] * 100));

  // Continuous clarity scores
  const dScore = safeDiv(distScoreSum, distTotal) * 100;
  const mScore = safeDiv(midScoreSum,  midTotal)  * 100;
  const nScore = safeDiv(nearScoreSum, nearTotal) * 100;
  const tScore = safeDiv(distScoreSum + midScoreSum + nearScoreSum, total) * 100;

  // Per-zone displayed pct = 50/50 blend of plateau pct and continuous score.
  //
  // Plateau-only had a 100→X cliff: ADD slightly below threshold → no x-row
  // crosses 0.40 D → plateau = lens-edge → 100% cap. Next ADD step crosses
  // threshold somewhere → plateau drops sharply (e.g. 100→60). This shows
  // up as a 30+ point jump for a 0.25 D ADD change, mismatching the heatmap
  // which gradually deepens its color.
  //
  // Continuous score (area-weighted average clarity) is smooth but doesn't
  // emphasize narrowness alone. Blending keeps both signals: plateau still
  // dominates the per-zone narrowing message, while the score component
  // prevents hard 100% saturation and absorbs the threshold-crossing cliff
  // into a smaller drop (≈15–20 pts vs ≈30+ pts for plateau-only).
  const blendPct = (mm, zone, score) => {
    const platPct = Math.min(100, mm / PLATEAU_REF_MM[zone] * 100);
    return Math.round(0.5 * platPct + 0.5 * score);
  };

  const result = {
    threshold,
    // Hard-threshold ratios (legacy, used by the heatmap stats / tests)
    distance:     (distClear / total) * 100,
    intermediate: (midClear  / total) * 100,
    near:         (nearClear / total) * 100,
    distancePct:     safeDiv(distClear, totalClear) * 100,
    intermediatePct: safeDiv(midClear,  totalClear) * 100,
    nearPct:         safeDiv(nearClear, totalClear) * 100,
    totalClearPct: (totalClear / total) * 100,
    distanceUtil:     safeDiv(distClear, distTotal) * 100,
    intermediateUtil: safeDiv(midClear,  midTotal)  * 100,
    nearUtil:         safeDiv(nearClear, nearTotal) * 100,
    // Continuous clarity scores (headline "선명도 지수")
    distanceScore:     dScore,
    intermediateScore: mScore,
    nearScore:         nScore,
    totalScore:        tScore,
    // Plateau widths (raw mm, used for per-zone display — exposes Minkwitz pinch)
    distanceWidth:     distWidthMm,
    intermediateWidth: midWidthMm,
    nearWidth:         nearWidthMm,
    // Per-zone display pct — plateau/score blend for smooth transitions
    distanceWidthPct:     blendPct(distWidthMm, 'distance',     dScore),
    intermediateWidthPct: blendPct(midWidthMm,  'intermediate', mScore),
    nearWidthPct:         blendPct(nearWidthMm, 'near',         nScore),
  };
  if (_ratiosCache.size > 500) _ratiosCache.clear();
  _ratiosCache.set(key, result);
  return result;
}

// Coordinate system that matches the SVG lens path (viewBox 720×440,
// preserveAspectRatio="none"). The lens body inside the path occupies
//   x:  60..660 of 720  → 83.3% of canvas width  → 50mm physical
//   y:  23..414 of 440  → 88.9% of canvas height → 35mm physical
// Splitting x/y mmPerPx keeps the heat aligned with the (possibly
// non-uniformly stretched) outline at any canvas aspect ratio.
const LENS_X_FRAC = 600 / 720;
const LENS_Y_FRAC = 391 / 440;
const LENS_CY_FRAC = (23 + 414) / 2 / 440;   // ≈ 0.497
const LENS_W_MM = 50;
const LENS_H_MM = 35;

function lensCoordsFor(W, H) {
  return {
    mmPerPxX: LENS_W_MM / (W * LENS_X_FRAC),
    mmPerPxY: LENS_H_MM / (H * LENS_Y_FRAC),
    cx: W / 2,
    cy: H * LENS_CY_FRAC,
  };
}

// Render the cyl heat field. Color uses ABSOLUTE D scale so visual area
// grows with rising cyl/ADD/Rx, matching wearer experience.
export function renderField(canvas, geom) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const SCALE = 0.35;
  const rw = Math.max(2, Math.round(W * SCALE));
  const rh = Math.max(2, Math.round(H * SCALE));
  const tmp = document.createElement('canvas');
  tmp.width = rw; tmp.height = rh;
  const tctx = tmp.getContext('2d');
  const { mmPerPxX, mmPerPxY, cx, cy } = lensCoordsFor(rw, rh);
  const img = tctx.createImageData(rw, rh);
  const data = img.data;
  // Domain matches the lens outline. Pixels safely outside the lens disc
  // get culled here for perf; final shape is always cropped by ctx.clip()
  // at the call site (lens path).
  for (let py = 0; py < rh; py++) {
    for (let px = 0; px < rw; px++) {
      const xMm = (px - cx) * mmPerPxX;
      const yMm = (py - cy) * mmPerPxY;
      if (Math.abs(xMm) > 32 || Math.abs(yMm) > 22) {
        data[(py * rw + px) * 4 + 3] = 0;
        continue;
      }
      const cyl = sampleUnwantedCyl(xMm, yMm, geom);
      const t = clamp(cyl / REFERENCE_CYL, 0, 1);
      // Perceptual response curve (t^0.65) — compresses the dynamic range
      // so low-cyl regions (premium grades) still show visible heat instead
      // of fading to transparent. Real progressive lenses always have
      // peripheral cyl (Minkwitz theorem), so the visualization should
      // reflect that — every grade has SOME visible distortion.
      const tVis = Math.pow(t, 0.65);
      const [R, G, B] = paletteSample('iso', tVis);
      const alpha = Math.round(tVis * 215 * 0.95);
      const i = (py * rw + px) * 4;
      data[i] = R; data[i + 1] = G; data[i + 2] = B; data[i + 3] = alpha;
    }
  }
  tctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, W, H);
}

export function paletteSample(name, t) {
  const stops = ({
    iso: [
      [0.00, [50, 60, 160]],
      [0.18, [70, 130, 210]],
      [0.40, [190, 220, 110]],
      [0.65, [250, 200, 90]],
      [0.85, [220, 110, 100]],
      [1.00, [150, 50, 130]],
    ],
  })[name] || [[0,[0,0,0]],[1,[255,255,255]]];
  let i = 0;
  while (i < stops.length - 1 && t > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i];
  const [t1, c1] = stops[Math.min(i + 1, stops.length - 1)];
  const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * u),
    Math.round(c0[1] + (c1[1] - c0[1]) * u),
    Math.round(c0[2] + (c1[2] - c0[2]) * u),
  ];
}

// Marching-squares iso-cyl contours. Uses ABSOLUTE D levels (default
// ISO_LEVELS_D), so contours visibly expand with ADD/Rx.
export function drawIsoLines(canvas, geom, opts = {}) {
  const { levels = ISO_LEVELS_D, color = 'rgba(15,23,42,0.55)', lineWidth = 0.9 } = opts;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const { mmPerPxX, mmPerPxY, cx, cy } = lensCoordsFor(W, H);
  const step = 2;
  const cols = Math.ceil(W / step) + 1;
  const rows = Math.ceil(H / step) + 1;
  const field = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = c * step, py = r * step;
      const xMm = (px - cx) * mmPerPxX, yMm = (py - cy) * mmPerPxY;
      if (Math.abs(xMm) > 32 || Math.abs(yMm) > 22) { field[r * cols + c] = -1; continue; }
      field[r * cols + c] = sampleUnwantedCyl(xMm, yMm, geom);
    }
  }
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  for (const lvl of levels) {
    ctx.beginPath();
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const i = r * cols + c;
        const a = field[i], b = field[i + 1], cc = field[i + cols], d = field[i + cols + 1];
        if (a < 0 || b < 0 || cc < 0 || d < 0) continue;
        const code = (a > lvl ? 1 : 0) | (b > lvl ? 2 : 0) | (d > lvl ? 4 : 0) | (cc > lvl ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const x0 = c * step, y0 = r * step;
        const lerp = (v1, v2) => (lvl - v1) / (v2 - v1);
        const t = lerp(a, b), rgt = lerp(b, d), bt = lerp(cc, d), lf = lerp(a, cc);
        const top    = [x0 + t * step, y0];
        const right  = [x0 + step, y0 + rgt * step];
        const bottom = [x0 + bt * step, y0 + step];
        const left   = [x0, y0 + lf * step];
        const seg = (p1, p2) => { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); };
        switch (code) {
          case 1: case 14: seg(left, top); break;
          case 2: case 13: seg(top, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(bottom, right); break;
          case 6: case 9:  seg(top, bottom); break;
          case 7: case 8:  seg(left, bottom); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 10: seg(top, right); seg(left, bottom); break;
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Schematic overlay on top of the heatmap:
//   - Cyan ↔ arrow showing the WIDTH of the distance clear zone
//   - Amber ↔ arrow showing the WIDTH of the near clear zone
//   - Two orange dashed side curves showing the corridor's pinch (narrow at
//     mid-corridor, wider at top/bottom)
//   - Faint corridor center, fitting cross, eye label
//
// All dimensions are driven by the actual geom values, so the schematic
// shrinks/widens as grade·ADD·corridor change — matching the heatmap.
export function drawZoneBands(canvas, geom) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const { mmPerPxX, mmPerPxY, cx, cy } = lensCoordsFor(W, H);

  // Vertical positions for the arrows (lens-mm coords)
  const distYMm = -10;   // upper-mid distance zone
  const nearYMm = 12;    // lower-mid near zone
  const distY = cy + distYMm / mmPerPxY;
  const nearY = cy + nearYMm / mmPerPxY;

  const distHalfPx = geom.distanceHalfMm / mmPerPxX;
  const nearHalfPx = geom.nearHalfMm     / mmPerPxX;
  const corHalfPx  = geom.corridorHalfMm / mmPerPxX;

  // Scale UI elements to canvas size so they look right on Section 3 minis too
  const lineW = Math.max(1.0, Math.min(2.0, W / 200));
  const arrowSize = Math.max(4, Math.min(10, W / 50));
  const showLabels = W >= 260;
  const labelFont = Math.max(8, Math.min(11, W / 30));

  ctx.save();

  // ── Faint corridor center vertical
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, H * 0.10);
  ctx.lineTo(cx, H * 0.92);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Side corridor boundary curves (orange dashed) — shape pinches at
  // the corridor mid-point, widening at distance (top) and near (bottom).
  drawCorridorSides(ctx, cx, distY, nearY, cy, distHalfPx, corHalfPx, nearHalfPx, lineW);

  // ── Distance zone width arrow (cyan)
  drawHArrow(ctx, cx, distY, distHalfPx, 'rgb(125, 211, 252)', lineW, arrowSize);
  if (showLabels) {
    ctx.font = `700 ${labelFont}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgb(125, 211, 252)';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;
    ctx.fillText('원용 시야', cx, distY - arrowSize - 2);
    ctx.shadowBlur = 0;
  }

  // ── Near zone width arrow (amber)
  drawHArrow(ctx, cx, nearY, nearHalfPx, 'rgb(251, 191, 36)', lineW, arrowSize);
  if (showLabels) {
    ctx.fillStyle = 'rgb(251, 191, 36)';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;
    ctx.fillText('근용 시야', cx, nearY + arrowSize + labelFont * 0.9);
    ctx.shadowBlur = 0;
  }

  // ── Fitting cross (lens optical center)
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
  ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
  ctx.stroke();

  // ── Eye label (top-left, only on bigger canvases)
  if (geom && geom.eye && W >= 200) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `700 ${Math.max(9, Math.min(11, W/30))}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 3;
    ctx.fillText(geom.eye === 'OD' ? 'OD · 우안' : 'OS · 좌안', 18, 22);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// Horizontal double-headed arrow centered at (cx, y), spanning ±halfPx.
function drawHArrow(ctx, cx, y, halfPx, color, lineW, arrowSize) {
  if (halfPx < arrowSize * 1.5) return;  // skip if too narrow to render meaningfully
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineW;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 3;
  // Shaft
  ctx.beginPath();
  ctx.moveTo(cx - halfPx + arrowSize, y);
  ctx.lineTo(cx + halfPx - arrowSize, y);
  ctx.stroke();
  // Left arrowhead
  ctx.beginPath();
  ctx.moveTo(cx - halfPx, y);
  ctx.lineTo(cx - halfPx + arrowSize, y - arrowSize * 0.55);
  ctx.lineTo(cx - halfPx + arrowSize, y + arrowSize * 0.55);
  ctx.closePath();
  ctx.fill();
  // Right arrowhead
  ctx.beginPath();
  ctx.moveTo(cx + halfPx, y);
  ctx.lineTo(cx + halfPx - arrowSize, y - arrowSize * 0.55);
  ctx.lineTo(cx + halfPx - arrowSize, y + arrowSize * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Two dashed orange side curves connecting (distHalfPx @ distY) → (corHalfPx @ cy)
// → (nearHalfPx @ nearY). Curves "pinch" at the corridor center.
function drawCorridorSides(ctx, cx, distY, nearY, cy, distHalfPx, corHalfPx, nearHalfPx, lineW) {
  ctx.save();
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
  ctx.lineWidth = lineW * 0.95;
  ctx.setLineDash([Math.max(2, lineW * 2), Math.max(2, lineW * 1.5)]);
  ctx.lineCap = 'round';

  // Left side
  ctx.beginPath();
  ctx.moveTo(cx - distHalfPx, distY);
  ctx.bezierCurveTo(
    cx - distHalfPx * 0.55, (distY + cy) / 2,
    cx - corHalfPx * 1.4,   cy - 4,
    cx - corHalfPx,         cy
  );
  ctx.bezierCurveTo(
    cx - corHalfPx * 1.4,   cy + 4,
    cx - nearHalfPx * 0.65, (cy + nearY) / 2,
    cx - nearHalfPx,        nearY
  );
  ctx.stroke();

  // Right side (mirror)
  ctx.beginPath();
  ctx.moveTo(cx + distHalfPx, distY);
  ctx.bezierCurveTo(
    cx + distHalfPx * 0.55, (distY + cy) / 2,
    cx + corHalfPx * 1.4,   cy - 4,
    cx + corHalfPx,         cy
  );
  ctx.bezierCurveTo(
    cx + corHalfPx * 1.4,   cy + 4,
    cx + nearHalfPx * 0.65, (cy + nearY) / 2,
    cx + nearHalfPx,        nearY
  );
  ctx.stroke();
  ctx.restore();
}
