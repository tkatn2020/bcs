// LensBox — single lens viewport with mock scene + variable-blur compositing
// + morphing iso contours.
//
// Visual stack (z-order, bottom → top):
//   [1] Sharp scene background (CSS, full clarity)
//   [2] Blur layer @ 4px,  masked to cyl ≥ 0.25 D     (cyl-driven alpha)
//   [3] Blur layer @ 12px, masked to cyl ≥ 0.50 D
//   [4] Blur layer @ 28px, masked to cyl ≥ 1.20 D     (heavy distortion)
//   [5] Heat overlay canvas (palette + iso contours, lens-clipped)
//   [6] White lens outline (SVG)
//
// On every config change, the current cyl FIELD is sampled, and over 450ms
// the heat + masks tween from the previous field to the new one — making
// iso contours visibly "breathe" outward as ADD/grade changes.

import { buildEnvironmentScene } from './environments.js';
import { sampleCylField, lerpField, paintHeatField, buildBlurMaskDataURL } from './heatRenderer.js';

const LENS_PATH = 'M 60,184 C 60,69 187,23 360,23 C 533,23 660,69 660,193 C 660,313 562,414 360,414 C 158,414 60,313 60,184 Z';

function lensPath2D(W, H) {
  const sx = W / 720, sy = H / 440;
  const p = new Path2D();
  const x = v => v * sx, y = v => v * sy;
  p.moveTo(x(60), y(184));
  p.bezierCurveTo(x(60), y(69),  x(187), y(23),  x(360), y(23));
  p.bezierCurveTo(x(533), y(23), x(660), y(69),  x(660), y(193));
  p.bezierCurveTo(x(660), y(313), x(562), y(414), x(360), y(414));
  p.bezierCurveTo(x(158), y(414), x(60),  y(313), x(60),  y(184));
  p.closePath();
  return p;
}

// CSS clip-path: path() interprets coordinates as CSS pixels (NOT viewBox).
// We scale the LENS_PATH coords to the actual element size so the blur
// layers' clip exactly matches the SVG frame outline (which uses
// preserveAspectRatio="none" to stretch to the box). Without this scaling
// the blur would leak well past the visible frame on non-720×440 boxes.
function scaledLensPathStr(W, H) {
  const sx = W / 720, sy = H / 440;
  const f = (a, b) => `${(a * sx).toFixed(2)},${(b * sy).toFixed(2)}`;
  return `M ${f(60, 184)} C ${f(60, 69)} ${f(187, 23)} ${f(360, 23)}` +
         ` C ${f(533, 23)} ${f(660, 69)} ${f(660, 193)}` +
         ` C ${f(660, 313)} ${f(562, 414)} ${f(360, 414)}` +
         ` C ${f(158, 414)} ${f(60, 313)} ${f(60, 184)} Z`;
}

function buildSceneBg(opts = {}) {
  const { environment = 'driving', blur = false, distort = false, mirror = false } = opts;
  return buildEnvironmentScene(environment, { blur, distort, mirror });
}

// Simplified BINARY single-layer model — user explicit preference.
// One blur layer with uniform 12 px blur, activated wherever cyl > 0.5 D
// (emerald ISO contour boundary). The hi=0.51 provides 0.01 D smoothstep
// purely for anti-aliasing; visually the transition is sharp at 0.5 D.
//
// Trade-off: cyl 1.0/2.0 D regions get the same blur as cyl 0.6 D regions
// (no intensity gradient). In exchange: 1:1 visual correspondence between
// the emerald ISO contour and the blur boundary — "안쪽=clear, 바깥쪽=blur"
// matches what customers intuitively understand from the contour line.
// Score formula, recommendation, AR shader unchanged — gradient detail
// preserved in those, just simplified in the heatmap blur visualization.
const BLUR_STOPS = [
  { blur: 16, lo: 0.50, hi: 0.51 },
];

const MORPH_MS = 250;   // was 450 — halves morph rendering work on iPad

