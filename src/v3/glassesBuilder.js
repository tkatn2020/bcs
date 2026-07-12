// v3 Parametric glasses (PRD §9.2) — M2+ full parameter set.
//
// Structure:
//   group (origin = pupil midpoint + [0, oh, effZ])
//   ├─ frontG (pivot at the HINGE LINE, rot.x = panto — so pantoscopic tilt
//   │         swings the lenses like real glasses while temples stay on ears)
//   │    ├─ sideL/sideR (Group at ±(pdHalf+pdErr), rot.y = wrap)
//   │    │    ├─ rim  ├─ lens  └─ zonePlane (canvas zone map)
//   │    └─ bridge
//   └─ temples (group children — start at the wrapped hinge, end on the
//               measured ear anchor; rebuilt when vd/oh/wrap change)
//
// VD semantics: p.vd = 0 means the lens plane touches the eye. The nose
// clearance (facecap mesh offset) collapses proportionally as vd → 0 so the
// full 0~16mm range is demonstrable.
//
// setParams(patch): transform-only (panto) → cheap; geometry/offset params
// (shape/lensW/lensH/wrap/pdErr/vd/oh/…) → rebuild.
// updateZoneSpec(spec): repaints the lens zone map (PAL diagram style —
// beige peripheral wings + dotted boundary, PRD §6.3a).

import * as THREE from 'three';

export const FRAME_DEFAULTS = {
  lensW: 0.046,      // lens box width (m)
  lensH: 0.031,      // lens box height (m)
  cornerR: 0.008,    // lens corner radius (square shape)
  rimT: 0.0018,      // rim thickness (border width)
  depth: 0.0018,     // rim extrusion depth
  vd: 0.012,         // vertex distance — pupil to lens back plane (0 = touching)
  pantoDeg: 8,       // pantoscopic tilt (−15~15)
  wrapDeg: 5,        // face-form angle (−15~15)
  oh: -0.002,        // fitting-height offset
  pdErr: 0,          // per-lens horizontal offset error (m)
  shape: 'square',   // 'square' | 'round' | 'boston' | 'aviator'
  noseClearance: 0.010,
  earX: 0.082, earY: 0.010, earZ: -0.045,   // measured at runtime (app.js)
};

const GEO_KEYS = [
  'lensW', 'lensH', 'cornerR', 'rimT', 'depth', 'wrapDeg', 'pdErr', 'shape',
  'vd', 'oh', 'earX', 'earY', 'earZ', 'noseClearance',
];

// ── Lens outline shapes ────────────────────────────────────────────
function roundedRectPts(w, h, r, segments = 6) {
  const pts = [];
  const hw = w / 2, hh = h / 2;
  const rr = Math.min(r, hw * 0.9, hh * 0.9);
  const corners = [
    { cx: hw - rr, cy: hh - rr, a0: 0 },
    { cx: -(hw - rr), cy: hh - rr, a0: Math.PI / 2 },
    { cx: -(hw - rr), cy: -(hh - rr), a0: Math.PI },
    { cx: hw - rr, cy: -(hh - rr), a0: -Math.PI / 2 },
  ];
  for (const c of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = c.a0 + (i / segments) * (Math.PI / 2);
      pts.push(new THREE.Vector2(c.cx + Math.cos(a) * rr, c.cy + Math.sin(a) * rr));
    }
  }
  return pts;
}

function superellipsePts(w, h, nTop, nBottom, dropBottom = 1, count = 64) {
  const pts = [];
  const a = w / 2, b = h / 2;
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const n = s >= 0 ? nTop : nBottom;
    const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    let y = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    if (s < 0) y *= dropBottom;
    pts.push(new THREE.Vector2(x, y));
  }
  return pts;
}

function lensOutline(p) {
  switch (p.shape) {
    case 'round':   return superellipsePts(p.lensW * 0.92, p.lensH, 2, 2);
    case 'boston':  return superellipsePts(p.lensW, p.lensH, 3.2, 2.0);
    case 'aviator': return superellipsePts(p.lensW, p.lensH * 0.92, 2.6, 1.7, 1.25);
    case 'square':
    default:        return roundedRectPts(p.lensW, p.lensH, p.cornerR);
  }
}

