// v3 entry — 3D 아바타 피팅 스튜디오 bootstrap (M3 완성판).
// mannequin + glasses + vision zones + targets + drag handles
// + 시선 데모(D4) + 등급 고스트(D6) + 턴테이블(C4) + 홈뷰 더블탭(C5).

import * as THREE from 'three';
import { createStudioStage } from './studioStage.js';
import { loadMannequin } from './mannequin.js';
import { createGlasses } from './glassesBuilder.js';
import { createVisionZones } from './visionZones.js';
import { createTargets } from './targets.js';
import { createDemoDirector } from './demoDirector.js';
import { computeZones, STANDARD_FIT } from './fittingModel.js';
import { attachDragHandles } from './dragHandles.js';
import { mountControls } from './controls.js';
import { state, update, subscribe } from '../wavefront/state.js';

const HOME_VIEW = { pos: [0.62, 0.18, 0.72], tgt: [0.05, -0.02, 0.28] };

// Measure fitting landmarks from the head mesh itself — robust against
// asset swaps, no hand-tuned magic numbers.
//   ear  : outermost-x vertex behind the eyes at eye height (temple rest)
//   noseZ: max forward protrusion where the rims can collide with the nose
function measureHead(group) {
  let head = null, maxCount = 0;
  group.traverse((o) => {
    if (o.isMesh) {
      const n = o.geometry.attributes.position.count;
      if (n > maxCount) { maxCount = n; head = o; }
    }
  });
  if (!head) return null;
  group.updateMatrixWorld(true);
  const pos = head.geometry.attributes.position;
  const v = new THREE.Vector3();
  let ear = null;
  let noseZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    head.localToWorld(v);          // group sits at scene origin → world == group frame
    if (v.z < -0.01 && v.y > -0.015 && v.y < 0.03 && v.x > 0) {
      if (!ear || v.x > ear.x) ear = v.clone();
    }
    // Nose-collision band: rim inner edge (|x| ≥ 8mm) against the UPPER
    // nose-side slope only. |x| < 8mm (렌즈 사이 틈)과 y < -18mm (콧방울) 제외.
    const ax = Math.abs(v.x);
    if (ax > 0.008 && ax < 0.016 && v.y > -0.018 && v.y < 0.008) {
      if (v.z > noseZ) noseZ = v.z;
    }
  }
  return { ear, noseZ, headMesh: head };
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

loadMannequin().then(({ group, anchors, morphMesh, eyes }) => {
  stage.scene.add(group);

  const m = measureHead(group);
  const opts = {};
  if (m?.ear) {
    opts.earX = m.ear.x - 0.002;
    opts.earY = m.ear.y + 0.006;
    opts.earZ = m.ear.z;
  }
  if (m && m.noseZ > -Infinity) {
    const lensBackZ = anchors.left.position.z + 0.012;
    opts.noseClearance = Math.min(0.012, Math.max(0.006, m.noseZ - lensBackZ + 0.002));
  }
  const glasses = createGlasses(anchors, opts);
  group.add(glasses.group);

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
  function glassesParams(f) {
    // 프레임 크기(bSize)는 상하좌우 전체 비례 스케일 (기준 31mm)
    const frameScale = f.bSize / 31;
    return {
      vd: f.vd / 1000,
      pantoDeg: f.panto,
      wrapDeg: f.wrap,
      oh: f.oh / 1000 - 0.002,      // keep the default −2mm fitting bias
      pdErr: f.pdErr / 1000,
      lensW: 0.046 * frameScale,
      lensH: 0.031 * frameScale,
      cornerR: 0.008 * frameScale,
      shape: f.shape,
    };
  }

  let lastGrade = state.grade;
  let lastSpec = null;

  function apply(s, animate) {
    const f = { ...STANDARD_FIT, ...(s.v3fit || {}) };
    const spec = computeZones(s);

    // 등급 고스트 (D6): 등급이 바뀔 때 이전 존을 흰색 잔상으로 남긴다
    if (animate && s.grade !== lastGrade && lastSpec) {
      zones.showGhost(lastSpec);
    }
    lastGrade = s.grade;
    lastSpec = spec;

    zones.update(spec, animate);
    glasses.setParams(glassesParams(f));
    glasses.updateZoneSpec(spec);
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
    headMesh: m?.headMesh,
    getFit: () => ({ ...STANDARD_FIT, ...(state.v3fit || {}) }),
    onFitChange: (patch) => update({ v3fit: patch }),
    homeView: HOME_VIEW,
  });

  mountControls(document.body, { stage, getDemo: () => demo });
  mountCredit(document.body);

  Object.assign(window.__v3, {
    mannequin: { group, anchors, morphMesh, eyes },
    glasses, zones, targets, demo,
  });
}).catch((err) => {
  console.error('Mannequin load failed:', err);
});
