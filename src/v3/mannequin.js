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
    // 얼굴/두피 쉘이 열린 메시라 앞면만 렌더하면 아래·뒤 시점에서 안이 관통돼
    // 보인다(눈알·이빨 노출). 양면 렌더로 쉘 안쪽도 피부로 막는다.
    side: THREE.DoubleSide,
  });
}

const TARGET_PD_M = 0.062;      // real-world IPD the head is normalized to
const FALLBACK_HEAD_HEIGHT_M = 0.24;

// facecap 스캔은 얼굴-두피 경계에 미세한 접힘(crease)이 있어 computeVertexNormals
// 후 그 선이 음영으로 드러난다. 지오메트리·인덱스는 그대로 두고(정점 변형이
// 인덱스에 의존 — 절대 불변) 노멀만 이웃과 Laplacian 평균내 경계를 매끄럽게 한다.
// 인접(엣지) 관계는 geo.userData에 1회 캐시(변형마다 재사용). 2회·λ0.5면 seam은
// 지우면서 코·이목구비 디테일은 보존.
export function smoothVertexNormals(geo, iters = 2, lambda = 0.5) {
  const idx = geo.index && geo.index.array;
  const nrm = geo.attributes.normal;
  if (!idx || !nrm) return;
  let adj = geo.userData._normalAdj;
  if (!adj) {
    const cnt = geo.attributes.position.count;
    const sets = Array.from({ length: cnt }, () => new Set());
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
    }
    adj = sets.map((s) => Array.from(s));
    geo.userData._normalAdj = adj;
  }
  const arr = nrm.array, n = nrm.count;
  for (let it = 0; it < iters; it++) {
    const out = new Float32Array(arr.length);
    for (let i = 0; i < n; i++) {
      let nx = arr[i * 3], ny = arr[i * 3 + 1], nz = arr[i * 3 + 2];
      const nb = adj[i];
      for (let k = 0; k < nb.length; k++) {
        const j = nb[k]; nx += arr[j * 3] * lambda; ny += arr[j * 3 + 1] * lambda; nz += arr[j * 3 + 2] * lambda;
      }
      const m = Math.hypot(nx, ny, nz) || 1;
      out[i * 3] = nx / m; out[i * 3 + 1] = ny / m; out[i * 3 + 2] = nz / m;
    }
    arr.set(out);
  }
  nrm.needsUpdate = true;
}

