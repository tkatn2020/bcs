// v3 Multi-view popup — 정면·하단·측면 3각도를 좌측 상단 팝업에 동시 송출.
//
// 목적(사용자 요청 2026-07-20): 한 메인 카메라로는 "피팅 시점(정면 얼굴)"과
// "시야존 콘 변화(하단·측면에서 잘 보임)"를 동시에 볼 수 없다 — 카메라를
// 돌리면 각도를 잃는다. 팝업이 같은 scene을 3각도 고정 카메라로 상시 렌더해,
// 피팅 슬라이더를 움직이면 3뷰가 실시간으로 함께 변한다.
//
// 아키텍처: 메인 렌더 루프(studioStage 내부 클로저)는 건드리지 않고, 별도
// WebGLRenderer + 자체 canvas + 자체 rAF로 같은 scene을 공유해 그린다.
// 한 canvas를 setViewport/setScissor로 3개 세로 뷰포트로 나눠 카메라 3개로
// 렌더. renderer는 alpha:true라 뷰 사이 갭이 팝업 배경을 비친다.
// scene/geometry는 메인 소유 — dispose는 popupRenderer.dispose()만.

import * as THREE from 'three';

// cones: 시야 콘 표시 여부(레이어 1 활성). '정면·피팅'은 렌즈 존맵(누진
// 변화)만 보여야 하므로 콘 끔 — 안경 클로즈업으로 확대.
const VIEWS = [
  { key: 'front',  label: '정면 · 렌즈 누진',  pos: [0.015, -0.018, 0.165], tgt: [0, -0.02, 0.05], cones: false },
  { key: 'bottom', label: '하단 · 시야 수렴',  pos: [0.0, -0.34, 0.44],  tgt: [0, -0.05, 0.08],  cones: true },
  { key: 'side',   label: '측면 · 시야 분출',  pos: [0.50, 0.05, 0.24],  tgt: [0, -0.02, 0.18],  cones: true },
];

const PANEL_W = 208;   // 팝업 내부 canvas 폭(px)
const VIEW_H = 128;    // 뷰 하나 높이(px)
const GAP = 3;         // 뷰 사이 갭(px)

export function createMultiView({ scene }) {
  // ── DOM ──
  const style = document.createElement('style');
  style.textContent = `
    .v3mv { position: fixed; left: 14px; top: 14px; z-index: 10; width: ${PANEL_W + 24}px;
      background: rgba(16,19,26,0.74); backdrop-filter: blur(10px); border-radius: 14px;
      padding: 10px 12px; font-family: 'Pretendard', system-ui, sans-serif;
      user-select: none; -webkit-user-select: none; }
    .v3mv-head { display: flex; align-items: center; justify-content: space-between;
      font-size: 10px; letter-spacing: .12em; color: #8b93a7; font-weight: 800; }
    .v3mv-x { cursor: pointer; color: #cfd6e4; font-size: 15px; line-height: 1;
      padding: 0 2px; }
    .v3mv-x:hover { color: #fff; }
    .v3mv-body { position: relative; margin-top: 8px; }
    .v3mv canvas { display: block; border-radius: 8px; }
    .v3mv-labs { position: absolute; inset: 0; pointer-events: none; }
    .v3mv-lab { position: absolute; left: 6px; font-size: 10px; font-weight: 700;
      color: #e8ecf4; text-shadow: 0 1px 3px rgba(0,0,0,.8); }
  `;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.className = 'v3mv';
  el.style.display = 'none';   // 기본 접힘 — 트리거 버튼으로 열기
  el.innerHTML = `
    <div class="v3mv-head"><span>시야 멀티뷰</span><span class="v3mv-x" title="닫기">✕</span></div>
    <div class="v3mv-body"><div class="v3mv-labs"></div></div>
  `;
  document.body.appendChild(el);
  const body = el.querySelector('.v3mv-body');
  const labs = el.querySelector('.v3mv-labs');

  // 뷰 라벨 오버레이 (canvas 위)
  VIEWS.forEach((v, i) => {
    const lab = document.createElement('div');
    lab.className = 'v3mv-lab';
    lab.textContent = v.label;
    lab.style.top = (i * (VIEW_H + GAP) + 5) + 'px';
    labs.appendChild(lab);
  });

  el.querySelector('.v3mv-x').addEventListener('click', () => close());

  // ── Renderer (메인과 색감 일치) ──
  const totalH = VIEWS.length * VIEW_H + (VIEWS.length - 1) * GAP;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setSize(PANEL_W, totalH);
  renderer.setScissorTest(true);
  renderer.autoClear = false;
  body.insertBefore(renderer.domElement, labs);

  // ── Cameras ──
  const aspect = PANEL_W / VIEW_H;
  const cams = VIEWS.map((v) => {
    const c = new THREE.PerspectiveCamera(35, aspect, 0.01, 50);
    c.position.set(...v.pos);
    c.lookAt(...v.tgt);
    // 콘은 레이어 1(app.js에서 분리) — 표시할 뷰만 레이어 1 활성.
    if (v.cones) c.layers.enable(1);
    return c;
  });

  // ── Render loop (열려 있을 때만) ──
  let running = false;
  function frame() {
    if (!running) return;
    renderer.clear();
    for (let i = 0; i < VIEWS.length; i++) {
      // 뷰포트 y는 아래에서 위로 — 첫 뷰(정면)를 맨 위에 두려면 역순 배치.
      const y = (VIEWS.length - 1 - i) * (VIEW_H + GAP);
      renderer.setViewport(0, y, PANEL_W, VIEW_H);
      renderer.setScissor(0, y, PANEL_W, VIEW_H);
      renderer.render(scene, cams[i]);
    }
    requestAnimationFrame(frame);
  }

  function open() {
    if (running) return;
    running = true;
    el.style.display = '';
    requestAnimationFrame(frame);
    onToggle && onToggle(true);
  }
  function close() {
    if (!running) return;
    running = false;
    el.style.display = 'none';
    onToggle && onToggle(false);
  }
  function toggle() { running ? close() : open(); }

  let onToggle = null;

  function dispose() {
    close();
    renderer.dispose();
    renderer.domElement.remove();
    el.remove();
    style.remove();
  }

  return {
    el, cams,   // cams: 라이브 각도 튜닝용 노출
    open, close, toggle,
    get isOpen() { return running; },
    setOnToggle(cb) { onToggle = cb; },
    dispose,
  };
}
