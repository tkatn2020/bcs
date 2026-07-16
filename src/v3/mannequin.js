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

// 쉘 테두리 인접 밴드의 노멀을 목 벽면(방사형)으로 눕혀, 두피 쉘의 말린
// 테두리가 목 위에서 밝은 띠(선반처럼 보이는 음영)로 도드라지는 것을 없앤다.
// 대상·가중치는 목 생성 시(buildNeckClosure) geo.userData._rimFix에 저장 —
// headDeform.deform이 노멀을 재계산할 때마다 재적용해야 하므로 함수로 분리.
export function applyRimNormalFix(geo) {
  const fix = geo.userData._rimFix;
  if (!fix || !geo.attributes.normal) return;
  const nrm = geo.attributes.normal.array;
  for (let k = 0; k < fix.idx.length; k++) {
    const i = fix.idx[k], w = fix.w[k];
    const nx = nrm[i * 3] * (1 - w) + fix.rx[k] * w;
    const ny = nrm[i * 3 + 1] * (1 - w);
    const nz = nrm[i * 3 + 2] * (1 - w) + fix.rz[k] * w;
    const m = Math.hypot(nx, ny, nz) || 1;
    nrm[i * 3] = nx / m; nrm[i * 3 + 1] = ny / m; nrm[i * 3 + 2] = nz / m;
  }
  geo.attributes.normal.needsUpdate = true;
}

