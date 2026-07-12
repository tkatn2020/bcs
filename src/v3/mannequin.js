// v3 Mannequin — glossy white head with OPEN eyes.
//
// Primary asset: three.js facecap head (assets/mannequin/head-open.glb,
// textures stripped — see scratch strip-gltf-textures.js). Separate eyeball
// meshes + 52 ARKit blendshapes (future gaze/blink animation).
// Fallback asset: Lee Perry-Smith scan bust (head.glb, closed eyes).
// Both CC-BY-family — credit in app footer (PRD §6.1).
//
// Normalization strategy: scale so the eyeball-center separation equals a
// real interpupillary distance (62mm), then place the PUPIL MIDPOINT at the
// group origin, face forward = +z. All glasses/zone math keys off the pupil
// anchors, so this frame makes downstream fitting math trivial.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export function mannequinMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf2f2f4,
    metalness: 0.0,
    roughness: 0.34,
    clearcoat: 1.0,
    clearcoatRoughness: 0.18,
  });
}

const TARGET_PD_M = 0.062;      // real-world IPD the head is normalized to
const FALLBACK_HEAD_HEIGHT_M = 0.24;

export function loadMannequin(url = 'assets/mannequin/head-open.glb') {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);   // facecap uses EXT_meshopt_compression
    loader.load(url, (gltf) => {
      const root = gltf.scene;
      const mat = mannequinMaterial();
      const meshes = [];
      root.traverse((o) => {
        if (o.isMesh) {
          o.material = mat;   // drop textures — uniform mannequin material
          meshes.push(o);
        }
      });
      root.updateMatrixWorld(true);

      // Detect the two eyeball meshes: the smallest-triangle pair mirrored
      // across x. Their centers give us anatomically exact pupil anchors.
      const infos = meshes.map((m) => {
        const box = new THREE.Box3().setFromObject(m);
        return {
          mesh: m,
          box,
          center: box.getCenter(new THREE.Vector3()),
          tris: m.geometry.index ? m.geometry.index.count / 3
                                 : m.geometry.attributes.position.count / 3,
        };
      }).sort((a, b) => a.tris - b.tris);

      let eyeL = null, eyeR = null;
      for (const i of infos.slice(0, Math.min(3, infos.length))) {
        if (!eyeR && i.center.x > 0) eyeR = i;
        else if (!eyeL && i.center.x < 0) eyeL = i;
      }

      const group = new THREE.Group();
      const anchorL = new THREE.Object3D(); anchorL.name = 'pupilL';
      const anchorR = new THREE.Object3D(); anchorR.name = 'pupilR';

      let eyePivots = null;
      if (eyeL && eyeR) {
        // ── PD-based normalization (facecap path) ──
        const rawPD = eyeR.center.x - eyeL.center.x;
        const s = TARGET_PD_M / rawPD;
        const mid = eyeL.center.clone().add(eyeR.center).multiplyScalar(0.5);
        root.scale.setScalar(s);
        root.position.set(-mid.x * s, -mid.y * s, -mid.z * s);
        root.updateMatrixWorld(true);   // reflect scale/position before wrapping

        // Pupil = eyeball center pushed to the front surface of the eyeball.
        const eyeRadius = ((eyeR.box.max.z - eyeR.box.min.z) / 2) * s;
        const zPupil = eyeRadius * 0.9;
        anchorL.position.set(-TARGET_PD_M / 2, 0, zPupil);
        anchorR.position.set(TARGET_PD_M / 2, 0, zPupil);

        // Wrap each eyeball in a pivot Group centered on the eyeball, so the
        // demo can rotate the eyes in place (D4). geometry is UNCHANGED and
        // Object3D.attach preserves the world transform — the eyeball stays
        // exactly where it was (M2 restored), just gains a rotation pivot.
        const wrapEye = (mesh) => {
          const wc = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
          const parent = mesh.parent;
          const pivot = new THREE.Group();
          parent.add(pivot);
          parent.updateMatrixWorld(true);
          pivot.position.copy(parent.worldToLocal(wc.clone()));
          pivot.updateMatrixWorld(true);
          pivot.attach(mesh);   // preserves mesh world transform
          return pivot;
        };
        eyePivots = { left: wrapEye(eyeL.mesh), right: wrapEye(eyeR.mesh) };
      } else {
        // ── Fallback: bbox-height normalization + hand-tuned anchors (LPS bust) ──
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const s = FALLBACK_HEAD_HEIGHT_M / size.y;
        root.scale.setScalar(s);
        root.position.set(-center.x * s, -center.y * s, -center.z * s);
        anchorL.position.set(-0.031, 0.022, 0.082);
        anchorR.position.set(0.031, 0.022, 0.082);
      }

      group.add(root, anchorL, anchorR);

      // Blendshape mesh (facecap: 52 ARKit targets) — gaze/blink animation.
      let morphMesh = null;
      root.traverse((o) => {
        if (o.isMesh && o.morphTargetDictionary && !morphMesh) morphMesh = o;
      });

      resolve({
        group,
        anchors: { left: anchorL, right: anchorR },
        morphMesh,
        eyes: eyePivots,   // pivot Groups (제자리 회전) — 없으면 null
      });
    }, undefined, reject);
  });
}
