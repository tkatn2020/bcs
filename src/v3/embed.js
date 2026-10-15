// v3 임베드 연결부 — 브리즘 임상 컨퍼런스 앱의 전체 화면 창(같은 출처 iframe, ?embed=1)과
// postMessage 로 대화한다. app.js 가 ?embed=1 일 때만 싣는다(단독 화면에는 없다).
//
// 규약 v1 (컨퍼런스 쪽 src/lib/fitting/bridge.ts 와 짝)
//   부모 → 창 : { bcs: 1, id, cmd, args }      cmd = hello · getState · setState · capture · dispose
//   창 → 부모 : { bcs: 1, id, ok: true, result } | { bcs: 1, id, ok: false, error: { code, message } }
//   창 → 부모 : { bcs: 1, event, data }        event = ready · change · escape · error
// 같은 출처 부모의 메시지만 받는다(origin·source 검사).
// ⚠️ app.js 가 이 파일을 동적으로 싣기 때문에 iframe 의 load 사건보다 늦게 붙을 수 있다 — load 직후
//   보낸 hello 는 받을 곳이 없다. 부모는 답이나 ready 사건이 올 때까지 hello 를 0.5초마다 다시 보낸다.
//
// 캡처 함정(설계 검토 2026-10-15): 카메라를 옮겨 놓고 기다리면 렌더 루프의 controls.update() 가
// 남은 관성을 한 번에 튕기고 화면이 시점 사이를 오간다. 그래서 정착은 카메라를 그대로 둔 채
// 기다리고, 저장 → 크기·시점 바꾸기 → render + toBlob → 되돌리기 → 한 번 더 render 를
// 한 동기 블록에서 끝낸다. 그 사이 controls.update() 를 부르지 않는다.

import * as THREE from 'three';
import { state, update, subscribe, resetFitting } from '../wavefront/state.js';
import { computeZones, STANDARD_FIT } from './fittingModel.js';
import { FRAME_FINISHES } from './glassesBuilder.js';
import { setPresetSlot } from './controls.js';
import { GRADES } from '../optics/grades.js';
import {
  SNAPSHOT_VERSION, FIELDS, keysOf, toSnapshot, fromSnapshot, cleanSnapshot,
  metricValues, CAPTURE_VIEWS, CAPTURE_SIZE,
} from './snapshot.js';

const PROTOCOL = 1;
const ORIGIN = location.origin;
const parentWin = window.parent !== window ? window.parent : null;

const post = (msg) => parentWin?.postMessage({ bcs: PROTOCOL, ...msg }, ORIGIN);
const emit = (event, data) => post({ event, data });
const fail = (code, message) => Object.assign(new Error(message || code), { code });
const v3 = () => window.__v3 || {};

let ready = false;
let failed = null;

// ── 기다리기 ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// rAF 가 멈춘 숨은 화면에서도 영영 걸리지 않게 시간 한도를 같이 둔다
const nextFrame = () => new Promise((r) => {
  const t = setTimeout(r, 120);
  requestAnimationFrame(() => { clearTimeout(t); r(); });
});

// 상태 반영(구독자 flush = app.js apply)이 한 번 돈 뒤 화면이 한 번 그려질 때까지.
// update({}) 로 알림을 걸어 두면 이미 걸린 변경과 같은 flush 에서 함께 돈다.
function waitFlush(limitMs = 3000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const off = subscribe(() => {
      if (done) return;
      done = true;
      off();
      nextFrame().then(resolve);
    });
    update({});
    setTimeout(() => {
      if (done) return;
      done = true;
      off();
      reject(fail('timeout', '상태 반영을 기다리다 시간이 지났습니다'));
    }, limitMs);
  });
}

// 마지막 변경·등급 변경 시각 — 「원하는 화면」 캡처 전 콘 트윈(300ms)·등급 잔상(1.1s)을 기다린다
let lastChangeAt = 0;
let gradeAt = 0;
let lastGrade = state.grade;

