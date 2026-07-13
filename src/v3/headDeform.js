// v3 Head deform — runtime vertex deformation of the facecap face mesh.
//
// Reposition both ears (Y up/down, Z front/back — bilaterally symmetric) and
// reshape the nose (forward protrusion coupled with proportional thickening), so
// the fitting studio can represent varied ear positions / different nose profiles
// (서양인 vs 동양인). Both regions use a flat-top separable window (weight ~1
// across the whole feature, feathering to 0 at the junction) so each feature
// moves AS A WHOLE unit — the ENTIRE ear (top → lobe), the ENTIRE nose (root →
// tip → nostrils) — while cheeks / philtrum / brow / skull stay put.
//
// Coordinate frame (baked group space, metres): +x = avatar LEFT, +y = up,
// +z = forward/face, pupil-midpoint at origin. See bakeHeadMesh in mannequin.js.
// Ears move symmetrically: one mask covers BOTH ears (|x| protrusion gate), same
// (dy, dz) applied to both — no per-side keys.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// C¹ smoothstep ramp on [a,b]: 0 below a, 1 above b.
const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Symmetric smooth bump: 1 in [c0,c1], feathering to 0 over `f` on each side.
const bump = (x, c0, c1, f) => smooth(x, c0 - f, c0) * (1 - smooth(x, c1, c1 + f));

// ── Tunable constants (empirical — iterate visually) ──
// Ear = flat-top window over the whole pinna (y −48…+10mm, z −100…−60mm) gated by
// |x| protrusion (skull side ≈ 74mm, pinna ≈ 82…89mm) so the WHOLE ear moves and
// the attachment feathers. Same window serves both ears (symmetric control).
const EAR = {
  yCore0: -0.048, yCore1: 0.010, yFeather: 0.012,   // 귓불 아래 ~ 귀 위 (아래=볼/위=두피 페더)
  zCore0: -0.100, zCore1: -0.060, zFeather: 0.014,  // 귀 앞뒤 (앞=볼/뒤=뒤통수 페더)
  xGate0: 0.070, xGate1: 0.082,                     // |x| 돌출 게이트: 두개골 제외, 귀 포함
};
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

  // Precompute masks: flat arrays [index, weight, ...] (ear) / [index, weight, sign] (nose).
  const earMask = [], noseMask = [];
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    // Ears — flat-top window over the whole pinna, |x| gate covers BOTH ears.
    const ey = bump(y, EAR.yCore0, EAR.yCore1, EAR.yFeather);
    if (ey > EPS) {
      const ez = bump(z, EAR.zCore0, EAR.zCore1, EAR.zFeather);
      if (ez > EPS) {
        const w = ey * ez * smooth(Math.abs(x), EAR.xGate0, EAR.xGate1);
        if (w > EPS) earMask.push(i, w);
      }
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
    const earY = (p.earY || 0) / 1000, earZ = (p.earZ || 0) / 1000;
    const dp = (p.noseBridge || 0) / 1000;

    arr.set(rest);   // reset to rest baseline

    // Ears — symmetric: same (dy, dz) on both ears (one mask covers both).
    for (let j = 0; j < earMask.length; j += 2) {
      const i = earMask[j], w = earMask[j + 1];
      arr[i * 3 + 1] += w * earY; arr[i * 3 + 2] += w * earZ;
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
