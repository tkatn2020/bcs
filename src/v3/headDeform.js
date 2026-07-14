// v3 Head deform — runtime vertex deformation of the facecap face mesh.
//
// Reposition both ears (Y up/down, Z front/back — per-side, symmetric by default)
// and reshape the nose (forward protrusion coupled with proportional thickening), so
// the fitting studio can represent varied ear positions / different nose profiles
// (서양인 vs 동양인). Both regions use a flat-top separable window (weight ~1
// across the whole feature, feathering to 0 at the junction) so each feature
// moves AS A WHOLE unit — the ENTIRE ear (top → lobe), the ENTIRE nose (root →
// tip → nostrils) — while cheeks / philtrum / brow / skull stay put.
//
// Coordinate frame (baked group space, metres): +x = avatar LEFT, +y = up,
// +z = forward/face, pupil-midpoint at origin. See bakeHeadMesh in mannequin.js.
// Ears: two masks split by x-sign (earMaskL = x>0 = avatar LEFT, earMaskR = x<0 =
// avatar RIGHT). deform() applies base (earY/earZ) to L and _R (or base if not
// asym) to R — symmetric when both equal.

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
// 옆통수(측두부) 폭 — 다리가 지나는 "눈 뒤 관자놀이 앞판"만 부드럽게 넓힌다.
// 핵심: 이 z대(−0.06~+0.02)에는 표면 정점이 |x|≈0.045~0.077에만 존재하고
// 중심선 표면이 없으므로, |x| 게이트 없이 균일하게 옆으로 밀어도 저폴리에서
// 톱니(facet)가 생기지 않는다. 예전의 |x| 상한 게이트(≈8mm 폭)는 관자놀이
// 정점 구름 한가운데를 잘라 인접 정점을 full↔0 으로 튀게 만든 톱니의 주범이라
// 제거했다. 귀(pinna, z<−0.062)는 z 뒤쪽 feather 로 완전히 배제한다.
const TEMPORAL = {
  yCore0: 0.004, yCore1: 0.014, yFeather: 0.030,   // 다리 높이 중심, 볼·정수리로 넓게 페더(완만)
  zCore0: -0.030, zCore1: -0.008, zFeather: 0.032, // 관자놀이 접촉 밴드; 뒤=귀앞(−0.062서 0)·앞=얼굴면 페더
};
const EPS = 1e-3;

export function createHeadDeform({ headMesh, restPositions }) {
  const pos = headMesh.geometry.attributes.position;
  const arr = pos.array;
  const rest = restPositions;
  const n = pos.count;

  // Precompute masks: flat arrays [index, weight, ...] (ear) / [index, weight, sign] (nose).
  // Ears split by x-sign for left/right independent adjustment: earMaskL = x>0 =
  // avatar LEFT, earMaskR = x<0 = avatar RIGHT. |x| protrusion weight unchanged.
  const earMaskL = [], earMaskR = [], noseMask = [], sideMaskL = [], sideMaskR = [];
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    // Ears — flat-top window over the whole pinna, |x| protrusion gate.
    const ey = bump(y, EAR.yCore0, EAR.yCore1, EAR.yFeather);
    if (ey > EPS) {
      const ez = bump(z, EAR.zCore0, EAR.zCore1, EAR.zFeather);
      if (ez > EPS) {
        const w = ey * ez * smooth(Math.abs(x), EAR.xGate0, EAR.xGate1);
        if (w > EPS) (x > 0 ? earMaskL : earMaskR).push(i, w);
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
    // Temporal/side — 눈 뒤 관자놀이 앞판을 부드러운 (y,z) 엔벨로프로 균일하게
    // 넓힌다. |x| 게이트 없음(이 z대엔 외곽 정점만 존재) → 균일 밀기라 톱니 없음.
    // 귀(pinna)는 z 뒤쪽 feather(−0.062서 0)로 배제. L = x>0, R = x<0.
    const ty = bump(y, TEMPORAL.yCore0, TEMPORAL.yCore1, TEMPORAL.yFeather);
    if (ty > EPS) {
      const tw = ty * bump(z, TEMPORAL.zCore0, TEMPORAL.zCore1, TEMPORAL.zFeather);
      if (tw > EPS) (x > 0 ? sideMaskL : sideMaskR).push(i, tw);
    }
  }

  // params in millimetres. Rewrites from the rest baseline every call (idempotent).
  function deform(p = {}) {
    // 왼쪽 = base(earY/earZ). 오른쪽 = 비대칭(Asym)이면 _R, 아니면 base.
    const earY = (p.earY || 0) / 1000, earZ = (p.earZ || 0) / 1000;
    const rY = ((p.earYAsym ? p.earY_R : p.earY) || 0) / 1000;
    const rZ = ((p.earZAsym ? p.earZ_R : p.earZ) || 0) / 1000;
    const dp = (p.noseBridge || 0) / 1000;
    // 옆통수 폭: 왼쪽 = base, 오른쪽 = 비대칭 시 _R.
    const wL = (p.faceWidth || 0) / 1000;
    const wR = ((p.faceWidthAsym ? p.faceWidth_R : p.faceWidth) || 0) / 1000;

    arr.set(rest);   // reset to rest baseline

    // Ears — per-side: 왼쪽(x>0) = base, 오른쪽(x<0) = _R (또는 대칭 시 base).
    for (let j = 0; j < earMaskL.length; j += 2) {
      const i = earMaskL[j], w = earMaskL[j + 1];
      arr[i * 3 + 1] += w * earY; arr[i * 3 + 2] += w * earZ;
    }
    for (let j = 0; j < earMaskR.length; j += 2) {
      const i = earMaskR[j], w = earMaskR[j + 1];
      arr[i * 3 + 1] += w * rY; arr[i * 3 + 2] += w * rZ;
    }
    // Nose bridge — forward protrusion + coupled proportional thickening.
    if (dp !== 0) {
      for (let j = 0; j < noseMask.length; j += 3) {
        const i = noseMask[j], w = noseMask[j + 1], sx = noseMask[j + 2];
        arr[i * 3] += w * NOSE.k * dp * sx;   // thickness (∝ protrusion; sign fans sides out/in)
        arr[i * 3 + 2] += w * dp;             // forward protrusion
      }
    }
    // Temporal widen — L(x>0) push +x, R(x<0) push −x → 옆통수 폭 확대(바깥으로).
    if (wL) for (let j = 0; j < sideMaskL.length; j += 2) arr[sideMaskL[j] * 3] += sideMaskL[j + 1] * wL;
    if (wR) for (let j = 0; j < sideMaskR.length; j += 2) arr[sideMaskR[j] * 3] += sideMaskR[j + 1] * (-wR);

    pos.needsUpdate = true;
    headMesh.geometry.computeVertexNormals();
    headMesh.geometry.computeBoundingSphere();
  }

  return { deform };
}
