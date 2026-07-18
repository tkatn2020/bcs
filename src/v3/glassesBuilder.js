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
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

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
  templeBend: 20,    // 다리 몸통 밴딩 (deg, 0 = 직선, 90 = 머리 곡률 완전 밀착)
  earTipAngle: 118,  // 귀팁각(귀 꺾임부) — deg, 180 = 직선, 90 = 수직 하향
  earConverge: 0,    // 귀모임각 — deg, + = 드롭 끝 안쪽(모아짐), − = 바깥(벌어짐)
  endpiece: 0,       // 엔드피스(힌지) 높이 오프셋 (m)
  // 좌우 비대칭 오른쪽값(_R) — app.js가 대칭 시 base로 해석해 넘김
  templeAngle_R: 0, templeGap_R: 0, templeBend_R: 20, earTipAngle_R: 118, earConverge_R: 0,
  faceWidth: 0, faceWidth_R: 0,   // 옆통수 폭 splay (m) — 측두부 표면에 가산
  headSideX: null,   // (z, side)=>x 측두부 옆면 프로파일 — app.js에서 실측 주입

  // ── 코받침(코패드) — 광학 무관 ──
  padOn: true,       // 코받침 표시
  padSpacing: 0,     // 좌우 간격 오프셋 (m, + = 넓게)
  padVertical: 0,    // 상하 위치 오프셋 (m, + = 위)
  padArm: 0,         // 암 길이 오프셋 (m, + = 코 아래로 길게)
};

const GEO_KEYS = [
  'lensW', 'lensH', 'cornerR', 'rimT', 'depth', 'wrapDeg', 'pdErr', 'shape',
  'vd', 'oh', 'earR', 'earL', 'earY', 'earZ', 'noseClearance', 'headSideX',
  'templeAngle', 'templeLen', 'templeGap', 'templeBend', 'earTipAngle', 'endpiece',
  'templeAngle_R', 'templeGap_R', 'templeBend_R', 'earTipAngle_R', 'faceWidth', 'faceWidth_R',
  'earConverge', 'earConverge_R',
  'padOn', 'padSpacing', 'padVertical', 'padArm',
];

