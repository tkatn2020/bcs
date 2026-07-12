// v3 Parametric glasses — square acetate frame v1 (PRD §9.2).
// Built relative to the pupil anchors: lens centers sit on the pupils, the
// lens plane floats VD in front of them. All fitting parameters live in one
// params object so M2 drag-handles can mutate + rebuild/transform.
//
// Frame shapes beyond 'square' (round/boston/aviator) arrive in M2 —
// swap the shape function only.

import * as THREE from 'three';

export const FRAME_DEFAULTS = {
  lensW: 0.046,      // lens box width (m)
  lensH: 0.031,      // lens box height (B치수) — slim profile, clears the nose slope
  cornerR: 0.008,    // lens corner radius
  rimT: 0.0018,      // rim thickness (border width) — thin wire-adjacent look
  depth: 0.0018,     // rim extrusion depth
  vd: 0.012,         // vertex distance — pupil to lens back plane
  pantoDeg: 8,       // pantoscopic tilt
  oh: -0.002,        // fitting-height offset — pupil sits slightly above lens center
  pdErr: 0,          // per-lens horizontal offset error (m)
  // facecap mesh has a deep-set brow/nose: extra forward clearance so the
  // frame clears the nasion at VD 12mm. VD slider still maps Δz 1:1.
  noseClearance: 0.010,
  // temple tip target in MANNEQUIN frame — measured from the head mesh at
  // runtime (app.js measureHead) and passed via opts; these are fallbacks.
  earX: 0.082, earY: 0.010, earZ: -0.045,
};

function roundedRectPts(w, h, r, segments = 6) {
  const pts = [];
  const hw = w / 2, hh = h / 2;
  const corners = [
    { cx: hw - r, cy: hh - r, a0: 0 },              // top-right
    { cx: -(hw - r), cy: hh - r, a0: Math.PI / 2 }, // top-left
    { cx: -(hw - r), cy: -(hh - r), a0: Math.PI },  // bottom-left
    { cx: hw - r, cy: -(hh - r), a0: -Math.PI / 2 },// bottom-right
  ];
  for (const c of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = c.a0 + (i / segments) * (Math.PI / 2);
      pts.push(new THREE.Vector2(c.cx + Math.cos(a) * r, c.cy + Math.sin(a) * r));
    }
  }
  return pts;
}

export function createGlasses(anchors, opts = {}) {
  const p = { ...FRAME_DEFAULTS, ...opts };
  const group = new THREE.Group();
  group.name = 'glasses';

  // Tone-on-tone with the glossy white mannequin: light warm-gray acetate,
  // slightly darker than the head so the silhouette still reads.
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0xd6d8dc, metalness: 0.05, roughness: 0.22, clearcoat: 1.0, clearcoatRoughness: 0.12,
  });
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfe2ee, transparent: true, opacity: 0.16,
    roughness: 0.05, side: THREE.DoubleSide, depthWrite: false,
  });

  const pdHalf = Math.abs(anchors.right.position.x);

  const rims = [];
  for (const side of [-1, 1]) {
    const cx = side * (pdHalf + p.pdErr);

    // Rim: outer rounded-rect with inner rounded-rect hole
    const outerPts = roundedRectPts(p.lensW + p.rimT * 2, p.lensH + p.rimT * 2, p.cornerR + p.rimT);
    const innerPts = roundedRectPts(p.lensW, p.lensH, p.cornerR);
    const shape = new THREE.Shape(outerPts);
    const hole = new THREE.Path(innerPts.slice().reverse());
    shape.holes.push(hole);
    const rimGeo = new THREE.ExtrudeGeometry(shape, { depth: p.depth, bevelEnabled: false });
    rimGeo.translate(0, 0, -p.depth / 2);
    const rim = new THREE.Mesh(rimGeo, frameMat);
    rim.position.x = cx;
    group.add(rim);
    rims.push(rim);

    // Lens: flat shape filling the hole
    const lens = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(innerPts)), lensMat);
    lens.position.set(cx, 0, 0);
    lens.renderOrder = 5;
    group.add(lens);

    // Temple: hinge at rim outer edge → over the ear (CatmullRom tube).
    // Ear target arrives in MANNEQUIN frame; convert to glasses-group local
    // (group origin = pupil midpoint + (0, oh, vd+clearance); ignore the small
    // panto rotation for the conversion — visually negligible at ≤12°).
    const groupOffsetY = anchors.left.position.y + p.oh;
    const groupOffsetZ = anchors.left.position.z + p.vd + p.noseClearance;
    const hinge = new THREE.Vector3(cx + side * (p.lensW / 2 + p.rimT), p.lensH * 0.28, 0);
    const earLocal = new THREE.Vector3(
      side * p.earX,
      p.earY - groupOffsetY,
      p.earZ - groupOffsetZ,
    );
    // Bow the temple OUTWARD so it passes around the skull, never through it.
    const bowX = side * (Math.max(Math.abs(hinge.x), Math.abs(earLocal.x)) + 0.005);
    const mid = new THREE.Vector3(bowX, (hinge.y + earLocal.y) * 0.5, (hinge.z + earLocal.z) * 0.45);
    const curve = new THREE.CatmullRomCurve3([hinge, mid, earLocal]);
    const temple = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.0016, 8), frameMat);
    group.add(temple);
  }

  // Bridge: connects inner rim edges near the top
  const innerGap = 2 * (pdHalf + p.pdErr) - p.lensW - p.rimT * 2;
  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(innerGap, 0.008), 0.0028, 0.0018),
    frameMat,
  );
  bridge.position.set(0, p.lensH * 0.28, 0);
  group.add(bridge);

  // ── Fitting transform: group origin at pupil midpoint ──
  const anchorMid = new THREE.Vector3()
    .addVectors(anchors.left.position, anchors.right.position)
    .multiplyScalar(0.5);

  function applyFit() {
    group.position.set(anchorMid.x, anchorMid.y + p.oh, anchorMid.z + p.vd + p.noseClearance);
    // +x rotation tips the lens normal downward = pantoscopic tilt
    group.rotation.x = THREE.MathUtils.degToRad(p.pantoDeg);
  }
  applyFit();

  function setParams(patch) {
    Object.assign(p, patch);
    applyFit();   // v1: transforms only; geometry params need rebuild (M2)
  }

  return { group, params: p, setParams };
}
