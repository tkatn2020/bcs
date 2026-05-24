// 🅗 Recommendation — pure score-driven 3-tier reveal.
// Stagger-in animation on first render; "충분" tier lifts up.
// Reuses the pure-function `computeRecommendation` from the legacy module.

import { state, update, subscribe } from '../wavefront/state.js';
import { GRADES, getGrade } from '../optics/grades.js';
import { computeClearRatios, rxDioptricGap, gapScoreFromDioptric } from '../wavefront/helpers.js';
import { refractiveIndexFor, totalPriceFor, formatPrice } from '../optics/pricing.js';
import { geomFor } from './geom.js?v=18';

const MIN_ZONE_SUFFICIENT = 65;
const MIN_BALANCE_SUFFICIENT = 60;     // mean(D,I,N) - 0.5*stddev floor — blocks high-spread tiers
const SUFFICIENT_MIN_ID = 2;
const SUFFICIENT_MAX_ID = 4;
const FIT_RETHINK_RX = 50;
const T1_TOP_GRADE = 65;
const T2_COMPUTER_LENS = 60;
const ASYMMETRY_THRESHOLD_D = 1.5;
// Longer corridor pushes the near zone deeper (more downward gaze, less
// neck-comfortable reading posture, frame fit constraints). Apply a
// modest penalty to displayed near-zone score in recommendation logic
// only — geometric heatmap stays pure optics. Anchored at 10mm baseline
// (no penalty) so 12mm and 14mm progressively give up small near-zone
// score, complementing the corridorPeakRatio reduction in helpers.js.
const CORRIDOR_NEAR_PENALTY_PER_MM = 0.020;  // 2.0% per mm over 10mm baseline

function computeRecommendation(s) {
  // Corridor penalty applied uniformly to all grades (depends on s.corridor,
  // not grade) — captures the non-optical cost of longer corridor that the
  // pure optical model misses.
  const corridorNearPenalty = Math.max(
    0.85,
    1 - Math.max(0, s.corridor - 10) * CORRIDOR_NEAR_PENALTY_PER_MM
  );

  const fits = GRADES.map(g => {
    const od = computeClearRatios(geomFor({ ...s, grade: g.id }, 'OD'));
    const os = computeClearRatios(geomFor({ ...s, grade: g.id }, 'OS'));
    const D = (od.distanceWidthPct     + os.distanceWidthPct)     / 2;
    const I = (od.intermediateWidthPct + os.intermediateWidthPct) / 2;
    const N = ((od.nearWidthPct        + os.nearWidthPct)         / 2) * corridorNearPenalty;
    // Balance score — high mean, low spread. Penalizes "lopsided" tiers
    // where one zone scores high but another is near the cutoff.
    const mean = (D + I + N) / 3;
    const variance = ((D - mean) ** 2 + (I - mean) ** 2 + (N - mean) ** 2) / 3;
    const stddev = Math.sqrt(variance);
    const balance = mean - 0.5 * stddev;
    return { gradeId: g.id, D, I, N, minZone: Math.min(D, I, N), balance };
  });
  const best = fits.reduce((a, b) => b.minZone > a.minZone ? b : a);
  // Sufficient = passes BOTH min-zone floor AND balance floor.
  // Find the lowest grade that clears both; fall back to min-only, then to best.
  const rawSufficient =
    fits.find(f => f.minZone >= MIN_ZONE_SUFFICIENT && f.balance >= MIN_BALANCE_SUFFICIENT)
    ?? fits.find(f => f.minZone >= MIN_ZONE_SUFFICIENT)
    ?? best;
  const baseSufficientId = Math.max(SUFFICIENT_MIN_ID, Math.min(SUFFICIENT_MAX_ID, rawSufficient.gradeId));
  const dGap = rxDioptricGap(s.od, s.os);
  const isAsymmetric = dGap > ASYMMETRY_THRESHOLD_D;
  const sufficientId = isAsymmetric ? Math.min(SUFFICIENT_MAX_ID, baseSufficientId + 1) : baseSufficientId;

  const tiers = [
    { label: '최소', ...fits[sufficientId - 2] },
    { label: '충분', ...fits[sufficientId - 1] },
    { label: '최상', ...fits[sufficientId    ] },
  ];

  const needsRxRecheck = best.minZone < FIT_RETHINK_RX;
  // Warning is evaluated against the SELECTED grade's intermediate score so
  // it directly reflects what the customer would see at their current pick.
  const I_selected = fits[s.grade - 1].I;
  let computerWarning = null;
  if (I_selected < T2_COMPUTER_LENS) {
    computerWarning = {
      headline: `중간거리가 ${Math.round(I_selected)}점에 머무릅니다`,
      detail: '사무실/컴퓨터 전용 안경 병용을 권장드립니다 — 누진 단일 렌즈로는 중간시야 확보가 어렵습니다.',
    };
  } else if (I_selected < T1_TOP_GRADE) {
    computerWarning = {
      headline: `중간거리 시야가 약합니다 (${Math.round(I_selected)}점)`,
      detail: '중간거리 시야 폭이 표준 기준 미달입니다. 작업 거리·다중 모니터 환경에 따라 개인차가 있을 수 있습니다.',
    };
  }
  return {
    tiers, sufficientId,
    needsRxRecheck, isAsymmetric, dGap,
    computerWarning,
  };
}

