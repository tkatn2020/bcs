// v3 Direct-touch handles — the tool's first-class input (PRD §7 B군).
//
// 아바타 위의 명시적 "포인트 네비게이터" 3개로 조정한다(예전의 방향-모호
// 드래그를 전면 대체 — 어디를 잡아야 뭐가 되는지 명확, 카메라 조작과 겹치지
// 않음):
//   · 이마(고개)      → 세로 드래그(아래=숙임) = 고개 숙임/들기 (headPitch −12°~+28°, +=숙임)
//   · 양쪽 다리(VD)   → 머리 정면축 드래그 = 정점간거리 (0~20mm, 좌·우 2개)
//   · 브릿지(OH)      → 세로 드래그 = 피팅 높이 (OH, ±4mm)
//   · 핸들 더블탭     → 그 항목만 표준 복귀 (빈 공간은 순수 카메라 회전/팬)
//
// 핸들 = HTML 오버레이(pointer-events:none). 매 프레임 3D 앵커점을 화면에
// 투영해 위치·표시(정면 향함 판정)를 갱신. 잡기 판정은 캔버스 포인터다운에서
// 화면 거리로(레이캐스트 없음) → 손가락이 살짝 빗나가도 잡힘. 평소 작은 점,
// 근처 hover/터치 시 확대+라벨. 두 손가락/빈 공간은 OrbitControls가 전담.

import * as THREE from 'three';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const GRAB_R = 34;   // 잡기 반경(px)
const HOVER_R = 52;  // 데스크톱 hover 강조 반경(px)
const HND_REF_DIST = 0.5;   // 이 카메라~앵커 거리(m)에서 스케일 1 (기본 정면뷰 근사)