// Mask URL cache — keyed on (width|height|fieldChecksum|lo|hi). Skipping
// regeneration when the same field signature recurs is a big win during
// the morph tween (many intermediate fields, but on quick repeated Rx
// changes the start/end fields often match a recent computation).
const _maskUrlCache = new Map();
const MASK_URL_CACHE_MAX = 120;
function fieldChecksum(field) {
  // Lightweight hash — sample 8 well-distributed cells. Sufficient to
  // distinguish distinct fields without scanning the entire array.
  // CRITICAL: field is { cols, rows, data: Float32Array }. Indexing
  // field.length / field[idx] returns undefined → checksum was always
  // 'x' → mask URL cache key was constant → blur mask was generated
  // ONCE and never updated despite field changes. This was THE bug
  // causing "ISO contour moves but blur stays" symptom across all
  // recent visual fixes.
  if (!field || !field.data || !field.data.length) return 'x';
  const data = field.data;
  const n = data.length;
  let h = 0;
  for (let i = 0; i < 8; i++) {
    const idx = Math.floor((i + 0.5) * n / 8);
    h = ((h << 5) - h + Math.round(data[idx] * 1000)) | 0;
  }
  return h.toString(36);
}
function cachedBlurMaskUrl(field, w, h, lo, hi) {
  const key = `${w}|${h}|${fieldChecksum(field)}|${lo}|${hi}`;
  const hit = _maskUrlCache.get(key);
  if (hit) return hit;
  const url = buildBlurMaskDataURL(field, w, h, lo, hi);
  if (_maskUrlCache.size >= MASK_URL_CACHE_MAX) _maskUrlCache.clear();
  _maskUrlCache.set(key, url);
  return url;
}

export function createLensBox(width, height, initialGeom, opts = {}) {
  const {
    showIso = true, showBands = true, showMarkings = false, lensStroke = true,
    environment = 'driving', mirror = false,
  } = opts;
  let currentGeom = initialGeom;
  let currentOpts = { showIso, showBands, showMarkings, environment, mirror };

  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'relative', width: `${width}px`, height: `${height}px`,
    background: '#0a0e14', overflow: 'hidden', borderRadius: '8px',
    flexShrink: '0',
  });

  // [1] Sharp scene
  let sceneLayer = buildSceneBg({ environment });
  el.appendChild(sceneLayer);

  // [2-4] Blur layers (built dynamically; clipped to lens shape).
  // clipPath uses the SCALED path so it exactly matches the rendered SVG
  // frame at any width/height (was using raw 720×440 coords, which leaked
  // blur past the frame on non-720×440 boxes).
  const clipStr = scaledLensPathStr(width, height);
  const blurLayers = BLUR_STOPS.map((stop) => {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'absolute', inset: '0',
      clipPath: `path("${clipStr}")`,
      WebkitClipPath: `path("${clipStr}")`,
      pointerEvents: 'none',
    });
    const inner = buildSceneBg({ environment });
    Object.assign(inner.style, {
      filter: `blur(${stop.blur}px)`,
      WebkitFilter: `blur(${stop.blur}px)`,
      transform: 'scale(1.0)',  // no scale — clipPath does the masking
    });
    wrap.appendChild(inner);
    el.appendChild(wrap);
    return { wrap, inner, stop };
  });

  // [5] Heat overlay canvas
  const heat = document.createElement('canvas');
  heat.width = width; heat.height = height;
  Object.assign(heat.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none',
    width: `${width}px`, height: `${height}px`,
  });
  el.appendChild(heat);

  // [6] Lens outline — thin metallic frame matching real eyeglasses
  if (lensStroke) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', '0 0 720 440');
    svg.setAttribute('preserveAspectRatio', 'none');
    Object.assign(svg.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'visible' });

    // Outer frame ring — dark metallic
    const outer = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    outer.setAttribute('d', LENS_PATH);
    outer.setAttribute('fill', 'none');
    outer.setAttribute('stroke', '#1a1a1d');
    outer.setAttribute('stroke-width', '6');
    outer.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(outer);

    // Inner highlight — subtle metallic gloss
    const inner = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    inner.setAttribute('d', LENS_PATH);
    inner.setAttribute('fill', 'none');
    inner.setAttribute('stroke', 'rgba(255,255,255,0.18)');
    inner.setAttribute('stroke-width', '1');
    inner.setAttribute('transform', 'translate(0, 1)');
    svg.appendChild(inner);

    el.appendChild(svg);
  }

  // Field state for morphing
  let prevField = sampleCylField(width, height, currentGeom, 0.7);
  let nextField = prevField;
  let morphStart = 0;
  let morphRaf = 0;

  // Reused tmp canvas for heat painting — avoids allocating + GC churn
  // every frame of the morph tween (was creating ~27 canvases per Rx change
  // per lens before this).
  const tmp = document.createElement('canvas');
  tmp.width = width; tmp.height = height;
  const tmpCtx = tmp.getContext('2d');
  const heatCtx = heat.getContext('2d');
  const lensClip = lensPath2D(width, height);

  function applyMasks(field) {
    blurLayers.forEach(({ wrap, stop }) => {
      const url = cachedBlurMaskUrl(field, width, height, stop.lo, stop.hi);
      wrap.style.maskImage = `url(${url})`;
      wrap.style.webkitMaskImage = `url(${url})`;
      wrap.style.maskSize = '100% 100%';
      wrap.style.webkitMaskSize = '100% 100%';
      wrap.style.maskRepeat = 'no-repeat';
      wrap.style.webkitMaskRepeat = 'no-repeat';
    });
  }

  function paintHeat(field) {
    heatCtx.clearRect(0, 0, width, height);
    tmpCtx.clearRect(0, 0, width, height);
    paintHeatField(tmp, field, {
      drawIso: currentOpts.showIso,
      drawBands: currentOpts.showBands,
      drawMarkings: currentOpts.showMarkings,
      geom: currentGeom,
      eye: currentOpts.mirror ? 'OS' : 'OD',
    });
    heatCtx.save();
    heatCtx.clip(lensClip);
    heatCtx.drawImage(tmp, 0, 0);
    heatCtx.restore();
  }

  function tick(ts) {
    const t = Math.min(1, (ts - morphStart) / MORPH_MS);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const field = t >= 1 ? nextField : lerpField(prevField, nextField, eased);
    paintHeat(field);
    applyMasks(field);
    if (t < 1) morphRaf = requestAnimationFrame(tick);
    else { morphRaf = 0; prevField = nextField; }
  }

  function startMorph() {
    if (morphRaf) cancelAnimationFrame(morphRaf);
    nextField = sampleCylField(width, height, currentGeom, 0.7);
    morphStart = performance.now();
    morphRaf = requestAnimationFrame(tick);
  }

  function rebuildScenes() {
    const env = currentOpts.environment;
    const newSharp = buildSceneBg({ environment: env });
    sceneLayer.replaceWith(newSharp);
    sceneLayer = newSharp;
    blurLayers.forEach(({ wrap, stop }) => {
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      const inner = buildSceneBg({ environment: env });
      Object.assign(inner.style, {
        filter: `blur(${stop.blur}px)`,
        WebkitFilter: `blur(${stop.blur}px)`,
        transform: 'scale(1.0)',
      });
      wrap.appendChild(inner);
    });
  }

  function update(geom, optsPatch = {}) {
    if (geom) currentGeom = geom;
    const oldEnv = currentOpts.environment;
    Object.assign(currentOpts, optsPatch);
    if (optsPatch.environment && optsPatch.environment !== oldEnv) {
      rebuildScenes();
    }
    startMorph();
  }

  const onPhotosChanged = () => { rebuildScenes(); startMorph(); };
  window.addEventListener('wf:photos-changed', onPhotosChanged);

  // Initial paint
  paintHeat(prevField);
  applyMasks(prevField);

  return { el, update, paint: () => paintHeat(prevField) };
}

