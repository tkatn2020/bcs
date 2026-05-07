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

// Blur stops realigned to match heat color ramp:
// - Heat starts tinting visibly around cyl ≈ 0.25 (first iso level).
// - Heat is strongly orange/red around cyl ≈ 0.8-1.5.
// - First blur layer now starts at 0.20 (matching heat onset) so
//   visible blur tracks the visible color, eliminating the "color says
//   blurred but image is sharp" mismatch.
const BLUR_STOPS = [
  { blur: 4,  lo: 0.18, hi: 0.55 },
  { blur: 8,  lo: 0.40, hi: 0.95 },
  { blur: 14, lo: 0.70, hi: 1.40 },
  { blur: 22, lo: 1.05, hi: 1.95 },
  { blur: 32, lo: 1.55, hi: 2.70 },
];

const MORPH_MS = 450;

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

  function applyMasks(field) {
    blurLayers.forEach(({ wrap, stop }) => {
      const url = buildBlurMaskDataURL(field, width, height, stop.lo, stop.hi);
      wrap.style.maskImage = `url(${url})`;
      wrap.style.webkitMaskImage = `url(${url})`;
      wrap.style.maskSize = '100% 100%';
      wrap.style.webkitMaskSize = '100% 100%';
      wrap.style.maskRepeat = 'no-repeat';
      wrap.style.webkitMaskRepeat = 'no-repeat';
    });
  }

  function paintHeat(field) {
    const ctx = heat.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const tmp = document.createElement('canvas');
    tmp.width = width; tmp.height = height;
    paintHeatField(tmp, field, {
      drawIso: currentOpts.showIso,
      drawBands: currentOpts.showBands,
      drawMarkings: currentOpts.showMarkings,
      geom: currentGeom,
      eye: currentOpts.mirror ? 'OS' : 'OD',
    });
    ctx.save();
    ctx.clip(lensPath2D(width, height));
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
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
