// 🅘 Camera AR overlay — live camera feed with ZEISS-style geometric warp.
//
// Uses the shared WebGL warp renderer (wavefront/warpShader.js): the camera
// frame is displaced per-pixel by the unwanted-cyl optical model, so the
// periphery "swims"/warps like a real progressive lens while the corridor
// stays sharp. Replaces the previous per-pixel blur. Single-eye (OD) view.

import { state, subscribe } from '../wavefront/state.js';
import { getGrade } from '../optics/grades.js';
import { geomFor } from './geom.js?v=18';
import { createWarpGL, LENS_AR } from '../wavefront/warpShader.js';

export function mountCameraAr(parent) {
  const stage = document.createElement('div');
  stage.className = 'ar-stage';
  stage.innerHTML = `
    <video class="ar-video" data-role="video" autoplay playsinline muted style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"></video>
    <canvas class="ar-gl" data-role="gl"></canvas>
    <div class="ar-grade-label">
      <span class="lbl-mono">CURRENT LENS</span>
      <span class="lbl-bp" data-role="bp">BP30</span>
    </div>
    <div class="ar-prompt" data-role="prompt">
      <div class="ar-prompt-icon">
        <svg viewBox="0 0 24 24">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </div>
      <div class="ar-prompt-title">매장을 직접 둘러보세요</div>
      <div class="ar-prompt-body">iPad 카메라로 매장 풍경을 비추면 선택한 등급의 누진렌즈를 통해 본 것처럼 — 원거리·중앙 통로는 선명하고, 누진대 좌우와 근거리 주변부는 휘어/일렁여 보입니다.</div>
      <button class="ar-prompt-btn" data-role="start">카메라 시작하기</button>
    </div>
  `;
  parent.appendChild(stage);

  const refs = {};
  stage.querySelectorAll('[data-role]').forEach(n => { refs[n.dataset.role] = n; });

  let stream  = null;
  let alive   = true;
  let drawing = false;
  let warp    = null;
  let videoReady = false;

  async function start() {
    refs.start.disabled = true;
    refs.start.textContent = '카메라 연결 중…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      refs.video.srcObject = stream;
      await new Promise(r => refs.video.addEventListener('loadeddata', r, { once: true }));
      await refs.video.play().catch(() => {});
      refs.prompt.style.display = 'none';
      initGL();
      startDrawLoop();
    } catch (err) {
      refs.prompt.style.background = 'linear-gradient(180deg, rgba(11,15,26,0.85), rgba(11,15,26,0.95))';
      refs.start.textContent = '카메라 접근 거부됨';
      refs.start.disabled = true;
      stage.querySelector('.ar-prompt-body').innerHTML = '카메라 접근이 거부되었거나 사용할 수 없는 환경입니다. iPad Safari에서 직접 실행해 주세요.';
    }
  }

  function initGL() {
    warp = createWarpGL(refs.gl);
    if (!warp.ok) {
      console.error('AR warp renderer unavailable (WebGL2 missing).');
      return;
    }
    warp.setMapping(LENS_AR);          // centered ±25 × ±17.5 mm mapping
    applyGeomUniforms(state);
  }

  function resizeCanvasIfNeeded() {
    if (!warp?.ok) return;
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (refs.gl.width !== w || refs.gl.height !== h) {
      refs.gl.style.width = '100%'; refs.gl.style.height = '100%';
      warp.resize(w, h);
    }
  }

  function applyGeomUniforms(s) {
    if (!warp?.ok) return;
    warp.setGeom(geomFor(s, 'OD')); // single-eye AR view uses OD by convention
  }

  function startDrawLoop() {
    if (drawing) return;
    drawing = true;
    function frame() {
      if (!alive || !drawing || !warp?.ok) return;
      resizeCanvasIfNeeded();
      const v = refs.video;
      if (v.videoWidth) {
        if (!videoReady) {
          warp.setScene(v, v.videoWidth, v.videoHeight);
          videoReady = true;
        } else {
          warp.updateSceneFrame(v);
        }
        warp.render();
      }
      requestAnimationFrame(frame);
    }
    frame();
  }

  refs.start.addEventListener('click', start);

  function applyState(s) {
    refs.bp.textContent = getGrade(s.grade).bpCode;
    applyGeomUniforms(s);
  }
  applyState(state);
  const unsub = subscribe(applyState);

  return {
    el: stage,
    update: applyState,
    dispose: () => {
      alive = false;
      drawing = false;
      if (stream) stream.getTracks().forEach(t => t.stop());
      unsub?.();
      if (warp?.ok) {
        warp.dispose();
        const ext = warp.gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    },
  };
}
