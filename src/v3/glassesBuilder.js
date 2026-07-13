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

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

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
  // 좌우 귀 지점 (실측, app.js). null이면 대칭 fallback 사용.
  earR: null, earL: null,
  earY: 0.010, earZ: -0.045,   // fallback (측정 실패 시 대칭 가정)

  // ── 프레임 피팅 커스텀 (광학 무관, 순수 다리 지오메트리) ──
  templeAngle: 0,    // 다리 경사각 오프셋 (deg, + = 다리 끝이 아래로)
  templeLen: 0,      // 다리 길이 오프셋 (m, − = 귀 앞에서 끝)
  templeGap: 0,      // 얼굴 옆면 간격 (m, 0 = 측두부 피부 밀착, + = 벌어짐)
  templeBend: 60,    // 다리 몸통 밴딩 (deg, 0 = 직선, 90 = 머리 곡률 완전 밀착)
  endpiece: 0,       // 엔드피스(힌지) 높이 오프셋 (m)
  headSideX: null,   // (z, side)=>x 측두부 옆면 프로파일 — app.js에서 실측 주입
};

const GEO_KEYS = [
  'lensW', 'lensH', 'cornerR', 'rimT', 'depth', 'wrapDeg', 'pdErr', 'shape',
  'vd', 'oh', 'earR', 'earL', 'earY', 'earZ', 'noseClearance',
  'templeAngle', 'templeLen', 'templeGap', 'templeBend', 'endpiece',
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
  const corrNorm = Math.min(1.5, spec.intermediate.h / 11);
  const nearNorm = Math.min(1.4, Math.max(0.2, spec.near.h / 15));
  // Distortion trade-off (fittingModel §14.1): frame size drives BOTH the
  // exposed wing AREA and the gradient DENSITY.
  const dist = spec.distortion || { area: 1, density: 1 };
  const area = dist.area;         // 큰 프레임 → 날개가 렌즈 안쪽까지 크게
  const density = dist.density;   // 작은 프레임 → 짙고 통로가 좁아짐

  // Wing top: better corridor pushes wings lower; larger area pulls them up
  // (more of the lens is distorted).
  const wingTopY = MAP_H * clamp(0.30 + 0.16 * corrNorm - 0.10 * (area - 1), 0.20, 0.62);
  // Waist width = clear corridor at mid height; density squeezes it inward.
  const waistHalf = Math.max(6, (corrNorm * 0.115 * MAP_W) / density);
  const gapHalf = Math.max(10, (nearNorm * 0.20 * MAP_W) / Math.sqrt(density));
  // Larger frame → wing reaches further toward the lens center (more exposure).
  const edgeReach = 0.52 - 0.06 * (area - 1);

  for (const side of [-1, 1]) {
    const edgeX = cx + side * MAP_W * 0.52;
    const innerX = cx + side * MAP_W * edgeReach;
    const waistX = cx + side * waistHalf;
    const gapX = cx + side * gapHalf;

    const boundary = new Path2D();
    boundary.moveTo(innerX, wingTopY);
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

    const wing = new Path2D(boundary);
    wing.lineTo(edgeX, MAP_H * 1.04);
    wing.lineTo(edgeX, wingTopY);
    wing.closePath();

    // Density → beige opacity (denser distortion reads darker/stronger).
    const alpha = clamp(0.62 + 0.22 * (density - 1), 0.5, 0.99);
    ctx.fillStyle = `rgba(222, 200, 158, ${alpha.toFixed(3)})`;
    ctx.fill(wing);

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
      // Structure: endpiece(hinge) → temple BODY(측두부 밀착·밴딩·경사·간격)
      //            → ear top → drop(고정 이어피스, 길이만 templeLen).
      const hx = p.lensW / 2 + p.rimT;
      const groupOffsetY = anchorMid.y + p.oh;
      const groupOffsetZ = anchorMid.z + effZ();
      const headX = p.headSideX || (() => 0.072);   // 측두부 옆면 x(z, side)
      // 이 쪽 귀 지점 (좌우 실측, 없으면 대칭 fallback)
      const ear = (side > 0 ? p.earR : p.earL) || { y: p.earY, z: p.earZ };

      // 1) Endpiece / hinge — the rim's outer-top corner in GROUP space.
      // The rim lives under frontG(panto rot) > sideG(wrap rot), so the temple
      // (a group child) must transform that corner through both rotations to
      // stay welded to the frame. Endpiece offsets the connection height.
      const pantoRad = THREE.MathUtils.degToRad(p.pantoDeg);
      const sideW = side * wrapRad;
      // sideG-local endpiece corner → frontG-local (apply wrap, z=0)
      const Ex = side * hx, Ey = p.endpiece;   // (Ey relative to hinge line)
      const fx = Ex * Math.cos(sideW) + side * (pdHalf + p.pdErr);
      const fz = -Ex * Math.sin(sideW);
      // frontG-local → group-local (apply panto about hinge line, +hingeY)
      const cp = Math.cos(pantoRad), sp = Math.sin(pantoRad);
      const hinge = new THREE.Vector3(
        fx,
        hingeY + (Ey * cp - fz * sp),
        Ey * sp + fz * cp,
      );

      // 2) Ear-rest (몸통 끝 = 귀가 머리에 붙는 상단 홈) — 실측 위치에 안착.
      // ear는 귀 최외곽점(app.js). 끝점 x는 귀 최외곽이 아니라 측두부 표면
      // (귀-머리 접합부)이라야 템플이 귀 위 홈에 얹히고 귀 뒤로 드롭한다.
      const earTopZ = ear.z - groupOffsetZ;
      const earRestX = headX(earTopZ, side) + p.templeGap;   // 측두부 표면 (+ 옆면 간격)
      const bodyRun = Math.abs(earTopZ - hinge.z);
      // 오른쪽 귀가 더 파묻히는 비대칭 두상 보정 — 오른쪽 템플만 −2° 상향
      // (baseline). 프레임 커스텀 templeAngle 위에 더해진다. + = 끝이 아래로.
      const angleBias = side > 0 ? -2 : 0;
      const angleRad = THREE.MathUtils.degToRad(p.templeAngle + angleBias);
      const earTopY = (ear.y - groupOffsetY) - bodyRun * Math.tan(angleRad);  // 경사각

      // 3) 몸통 곡선 — hinge → 귀 상단. 양끝(hinge·귀)은 고정, 중간만 측두부
      //    곡률로 밴딩(bow=0 at 양끝, 최대 at 중앙). 밴딩 0=직선, 90=관자놀이
      //    밀착. gap은 다리 전체를 머리에서 이격.
      const bendFrac = clamp(p.templeBend / 90, 0, 1);
      const bodyPts = [];
      const N = 8;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const z = hinge.z + (earTopZ - hinge.z) * t;
        const straightX = Math.abs(hinge.x) + (earRestX - Math.abs(hinge.x)) * t;  // hinge→귀 직선
        const surfX = headX(z, side) + p.templeGap;             // 측두부 표면
        const bow = bendFrac * t * (1 - t) * 4;                 // 양끝 0, 중앙 1
        const x = side * (straightX + (surfX - straightX) * bow);
        const y = hinge.y + (earTopY - hinge.y) * t;
        bodyPts.push(new THREE.Vector3(x, y, z));
      }
      const earTop = bodyPts[bodyPts.length - 1];

      // 4) Drop — 귀 뒤로 내려가는 고정 이어피스 (길이만 templeLen).
      const dropLen = Math.max(0.004, 0.020 + p.templeLen);
      const dropRad = THREE.MathUtils.degToRad(62);
      const dropEnd = new THREE.Vector3(
        earTop.x,
        earTop.y - dropLen * Math.sin(dropRad),
        earTop.z - dropLen * Math.cos(dropRad),
      );

      const curve = new THREE.CatmullRomCurve3([...bodyPts, dropEnd]);
      const temple = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 40, 0.0014, 8),
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