// 다리(템플) 강체 회전 기준 각도 — 이 경사각/안면각에서 다리가 귀에 안착하고,
// 여기서 벗어나면 프런트(엔드피스+렌즈)와 한 몸으로 회전한다(경사각↑=다리 위,
// 안면각↑=다리 오므려짐). 표준 피팅값과 일치시킨다.
const TEMPLE_REF_PANTO = FRAME_DEFAULTS.pantoDeg;
const TEMPLE_REF_WRAP = FRAME_DEFAULTS.wrapDeg;

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
  // Waist width = clear corridor at mid height. 코리도 '폭'은 누진면 속성이라 프레임
  // 크기와 무관(3D 콘 intermediate.h와 동일). 존맵은 렌즈에 입힌 텍스처라 렌즈가
  // 커지면 텍스처도 늘어나므로, area(프레임 스케일)로 나눠 렌즈 확대를 상쇄 → 월드
  // 기준 코리도 폭이 프레임과 무관해진다(큰 렌즈=얇은 채널, 작은 렌즈=렌즈를 채움 =
  // 소형 프레임이 누진에 불리하다는 교육). 두 뷰 일치(A2). add/코리도는 corrNorm에 반영.
  const waistHalf = Math.max(6, (corrNorm * 0.115 * MAP_W) / area);
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
  // 아이포인트 십자(가공 전 기준) — 실제 누진렌즈의 피팅 크로스 마킹처럼
  // 렌즈 위 광학중심 자리를 표시. 동공과 어긋난 만큼이 곧 미보정 편심.
  const crossMat = new THREE.MeshBasicMaterial({
    color: 0xe11d48, transparent: true, opacity: 0.85,
    depthWrite: false, side: THREE.DoubleSide,
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
    // ── 프레임 = 강체 '제품' 스케일 ──
    // 프레임 크기는 렌즈만이 아니라 프런트 전체(렌즈 간격·브릿지·코받침)를
    // 중앙(x=0) 기준으로 통째로 비례시킨다 — 큰 테 = 렌즈 중심이 동공 바깥으로
    // 벌어진 "얼굴보다 큰 안경" 모습, 작은 테 = 그 반대. 기준은 bSize 26
    // (fscale=1)이고, PD 오차는 스케일 후 절대 mm로 가산(가공 편심 오차).
    const refW26 = 0.046 * 26 / 31;
    const fscale = p.lensW / refW26;
    const frameHalf = pdHalf * fscale + p.pdErr;

    frontG = new THREE.Group();
    frontG.position.set(0, hingeY, 0);     // pivot at the hinge line
    group.add(frontG);

    for (const side of [-1, 1]) {
      const sideG = new THREE.Group();
      sideG.position.set(side * frameHalf, -hingeY, 0);
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
      remapUVs(zonePlane.geometry);
      sideG.add(zonePlane);
      built.push(zonePlane);

      // 아이포인트 십자 — 렌즈에 고정된 광학중심 자리. 로컬 (0, +2mm):
      // 표준 피팅(oh 슬라이더 0)에서 동공과 정확히 일치하고(기본 −2mm 착용
      // 바이어스 상쇄), 프레임 확대·PD·OH 조정 시 동공에서 벌어지는 양이
      // fittingModel의 편심(decMm)·oh와 픽셀 단위로 일치한다.
      for (const [w, h] of [[0.004, 0.0004], [0.0004, 0.004]]) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, h), crossMat);
        bar.position.set(0, 0.002, 0.0012);
        bar.renderOrder = 7;
        sideG.add(bar);
        built.push(bar);
      }

      // Nose pad (코받침) — thin metal arm from the lower-inner rim border to a
      // small pad resting on the nose side. Parented to sideG → inherits wrap/
      // panto/VD/oh, so it stays welded to the frame with no manual transform.
      // The arm ROOT is buried in the rim border and never moves with the
      // sliders (weld always intact); only the pad ANCHOR A is driven.
      if (p.padOn) {
        // 뿌리 R = 렌즈 안쪽 가장자리(리무 테두리 안, 코 방향) — 여기서 아래로
        // 뻗어 내려간다. 렌즈 세로 중앙 부근(살짝 위)에 두어 예전 상단(0.22)과
        // 하단(−0.18)의 중간 높이로. 슬라이더 무관 고정 → 용접 유지.
        // 코받침도 '제품의 일부' — 프런트 강체 스케일에 포함(sideG 자식 + 렌즈
        // 치수 기반)돼 큰 테에선 좌우로 벌어져 코에 헐렁하게 걸친 모습이 된다.
        const rootY = p.lensH * 0.02;
        const rootX = -side * (p.lensW / 2 + p.rimT * 0.4);
        const R = new THREE.Vector3(rootX, rootY, 0);
        // 패드 A는 뿌리보다 낮은 콧대 옆면 위치에 얹힌다(뿌리와 높이 분리 → 긴 암).
        const dropRad = THREE.MathUtils.degToRad(58);
        const padY = -p.lensH * 0.15 - 0.0070;                 // 패드 기본 높이
        const A = new THREE.Vector3(
          rootX - side * 0.0015 + side * p.padSpacing,          // 좌우 간격(안쪽=코)
          padY - p.padArm * Math.sin(dropRad) + p.padVertical,  // 상하 + 길이
          Math.min(-0.001, -(0.0085 + p.padArm * Math.cos(dropRad))),  // 코쪽(뒤). 극단값서 림 앞으로 안 나가게 클램프
        );
        const mid = new THREE.Vector3(
          (R.x + A.x) / 2, (R.y + A.y) / 2, (R.z + A.z) / 2 - 0.0015,   // 살짝 bow
        );
        const arm = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3([R, mid, A]), 24, 0.0007, 8),
          frameMat,
        );
        sideG.add(arm);
        built.push(arm);

        const padGeo = new THREE.SphereGeometry(1, 20, 16);
        padGeo.scale(0.0022, 0.0045, 0.0011);   // 4.4 × 9 × 2.2 mm ellipsoid
        const pad = new THREE.Mesh(padGeo, frameMat);
        pad.position.set(A.x - side * 0.0004, A.y, A.z);   // embed arm tip (no gap)
        pad.rotation.z = side * THREE.MathUtils.degToRad(12);
        pad.rotation.y = side * THREE.MathUtils.degToRad(20);   // face onto nose side
        sideG.add(pad);
        built.push(pad);
      }

      // Temple — sideG(안면각)·frontG(경사각)의 자식으로 붙여 프런트와 한 몸으로
      // 회전한다: 경사각↑ = 다리 위로, 안면각↑ = 다리·엔드피스가 커브 따라 오므려짐.
      // 다리 형상(밴딩·경사·간격·엔드피스)은 sideG-로컬(표준 각도 기준)에서 만들고,
      // 실제 panto/wrap은 부모 회전이 얹으므로 서로 독립(템플 조정≠경사/안면각).
      // Structure: endpiece(hinge) → temple BODY(측두부 밀착·밴딩·경사·간격)
      //            → ear top → drop(고정 이어피스, 길이만 templeLen).
      const hx = p.lensW / 2 + p.rimT;
      const groupOffsetY = anchorMid.y + p.oh;
      const groupOffsetZ = anchorMid.z + effZ();
      const headX = p.headSideX || (() => 0.072);   // 측두부 옆면 x(z, side)
      // 이 쪽 귀 지점 (좌우 실측, 없으면 대칭 fallback)
      const ear = (side > 0 ? p.earR : p.earL) || { y: p.earY, z: p.earZ };

      // 좌우 비대칭: side>0(+x)=아바타 왼쪽=base, side<0(−x)=오른쪽=_R.
      // app.js가 대칭 시 _R=base로 넘기므로 여기선 플래그 없이 side만으로 분기.
      const templeAngle = side > 0 ? p.templeAngle : p.templeAngle_R;
      const templeGap   = side > 0 ? p.templeGap   : p.templeGap_R;
      const templeBend  = side > 0 ? p.templeBend   : p.templeBend_R;
      const earTipAngle = side > 0 ? p.earTipAngle : p.earTipAngle_R;
      const faceWidth   = side > 0 ? p.faceWidth   : p.faceWidth_R;   // 옆통수 폭(측두 splay)
      const earConverge = side > 0 ? p.earConverge : p.earConverge_R; // 귀모임각(드롭 옆기울기)

      // 1) Endpiece / hinge — 표준(REF) 경사각·안면각에서의 힌지 위치를 GROUP
      // 공간에 잡는다(실제 회전은 뒤에서 부모 sideG/frontG가 담당). 몸통·귀·드롭도
      // 이 REF 기준으로 만든 뒤, 마지막에 sideG-로컬로 역변환해 sideG에 붙인다.
      const refPantoRad = THREE.MathUtils.degToRad(TEMPLE_REF_PANTO);
      const refWrapRad = side * THREE.MathUtils.degToRad(TEMPLE_REF_WRAP);
      const sideW = refWrapRad;
      const Ex = side * hx, Ey = p.endpiece;   // (Ey relative to hinge line)
      const fx = Ex * Math.cos(sideW) + side * frameHalf;
      const fz = -Ex * Math.sin(sideW);
      const cp = Math.cos(refPantoRad), sp = Math.sin(refPantoRad);
      const hinge = new THREE.Vector3(
        fx,
        hingeY + (Ey * cp - fz * sp),
        Ey * sp + fz * cp,
      );

      // 2) Ear-rest (몸통 끝 = 귀가 머리에 붙는 상단 홈) — 실측 위치에 안착.
      // ear는 귀 최외곽점(app.js). 끝점 x는 귀 최외곽이 아니라 측두부 표면
      // (귀-머리 접합부)이라야 템플이 귀 위 홈에 얹히고 귀 뒤로 드롭한다.
      const earTopZ = ear.z - groupOffsetZ;
      // 옆면 간격 비대칭 보정(초기 세팅 기준) — 아바타 오른쪽 +6mm, 왼쪽 +3.5mm.
      // 프레임 커스텀 templeGap 위에 더해진다. side>0=아바타 왼쪽, side<0=오른쪽.
      // (2026-07-16 재캘리: 기준 간격을 기존보다 +1mm — 표시 0 = 기존 1mm 상태)
      const gapBias = side > 0 ? 0.0035 : 0.006;
      const earRestX = headX(earTopZ, side) + templeGap + gapBias + faceWidth;   // 측두부 표면 (+ 옆면 간격 + 옆통수 폭)
      const bodyRun = Math.abs(earTopZ - hinge.z);
      // 비대칭 두상 보정 — 좌우 귀 접합부에 정확히 맞닿도록 실측 조정.
      // 좌표계: 아바타가 +z를 바라봐 side>0(+x)=아바타 왼쪽, side<0(−x)=아바타
      // 오른쪽. 아바타 오른쪽 −1°, 왼쪽 +2°(끝 하향). 프레임 커스텀
      // templeAngle 위에 더해진다. + = 끝이 아래로.
      const angleBias = side > 0 ? 2 : -1;
      const angleRad = THREE.MathUtils.degToRad(templeAngle + angleBias);
      const earTopY = (ear.y - groupOffsetY) - bodyRun * Math.tan(angleRad);  // 경사각

      // 3) 몸통 곡선 — hinge → 귀 상단. 양끝(hinge·귀)은 고정, 중간만 측두부
      //    곡률로 밴딩(bow=0 at 양끝, 최대 at 중앙). 밴딩 0=직선, 90=관자놀이
      //    밀착. gap은 다리 전체를 머리에서 이격.
      const bendFrac = clamp(templeBend / 90, 0, 1);
      const bodyPts = [];
      const N = 8;
      // 깔끔한 단일 활꼴(아크): 측두부 프로파일을 점별로 따라가면(가중 블렌드)
      // 프로파일 굴곡 + 귀 직전 급복귀로 다리가 꾸불꾸불해진다. 대신 중앙
      // 새그(sag)만 표면 기준으로 잡고 순수 포물선 아크(≈원호)로 그린다 —
      // 전 구간 일정한 곡률의 매끈한 커브, 밴딩 90°면 중앙이 표면에 닿는다.
      const zMid = (hinge.z + earTopZ) / 2;
      const chordMidX = (Math.abs(hinge.x) + earRestX) / 2;
      const surfMidX = headX(zMid, side) + templeGap + gapBias + faceWidth;
      const sag = bendFrac * (surfMidX - chordMidX);
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const z = hinge.z + (earTopZ - hinge.z) * t;
        const straightX = Math.abs(hinge.x) + (earRestX - Math.abs(hinge.x)) * t;  // hinge→귀 직선
        const x = side * (straightX + sag * 4 * t * (1 - t));
        const y = hinge.y + (earTopY - hinge.y) * t;
        bodyPts.push(new THREE.Vector3(x, y, z));
      }
      const earTop = bodyPts[bodyPts.length - 1];

      // 4) Drop — 귀 뒤로 내려가는 이어피스. 귀팁각(꺾임부 하강각): 180=직선(수평 뒤),
      //    90=수직 하향. 귀모임각(earConverge): 드롭(꺾임 이후)만 옆으로 기울여 끝을
      //    안쪽(모아짐, +)/바깥(벌어짐, −)으로 — earTop(꺾임점)·몸통은 고정, 드롭만
      //    회전. cc로 드롭 길이 유지(하강 성분 축소, 옆 성분 추가 = 순수 옆기울기).
      const dropLen = Math.max(0.004, 0.020 + p.templeLen);
      const dropRad = THREE.MathUtils.degToRad(clamp(180 - earTipAngle, 0, 90));
      const convRad = THREE.MathUtils.degToRad(earConverge);
      const cc = Math.cos(convRad);
      // 밴딩 연장(귀 끝까지): 밴딩이 클수록 드롭(귀팁)도 안쪽으로 감아 다리
      // '전체'가 얼굴을 감싼다. 팁으로 갈수록 강하게(t²), 90°서 팁 6mm 안쪽.
      // 귀모임각(earConverge)의 옆기울기와 가산 합성.
      const wrapIn = bendFrac * 0.006;
      const dropPt = (t) => new THREE.Vector3(
        earTop.x - side * (dropLen * t * Math.sin(convRad) + wrapIn * t * t),
        earTop.y - dropLen * t * Math.sin(dropRad) * cc,
        earTop.z - dropLen * t * Math.cos(dropRad) * cc,
      );
      const dropMid = dropPt(0.5);
      const dropEnd = dropPt(1);

      // REF 기준 GROUP 좌표를 sideG-로컬로 역변환 — 부모 sideG(안면각)·frontG(경사각)
      // 회전을 다시 얹으면, 실제 각도 = 표준일 때 귀에 안착하고 벗어나면 함께 회전.
      const qUnPanto = new THREE.Quaternion().setFromAxisAngle(X_AXIS, refPantoRad).invert();
      const qUnWrap = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, refWrapRad).invert();
      const frontGp = new THREE.Vector3(0, hingeY, 0);
      const sideGp = new THREE.Vector3(side * frameHalf, -hingeY, 0);
      const toSideLocal = (pg) =>
        pg.sub(frontGp).applyQuaternion(qUnPanto).sub(sideGp).applyQuaternion(qUnWrap);

      const curve = new THREE.CatmullRomCurve3([...bodyPts, dropMid, dropEnd].map(toSideLocal));
      const temple = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 40, 0.0014, 8),
        frameMat,
      );
      sideG.add(temple);   // 프런트와 한 몸 → panto/wrap 함께 회전
      built.push(temple);
    }

    // 브릿지 = 렌즈 사이 실제 간격. 프런트 전체가 강체 스케일이므로 간격도
    // 프레임 크기에 자연 비례(큰 테=큰 브릿지)하고 항상 림에 붙어 있다.
    const innerGap = 2 * frameHalf - p.lensW - p.rimT * 2;
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(innerGap, 0.005), 0.0028, 0.0018),
      frameMat,
    );
    bridge.position.set(0, 0, 0);          // hinge height in frontG frame
    frontG.add(bridge);
    built.push(bridge);

    applyFit();
  }

  function remapUVs(geo) {
    // 존맵 텍스처를 렌즈 실제 외곽(bounding box)에 정확히 매핑 — 원형·애비에이터처럼
    // 실폭/실높이가 lensW/lensH와 다른 형태에서도 왜곡 도표가 어긋나지 않게.
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const w = (bb.max.x - bb.min.x) || 1, h = (bb.max.y - bb.min.y) || 1;
    const cx = (bb.max.x + bb.min.x) / 2, cy = (bb.max.y + bb.min.y) / 2;
    const uv = geo.attributes.uv;
    const pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (pos.getX(i) - cx) / w + 0.5, (pos.getY(i) - cy) / h + 0.5);
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
