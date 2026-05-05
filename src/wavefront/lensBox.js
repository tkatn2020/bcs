// LensBox — a single lens viewport with mock scene + wavefront heat overlay.
// Lightweight (no Three.js): scene as inline divs, heat as canvas.

import { renderField, drawIsoLines, drawZoneBands, ISO_LEVELS_D } from './helpers.js';
import { buildEnvironmentScene } from './environments.js';

// Lens shape — used for the visible white outline AND for clipping the heat
// overlay so they always coincide. Path is in viewBox 720×440.
const LENS_PATH = 'M 60,184 C 60,69 187,23 360,23 C 533,23 660,69 660,193 C 660,313 562,414 360,414 C 158,414 60,313 60,184 Z';

// Same path, programmatically rebuilt as a Path2D scaled to the canvas size.
// Keep IN SYNC with LENS_PATH above (one source of truth — the SVG path).
function lensPath2D(W, H, mirror = false) {
  const sx = W / 720, sy = H / 440;
  const p = new Path2D();
  // Anchor points from LENS_PATH:
  // M 60,184  C 60,69  187,23  360,23
  //           C 533,23 660,69  660,193
  //           C 660,313 562,414 360,414
  //           C 158,414 60,313 60,184  Z
  const x = mirror ? (v => (720 - v) * sx) : (v => v * sx);
  const y = v => v * sy;
  p.moveTo(x(60), y(184));
  p.bezierCurveTo(x(60), y(69),  x(187), y(23),  x(360), y(23));
  p.bezierCurveTo(x(533), y(23), x(660), y(69),  x(660), y(193));
  p.bezierCurveTo(x(660), y(313), x(562), y(414), x(360), y(414));
  p.bezierCurveTo(x(158), y(414), x(60),  y(313), x(60),  y(184));
  p.closePath();
  return p;
}

// Scene factory — currently delegates to environments.js (driving/outdoor/indoor).
function buildSceneBg(opts = {}) {
  const { environment = 'driving', blur = false, distort = false, mirror = false } = opts;
  return buildEnvironmentScene(environment, { blur, distort, mirror });
}

