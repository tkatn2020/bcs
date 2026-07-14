// v3 entry — 3D 아바타 피팅 스튜디오 bootstrap (M3 완성판).
// mannequin + glasses + vision zones + targets + drag handles
// + 시선 데모(D4) + 등급 고스트(D6) + 턴테이블(C4) + 홈뷰 더블탭(C5).

import * as THREE from 'three';
import { createStudioStage } from './studioStage.js';
import { loadMannequin } from './mannequin.js';
import { createGlasses } from './glassesBuilder.js';
import { createHeadDeform } from './headDeform.js';
import { createVisionZones } from './visionZones.js';
import { createTargets } from './targets.js';
import { createDemoDirector } from './demoDirector.js';
import { computeZones, STANDARD_FIT } from './fittingModel.js';
import { attachDragHandles } from './dragHandles.js';
import { mountControls } from './controls.js';
import { state, update, subscribe } from '../wavefront/state.js';

const HOME_VIEW = { pos: [0.62, 0.18, 0.72], tgt: [0.05, -0.02, 0.28] };
const STANDARD_FRAME = { templeAngle: 0, templeLen: 0, templeGap: 0, templeBend: 20, earTipAngle: 118, endpiece: 0,
  padOn: 1, padSpacing: 0, padVertical: 0, padArm: 0,
  templeAngle_R: 0, templeGap_R: 0, templeBend_R: 20, earTipAngle_R: 118,
  templeAngleAsym: 0, templeGapAsym: 0, templeBendAsym: 0, earTipAngleAsym: 0 };

// Measure fitting landmarks from the head mesh itself — robust against
// asset swaps, no hand-tuned magic numbers. Re-callable after deformation.
//   ear  : outermost-x vertex behind the eyes at eye height (temple rest)
//   noseZ: max forward protrusion where the rims can collide with the nose
// The facecap mesh is baked into group space (mannequin.js) → read the position
// attribute directly (toWorld=false, pitch-independent). The fallback bust is
// unbaked → toWorld=true converts via head.localToWorld.
function measureLandmarks(head, toWorld) {
  const pos = head.geometry.attributes.position;
  const v = new THREE.Vector3();
  // 좌우 귀·측두부를 각각 실측 (facecap 스캔은 비대칭 — 미러링 금지).
  //   earR/earL : 눈높이 뒤쪽 최외곽 (템플이 걸치는 귀 지점)
  //   binsR/binsL: z bin(4mm)별 측두부 옆면 x (다리 몸통이 따라갈 표면)
  let earR = null, earL = null;
  let noseZ = -Infinity;
  const binsR = new Map(), binsL = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (toWorld) head.localToWorld(v);
    // 귀 최외곽점(x-최대) — 귀 중심 높이의 안정적 앵커. 템플 걸침 y는
    // glassesBuilder에서 이 y + 상단 오프셋으로 귀 상단 부착부에 얹힌다.
    if (v.z < -0.01 && v.y > -0.015 && v.y < 0.03) {
      if (v.x > 0.02 && (!earR || v.x > earR.x)) earR = v.clone();
      if (v.x < -0.02 && (!earL || v.x < earL.x)) earL = v.clone();
    }
    if (v.y > 0.003 && v.y < 0.045 && v.z > -0.10 && v.z < 0.015) {
      const zb = Math.round(v.z / 0.004);
      if (v.x > 0.02 && (!binsR.has(zb) || v.x > binsR.get(zb))) binsR.set(zb, v.x);
      if (v.x < -0.02 && (!binsL.has(zb) || v.x < binsL.get(zb))) binsL.set(zb, v.x);
    }
    // Nose-collision band: rim inner edge (|x| ≥ 8mm) against the UPPER
    // nose-side slope only. |x| < 8mm (렌즈 사이 틈)과 y < -18mm (콧방울) 제외.
    const ax = Math.abs(v.x);
    if (ax > 0.008 && ax < 0.016 && v.y > -0.018 && v.y < 0.008) {
      if (v.z > noseZ) noseZ = v.z;
    }
  }
  const lookup = (bins, z) => {
    const zb = Math.round(z / 0.004);
    for (let d = 0; d <= 10; d++) {
      if (bins.has(zb + d)) return Math.abs(bins.get(zb + d));
      if (bins.has(zb - d)) return Math.abs(bins.get(zb - d));
    }
    return 0.072;
  };
  const headSideX = (z, side) => lookup(side > 0 ? binsR : binsL, z);
  return { earR, earL, noseZ, headSideX };
}

