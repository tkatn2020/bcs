// 🅕 Adaptation period — consumer-friendly explainer
//
// Communicates THREE things customers actually want to know:
//   1. 며칠 걸리나? — big number front and center ("약 N일")
//   2. 처음엔 어떻게 느껴지나? — initial phase expectations
//   3. 언제 자연스러워지나? — settling phase + completion
//
// Visualization: A horizontal phase strip from Day 1 → completion, with
// the customer's predicted endpoint marked. Below, three plain-language
// phase rows describe what to expect at each milestone (icon + days +
// short body). Difficulty-tier badge in the corner keeps the clinical
// honest signal without dominating.

import { state, update, subscribe } from '../wavefront/state.js';
import { getGrade } from '../optics/grades.js';
import { tween } from '../wavefront/animations.js';

// Composite difficulty 1 (easy) → ~16 (hard).
// First-time progressive wearers take meaningfully longer to adapt than
// experienced wearers — clinically observed as roughly 1 tier shift in the
// adaptation window. Modeled as a +2 difficulty load when applicable.
function adaptationDifficulty(grade, s) {
  const adaptBase = { '어려움': 4, '보통': 3, '쉬움': 2, '매우 쉬움': 1 }[grade.adaptation] ?? 3;
  const avgSph = (Math.abs(s.od.sphere) + Math.abs(s.os.sphere)) / 2;
  const avgCyl = (Math.abs(s.od.cylinder) + Math.abs(s.os.cylinder)) / 2;
  let sphereLoad = 0;
  if (avgSph > 5) sphereLoad = 3;
  else if (avgSph > 3.5) sphereLoad = 2;
  else if (avgSph >= 2) sphereLoad = 1;
  let addLoad = 0;
  if (s.add > 2.5) addLoad = 3;
  else if (s.add >= 2) addLoad = 2;
  else if (s.add >= 1.5) addLoad = 1;
  let cylLoad = 0;
  if (avgCyl > 1.5) cylLoad = 2;
  else if (avgCyl >= 0.5) cylLoad = 1;
  const corridorLoad = s.corridor === 10 ? 2 : s.corridor === 12 ? 1 : 0;
  const firstTimeLoad = s.firstTimeWearer ? 2 : 0;
  return adaptBase + sphereLoad + addLoad + cylLoad + corridorLoad + firstTimeLoad;
}

// Map difficulty → expected adaptation days. Bands aligned with the
// clinical guidance the legacy module exposed: ≤3 → days, ≤6 → ~1 week,
// ≤9 → 2–3 weeks, >9 → 3–4 weeks.
function expectedDays(diff) {
  if (diff <= 3)  return 4;
  if (diff <= 5)  return 7;
  if (diff <= 7)  return 14;
  if (diff <= 9)  return 21;
  if (diff <= 11) return 28;
  return 35;
}

function profileFor(diff) {
  const days = expectedDays(diff);
  if (diff <= 3) {
    return {
      days,
      headline: '수일 내에 자연스러워집니다',
      tier: { label: '쉬움',  cls: 'easy' },
      cautionTip: '특별한 주의 없이 일상 착용 가능합니다.',
    };
  }
  if (diff <= 5) {
    return {
      days,
      headline: '약 1주면 일상에 익숙해집니다',
      tier: { label: '보통',  cls: 'easy' },
      cautionTip: '첫 며칠 어지러움이 있을 수 있으니 시선을 천천히 움직여 보세요.',
    };
  }
  if (diff <= 7) {
    return {
      days,
      headline: '약 2주 정도면 자연스러워집니다',
      tier: { label: '보통',  cls: 'mid' },
      cautionTip: '계단·운전 시 머리를 함께 돌려 시선이 렌즈 중심을 지나도록 해 주세요.',
    };
  }
  if (diff <= 9) {
    return {
      days,
      headline: '약 3주 천천히 적응이 필요합니다',
      tier: { label: '주의',  cls: 'mid' },
      cautionTip: '처음 1주는 짧게 착용하고 점차 시간을 늘리는 단계적 착용을 권장드립니다.',
    };
  }
  return {
    days,
    headline: '3주 이상 적응이 어려울 수 있습니다',
    tier: { label: '어려움', cls: 'hard' },
    cautionTip: '처방·누진대 길이 재검토 또는 단계적 착용을 의논해 보시기를 권합니다.',
  };
}

// Three phases of progressive adaptation. The customer's predicted
// completion day determines where the marker sits on the strip.
const PHASES = [
  {
    key: 'p1',
    range: '1–3일',
    rangeMaxDay: 3,
    title: '첫 며칠',
    body: '약간의 어지러움·이질감이 자연스럽습니다',
    icon: 'pulse',
  },
  {
    key: 'p2',
    range: '4–14일',
    rangeMaxDay: 14,
    title: '적응 기간',
    body: '점차 익숙해지며 시선 이동이 부드러워집니다',
    icon: 'leaf',
  },
  {
    key: 'p3',
    range: '2주 이상',
    rangeMaxDay: 28,
    title: '완전 적응',
    body: '안경을 쓴 것을 잊을 정도로 자연스러워집니다',
    icon: 'check',
  },
];

