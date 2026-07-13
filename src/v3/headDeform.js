// v3 Head deform — runtime vertex deformation of the facecap face mesh.
//
// Reposition each ear (Y up/down, Z front/back) and reshape the nose bridge
// (forward protrusion coupled with proportional thickening), so the fitting
// studio can represent real facial asymmetry / varied ear positions / different
// nose profiles (서양인 vs 동양인). Smooth radial (ears) and windowed (nose)
// falloffs blend surrounding skin naturally. The nose moves AS A WHOLE (root →
// dorsum → tip → nostrils together); only the junction with the face — cheeks,
// philtrum/upper lip, brow — feathers so it blends instead of tearing.
//
// Coordinate frame (baked group space, metres): +x = avatar LEFT, +y = up,
// +z = forward/face, pupil-midpoint at origin. See bakeHeadMesh in mannequin.js.
// Naming trap: avatar RIGHT ear = −x (earMaskL); avatar LEFT ear = +x (earMaskR).

import * as THREE from 'three';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// C¹ raised-cosine radial falloff: 1 at t=0, 0 at t>=1, zero slope both ends.
const cosFall = (t) => (t >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * t)));
// C¹ smoothstep ramp on [a,b]: 0 below a, 1 above b.
const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Symmetric smooth bump: 1 in [c0,c1], feathering to 0 over `f` on each side.
const bump = (x, c0, c1, f) => smooth(x, c0 - f, c0) * (1 - smooth(x, c1, c1 + f));

// ── Tunable constants (empirical — iterate visually) ──
const R_EAR = 0.024;   // ear influence radius (m)
const EAR_BAND = { zMax: 0.005, xMin: 0.030, yMin: -0.032, yMax: 0.052 };
const NOSE = {
  yCore0: -0.030, yCore1: 0.015, yFeather: 0.009,  // whole nose: 콧방울 아래 ~ 콧등 뿌리(미간); 위=미간/아래=인중 페더
  xEdge: 0.015, xFeather: 0.011,                    // 코 폭(콧방울 포함), 볼로 페더
  zGate0: 0.020, zGate1: 0.032,                     // 전방 코 표면만 (깊은 내부/얼굴면 제외)
  k: 0.45,                                          // thickness↔protrusion coupling ratio
};
const EPS = 1e-3;

export function createHeadDeform({ headMesh, restPositions }) {
  const pos = headMesh.geometry.attributes.position;
  const arr = pos.array;
  const rest = restPositions;
  const n = pos.count;

  // Per-side ear centroids within the broadened ear band.
  const cR = new THREE.Vector3(), cL = new THREE.Vector3();
  let nR = 0, nL = 0;
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    if (z < EAR_BAND.zMax && y > EAR_BAND.yMin && y < EAR_BAND.yMax) {
      if (x > EAR_BAND.xMin) { cR.x += x; cR.y += y; cR.z += z; nR++; }
      else if (x < -EAR_BAND.xMin) { cL.x += x; cL.y += y; cL.z += z; nL++; }
    }
  }
  if (nR) cR.multiplyScalar(1 / nR);
  if (nL) cL.multiplyScalar(1 / nL);

  // Precompute masks: flat arrays [index, weight, ...] (ears) / [index, weight, sign].
  const earMaskR = [], earMaskL = [], noseMask = [];
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    // Ears — radial falloff from same-side centroid, gated by x-sign (fully independent).
    if (x > 0 && nR) {
      const d = Math.hypot(x - cR.x, y - cR.y, z - cR.z);
      const w = cosFall(clamp(d / R_EAR, 0, 1));
      if (w > EPS) earMaskR.push(i, w);
    } else if (x < 0 && nL) {
      const d = Math.hypot(x - cL.x, y - cL.y, z - cL.z);
      const w = cosFall(clamp(d / R_EAR, 0, 1));
      if (w > EPS) earMaskL.push(i, w);
    }
    // Nose — separable smooth window over the WHOLE nose (root→tip→nostrils);
    // feathers into cheeks / philtrum / brow so the nose moves as one natural unit.
    const wy = bump(y, NOSE.yCore0, NOSE.yCore1, NOSE.yFeather);
    if (wy > EPS) {
      const wx = bump(x, -NOSE.xEdge, NOSE.xEdge, NOSE.xFeather);
      const wz = smooth(z, NOSE.zGate0, NOSE.zGate1);
      const w = wx * wy * wz;
      if (w > EPS) noseMask.push(i, w, Math.sign(x));
    }
  }

  // params in millimetres. Rewrites from the rest baseline every call (idempotent).
  function deform(p = {}) {
    const earRY = (p.earRightY || 0) / 1000, earRZ = (p.earRightZ || 0) / 1000;
    const earLY = (p.earLeftY || 0) / 1000, earLZ = (p.earLeftZ || 0) / 1000;
    const dp = (p.noseBridge || 0) / 1000;

    arr.set(rest);   // reset to rest baseline

    // Avatar RIGHT ear = −x = earMaskL ; avatar LEFT ear = +x = earMaskR.
    for (let j = 0; j < earMaskL.length; j += 2) {
      const i = earMaskL[j], w = earMaskL[j + 1];
      arr[i * 3 + 1] += w * earRY; arr[i * 3 + 2] += w * earRZ;
    }
    for (let j = 0; j < earMaskR.length; j += 2) {
      const i = earMaskR[j], w = earMaskR[j + 1];
      arr[i * 3 + 1] += w * earLY; arr[i * 3 + 2] += w * earLZ;
    }
    // Nose bridge — forward protrusion + coupled proportional thickening.
    if (dp !== 0) {
      for (let j = 0; j < noseMask.length; j += 3) {
        const i = noseMask[j], w = noseMask[j + 1], sx = noseMask[j + 2];
        arr[i * 3] += w * NOSE.k * dp * sx;   // thickness (∝ protrusion; sign fans sides out/in)
        arr[i * 3 + 2] += w * dp;             // forward protrusion
      }
    }

    pos.needsUpdate = true;
    headMesh.geometry.computeVertexNormals();
    headMesh.geometry.computeBoundingSphere();
  }

  return { deform };
}
