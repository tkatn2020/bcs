// v3 entry — 3D 아바타 피팅 스튜디오 bootstrap (M3 완성판).
// mannequin + glasses + vision zones + targets + drag handles
// + 시선 데모(D4) + 등급 고스트(D6) + 턴테이블(C4) + 홈뷰 더블탭(C5).

import * as THREE from 'three';
import { createStudioStage } from './studioStage.js';
import { loadMannequin } from './mannequin.js';
import { createGlasses } from './glassesBuilder.js';
import { createHeadDeform } from './headDeform.js';
import { createVisionZones } from './visionZones.js';
import { createTargets } from './targets.js';
import { createMultiView } from './multiView.js';
import { createDemoDirector } from './demoDirector.js';
import { computeZones, STANDARD_FIT, fitLimit } from './fittingModel.js';
import { attachDragHandles } from './dragHandles.js';
import { mountControls } from './controls.js';
import { createSlipSim } from './slipSim.js';
import { state, update, subscribe } from '../wavefront/state.js';

const HOME_VIEW = { pos: [0.02, 0.02, 0.55], tgt: [0, 0, 0] };   // 정면 시점(첫 화면·더블탭 리셋 기본)
const STANDARD_FRAME = { templeAngle: 0, templeLen: 0, templeGap: 0, templeBend: 20, earTipAngle: 118, endpiece: 0,
  padOn: 1, padSpacing: 0, padVertical: 0, padArm: 0,
  templeAngle_R: 0, templeGap_R: 0, templeBend_R: 20, earTipAngle_R: 118,
  templeAngleAsym: 0, templeGapAsym: 0, templeBendAsym: 0, earTipAngleAsym: 0 };

// Measure fitting landmarks from the head mesh itself — robust against
// asset swaps, no hand-tuned magic numbers. Re-callable after deformation.
//   ear  : outermost-x vertex behind the eyes at eye height (temple rest)
//   noseZ: max forward protrusion where the rims can collide with the nose
// The facecap mesh is baked into group space (mannequin.js) → read the position
// attribute directly (toWorld=false, pitch-independent). The fallback bust is
// unbaked → toWorld=true converts via head.localToWorld.
function measureLandmarks(head, toWorld) {
  const pos = head.geometry.attributes.position;
  const v = new THREE.Vector3();
  // 좌우 귀·측두부를 각각 실측 (facecap 스캔은 비대칭 — 미러링 금지).
  //   earR/earL : 눈높이 뒤쪽 최외곽 (템플이 걸치는 귀 지점)
  //   binsR/binsL: z bin(4mm)별 측두부 옆면 x (다리 몸통이 따라갈 표면)
  let earR = null, earL = null;
  let noseZ = -Infinity;
  const binsR = new Map(), binsL = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (toWorld) head.localToWorld(v);
    // 귀 최외곽점(x-최대) — 귀 중심 높이의 안정적 앵커. 템플 걸침 y는
    // glassesBuilder에서 이 y + 상단 오프셋으로 귀 상단 부착부에 얹힌다.
    if (v.z < -0.01 && v.y > -0.015 && v.y < 0.03) {
      if (v.x > 0.02 && (!earR || v.x > earR.x)) earR = v.clone();
      if (v.x < -0.02 && (!earL || v.x < earL.x)) earL = v.clone();
    }
    if (v.y > 0.003 && v.y < 0.045 && v.z > -0.10 && v.z < 0.015) {
      const zb = Math.round(v.z / 0.004);
      if (v.x > 0.02 && (!binsR.has(zb) || v.x > binsR.get(zb))) binsR.set(zb, v.x);
      if (v.x < -0.02 && (!binsL.has(zb) || v.x < binsL.get(zb))) binsL.set(zb, v.x);
    }
    // Nose-collision band: rim inner edge (|x| ≥ 8mm) against the UPPER
    // nose-side slope only. |x| < 8mm (렌즈 사이 틈)과 y < -18mm (콧방울) 제외.
    const ax = Math.abs(v.x);
    if (ax > 0.008 && ax < 0.016 && v.y > -0.018 && v.y < 0.008) {
      if (v.z > noseZ) noseZ = v.z;
    }
  }
  // 측두부 프로파일 스무딩 — bin(4mm)별 최댓값을 그대로 쓰면 저폴리 불규칙
  // 메시 때문에 계단·스파이크(귀 상단 정점이 밴드에 누출 → 84mm 튐)가 생겨,
  // 다리 몸통(surfX)이 그 프로파일을 따라가며 꼬불꼬불해진다. ① 이웃 median+3mm
  // 로 아웃라이어(귀 스파이크) 클립 → ② 3점 이동평균 → ③ z 선형보간으로 단조
  // 매끈한 프로파일을 만든다. 로드 시 1회 계산(closure)하므로 런타임 비용 없음.
  const buildProfile = (bins) => {
    const zbs = [...bins.keys()].sort((a, b) => a - b);
    if (!zbs.length) return () => 0.072;
    const raw = zbs.map(k => Math.abs(bins.get(k)));
    const clip = raw.map((val, i) => {
      const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)];
      const med = [a, val, b].sort((x, y) => x - y)[1];
      return Math.min(val, med + 0.003);   // 귀 상단 스파이크 억제
    });
    const sm = clip.map((_, i) =>
      (clip[Math.max(0, i - 1)] + clip[i] + clip[Math.min(clip.length - 1, i + 1)]) / 3);
    const zs = zbs.map(k => k * 0.004);
    return (z) => {
      if (z <= zs[0]) return sm[0];
      if (z >= zs[zs.length - 1]) return sm[sm.length - 1];
      let i = 0; while (i < zs.length - 1 && zs[i + 1] < z) i++;
      const t = (z - zs[i]) / (zs[i + 1] - zs[i]);
      return sm[i] + (sm[i + 1] - sm[i]) * t;
    };
  };
  const profR = buildProfile(binsR), profL = buildProfile(binsL);
  const headSideX = (z, side) => (side > 0 ? profR : profL)(z);
  return { earR, earL, noseZ, headSideX };
}