// ── 준비 ──
// 실제 상태의 키·기본값이 snapshot.js 와 같은지 — 다르면 저장 값이 틀어지므로 붙이기를 막는다.
function schemaProblems() {
  const problems = [];
  const src = {
    lens: { grade: state.grade, add: state.add, corridor: state.corridor },
    fit: { ...STANDARD_FIT, ...(state.v3fit || {}) },
    frame: state.v3frame || {},
    head: state.v3head || {},
  };
  const known = { lens: new Set(), fit: new Set(), frame: new Set(), head: new Set() };
  for (const f of FIELDS) {
    for (const k of keysOf(f)) {
      known[f.ns].add(k);
      const std = k.endsWith('Asym') ? 0 : f.std;
      const v = src[f.ns][k];
      if (v === undefined) problems.push(`없는 키 ${f.ns}.${k}`);
      else if (v !== std) problems.push(`기본값이 다름 ${f.ns}.${k} = ${v} (snapshot.js ${std})`);
    }
  }
  for (const ns of ['fit', 'frame', 'head']) {
    for (const k of Object.keys(src[ns])) if (!known[ns].has(k)) problems.push(`snapshot.js 에 없는 키 ${ns}.${k}`);
  }
  const fin = FIELDS.find((f) => f.key === 'finish').options.join(',');
  if (Object.keys(FRAME_FINISHES).join(',') !== fin) problems.push('마감 목록이 다름');
  if (GRADES.map((g) => g.id).join(',') !== '1,2,3,4,5') problems.push('등급 목록이 다름');
  return problems;
}

function onReady() {
  if (ready || failed) return;
  const problems = schemaProblems();
  if (problems.length) {
    console.error('[embed] snapshot.js 와 스튜디오 상태가 다릅니다:', problems);
    failed = { code: 'schema', message: problems.join(' · ') };
    emit('error', failed);
    return;
  }
  ready = true;
  let changeT = 0;
  subscribe((s) => {
    lastChangeAt = performance.now();
    if (s.grade !== lastGrade) { lastGrade = s.grade; gradeAt = lastChangeAt; }
    clearTimeout(changeT);
    changeT = setTimeout(() => emit('change'), 400);
  });
  emit('ready', { version: SNAPSHOT_VERSION });
}

function onLoadError(message) {
  if (failed) return;
  failed = { code: 'load', message: message || '3D 아바타를 불러오지 못했습니다' };
  emit('error', failed);
}

if (v3().loadError) onLoadError(v3().loadError);
else if (v3().ready) onReady();
else {
  window.addEventListener('v3:ready', onReady, { once: true });
  window.addEventListener('v3:error', (e) => onLoadError(e.detail?.message), { once: true });
}

// 창 안에서 누른 Esc 는 부모 창(useModalShell)이 듣지 못한다 — 사건으로 넘긴다
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') emit('escape'); });

// ── 상태 ──
function snapshotNow() {
  return toSnapshot(state, STANDARD_FIT);
}
function metricsNow() {
  const now = metricValues(computeZones({ ...state, v3fit: { ...STANDARD_FIT, ...(state.v3fit || {}) } }));
  // 표준 피팅 기준값 — app.js 의 HUD 기준선과 같다(등급 3·ADD 2.00·누진대 12)
  const std = metricValues(computeZones({ grade: 3, add: 2.0, corridor: 12, v3fit: { ...STANDARD_FIT } }));
  return { now, std };
}

// 시선 데모·턴테이블은 장부(고개 각도)와 카메라를 계속 바꾼다 — 쓰기·캡처 전에 멈춘다
function stopMotion() {
  const { demo, stage } = v3();
  if (demo?.playing) demo.stop();
  if (stage?.controls?.autoRotate) {
    stage.controls.autoRotate = false;
    document.querySelector('[data-turntable]')?.classList.remove('on');
  }
}

async function setStateCmd({ data, preset } = {}) {
  const c = cleanSnapshot(data);
  if (!c.ok) throw fail('invalid', c.error);
  stopMotion();
  const patch = fromSnapshot(c.data);
  // 원값을 통째로 쓴다 — 컨트롤 경로(padWrite 등)를 다시 지나면 연동이 두 번 들어간다
  resetFitting();
  if (preset) setPresetSlot(0, patch);
  update(patch);
  await waitFlush();
  return { applied: true };
}

// ── 캡처 ──
const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(fail('capture', '사진을 만들지 못했습니다'))), type, quality);
});

