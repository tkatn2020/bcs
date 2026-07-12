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

// Measure the ear anchor from the head mesh itself: the outermost-x vertex
// behind the eyes at eye height IS the ear shell. Robust against asset swaps.
function measureEar(group) {
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
  let best = null;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    head.localToWorld(v);          // group sits at scene origin → world == group frame
    if (v.z < -0.01 && v.y > -0.015 && v.y < 0.03 && v.x > 0) {
      if (!best || v.x > best.x) best = v.clone();
    }
  }
  return best;   // right-ear outermost point (mirror for left)
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

  const ear = measureEar(group);
  const glasses = createGlasses(anchors, ear ? {
    earX: ear.x - 0.002,        // rest slightly inside the outermost shell point
    earY: ear.y + 0.006,        // on top of the ear root
    earZ: ear.z,
  } : {});
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
