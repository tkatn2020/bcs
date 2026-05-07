// Lifestyle-based grade recommender.
//
// Takes a customer's daily-vision activity profile (driving / PC monitors /
// laptop / phone) and finds the BP grade that best fits their viewing-
// distance demand. Renders a card in the simulator aside with a hybrid
// recommendation: "필요충분" (cost-conscious smallest sufficient grade) +
// "최상" (best-fit grade), plus an optional supplementary-lens alert when
// even BP50 can't deliver enough corridor width for multi-monitor users.
//
// Algorithm details and rationale: see the plan file
// `~/.claude/plans/1-cheerful-journal.md`.

import { state, update, subscribe } from './state.js';
import { GRADES, getGrade } from '../optics/grades.js';
import { getGeom, computeClearRatios, rxDioptricGap, gapScoreFromDioptric } from './helpers.js';

// ── Algorithm constants ──────────────────────────────────────────

const ACTIVITY_WEIGHTS = {
  driving:  { d: 1.00, i: 0.20, n: 0.00 },
  monitor1: { d: 0.05, i: 1.00, n: 0.10 },
  monitor2: { d: 0.05, i: 1.20, n: 0.10 },
  monitor3: { d: 0.05, i: 1.40, n: 0.10 },
  laptop:   { d: 0.05, i: 0.65, n: 0.55 },
  phone:    { d: 0.00, i: 0.10, n: 1.00 },
};

// Three-tier recommendation — ALWAYS 3 consecutive grades centered on
// the calibrated 충분 (sufficient) tier:
//   • 최소 = 충분 − 1
//   • 충분 = (lowest grade with fit ≥ FIT_SUFFICIENT, clamped to BP20–BP40)
//   • 최상 = 충분 + 1
//
// Why clamp 충분 to BP20–BP40?
//   • Avoids extreme defaults (BP10 as "buy this" feels too entry-level,
//     BP50 as "buy this" feels too pushy). Mid-tier products are the sales
//     sweet spot; the entry/premium tiers become down/upgrade options.
//   • BP10 only ever appears as 최소 (when 충분 = BP20).
//   • BP50 only ever appears as 최상 (when 충분 = BP40).
//
// Asymmetric Rx (anisometropia) handling:
//   • ASYMMETRY_THRESHOLD_D = 1.5 D — clinically borderline-significant
//     anisometropia. When power-vector dioptric gap exceeds this, the 충분
//     tier is bumped up by 1 grade so the customer is steered to a smoother
//     lens design that better tolerates the OD/OS difference.
//
// Other tunings:
//   • FIT_RETHINK_RX = 50      — even BEST grade < this → suggest Rx re-check
//   • AUX_LENS_I_THRESHOLD = 70 — multi-monitor + BP50 corridor < this →
//     suggest auxiliary lens (office / single-vision intermediate)
const FIT_SUFFICIENT     = 70;
const SUFFICIENT_MIN_ID  = 2;   // BP20 — lowest grade allowed as 충분
const SUFFICIENT_MAX_ID  = 4;   // BP40 — highest grade allowed as 충분
const FIT_RETHINK_RX     = 50;
const AUX_LENS_I_THRESHOLD = 70;
const ASYMMETRY_THRESHOLD_D = 1.5;

const ACTIVITIES = [
  { key: 'driving', icon: '🚗', label: '운전',           sub: '원거리' },
  { key: 'monitor', icon: '🖥️', label: 'PC · 모니터',    sub: '70~80cm', hasMonitorCount: true },
  { key: 'laptop',  icon: '💻', label: '노트북 · 태블릿', sub: '50~60cm' },
  { key: 'phone',   icon: '📱', label: '휴대폰 · 책',    sub: '30~40cm' },
];

// ── Pure recommendation computation ──────────────────────────────

function combineWeights(ls) {
  const acc = { d: 0, i: 0, n: 0 };
  const add = w => { acc.d += w.d; acc.i += w.i; acc.n += w.n; };
  if (ls.driving) add(ACTIVITY_WEIGHTS.driving);
  if (ls.monitor === 1) add(ACTIVITY_WEIGHTS.monitor1);
  if (ls.monitor === 2) add(ACTIVITY_WEIGHTS.monitor2);
  if (ls.monitor === 3) add(ACTIVITY_WEIGHTS.monitor3);
  if (ls.laptop) add(ACTIVITY_WEIGHTS.laptop);
  if (ls.phone)  add(ACTIVITY_WEIGHTS.phone);
  const sum = acc.d + acc.i + acc.n;
  if (sum < 1e-6) return null;
  // Lateral demand from multi-monitor — boosts I weight
  const lateralDemand = ls.monitor === 2 ? 0.20 : ls.monitor === 3 ? 0.40 : 0;
  return { d: acc.d, i: acc.i, n: acc.n, lateralDemand };
}

