// v3 Mannequin — sculpted head mesh (Lee Perry-Smith scan, three.js examples,
// CC-BY — credit required in app footer) rendered as a glossy white retail
// mannequin (PRD §6.1/6.2). Textures from the scan are discarded; a uniform
// MeshPhysicalMaterial with clearcoat carries the mannequin look.
//
// Pupil anchors (PD/OH/vision-cone origins) are defined in normalized head
// space and exposed as empty Object3D children — measured against this
// specific mesh after normalization.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function mannequinMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf2f2f4,
    metalness: 0.0,
    roughness: 0.34,
    clearcoat: 1.0,
    clearcoatRoughness: 0.18,
  });
}

// Real-world head height ≈ 0.24 m; normalize the mesh so downstream
// glasses/zone math can work in metres.
const HEAD_HEIGHT_M = 0.24;

export function loadMannequin(url = 'assets/mannequin/head.glb') {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => {
      const root = gltf.scene;
      const mat = mannequinMaterial();
      root.traverse((o) => {
        if (o.isMesh) {
          // Drop scan textures — uniform mannequin material only.
          // Keep the GLB's own smooth normals (do NOT recompute; UV-seam
          // vertex splits would produce faceting).
          o.material = mat;
        }
      });

      // Normalize: uniform scale to real head height, center at origin.
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const s = HEAD_HEIGHT_M / size.y;
      root.scale.setScalar(s);
      root.position.set(-center.x * s, -center.y * s, -center.z * s);

      const group = new THREE.Group();
      group.add(root);

      // Pupil anchors — tuned for this mesh (fronto-parallel, slightly above
      // vertical center). Children of the group so head rotation carries them.
      const anchorL = new THREE.Object3D();
      const anchorR = new THREE.Object3D();
      anchorL.name = 'pupilL';
      anchorR.name = 'pupilR';
      anchorL.position.set(-0.031, 0.022, 0.082);
      anchorR.position.set(0.031, 0.022, 0.082);
      group.add(anchorL, anchorR);

      resolve({ group, anchors: { left: anchorL, right: anchorR } });
    }, undefined, reject);
  });
}
