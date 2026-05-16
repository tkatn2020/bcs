// 🅘 Camera AR overlay — live camera feed with per-pixel variable blur
// driven by the same wavefront/unwanted-cyl model that powers the 2D heatmap.
//
// Pipeline (WebGL1 fragment shader):
//   1. Camera frame → texture (updated each rAF)
//   2. Each output pixel maps 1:1 to a lens coordinate (full screen = lens,
//      ±25mm horizontal × ±17.5mm vertical — same domain as renderField).
//   3. sampleUnwantedCyl() is ported to GLSL verbatim, so the spatial shape
//      of the blur matches the heatmap exactly (Minkwitz pinched corridor,
//      asymmetric distance/near widths, Rx-cyl axis interaction, sphere
//      swim residual).
//   4. Blur radius (px) = (cylEff / (REFERENCE_CYL - SHARP_THRESHOLD)) ^ 0.65 × MAX_BLUR_PX,
//      where cylEff = max(0, cyl - SHARP_THRESHOLD). Pixels at cyl ≤ 0.25 D
//      (inside the cyan ISO contour) are perfectly sharp — same dead zone as
//      the 2D heatmap and clarity score.
//   5. 16-tap Poisson-disk variable blur per fragment.
//
// All optics happen on the GPU. State changes only update uniforms; no
// shader recompilation or canvas re-sizing on grade/ADD/corridor changes.

import { state, subscribe } from '../wavefront/state.js';
import { getGrade } from '../optics/grades.js';
import { CYL_CLEAR_THRESHOLD } from '../wavefront/helpers.js';
import { geomFor } from './geom.js?v=18';

// ── Tunables ───────────────────────────────────────────────────────────
const REFERENCE_CYL = 3.0;     // matches helpers.js REFERENCE_CYL
const MAX_BLUR_PX   = 22.0;    // peak blur (highest-cyl pixels on BP10 + heavy Rx)
const GAMMA         = 0.65;    // perceptual curve — matches heatmap tVis
const POISSON_TAPS  = 16;
const LENS_W_MM     = 50.0;    // matches helpers.js LENS_W_MM
const LENS_H_MM     = 35.0;

// ── Shaders ────────────────────────────────────────────────────────────

const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_video;
uniform vec2  u_resolution;     // canvas pixel size
uniform vec2  u_videoSize;      // video frame size (for cover-fit)

// — geom uniforms — port of getGeom() output
uniform float u_peakCyl;
uniform float u_distanceHalfMm;
uniform float u_corridorHalfMm;
uniform float u_nearHalfMm;
uniform float u_falloffMm;
uniform float u_rxCyl;
uniform float u_rxAxisRad;
uniform float u_sphere;
uniform float u_eyeSign;        // +1 OD, -1 OS (currently fixed to +1)

uniform float u_maxBlur;
uniform float u_referenceCyl;
uniform float u_sharpThreshold; // cyl ≤ this → perfectly sharp (0.25 D, cyan ISO contour)
uniform float u_gamma;
uniform vec2  u_lensExtentMm;   // (LENS_W_MM, LENS_H_MM)

// — Poisson disk (radius 1.0) — 16 taps, well-distributed
const vec2 POISSON[16] = vec2[16](
  vec2(-0.94201624, -0.39906216),
  vec2( 0.94558609, -0.76890725),
  vec2(-0.09418410, -0.92938870),
  vec2( 0.34495938,  0.29387760),
  vec2(-0.91588581,  0.45771432),
  vec2(-0.81544232, -0.87912464),
  vec2(-0.38277543,  0.27676845),
  vec2( 0.97484398,  0.75648379),
  vec2( 0.44323325, -0.97511554),
  vec2( 0.53742981, -0.47373420),
  vec2(-0.26496911, -0.41893023),
  vec2( 0.79197514,  0.19090188),
  vec2(-0.24188840,  0.99706507),
  vec2(-0.81409955,  0.91437590),
  vec2( 0.19984126,  0.78641367),
  vec2( 0.14383161, -0.14100790)
);

