// 🅘 Camera AR overlay — live camera feed with grade-specific distortion
// overlay. Customer holds the iPad up; the screen shows the room with a
// peripheral blur that mimics what the selected progressive lens grade
// would do.
//
// Permissions: requires user-initiated start (camera access prompt). If
// access is denied or the iframe blocks it, a fallback explainer is shown.

import { state, subscribe } from '../wavefront/state.js';
import { getGrade } from '../optics/grades.js';

export function mountCameraAr(parent) {
  const stage = document.createElement('div');
  stage.className = 'ar-stage';
  stage.innerHTML = `
    <video class="ar-video" data-role="video" autoplay playsinline muted></video>
    <canvas class="ar-overlay" data-role="canvas"></canvas>
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
      <div class="ar-prompt-body">iPad 카메라로 매장 풍경을 비추면 선택한 등급의 누진렌즈를 통해 본 것처럼 주변부가 흐려져 보입니다.</div>
      <button class="ar-prompt-btn" data-role="start">카메라 시작하기</button>
    </div>
  `;
  parent.appendChild(stage);

  const refs = {};
  stage.querySelectorAll('[data-role]').forEach(n => { refs[n.dataset.role] = n; });

  let stream = null;
  let alive = true;
  let drawing = false;

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
      refs.prompt.style.display = 'none';
      startDrawLoop();
    } catch (err) {
      refs.prompt.style.background = 'linear-gradient(180deg, rgba(11,15,26,0.85), rgba(11,15,26,0.95))';
      refs.start.textContent = '카메라 접근 거부됨';
      refs.start.disabled = true;
      stage.querySelector('.ar-prompt-body').innerHTML = '카메라 접근이 거부되었거나 사용할 수 없는 환경입니다. iPad Safari에서 직접 실행해 주세요.';
    }
  }

  function startDrawLoop() {
    if (drawing) return;
    drawing = true;
    function frame() {
      if (!alive || !drawing) return;
      drawOverlay();
      requestAnimationFrame(frame);
    }
    frame();
  }

  // Draw a radial blur mask via canvas filter; pass-through the video to
  // the canvas with a peripheral-blur effect proportional to the current
  // grade. (We can't blur the video element directly; instead we blit
  // the video onto the canvas with filter blur and then a sharp re-paint
  // of the center via a radial-mask cut-out.)
  function drawOverlay() {
    const v = refs.video;
    const cv = refs.canvas;
    if (!v.videoWidth) return;
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.style.width = '100%';
      cv.style.height = '100%';
    }
    const w = cv.width, h = cv.height;
    const ctx = cv.getContext('2d');
    const grade = getGrade(state.grade);
    const blurPx = 4 + (1 - (grade.id - 1) / 4) * 16;
    const scale = grade.clearZoneScale;
    const clearRadius = 0.18 + (scale - 0.95) * 0.55;
    const inner = Math.max(w, h) * clearRadius;
    const outer = Math.max(w, h) * (clearRadius + 0.30);
    const cx = w * 0.5;
    const cy = h * 0.55;

    // Pass 1 — sharp base (cover-fit the video)
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    drawCover(ctx, v, w, h);
    ctx.restore();

    // Pass 2 — blurred copy on top with radial alpha mask
    const tmp = stage._tmp || (stage._tmp = document.createElement('canvas'));
    if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h; }
    const tctx = tmp.getContext('2d');
    tctx.clearRect(0, 0, w, h);
    tctx.filter = `blur(${blurPx}px)`;
    drawCover(tctx, v, w, h);
    tctx.filter = 'none';
    const grad = tctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    tctx.globalCompositeOperation = 'destination-in';
    tctx.fillStyle = grad;
    tctx.fillRect(0, 0, w, h);
    tctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tmp, 0, 0);

    // Vignette
    const vig = ctx.createRadialGradient(cx, cy, outer * 0.7, cx, cy, outer * 1.5);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  // Object-fit: cover the canvas with the video.
  function drawCover(ctx, video, w, h) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const a = w / h, b = vw / vh;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (a > b) { sh = vw / a; sy = (vh - sh) / 2; }
    else       { sw = vh * a; sx = (vw - sw) / 2; }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  }

  refs.start.addEventListener('click', start);

  function applyState(s) {
    refs.bp.textContent = getGrade(s.grade).bpCode;
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
    },
  };
}