// 고정 시점 — 한 동기 블록. toBlob 은 부르는 순간 그림을 복사하므로(preserveDrawingBuffer 없이도)
// render 바로 뒤에 불러야 한다.
function captureFixedSync(views) {
  const { renderer, scene, camera } = v3().stage;
  const targets = v3().targets;
  const { width: W, height: H, quality } = CAPTURE_SIZE;
  const saved = {
    pos: camera.position.clone(), quat: camera.quaternion.clone(), aspect: camera.aspect,
    mask: camera.layers.mask, ratio: renderer.getPixelRatio(), size: renderer.getSize(new THREE.Vector2()),
    targets: targets ? targets.group.visible : false,
  };
  const jobs = [];
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);          // 화면 CSS 크기는 그대로, 그림 크기만
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    camera.layers.disable(1);               // 시야콘·등급 잔상(레이어 1) — 피팅만 보이게
    if (targets) targets.setVisible(false);
    for (const v of views) {
      camera.position.set(...v.pos);
      camera.lookAt(...v.tgt);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      jobs.push(toBlob(renderer.domElement, 'image/jpeg', quality)
        .then((blob) => ({ view: v.id, blob, width: W, height: H })));
    }
  } finally {
    if (targets) targets.setVisible(saved.targets);
    camera.layers.mask = saved.mask;
    renderer.setPixelRatio(saved.ratio);
    renderer.setSize(saved.size.x, saved.size.y, false);
    camera.aspect = saved.aspect;
    camera.updateProjectionMatrix();
    camera.position.copy(saved.pos);
    camera.quaternion.copy(saved.quat);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);         // 되돌린 화면을 바로 다시 그린다(빈 화면 방지)
  }
  return jobs;
}

// 「원하는 화면」 — 지금 카메라·표시(시야콘 포함) 그대로, 긴 변 1600
function captureFreeSync() {
  const { renderer, scene, camera } = v3().stage;
  const ratio = renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2());
  const k = CAPTURE_SIZE.freeLong / Math.max(size.x, size.y);
  const W = Math.round(size.x * k), H = Math.round(size.y * k);
  let job;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);          // 비율은 같아 카메라 aspect 는 그대로
    renderer.render(scene, camera);
    job = toBlob(renderer.domElement, 'image/jpeg', CAPTURE_SIZE.quality)
      .then((blob) => ({ view: 'free', blob, width: W, height: H }));
  } finally {
    renderer.setPixelRatio(ratio);
    renderer.setSize(size.x, size.y, false);
    renderer.render(scene, camera);
  }
  return job;
}

async function captureCmd({ views, free } = {}) {
  const ids = Array.isArray(views) ? views : CAPTURE_VIEWS.map((v) => v.id);
  const fixed = CAPTURE_VIEWS.filter((v) => ids.includes(v.id));
  stopMotion();
  // 정착 — 걸린 변경을 반영하고, 흘러내림이 멈출 때까지(최대 6초) 기다린다. 카메라는 건드리지 않는다.
  await waitFlush();
  const t0 = performance.now();
  while (!(v3().slipSim?.settled ?? true) && performance.now() - t0 < 6000) await nextFrame();
  await waitFlush();
  const jobs = fixed.length ? captureFixedSync(fixed) : [];
  if (free) {
    const now = performance.now();
    const wait = Math.max(350 - (now - lastChangeAt), 1150 - (now - gradeAt), 0);
    if (wait > 0) await sleep(wait);
    jobs.push(captureFreeSync());
  }
  const images = await Promise.all(jobs);
  return { data: snapshotNow(), metrics: metricsNow(), images };
}

// 닫기 전에 WebGL 을 바로 놓는다 — 아이패드는 한 탭의 컨텍스트 수가 적다(bcs PRD 246)
function disposeCmd() {
  try { v3().stage?.renderer?.forceContextLoss(); } catch { /* 이미 잃음 */ }
  try {
    const c = v3().multi?.el?.querySelector('canvas');
    const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* 멀티뷰 없음 */ }
  return { disposed: true };
}
window.addEventListener('pagehide', disposeCmd);

async function handle(cmd, args) {
  if (cmd === 'hello') return { ready, error: failed, version: SNAPSHOT_VERSION };
  if (cmd === 'dispose') return disposeCmd();
  if (failed) throw fail(failed.code, failed.message);
  if (!ready) throw fail('not_ready', '스튜디오를 준비하고 있습니다');
  if (cmd === 'getState') return { data: snapshotNow(), metrics: metricsNow() };
  if (cmd === 'setState') return setStateCmd(args);
  if (cmd === 'capture') return captureCmd(args);
  throw fail('unknown_cmd', cmd);
}

window.addEventListener('message', async (e) => {
  if (e.origin !== ORIGIN || !parentWin || e.source !== parentWin) return;
  const m = e.data;
  if (!m || m.bcs !== PROTOCOL || typeof m.id !== 'string' || typeof m.cmd !== 'string') return;
  try {
    const result = await handle(m.cmd, m.args || {});
    post({ id: m.id, ok: true, result });
  } catch (err) {
    post({ id: m.id, ok: false, error: { code: err.code || 'failed', message: String(err.message || err) } });
  }
});
