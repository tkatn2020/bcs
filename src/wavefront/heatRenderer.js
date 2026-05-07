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

import { sampleUnwantedCyl, ISO_LEVELS_D, paletteSample, REFERENCE_CYL, clamp } from './helpers.js';

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
      const t = clamp(cyl / REFERENCE_CYL, 0, 1);
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
  // Soft upscale: use a one-pass Gaussian (matched to the mask blur radius)
  // so heat cell seams melt into each other, exactly aligning with the
  // softened blur masks. Without this, you can see the low-res cell grid
  // peeking through where the palette is most saturated.
  const cellPx = W / cols;
  const blurPx = Math.max(2.5, cellPx * 0.7);
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(tmp, 0, 0, W, H);
  ctx.filter = 'none';

  if (drawIso) drawIsoLinesFromField(canvas, field, ISO_LEVELS_D);
  if (drawBands) drawZoneArrowsFromField(canvas, field, { eye: opts.eye || 'OD' });
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

  const ARROW_LEVEL = 0.25;
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

  // Side zone labels (left edge) — small caps with color dots
  if (W >= 220) {
    const sideX = 10;
    const sideFont = Math.max(8, Math.min(10, W / 32));
    ctx.font = `600 ${sideFont}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 3;
    const drawTag = (color, label, y) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(sideX + 3, y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(label, sideX + 10, y + sideFont * 0.35);
    };
    drawTag(C_DIST, '원거리',  (H * 0.10 + divUpperY) / 2);
    drawTag(C_MID,  '중간거리', (divUpperY + divLowerY) / 2);
    drawTag(C_NEAR, '근거리',  (divLowerY + H * 0.92) / 2);
    ctx.shadowBlur = 0;
  }

  // Eye label (right edge so it doesn't collide with zone tags)
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

// Marching squares on an arbitrary field (for tweened iso morphing).
export function drawIsoLinesFromField(canvas, field, levels) {
  const W = canvas.width, H = canvas.height;
  const { cols, rows, data } = field;
  const ctx = canvas.getContext('2d');
  // Iterate at canvas-scale for crisp lines but sample bilinearly from low-res field.
  const step = Math.max(2, Math.round(W / 220));
  const sx = (cols - 1) / W;
  const sy = (rows - 1) / H;

  ctx.save();
  ctx.strokeStyle = 'rgba(20,19,15,0.30)';
  ctx.lineWidth = 0.8;
  for (const lvl of levels) {
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
  // Soften the mask: large Gaussian blur (≈ 3× cell size) so the upscaled
  // mask edges blend continuously across many cells. Combined with overlapping
  // BLUR_STOPS in lensBox, this eliminates the visible tile artifacts at
  // high-cyl periphery — the mask alpha gradient now smears across a region
  // far wider than any individual cell.
  // Aggressive: blur the mask across many cells so layer transitions
  // span a region many times the cell size — kills any perceptible edge.
  const blurPx = Math.max(20, Math.round(W / field.cols * 6.0));
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