export function mountRecommender(root) {
  const el = document.createElement('div');
  el.className = 'recommend-card';
  el.innerHTML = `
    <div class="recommend-h">
      <div class="recommend-h-l">추천 등급</div>
      <div class="recommend-h-mono">Recommendation</div>
    </div>
    <div class="recommend-row" data-role="row"></div>
    <div data-role="warn"></div>
    <div class="recommend-foot">
      <div class="recommend-foot-h" data-role="headline"></div>
      <div class="recommend-foot-body" data-role="clinical"></div>
    </div>
  `;
  root.appendChild(el);

  const rowEl = el.querySelector('[data-role="row"]');
  const warnEl = el.querySelector('[data-role="warn"]');
  const headlineEl = el.querySelector('[data-role="headline"]');
  const clinicalEl = el.querySelector('[data-role="clinical"]');

  let lastSig = null;

  rowEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.recommend-apply');
    if (!btn || btn.disabled) return;
    update({ grade: Number(btn.dataset.gradeId) });
  });

  function refresh(s) {
    const rec = computeRecommendation(s);
    const recId = rec.sufficientId;
    const ri = refractiveIndexFor(s.od.sphere, s.os.sphere);
    const opts = { signatureGens: s.signatureGens };

    const sig = `${recId}|${rec.tiers.map(t => Math.round(t.minZone)).join(',')}|${s.grade}|${rec.computerWarning?.headline ?? ''}`;
    const structureChanged = lastSig?.split('|').slice(0, 2).join('|') !== sig.split('|').slice(0, 2).join('|');

    if (structureChanged) {
      rowEl.innerHTML = rec.tiers.map((t, idx) => {
        const g = getGrade(t.gradeId);
        // is-best follows the SELECTED grade, not the recommended (충분) one.
        const isBest = t.gradeId === s.grade;
        const isCurrent = t.gradeId === s.grade;
        const price = totalPriceFor(t.gradeId, ri, opts);
        return `
          <div class="recommend-tier ${isBest ? 'is-best' : ''}" style="transition-delay:${idx * 90}ms" data-tier="${t.gradeId}">
            <div class="recommend-tier-label">${t.label}</div>
            <div class="recommend-tier-bp">${g.bpCode}</div>
            <div class="recommend-tier-name">${g.name}</div>
            <div class="recommend-tier-score">
              <span class="recommend-tier-score-num" data-role="score">${Math.round(t.minZone)}</span>
              <span class="recommend-tier-score-suffix">점</span>
            </div>
            <div class="recommend-tier-price">
              <span class="recommend-tier-price-num" data-role="price">${formatPrice(price)}</span>
              <span class="recommend-tier-price-suffix">원</span>
            </div>
            <button class="recommend-apply" data-grade-id="${g.id}" ${isCurrent ? 'disabled' : ''}>
              ${isCurrent ? '현재 등급' : '이 등급으로'}
            </button>
          </div>
        `;
      }).join('');
      // Stagger reveal
      requestAnimationFrame(() => {
        rowEl.querySelectorAll('.recommend-tier').forEach(t => t.classList.add('is-revealed'));
      });
    } else {
      // Just update buttons + scores + prices + highlight on selected change
      rec.tiers.forEach(t => {
        const tierEl = rowEl.querySelector(`[data-tier="${t.gradeId}"]`);
        if (!tierEl) return;
        const isCurrent = t.gradeId === s.grade;
        tierEl.classList.toggle('is-best', isCurrent);   // move gold highlight with selection
        const btn = tierEl.querySelector('.recommend-apply');
        btn.disabled = isCurrent;
        btn.textContent = isCurrent ? '현재 등급' : '이 등급으로';
        tierEl.querySelector('[data-role="score"]').textContent = Math.round(t.minZone);
        const price = totalPriceFor(t.gradeId, ri, opts);
        tierEl.querySelector('[data-role="price"]').textContent = formatPrice(price);
      });
    }

    if (rec.computerWarning) {
      warnEl.innerHTML = `
        <div class="computer-warning">
          <div class="computer-warning-h">⚠ ${rec.computerWarning.headline}</div>
          <div class="computer-warning-body">${rec.computerWarning.detail}</div>
        </div>
      `;
    } else {
      warnEl.innerHTML = '';
    }

    if (rec.needsRxRecheck) {
      headlineEl.textContent = '도수가 강해 모든 등급에서 만족도가 낮을 수 있습니다 — 처방 또는 누진대 길이 재검토를 권장드립니다.';
    } else {
      headlineEl.textContent = '가장 약한 거리(원·중·근)에서 65점 이상을 보장하는 최저 등급을 추천드립니다.';
    }
    const suff = rec.tiers[1];
    const g = getGrade(suff.gradeId);
    const gapNote = rec.isAsymmetric
      ? ` · 좌우격차 ${rec.dGap.toFixed(1)}D — 안정 적응을 위해 한 단계 위 추천`
      : '';
    clinicalEl.textContent = `${g.bpCode} 기준 — 원 ${Math.round(suff.D)} · 중 ${Math.round(suff.I)} · 근 ${Math.round(suff.N)}${gapNote}`;

    lastSig = sig;
  }

  refresh(state);
  subscribe(refresh);

  return { el };
}
