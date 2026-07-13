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

// Bake a quantized morph mesh into a plain Float32 geometry in GROUP space and
// reparent it directly under `group` with identity transform, so runtime vertex
// deformation (headDeform.js) can write millimetre offsets straight into the
// position attribute. The facecap asset ships KHR_mesh_quantization (Uint16
// positions, Int16 relative morph deltas); the whole node chain is uniform-scale
// + translation with NO rotation, so a single scalar rescales the morph deltas.
// Requires group.updateMatrixWorld(true) to have run. Returns the mesh.
function bakeHeadMesh(mesh, group) {
  const geo = mesh.geometry;
  mesh.updateWorldMatrix(true, false);
  const M = mesh.matrixWorld.clone();               // root + node chain (no rotation)
  const linear = new THREE.Matrix3().setFromMatrix4(M);   // for relative morph deltas

  // Base positions → Float32 group-space metres.
  const src = geo.attributes.position;
  const n = src.count;
  const baked = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(src, i).applyMatrix4(M);
    baked[i * 3] = v.x; baked[i * 3 + 1] = v.y; baked[i * 3 + 2] = v.z;
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(baked, 3));

  // Morph POSITION deltas → Float32, linear part only (relative vectors).
  const mpos = geo.morphAttributes.position;
  if (mpos) {
    for (let t = 0; t < mpos.length; t++) {
      const d = mpos[t];
      const out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(d, i).applyMatrix3(linear);
        out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
      }
      mpos[t] = new THREE.Float32BufferAttribute(out, 3);
    }
  }
  // Drop morph NORMAL deltas — base normals are recomputed below, and the raw
  // quantized normal deltas would blow up the recomputed unit normals when a
  // morph fires. Positions still morph; shading stays stable.
  delete geo.morphAttributes.normal;
  geo.morphTargetsRelative = true;

  // Reparent under group with identity local transform (NOT .attach(), which
  // would re-fold the matrix we just baked into the vertices).
  group.add(mesh);
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.scale.set(1, 1, 1);

  // Recompute normals fresh. The asset's normal attribute is quantized Int8
  // (normalized); reusing it would truncate the tiny metre-scale face-normal
  // accumulation to 0 (→ black shading). Delete it so computeVertexNormals
  // allocates a Float32 attribute. headDeform's per-deform recompute then reuses
  // this Float32 attribute correctly.
  geo.deleteAttribute('normal');
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return mesh;
}

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
      group.updateMatrixWorld(true);

      // Blendshape mesh (facecap: 52 ARKit targets) — gaze/blink animation.
      let morphMesh = null;
      root.traverse((o) => {
        if (o.isMesh && o.morphTargetDictionary && !morphMesh) morphMesh = o;
      });

      // Bake the face mesh into a deformable Float32 group-space geometry
      // (headDeform.js reads restPositions as the deform baseline). Facecap only;
      // the fallback bust has no morphs → headMesh/restPositions stay null.
      let headMesh = null, restPositions = null;
      if (morphMesh) {
        headMesh = bakeHeadMesh(morphMesh, group);
        restPositions = headMesh.geometry.attributes.position.array.slice();
      }

      resolve({
        group,
        anchors: { left: anchorL, right: anchorR },
        morphMesh,
        eyes: eyePivots,   // pivot Groups (제자리 회전) — 없으면 null
        headMesh,          // baked Float32 face mesh (deformable) — 없으면 null
        restPositions,     // Float32Array 변형 기준선 — 없으면 null
      });
    }, undefined, reject);
  });
}