export function computeRecommendation(s) {
  const w = combineWeights(s.lifestyle);
  if (!w) return { kind: 'empty' };

  // Apply lateral-demand boost to I, then renormalize so D+I+N = 1
  const wI_boosted = w.i * (1 + w.lateralDemand);
  const total = w.d + wI_boosted + w.n;
  const W = { d: w.d / total, i: wI_boosted / total, n: w.n / total };

  // Compute fit per grade using OD/OS averaged plateau-width pct
  const fits = GRADES.map(g => {
    const od = computeClearRatios(getGeom({
      grade: g.id, corridorLength: s.corridor, add: s.add,
      sphere: s.od.sphere, cylinder: s.od.cylinder, axis: s.od.axis, eye: 'OD',
    }));
    const os = computeClearRatios(getGeom({
      grade: g.id, corridorLength: s.corridor, add: s.add,
      sphere: s.os.sphere, cylinder: s.os.cylinder, axis: s.os.axis, eye: 'OS',
    }));
    const D = (od.distanceWidthPct     + os.distanceWidthPct)     / 2;
    const I = (od.intermediateWidthPct + os.intermediateWidthPct) / 2;
    const N = (od.nearWidthPct         + os.nearWidthPct)         / 2;
    const fit = W.d * D + W.i * I + W.n * N;
    const totalScoreAvg = (od.totalScore + os.totalScore) / 2;
    return { gradeId: g.id, fit, breakdown: { D, I, N }, totalScoreAvg };
  });

  const best = fits.reduce((a, b) => b.fit > a.fit ? b : a);
  const rawSufficient = fits.find(f => f.fit >= FIT_SUFFICIENT) ?? best;
  // Clamp the calibrated 충분 grade to [BP20, BP40] so the recommended
  // center never lands on the entry tier (BP10 → too cheap to recommend)
  // or the top tier (BP50 → upgrade option, not default). The clamped id
  // determines which 3 consecutive grades are displayed.
  const baseSufficientId = Math.max(SUFFICIENT_MIN_ID, Math.min(SUFFICIENT_MAX_ID, rawSufficient.gradeId));
  // Anisometropia handling — power-vector dioptric gap (D). Independent of
  // grade since it's a property of the Rx itself. When gap > 1.5 D
  // (clinically borderline-significant), promote the displayed 충분 by
  // one tier so the OLD 최상 effectively takes the new 충분 slot. Steers
  // toward a smoother lens design that tolerates OD/OS difference better.
  const dGap = rxDioptricGap(s.od, s.os);
  const gapScore = gapScoreFromDioptric(dGap);
  const isAsymmetric = dGap > ASYMMETRY_THRESHOLD_D;
  const sufficientId = isAsymmetric
    ? Math.min(SUFFICIENT_MAX_ID, baseSufficientId + 1)
    : baseSufficientId;
  // "Re-check Rx" warning only fires when even the BEST grade falls below
  // the lower threshold — true clinical concern, not just I-heavy profile.
  const needsRxRecheck = best.fit < FIT_RETHINK_RX;

  // Always 3 consecutive grades: 충분-1 / 충분 / 충분+1 (with clamp guarantees
  // both neighbors exist within BP10..BP50 since 충분 ∈ [BP20, BP40]).
  const tiers = [
    { label: '최소', ...fits[sufficientId - 2] },  // gradeId = sufficientId - 1
    { label: '충분', ...fits[sufficientId - 1] },  // gradeId = sufficientId
    { label: '최상', ...fits[sufficientId    ] },  // gradeId = sufficientId + 1
  ];
  // The "sufficient" object used downstream by rationale text + aux check.
  // We expose the DISPLAYED 충분 (clamped) as the recommendation handle.
  const sufficient = fits[sufficientId - 1];

  // Aux-lens trigger: multi-monitor + BP50 corridor still tight
  const auxRecommended = (s.lifestyle.monitor >= 2) && (best.breakdown.I < AUX_LENS_I_THRESHOLD);

  return {
    kind: 'triple',    // always 3 cards now (consecutive grade window)
    tiers,             // [{ label, gradeId, fit, breakdown, ... }] in 최소→충분→최상 order
    sufficient,        // kept for rationale + recommended highlight
    best,
    needsRxRecheck,
    isAsymmetric,
    weights: W,
    auxRecommended,
    auxNote: auxRecommended ? {
      headline: `BP50으로도 중간거리 폭이 ${Math.round(best.breakdown.I)}점 수준입니다`,
      detail: '사무실 전용 오피스 렌즈 또는 중간거리 단초점 병용 검토 권장.',
    } : null,
    rationale: rationaleText(W, sufficient, s, needsRxRecheck, isAsymmetric, dGap, gapScore),
    dGap,
    gapScore,
  };
}

