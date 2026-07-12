// v3 entry — 3D 아바타 피팅 스튜디오 bootstrap (M1).
// mannequin (open eyes) + parametric glasses + vision-zone cones + controls.

import * as THREE from 'three';
import { createStudioStage } from './studioStage.js';
import { loadMannequin } from './mannequin.js';
import { createGlasses } from './glassesBuilder.js';
import { createVisionZones } from './visionZones.js';
import { computeZones } from './fittingModel.js';
import { mountControls } from './controls.js';
import { state, subscribe } from '../wavefront/state.js';

// Measure fitting landmarks from the head mesh itself — robust against
// asset swaps, no hand-tuned magic numbers.
//   ear : outermost-x vertex behind the eyes at eye height (temple rest)
//   noseZ: max forward protrusion inside the rim's inner-edge band — the
//          frame must float in front of this or the rims embed in the nose.
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
    // nose-side slope only (nasion region). Two deliberate exclusions:
    //   |x| < 8mm  — the open gap between lenses; the nose passes through it
    //   y < -18mm  — nostril wings; real frames rest ABOVE them on the slope
    const ax = Math.abs(v.x);
    if (ax > 0.008 && ax < 0.016 && v.y > -0.018 && v.y < 0.008) {
      if (v.z > noseZ) noseZ = v.z;
    }
  }
  return { ear, noseZ };
}

const container = document.getElementById('v3-stage');
const stage = createStudioStage(container);

// Default framing: head at left, cones extending forward-right.
stage.camera.position.set(0.62, 0.18, 0.72);
stage.controls.target.set(0.05, -0.02, 0.28);
stage.controls.maxDistance = 2.6;
stage.controls.update();

window.__v3 = { stage };

loadMannequin().then(({ group, anchors, morphMesh }) => {
  stage.scene.add(group);

  const m = measureHead(group);
  const opts = {};
  if (m?.ear) {
    opts.earX = m.ear.x - 0.002;   // rest slightly inside the outermost shell point
    opts.earY = m.ear.y + 0.006;   // on top of the ear root
    opts.earZ = m.ear.z;
  }
  if (m && m.noseZ > -Infinity) {
    // Rest just off the upper nose slope (+2mm), hard-capped at 12mm so the
    // frame stays visually ON the face — like real glasses perched on pads.
    const lensBackZ = anchors.left.position.z + 0.012;   // pupil z + default VD
    opts.noseClearance = Math.min(0.012, Math.max(0.006, m.noseZ - lensBackZ + 0.002));
  }
  const glasses = createGlasses(anchors, opts);
  group.add(glasses.group);

  const zones = createVisionZones(anchors);
  group.add(zones.group);
  zones.update(computeZones(state), false);
  subscribe((s) => zones.update(computeZones(s), true));

  Object.assign(window.__v3, {
    mannequin: { group, anchors, morphMesh },
    glasses,
    zones,
  });
}).catch((err) => {
  console.error('Mannequin load failed:', err);
});

mountControls(document.body);
