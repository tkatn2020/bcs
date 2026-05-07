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
import { getGeom, computeClearRatios } from './helpers.js';

// ── Algorithm constants ──────────────────────────────────────────

const ACTIVITY_WEIGHTS = {
  driving:  { d: 1.00, i: 0.20, n: 0.00 },
  monitor1: { d: 0.05, i: 1.00, n: 0.10 },
  monitor2: { d: 0.05, i: 1.20, n: 0.10 },
  monitor3: { d: 0.05, i: 1.40, n: 0.10 },
  laptop:   { d: 0.05, i: 0.65, n: 0.55 },
  phone:    { d: 0.00, i: 0.10, n: 1.00 },
};

// Three-tier recommendation:
//   • FIT_MINIMUM    = 50  — "최소" : entry-level acceptable
//   • FIT_SUFFICIENT = 65  — "충분" : comfortable, the sales sweet spot
//   • (highest fit)        — "최상" : premium pick
// Sufficient is highlighted as the recommended center anchor. If two tiers
// resolve to the same grade, only distinct grades are rendered.
//
// Other tunings:
//   • FIT_RETHINK_RX = 50  — even BEST grade < this → suggest Rx re-check
//   • AUX_LENS_I_THRESHOLD = 70 — multi-monitor + BP50 corridor < this →
//     suggest auxiliary lens (office / single-vision intermediate)
const FIT_MINIMUM    = 50;
const FIT_SUFFICIENT = 65;
const FIT_RETHINK_RX = 50;
const AUX_LENS_I_THRESHOLD = 70;

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
    const gap = Math.abs(od.totalScore - os.totalScore);
    return { gradeId: g.id, fit, breakdown: { D, I, N }, totalScoreAvg, gap };
  });

  const best = fits.reduce((a, b) => b.fit > a.fit ? b : a);
  const sufficient = fits.find(f => f.fit >= FIT_SUFFICIENT) ?? best;
  const minimum    = fits.find(f => f.fit >= FIT_MINIMUM)    ?? best;
  // "Re-check Rx" warning only fires when even the BEST grade falls below
  // the lower threshold — true clinical concern, not just I-heavy profile.
  const needsRxRecheck = best.fit < FIT_RETHINK_RX;

  // Build distinct tiers list — collapse duplicates while preserving the
  // 최소 → 충분 → 최상 ordering. Result has 1, 2, or 3 entries.
  const tiers = [];
  const seen = new Set();
  const pushIfNew = (label, info) => {
    if (seen.has(info.gradeId)) return;
    seen.add(info.gradeId);
    tiers.push({ label, ...info });
  };
  pushIfNew('최소', minimum);
  pushIfNew('충분', sufficient);
  pushIfNew('최상', best);

  // Aux-lens trigger: multi-monitor + BP50 corridor still tight
  const auxRecommended = (s.lifestyle.monitor >= 2) && (best.breakdown.I < AUX_LENS_I_THRESHOLD);

  return {
    kind: tiers.length === 1 ? 'single' : tiers.length === 2 ? 'hybrid' : 'triple',
    tiers,             // [{ label, gradeId, fit, breakdown, ... }] in 최소→충분→최상 order
    sufficient,        // kept for rationale + recommended highlight
    best,
    needsRxRecheck,
    weights: W,
    auxRecommended,
    auxNote: auxRecommended ? {
      headline: `BP50으로도 중간거리 폭이 ${Math.round(best.breakdown.I)}점 수준입니다`,
      detail: '사무실 전용 오피스 렌즈 또는 중간거리 단초점 병용 검토 권장.',
    } : null,
    rationale: rationaleText(W, best, sufficient, s, needsRxRecheck),
    gap: best.gap,
  };
}

// One-line sales headline + clinical breakdown
function rationaleText(W, best, sufficient, s, needsRxRecheck) {
  const pct = (v) => Math.round(v * 100);
  // Identify dominant zone (highest weight)
  const max = Math.max(W.d, W.i, W.n);
  let dominant;
  if (W.d === max) dominant = 'distance';
  else if (W.i === max) dominant = 'intermediate';
  else dominant = 'near';

  // Sales headline based on profile
  let headline;
  if (needsRxRecheck) {
    headline = '도수가 강해 모든 등급에서 만족도가 낮을 수 있습니다 — 처방 또는 누진대 길이 재검토 권장';
  } else if (s.lifestyle.monitor >= 2) {
    headline = `다중 모니터 환경 — corridor가 넓은 ${getGrade(best.gradeId).bpCode} 권장`;
  } else if (dominant === 'distance' && W.d > 0.7) {
    headline = `주로 운전·원거리 — ${getGrade(sufficient.gradeId).bpCode}으로 충분`;
  } else if (dominant === 'near' && W.n > 0.7) {
    headline = `근거리 작업 위주 — 넓은 근용 시야의 ${getGrade(best.gradeId).bpCode} 권장`;
  } else if (dominant === 'intermediate') {
    headline = `중간거리 사용이 많아 ${getGrade(best.gradeId).bpCode}이 적합`;
  } else {
    headline = `다양한 거리 사용 — 균형잡힌 ${getGrade(best.gradeId).bpCode} 권장`;
  }

  // Clinical breakdown
  const clinical = `중간 ${pct(W.i)}% · 근거리 ${pct(W.n)}% · 원거리 ${pct(W.d)}% 가중`;

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

  const gapWarn = rec.gap > 5 ? ` · 좌우격차 ${rec.gap.toFixed(1)}점` : '';

  root.innerHTML = `
    <div class="lifestyle-result-h">▼ 추천 결과</div>
    ${cardsHtml}
    ${auxHtml}
    <div class="lifestyle-rationale">
      <div class="rationale-headline">${rec.rationale.headline}</div>
      <div class="rationale-clinical">${rec.rationale.clinical}${gapWarn}</div>
    </div>
  `;
}