// Build a LensBox DOM tree. Returns { el, update(geom, opts) }.
//   width/height: pixel size
//   geom: from getGeom(...)
//   opts: { mirror, showIso, showBands, lensStroke, environment }
export function createLensBox(width, height, initialGeom, opts = {}) {
  const {
    mirror = false, showIso = true, showBands = true, lensStroke = true,
    environment = 'driving',
  } = opts;
  let currentGeom = initialGeom;
  let currentOpts = { showIso, showBands, environment };

  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'relative', width: `${width}px`, height: `${height}px`,
    background: '#0f172a', overflow: 'hidden', borderRadius: '8px',
    flexShrink: '0',
  });

  // Layer 1: background scene (undistorted, "looking past the lens edge")
  // Both eyes see the SAME world from the patient's POV — no scene mirroring.
  // The eye-specific corridor asymmetry is captured in the heatmap layer
  // (sampleUnwantedCyl flips xLocal when eye === 'OS').
  let sceneLayer = buildSceneBg({ environment });
  el.appendChild(sceneLayer);

  // Layer 2: lens-clipped scene (fake "through-the-lens" softening via CSS blur)
  const clipped = document.createElement('div');
  Object.assign(clipped.style, {
    position: 'absolute', inset: '0',
    clipPath: `path("${LENS_PATH}")`,
    WebkitClipPath: `path("${LENS_PATH}")`,
  });
  let clippedScene = buildSceneBg({ environment, blur: true, distort: true });
  clipped.appendChild(clippedScene);
  el.appendChild(clipped);

  // Layer 3: heat overlay canvas (the wavefront visualization)
  const heat = document.createElement('canvas');
  heat.width = width;
  heat.height = height;
  Object.assign(heat.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none',
    width: `${width}px`, height: `${height}px`,
  });
  el.appendChild(heat);

  // Layer 4: lens outline (for visual frame)
  if (lensStroke) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', '0 0 720 440');
    svg.setAttribute('preserveAspectRatio', 'none');
    Object.assign(svg.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none',
    });
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', LENS_PATH);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'rgba(255,255,255,0.85)');
    path.setAttribute('stroke-width', '1.4');
    svg.appendChild(path);
    el.appendChild(svg);
  }

  function paint() {
    if (!currentGeom) return;
    const W = heat.width, H = heat.height;
    const ctx = heat.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // Render heat + iso + bands onto a temporary canvas (no clipping).
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    renderField(tmp, currentGeom);
    if (currentOpts.showIso) {
      drawIsoLines(tmp, currentGeom, {
        levels: ISO_LEVELS_D,
        color: 'rgba(15,23,42,0.55)',
        lineWidth: 0.9,
      });
    }
    if (currentOpts.showBands) drawZoneBands(tmp, currentGeom);

    // Composite onto the visible heat canvas, clipped to the SAME lens
    // path as the white outline → outline and heatmap always coincide.
    // The lens shape is symmetric, so no need to mirror the path itself.
    ctx.save();
    ctx.clip(lensPath2D(W, H));
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }

  function update(geom, optsPatch = {}) {
    if (geom) currentGeom = geom;
    const oldEnv = currentOpts.environment;
    Object.assign(currentOpts, optsPatch);
    if (optsPatch.environment && optsPatch.environment !== oldEnv) {
      const newScene = buildSceneBg({ environment: currentOpts.environment });
      const newClippedScene = buildSceneBg({ environment: currentOpts.environment, blur: true, distort: true });
      sceneLayer.replaceWith(newScene);
      sceneLayer = newScene;
      clipped.removeChild(clippedScene);
      clipped.appendChild(newClippedScene);
      clippedScene = newClippedScene;
    }
    requestAnimationFrame(paint);
  }

  // Listen for photo uploads/clears — rebuild scene layers in place
  const onPhotosChanged = () => {
    const newScene = buildSceneBg({ environment: currentOpts.environment });
    const newClippedScene = buildSceneBg({ environment: currentOpts.environment, blur: true, distort: true });
    sceneLayer.replaceWith(newScene);
    sceneLayer = newScene;
    if (clippedScene.parentNode === clipped) clipped.removeChild(clippedScene);
    clipped.appendChild(newClippedScene);
    clippedScene = newClippedScene;
  };
  window.addEventListener('wf:photos-changed', onPhotosChanged);

  // Initial paint
  if (currentGeom) requestAnimationFrame(paint);

  return { el, update, paint };
}

// Two LensBox side-by-side with a "nose bridge" — full binocular view.
export function createBinocularLenses(totalWidth, height, odGeom, osGeom, opts = {}) {
  const { gap = 18 } = opts;
  const lensW = Math.floor((totalWidth - gap) / 2);

  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex', gap: `${gap}px`, position: 'relative',
    width: `${totalWidth}px`,
  });

  // OS on the left (wearer's left = our left when looking at them); mirrored
  const os = createLensBox(lensW, height, osGeom, { ...opts, mirror: true });
  wrap.appendChild(os.el);

  // Nose bridge
  const bridge = document.createElement('div');
  Object.assign(bridge.style, {
    position: 'absolute', left: '50%', top: '20%',
    transform: 'translateX(-50%)',
    width: '24px', height: '4px', background: '#475569', borderRadius: '2px',
  });
  wrap.appendChild(bridge);

  // OD on the right
  const od = createLensBox(lensW, height, odGeom, { ...opts, mirror: false });
  wrap.appendChild(od.el);

  function update({ od: odG, os: osG, opts: optsPatch } = {}) {
    if (osG) os.update(osG, optsPatch);
    if (odG) od.update(odG, optsPatch);
  }

  return { el: wrap, update, lensW };
}
