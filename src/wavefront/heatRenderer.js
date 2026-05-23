// Variable-blur scene compositor + iso-contour morphing.
//
// Pipeline:
//   1. Render a CYL FIELD (Float32Array of D values) at low resolution,
//      sampled from sampleUnwantedCyl. This is THE source of truth.
//   2. Build N progressively-blurred copies of the scene as DOM layers.
//   3. For each layer, generate a Canvas-based mask image where alpha
//      ramps with cyl crossing the layer's threshold. Apply via CSS
//      mask-image (data URL).
//   4. The heat canvas paints the iso contours by sampling a TWEENED
//      field (prev → next over 450ms) for animated morphing.

import { sampleUnwantedCyl, ISO_LEVELS_D, paletteSample, REFERENCE_CYL, CYL_CLEAR_THRESHOLD, clamp } from './helpers.js';

// Lens coord helper — must match helpers.js (LENS_X_FRAC etc).
const LENS_X_FRAC = 600 / 720;
const LENS_Y_FRAC = 391 / 440;
const LENS_CY_FRAC = (23 + 414) / 2 / 440;
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

// Sample a cyl field across the canvas (low-res, smooth). Returns a Float32Array
// row-major at (cols × rows).
export function sampleCylField(W, H, geom, scale = 0.4) {
  const cols = Math.max(2, Math.round(W * scale));
  const rows = Math.max(2, Math.round(H * scale));
  const { mmPerPxX, mmPerPxY, cx, cy } = lensCoordsFor(cols, rows);
  const out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const xMm = (c - cx) * mmPerPxX;
      const yMm = (r - cy) * mmPerPxY;
      out[r * cols + c] = sampleUnwantedCyl(xMm, yMm, geom);
    }
  }
  return { cols, rows, data: out };
}

// Linear interpolate two cyl fields (must be same dims). Returns new field.
export function lerpField(a, b, t) {
  const data = new Float32Array(a.data.length);
  for (let i = 0; i < data.length; i++) {
    data[i] = a.data[i] + (b.data[i] - a.data[i]) * t;
  }
  return { cols: a.cols, rows: a.rows, data };
}

// Bilinear sample of a field at fractional (col, row).
function sampleField(field, c, r) {
  const { cols, rows, data } = field;
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(c)));
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(r)));
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const fc = c - c0, fr = r - r0;
  const a = data[r0 * cols + c0];
  const b = data[r0 * cols + c1];
  const cv = data[r1 * cols + c0];
  const d = data[r1 * cols + c1];
  return a * (1 - fc) * (1 - fr) + b * fc * (1 - fr) + cv * (1 - fc) * fr + d * fc * fr;
}