// Build ear/nose opts (temple rest + nose clearance) from measured landmarks.
function earNoseOpts(m, anchors) {
  const o = {};
  if (m?.earR) o.earR = { x: m.earR.x, y: m.earR.y + 0.006, z: m.earR.z };
  if (m?.earL) o.earL = { x: m.earL.x, y: m.earL.y + 0.006, z: m.earL.z };
  if (m && m.noseZ > -Infinity) {
    const lensBackZ = anchors.left.position.z + 0.012;
    o.noseClearance = Math.min(0.012, Math.max(0.006, m.noseZ - lensBackZ + 0.002));
  }
  if (m?.headSideX) o.headSideX = m.headSideX;
  return o;
}

function mountCredit(root) {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'fixed', left: '12px', bottom: '8px', zIndex: 9,
    fontFamily: "'Pretendard', system-ui, sans-serif", letterSpacing: '0.02em',
    display: 'flex', flexDirection: 'column', gap: '3px',
    pointerEvents: 'none',   // 링크만 auto로 되살린다(캔버스 조작 방해 금지)
  });
  // 문의 창구 — 사내 교육용이지만 주소가 외부로 공유될 수 있어, 그때
  // 연락이 닿도록 노출한다(사용자 요청 2026-07-25).
  const contact = document.createElement('div');
  contact.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.55)';
  contact.innerHTML = '문의 · 제휴 <a href="mailto:Joel2@breezm.com" '
    + 'style="color:#f5b64e;text-decoration:none;pointer-events:auto">Joel2@breezm.com</a>';
  const credit = document.createElement('div');
  credit.textContent = '3D head: “Face Cap” sample via three.js examples (CC-BY) · fallback scan © Lee Perry-Smith / Infinite Realities';
  credit.style.cssText = 'font-size:9.5px;color:rgba(255,255,255,0.34)';
  wrap.append(contact, credit);
  root.appendChild(wrap);
}