// Build ear/nose opts (temple rest + nose clearance) from measured landmarks.
function earNoseOpts(m, anchors) {
  const o = {};
  if (m?.earR) o.earR = { x: m.earR.x, y: m.earR.y + 0.006, z: m.earR.z };
  if (m?.earL) o.earL = { x: m.earL.x, y: m.earL.y + 0.006, z: m.earL.z };
  if (m && m.noseZ > -Infinity) {
    const lensBackZ = anchors.left.position.z + 0.012;
    o.noseClearance = Math.min(0.012, Math.max(0.006, m.noseZ - lensBackZ + 0.002));
  }
  if (m?.headSideX) o.headSideX = m.headSideX;
  return o;
}

function mountCredit(root) {
  const div = document.createElement('div');
  div.textContent = '3D head: “Face Cap” sample via three.js examples (CC-BY) · fallback scan © Lee Perry-Smith / Infinite Realities';
  Object.assign(div.style, {
    position: 'fixed', left: '12px', bottom: '8px', zIndex: 9,
    fontSize: '9.5px', color: 'rgba(255,255,255,0.34)',
    fontFamily: "'Pretendard', system-ui, sans-serif",
    pointerEvents: 'none', letterSpacing: '0.02em',
  });
  root.appendChild(div);
}

const container = document.getElementById('v3-stage');
const stage = createStudioStage(container);

stage.camera.position.set(...HOME_VIEW.pos);
stage.controls.target.set(...HOME_VIEW.tgt);
stage.controls.maxDistance = 2.6;
stage.controls.update();

window.__v3 = { stage };

