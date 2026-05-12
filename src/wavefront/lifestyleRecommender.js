// Score-based grade recommender.
//
// Pure score-driven (no lifestyle activities). Computes per-grade D/I/N
// plateau scores and recommends a 3-grade window centered on the LOWEST
// grade where ALL three zones meet a comfort threshold. A separate
// "computer warning" surfaces when intermediate viewing is insufficient
// even at the top progressive grade — first nudging toward BP50, then
// recommending dedicated computer/office glasses if BP50 still falls short.
//
// Algorithm rationale: see plan file `~/.claude/plans/1-cheerful-journal.md`.

import { state, update, subscribe } from './state.js';
import { GRADES, getGrade } from '../optics/grades.js';
import { getGeom, computeClearRatios, rxDioptricGap, gapScoreFromDioptric } from './helpers.js';

// ── Algorithm constants ──────────────────────────────────────────
//
// Why min-zone (not average)?
//   A customer with D=100, I=80, N=40 has an avg of 73 — looks great on
//   paper, but the near zone is unusable. min(D,I,N)=40 captures the
//   weakest-link reality. The recommended grade is the lowest where the
//   weakest zone reaches MIN_ZONE_SUFFICIENT.
//
// Why clamp 충분 to BP20–BP40?
//   Avoids extreme defaults (BP10 as "buy this" feels too entry-level,
//   BP50 as "buy this" feels too pushy). BP10 only ever appears as 최소
//   (when 충분=BP20); BP50 only ever appears as 최상 (when 충분=BP40).
//
// Asymmetric Rx (anisometropia) handling:
//   Power-vector dioptric gap > 1.5 D → 충분 bumped +1 tier so the customer
//   is steered to a smoother lens design that better tolerates OD/OS diff.
//
// Computer-warning thresholds (I@BP50 = intermediate score at top grade):
//   • I@BP50 ≥ T1_TOP_GRADE (65)  → no warning
//   • T2_COMPUTER_LENS ≤ I@BP50 < T1_TOP_GRADE → "BP50 권장" warning
//   • I@BP50 < T2_COMPUTER_LENS (50) → "컴퓨터 전용 안경 병용 권장" warning
//   Clinical basis: I-score 70 ≈ 3mm corridor (industry comfort threshold);
//   65 = borderline (BP50 needed); 50 ≈ 1.5mm corridor (insufficient even
//   at premium tier — dedicated 5-7mm office/computer lens needed).
const MIN_ZONE_SUFFICIENT  = 65;
const SUFFICIENT_MIN_ID    = 2;   // BP20 — lowest grade allowed as 충분
const SUFFICIENT_MAX_ID    = 4;   // BP40 — highest grade allowed as 충분
const FIT_RETHINK_RX       = 50;  // even BEST grade min-zone < this → Rx re-check
const T1_TOP_GRADE         = 65;
const T2_COMPUTER_LENS     = 50;
const ASYMMETRY_THRESHOLD_D = 1.5;

// ── Pure recommendation computation ──────────────────────────────

export function computeRecommendation(s) {
  // Per-grade D/I/N scores (OD/OS averaged plateau-width pcts)
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
    const minZone = Math.min(D, I, N);
    const totalScoreAvg = (od.totalScore + os.totalScore) / 2;
    return { gradeId: g.id, D, I, N, minZone, totalScoreAvg };
  });

  const best = fits.reduce((a, b) => b.minZone > a.minZone ? b : a);
  // 충분 = lowest grade where the weakest zone clears MIN_ZONE_SUFFICIENT
  const rawSufficient = fits.find(f => f.minZone >= MIN_ZONE_SUFFICIENT) ?? best;
  const baseSufficientId = Math.max(SUFFICIENT_MIN_ID, Math.min(SUFFICIENT_MAX_ID, rawSufficient.gradeId));

  // Asymmetric Rx +1 tier bump (clinically borderline-significant gap)
  const dGap = rxDioptricGap(s.od, s.os);
  const gapScore = gapScoreFromDioptric(dGap);
  const isAsymmetric = dGap > ASYMMETRY_THRESHOLD_D;
  const sufficientId = isAsymmetric
    ? Math.min(SUFFICIENT_MAX_ID, baseSufficientId + 1)
    : baseSufficientId;

  // Re-check Rx warning: even BEST grade min-zone is critically low
  const needsRxRecheck = best.minZone < FIT_RETHINK_RX;

  // Always 3 consecutive grades centered on 충분 (clamp ensures both
  // neighbors exist within BP10..BP50)
  const tiers = [
    { label: '최소', ...fits[sufficientId - 2] },
    { label: '충분', ...fits[sufficientId - 1] },
    { label: '최상', ...fits[sufficientId    ] },
  ];
  const sufficient = fits[sufficientId - 1];

  // Computer warning — based on I@BP50 (intermediate at top grade)
  const I_at_top = fits[fits.length - 1].I;
  let computerWarning = null;
  if (I_at_top < T2_COMPUTER_LENS) {
    computerWarning = {
      level: 'computer-lens',
      headline: `BP50으로도 중간거리 폭이 ${Math.round(I_at_top)}점에 불과합니다`,
      detail: '사무실/컴퓨터 전용 안경 병용을 권장합니다 — 누진렌즈만으로 중간거리 시야 확보가 어렵습니다.',
    };
  } else if (I_at_top < T1_TOP_GRADE) {
    computerWarning = {
      level: 'top-grade',
      headline: `중간거리 시야가 약합니다 (BP50 기준 ${Math.round(I_at_top)}점)`,
      detail: '컴퓨터·사무 작업이 잦다면 최상 등급(BP50)을 권장합니다.',
    };
  }

  return {
    kind: 'triple',
    tiers,
    sufficient,
    best,
    needsRxRecheck,
    isAsymmetric,
    computerWarning,
    rationale: rationaleText(needsRxRecheck, isAsymmetric, dGap, gapScore, sufficient),
    dGap,
    gapScore,
  };
}