// ── 교육 HUD (C1+인터랙티브) — 숫자 + 불릿 게이지 + 요인 분해 드릴다운 ──
// 행마다: 값/Δ 위에 게이지 바(회색 채움 = 현재, 흰 틱 = 표준, 표준↔현재
// 구간 = 이득 초록/손실 주황, 변화는 CSS 트랜지션으로 흐른다).
// · 행 hover = 해당 존 콘 강조(setZoneHover로 주입 — 데모 setEmphasis 재사용)
// · 행 클릭 = 요인 분해(spec.breakdown): 어떤 조정이 이 지표를 깎고/올리는지
// · 분해 항목 클릭 = 해당 슬라이더 위치 플래시(v3:flash-control 이벤트)
function mountEduHud(root) {
  const GOOD = '#7dd490', BAD = '#f0a35e', NEUT = '#9aa3b5';
  // 게이지 정규화 범위 = 모델 관측 범위(교육 케이스 전수 기준) — 표시 전용.
  // better: true=클수록 좋음 / false=작을수록 좋음 / null=양면적(중립 회색).
  const METRICS = [
    // 단안 PD로 좌우가 갈리면 평균 대신 '좌/우'를 그대로 보여준다 — 어느 눈이
    // 얼마나 어긋났는지가 단안 처방의 핵심 정보라 평균으로 뭉개면 안 된다.
    { key: 'dec', label: '광학중심 편심', unit: 'mm', min: 0, max: 20, better: false, zone: null,
      val: (s) => s.decMm ?? 0, bar: (s) => Math.abs(s.decMm ?? 0),
      fmt: (s) => (s.decL !== undefined && Math.abs(s.decL - s.decR) > 0.01)
        ? `좌 ${s.decL.toFixed(1)} / 우 ${s.decR.toFixed(1)}mm` : null,
      delta: (s, b) => Math.abs(s.decMm ?? 0) - Math.abs(b.decMm ?? 0) },
    { key: 'distance', label: '원용 시야', unit: '°', min: 30, max: 100, better: true, zone: 'distance', val: (s) => s.distance.h * 2 },
    { key: 'intermediate', label: '중간 시야', unit: '°', min: 5, max: 35, better: true, zone: 'intermediate', val: (s) => s.intermediate.h * 2 },
    { key: 'near', label: '근용 시야', unit: '°', min: 3, max: 45, better: true, zone: 'near', val: (s) => s.near.h * 2 },
    { key: 'nearPitch', label: '근용 시선 하강', unit: '°', min: 20, max: 45, better: null, zone: 'near', val: (s) => Math.abs(s.near.pitch) },
    { key: 'exposure', label: '왜곡 노출', unit: '%', min: 30, max: 250, better: false, zone: null, val: (s) => (s.distortion.exposure ?? 1) * 100 },
  ];

  const style = document.createElement('style');
  style.textContent = `
    .v3hud-row { cursor: pointer; border-radius: 7px; margin: 0 -4px; padding: 0 4px; }
    .v3hud-row:hover { background: rgba(255,255,255,0.05); }
    .v3hud-top { display: flex; justify-content: space-between; align-items: baseline; }
    .v3hud-bar { position: relative; height: 3px; border-radius: 2px;
      background: rgba(255,255,255,0.08); margin: 2px 0 6px; }
    .v3hud-fill, .v3hud-seg { position: absolute; top: 0; height: 100%; border-radius: 2px;
      transition: left .25s ease, width .25s ease, background .25s ease; }
    .v3hud-fill { left: 0; background: rgba(207,214,228,0.35); }
    .v3hud-tick { position: absolute; top: -2px; width: 2px; height: 7px; background: #fff;
      border-radius: 1px; transition: left .25s ease; }
    .v3hud-det { margin: 0 0 7px; padding: 5px 8px; background: rgba(255,255,255,0.05);
      border-radius: 7px; font-size: 10.5px; }
    .v3hud-det-row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
    .v3hud-det-row[data-ctrl] { cursor: pointer; }
    .v3hud-det-row[data-ctrl]:hover { color: #fff; }
    .v3hud-det-empty { color: #8b93a7; }
  `;
  document.head.appendChild(style);

  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', left: '14px', bottom: '64px', zIndex: 10, width: '236px',
    padding: '10px 12px', borderRadius: '12px',
    background: 'rgba(16,19,26,0.74)', backdropFilter: 'blur(10px)',
    fontFamily: "'Pretendard', system-ui, sans-serif", fontSize: '11.5px',
    color: '#cfd6e4', userSelect: 'none', pointerEvents: 'auto', lineHeight: '1.55',
  });
  el.innerHTML = `
    <div style="font-size:10px;letter-spacing:.12em;color:#8b93a7;font-weight:800;margin-bottom:4px">광학 성능 (표준 대비 · 행 클릭 = 요인)</div>
    <div data-hud-rows></div>
    <div data-hud-cap style="margin-top:2px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08);
      color:#f5d9a0;font-size:11px;min-height:14px"></div>
  `;
  root.appendChild(el);
  const rowsEl = el.querySelector('[data-hud-rows]');
  const capEl = el.querySelector('[data-hud-cap]');

  let baseline = null;
  let lastSpec = null;
  let openKey = null;
  let zoneHover = null;

  // 행 구조는 1회만 생성 — innerHTML 재생성 대신 스타일만 갱신해야 게이지
  // 트랜지션이 살아있고 hover/클릭 리스너가 유지된다.
  const rows = new Map();
  for (const mt of METRICS) {
    const r = document.createElement('div');
    r.className = 'v3hud-row';
    r.innerHTML = `
      <div class="v3hud-top"><span>${mt.label}</span>
        <span style="font-variant-numeric:tabular-nums"><span data-v style="color:#fff;font-weight:700"></span><span data-d style="font-weight:700"></span></span></div>
      <div class="v3hud-bar"><div class="v3hud-fill"></div><div class="v3hud-seg"></div><div class="v3hud-tick"></div></div>
      <div class="v3hud-det" style="display:none"></div>`;
    rowsEl.appendChild(r);
    rows.set(mt.key, {
      mt, el: r,
      v: r.querySelector('[data-v]'), d: r.querySelector('[data-d]'),
      fill: r.querySelector('.v3hud-fill'), seg: r.querySelector('.v3hud-seg'),
      tick: r.querySelector('.v3hud-tick'), det: r.querySelector('.v3hud-det'),
    });
    r.addEventListener('pointerenter', () => { if (zoneHover && mt.zone) zoneHover(mt.zone); });
    r.addEventListener('pointerleave', () => { if (zoneHover) zoneHover(null); });
    r.addEventListener('click', (e) => {
      const fr = e.target.closest('[data-ctrl]');
      if (fr) {   // 분해 항목 클릭 → 해당 조절 UI 플래시 (행 토글 안 함)
        window.dispatchEvent(new CustomEvent('v3:flash-control', { detail: { ctrl: fr.dataset.ctrl } }));
        return;
      }
      openKey = openKey === mt.key ? null : mt.key;   // 아코디언(한 행만)
      for (const [k, row] of rows) row.det.style.display = k === openKey ? '' : 'none';
      if (lastSpec) renderDetail(mt.key);
    });
  }

  // 분해 항목 → 표시행. m = 배율(±%), v = 가산(mm·°). 무영향(≈0)은 숨김.
  function fmtEntry(e, mt) {
    if (e.m !== undefined) {
      const pct = (e.m - 1) * 100;
      if (Math.abs(pct) < 0.5) return null;
      const good = mt.better == null ? null : (pct > 0) === mt.better;
      return { impact: Math.abs(pct), color: good == null ? NEUT : good ? GOOD : BAD,
               text: `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`, e };
    }
    if (Math.abs(e.v) < 0.05) return null;
    return { impact: Math.abs(e.v), color: mt.key === 'dec' ? BAD : NEUT,
             text: `${e.v > 0 ? '+' : '−'}${Math.abs(e.v).toFixed(1)}${e.unit || ''}`, e };
  }
  function renderDetail(key) {
    const row = rows.get(key);
    const list = (lastSpec?.breakdown?.[key] || [])
      .map((e) => fmtEntry(e, row.mt)).filter(Boolean)
      .sort((a, b) => b.impact - a.impact);
    row.det.innerHTML = list.length
      ? list.map((x) => `<div class="v3hud-det-row"${x.e.ctrl ? ` data-ctrl="${x.e.ctrl}" title="클릭: 조절 위치 표시"` : ''}>
          <span>${x.e.label}</span><span style="color:${x.color};font-weight:700;white-space:nowrap">${x.text}</span></div>`).join('')
      : `<div class="v3hud-det-empty">표준 상태 — 영향 요인 없음</div>`;
  }

  const pctOf = (mt, v) => Math.max(0, Math.min(100, ((v - mt.min) / (mt.max - mt.min)) * 100));
  function update(spec) {
    if (!baseline) return;
    lastSpec = spec;
    for (const [, row] of rows) {
      const mt = row.mt;
      const cur = mt.val(spec), std = mt.val(baseline);
      const delta = mt.delta ? mt.delta(spec, baseline) : cur - std;
      row.v.textContent = (mt.fmt && mt.fmt(spec)) || (cur.toFixed(1) + mt.unit);
      if (Math.abs(delta) < 0.05) row.d.textContent = '';
      else {
        row.d.textContent = ` ${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`;
        row.d.style.color = mt.better == null ? NEUT : ((delta > 0) === mt.better ? GOOD : BAD);
      }
      const bCur = mt.bar ? mt.bar(spec) : cur;
      const bStd = mt.bar ? mt.bar(baseline) : std;
      const pCur = pctOf(mt, bCur), pStd = pctOf(mt, bStd);
      row.fill.style.width = Math.min(pCur, pStd) + '%';
      row.seg.style.left = Math.min(pCur, pStd) + '%';
      row.seg.style.width = Math.abs(pCur - pStd) + '%';
      const segGood = mt.better == null ? null : (bCur > bStd) === mt.better;
      row.seg.style.background = segGood == null ? NEUT : segGood ? GOOD : BAD;
      row.tick.style.left = `calc(${pStd}% - 1px)`;
    }
    if (openKey) renderDetail(openKey);
  }
  return {
    update,
    setBaseline(spec) { baseline = spec; },
    caption(text) { capEl.textContent = text || ''; },
    setZoneHover(cb) { zoneHover = cb; },
  };
}

