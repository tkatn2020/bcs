// 🅦 Shared WebGL geometric-warp renderer — ZEISS-style progressive lens
// distortion. Replaces the heatmap + blur + ISO visualization with a
// per-pixel displacement of the scene that mimics the real "swim" you see
// through a progressive lens periphery.
//
// The displacement field is derived from the SAME optical model the rest of
// the app uses (sampleUnwantedCyl, ported to GLSL): displacement ∝ gradient
// of the unwanted-cyl field × its magnitude. Result: center corridor stays
// undistorted, periphery warps progressively, intensity scales with ADD.
//
// Used by BOTH the 2D analysis view (lensBox.js, image texture) and the AR
// camera view (cameraAr.js, video texture). Coordinate mapping differs
// between the two (2D lens occupies a fraction of the canvas, off-center;
// AR is centered) — parametrized via u_lensExtentMm + u_lensCyFrac uniforms.

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

uniform sampler2D u_scene;
uniform vec2  u_resolution;     // canvas pixel size
uniform vec2  u_sceneSize;      // texture natural size (for cover-fit)

// — geom uniforms — port of getGeom() output
uniform float u_peakCyl;
uniform float u_distanceHalfMm;
uniform float u_corridorHalfMm;
uniform float u_nearHalfMm;
uniform float u_falloffMm;
uniform float u_rxCyl;
uniform float u_rxAxisRad;
uniform float u_sphere;
uniform float u_eyeSign;        // +1 OD, -1 OS

// — coordinate mapping (differs 2D vs AR) —
uniform vec2  u_lensExtentMm;   // full-canvas span in mm (x, y)
uniform float u_lensCyFrac;     // lens vertical center as fraction of canvas (0..1 from top)
uniform float u_warpGain;       // displacement strength

float smoothstepf(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Port of sampleUnwantedCyl(xMm, yMm, geom).
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

  float cylProgMag = u_peakCyl * ramp * vScale;
  float positionAngle = atan(yMm, xLocal);
  float progAxis = positionAngle + 1.5707963;

  float cylRxMag = abs(u_rxCyl) * 0.30 * r * r;

  float cos2D = cos(2.0 * (u_rxAxisRad - progAxis));
  float cylTotalSq = cylProgMag * cylProgMag
                   + cylRxMag   * cylRxMag
                   + 2.0 * cylProgMag * cylRxMag * cos2D;
  float cylTotal = sqrt(max(0.0, cylTotalSq));

  float baseSphereResidual = max(0.0, abs(u_sphere) - 2.0) * 0.04 * r * r;
  float hyperopeSwim       = max(0.0, u_sphere) * 0.025 * r;

  return cylTotal + baseSphereResidual + hyperopeSwim;
}

// Canvas quad-UV → lens mm coordinate.
//   x: full canvas width = u_lensExtentMm.x, centered.
//   y: v_uv.y=0 is canvas BOTTOM; lens center at u_lensCyFrac (from top).
//      yMm > 0 = near zone (bottom), yMm < 0 = distance zone (top).
vec2 lensMm(vec2 quadUV) {
  float xMm = (quadUV.x - 0.5) * u_lensExtentMm.x;
  float yMm = ((1.0 - u_lensCyFrac) - quadUV.y) * u_lensExtentMm.y;
  return vec2(xMm, yMm);
}

// Cover-fit quad UV → texture UV (object-fit: cover). Texture uploaded with
// UNPACK_FLIP_Y so no manual Y flip needed (works for both image and video).
vec2 coverUV(vec2 quadUV) {
  float canvasAspect = u_resolution.x / u_resolution.y;
  float texAspect    = u_sceneSize.x  / u_sceneSize.y;
  vec2 uv = quadUV;
  if (canvasAspect > texAspect) {
    uv.y = (uv.y - 0.5) * (texAspect / canvasAspect) + 0.5;
  } else {
    uv.x = (uv.x - 0.5) * (canvasAspect / texAspect) + 0.5;
  }
  return uv;
}

void main() {
  vec2 mm = lensMm(v_uv);

  // Displacement = gradient of cyl field × magnitude × gain.
  // Finite-difference gradient gives the swim direction; multiplying by the
  // local cyl magnitude localizes warp to the periphery (center cyl≈0 → no
  // displacement), matching the ZEISS reference progression with ADD.
  const float EPS = 0.6;  // mm
  float c0 = sampleCyl(mm.x, mm.y);
  float cx = sampleCyl(mm.x + EPS, mm.y);
  float cy = sampleCyl(mm.x, mm.y + EPS);
  vec2 grad = vec2(cx - c0, cy - c0) / EPS;
  vec2 dispMm = grad * (c0 * u_warpGain);

  // mm displacement → quad-UV displacement (note y sign: +mm = down = -uv.y)
  vec2 dispUV = vec2(dispMm.x / u_lensExtentMm.x, -dispMm.y / u_lensExtentMm.y);

  vec2 sampleUV = coverUV(clamp(v_uv + dispUV, 0.0, 1.0));
  fragColor = vec4(texture(u_scene, sampleUV).rgb, 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('Warp shader compile error:', gl.getShaderInfoLog(sh));
    console.error(src);
  }
  return sh;
}