// 두상 하부 목 클로저(rim-anchored bust) — 실제 헤드스캔처럼 자연스러운 목.
// 두상 쉘(얼굴 마스크+두피)의 '아래 테두리(rim)'를 실측 추출해 목 상단을
// 그 테두리에 정확히 꿰매고(틈·관통 원천 차단), 아래로 턱→목젖·뒤통수→
// 목덜미 곡선을 그리며 쇄골 직전(y −0.225)에서 평절단(캡)한다.
// 반환: 목 Mesh. 부수효과: headGeo.userData._rimFix(테두리 노멀 픽스 데이터).
function buildNeckClosure(headMesh, mat) {
  const geo = headMesh.geometry;
  const pos = geo.attributes.position.array;
  const idx = geo.index.array;
  const n = geo.attributes.position.count;
  const CZ = -0.05;   // 목 축의 z 중심(두상 단면 중심)

  // 1) 연결요소 라벨(대형 쉘 2개만 신뢰 — 잔여 소형 조각 배제)
  const adj = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b);
  }
  const comp = new Int32Array(n).fill(-1);
  let cid = 0; const csize = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0 || adj[i].length === 0) continue;
    let sz = 0; const st = [i]; comp[i] = cid;
    while (st.length) { const u = st.pop(); sz++; for (const w of adj[u]) if (comp[w] < 0) { comp[w] = cid; st.push(w); } }
    csize.push(sz); cid++;
  }
  const bigComps = new Set(csize.map((sz, i) => [sz, i]).filter(([sz]) => sz > 500).map(([, i]) => i));

  // 2) 경계(열린 rim) 정점 → θ빈별 '최저 y' 앵커 (귀 pinna·눈/입 구멍 배제:
  //    구멍들은 y가 더 높아 최저-y 선택에서 자연 탈락, pinna는 명시 제외)
  const ec = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    for (let e = 0; e < 3; e++) {
      let a = tri[e], b = tri[(e + 1) % 3]; if (a > b) [a, b] = [b, a];
      const k = a * 100000 + b; ec.set(k, (ec.get(k) || 0) + 1);
    }
  }
  const bset = new Set();
  ec.forEach((v, k) => { if (v === 1) { bset.add(Math.floor(k / 100000)); bset.add(k % 100000); } });
  const SEG = 64;
  const rimR = new Array(SEG).fill(null), rimY = new Array(SEG).fill(null);
  bset.forEach((i) => {
    if (!bigComps.has(comp[i])) return;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y >= -0.02) return;
    if (Math.abs(x) > 0.0765 && z > -0.11 && z < -0.05) return;   // pinna 제외
    const th = Math.atan2(x, z - CZ);
    const b = Math.round((th + Math.PI) / (2 * Math.PI) * SEG) % SEG;
    if (rimY[b] === null || y < rimY[b]) { rimY[b] = y; rimR[b] = Math.hypot(x, z - CZ); }
  });
  for (let b = 0; b < SEG; b++) {   // 빈 빈 원형 보간
    if (rimR[b] !== null) continue;
    let p = b, q = b, dp = 0, dq = 0;
    while (rimR[(p + SEG - 1) % SEG] === null && dp < SEG) { p = (p + SEG - 1) % SEG; dp++; }
    p = (p + SEG - 1) % SEG; dp++;
    while (rimR[(q + 1) % SEG] === null && dq < SEG) { q = (q + 1) % SEG; dq++; }
    q = (q + 1) % SEG; dq++;
    const t = dp / (dp + dq);
    rimR[b] = rimR[p] * (1 - t) + rimR[q] * t; rimY[b] = rimY[p] * (1 - t) + rimY[q] * t;
  }
  const smoothCirc = (arr, passes) => {   // 저폴리 지그재그 완화
    for (let p = 0; p < passes; p++) {
      const o = arr.slice();
      for (let b = 0; b < SEG; b++) arr[b] = (o[(b + SEG - 2) % SEG] + 2 * o[(b + SEG - 1) % SEG] + 3 * o[b] + 2 * o[(b + 1) % SEG] + o[(b + 2) % SEG]) / 9;
    }
  };
  smoothCirc(rimR, 2); smoothCirc(rimY, 2);

  // 3) 목 그리드 — 앵커 2행(쉘 안 1.5mm→테두리 밖 0.4mm로 관통해 봉합) +
  //    바디 16행(테두리→목 단면으로 스무스 블렌드, 하단 6% 트라페지우스 플레어)
  //    + 하단 평절단 캡. 수치는 시각 튜닝 확정값.
  const P = { yBot: -0.225, rxN: 0.050, frontZ: 0.018, backZ: -0.113, nExp: 2.3, flareAmt: 0.10, shapeEnd: 0.32, proud: 0.0004, inset: 0.0015, topUp: 0.010 };
  const cN = (P.frontZ + P.backZ) / 2, rzN = (P.frontZ - P.backZ) / 2;
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const M = 16, W = SEG + 1;
  const pts = [], tri = [];
  for (let j = 0; j <= M + 1; j++) {
    for (let b = 0; b <= SEG; b++) {
      const bi = b % SEG;
      const th = -Math.PI + (bi / SEG) * 2 * Math.PI;
      const sin = Math.sin(th), cos = Math.cos(th);
      if (j === 0) {
        pts.push((rimR[bi] - P.inset) * sin, rimY[bi] + P.topUp, CZ + (rimR[bi] - P.inset) * cos);
      } else if (j === 1) {
        pts.push((rimR[bi] + P.proud) * sin, rimY[bi] - 0.0015, CZ + (rimR[bi] + P.proud) * cos);
      } else {
        const u = (j - 1) / M;
        const sh = ss(0, P.shapeEnd, u);
        const flare = 1 + P.flareAmt * ss(0.75, 1, u);
        const e = 2 / P.nExp;
        const tx = P.rxN * flare * Math.sign(sin) * Math.pow(Math.abs(sin), e);
        const tz = cN + rzN * flare * Math.sign(cos) * Math.pow(Math.abs(cos), e);
        const rx0 = (rimR[bi] + P.proud) * sin, rz0 = CZ + (rimR[bi] + P.proud) * cos;
        const y = (rimY[bi] - 0.0015) * (1 - u) + P.yBot * u;
        pts.push(rx0 * (1 - sh) + tx * sh, y, rz0 * (1 - sh) + tz * sh);
      }
    }
  }
  for (let j = 0; j < M + 1; j++) {
    for (let b = 0; b < SEG; b++) {
      const a = j * W + b, c = a + W;
      tri.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const centerIdx = pts.length / 3;
  pts.push(0, P.yBot, cN);
  const lastRow = (M + 1) * W;
  for (let b = 0; b < SEG; b++) tri.push(lastRow + b, centerIdx, lastRow + b + 1);
  const neckGeo = new THREE.BufferGeometry();
  neckGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  neckGeo.setIndex(tri);
  neckGeo.computeVertexNormals();
  const neck = new THREE.Mesh(neckGeo, mat);
  neck.name = 'neck';

  // 4) 테두리 노멀 픽스 데이터 — 테두리 위 12mm 밴드의 쉘 정점 노멀을 방사형
  //    으로 85%까지 눕힘(테두리에 가까울수록 강하게). rest 위치 기준 1회 계산.
  const fIdx = [], fW = [], fRx = [], fRz = [];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y > -0.02 || !bigComps.has(comp[i])) continue;
    const th = Math.atan2(x, z - CZ);
    const b = ((Math.round((th + Math.PI) / (2 * Math.PI) * SEG)) % SEG + SEG) % SEG;
    const dy = y - rimY[b];
    if (dy < -0.004 || dy > 0.012) continue;
    const w = (1 - Math.max(0, dy) / 0.012) * 0.85;
    const rl = Math.hypot(x, z - CZ) || 1;
    fIdx.push(i); fW.push(w); fRx.push(x / rl); fRz.push((z - CZ) / rl);
  }
  geo.userData._rimFix = {
    idx: Uint32Array.from(fIdx), w: Float32Array.from(fW),
    rx: Float32Array.from(fRx), rz: Float32Array.from(fRz),
  };
  applyRimNormalFix(geo);
  return neck;
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
      // ② 하부 목 클로저: 두피 쉘이 y≈−0.05에서 끝나 그 아래가 통째로 뚫려
      //    있다. buildNeckClosure가 쉘의 실제 아래 테두리를 추출해 목 상단을
      //    거기에 꿰매고(틈·관통 원천 차단) 쇄골 직전까지 자연스러운 목을
      //    만든다 + 테두리 노멀 픽스(_rimFix)로 접합부 음영을 목과 연속화.
      if (headMesh && eyeL && eyeR) {
        root.traverse((o) => {
          if (o.isMesh && o !== eyeL.mesh && o !== eyeR.mesh) o.visible = false;
        });
        group.add(buildNeckClosure(headMesh, mat));
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