// One-line headline + clinical breakdown.
//
// The headline now describes the USE PROFILE (no specific grade pitch),
// because the 3-tier cards already do the recommending. Mentioning a grade
// HIGHER than the displayed 최상 in the headline created a contradiction
// ("you're shown BP10/BP20/BP30 but BP40 is suggested?") and felt like a
// hidden upsell. Cards = grade selection. Headline = environment context.
//
// Exception: the driving-centric headline still references the displayed
// 충분 since it ALIGNS with what's highlighted (no contradiction).
//
// Asymmetric note: when 좌우격차 > 5점 the recommended tier was already
// promoted by 1 step in the main computation; clinical line explains why.
function rationaleText(W, sufficient, s, needsRxRecheck, isAsymmetric, dGap, gapScore) {
  const pct = (v) => Math.round(v * 100);
  const max = Math.max(W.d, W.i, W.n);
  let dominant;
  if (W.d === max) dominant = 'distance';
  else if (W.i === max) dominant = 'intermediate';
  else dominant = 'near';

  let headline;
  if (needsRxRecheck) {
    headline = '도수가 강해 모든 등급에서 만족도가 낮을 수 있습니다 — 처방 또는 누진대 길이 재검토 권장';
  } else if (s.lifestyle.monitor >= 2) {
    headline = '다중 모니터 환경 — 넓은 corridor 폭이 핵심';
  } else if (dominant === 'distance' && W.d > 0.7) {
    // Driving-centric profile aligns with the displayed 충분 — no conflict.
    headline = `주로 운전·원거리 — ${getGrade(sufficient.gradeId).bpCode}으로 충분`;
  } else if (dominant === 'near' && W.n > 0.7) {
    headline = '근거리 작업이 많은 환경 — 넓은 근용 시야가 중요';
  } else if (dominant === 'intermediate') {
    headline = '중간거리 사용이 많은 환경 — corridor 폭이 중요';
  } else {
    headline = '다양한 거리를 고루 사용하는 환경';
  }

  // Clinical breakdown + asymmetric note
  const weightsText = `중간 ${pct(W.i)}% · 근거리 ${pct(W.n)}% · 원거리 ${pct(W.d)}% 가중`;
  const gapNote = isAsymmetric
    ? ` · 좌우격차 ${dGap.toFixed(1)}D (${Math.round(gapScore)}점) — 안정 적응을 위해 한 단계 위 등급 추천`
    : '';
  const clinical = weightsText + gapNote;

  return { headline, clinical };
}

// ── DOM rendering ─────────────────────────────────────────────────

export function mountLifestyleRecommender(parent) {
  const el = document.createElement('div');
  el.className = 'lifestyle-card';
  el.innerHTML = renderShell();
  parent.appendChild(el);

  // Wire activity toggles
  el.querySelectorAll('input.lifestyle-toggle').forEach(inp => {
    inp.addEventListener('change', () => {
      const key = inp.dataset.key;
      if (key === 'monitor') {
        // Toggle ON → restore previous count or default to 1; OFF → 0
        const prev = state.lifestyle.monitor;
        update({ lifestyle: { monitor: inp.checked ? Math.max(1, prev) : 0 } });
      } else {
        update({ lifestyle: { [key]: inp.checked } });
      }
    });
  });

  // Wire monitor-count segmented control
  el.querySelectorAll('.monitor-count-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      update({ lifestyle: { monitor: Number(btn.dataset.count) } });
    });
  });

  // Result area uses event delegation for the "apply grade" buttons
  el.querySelector('.lifestyle-result').addEventListener('click', (e) => {
    const btn = e.target.closest('.recommend-apply');
    if (!btn || btn.disabled) return;
    const id = Number(btn.dataset.gradeId);
    if (!Number.isNaN(id)) update({ grade: id });
  });

  function refresh(s) {
    // Sync activity toggle states
    el.querySelector('input[data-key="driving"]').checked = s.lifestyle.driving;
    el.querySelector('input[data-key="monitor"]').checked = s.lifestyle.monitor > 0;
    el.querySelector('input[data-key="laptop"]').checked  = s.lifestyle.laptop;
    el.querySelector('input[data-key="phone"]').checked   = s.lifestyle.phone;

    // Monitor sub-selector visibility + active count
    const monRow = el.querySelector('.monitor-count-row');
    monRow.hidden = !(s.lifestyle.monitor > 0);
    el.querySelectorAll('.monitor-count-pill').forEach(b => {
      b.dataset.active = String(Number(b.dataset.count) === s.lifestyle.monitor);
    });

    // Recommendation result
    const rec = computeRecommendation(s);
    renderResult(el.querySelector('.lifestyle-result'), rec, s.grade);
  }

  refresh(state);
  subscribe(refresh);
}

