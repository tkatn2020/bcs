// Lens stage — switches between the 4 display modes:
//   '2d' — binocular wavefront heatmap (default; reuses lensBox.js)
//   '3d' — Three.js rotating progressive lens
//   'ba' — Before/After photo slider with shader distortion
//   'ar' — live camera with overlaid distortion
//
// On mode change, the inner content is rebuilt; on state changes, the
// active mode's `update()` is called.

import { state, subscribe } from '../wavefront/state.js';
import { createBinocularLenses } from '../wavefront/lensBox.js';
import { geomFor } from './geom.js?v=17';
import { rxDioptricGap } from '../wavefront/helpers.js';

// Lazy imports for the non-default modes — keeps initial load light
// and isolates any module-level failures (e.g., Three.js CDN issues)
// from breaking the 2D simulator.
const lazyMods = {
  '3d': () => import('./lens3d.js?v=17').then(m => m.mountLens3D),
  'ba': () => import('./beforeAfter.js?v=17').then(m => m.mountBeforeAfter),
  'ar': () => import('./cameraAr.js?v=17').then(m => m.mountCameraAr),
};

export function mountLensStage(wrap) {
  let active = null;       // active mode handle { el, update?, dispose? }
  let activeMode = null;

  const inner = document.createElement('div');
  inner.className = 'sim-lens-inner';
  wrap.appendChild(inner);

  // 🅔 Anisometropia indicator card — floats above the stage in 2D mode
  const anisoCard = document.createElement('div');
  anisoCard.className = 'aniso-card';
  anisoCard.style.display = 'none';
  anisoCard.innerHTML = `
    <span class="aniso-card-label">좌우격차</span>
    <span class="aniso-card-val" data-role="aniso-val">0.0D</span>
    <div class="aniso-card-bar">
      <div class="aniso-card-bar-fill" data-role="aniso-fill"></div>
      <div class="aniso-card-bar-mark" style="left:18%"></div>
      <div class="aniso-card-bar-mark" style="left:36%"></div>
      <div class="aniso-card-bar-mark" style="left:54%"></div>
    </div>
  `;
  wrap.appendChild(anisoCard);

  function dispose() {
    if (active?.dispose) active.dispose();
    inner.innerHTML = '';
    active = null;
  }

  function build(mode) {
    if (mode === activeMode) return;
    dispose();
    activeMode = mode;
    if (mode === '2d') {
      active = build2D(inner);
    } else if (lazyMods[mode]) {
      // Show loading state, then mount
      inner.innerHTML = `<div class="mode-loading">로딩 중…</div>`;
      lazyMods[mode]().then(mountFn => {
        if (activeMode !== mode) return;
        inner.innerHTML = '';
        active = mountFn(inner);
        if (active?.update) active.update(state);
      }).catch(err => {
        console.error('Lazy mount failed:', err);
        inner.innerHTML = `<div class="mode-loading" style="color:#ff6">로드 실패: ${err?.message ?? mode}</div>`;
      });
    }
    refreshAniso(state);
  }

  // Initial build
  build(state.lensMode);

  // 2D dual-lens builder — sizes to fill the wrap; reused on resize.
  function build2D(parent) {
    let dual = null;
    function rebuild() {
      // Use parent (stage-col) clientWidth — `wrap.clientWidth` can grow
      // past the grid cell when the previously-built binocular widget had
      // a larger width, causing right-side clipping by stage-col's
      // overflow:hidden. Parent reflects the grid-imposed column width.
      const parentW = wrap.parentElement ? wrap.parentElement.clientWidth : wrap.clientWidth;
      const W = Math.min(wrap.clientWidth, parentW) - 20;
      const H = wrap.clientHeight - 20;
      if (W < 50 || H < 50) return;     // wrap not yet sized
      if (parent.firstChild) parent.removeChild(parent.firstChild);
      const ASPECT = 0.55;
      let w = Math.min(W, 820);          // 820 ceiling — leaves breathing room in 1280 layout
      let h = w * ASPECT;
      if (h > H) { h = H; w = h / ASPECT; }
      w = Math.max(380, Math.min(Math.round(w), W));   // never exceed available W
      h = Math.max(220, Math.round(h));
      dual = createBinocularLenses(
        w, h,
        geomFor(state, 'OD'),
        geomFor(state, 'OS'),
        { showIso: state.showIso, showBands: state.showBands, showMarkings: state.showMarkings, environment: 'driving' }
      );
      parent.appendChild(dual.el);
    }
    // Multiple attempts to handle layout settle
    requestAnimationFrame(() => requestAnimationFrame(rebuild));
    setTimeout(rebuild, 80);
    setTimeout(rebuild, 240);
    // ResizeObserver to handle late layout
    const ro = new ResizeObserver(() => {
      if (!dual && wrap.clientWidth > 50 && wrap.clientHeight > 50) rebuild();
    });
    ro.observe(wrap);
    return {
      el: parent,
      update: (s) => {
        if (!dual) { rebuild(); return; }
        const od = geomFor(s, 'OD'), os = geomFor(s, 'OS');
        // Anisometropia tilt — apply 3D-like rotation to the binocular pair
        if (s.aniso3dEnabled) {
          const dGap = rxDioptricGap(s.od, s.os);
          const tilt = Math.min(8, dGap * 2.4); // up to 8deg
          const rise = Math.min(10, dGap * 3);
          const odIsStronger = Math.abs(s.od.sphere) + Math.abs(s.od.cylinder) > Math.abs(s.os.sphere) + Math.abs(s.os.cylinder);
          const dir = odIsStronger ? 1 : -1;
          dual.el.style.transition = 'transform 320ms var(--ease)';
          dual.el.style.transform = `perspective(900px) rotateY(${dir * tilt * 0.5}deg) rotateX(${tilt * 0.2}deg) translateY(${-rise}px)`;
        } else {
          dual.el.style.transform = 'none';
        }
        dual.update({ od, os, opts: { showIso: s.showIso, showBands: s.showBands, showMarkings: s.showMarkings, environment: 'driving' } });
      },
      rebuild,
      dispose: () => { dual = null; ro.disconnect(); parent.innerHTML = ''; },
    };
  }

  function refreshAniso(s) {
    const dGap = rxDioptricGap(s.od, s.os);
    // Hide entirely when the gap is clinically negligible (<0.25 D) — the
    // card is a problem-spotter, not a vanity badge.
    const shouldShow = (activeMode === '2d' || activeMode === '3d') && dGap >= 0.25;
    anisoCard.style.display = shouldShow ? 'flex' : 'none';
    if (!shouldShow) return;
    anisoCard.querySelector('[data-role="aniso-val"]').textContent = `${dGap.toFixed(1)}D`;
    const pct = Math.min(100, (dGap / 3) * 100);
    anisoCard.querySelector('[data-role="aniso-fill"]').style.width = pct + '%';
    // Toggle warning color above clinical threshold (1.5 D)
    anisoCard.classList.toggle('is-warn', dGap > 1.5);
  }

  subscribe(s => {
    if (s.lensMode !== activeMode) build(s.lensMode);
    if (active?.update) active.update(s);
    refreshAniso(s);
  });

  // Resize → re-build 2D
  window.addEventListener('resize', () => {
    if (activeMode === '2d' && active?.rebuild) requestAnimationFrame(active.rebuild);
  });

  // First aniso paint
  refreshAniso(state);

  // Re-paint when becoming active again
  let lastTab = state.activeTab;
  subscribe(s => {
    if (s.activeTab === 'simulator' && lastTab !== 'simulator' && activeMode === '2d' && active?.rebuild) {
      requestAnimationFrame(() => requestAnimationFrame(active.rebuild));
    }
    lastTab = s.activeTab;
  });
}