// Heat overlay: paints the cyl-magnitude palette + (optional) iso contours
// by sampling a (possibly tweened) cyl field — NOT geom. So caller passes
// a field, not a geom directly.
export function paintHeatField(canvas, field, opts = {}) {
  const { drawIso = true, drawBands = false, geomForBands = null, eye = 'OD' } = opts;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Render heat at low res (matches field), then upscale.
  const { cols, rows, data } = field;
  const tmp = document.createElement('canvas');
  tmp.width = cols; tmp.height = rows;
  const tctx = tmp.getContext('2d');
  const img = tctx.createImageData(cols, rows);
  const buf = img.data;
  // Lens disc cull at low-res
  const { mmPerPxX, mmPerPxY, cx: lcx, cy: lcy } = lensCoordsFor(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const xMm = (c - lcx) * mmPerPxX;
      const yMm = (r - lcy) * mmPerPxY;
      const i = (r * cols + c) * 4;
      if (Math.abs(xMm) > 32 || Math.abs(yMm) > 22) {
        buf[i + 3] = 0; continue;
      }
      const cyl = data[r * cols + c];
      // Dead zone: cyl ≤ CYL_CLEAR_THRESHOLD (0.25 D) renders fully transparent —
      // the cyan ISO contour becomes the clear/blur boundary. Past 0.25 D, color
      // alpha ramps from 0 up through the (REFERENCE_CYL - threshold) range.
      const cylEff = Math.max(0, cyl - CYL_CLEAR_THRESHOLD);
      const t = clamp(cylEff / (REFERENCE_CYL - CYL_CLEAR_THRESHOLD), 0, 1);
      // Gentler exponent (0.85 vs 0.65) — color rises more gradually
      // through the cyl range, avoiding an early saturation plateau that
      // makes the high-cyl region read as a solid block with a hard edge.
      const tVis = Math.pow(t, 0.85);
      const [R, G, B] = paletteSample('iso', tVis);
      buf[i] = R; buf[i + 1] = G; buf[i + 2] = B;
      // Lower max alpha (~50% of previous) — heat overlay should TINT
      // the scene, not paint over it. The blur layers carry most of the
      // visual signal; the heat just adds zonal awareness.
      buf[i + 3] = Math.round(tVis * 130);
    }
  }
  tctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  // Soft upscale matched to the mask blur radius (see buildBlurMaskDataURL).
  // Heat color edges and blur mask edges share the SAME effective blur,
  // so the visible color gradient and the visible blur gradient line up
  // pixel-for-pixel. Tightened from (12, 4.0) → (4, 1.5) so the visible
  // edge stays within ~1.5 cells of the ISO contour position instead of
  // dilating ~5 cells outward — keeps ISO/blur/heat visually coincident.
  const blurPx = Math.max(4, Math.round(W / cols * 1.5));
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(tmp, 0, 0, W, H);
  ctx.filter = 'none';

  // Skip iso contours strictly inside the dead zone (< CYL_CLEAR_THRESHOLD),
  // keep contours from the threshold outward. With threshold = 0.5 D, the
  // emerald 0.5 D line itself remains visible as the clear/blur boundary,
  // while the now-redundant 0.25 D cyan line is suppressed. 1.0/2.0 D lines
  // continue to mark the distortion gradient outside.
  if (drawIso) drawIsoLinesFromField(canvas, field, ISO_LEVELS_D.filter(l => l >= CYL_CLEAR_THRESHOLD));
  if (drawBands) drawZoneArrowsFromField(canvas, field, { eye: opts.eye || 'OD' });
  if (opts.drawMarkings) drawProgressiveMarkings(canvas, opts.geom, { eye: opts.eye || 'OD' });
}