const container = document.getElementById('v3-stage');
const stage = createStudioStage(container);

stage.camera.position.set(...HOME_VIEW.pos);
stage.controls.target.set(...HOME_VIEW.tgt);
stage.controls.maxDistance = 2.6;
stage.controls.update();

window.__v3 = { stage };

const hud = mountEduHud(document.body);
// 표준 피팅 기준값 — 모든 Δ의 비교 대상 (등급 3·ADD 2.00·누진대 12·표준 피팅)
hud.setBaseline(computeZones({ grade: 3, add: 2.0, corridor: 12, v3fit: { ...STANDARD_FIT } }));

loadMannequin().then(({ group, anchors, morphMesh, eyes, headMesh, restPositions }) => {
  stage.scene.add(group);

  // 랜드마크 측정 대상 — baked facecap 메시(그룹 좌표, 직접 읽기) 또는
  // fallback 최대정점 메시(월드 변환 필요).
  let head = headMesh, toWorld = false;
  if (!head) {
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (o.isMesh && (!head || o.geometry.attributes.position.count > head.geometry.attributes.position.count)) head = o;
    });
    toWorld = true;
  }
  const m = head ? measureLandmarks(head, toWorld) : null;
  const glasses = createGlasses(anchors, m ? earNoseOpts(m, anchors) : {});
  group.add(glasses.group);

  // 두상 변형기 (facecap baked 메시에서만) — 귀 위치·콧대 조절
  const deformer = (headMesh && restPositions)
    ? createHeadDeform({ headMesh, restPositions }) : null;

  const zones = createVisionZones(anchors);
  group.add(zones.group);
  // 멀티뷰 per-view 필터용 레이어 분리 — 레이어는 per-camera라 공유 상태
  // (mesh.visible 토글)를 안 건드리고 뷰마다 특정 요소만 뺄 수 있다(race 없음).
  //   레이어 1 = 시야 콘   (정면·렌즈누진 뷰는 콘 제외 → 존맵만)
  //   레이어 2 = 아바타 얼굴 (시야콘 뷰는 얼굴 제외 → 원·중·근 콘만)
  //   레이어 0 = 안경(글라스)  (모든 뷰 공통)
  // group 전체를 얼굴(2)로 깔고 글라스(0)·콘(1)만 되돌려, 남는 아바타 본체
  // (얼굴·눈알·이빨)가 레이어 2에 남는다.
  group.traverse((o) => { if (o.isMesh) o.layers.set(2); });
  glasses.group.traverse((o) => { if (o.isMesh) o.layers.set(0); });
  zones.group.traverse((o) => { if (o.isMesh) o.layers.set(1); });
  stage.camera.layers.enable(1);
  stage.camera.layers.enable(2);
  // ⚠️ directional light는 레이어를 공유해야 조명 — 얼굴(레이어2)이 안
  // 어두워지도록 조명에도 레이어 2를 켠다(IBL은 레이어 무관이라 무영향).
  stage.scene.traverse((o) => { if (o.isLight) o.layers.enable(2); });

  const targets = createTargets(stage.scene);

  const demo = createDemoDirector({
    stage, zones,
    mannequin: { group, anchors },
    eyes, morphMesh,
    onFitChange: (patch) => update({ v3fit: patch }),
    onTargetsOn: () => update({ v3view: { targets: true } }),
    // 타깃 토글 UI가 제거돼(사용자 요청) 타깃은 데모 재생 중에만 표시 —
    // 종료 시 꺼서 켜진 채 방치되지 않게 한다.
    onTargetsOff: () => update({ v3view: { targets: false } }),
    onZonesOn: () => update({ v3view: { zones: { distance: true, intermediate: true, near: true } } }),
    getFit: () => ({ ...STANDARD_FIT, ...(state.v3fit || {}) }),
    getSpec: () => lastSpec,
  });

  // HUD 행 hover → 해당 존 콘 강조 (데모 재생 중엔 데모의 강조가 우선)
  hud.setZoneHover((zone) => { if (!demo.playing) zones.setEmphasis(zone); });

  // ── state → scene ──
  function glassesParams(f, fr, hd) {
    // 프레임 크기(bSize)는 상하좌우 전체 비례 스케일 (기준 31mm)
    const frameScale = f.bSize / 31;
    return {
      // 라이트스루 장부는 미클램프라 여기(소비 지점)에서 물리 한계를 적용한다
      // — 광학(computeZones)과 같은 클램프를 써야 3D 배치와 광학이 어긋나지 않는다.
      vd: (fitLimit('vd', f.vd) - 5) / 1000,   // 표시값 − 5 = 물리 VD (표시 12 = 물리 7mm)
      pantoDeg: fitLimit('panto', f.panto),
      wrapDeg: f.wrap,
      oh: fitLimit('oh', f.oh) / 1000 - 0.002, // keep the default −2mm fitting bias
      pdErr: f.pdErr / 1000,
      // 단안 PD — 비대칭이 꺼져 있으면 _R=base(차이 0 = 회귀 안전)
      pdErr_R: (f.pdErrAsym ? (f.pdErr_R ?? f.pdErr) : f.pdErr) / 1000,
      lensW: 0.046 * frameScale,
      lensH: 0.031 * frameScale,
      cornerR: 0.008 * frameScale,
      // 테 두께·깊이는 프레임 크기와 무관하게 고정(사용자 요청 — 렌즈 박스만 스케일)
      shape: f.shape,
      // 프레임 피팅 커스텀 (광학 무관 — mm/deg → m/deg)
      templeAngle: fr.templeAngle,
      templeLen: fr.templeLen / 1000,
      templeGap: fr.templeGap / 1000,
      templeBend: fr.templeBend,
      earTipAngle: fr.earTipAngle,
      earConverge: fr.earConverge,
      endpiece: fr.endpiece / 1000,
      // 좌우 비대칭 오른쪽값 — 대칭(Asym off)이면 base로 해석해 양쪽 동일
      templeAngle_R: fr.templeAngleAsym ? fr.templeAngle_R : fr.templeAngle,
      templeGap_R: (fr.templeGapAsym ? fr.templeGap_R : fr.templeGap) / 1000,
      templeBend_R: fr.templeBendAsym ? fr.templeBend_R : fr.templeBend,
      earTipAngle_R: fr.earTipAngleAsym ? fr.earTipAngle_R : fr.earTipAngle,
      earConverge_R: fr.earConvergeAsym ? fr.earConverge_R : fr.earConverge,
      // 코받침 (mm → m, 토글 bool)
      padOn: !!fr.padOn,
      padSpacing: fr.padSpacing / 1000,
      padVertical: fr.padVertical / 1000,
      padArm: (fr.padArm - 10) / 1000,   // 표시값 − 10 = 물리 (표시 0 = 물리 -10)
      // 옆통수 폭 splay (mm → m, asym 대칭 시 base) — 측두부 표면에 가산
      faceWidth: (hd?.faceWidth || 0) / 1000,
      faceWidth_R: ((hd?.faceWidthAsym ? hd.faceWidth_R : hd?.faceWidth) || 0) / 1000,
    };
  }

  let lastGrade = state.grade;
  let lastSpec = null;
  // 두상 변형 변경 감지 — 광학/프레임 슬라이더 변경 시 불필요한 재변형/리빌드 방지.
  const earKeyOf = (h) => `${h?.earY || 0},${h?.earZ || 0},${h?.earY_R || 0},${h?.earZ_R || 0},${h?.earYAsym || 0},${h?.earZAsym || 0}`;
  let lastHeadKey = null;   // null → 최초 apply에서 deform 실행(기본 콧대 오프셋 반영).
  // 초기 랜드마크는 rest(변형 전) 메시에서 측정됐으므로 기준도 rest(전부 0).
  // 귀 기본값이 0이 아니면(현재 earY 7) 첫 apply에서 earKey가 달라져 변형된
  // 메시로 재측정 + 템플 리핏이 자동으로 돈다 — 이걸 현재 state로 시드하면
  // 다리가 rest 귀 높이에 남아 기본 상태부터 귀에서 뜬다.
  let lastEarKey = earKeyOf({});

  function apply(s, animate) {
    const f = { ...STANDARD_FIT, ...(s.v3fit || {}) };
    const fr = { ...STANDARD_FRAME, ...(s.v3frame || {}) };
    // 코받침 → VD·OH 커플링은 라이트스루로 이전(2026-07-19, controls.js
    // padWrite): 코받침을 움직이면 v3fit.vd/oh 값 자체가 함께 갱신되므로
    // 여기서는 파생값 없이 f를 그대로 쓴다 — 슬라이더 표시·광학·렌더가
    // 단일 장부. (다리 경사각 등 템플 조정은 사용자 결정으로 광학 독립.)
    const spec = computeZones({ ...s, v3fit: f });

    // 등급 고스트 (D6): 등급이 바뀔 때 이전 존을 흰색 잔상으로 남긴다
    if (animate && s.grade !== lastGrade && lastSpec) {
      zones.showGhost(lastSpec);
    }
    lastGrade = s.grade;
    lastSpec = spec;

    zones.update(spec, animate);
    hud.update(spec);
    glasses.setParams(glassesParams(f, fr, s.v3head || {}));
    glasses.updateZoneSpec(spec);

    // 두상 변형 (귀 위치·콧대) — v3head 변경 시에만.
    if (deformer) {
      const headKey = JSON.stringify(s.v3head || {});
      if (headKey !== lastHeadKey) {
        lastHeadKey = headKey;
        // 콧대 표시값 − 4 = 물리 (표시 0 = 물리 -4). 나머지 키는 그대로.
        const hd = s.v3head || {};
        deformer.deform({ ...hd, noseBridge: (hd.noseBridge ?? 0) - 4 });
        // 귀가 움직인 경우에만 재측정 + 템플 리핏. noseClearance는 재전송하지
        // 않음 — 콧대는 시각 전용이라 안경 위치(프레임)에 영향 없음.
        const earKey = earKeyOf(s.v3head);
        if (earKey !== lastEarKey) {
          lastEarKey = earKey;
          const m2 = measureLandmarks(headMesh, false);
          const o = {};
          if (m2.earR) o.earR = { x: m2.earR.x, y: m2.earR.y + 0.006, z: m2.earR.z };
          if (m2.earL) o.earL = { x: m2.earL.x, y: m2.earL.y + 0.006, z: m2.earL.z };
          // headSideX(측두부 프로파일)는 재전송하지 않는다 — 두개골 옆면은 귀가
          // 움직여도 불변인데, 변형 메시에서 재측정하면 이동한 귀 돌출부가
          // 프로파일 빈에 누출돼 다리 몸통이 그 지점만 튀어나와 찌그러진다.
          // 로드 시 rest 측정값(glasses.params.headSideX)을 그대로 유지.
          glasses.setParams(o);
        }
      }
    }

    group.rotation.x = THREE.MathUtils.degToRad(f.headPitch || 0);
    // 머리 기울임(roll, + = 아바타 오른쪽 어깨 방향) — 시각 전용, 광학 무관
    group.rotation.z = THREE.MathUtils.degToRad(f.headRoll || 0);
    for (const [zone, on] of Object.entries(s.v3view?.zones || {})) {
      zones.setVisible(zone, on);
    }
    targets.setVisible(!!s.v3view?.targets);
    targets.update(spec, group, anchors);
  }

  apply(state, false);
  subscribe((s) => apply(s, true));

  // ── Direct drag (1급 입력) ──
  attachDragHandles({
    stage,
    glassesGroup: glasses.group,
    headMesh: head,
    getFit: () => ({ ...STANDARD_FIT, ...(state.v3fit || {}) }),
    onFitChange: (patch) => update({ v3fit: patch }),
  });

  // 시야 멀티뷰 팝업(좌상단) — 같은 scene을 정면·측면 각도로 동시 렌더.
  // 측면 뷰는 시야콘 '항상 켜짐' 고정(coneMeshes를 렌더 직전 강제 표시) —
  // 메인 화면의 존 토글과 완전 분리(사용자 결정 2026-07-23). 그래서 팝업
  // 열기가 메인 존 상태를 건드리지 않는다(예전 전역 강제 켬 제거).
  const multi = createMultiView({ scene: stage.scene, coneMeshes: zones.coneMeshes });

  // 흘러내림 시뮬 — 고개 숙임 × 귀 고정력 × 코받침 지지 (slipSim.js 헤더 참조)
  const slipSim = createSlipSim({ cap: hud.caption });

  mountControls(document.body, { stage, getDemo: () => demo, getMulti: () => multi, setCaption: hud.caption });
  mountCredit(document.body);

  Object.assign(window.__v3, {
    mannequin: { group, anchors, morphMesh, eyes, headMesh },
    glasses, zones, targets, demo, deformer, multi, slipSim,
  });
}).catch((err) => {
  console.error('Mannequin load failed:', err);
  // 로드 실패 시 빈 화면 대신 오류 안내 + 재시도(키오스크에서 직원이 복구 가능).
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;'
    + 'background:#171a20;color:#cfd6e4;font-family:Pretendard,system-ui,sans-serif;text-align:center;padding:24px;';
  box.innerHTML = '<div><div style="font-size:16px;font-weight:800;margin-bottom:10px">3D 아바타를 불러오지 못했습니다</div>'
    + '<div style="font-size:13px;opacity:.7;margin-bottom:18px">네트워크 연결을 확인하고 다시 시도해 주세요.</div>'
    + '<button id="v3-retry" style="padding:10px 20px;border-radius:10px;border:1px solid rgba(255,255,255,.2);'
    + 'background:#e8ecf4;color:#10131a;font-weight:700;font-size:13px;cursor:pointer">다시 시도</button></div>';
  document.body.appendChild(box);
  box.querySelector('#v3-retry').addEventListener('click', () => location.reload());
});
