// v3 entry — 3D 아바타 피팅 스튜디오 bootstrap.
// M0/M1 in progress: stage + mannequin quality gate first (PRD §11).

import { createStudioStage } from './studioStage.js';
import { loadMannequin } from './mannequin.js';

const container = document.getElementById('v3-stage');
const stage = createStudioStage(container);

loadMannequin().then(({ group, anchors }) => {
  stage.scene.add(group);
  window.__v3.mannequin = { group, anchors };
}).catch((err) => {
  console.error('Mannequin load failed:', err);
});

// Debug handle — dev-time inspection & headless capture
window.__v3 = { stage };