loadMannequin().then(({ group, anchors, morphMesh, eyes, headMesh, restPositions }) => {
  stage.scene.add(group);

  // 랜드마크 측정 대상 — baked facecap 메시(그룹 좌표, 직접 읽기) 또는
  // fallback 최대정점 메시(월드 변환 필요).
  let head = headMesh, toWorld = false;
  if (!head) {
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (o.isMesh && (!head || o.geometry.attributes.position.count > head.geometry.attributes.position.count)) head = o;
    });
    toWorld = true;
  }
  const m = head ? measureLandmarks(head, toWorld) : null;
  const glasses = createGlasses(anchors, m ? earNoseOpts(m, anchors) : {});
  group.add(glasses.group);

  // 두상 변형기 (facecap baked 메시에서만) — 귀 위치·콧대 조절
  const deformer = (headMesh && restPositions)
    ? createHeadDeform({ headMesh, restPositions }) : null;

  const zones = createVisionZones(anchors);
  group.add(zones.group);

  const targets = createTargets(stage.scene);

  const demo = createDemoDirector({
    stage, zones,
    mannequin: { group, anchors },
    eyes, morphMesh,
    onFitChange: (patch) => update({ v3fit: patch }),
    onTargetsOn: () => update({ v3view: { targets: true } }),
  });

  // ── state → scene ──
  function glassesParams(f, fr) {
    // 프레임 크기(bSize)는 상하좌우 전체 비례 스케일 (기준 31mm)
    const frameScale = f.bSize / 31;
    return {
      vd: (f.vd - 5) / 1000,        // 표시값 − 5 = 물리 VD (표시 12 = 물리 7mm)
      pantoDeg: f.panto,
      wrapDeg: f.wrap,
      oh: f.oh / 1000 - 0.002,      // keep the default −2mm fitting bias
      pdErr: f.pdErr / 1000,
      lensW: 0.046 * frameScale,
      lensH: 0.031 * frameScale,
      cornerR: 0.008 * frameScale,
      shape: f.shape,
      // 프레임 피팅 커스텀 (광학 무관 — mm/deg → m/deg)
      templeAngle: fr.templeAngle,
      templeLen: fr.templeLen / 1000,
      templeGap: fr.templeGap / 1000,
      templeBend: fr.templeBend,
      earTipAngle: fr.earTipAngle,
      endpiece: fr.endpiece / 1000,
      // 좌우 비대칭 오른쪽값 — 대칭(Asym off)이면 base로 해석해 양쪽 동일
      templeAngle_R: fr.templeAngleAsym ? fr.templeAngle_R : fr.templeAngle,
      templeGap_R: (fr.templeGapAsym ? fr.templeGap_R : fr.templeGap) / 1000,
      templeBend_R: fr.templeBendAsym ? fr.templeBend_R : fr.templeBend,
      earTipAngle_R: fr.earTipAngleAsym ? fr.earTipAngle_R : fr.earTipAngle,
      // 코받침 (mm → m, 토글 bool)
      padOn: !!fr.padOn,
      padSpacing: fr.padSpacing / 1000,
      padVertical: fr.padVertical / 1000,
      padArm: (fr.padArm - 10) / 1000,   // 표시값 − 10 = 물리 (표시 0 = 물리 -10)
    };
  }

  let lastGrade = state.grade;
  let lastSpec = null;
  // 두상 변형 변경 감지 — 광학/프레임 슬라이더 변경 시 불필요한 재변형/리빌드 방지.
  const earKeyOf = (h) => `${h?.earY || 0},${h?.earZ || 0},${h?.earY_R || 0},${h?.earZ_R || 0},${h?.earYAsym || 0},${h?.earZAsym || 0}`;
  let lastHeadKey = JSON.stringify(state.v3head || {});
  let lastEarKey = earKeyOf(state.v3head);

  function apply(s, animate) {
    const f = { ...STANDARD_FIT, ...(s.v3fit || {}) };
    const fr = { ...STANDARD_FRAME, ...(s.v3frame || {}) };
    const spec = computeZones(s);

    // 등급 고스트 (D6): 등급이 바뀔 때 이전 존을 흰색 잔상으로 남긴다
    if (animate && s.grade !== lastGrade && lastSpec) {
      zones.showGhost(lastSpec);
    }
    lastGrade = s.grade;
    lastSpec = spec;

    zones.update(spec, animate);
    glasses.setParams(glassesParams(f, fr));
    glasses.updateZoneSpec(spec);

    // 두상 변형 (귀 위치·콧대) — v3head 변경 시에만.
    if (deformer) {
      const headKey = JSON.stringify(s.v3head || {});
      if (headKey !== lastHeadKey) {
        lastHeadKey = headKey;
        // 콧대 표시값 − 4 = 물리 (표시 0 = 물리 -4). 나머지 키는 그대로.
        const hd = s.v3head || {};
        deformer.deform({ ...hd, noseBridge: (hd.noseBridge ?? 0) - 4 });
        // 귀가 움직인 경우에만 재측정 + 템플 리핏. noseClearance는 재전송하지
        // 않음 — 콧대는 시각 전용이라 안경 위치(프레임)에 영향 없음.
        const earKey = earKeyOf(s.v3head);
        if (earKey !== lastEarKey) {
          lastEarKey = earKey;
          const m2 = measureLandmarks(headMesh, false);
          const o = {};
          if (m2.earR) o.earR = { x: m2.earR.x, y: m2.earR.y + 0.006, z: m2.earR.z };
          if (m2.earL) o.earL = { x: m2.earL.x, y: m2.earL.y + 0.006, z: m2.earL.z };
          // headSideX(측두부 프로파일)는 재전송하지 않는다 — 두개골 옆면은 귀가
          // 움직여도 불변인데, 변형 메시에서 재측정하면 이동한 귀 돌출부가
          // 프로파일 빈에 누출돼 다리 몸통이 그 지점만 튀어나와 찌그러진다.
          // 로드 시 rest 측정값(glasses.params.headSideX)을 그대로 유지.
          glasses.setParams(o);
        }
      }
    }

    group.rotation.x = THREE.MathUtils.degToRad(f.headPitch || 0);
    for (const [zone, on] of Object.entries(s.v3view?.zones || {})) {
      zones.setVisible(zone, on);
    }
    targets.setVisible(!!s.v3view?.targets);
    targets.update(spec, group, anchors);
  }

  apply(state, false);
  subscribe((s) => apply(s, true));

  // ── Direct drag (1급 입력) ──
  attachDragHandles({
    stage,
    glassesGroup: glasses.group,
    headMesh: head,
    getFit: () => ({ ...STANDARD_FIT, ...(state.v3fit || {}) }),
    onFitChange: (patch) => update({ v3fit: patch }),
    homeView: HOME_VIEW,
  });

  mountControls(document.body, { stage, getDemo: () => demo });
  mountCredit(document.body);

  Object.assign(window.__v3, {
    mannequin: { group, anchors, morphMesh, eyes, headMesh },
    glasses, zones, targets, demo, deformer,
  });
}).catch((err) => {
  console.error('Mannequin load failed:', err);
});