// Two LensBox side-by-side with a "nose bridge".
export function createBinocularLenses(totalWidth, height, odGeom, osGeom, opts = {}) {
  const { gap = 18 } = opts;
  const lensW = Math.floor((totalWidth - gap) / 2);

  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex', gap: `${gap}px`, position: 'relative',
    width: `${totalWidth}px`,
  });

  const os = createLensBox(lensW, height, osGeom, { ...opts, mirror: true });
  wrap.appendChild(os.el);

  // Bridge — metallic nose piece matching frame color
  const bridge = document.createElement('div');
  Object.assign(bridge.style, {
    position: 'absolute', left: '50%', top: '14%',
    transform: 'translateX(-50%)',
    width: `${gap + 24}px`, height: '6px',
    background: 'linear-gradient(180deg, #2a2a2e 0%, #1a1a1d 50%, #0e0e10 100%)',
    borderRadius: '3px',
    boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 1px 2px rgba(0,0,0,0.3)',
    zIndex: '5',
  });
  wrap.appendChild(bridge);

  // Temple hinges — small metallic blocks on outer edges
  const hingeL = document.createElement('div');
  Object.assign(hingeL.style, {
    position: 'absolute', left: '0', top: '32%',
    width: '8px', height: '14px',
    background: 'linear-gradient(90deg, #0e0e10 0%, #2a2a2e 100%)',
    borderRadius: '2px 0 0 2px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
    zIndex: '5',
  });
  wrap.appendChild(hingeL);

  const hingeR = document.createElement('div');
  Object.assign(hingeR.style, {
    position: 'absolute', right: '0', top: '32%',
    width: '8px', height: '14px',
    background: 'linear-gradient(270deg, #0e0e10 0%, #2a2a2e 100%)',
    borderRadius: '0 2px 2px 0',
    boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
    zIndex: '5',
  });
  wrap.appendChild(hingeR);

  const od = createLensBox(lensW, height, odGeom, { ...opts, mirror: false });
  wrap.appendChild(od.el);

  function update({ od: odG, os: osG, opts: optsPatch } = {}) {
    if (osG) os.update(osG, optsPatch);
    if (odG) od.update(odG, optsPatch);
  }

  return { el: wrap, update, lensW };
}
