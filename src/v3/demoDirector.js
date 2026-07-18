// v3 Demo director (PRD §7 D4) — "원거리 → 모니터 → 책" 시선 이동 자동 재생.
//
// 각 단계에서:
//   · 아바타 고개(headPitch)와 눈알(eyeball rotation + eyeLookDown 블렌드셰입)이
//     해당 거리로 자연스럽게 내려가고
//   · 해당 시야 존 콘이 강조(setEmphasis)되며
//   · 동공 중점 → 타깃으로 밝은 시선 라인이 이어진다
// 재생 중에는 OrbitControls·턴테이블을 잠그고, 종료 시 원상 복귀.

import * as THREE from 'three';
import { TARGET_POSITIONS } from './targets.js';

// 누진 사용법의 정석: "고개는 살짝만, 눈을 내려 렌즈 하부를 사용".
// 페이즈는 재생 시점의 존 스펙(getSpec)으로 동적 생성(C5) — 누진대가 길수록
// |near.pitch|가 커져 눈 하강량(eye)이 깊어진다 = "긴 누진대는 시선을 더
// 내려야 함"을 데모가 직접 시연. headPitch 부호는 + = 숙임(렌더 규약).
const buildPhases = (spec) => {
  const midP = spec ? Math.abs(spec.intermediate.pitch) : 15;
  const nearP = spec ? Math.abs(spec.near.pitch) : 33;
  return [
    { until: 2.3, zone: 'distance',     target: 'far',     pitch: 0,   eye: 0 },
    { until: 4.7, zone: 'intermediate', target: 'monitor', pitch: 2,   eye: 0.18 * (midP / 15) },
    { until: 7.2, zone: 'near',         target: 'book',    pitch: 4.5, eye: 0.35 * (nearP / 33) },
  ];
};
const TOTAL_S = 8.0;
// 카메라: 눈높이 살짝 아래의 근접 정면 3/4 — 시선이 아래로 내려가는 동안
// 동공(눈알 회전)이 계속 보이는 각도(사용자 요청). 측면·원거리였던 이전
// 앵글은 시선 라인 위주라 눈동자가 안 보였다.
const DEMO_CAM = { pos: new THREE.Vector3(0.31, -0.03, 0.53), tgt: new THREE.Vector3(0.03, -0.03, 0.05) };

export function createDemoDirector({ stage, zones, mannequin, eyes, morphMesh, onFitChange, onTargetsOn, onTargetsOff, onZonesOn, getFit, getSpec }) {
  // Gaze line — thin additive beam from pupil midpoint to the active target.
  const gazeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const gazeGeo = new THREE.CylinderGeometry(0.0012, 0.0012, 1, 8);
  gazeGeo.translate(0, 0.5, 0);   // base at origin, extends +y
  const gaze = new THREE.Mesh(gazeGeo, gazeMat);
  gaze.visible = false;
  gaze.renderOrder = 12;
  stage.scene.add(gaze);

  // eyeLookDown 블렌드셰입 인덱스 (있으면 눈꺼풀도 시선을 따라감)
  const lookDownIdx = [];
  if (morphMesh?.morphTargetDictionary) {
    for (const [name, idx] of Object.entries(morphMesh.morphTargetDictionary)) {
      if (/eyeLookDown/i.test(name)) lookDownIdx.push(idx);
    }
  }

  const UP = new THREE.Vector3(0, 1, 0);
  const anchorMid = new THREE.Vector3()
    .addVectors(mannequin.anchors.left.position, mannequin.anchors.right.position)
    .multiplyScalar(0.5);

  let playing = false;
  let raf = 0;
  let cur = { pitch: 0, eye: 0 };
  let savedCam = null;
  let savedHeadPitch = 0;    // 데모 전 사용자 고개각 — 종료 시 복원(0으로 덮어쓰지 않게)
  let savedAutoRotate = false; // 데모 전 턴테이블 상태 — 종료 시 복원(중간 중지 시 유실 방지)

  function pointGaze(targetKey) {
    const from = mannequin.group.localToWorld(anchorMid.clone());
    const to = TARGET_POSITIONS[targetKey];
    const dir = to.clone().sub(from);
    const len = dir.length();
    gaze.position.copy(from);
    gaze.quaternion.setFromUnitVectors(UP, dir.normalize());
    gaze.scale.set(1, len, 1);
    gaze.visible = true;
  }

  function applyEyes(v) {
    if (eyes) {
      eyes.left.rotation.x = v;
      eyes.right.rotation.x = v;
    }
    if (morphMesh) {
      for (const idx of lookDownIdx) {
        morphMesh.morphTargetInfluences[idx] = Math.min(1, v * 2.6);
      }
    }
  }

  function restore() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    gaze.visible = false;
    zones.setEmphasis(null);
    applyEyes(0);
    cur = { pitch: 0, eye: 0 };
    if (onTargetsOff) onTargetsOff();   // 타깃은 데모 전용 — 종료 시 끔(토글 UI 없음)
    onFitChange({ headPitch: savedHeadPitch });   // 데모 전 고개각 복원
    stage.controls.enabled = true;
    stage.controls.autoRotate = savedAutoRotate;  // 데모 전 턴테이블 상태 복원(모든 종료 경로)
    if (savedCam) {
      stage.camera.position.copy(savedCam.pos);
      stage.controls.target.copy(savedCam.tgt);
      stage.controls.update();
      savedCam = null;
    }
  }

  function play() {
    if (playing) { restore(); return; }   // 재생 중 재클릭 = 중지
    playing = true;
    onTargetsOn();
    if (onZonesOn) onZonesOn();   // 존 콘이 꺼져 있으면 데모가 '보이지 않는 콘'을 강조하게 되므로 자동 점등(C4)
    const phases = buildPhases(getSpec ? getSpec() : null);
    savedCam = { pos: stage.camera.position.clone(), tgt: stage.controls.target.clone() };
    savedHeadPitch = getFit ? (getFit().headPitch ?? 0) : 0;
    savedAutoRotate = stage.controls.autoRotate;
    stage.controls.autoRotate = false;
    stage.controls.enabled = false;

    const camFrom = stage.camera.position.clone();
    const tgtFrom = stage.controls.target.clone();
    const t0 = performance.now();

    function frame(ts) {
      if (!playing) return;
      const t = (ts - t0) / 1000;

      // Camera glide-in (first 0.9s)
      const ct = Math.min(1, t / 0.9);
      const ce = ct * ct * (3 - 2 * ct);
      stage.camera.position.lerpVectors(camFrom, DEMO_CAM.pos, ce);
      stage.controls.target.lerpVectors(tgtFrom, DEMO_CAM.tgt, ce);
      stage.controls.update();

      const phase = phases.find((p) => t <= p.until) || phases[phases.length - 1];

      // Critically-damped chase toward the phase pose
      cur.pitch += (phase.pitch - cur.pitch) * 0.06;
      cur.eye += (phase.eye - cur.eye) * 0.06;
      onFitChange({ headPitch: Math.round(cur.pitch * 10) / 10 });
      applyEyes(cur.eye);
      zones.setEmphasis(phase.zone);
      pointGaze(phase.target);

      if (t >= TOTAL_S) {
        restore();   // autoRotate·headPitch 복원 포함
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    play,
    stop: restore,
    get playing() { return playing; },
    dispose() { restore(); gazeGeo.dispose(); gazeMat.dispose(); gaze.removeFromParent(); },
  };
}