// Inline mono icons — flat, instrument-grade.
function icon(kind) {
  const s = `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke="currentColor"`;
  switch (kind) {
    case 'pulse':
      return `<svg viewBox="0 0 24 24"><path ${s} d="M3 12 L7 12 L9 6 L13 18 L15 10 L17 13 L21 13"/></svg>`;
    case 'leaf':
      return `<svg viewBox="0 0 24 24"><path ${s} d="M4 20 C 4 12 10 4 20 4 C 20 14 14 20 6 20 Z"/><path ${s} d="M4 20 L 14 10"/></svg>`;
    case 'check':
      return `<svg viewBox="0 0 24 24"><circle ${s} cx="12" cy="12" r="9"/><path ${s} d="M8 12.5 L11 15.5 L16 9.5"/></svg>`;
    default: return '';
  }
}

const STRIP_MAX_DAY = 28;

export function mountAdaptChart(root) {
  const el = document.createElement('div');
  el.className = 'adapt-card';
  el.innerHTML = `
    <div class="adapt-h">
      <div class="adapt-h-l">예상 적응 기간</div>
      <span class="adapt-tier" data-role="tier">보통</span>
    </div>
    <label class="adapt-firsttime" title="누진렌즈 첫 착용은 경험자보다 약 한 단계 더 긴 적응 기간이 필요합니다">
      <input type="checkbox" data-role="firsttime" ${state.firstTimeWearer ? 'checked' : ''}>
      <span class="adapt-firsttime-track"></span>
      <span class="adapt-firsttime-label">누진 첫 착용</span>
    </label>
    <div class="adapt-hero">
      <div class="adapt-hero-num">
        <span class="adapt-hero-num-int" data-role="days">0</span>
        <span class="adapt-hero-num-suf">일</span>
      </div>
      <div class="adapt-hero-msg" data-role="msg">—</div>
    </div>
    <div class="adapt-strip">
      <div class="adapt-strip-track">
        <div class="adapt-strip-band easy"></div>
        <div class="adapt-strip-band mid"></div>
        <div class="adapt-strip-band done"></div>
        <div class="adapt-strip-divider" style="left:10%"></div>
        <div class="adapt-strip-divider" style="left:50%"></div>
        <div class="adapt-strip-marker" data-role="marker" style="left:0%">
          <div class="adapt-strip-marker-dot"></div>
          <div class="adapt-strip-marker-flag" data-role="marker-flag">D0</div>
        </div>
      </div>
      <div class="adapt-strip-ticks">
        <span>1일</span><span>1주</span><span>2주</span><span>4주</span>
      </div>
    </div>
    <div class="adapt-phases" data-role="phases">
      ${PHASES.map(p => phaseRow(p)).join('')}
    </div>
    <div class="adapt-tip" data-role="tip">—</div>
  `;
  root.appendChild(el);

  const refs = {};
  el.querySelectorAll('[data-role]').forEach(n => { refs[n.dataset.role] = n; });

  refs.firsttime.addEventListener('change', () => {
    update({ firstTimeWearer: refs.firsttime.checked });
  });

  let prevDays = null;

  function refresh(s) {
    const grade = getGrade(s.grade);
    const diff = adaptationDifficulty(grade, s);
    const p = profileFor(diff);

    // Days number — count-up
    if (prevDays == null) {
      refs.days.textContent = p.days;
    } else if (prevDays !== p.days) {
      tween(prevDays, p.days, 600, v => { refs.days.textContent = Math.round(v); });
    }
    prevDays = p.days;

    refs.msg.textContent = p.headline;
    refs.tier.textContent = p.tier.label;
    refs.tier.className = 'adapt-tier ' + p.tier.cls;
    refs.tip.textContent = p.cautionTip;

    // Marker position on the strip — proportional to days / STRIP_MAX_DAY.
    // Clamp to 95% so the flag never falls off the right edge.
    const pct = Math.min(95, (p.days / STRIP_MAX_DAY) * 100);
    refs.marker.style.left = pct + '%';
    refs['marker-flag'].textContent = `${p.days}일`;

    // Mark which phase the customer's expected endpoint lands in.
    // Explicit state per phase. Fallback: if customer's expected days
    // exceeds the last phase's maxDay (>28), still highlight the final
    // phase (완전 적응) — they ARE in long-tail adaptation territory.
    const nodes = [...el.querySelectorAll('.adapt-phase')];
    let currentIdx = nodes.findIndex(n => p.days <= Number(n.dataset.maxDay));
    if (currentIdx === -1) currentIdx = nodes.length - 1;
    nodes.forEach((node, idx) => {
      node.classList.remove('is-current', 'is-done', 'is-future');
      if (idx < currentIdx) node.classList.add('is-done');
      else if (idx === currentIdx) node.classList.add('is-current');
      else node.classList.add('is-future');
    });
  }

  refresh(state);
  subscribe(refresh);

  return { el };
}

function phaseRow(p) {
  return `
    <div class="adapt-phase" data-phase="${p.key}" data-max-day="${p.rangeMaxDay}">
      <div class="adapt-phase-icon">${icon(p.icon)}</div>
      <div class="adapt-phase-body">
        <div class="adapt-phase-h">
          <span class="adapt-phase-range">${p.range}</span>
          <span class="adapt-phase-title">${p.title}</span>
        </div>
        <div class="adapt-phase-desc">${p.body}</div>
      </div>
    </div>
  `;
}
