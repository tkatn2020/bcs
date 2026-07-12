// v3 Fitting model — qualitative zone math (PRD §8.2).
// Pure functions: state → per-zone cone spec { h, v, pitch, len }.
//   h/v  : horizontal/vertical HALF-angles (deg) of the clear-vision cone
//   pitch: gaze declination of the zone axis (deg, negative = downward)
//   len  : visualization length (m) ≈ real working distance
//
// Directionally clinical (research-anchored, PRD §8.1), magnitudes are for
// education — calibration table to be reviewed by Joel before v1.0.
//   · grade   → zone width via grades.js clearZoneScale (BP30 = 1.15 baseline)
//   · ADD     → Minkwitz: corridor width ∝ corridorLen / ADD
//   · corridor→ longer = wider mid zone, deeper near (pitch down)

import { getGrade } from '../optics/grades.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Baseline half-angles at BP30 · ADD +2.00 · corridor 12mm
const BASE = {
  distance:     { h: 38, v: 24, pitch: -2,  len: 1.5 },
  intermediate: { h: 11, v: 8,  pitch: -15, len: 0.68 },
  near:         { h: 15, v: 10, pitch: -33, len: 0.42 },
};

export function computeZones(s) {
  const g = getGrade(s.grade);
  const gradeScale = g.clearZoneScale / 1.15;
  const add = clamp(s.add ?? 2.0, 0.75, 3.5);
  const corr = s.corridor ?? 12;

  // Minkwitz — corridor half-width ∝ corridorLen / ADD (research §8.1)
  const mink = clamp((corr / 12) * (2.0 / add), 0.45, 1.7);
  // Near zone shrinks with ADD, gentler than corridor
  const nearAdd = clamp(Math.sqrt(2.0 / add), 0.6, 1.35);
  // Longer corridor pushes near zone deeper (more downgaze)
  const nearPitchShift = (corr - 12) * 1.2;   // deg per mm

  return {
    distance: {
      h: BASE.distance.h * (0.45 + 0.55 * gradeScale),
      v: BASE.distance.v,
      pitch: BASE.distance.pitch,
      len: BASE.distance.len,
    },
    intermediate: {
      h: BASE.intermediate.h * gradeScale * mink,
      v: BASE.intermediate.v * (0.7 + 0.3 * mink),
      pitch: BASE.intermediate.pitch - nearPitchShift * 0.5,
      len: BASE.intermediate.len,
    },
    near: {
      h: BASE.near.h * gradeScale * nearAdd,
      v: BASE.near.v * (0.75 + 0.25 * nearAdd),
      pitch: BASE.near.pitch - nearPitchShift,
      len: BASE.near.len,
    },
  };
}