const UNIFORM_NAMES = [
  'u_scene', 'u_resolution', 'u_sceneSize',
  'u_peakCyl', 'u_distanceHalfMm', 'u_corridorHalfMm', 'u_nearHalfMm',
  'u_falloffMm', 'u_rxCyl', 'u_rxAxisRad', 'u_sphere', 'u_eyeSign',
  'u_lensExtentMm', 'u_lensCyFrac', 'u_warpGain',
];

// 2D lens canvas-to-mm mapping (matches heatRenderer.js lensCoordsFor).
//   lens occupies 600/720 of width, 391/440 of height, center at 0.497.
export const LENS_2D = {
  extentMm: [50 / (600 / 720), 35 / (391 / 440)],  // ≈ (60.0, 39.39)
  cyFrac: (23 + 414) / 2 / 440,                     // ≈ 0.4966
};
// AR camera mapping — centered, ±25 × ±17.5 mm.
export const LENS_AR = {
  extentMm: [50, 35],
  cyFrac: 0.5,
};

export const DEFAULT_WARP_GAIN = 3.0;

// Create a warp renderer bound to a canvas. Returns null-ok handle.
export function createWarpGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false });
  if (!gl) {
    console.error('WebGL2 not available — warp renderer disabled.');
    return { ok: false };
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Warp program link error:', gl.getProgramInfoLog(prog));
    return { ok: false };
  }

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const uloc = {};
  for (const n of UNIFORM_NAMES) uloc[n] = gl.getUniformLocation(prog, n);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  gl.useProgram(prog);
  gl.uniform1i(uloc.u_scene, 0);
  // Sensible defaults (2D mapping)
  gl.uniform2f(uloc.u_lensExtentMm, LENS_2D.extentMm[0], LENS_2D.extentMm[1]);
  gl.uniform1f(uloc.u_lensCyFrac, LENS_2D.cyFrac);
  gl.uniform1f(uloc.u_warpGain, DEFAULT_WARP_GAIN);

  let sceneW = 1, sceneH = 1;

  function setScene(source, w, h) {
    sceneW = w || source.naturalWidth || source.videoWidth || source.width || 1;
    sceneH = h || source.naturalHeight || source.videoHeight || source.height || 1;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    gl.useProgram(prog);
    gl.uniform2f(uloc.u_sceneSize, sceneW, sceneH);
  }

  // Re-upload current frame (for video) — reuses last known size.
  function updateSceneFrame(source) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    const w = source.videoWidth || sceneW, hh = source.videoHeight || sceneH;
    if (w !== sceneW || hh !== sceneH) {
      sceneW = w; sceneH = hh;
      gl.useProgram(prog);
      gl.uniform2f(uloc.u_sceneSize, sceneW, sceneH);
    }
  }

  // g: geom object from getGeom() — {peakCyl, distanceHalfMm, corridorHalfMm,
  // nearHalfMm, falloffMm, cylinder, axis, sphere, eye}
  function setGeom(g) {
    gl.useProgram(prog);
    gl.uniform1f(uloc.u_peakCyl,        g.peakCyl ?? 0);
    gl.uniform1f(uloc.u_distanceHalfMm, g.distanceHalfMm ?? 13);
    gl.uniform1f(uloc.u_corridorHalfMm, g.corridorHalfMm ?? 3);
    gl.uniform1f(uloc.u_nearHalfMm,     g.nearHalfMm ?? 9);
    gl.uniform1f(uloc.u_falloffMm,      g.falloffMm ?? 6);
    gl.uniform1f(uloc.u_rxCyl,          Math.abs(g.cylinder ?? 0));
    gl.uniform1f(uloc.u_rxAxisRad,      ((g.axis ?? 0) * Math.PI) / 180);
    gl.uniform1f(uloc.u_sphere,         g.sphere ?? 0);
    gl.uniform1f(uloc.u_eyeSign,        g.eye === 'OS' ? -1 : 1);
  }

  function setMapping({ extentMm, cyFrac }) {
    gl.useProgram(prog);
    if (extentMm) gl.uniform2f(uloc.u_lensExtentMm, extentMm[0], extentMm[1]);
    if (cyFrac != null) gl.uniform1f(uloc.u_lensCyFrac, cyFrac);
  }

  function setWarpGain(gain) {
    gl.useProgram(prog);
    gl.uniform1f(uloc.u_warpGain, gain);
  }

  function resize(wPx, hPx) {
    if (canvas.width !== wPx || canvas.height !== hPx) {
      canvas.width = wPx; canvas.height = hPx;
    }
    gl.viewport(0, 0, wPx, hPx);
    gl.useProgram(prog);
    gl.uniform2f(uloc.u_resolution, wPx, hPx);
  }

  function render() {
    gl.useProgram(prog);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function dispose() {
    gl.deleteTexture(tex);
    gl.deleteBuffer(buf);
    gl.deleteProgram(prog);
  }

  return { ok: true, gl, setScene, updateSceneFrame, setGeom, setMapping, setWarpGain, resize, render, dispose };
}