function outerOutline(p) {
  const t = p.rimT;
  switch (p.shape) {
    case 'round':   return superellipsePts(p.lensW * 0.92 + t * 2, p.lensH + t * 2, 2, 2);
    case 'boston':  return superellipsePts(p.lensW + t * 2, p.lensH + t * 2, 3.2, 2.0);
    case 'aviator': return superellipsePts(p.lensW + t * 2, (p.lensH + t * 2) * 0.92, 2.6, 1.7, 1.25);
    case 'square':
    default:        return roundedRectPts(p.lensW + t * 2, p.lensH + t * 2, p.cornerR + t);
  }
}

// ── Zone-map canvas — classic PAL diagram (참조 이미지 스타일) ──────
// Clear lens everywhere except two beige peripheral-distortion wings at the
// lower sides, bounded by dotted navy lines. Wing size follows the model:
// narrow corridor → wings close in; big near zone → wide bottom gap.
const MAP_W = 256, MAP_H = 256;

function drawZoneMap(ctx, spec) {
  ctx.clearRect(0, 0, MAP_W, MAP_H);
  if (!spec) return;

  const cx = MAP_W / 2;
  // Wing top: better (wider) corridor pushes the wings lower & smaller
  const corrNorm = Math.min(1.5, spec.intermediate.h / 11);
  const nearNorm = Math.min(1.4, Math.max(0.2, spec.near.h / 15));
  const wingTopY = MAP_H * Math.min(0.62, Math.max(0.30, 0.30 + 0.16 * corrNorm));
  const gapHalf = Math.max(14, nearNorm * 0.20 * MAP_W);   // bottom corridor gap
  const waistHalf = Math.max(8, corrNorm * 0.115 * MAP_W); // waist at mid height

  for (const side of [-1, 1]) {
    const edgeX = cx + side * MAP_W * 0.52;                // beyond lens edge
    const waistX = cx + side * waistHalf;
    const gapX = cx + side * gapHalf;

    // Inner dotted boundary path: lens edge (wing top) → waist → bottom gap
    const boundary = new Path2D();
    boundary.moveTo(edgeX, wingTopY);
    boundary.bezierCurveTo(
      cx + side * MAP_W * 0.30, wingTopY + MAP_H * 0.02,
      waistX, wingTopY + MAP_H * 0.10,
      waistX, wingTopY + MAP_H * 0.22,
    );
    boundary.bezierCurveTo(
      waistX, MAP_H * 0.88,
      gapX, MAP_H * 0.97,
      gapX + side * MAP_W * 0.02, MAP_H * 1.02,
    );

    // Wing fill: boundary + around the lens edge
    const wing = new Path2D(boundary);
    wing.lineTo(edgeX, MAP_H * 1.04);
    wing.closePath();
    ctx.fillStyle = 'rgba(222, 200, 158, 0.97)';   // 참조 이미지의 베이지 톤
    ctx.fill(wing);

    // Dotted navy boundary line
    ctx.strokeStyle = 'rgba(52, 74, 122, 0.95)';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.stroke(boundary);
    ctx.setLineDash([]);
  }
}

