// v3 Drag handles — the tool's first-class input (PRD §7 B군).
//   · drag glasses vertically   → OH  (fitting height, ±4mm)
//   · drag glasses horizontally → VD  (vertex distance, 8~16mm — mapped along
//                                      the head's forward axis on screen)
//   · drag head vertically      → head pitch (B9 고개 숙임, −28°~+12°)
//   · double-tap glasses        → OH/VD reset to standard
//
// OrbitControls conflict handling (research §9.3): raycast FIRST on
// pointerdown; when we claim the gesture we set controls.enabled=false and
// restore on pointerup. Horizontal drags on the head are left to orbit.

import * as THREE from 'three';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function attachDragHandles({ stage, glassesGroup, headMesh, getFit, onFitChange, homeView }) {
  const el = stage.renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // Tooltip
  const tip = document.createElement('div');
  Object.assign(tip.style, {
    position: 'fixed', zIndex: 30, pointerEvents: 'none', display: 'none',
    padding: '6px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: '700',
    fontFamily: "'Pretendard', system-ui, sans-serif",
    background: 'rgba(16,19,26,0.85)', color: '#fff', backdropFilter: 'blur(6px)',
    whiteSpace: 'nowrap',
  });
  document.body.appendChild(tip);
  let tipTimer = 0;

  function showTip(x, y, text) {
    tip.style.display = 'block';
    tip.style.left = (x + 14) + 'px';
    tip.style.top = (y - 34) + 'px';
    tip.textContent = text;
    clearTimeout(tipTimer);
  }
  function hideTipSoon() {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { tip.style.display = 'none'; }, 650);
  }

  // Head forward (+z) direction on screen — gives the sign for VD drags.
  function forwardScreenSign() {
    const a = new THREE.Vector3(0, 0, 0).project(stage.camera);
    const b = new THREE.Vector3(0, 0, 0.1).project(stage.camera);
    const dx = b.x - a.x;
    return Math.abs(dx) < 0.01 ? 0 : Math.sign(dx);
  }

  let drag = null;   // { target:'glasses'|'head', axis:null|'v'|'h', x0,y0, fit0, pitch0 }
  let lastTapTime = 0;
  let lastEmptyTapTime = 0;
  const active = new Set();   // 활성 포인터 — 2개 이상이면 카메라 팬/줌 제스처

  function hitTest(e) {
    const rect = el.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, stage.camera);
    if (raycaster.intersectObject(glassesGroup, true).length) return 'glasses';
    if (headMesh && raycaster.intersectObject(headMesh, true).length) return 'head';
    return null;
  }

  function onDown(e) {
    active.add(e.pointerId);
    // 두 손가락 이상 = 카메라 팬/줌 → 핸들 조작을 양보하고 OrbitControls가 전담.
    if (active.size >= 2) {
      drag = null;
      stage.controls.enabled = true;
      return;
    }
    if (!e.isPrimary) return;
    // 우/중 마우스 버튼은 팬 전용(OrbitControls) — 핸들이 가로채지 않음.
    if (e.button !== 0) return;
    const target = hitTest(e);
    if (!target) {
      // Double-tap empty space → home ¾ view (C5)
      const now = performance.now();
      if (homeView && now - lastEmptyTapTime < 320) {
        stage.camera.position.set(...homeView.pos);
        stage.controls.target.set(...homeView.tgt);
        stage.controls.update();
        lastEmptyTapTime = 0;
        return;
      }
      lastEmptyTapTime = now;
      return;
    }

    // Double-tap on glasses → reset OH/VD
    if (target === 'glasses') {
      const now = performance.now();
      if (now - lastTapTime < 320) {
        onFitChange({ oh: 0, vd: 12 });
        showTip(e.clientX, e.clientY, 'OH·VD 표준 복귀');
        hideTipSoon();
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
      stage.controls.enabled = false;   // glasses drags always claim the gesture
    }

    drag = {
      target, axis: null,
      x0: e.clientX, y0: e.clientY,
      fit0: { ...getFit() },
      vdSign: forwardScreenSign(),
    };
  }

  function onMove(e) {
    if (!drag || !e.isPrimary || active.size >= 2) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;

    if (!drag.axis) {
      if (Math.hypot(dx, dy) < 7) return;
      drag.axis = Math.abs(dy) >= Math.abs(dx) ? 'v' : 'h';
      if (drag.target === 'head') {
        if (drag.axis === 'v') stage.controls.enabled = false;   // claim: head pitch
        else { drag = null; return; }                            // horizontal → orbit
      }
    }

    if (drag.target === 'glasses') {
      if (drag.axis === 'v') {
        // 0.045 mm per px — 90px ≈ 4mm full range
        const oh = clamp(drag.fit0.oh - dy * 0.045, -4, 4);
        onFitChange({ oh: Math.round(oh * 10) / 10 });
        showTip(e.clientX, e.clientY, `OH ${oh >= 0 ? '+' : ''}${oh.toFixed(1)}mm (표준 0)`);
      } else {
        const sign = drag.vdSign || 1;
        const vd = clamp(drag.fit0.vd + sign * dx * 0.05, 0, 20);
        onFitChange({ vd: Math.round(vd * 10) / 10 });
        showTip(e.clientX, e.clientY, `정점간거리 ${vd.toFixed(1)}mm (표준 12)`);
      }
    } else if (drag.target === 'head' && drag.axis === 'v') {
      const pitch = clamp(drag.fit0.headPitch - dy * 0.28, -28, 12);
      onFitChange({ headPitch: Math.round(pitch) });
      showTip(e.clientX, e.clientY, `고개 ${pitch <= 0 ? '숙임 ' : '들기 +'}${Math.abs(pitch).toFixed(0)}°`);
    }
  }

  function onUp(e) {
    active.delete(e.pointerId);
    if (active.size > 0) return;   // 손가락이 남아 있으면(멀티터치) 유지
    if (drag) { drag = null; hideTipSoon(); }
    stage.controls.enabled = true;
  }

  el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  return {
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      tip.remove();
    },
  };
}
