// v3 Parametric glasses (PRD §9.2) — M2 full parameter set.
//
// Structure:
//   group (origin = pupil midpoint + [0, oh, vd+noseClearance], rot.x = panto)
//   ├─ sideL/sideR (Group at ±(pdHalf+pdErr), rot.y = ∓wrap)
//   │    ├─ rim (Shape+hole Extrude)  ├─ lens (transparent)
//   │    ├─ zonePlane (canvas-texture zone map, PRD §6.3a)
//   │    └─ temple (CatmullRom tube → measured ear anchor)
//   └─ bridge
//
// setParams(patch):
//   · transform-only params (vd/panto/oh) → cheap applyFit()
//   · geometry params (shape/lensH/wrap/pdErr/…) → full rebuild
// updateZoneSpec(spec): repaints the lens zone map from the fitting model.

import * as THREE from 'three';

export const FRAME_DEFAULTS = {
  lensW: 0.046,      // lens box width (m)
  lensH: 0.031,      // lens box height (B치수) — slim profile, clears the nose slope
  cornerR: 0.008,    // lens corner radius (square shape)
  rimT: 0.0018,      // rim thickness (border width)
  depth: 0.0018,     // rim extrusion depth
  vd: 0.012,         // vertex distance — pupil to lens back plane
  pantoDeg: 8,       // pantoscopic tilt
  wrapDeg: 5,        // face-form (wrap) angle
  oh: -0.002,        // fitting-height offset — pupil sits slightly above lens center
  pdErr: 0,          // per-lens horizontal offset error (m)
  shape: 'square',   // 'square' | 'round' | 'boston' | 'aviator'
  noseClearance: 0.010,
  earX: 0.082, earY: 0.010, earZ: -0.045,   // measured at runtime (app.js)
};

const GEO_KEYS = ['lensW', 'lensH', 'cornerR', 'rimT', 'depth', 'wrapDeg', 'pdErr', 'shape', 'earX', 'earY', 'earZ'];

// ── Lens outline shapes ────────────────────────────────────────────
function roundedRectPts(w, h, r, segments = 6) {
  const pts = [];
  const hw = w / 2, hh = h / 2;
  const corners = [
    { cx: hw - r, cy: hh - r, a0: 0 },
    { cx: -(hw - r), cy: hh - r, a0: Math.PI / 2 },
    { cx: -(hw - r), cy: -(hh - r), a0: Math.PI },
    { cx: hw - r, cy: -(hh - r), a0: -Math.PI / 2 },
  ];
  for (const c of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = c.a0 + (i / segments) * (Math.PI / 2);
      pts.push(new THREE.Vector2(c.cx + Math.cos(a) * r, c.cy + Math.sin(a) * r));
    }
  }
  return pts;
}

// Superellipse sampler — nTop/nBottom control squareness per half,
// dropBottom stretches the lower half (aviator teardrop).
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

// ── Zone-map canvas (shared by both lenses) ────────────────────────
const MAP_W = 256, MAP_H = 256;