// Progressive lens manufacturing markings — the ink/engraving pattern any
// optician sees when checking a real progressive lens. Drawn as a training
// overlay so staff learn the standard reference points + how they relate
// to the optical model.
//
// Layout — calibrated to the in-house BP brand (자사 PB 누진다초점):
//   BP design spec: DRP (원용 아이포인트) ↔ PRP (프리즘 측정점) = 3 mm
//   This is a "compressed" layout — shorter than the typical 4–8 mm
//   industry default, so the wearer's distance gaze sits very close to
//   the optical center. Because the DRP–PRP gap is so tight, the Fitting
//   Cross is intentionally NOT drawn separately (it would visually overlap
//   the DRP circle), matching BP's actual ink-mark pattern.
//
//   • DRP  (Distance Reference Point) — open ○, 3 mm above PRP (BP spec)
//   • PRP  (Prism Reference Point)    — small open ○ at optical center
//   • Side alignment dashes           — ±17 mm from PRP (engraved marks)
//   • Corridor dots                   — between DRP and NRP, with nasal inset
//   • NRP  (Near Reference Point)     — rounded rectangle, at corridor-
//                                       length below PRP, slight nasal inset
//   • ADD label                       — current gauging power, below NRP
export function drawProgressiveMarkings(canvas, geom, opts = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const { mmPerPxX, mmPerPxY, cx, cy } = lensCoordsFor(W, H);
  const mmX = mm => mm / mmPerPxX;
  const mmY = mm => mm / mmPerPxY;
  const px = (xm, ym) => [cx + mmX(xm), cy + mmY(ym)];

  const corridorMm = (geom && geom.corridor) ? geom.corridor : 12;
  const DRP_OFFSET = -3;                  // BP brand spec: DRP–PRP = 3 mm
  const NRP_OFFSET = corridorMm + 1;
  const SIDE_MARK_X = 17;
  // Nasal inset: positive x = toward nose for OD (right eye), negative for OS.
  const nasalSign = opts.eye === 'OS' ? -1 : 1;
  const NASAL_INSET = nasalSign * 0.5;

  const showLabels = W >= 220;
  const labelFont = Math.max(8, Math.min(10, W / 32));

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.fillStyle   = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 2.5;

  // 1. PRP — small open circle at optical center
  {
    const [x, y] = px(0, 0);
    ctx.beginPath();
    ctx.arc(x, y, mmX(0.6), 0, Math.PI * 2);
    ctx.stroke();
  }

  // 2. DRP — open circle, 3 mm above PRP (BP brand spec).
  //    Diameter ≈ 2.4 mm — sized so it doesn't overlap the PRP dot below
  //    it, yet remains the visually dominant top marking.
  {
    const [x, y] = px(0, DRP_OFFSET);
    ctx.beginPath();
    ctx.arc(x, y, mmX(1.2), 0, Math.PI * 2);
    ctx.stroke();
    if (showLabels) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = `700 ${labelFont}px var(--font-num), ui-sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('DRP · 원용', x + mmX(1.7), y + 3);
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
    }
  }

  // 3. Corridor dots — from just below PRP down to just above NRP,
  //    gradually inset toward the nose (BP design follows industry standard
  //    convergence inset of ~0.5 mm at the near reading position).
  {
    const start = 1.5;
    const end = NRP_OFFSET - 2.5;
    const dotCount = 4;
    for (let i = 0; i < dotCount; i++) {
      const t = (i + 0.5) / dotCount;
      const yMm = start + (end - start) * t;
      const xMm = NASAL_INSET * t;
      const [x, y] = px(xMm, yMm);
      ctx.beginPath();
      ctx.arc(x, y, 1.0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 4. NRP — rounded rectangle ~6×4mm at corridor-length below PRP
  {
    const [x, y] = px(NASAL_INSET, NRP_OFFSET);
    const halfW = mmX(3.0);
    const halfH = mmY(2.0);
    const r = mmX(0.7);
    ctx.beginPath();
    roundedRect(ctx, x - halfW, y - halfH, halfW * 2, halfH * 2, r);
    ctx.stroke();
    if (showLabels) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = `700 ${labelFont}px var(--font-num), ui-sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('NRP · 근용', x + halfW + 4, y + 3);
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
    }
  }

  // 5. Side alignment dashes — ±17mm horizontal (real engravings)
  {
    const len = mmX(2.2);
    ctx.lineWidth = 0.95;
    for (const xs of [-SIDE_MARK_X, SIDE_MARK_X]) {
      const [x, y] = px(xs, 0);
      ctx.beginPath();
      ctx.moveTo(x - len, y); ctx.lineTo(x + len, y);
      ctx.stroke();
    }
  }

  // 6. ADD label below NRP — shows current gauging power
  if (geom && typeof geom.add === 'number') {
    const [x, y] = px(0, NRP_OFFSET + 3.8);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `700 ${labelFont + 1}px var(--font-num), ui-sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`ADD +${geom.add.toFixed(2)}`, x, y);
  }

  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

// Schematic arrows that EXACTLY trace the 0.25 D iso contour at the
// canonical distance / near gaze rows — derived from the same cyl field
// the heatmap and iso contours come from, so they always coincide.
//
// Replaces the old geometric `drawZoneBands` which used independent half-width
// parameters (geom.distanceHalfMm / nearHalfMm) — those didn't match the
// actual ramp/falloff cyl model and caused the orange dashes to drift away
// from the iso contours visually. This version measures the plateau width
// directly from the field and draws the arrows at that exact width, plus
// dashed side curves connecting (distance plateau) → (corridor pinch) →
// (near plateau) along the same iso contour.
export function drawZoneArrowsFromField(canvas, field, opts = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');

  // Arrows measure plateau width at CYL_CLEAR_THRESHOLD (emerald ISO contour
  // = visible clear/blur boundary), not the now-suppressed 0.25 D cyan line.
  // Aligns arrow widths with what the customer perceives as the clear zone.
  const ARROW_LEVEL = CYL_CLEAR_THRESHOLD;
  // Three canonical zones — match ZONE_GAZE_Y_MM in helpers.js
  const distYMm = -10;   // 원거리
  const midYMm  =   3;   // 중간거리
  const nearYMm =  12;   // 근거리

  const dist = plateauHalfWidthsAtY(field, distYMm, ARROW_LEVEL);
  const mid  = plateauHalfWidthsAtY(field, midYMm,  ARROW_LEVEL);
  const near = plateauHalfWidthsAtY(field, nearYMm, ARROW_LEVEL);

  const mmPerPxX = LENS_W_MM / (W * LENS_X_FRAC);
  const mmPerPxY = LENS_H_MM / (H * LENS_Y_FRAC);
  const cx = W / 2;
  const cy = H * LENS_CY_FRAC;
  const distY = cy + distYMm / mmPerPxY;
  const midY  = cy + midYMm  / mmPerPxY;
  const nearY = cy + nearYMm / mmPerPxY;

  const distLPx = dist.leftMm  / mmPerPxX, distRPx = dist.rightMm / mmPerPxX;
  const midLPx  = mid.leftMm   / mmPerPxX, midRPx  = mid.rightMm  / mmPerPxX;
  const nearLPx = near.leftMm  / mmPerPxX, nearRPx = near.rightMm / mmPerPxX;

  const lineW = Math.max(1.0, Math.min(2.0, W / 200));
  const arrowSize = Math.max(4, Math.min(10, W / 50));
  const showLabels = W >= 260;
  const labelFont = Math.max(8, Math.min(11, W / 30));

  // Zone divider rows (between zones, in lens coords)
  const divUpperYMm = (distYMm + midYMm) / 2;   // -3.5 mm
  const divLowerYMm = (midYMm + nearYMm) / 2;   //  7.5 mm
  const divUpperY = cy + divUpperYMm / mmPerPxY;
  const divLowerY = cy + divLowerYMm / mmPerPxY;

  // Match ZONE_COLORS in helpers.js (panel score colors)
  const C_DIST = '#3b82f6'; // 원거리 blue
  const C_MID  = '#22c55e'; // 중간거리 green
  const C_NEAR = '#f59e0b'; // 근거리 amber

  ctx.save();

  // ── Color zone bands (semi-transparent overlays) ──
  // Subtle colored regions matching the right-panel score colors. Replaces
  // the previous orange dashed corridor curves which competed visually with
  // the colored arrows. Each band is rendered at very low opacity so the
  // underlying heat / driving scene reads through clearly; the goal is just
  // to give customers a color-keyed sense of which area is which.
  const lensTop    = H * 0.06;
  const lensBottom = H * 0.94;
  ctx.fillStyle = 'rgba(59, 130, 246, 0.07)';   // blue (distance)
  ctx.fillRect(0, lensTop, W, divUpperY - lensTop);
  ctx.fillStyle = 'rgba(34, 197, 94, 0.07)';    // green (intermediate)
  ctx.fillRect(0, divUpperY, W, divLowerY - divUpperY);
  ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';   // amber (near)
  ctx.fillRect(0, divLowerY, W, lensBottom - divLowerY);

  // Faint horizontal zone dividers — colored hairlines now (not white dash)
  // so they read as zone boundaries that match the bands' colors.
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.45)';   // upper divider — green tint
  ctx.beginPath();
  ctx.moveTo(W * 0.04, divUpperY); ctx.lineTo(W * 0.96, divUpperY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';  // lower divider — amber tint
  ctx.beginPath();
  ctx.moveTo(W * 0.04, divLowerY); ctx.lineTo(W * 0.96, divLowerY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Center vertical (corridor center) — kept as a thin guide
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 0.6;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, H * 0.10); ctx.lineTo(cx, H * 0.92);
  ctx.stroke();
  ctx.setLineDash([]);
  // (Removed: drawSideCurves orange corridor outline — replaced by colored
  // zone bands above. The arrows alone now carry the per-zone width info.)

  // Distance arrow + label
  drawAsymHArrow(ctx, cx - distLPx, cx + distRPx, distY, C_DIST, lineW, arrowSize);
  if (showLabels && (distLPx + distRPx) > arrowSize * 4) {
    ctx.font = `700 ${labelFont}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = C_DIST;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3;
    ctx.fillText('원거리', cx, distY - arrowSize - 2);
    ctx.shadowBlur = 0;
  }

  // Intermediate arrow + label
  drawAsymHArrow(ctx, cx - midLPx, cx + midRPx, midY, C_MID, lineW, arrowSize);
  if (showLabels && (midLPx + midRPx) > arrowSize * 4) {
    ctx.font = `700 ${labelFont}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = C_MID;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3;
    ctx.fillText('중간거리', cx, midY - arrowSize - 2);
    ctx.shadowBlur = 0;
  }

  // Near arrow + label
  drawAsymHArrow(ctx, cx - nearLPx, cx + nearRPx, nearY, C_NEAR, lineW, arrowSize);
  if (showLabels && (nearLPx + nearRPx) > arrowSize * 4) {
    ctx.font = `700 ${labelFont}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = C_NEAR;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3;
    ctx.fillText('근거리', cx, nearY + arrowSize + labelFont * 0.9);
    ctx.shadowBlur = 0;
  }

  // Fitting cross
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
  ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
  ctx.stroke();

  // Eye label (right edge — side zone tags previously here removed; clipped
  // by lens curve and visually noisy. Center arrows/labels still cover zones.)
  if (opts.eye && W >= 200) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `700 ${Math.max(9, Math.min(11, W/30))}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'right';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3;
    ctx.fillText(opts.eye === 'OD' ? 'OD · 우안' : 'OS · 좌안', W - 14, 22);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// Asymmetric horizontal arrow from xL to xR at row y.
function drawAsymHArrow(ctx, xL, xR, y, color, lineW, arrowSize) {
  const span = xR - xL;
  if (span < arrowSize * 3) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineW;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.moveTo(xL + arrowSize, y); ctx.lineTo(xR - arrowSize, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(xL, y);
  ctx.lineTo(xL + arrowSize, y - arrowSize * 0.55);
  ctx.lineTo(xL + arrowSize, y + arrowSize * 0.55);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(xR, y);
  ctx.lineTo(xR - arrowSize, y - arrowSize * 0.55);
  ctx.lineTo(xR - arrowSize, y + arrowSize * 0.55);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawSideCurves(ctx, cx, distY, corY, nearY,
                        distL, distR, corL, corR, nearL, nearR, lineW) {
  ctx.save();
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
  ctx.lineWidth = lineW * 0.95;
  ctx.setLineDash([Math.max(2, lineW * 2), Math.max(2, lineW * 1.5)]);
  ctx.lineCap = 'round';
  // Left curve
  ctx.beginPath();
  ctx.moveTo(cx - distL, distY);
  ctx.bezierCurveTo(cx - distL * 0.65, (distY + corY) / 2,
                    cx - corL * 1.25,   corY - 4,
                    cx - corL,          corY);
  ctx.bezierCurveTo(cx - corL * 1.25,   corY + 4,
                    cx - nearL * 0.7,   (corY + nearY) / 2,
                    cx - nearL,         nearY);
  ctx.stroke();
  // Right curve
  ctx.beginPath();
  ctx.moveTo(cx + distR, distY);
  ctx.bezierCurveTo(cx + distR * 0.65, (distY + corY) / 2,
                    cx + corR * 1.25,   corY - 4,
                    cx + corR,          corY);
  ctx.bezierCurveTo(cx + corR * 1.25,   corY + 4,
                    cx + nearR * 0.7,   (corY + nearY) / 2,
                    cx + nearR,         nearY);
  ctx.stroke();
  ctx.restore();
}

// Per-level iso contour style — color/width/dash communicate severity at
// a glance. Customers can interpret without legends:
//   cyan thin solid     → "선명 한계 (0.25 D)"  [suppressed — inside dead zone]
//   emerald solid       → "선명시역 경계 (0.50 D)"
//   amber thin dashed   → "약한 흐림 (0.75 D)"
//   orange dashed       → "흐림 시작 (1.0 D)"
//   coral thick + glow  → "심각 왜곡 (2.0 D)"
// Keyed by the exact level value (matches ISO_LEVELS_D).
const ISO_STYLES = {
  0.25: { color: '#06b6d4', width: 1.2, dash: [],     glow: 0 },
  0.5:  { color: '#10b981', width: 1.4, dash: [],     glow: 0 },
  0.75: { color: '#fbbf24', width: 1.0, dash: [3, 2], glow: 0 },
  1:    { color: '#f97316', width: 1.6, dash: [5, 3], glow: 0 },
  2:    { color: '#ef4444', width: 2.2, dash: [],     glow: 8 },
};

// Marching squares on an arbitrary field (for tweened iso morphing).
export function drawIsoLinesFromField(canvas, field, levels) {
  const W = canvas.width, H = canvas.height;
  const { cols, rows, data } = field;
  const ctx = canvas.getContext('2d');
  // Iterate at canvas-scale for crisp lines but sample bilinearly from low-res field.
  const step = Math.max(2, Math.round(W / 220));
  const sx = (cols - 1) / W;
  const sy = (rows - 1) / H;

  // Draw severity ascending so the more dramatic lines (coral, glow)
  // paint LAST and sit on top of any crossing thinner lines.
  const ordered = [...levels].sort((a, b) => a - b);

  ctx.save();
  for (const lvl of ordered) {
    const style = ISO_STYLES[lvl] || { color: 'rgba(20,19,15,0.40)', width: 0.8, dash: [], glow: 0 };
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(style.dash);
    if (style.glow) {
      ctx.shadowColor = style.color;
      ctx.shadowBlur = style.glow;
    } else {
      ctx.shadowBlur = 0;
    }

    ctx.beginPath();
    for (let py = 0; py < H - step; py += step) {
      for (let px = 0; px < W - step; px += step) {
        const a = sampleField(field, px * sx, py * sy);
        const b = sampleField(field, (px + step) * sx, py * sy);
        const c = sampleField(field, px * sx, (py + step) * sy);
        const d = sampleField(field, (px + step) * sx, (py + step) * sy);
        const code = (a > lvl ? 1 : 0) | (b > lvl ? 2 : 0) | (d > lvl ? 4 : 0) | (c > lvl ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const lerp = (v1, v2) => (lvl - v1) / (v2 - v1);
        const top    = [px + lerp(a, b) * step, py];
        const right  = [px + step, py + lerp(b, d) * step];
        const bottom = [px + lerp(c, d) * step, py + step];
        const left   = [px, py + lerp(a, c) * step];
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
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  ctx.restore();
}

// Build a mask data URL where alpha = smoothstep(lo, hi, cyl).
// This is layered over a pre-blurred scene to make blur strength
// follow cyl magnitude (heavy blur where cyl is high).
//
// To eliminate visible blocky edges (the field is sampled at ~40% res
// and nearest-neighbor-upscaled), we apply a Gaussian blur to the mask
// itself before serializing — this smooths the alpha gradient across
// the seams between low-res cells, so the boundary between sharp and
// blurred scene fades organically into the surrounding heat.
export function buildBlurMaskDataURL(field, W, H, lo, hi) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = field.cols; tmp.height = field.rows;
  const tctx = tmp.getContext('2d');
  const img = tctx.createImageData(field.cols, field.rows);
  for (let i = 0; i < field.data.length; i++) {
    const v = field.data[i];
    const t = v <= lo ? 0 : v >= hi ? 1 : (() => {
      const u = (v - lo) / (hi - lo);
      return u * u * (3 - 2 * u);
    })();
    const a = Math.round(t * 255);
    const j = i * 4;
    img.data[j] = 255;
    img.data[j + 1] = 255;
    img.data[j + 2] = 255;
    img.data[j + 3] = a;
  }
  tctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  // Soften the mask: Gaussian blur sized to the cell so the upscaled mask
  // edges blend continuously across cells but stay tight enough to preserve
  // the cyl pattern's shape. MUST match the heat upscale blur in
  // paintHeatField — otherwise color and blur edges drift apart.
  // Tightened from (12, 4.0) → (4, 1.5) so the visible blur boundary
  // aligns with the crisp ISO contour at the same threshold.
  const blurPx = Math.max(4, Math.round(W / field.cols * 1.5));
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(tmp, 0, 0, W, H);
  ctx.filter = 'none';
  return cv.toDataURL('image/png');
}

// Same idea applied to the heat overlay: instead of nearest-neighbor
// upscaling the low-res palette image, we render it sharp then blur
// it lightly so the cells melt into each other and align with the
// soft mask edges. Caller passes a temp canvas that already holds
// the rendered heat at canvas resolution.
export function softenCanvas(canvas, blurPx) {
  if (blurPx <= 0) return;
  const W = canvas.width, H = canvas.height;
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  tmp.getContext('2d').drawImage(canvas, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(tmp, 0, 0);
  ctx.filter = 'none';
}

// Walk the cyl field at a given y (in mm), starting from x=0 outward
// each side, finding where cyl crosses `level`. Returns plateau half-widths
// in mm. If x=0 is already above level, both halves are 0.
//
// Used by the schematic arrow overlay so the orange dashes align with
// the actual iso contour, not a separate geometric model.
export function plateauHalfWidthsAtY(field, geomYMm, level) {
  // We need to translate (xMm, yMm) → (col, row) in the field.
  // Field was sampled with the same lensCoordsFor as everything else.
  const { cols, rows, data } = field;
  // Find the row index for the given yMm using lens coord math.
  const mmPerPxX = LENS_W_MM / (cols * LENS_X_FRAC);
  const mmPerPxY = LENS_H_MM / (rows * LENS_Y_FRAC);
  const cx = cols / 2;
  const cy = rows * LENS_CY_FRAC;
  const row = Math.round(cy + geomYMm / mmPerPxY);
  if (row < 0 || row >= rows) return { leftMm: 0, rightMm: 0 };
  const valAt = (col) => data[row * cols + col];
  const center = Math.round(cx);
  if (valAt(center) >= level) return { leftMm: 0, rightMm: 0 };
  // Walk right
  let rightCol = center;
  for (let c = center + 1; c < cols; c++) {
    if (valAt(c) >= level) {
      // Linear interpolate the crossing fraction between c-1 and c
      const v0 = valAt(c - 1), v1 = valAt(c);
      const frac = v1 === v0 ? 0 : (level - v0) / (v1 - v0);
      rightCol = (c - 1) + frac;
      break;
    }
    rightCol = c;
  }
  // Walk left
  let leftCol = center;
  for (let c = center - 1; c >= 0; c--) {
    if (valAt(c) >= level) {
      const v0 = valAt(c + 1), v1 = valAt(c);
      const frac = v1 === v0 ? 0 : (level - v0) / (v1 - v0);
      leftCol = (c + 1) - frac;
      break;
    }
    leftCol = c;
  }
  return {
    leftMm:  (cx - leftCol)  * mmPerPxX,
    rightMm: (rightCol - cx) * mmPerPxX,
  };
}