float smoothstepf(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Port of sampleUnwantedCyl(xMm, yMm, geom). Single-eye view uses u_eyeSign=+1.
float sampleCyl(float xMm, float yMm) {
  float xLocal = u_eyeSign * xMm;
  float yNorm = yMm / 11.0;
  float wDist = smoothstepf(0.0, -0.6, yNorm);
  float wNear = smoothstepf(0.6, 1.4, yNorm);
  float wCorr = 1.0 - wDist - wNear;
  float halfW = wDist * u_distanceHalfMm
              + wCorr * u_corridorHalfMm
              + wNear * u_nearHalfMm;
  float ax = abs(xLocal);
  float t = (ax - halfW) / max(u_falloffMm, 0.001);
  float ramp = clamp(t, 0.0, 1.0);
  float vScale = clamp(0.05 + (yNorm + 0.3) * 0.85, 0.10, 1.0);
  float r = sqrt(xMm * xMm + yMm * yMm) / 22.0;

  // (a) Progressive peripheral cyl
  float cylProgMag = u_peakCyl * ramp * vScale;
  float positionAngle = atan(yMm, xLocal);
  float progAxis = positionAngle + 1.5707963;

  // (b) Rx-induced residual cyl
  float cylRxMag = abs(u_rxCyl) * 0.30 * r * r;

  float cos2D = cos(2.0 * (u_rxAxisRad - progAxis));
  float cylTotalSq = cylProgMag * cylProgMag
                   + cylRxMag   * cylRxMag
                   + 2.0 * cylProgMag * cylRxMag * cos2D;
  float cylTotal = sqrt(max(0.0, cylTotalSq));

  // Sphere swim residual
  float baseSphereResidual = max(0.0, abs(u_sphere) - 2.0) * 0.04 * r * r;
  float hyperopeSwim       = max(0.0, u_sphere) * 0.025 * r;

  return cylTotal + baseSphereResidual + hyperopeSwim;
}

// Cover-fit UV: maps quad UV (0..1) into video-texture UV so the camera
// frame fills the canvas without distortion (CSS object-fit: cover).
vec2 coverUV(vec2 quadUV) {
  float canvasAspect = u_resolution.x / u_resolution.y;
  float videoAspect  = u_videoSize.x  / u_videoSize.y;
  vec2 uv = quadUV;
  if (canvasAspect > videoAspect) {
    // Canvas wider — crop vertically
    float scale = videoAspect / canvasAspect;
    uv.y = (uv.y - 0.5) * scale + 0.5;
  } else {
    float scale = canvasAspect / videoAspect;
    uv.x = (uv.x - 0.5) * scale + 0.5;
  }
  // WebGL textures uploaded from <video> are upside-down by default; flip Y.
  uv.y = 1.0 - uv.y;
  return uv;
}

void main() {
  // 1:1 mapping — full canvas = full lens (±25mm × ±17.5mm).
  // Note: v_uv.y=0 is bottom of canvas. Lens convention: yMm<0 is TOP (distance
  // zone), yMm>0 is BOTTOM (near zone). Flip sign accordingly.
  float xMm =  (v_uv.x - 0.5) * u_lensExtentMm.x;
  float yMm = -(v_uv.y - 0.5) * u_lensExtentMm.y;

  float cyl = sampleCyl(xMm, yMm);
  // Dead zone: cyl ≤ u_sharpThreshold → no blur (matches 2D heatmap + score).
  float cylEff = max(0.0, cyl - u_sharpThreshold);
  float tVis = pow(clamp(cylEff / (u_referenceCyl - u_sharpThreshold), 0.0, 1.0), u_gamma);
  float radiusPx = tVis * u_maxBlur;

  vec2 texel = 1.0 / u_resolution;
  vec2 baseUV = coverUV(v_uv);

  // Always include the center tap — cheap visual stabilizer for low-blur regions.
  vec4 sum = texture(u_video, baseUV);
  float wsum = 1.0;

  // Variable-radius 16-tap Poisson disk blur.
  // Each Poisson sample lives in [-1, +1] disc; scale by radius (px) → texel.
  for (int i = 0; i < 16; i++) {
    // Cover-fit the OFFSET sample too — the offset is in canvas-pixel space,
    // so we sample at quadUV + canvas-space offset, then map through coverUV.
    vec2 sampleUV = coverUV(v_uv + POISSON[i] * radiusPx / u_resolution);
    sum  += texture(u_video, sampleUV);
    wsum += 1.0;
  }

  fragColor = vec4(sum.rgb / wsum, 1.0);
}
`;

// ── Mount ──────────────────────────────────────────────────────────────

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
    <div class="ar-zone-labels" data-role="zone-labels">
      <div class="ar-zone-label ar-zone-d"><span>원거리</span><span class="ar-zone-tag">DISTANCE</span></div>
      <div class="ar-zone-label ar-zone-i"><span>중간거리</span><span class="ar-zone-tag">INTERMEDIATE</span></div>
      <div class="ar-zone-label ar-zone-n"><span>근거리</span><span class="ar-zone-tag">NEAR</span></div>
    </div>
    <div class="ar-prompt" data-role="prompt">
      <div class="ar-prompt-icon">
        <svg viewBox="0 0 24 24">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </div>
      <div class="ar-prompt-title">매장을 직접 둘러보세요</div>
      <div class="ar-prompt-body">iPad 카메라로 매장 풍경을 비추면 선택한 등급의 누진렌즈를 통해 본 것처럼 — 원거리는 선명하고, 누진대 좌우와 근거리 주변부는 흐려져 보입니다.</div>
      <button class="ar-prompt-btn" data-role="start">카메라 시작하기</button>
    </div>
  `;
  parent.appendChild(stage);

  const refs = {};
  stage.querySelectorAll('[data-role]').forEach(n => { refs[n.dataset.role] = n; });

  let stream  = null;
  let alive   = true;
  let drawing = false;
  let gl      = null;
  let prog    = null;
  let uloc    = {};
  let videoTex = null;

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
    const cv = refs.gl;
    gl = cv.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
    if (!gl) {
      console.error('WebGL2 not available — this device or browser does not support WebGL2.');
      return;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      console.error('VS log:', gl.getShaderInfoLog(vs));
      console.error('FS log:', gl.getShaderInfoLog(fs));
      return;
    }

    // Fullscreen triangle pair
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1,  1,-1,  -1, 1,
      -1, 1,  1,-1,   1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Cache uniform locations
    uloc = {
      u_video:           gl.getUniformLocation(prog, 'u_video'),
      u_resolution:      gl.getUniformLocation(prog, 'u_resolution'),
      u_videoSize:       gl.getUniformLocation(prog, 'u_videoSize'),
      u_peakCyl:         gl.getUniformLocation(prog, 'u_peakCyl'),
      u_distanceHalfMm:  gl.getUniformLocation(prog, 'u_distanceHalfMm'),
      u_corridorHalfMm:  gl.getUniformLocation(prog, 'u_corridorHalfMm'),
      u_nearHalfMm:      gl.getUniformLocation(prog, 'u_nearHalfMm'),
      u_falloffMm:       gl.getUniformLocation(prog, 'u_falloffMm'),
      u_rxCyl:           gl.getUniformLocation(prog, 'u_rxCyl'),
      u_rxAxisRad:       gl.getUniformLocation(prog, 'u_rxAxisRad'),
      u_sphere:          gl.getUniformLocation(prog, 'u_sphere'),
      u_eyeSign:         gl.getUniformLocation(prog, 'u_eyeSign'),
      u_maxBlur:         gl.getUniformLocation(prog, 'u_maxBlur'),
      u_referenceCyl:    gl.getUniformLocation(prog, 'u_referenceCyl'),
      u_sharpThreshold:  gl.getUniformLocation(prog, 'u_sharpThreshold'),
      u_gamma:           gl.getUniformLocation(prog, 'u_gamma'),
      u_lensExtentMm:    gl.getUniformLocation(prog, 'u_lensExtentMm'),
    };

    videoTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.useProgram(prog);
    gl.uniform1i(uloc.u_video, 0);
  }

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(sh));
      console.error(src);
    }
    return sh;
  }

  function resizeCanvasIfNeeded() {
    const cv = refs.gl;
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w; cv.height = h;
      cv.style.width = '100%'; cv.style.height = '100%';
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uloc.u_resolution, w, h);
    }
  }

  function uploadVideoFrame() {
    const v = refs.video;
    if (!v.videoWidth) return false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
    gl.uniform2f(uloc.u_videoSize, v.videoWidth, v.videoHeight);
    return true;
  }

  function applyGeomUniforms(s) {
    if (!gl || !prog) return;
    gl.useProgram(prog);
    const geom = geomFor(s, 'OD'); // single-eye AR view uses OD by convention
    const rx = s.od;
    gl.uniform1f(uloc.u_peakCyl,         geom.peakCyl);
    gl.uniform1f(uloc.u_distanceHalfMm,  geom.distanceHalfMm);
    gl.uniform1f(uloc.u_corridorHalfMm,  geom.corridorHalfMm);
    gl.uniform1f(uloc.u_nearHalfMm,      geom.nearHalfMm);
    gl.uniform1f(uloc.u_falloffMm,       geom.falloffMm);
    gl.uniform1f(uloc.u_rxCyl,           Math.abs(rx.cylinder || 0));
    gl.uniform1f(uloc.u_rxAxisRad,       ((rx.axis || 0) * Math.PI) / 180);
    gl.uniform1f(uloc.u_sphere,          rx.sphere || 0);
    gl.uniform1f(uloc.u_eyeSign,         +1);
    gl.uniform1f(uloc.u_maxBlur,         MAX_BLUR_PX);
    gl.uniform1f(uloc.u_referenceCyl,    REFERENCE_CYL);
    gl.uniform1f(uloc.u_sharpThreshold,  CYL_CLEAR_THRESHOLD);
    gl.uniform1f(uloc.u_gamma,           GAMMA);
    gl.uniform2f(uloc.u_lensExtentMm,    LENS_W_MM, LENS_H_MM);
  }

  function startDrawLoop() {
    if (drawing) return;
    drawing = true;
    applyGeomUniforms(state);
    function frame() {
      if (!alive || !drawing || !gl) return;
      resizeCanvasIfNeeded();
      if (uploadVideoFrame()) {
        gl.drawArrays(gl.TRIANGLES, 0, 6);
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
      if (gl) {
        if (videoTex) gl.deleteTexture(videoTex);
        if (prog) gl.deleteProgram(prog);
      }
    },
  };
}
