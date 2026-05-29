// LensBox — single lens viewport rendered as a ZEISS-style geometric warp.
//
// WebGL displacement of the scene texture, driven by the unwanted-cyl optical
// model (warpShader.js). Replaces the previous heatmap + multi-layer blur +
// ISO contour visualization. Center corridor stays sharp; periphery warps
// progressively with ADD/Rx/grade/corridor — matching the ZEISS reference.
//
// Visual stack (z-order, bottom → top):
//   [1] WebGL canvas (warped scene, clipped to lens shape)
//   [2] SVG lens outline (metallic frame)
//
// On config change, geom uniforms morph (lerp) over MORPH_MS for a smooth
// transition — cheap, since only uniforms update (no CPU field/mask work).

import { loadSceneTexture, invalidateSceneTexture } from './environments.js';
import { createWarpGL, LENS_2D } from './warpShader.js';

const LENS_PATH = 'M 60,184 C 60,69 187,23 360,23 C 533,23 660,69 660,193 C 660,313 562,414 360,414 C 158,414 60,313 60,184 Z';

// CSS clip-path: scales LENS_PATH coords to the actual element size so the
// warped canvas is clipped exactly to the visible frame outline.
function scaledLensPathStr(W, H) {
  const sx = W / 720, sy = H / 440;
  const f = (a, b) => `${(a * sx).toFixed(2)},${(b * sy).toFixed(2)}`;
  return `M ${f(60, 184)} C ${f(60, 69)} ${f(187, 23)} ${f(360, 23)}` +
         ` C ${f(533, 23)} ${f(660, 69)} ${f(660, 193)}` +
         ` C ${f(660, 313)} ${f(562, 414)} ${f(360, 414)}` +
         ` C ${f(158, 414)} ${f(60, 313)} ${f(60, 184)} Z`;
}

const MORPH_MS = 150;
const DPR = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);

// Numeric geom fields that morph (lerp) on transition. `eye` is fixed per lens.
const LERP_FIELDS = [
  'peakCyl', 'distanceHalfMm', 'corridorHalfMm', 'nearHalfMm',
  'falloffMm', 'sphere', 'cylinder', 'axis',
];
function lerpGeom(a, b, t) {
  const out = { eye: b.eye ?? a.eye };
  for (const k of LERP_FIELDS) {
    const av = a[k] ?? 0, bv = b[k] ?? 0;
    out[k] = av + (bv - av) * t;
  }
  return out;
}

export function createLensBox(width, height, initialGeom, opts = {}) {
  let currentOpts = { environment: 'driving', ...opts };

  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'relative', width: `${width}px`, height: `${height}px`,
    background: '#0a0e14', overflow: 'hidden', borderRadius: '8px',
    flexShrink: '0',
  });

  // [1] WebGL warp canvas — clipped to lens shape
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0',
    width: `${width}px`, height: `${height}px`,
    clipPath: `path("${scaledLensPathStr(width, height)}")`,
    WebkitClipPath: `path("${scaledLensPathStr(width, height)}")`,
    pointerEvents: 'none',
  });
  el.appendChild(canvas);

  const warp = createWarpGL(canvas);
  if (warp.ok) {
    warp.resize(Math.round(width * DPR), Math.round(height * DPR));
    warp.setMapping(LENS_2D);
    warp.setGeom(initialGeom);
  }

  // [2] Lens outline — metallic frame (same as before)
  if (opts.lensStroke !== false) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', '0 0 720 440');
    svg.setAttribute('preserveAspectRatio', 'none');
    Object.assign(svg.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'visible' });
    const outer = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    outer.setAttribute('d', LENS_PATH);
    outer.setAttribute('fill', 'none');
    outer.setAttribute('stroke', '#1a1a1d');
    outer.setAttribute('stroke-width', '6');
    outer.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(outer);
    const inner = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    inner.setAttribute('d', LENS_PATH);
    inner.setAttribute('fill', 'none');
    inner.setAttribute('stroke', 'rgba(255,255,255,0.18)');
    inner.setAttribute('stroke-width', '1');
    inner.setAttribute('transform', 'translate(0, 1)');
    svg.appendChild(inner);
    el.appendChild(svg);
  }

  // ── Scene texture (async load) ───────────────────────────────────
  let sceneReady = false;
  function loadScene() {
    loadSceneTexture(currentOpts.environment).then(({ source, width: tw, height: th }) => {
      if (!warp.ok) return;
      warp.setScene(source, tw, th);
      sceneReady = true;
      warp.render();
    });
  }
  loadScene();

  // ── Morph state ──────────────────────────────────────────────────
  let prevGeom = { ...initialGeom };
  let targetGeom = { ...initialGeom };
  let morphStart = 0;
  let raf = 0;
  let alive = true;

  function tick(ts) {
    if (!alive || !warp.ok) return;
    const t = Math.min(1, (ts - morphStart) / MORPH_MS);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    warp.setGeom(lerpGeom(prevGeom, targetGeom, eased));
    if (sceneReady) warp.render();
    if (t < 1) raf = requestAnimationFrame(tick);
    else { raf = 0; prevGeom = { ...targetGeom }; }
  }
  function startMorph() {
    if (!warp.ok) return;
    if (raf) cancelAnimationFrame(raf);
    morphStart = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function update(geom, optsPatch = {}) {
    const oldEnv = currentOpts.environment;
    Object.assign(currentOpts, optsPatch);
    if (geom) targetGeom = { ...geom };
    if (optsPatch.environment && optsPatch.environment !== oldEnv) {
      sceneReady = false;
      loadScene();
    }
    startMorph();
  }

  const onPhotosChanged = () => { invalidateSceneTexture(currentOpts.environment); sceneReady = false; loadScene(); };
  window.addEventListener('wf:photos-changed', onPhotosChanged);

  function dispose() {
    alive = false;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('wf:photos-changed', onPhotosChanged);
    if (warp.ok) {
      warp.dispose();
      const ext = warp.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }

  return { el, update, paint: () => { if (sceneReady && warp.ok) warp.render(); }, dispose };
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

  // Bridge — metallic nose piece
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

  function dispose() {
    os.dispose();
    od.dispose();
  }

  return { el: wrap, update, lensW, dispose };
}
