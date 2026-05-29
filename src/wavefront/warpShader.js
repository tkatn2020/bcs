// 🅦 Shared WebGL distortion renderer — ZEISS-style progressive lens
// periphery effect. The center corridor stays sharp & clear; the periphery
// (where unwanted cyl is high) gets THREE combined effects, all driven by the
// cyl MAGNITUDE (so they appear in the periphery, never the corridor):
//   1. Radial geometric swim — straight lines bend outward (image warp)
//   2. Variable Poisson blur — loss of detail (frosted)
//   3. White frost mix — hazy whitening, marks the distortion zone boundary
//
// Driven by the SAME optical model as the rest of the app (sampleUnwantedCyl,
// ported to GLSL). Used by both the 2D analysis view (image texture) and the
// AR camera view (video texture); coordinate mapping differs (LENS_2D/LENS_AR).
//
// NOTE: an earlier version used the cyl GRADIENT for displacement, which
// concentrated warp at the corridor EDGE (center), the opposite of a real
// progressive lens. Now magnitude-driven → warp + frost live in the periphery.

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

// — distortion tunables —
uniform float u_referenceCyl;   // cyl that maps to full distortion (≈ 3.0)
uniform float u_gamma;          // perceptual ramp exponent
uniform float u_warpMm;         // max radial swim displacement (mm)
uniform float u_maxBlur;        // max blur radius (px)
uniform float u_frost;          // max white-frost mix (0..1)

// 16-tap Poisson disk (radius 1.0)
const vec2 POISSON[16] = vec2[16](
  vec2(-0.94201624, -0.39906216), vec2( 0.94558609, -0.76890725),
  vec2(-0.09418410, -0.92938870), vec2( 0.34495938,  0.29387760),
  vec2(-0.91588581,  0.45771432), vec2(-0.81544232, -0.87912464),
  vec2(-0.38277543,  0.27676845), vec2( 0.97484398,  0.75648379),
  vec2( 0.44323325, -0.97511554), vec2( 0.53742981, -0.47373420),
  vec2(-0.26496911, -0.41893023), vec2( 0.79197514,  0.19090188),
  vec2(-0.24188840,  0.99706507), vec2(-0.81409955,  0.91437590),
  vec2( 0.19984126,  0.78641367), vec2( 0.14383161, -0.14100790)
);

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
vec2 lensMm(vec2 quadUV) {
  float xMm = (quadUV.x - 0.5) * u_lensExtentMm.x;
  float yMm = ((1.0 - u_lensCyFrac) - quadUV.y) * u_lensExtentMm.y;
  return vec2(xMm, yMm);
}

// Cover-fit quad UV → texture UV. Texture uploaded with UNPACK_FLIP_Y so no
// manual Y flip (works for both image and video).
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
  float cyl = sampleCyl(mm.x, mm.y);

  // Distortion amount: 0 in the clear corridor (cyl≈0), rising toward the
  // periphery. Perceptual gamma ramp. THIS is magnitude-driven, so all three
  // effects below are concentrated where cyl is high — the periphery.
  float tDist = pow(clamp(cyl / u_referenceCyl, 0.0, 1.0), u_gamma);

  // (1) Radial geometric swim — displacement grows with distortion, directed
  // radially from the optical center. Straight peripheral lines bend; the
  // central corridor (tDist≈0) is untouched. Asymmetric because cyl itself is
  // asymmetric (high on the corridor sides + near periphery).
  vec2 radial = mm / (length(mm) + 0.001);
  vec2 dispMm = radial * (tDist * u_warpMm);
  vec2 dispUV = vec2(dispMm.x / u_lensExtentMm.x, -dispMm.y / u_lensExtentMm.y);
  vec2 baseUV = clamp(v_uv + dispUV, 0.0, 1.0);

  // (2) Variable Poisson blur — radius grows with distortion (frosted detail
  // loss in the periphery). Center tap + 16 disk taps, sampled through cover-fit.
  float radiusPx = tDist * u_maxBlur;
  vec3 sum = texture(u_scene, coverUV(baseUV)).rgb;
  float wsum = 1.0;
  for (int i = 0; i < 16; i++) {
    vec2 off = POISSON[i] * radiusPx / u_resolution;
    sum += texture(u_scene, coverUV(clamp(baseUV + off, 0.0, 1.0))).rgb;
    wsum += 1.0;
  }
  vec3 color = sum / wsum;

  // (3) White frost — hazy whitening in the distortion zone, marks the
  // soft clear/blur boundary (matches ZEISS reference image 2).
  color = mix(color, vec3(1.0), clamp(tDist * u_frost, 0.0, 1.0));

  fragColor = vec4(color, 1.0);
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
  'u_lensExtentMm', 'u_lensCyFrac',
  'u_referenceCyl', 'u_gamma', 'u_warpMm', 'u_maxBlur', 'u_frost',
];

// 2D lens canvas-to-mm mapping (matches heatRenderer.js lensCoordsFor).
export const LENS_2D = {
  extentMm: [50 / (600 / 720), 35 / (391 / 440)],  // ≈ (60.0, 39.39)
  cyFrac: (23 + 414) / 2 / 440,                     // ≈ 0.4966
};
// AR camera mapping — centered, ±25 × ±17.5 mm.
export const LENS_AR = {
  extentMm: [50, 35],
  cyFrac: 0.5,
};

// Distortion defaults — tune these to match the ZEISS reference intensity.
export const WARP_DEFAULTS = {
  referenceCyl: 3.0,
  gamma: 0.80,
  warpMm: 2.6,    // radial swim strength — geometric bend is the hero effect
  maxBlur: 11.0,  // peripheral blur (px)
  frost: 0.16,    // white haze (0..1) — subtle zone marker, not a washout
};

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
  gl.uniform2f(uloc.u_lensExtentMm, LENS_2D.extentMm[0], LENS_2D.extentMm[1]);
  gl.uniform1f(uloc.u_lensCyFrac, LENS_2D.cyFrac);
  gl.uniform1f(uloc.u_referenceCyl, WARP_DEFAULTS.referenceCyl);
  gl.uniform1f(uloc.u_gamma, WARP_DEFAULTS.gamma);
  gl.uniform1f(uloc.u_warpMm, WARP_DEFAULTS.warpMm);
  gl.uniform1f(uloc.u_maxBlur, WARP_DEFAULTS.maxBlur);
  gl.uniform1f(uloc.u_frost, WARP_DEFAULTS.frost);

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

  // Tune distortion intensity (any subset).
  function setParams(p = {}) {
    gl.useProgram(prog);
    if (p.referenceCyl != null) gl.uniform1f(uloc.u_referenceCyl, p.referenceCyl);
    if (p.gamma != null) gl.uniform1f(uloc.u_gamma, p.gamma);
    if (p.warpMm != null) gl.uniform1f(uloc.u_warpMm, p.warpMm);
    if (p.maxBlur != null) gl.uniform1f(uloc.u_maxBlur, p.maxBlur);
    if (p.frost != null) gl.uniform1f(uloc.u_frost, p.frost);
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

  return { ok: true, gl, setScene, updateSceneFrame, setGeom, setMapping, setParams, resize, render, dispose };
}