// Rationale headline + clinical breakdown.
//
// Without lifestyle activities, the rationale describes the SCORE-BASED
// recommendation logic itself: which grade brings the weakest zone above
// the comfort threshold. Asymmetric note appended when applicable.
function rationaleText(needsRxRecheck, isAsymmetric, dGap, gapScore, sufficient) {
  let headline;
  if (needsRxRecheck) {
    headline = '도수가 강해 모든 등급에서 만족도가 낮을 수 있습니다 — 처방 또는 누진대 길이 재검토 권장';
  } else {
    headline = `기준: 가장 약한 거리(원·중·근)에서 ${MIN_ZONE_SUFFICIENT}점 이상을 보장하는 최저 등급`;
  }

  const minStr = `${getGrade(sufficient.gradeId).bpCode} 기준 — 원 ${Math.round(sufficient.D)} · 중 ${Math.round(sufficient.I)} · 근 ${Math.round(sufficient.N)}`;
  const gapNote = isAsymmetric
    ? ` · 좌우격차 ${dGap.toFixed(1)}D (${Math.round(gapScore)}점) — 안정 적응을 위해 한 단계 위 등급 추천`
    : '';
  const clinical = minStr + gapNote;

  return { headline, clinical };
}

// ── DOM rendering ─────────────────────────────────────────────────

export function mountRecommender(parent) {
  const el = document.createElement('div');
  el.className = 'recommend-section';
  parent.appendChild(el);

  // Event delegation for "이 등급으로" apply buttons
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.recommend-apply');
    if (!btn || btn.disabled) return;
    const id = Number(btn.dataset.gradeId);
    if (!Number.isNaN(id)) update({ grade: id });
  });

  function refresh(s) {
    const rec = computeRecommendation(s);
    renderResult(el, rec, s.grade);
  }

  refresh(state);
  subscribe(refresh);
}

// ── Grade-spec card (sales rationale for the recommended 충분 tier) ─────

const TARGET_CUSTOMER = {
  1: '· 예산 한정 / 단순 처방\n· 첫 다초점',
  2: '· 표준 가성비\n· 일반 활동 위주',
  3: '· 다양한 시 활동\n· 균형 잡힌 시야 필요',
  4: '· 정밀 작업 종사자\n· 두 번째 누진 (적응 우수)',
  5: '· 까다로운 적응자\n· 최고 시야 추구\n· 첫 누진렌즈 비추',
};

function adaptationToStars(adaptation) {
  const map = { '어려움': '★★☆☆☆', '보통': '★★★☆☆', '쉬움': '★★★★☆', '매우 쉬움': '★★★★★' };
  return map[adaptation] ?? '★★★☆☆';
}

export function mountGradeSpecCard(parent) {
  const el = document.createElement('div');
  el.className = 'grade-spec-card';
  parent.appendChild(el);

  function refresh(s) {
    const rec = computeRecommendation(s);
    if (rec.kind !== 'triple') { el.innerHTML = ''; return; }
    const g = getGrade(rec.sufficient.gradeId);
    const adaptationStars = adaptationToStars(g.adaptation);
    const target = TARGET_CUSTOMER[g.id] ?? '';
    // Both metrics are derived from grades.js source-of-truth values:
    // - cylReductionFactor: 1.05 (BP10) → 0.55 (BP50)
    // - clearZoneScale:     0.95 (BP10) → 1.30 (BP50)
    const cylReductionPct = Math.round((1 - g.cylReductionFactor / 1.05) * 100);
    const corridorWidthPct = Math.round((g.clearZoneScale / 0.95 - 1) * 100);
    el.innerHTML = `
      <div class="grade-spec-h">▶ 추천 등급 상세</div>
      <div class="grade-spec-title">
        <span class="grade-spec-bp">${g.bpCode}</span>
        <span class="grade-spec-name">${g.name}</span>
      </div>
      <div class="grade-spec-en">${g.nameEn}</div>
      <div class="grade-spec-desc">${g.description}</div>
      <div class="grade-spec-metrics">
        <div class="metric"><span class="metric-l">적응</span><span class="metric-v">${adaptationStars}</span></div>
        <div class="metric"><span class="metric-l">가격</span><span class="metric-v">${g.priceLevel}</span></div>
        <div class="metric"><span class="metric-l">코리도 폭</span><span class="metric-v">+${corridorWidthPct}%</span></div>
        <div class="metric"><span class="metric-l">왜곡 감소</span><span class="metric-v">-${cylReductionPct}%</span></div>
      </div>
      <div class="grade-spec-target">${target}</div>
    `;
  }
  refresh(state);
  subscribe(refresh);
}

function renderResult(root, rec, currentGradeId) {
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
        <div class="recommend-fit">${Math.round(tier.minZone)}<span class="recommend-fit-suffix">점</span></div>
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

  // Computer warning — two levels: 'top-grade' vs 'computer-lens'
  const warnHtml = rec.computerWarning ? `
    <div class="computer-warning computer-warning-${rec.computerWarning.level}">
      <div class="computer-warning-h">⚠ ${rec.computerWarning.headline}</div>
      <div class="computer-warning-detail">${rec.computerWarning.detail}</div>
    </div>
  ` : '';

  root.innerHTML = `
    <div class="recommend-section-h">▼ 추천 결과</div>
    ${cardsHtml}
    ${warnHtml}
    <div class="recommend-rationale">
      <div class="rationale-headline">${rec.rationale.headline}</div>
      <div class="rationale-clinical">${rec.rationale.clinical}</div>
    </div>
  `;
}