// ── Builder ────────────────────────────────────────────────────────
export function createGlasses(anchors, opts = {}) {
  const p = { ...FRAME_DEFAULTS, ...opts };
  const group = new THREE.Group();
  group.name = 'glasses';

  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0xd6d8dc, metalness: 0.05, roughness: 0.22, clearcoat: 1.0, clearcoatRoughness: 0.12,
  });
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfe2ee, transparent: true, opacity: 0.16,
    roughness: 0.05, side: THREE.DoubleSide, depthWrite: false,
  });

  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = MAP_W; mapCanvas.height = MAP_H;
  const mapCtx = mapCanvas.getContext('2d');
  const mapTexture = new THREE.CanvasTexture(mapCanvas);
  const zoneMat = new THREE.MeshBasicMaterial({
    map: mapTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  let lastSpec = null;

  const pdHalf = Math.abs(anchors.right.position.x);
  const anchorMid = new THREE.Vector3()
    .addVectors(anchors.left.position, anchors.right.position)
    .multiplyScalar(0.5);

  let built = [];
  let frontG = null;

  // Nose clearance collapses as vd → 0 so the lens can truly reach the eye.
  const effClearance = () => p.noseClearance * Math.min(1, Math.max(0, p.vd / 0.012));
  const effZ = () => p.vd + effClearance();

  function build() {
    for (const m of built) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    built = [];
    for (const c of [...group.children]) c.removeFromParent();

    const hingeY = p.lensH * 0.28;
    const wrapRad = THREE.MathUtils.degToRad(p.wrapDeg);

    frontG = new THREE.Group();
    frontG.position.set(0, hingeY, 0);     // pivot at the hinge line
    group.add(frontG);

    for (const side of [-1, 1]) {
      const sideG = new THREE.Group();
      sideG.position.set(side * (pdHalf + p.pdErr), -hingeY, 0);
      // Wrap: outer edges sweep BACK toward the temples (−wrap = 역랩)
      sideG.rotation.y = side * wrapRad;
      frontG.add(sideG);

      const innerPts = lensOutline(p);
      const outerPts = outerOutline(p);
      const shape = new THREE.Shape(outerPts);
      shape.holes.push(new THREE.Path(innerPts.slice().reverse()));
      const rimGeo = new THREE.ExtrudeGeometry(shape, { depth: p.depth, bevelEnabled: false });
      rimGeo.translate(0, 0, -p.depth / 2);
      const rim = new THREE.Mesh(rimGeo, frameMat);
      sideG.add(rim);
      built.push(rim);

      const lens = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(innerPts)), lensMat);
      lens.renderOrder = 5;
      sideG.add(lens);
      built.push(lens);

      const zonePlane = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(innerPts)), zoneMat);
      zonePlane.position.z = 0.0006;
      zonePlane.renderOrder = 6;
      remapUVs(zonePlane.geometry, p.lensW, p.lensH);
      sideG.add(zonePlane);
      built.push(zonePlane);

      // Temple (group child — unaffected by panto thanks to the hinge pivot).
      // Start = the hinge point in GROUP space, with wrap applied.
      const hx = p.lensW / 2 + p.rimT;
      const hingeGroup = new THREE.Vector3(
        side * (pdHalf + p.pdErr) + side * hx * Math.cos(wrapRad),
        hingeY,
        -hx * Math.sin(wrapRad),
      );
      const groupOffsetY = anchorMid.y + p.oh;
      const groupOffsetZ = anchorMid.z + effZ();
      const earLocal = new THREE.Vector3(
        side * p.earX,
        p.earY - groupOffsetY,
        p.earZ - groupOffsetZ,
      );
      const bowX = side * (Math.max(Math.abs(hingeGroup.x), Math.abs(earLocal.x)) + 0.005);
      const mid = new THREE.Vector3(bowX, (hingeGroup.y + earLocal.y) * 0.5, (hingeGroup.z + earLocal.z) * 0.45);
      const temple = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([hingeGroup, mid, earLocal]), 24, 0.0014, 8),
        frameMat,
      );
      group.add(temple);
      built.push(temple);
    }

    const innerGap = 2 * (pdHalf + p.pdErr) - p.lensW - p.rimT * 2;
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(innerGap, 0.006), 0.0028, 0.0018),
      frameMat,
    );
    bridge.position.set(0, 0, 0);          // hinge height in frontG frame
    frontG.add(bridge);
    built.push(bridge);

    applyFit();
  }

  function remapUVs(geo, w, h) {
    const uv = geo.attributes.uv;
    const pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    }
    uv.needsUpdate = true;
  }

  function applyFit() {
    group.position.set(anchorMid.x, anchorMid.y + p.oh, anchorMid.z + effZ());
    // Pantoscopic tilt swings the FRONT about the hinge line (+x = normal down)
    if (frontG) frontG.rotation.x = THREE.MathUtils.degToRad(p.pantoDeg);
  }

  function setParams(patch) {
    let geoChanged = false;
    let anyChanged = false;
    for (const [k, val] of Object.entries(patch)) {
      if (p[k] !== val) {
        p[k] = val;
        anyChanged = true;
        if (GEO_KEYS.includes(k)) geoChanged = true;
      }
    }
    if (!anyChanged) return;
    if (geoChanged) build();
    else applyFit();
    if (geoChanged && lastSpec) updateZoneSpec(lastSpec);
  }

  function updateZoneSpec(spec) {
    lastSpec = spec;
    drawZoneMap(mapCtx, spec);
    mapTexture.needsUpdate = true;
  }

  build();

  return { group, params: p, setParams, updateZoneSpec };
}
