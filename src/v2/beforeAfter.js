// 🅑 Before/After slider — "이렇게 보일 거예요"
// A real-world photo split by a draggable divider; left side renders the
// scene through BP10 lens distortion, right side through BP50.
//
// Distortion model — uses the actual optical helper field to drive a
// canvas-based variable-blur composite. For each side:
//   1. Draw the sharp photo full-size.
//   2. For each blur stop (4/12/24px), draw a blurred copy masked by a
//      radial alpha gradient sized to that grade's clear-zone scale.
// The result: BP10 has narrow sharp center + wide soft periphery;
// BP50 has a wide sharp area + minor periphery fuzz.

import { state, update, subscribe } from '../wavefront/state.js';
import { getGrade } from '../optics/grades.js';
import { getGeom } from '../wavefront/helpers.js';
import { geomFor } from './geom.js?v=13';

const PHOTOS = [
  { id: 'driving', label: '운전 시점', src: 'scenes/driving.png' },
];

export function mountBeforeAfter(parent) {
  const stage = document.createElement('div');
  stage.className = 'ba-stage';
  stage.innerHTML = `
    <div class="ba-layer ba-layer-left">
      <canvas data-role="cv-left"></canvas>
    </div>
    <div class="ba-layer ba-layer-right" data-role="layer-right">
      <canvas data-role="cv-right"></canvas>
    </div>
    <div class="ba-label ba-label-left">
      <span class="ba-label-grade">BP10</span>
      <span class="ba-label-desc">일반형 · Conventional</span>
    </div>
    <div class="ba-label ba-label-right">
      <span class="ba-label-grade">BP50</span>
      <span class="ba-label-desc">AI 듀얼 · Top tier</span>
    </div>
    <div class="ba-divider" data-role="divider"></div>
    <div class="ba-handle" data-role="handle">
      <svg viewBox="0 0 24 24"><path d="M9 6 L4 12 L9 18 M15 6 L20 12 L15 18"/></svg>
    </div>
    <div class="ba-foot">
      <div class="ba-foot-tip">← 좌우로 슬라이드 →</div>
      <div class="ba-foot-photo" data-role="photos"></div>
    </div>
  `;
  parent.appendChild(stage);

  const refs = {};
  stage.querySelectorAll('[data-role]').forEach(n => { refs[n.dataset.role] = n; });

  // Photo selector buttons
  const photoRow = refs.photos;
  PHOTOS.forEach(p => {
    const b = document.createElement('button');
    b.className = 'ba-foot-photo-btn';
    b.textContent = p.label;
    b.dataset.id = p.id;
    b.dataset.active = String(state.baPhoto === p.id);
    b.addEventListener('click', () => update({ baPhoto: p.id }));
    photoRow.appendChild(b);
  });

  // Load image once
  let img = new Image();
  let imgReady = false;
  img.onload = () => { imgReady = true; redraw(); };
  img.src = PHOTOS[0].src;

  // Render the scene with grade-specific peripheral distortion.
  // Strategy: draw sharp scene + a single screen-space blurred copy
  // masked by a radial gradient (alpha=0 in clear center, alpha=1 in
  // periphery). Size of the clear region grows with grade.clearZoneScale.
  function renderSide(cv, gradeId) {
    if (!imgReady) return;
    const w = cv.width, h = cv.height;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // Sharp base
    ctx.drawImage(img, 0, 0, w, h);

    // Build a blurred copy on a tmp canvas
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    const g = getGrade(gradeId);
    // BP10 → high peripheral blur ~22px; BP50 → mild ~5px
    const blurPx = 5 + (1 - (g.id - 1) / 4) * 17;
    tctx.filter = `blur(${blurPx}px)`;
    tctx.drawImage(img, 0, 0, w, h);

    // Radial mask: alpha=0 (transparent) inside clear-zone radius,
    // alpha=1 (opaque blur) outside. BP50 wide / BP10 narrow.
    //   scale: 0.45 .. 0.85 of half-height
    const scale = g.clearZoneScale;            // 0.95 .. 1.30
    const clearRadius = 0.18 + (scale - 0.95) * 0.55; // 0.18 .. 0.36 of min(w,h)
    const inner = Math.max(w, h) * clearRadius;
    const outer = Math.max(w, h) * (clearRadius + 0.30);
    const cx = w * 0.50;
    const cy = h * 0.55;     // bias toward lower-center (corridor is below optical center)
    const grad = tctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    tctx.globalCompositeOperation = 'destination-in';
    tctx.fillStyle = grad;
    tctx.fillRect(0, 0, w, h);
    tctx.globalCompositeOperation = 'source-over';

    // Composite
    ctx.drawImage(tmp, 0, 0);

    // Subtle peripheral chromatic-aberration-like tint (premium feel of bad lens)
    if (gradeId <= 2) {
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.globalCompositeOperation = 'overlay';
      const cag = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer * 1.3);
      cag.addColorStop(0, 'rgba(0,0,0,0)');
      cag.addColorStop(1, 'rgba(255,80,40,1)');
      ctx.fillStyle = cag;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  function fitCanvases() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    [refs['cv-left'], refs['cv-right']].forEach(c => {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.style.width = '100%';
      c.style.height = '100%';
    });
  }

  function redraw() {
    fitCanvases();
    renderSide(refs['cv-left'], 1);   // BP10
    renderSide(refs['cv-right'], 5);  // BP50
    setSlider(state.baSliderPct);
  }

  function setSlider(pct) {
    pct = Math.max(0, Math.min(100, pct));
    refs.divider.style.left = pct + '%';
    refs.handle.style.left = pct + '%';
    refs['layer-right'].style.clipPath = `inset(0 0 0 ${pct}%)`;
  }

  // Drag interaction
  let dragging = false;
  function pctFromEvt(e) {
    const r = stage.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    return (x / r.width) * 100;
  }
  function onDown(e) {
    dragging = true;
    update({ baSliderPct: pctFromEvt(e) });
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    update({ baSliderPct: pctFromEvt(e) });
    e.preventDefault();
  }
  function onUp() { dragging = false; }
  stage.addEventListener('mousedown', onDown);
  stage.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);

  // React to state changes
  let lastSliderPct = state.baSliderPct;
  function applyState(s) {
    refs.photos.querySelectorAll('button').forEach(b => {
      b.dataset.active = String(s.baPhoto === b.dataset.id);
    });
    if (s.baSliderPct !== lastSliderPct) {
      setSlider(s.baSliderPct);
      lastSliderPct = s.baSliderPct;
    }
  }
  const unsub = subscribe(applyState);

  // Setup
  requestAnimationFrame(() => {
    fitCanvases();
    if (imgReady) redraw();
  });
  window.addEventListener('resize', redraw);

  return {
    el: stage,
    update: applyState,
    dispose: () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('resize', redraw);
      unsub?.();
    },
  };
}