export function attachDragHandles({ stage, glassesGroup, headMesh, getFit, onFitChange }) {
  const el = stage.renderer.domElement;
  const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _p = new THREE.Vector3();
  const _c = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion();

  // ── Styles ──
  const style = document.createElement('style');
  style.textContent = `
    .v3hnd-layer { position: fixed; inset: 0; z-index: 20; pointer-events: none; }
    .v3hnd { position: fixed; transform: translate(-50%, -50%) scale(var(--k, 1));
      transform-origin: center;
      display: flex; align-items: center; gap: 7px; transition: opacity .15s ease; }
    .v3hnd-dot { width: 11px; height: 11px; border-radius: 50%; flex: 0 0 auto;
      background: rgba(126,140,166,0.82);
      box-shadow: 0 0 0 3px rgba(126,140,166,0.16), 0 1px 5px rgba(0,0,0,0.5);
      transition: width .12s ease, height .12s ease, background .12s ease, box-shadow .12s ease; }
    .v3hnd-lab { font: 700 11.5px 'Pretendard', system-ui, sans-serif; color: #fff;
      background: rgba(16,19,26,0.82); backdrop-filter: blur(6px);
      padding: 3px 8px; border-radius: 7px; white-space: nowrap;
      opacity: 0; transform: translateX(-5px); transition: opacity .12s ease, transform .12s ease; }
    .v3hnd.on .v3hnd-dot { width: 18px; height: 18px; background: #c2ccde;
      box-shadow: 0 0 0 5px rgba(150,164,190,0.26), 0 2px 9px rgba(0,0,0,0.6); }
    .v3hnd.on .v3hnd-lab { opacity: 1; transform: none; }
    .v3hnd.hide { opacity: 0; }
    .v3hnd-tip { position: fixed; z-index: 30; pointer-events: none; display: none;
      padding: 6px 10px; border-radius: 8px; font: 700 12px 'Pretendard', system-ui, sans-serif;
      background: rgba(16,19,26,0.88); color: #fff; backdrop-filter: blur(6px); white-space: nowrap; }
  `;
  document.head.appendChild(style);

  const layer = document.createElement('div');
  layer.className = 'v3hnd-layer';
  document.body.appendChild(layer);

  const tip = document.createElement('div');
  tip.className = 'v3hnd-tip';
  document.body.appendChild(tip);
  let tipTimer = 0;
  function showTip(x, y, text) {
    tip.style.display = 'block';
    tip.style.left = (x + 16) + 'px';
    tip.style.top = (y - 36) + 'px';
    tip.textContent = text;
    clearTimeout(tipTimer);
  }
  function hideTipSoon() {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { tip.style.display = 'none'; }, 700);
  }

  function mkHandle(labelText) {
    const h = document.createElement('div');
    h.className = 'v3hnd';
    h.innerHTML = `<span class="v3hnd-dot"></span><span class="v3hnd-lab">${labelText}</span>`;
    layer.appendChild(h);
    return h;
  }

  // world unit-direction from an object-local direction (for facing test)
  function dirWorld(obj, x, y, z) {
    obj.getWorldQuaternion(_q);
    return _n.set(x, y, z).applyQuaternion(_q).normalize();
  }

  // 안경 +z(정면)의 화면상 단위 방향(px, y는 아래+). VD 드래그를 시점과
  // 무관하게 정면축에 투영하기 위함 — 좌/우 어느 쪽에서 봐도 "앞으로 당기면
  // 멀어짐(VD↑)"이 일관되게 느껴진다(가로 고정 dx는 반대쪽에서 뒤집힘).
  function forwardScreen2D() {
    glassesGroup.getWorldPosition(_a);
    glassesGroup.getWorldQuaternion(_q);
    _p.copy(_a).project(stage.camera);
    _v.copy(_a).add(_c.set(0, 0, 0.06).applyQuaternion(_q)).project(stage.camera);
    const sx = (_v.x - _p.x);
    const sy = -(_v.y - _p.y);
    const m = Math.hypot(sx, sy) || 1;
    return { x: sx / m, y: sy / m };
  }
  // VD 공통 드래그 — 정면축 투영량으로 조정(앞으로 당김 = 멀어짐, +).
  function vdDrag(f0, dx, dy, ctx) {
    const proj = ctx.fwd ? dx * ctx.fwd.x + dy * ctx.fwd.y : dx;
    const vd = clamp(f0.vd + proj * 0.05, 0, 20);
    onFitChange({ vd: Math.round(vd * 10) / 10 });
    return `정점간거리 ${vd.toFixed(1)}mm (표준 12)`;
  }
  const vdReset = () => { onFitChange({ vd: 12 }); return '정점간거리 표준 복귀'; };

  // ── Handle definitions ──
  // anchor(): 3D 앵커점(월드, _v에 기록). normal(): 정면 향함 판정용 바깥 방향.
  // drag(f0, dx, dy): 파라미터 적용 + 표시 문자열 반환. reset(): 표준 복귀.
  const HANDLES = [
    {
      id: 'pitch', el: mkHandle('고개 ↕'), faceMin: -0.4,   // 정면+양측면 노출(뒤통수만 숨김)
      anchor: () => headMesh.localToWorld(_v.set(0, 0.082, 0.030)),
      normal: () => dirWorld(headMesh, 0, 0.4, 1),
      drag: (f0, dx, dy) => {
        // 아래로 드래그 = 고개 숙임. 실제 렌더(app.js group.rotation.x=headPitch)에서
        // 양수 headPitch가 코를 내리는(숙임) 방향이라 부호를 맞춘다. 숙임(아래) 28°,
        // 들기(위) 12°까지.
        const p = clamp(f0.headPitch + dy * 0.28, -12, 28);
        onFitChange({ headPitch: Math.round(p) });
        return `고개 ${p >= 0 ? '숙임' : '들기'} ${Math.abs(p).toFixed(0)}°`;
      },
      reset: () => { onFitChange({ headPitch: 0 }); return '고개 표준 복귀'; },
    },
    // VD는 양쪽 관자놀이(다리 위)에 각각 — 좌/우 어느 쪽을 봐도 잡을 수 있게.
    // 둘 다 같은 vd 파라미터를 조정. 다리 중간에 얹어 측면에서 렌즈와 안 겹침.
    {
      id: 'vdL', el: mkHandle('정점간거리'),
      anchor: () => glassesGroup.localToWorld(_v.set(0.066, 0.006, -0.040)),
      normal: () => dirWorld(glassesGroup, 0.55, 0, 1),
      drag: vdDrag, reset: vdReset,
    },
    {
      id: 'vdR', el: mkHandle('정점간거리'),
      anchor: () => glassesGroup.localToWorld(_v.set(-0.066, 0.006, -0.040)),
      normal: () => dirWorld(glassesGroup, -0.55, 0, 1),
      drag: vdDrag, reset: vdReset,
    },
    {
      id: 'oh', el: mkHandle('OH ↕'),
      anchor: () => glassesGroup.localToWorld(_v.set(0, 0.008, 0)),
      normal: () => dirWorld(glassesGroup, 0, 0, 1),
      drag: (f0, dx, dy) => {
        const oh = clamp(f0.oh - dy * 0.045, -8, 8);
        onFitChange({ oh: Math.round(oh * 10) / 10 });
        return `OH ${oh >= 0 ? '+' : ''}${oh.toFixed(1)}mm (표준 0)`;
      },
      reset: () => { onFitChange({ oh: 0 }); return 'OH 표준 복귀'; },
    },
  ];

  const screen = new Map();   // id -> { x, y, visible }
  let drag = null;            // { H, f0, x0, y0, fwd? }
  let dragId = null, hoverId = null;
  const lastTap = new Map();
  const active = new Set();

  function setEmphasis() {
    for (const H of HANDLES) {
      H.el.classList.toggle('on', H.id === dragId || H.id === hoverId);
    }
  }

  // ── Per-frame: project anchors → screen, toggle visibility ──
  let alive = true;
  function frame() {
    if (!alive) return;
    const rect = el.getBoundingClientRect();
    for (const H of HANDLES) {
      const a = _a.copy(H.anchor());
      const nrm = H.normal();
      const facing = nrm.dot(_c.subVectors(stage.camera.position, a).normalize()) > (H.faceMin ?? 0.08);
      const proj = _p.copy(a).project(stage.camera);
      const inFront = proj.z < 1;
      const visible = facing && inFront;
      const x = rect.left + (proj.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-proj.y * 0.5 + 0.5) * rect.height;
      // 드래그 중인 핸들은 앵커가 이동해도(고개 틸트) 계속 보이게 유지
      const show = visible || H.id === dragId;
      H.el.classList.toggle('hide', !show);
      if (show) {
        H.el.style.left = x + 'px'; H.el.style.top = y + 'px';
        // 원근감: 카메라가 멀수록 포인트도 작게(씬 오브젝트처럼). 거리 0.5m에서 1배.
        const k = clamp(HND_REF_DIST / stage.camera.position.distanceTo(a), 0.5, 1.8);
        H.el.style.setProperty('--k', k.toFixed(3));
      }
      screen.set(H.id, { x, y, visible: show });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 화면 거리로 가장 가까운(표시 중인) 핸들 — R 이내면 반환.
  function nearest(px, py, R) {
    let best = null, bd = R;
    for (const H of HANDLES) {
      const s = screen.get(H.id);
      if (!s || !s.visible) continue;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bd) { bd = d; best = H; }
    }
    return best;
  }

  function onDown(e) {
    active.add(e.pointerId);
    // 두 손가락 이상 = 카메라 팬/줌 → 핸들 양보.
    if (active.size >= 2) { drag = null; dragId = null; setEmphasis(); stage.controls.enabled = true; return; }
    if (!e.isPrimary || e.button !== 0) return;   // 우/중클릭은 팬 전용

    const H = nearest(e.clientX, e.clientY, GRAB_R);
    if (!H) return;   // 핸들 밖 = OrbitControls 회전/팬 (더블탭 홈 복귀 없음)

    // 핸들 더블탭 → 해당 항목 표준 복귀
    const now = performance.now();
    if (now - (lastTap.get(H.id) || 0) < 320) {
      const msg = H.reset();
      const s = screen.get(H.id);
      showTip(s ? s.x : e.clientX, s ? s.y : e.clientY, msg);
      hideTipSoon();
      lastTap.set(H.id, 0);
      return;
    }
    lastTap.set(H.id, now);

    stage.controls.enabled = false;   // 핸들 잡으면 카메라 정지
    drag = { H, f0: { ...getFit() }, x0: e.clientX, y0: e.clientY };
    if (H.id === 'vdL' || H.id === 'vdR') drag.fwd = forwardScreen2D();
    dragId = H.id; setEmphasis();
  }

  function onMove(e) {
    if (active.size >= 2) return;
    if (drag && e.isPrimary) {
      const msg = drag.H.drag(drag.f0, e.clientX - drag.x0, e.clientY - drag.y0, drag);
      showTip(e.clientX, e.clientY, msg);   // 값은 커서 옆에(핸들이 틸트로 밀려도 안정)
      return;
    }
    // hover 강조(데스크톱)
    const H = nearest(e.clientX, e.clientY, HOVER_R);
    const id = H ? H.id : null;
    if (id !== hoverId) { hoverId = id; setEmphasis(); }
  }

  function onUp(e) {
    active.delete(e.pointerId);
    if (active.size > 0) return;   // 멀티터치 잔여 손가락
    if (drag) { drag = null; dragId = null; setEmphasis(); hideTipSoon(); }
    stage.controls.enabled = true;
  }

  el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  return {
    dispose() {
      alive = false;
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      layer.remove(); tip.remove(); style.remove();
    },
  };
}