// ── HTML rendering helpers ────────────────────────────────────────

function renderShell() {
  return `
    <div class="lifestyle-h">
      <div class="lifestyle-h-title">🎯 라이프스타일 분석</div>
      <div class="lifestyle-h-sub">주요 시 활동을 선택하세요</div>
    </div>
    <div class="lifestyle-list">
      ${ACTIVITIES.map(activityRow).join('')}
    </div>
    <div class="lifestyle-result"></div>
  `;
}

function activityRow(a) {
  const monitorSub = a.hasMonitorCount ? `
    <div class="monitor-count-row" hidden>
      <button class="monitor-count-pill" data-count="1">1대</button>
      <button class="monitor-count-pill" data-count="2">2대</button>
      <button class="monitor-count-pill" data-count="3">3대</button>
    </div>
  ` : '';
  return `
    <label class="lifestyle-row">
      <span class="lifestyle-emoji">${a.icon}</span>
      <span class="lifestyle-text">
        <span class="lifestyle-label">${a.label}</span>
        <span class="lifestyle-sub-inline"> · ${a.sub}</span>
      </span>
      <span class="switch">
        <input type="checkbox" class="lifestyle-toggle" data-key="${a.key}">
        <span class="switch-track"></span>
      </span>
    </label>
    ${monitorSub}
  `;
}

function renderResult(root, rec, currentGradeId) {
  if (rec.kind === 'empty') {
    root.innerHTML = `<div class="lifestyle-empty">관심 활동을 1개 이상 선택하면 맞춤 등급을 추천해드립니다.</div>`;
    return;
  }

  // The 충분 tier is the "anchor" — visually highlighted as the recommended
  // center choice. If 충분 doesn't exist as a distinct tier (e.g. 최소 ==
  // 충분), fall back to highlighting whichever tier matches sufficient.
  const recommendedId = rec.sufficient.gradeId;

  const card = (tier) => {
    const g = getGrade(tier.gradeId);
    const isCurrent = tier.gradeId === currentGradeId;
    const isRecommended = tier.gradeId === recommendedId;
    return `
      <div class="recommend-card ${isRecommended ? 'is-best' : ''}">
        <div class="recommend-tier">${tier.label}</div>
        <div class="recommend-bp">${g.bpCode}</div>
        <div class="recommend-name">${g.name}</div>
        <div class="recommend-fit">${Math.round(tier.fit)}<span class="recommend-fit-suffix">점</span></div>
        <button class="recommend-apply" data-grade-id="${g.id}" ${isCurrent ? 'disabled' : ''}>
          ${isCurrent ? '현재 등급' : '이 등급으로'}
        </button>
      </div>
    `;
  };

  const cardsHtml = `
    <div class="recommend-row recommend-row-${rec.tiers.length}">
      ${rec.tiers.map(card).join('')}
    </div>
  `;

  const auxHtml = rec.auxRecommended ? `
    <div class="lifestyle-aux">
      <div class="lifestyle-aux-h">⚠ ${rec.auxNote.headline}</div>
      <div class="lifestyle-aux-detail">${rec.auxNote.detail}</div>
    </div>
  ` : '';

  // Asymmetric note now lives inside rec.rationale.clinical (rendered with
  // a softer color via .rationale-clinical). The card window itself is
  // already shifted up by 1 tier when isAsymmetric is true.

  root.innerHTML = `
    <div class="lifestyle-result-h">▼ 추천 결과</div>
    ${cardsHtml}
    ${auxHtml}
    <div class="lifestyle-rationale">
      <div class="rationale-headline">${rec.rationale.headline}</div>
      <div class="rationale-clinical">${rec.rationale.clinical}</div>
    </div>
  `;
}