function drawZoneMap(ctx, spec) {
  ctx.clearRect(0, 0, MAP_W, MAP_H);
  if (!spec) return;
  // Soft-zone gray base…
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(96, 98, 106, 0.52)';
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  const cx = MAP_W / 2;
  const distW = Math.min(1.2, spec.distance.h / 38) * 0.96 * MAP_W;
  const corrW = Math.max(10, Math.min(1.5, spec.intermediate.h / 11) * 0.30 * MAP_W);
  const nearR = Math.max(8, Math.min(1.4, spec.near.h / 15) * 0.26 * MAP_W);

  // …with the clear zones punched out
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(cx - distW / 2, 0, distW, MAP_H * 0.32);                       // distance
  ctx.beginPath();                                                           // corridor
  ctx.moveTo(cx - corrW * 0.42, MAP_H * 0.30);
  ctx.lineTo(cx + corrW * 0.42, MAP_H * 0.30);
  ctx.lineTo(cx + corrW / 2, MAP_H * 0.66);
  ctx.lineTo(cx - corrW / 2, MAP_H * 0.66);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();                                                           // near
  ctx.ellipse(cx, MAP_H * 0.78, nearR, MAP_H * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();

  // Subtle zone color cues on the clear areas
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(59, 130, 246, 0.10)';
  ctx.fillRect(cx - distW / 2, 0, distW, MAP_H * 0.30);
  ctx.fillStyle = 'rgba(34, 197, 94, 0.12)';
  ctx.fillRect(cx - corrW / 2, MAP_H * 0.32, corrW, MAP_H * 0.32);
  ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
  ctx.beginPath();
  ctx.ellipse(cx, MAP_H * 0.78, nearR, MAP_H * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── Builder ────────────────────────────────────────────────────────
export function createGlasses(anchors, opts = {}) {
  const p = { ...FRAME_DEFAULTS, ...opts };
  const group = new THREE.Group();
  group.name = 'glasses';

  // Tone-on-tone with the glossy white mannequin
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

  let built = [];   // meshes to dispose on rebuild

  function build() {
    for (const m of built) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    built = [];
    for (const c of [...group.children]) c.removeFromParent();

    const groupOffsetY = anchorMid.y + p.oh;
    const groupOffsetZ = anchorMid.z + p.vd + p.noseClearance;

    for (const side of [-1, 1]) {
      const sideG = new THREE.Group();
      sideG.position.x = side * (pdHalf + p.pdErr);
      // Wrap: outer edges sweep back toward the temples
      sideG.rotation.y = -side * THREE.MathUtils.degToRad(p.wrapDeg);
      group.add(sideG);

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

      // Zone map — slightly in front of the lens surface
      const zonePlane = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape(innerPts)), zoneMat,
      );
      zonePlane.position.z = 0.0006;
      zonePlane.renderOrder = 6;
      // ShapeGeometry UVs are in shape units — remap to 0..1 over the lens box
      remapUVs(zonePlane.geometry, p.lensW, p.lensH);
      sideG.add(zonePlane);
      built.push(zonePlane);

      // Temple → measured ear anchor (mannequin frame → side-local)
      const hinge = new THREE.Vector3(side * (p.lensW / 2 + p.rimT), p.lensH * 0.28, 0);
      const earLocal = new THREE.Vector3(
        side * p.earX - sideG.position.x,
        p.earY - groupOffsetY,
        p.earZ - groupOffsetZ,
      );
      const bowX = side * (Math.max(Math.abs(hinge.x), Math.abs(earLocal.x)) + 0.005);
      const mid = new THREE.Vector3(bowX, (hinge.y + earLocal.y) * 0.5, (hinge.z + earLocal.z) * 0.45);
      const temple = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([hinge, mid, earLocal]), 24, 0.0014, 8),
        frameMat,
      );
      sideG.add(temple);
      built.push(temple);
    }

    const innerGap = 2 * (pdHalf + p.pdErr) - p.lensW - p.rimT * 2;
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(innerGap, 0.006), 0.0028, 0.0018),
      frameMat,
    );
    bridge.position.set(0, p.lensH * 0.28, 0);
    group.add(bridge);
    built.push(bridge);
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
    group.position.set(anchorMid.x, anchorMid.y + p.oh, anchorMid.z + p.vd + p.noseClearance);
    // +x rotation tips the lens normal downward = pantoscopic tilt
    group.rotation.x = THREE.MathUtils.degToRad(p.pantoDeg);
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
    applyFit();
    if (lastSpec) updateZoneSpec(lastSpec);   // rebuilt planes need a repaint
  }

  function updateZoneSpec(spec) {
    lastSpec = spec;
    drawZoneMap(mapCtx, spec);
    mapTexture.needsUpdate = true;
  }

  build();
  applyFit();

  return { group, params: p, setParams, updateZoneSpec };
}
