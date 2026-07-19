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
    // 하단 시점 내부 차광(2026-07-19): facecap은 두께 없는 열린 껍데기라
    // FrontSide면 아래서 내부가 관통돼 보인다. 양면 렌더로 안쪽 벽도 같은
    // 피부 재질로 — 두 쉘 접합부 헤어라인 틈이 정상 시점에서 어두운 선으로
    // 두드러지지 않도록 별도 다크 이너셸 대신 동일 재질 양면을 쓴다.
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

        // ── 하단 차광 캡(2026-07-19, 사용자 승인) — 목 구멍 상부의 어두운
        // 수평 타원판. 아래 시점에서 구강·눈알 뒷면·밝은 내부 대신 "그림자
        // 진 밑면"으로 읽히게 한다. unlit(MeshBasicMaterial)이라 환경광에
        // 반응하지 않고, 구멍보다 크게 만들어 가장자리가 셸 안에 숨는다.
        // 외형(정상 시점)은 불변 — 과거 실패한 '보이는 목 만들기'와 달리
        // 내부 차광만 담당. group 자식이라 headPitch/headRoll 자동 추종.
        // (폴백 버스트는 닫힌 스캔이라 이 블록에 안 들어옴.)
        // 실측(2026-07-19): 구멍은 경사 — 뒤통수 쉘 하단 rim y≈−60mm, 턱 앞
        // 벽은 −114mm까지. 캡은 y −60mm(전 둘레에 벽이 존재하는 최저 높이).
        // ⚠️ 타원 근사는 금지 — 단면이 머리형(앞 좁고 옆·뒤 넓음)이라 타원이
        // 좁은 턱 앞·볼 옆 벽을 뚫고 나가 정면에서 어두운 선이 비친다(실패
        // 확인). 대신 θ별 벽 반경을 실측한 프로파일 − 4mm 여유로 캡 외곽을
        // 만든다 — 어느 방향에서도 벽 안쪽에 정확히 들어간다.
        const CAP_Y = -0.060, CAP_CZ = -0.02, CAP_MARGIN = 0.004, NB = 64;
        const hp = headMesh.geometry.attributes.position;
        const rBins = new Array(NB).fill(0);
        for (let i = 0; i < hp.count; i++) {
          if (Math.abs(hp.getY(i) - CAP_Y) < 0.005) {
            const dx = hp.getX(i), dz = hp.getZ(i) - CAP_CZ;
            const bi = Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * NB) % NB;
            rBins[bi] = Math.max(rBins[bi], Math.hypot(dx, dz));
          }
        }
        for (let i = 0; i < NB; i++) {           // 빈 θ빈은 이웃 보간
          if (!rBins[i]) {
            let a = i, b = i;
            while (!rBins[a % NB]) a++;
            while (!rBins[(b + NB) % NB]) b--;
            rBins[i] = (rBins[a % NB] + rBins[(b + NB) % NB]) / 2;
          }
        }
        for (let k = 0; k < 2; k++) {            // 3점 이동평균 ×2 (저폴리 요철 완화)
          const s = rBins.slice();
          for (let i = 0; i < NB; i++) rBins[i] = (s[(i + NB - 1) % NB] + s[i] + s[(i + 1) % NB]) / 3;
        }
        const capShape = new THREE.Shape();
        for (let i = 0; i <= NB; i++) {
          const th = ((i % NB) / NB) * 2 * Math.PI - Math.PI;
          const r = Math.max(0.005, rBins[i % NB] - CAP_MARGIN);
          const x = r * Math.cos(th), z = CAP_CZ + r * Math.sin(th);
          if (i === 0) capShape.moveTo(x, z); else capShape.lineTo(x, z);
        }
        const cap = new THREE.Mesh(
          new THREE.ShapeGeometry(capShape),
          new THREE.MeshBasicMaterial({ color: 0x24272e, side: THREE.DoubleSide }),
        );
        cap.rotation.x = Math.PI / 2;   // Shape(x, z평면값을 y로 작성) → 수평으로
        cap.position.y = CAP_Y;
        cap.name = 'underCap';
        group.add(cap);

        // 구강(이빨/잇몸) 메시 숨김 — 캡(−60mm)보다 아래(−69mm)까지 내려와
        // 밑에서 보인다. 입은 항상 다물려 있어 정상 시점 영향 없음(332da93 방식).
        // bake 후 root에 남은 메시 = 눈알(피벗 안) + 구강뿐이라 눈알만 제외.
        const eyeMeshes = new Set();
        if (eyePivots) {
          eyePivots.left.traverse((o) => { if (o.isMesh) eyeMeshes.add(o); });
          eyePivots.right.traverse((o) => { if (o.isMesh) eyeMeshes.add(o); });
        }
        root.traverse((o) => { if (o.isMesh && !eyeMeshes.has(o)) o.visible = false; });
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