// facecap mesh_2는 '앞 얼굴 마스크'와 '뒤통수 쉘'이 별도 연결요소로 분리돼 있어
// 둘의 rim이 맞닿는 옆통수·이마 둘레에 뚜렷한 음영 seam이 남는다(Laplacian은
// 연결된 이웃만 평균내 두 쉘을 못 이음). → 두 쉘이 공간적으로 맞닿는 '접합부'
// 정점만 골라(반경 내 다른 연결요소 존재) 토폴로지 무관 공간 노멀 블렌드로 두
// 쉘 음영을 잇는다. 눈·입·콧구멍 구멍은 근처에 상대 쉘이 없어 자동 제외 → 이목
// 구비 보존. 접합부 밴드·이웃 리스트는 geo.userData에 1회 캐시(인덱스 기반이라
// 변형으로 위치가 이동해도 유효). 지오·인덱스 불변(변형 안전).
export function blendSeamNormals(geo, radius = 0.006, iters = 3) {
  const nrm = geo.attributes.normal;
  const idx = geo.index && geo.index.array;
  if (!nrm || !idx) return;
  let cache = geo.userData._seamBlend;
  if (!cache) {
    const pos = geo.attributes.position.array;
    const cnt = geo.attributes.position.count;
    const adj = Array.from({ length: cnt }, () => []);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b);
    }
    const comp = new Int32Array(cnt).fill(-1);
    let cid = 0;
    for (let i = 0; i < cnt; i++) {
      if (comp[i] >= 0 || adj[i].length === 0) continue;
      const st = [i]; comp[i] = cid;
      while (st.length) { const u = st.pop(); for (const w of adj[u]) if (comp[w] < 0) { comp[w] = cid; st.push(w); } }
      cid++;
    }
    const cs = radius, grid = new Map();
    const gk = (x, y, z) => `${Math.round(x / cs)},${Math.round(y / cs)},${Math.round(z / cs)}`;
    for (let i = 0; i < cnt; i++) { const k = gk(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); const g = grid.get(k); if (g) g.push(i); else grid.set(k, [i]); }
    const near = (i, r) => {
      const r2 = r * r, res = [];
      const cx = Math.round(pos[i * 3] / cs), cy = Math.round(pos[i * 3 + 1] / cs), cz = Math.round(pos[i * 3 + 2] / cs), sp = Math.ceil(r / cs);
      for (let a = -sp; a <= sp; a++) for (let b = -sp; b <= sp; b++) for (let c = -sp; c <= sp; c++) {
        const g = grid.get(`${cx + a},${cy + b},${cz + c}`); if (!g) continue;
        for (const j of g) { const dx = pos[i * 3] - pos[j * 3], dy = pos[i * 3 + 1] - pos[j * 3 + 1], dz = pos[i * 3 + 2] - pos[j * 3 + 2]; if (dx * dx + dy * dy + dz * dz < r2) res.push(j); }
      }
      return res;
    };
    const bandSet = new Set();
    for (let i = 0; i < cnt; i++) { const nb = near(i, radius * 1.2); if (nb.some((j) => comp[j] !== comp[i])) { for (const j of near(i, radius)) bandSet.add(j); } }
    const band = Array.from(bandSet);
    cache = { band, nbr: band.map((i) => near(i, radius)) };
    geo.userData._seamBlend = cache;
  }
  const band = cache.band, nbr = cache.nbr, arr = nrm.array;
  for (let it = 0; it < iters; it++) {
    const upd = new Array(band.length);
    for (let b = 0; b < band.length; b++) {
      let nx = 0, ny = 0, nz = 0; const nb = nbr[b];
      for (let k = 0; k < nb.length; k++) { const j = nb[k]; nx += arr[j * 3]; ny += arr[j * 3 + 1]; nz += arr[j * 3 + 2]; }
      const m = Math.hypot(nx, ny, nz) || 1; upd[b] = [nx / m, ny / m, nz / m];
    }
    for (let b = 0; b < band.length; b++) { const i = band[b]; arr[i * 3] = upd[b][0]; arr[i * 3 + 1] = upd[b][1]; arr[i * 3 + 2] = upd[b][2]; }
  }
  nrm.needsUpdate = true;
}

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
  smoothVertexNormals(geo);   // 경계 crease 완화(연결된 이웃)
  blendSeamNormals(geo);      // 얼굴 마스크↔뒤통수 쉘 접합부 seam 잇기
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

      // 두상 하부 마감(facecap 전용) — 아래 시점에서 얼굴 안이 보이지 않게.
      // ① 이빨/잇몸 메시 숨김: 입은 항상 다물려 있어 정상 시점에선 안 보이고,
      //    아래에서 들여다볼 때만 노출되는 불쾌 요소. 눈알(시선 데모)·얼굴만 유지.
      // ② 하부 클로저(bust): 두피 쉘이 y≈−0.05에서 끝나 그 아래 뒤통수·바닥이
      //    통째로 뚫려 있다(단순 실린더는 그 틈으로 원기둥이 그대로 드러남).
      //    두상 단면을 실측해 행별 수퍼타원(모서리가 통통 — 실제 스컬 단면 근사)
      //    을 쌓은 커스텀 서피스로 개구부 전체를 같은 피부로 감싼다.
      //    · 뒤: 상단 행이 두피 테두리(z≈−0.147)를 3~8mm 감싸 틈 없이 이음.
      //    · 앞: 얼굴 마스크가 턱(y −0.114)까지 덮으므로 깊숙이(z≈+0.015) 후퇴
      //      — 입/볼 관통 방지. 턱 아래부터 목젖으로 자연 노출.
      //    · 상단 링은 스컬 안(귀 아래)에 묻혀 이음새 없음. 시각 튜닝값.
      if (headMesh && eyeL && eyeR) {
        root.traverse((o) => {
          if (o.isMesh && o !== eyeL.mesh && o !== eyeR.mesh) o.visible = false;
        });
        const ROWS = [   // [y, x반지름, z중심, z반지름, 수퍼타원 지수 n]
          [-0.030, 0.069, -0.070, 0.085, 2.8],
          [-0.050, 0.068, -0.069, 0.081, 2.8],
          [-0.075, 0.064, -0.0665, 0.0785, 2.6],
          [-0.100, 0.056, -0.055, 0.070, 2.4],
          [-0.130, 0.048, -0.0435, 0.0615, 2.2],
          [-0.170, 0.045, -0.040, 0.055, 2.2],
          [-0.350, 0.048, -0.041, 0.059, 2.2],
        ];
        const SEG = 64;
        const pts = [], tri = [];
        for (let r = 0; r < ROWS.length; r++) {
          const [y, rx, cz, rz, sn] = ROWS[r];
          const e = 2 / sn;
          for (let k = 0; k <= SEG; k++) {
            const a = (k / SEG) * Math.PI * 2;
            const si = Math.sin(a), co = Math.cos(a);
            pts.push(
              rx * Math.sign(si) * Math.pow(Math.abs(si), e),
              y,
              cz + rz * Math.sign(co) * Math.pow(Math.abs(co), e),
            );
          }
        }
        for (let r = 0; r < ROWS.length - 1; r++) {
          for (let k = 0; k < SEG; k++) {
            const a = r * (SEG + 1) + k, b = a + SEG + 1;
            tri.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
        const bustGeo = new THREE.BufferGeometry();
        bustGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        bustGeo.setIndex(tri);
        bustGeo.computeVertexNormals();
        const bust = new THREE.Mesh(bustGeo, mat);
        bust.name = 'neck';
        group.add(bust);
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
