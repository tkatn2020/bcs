// 🅓 Hero Score panel — Apple Watch ring + count-up + improvement pulse
// Combines OD/OS into a single OU score with a big animated ring around it.

import { state, subscribe } from '../wavefront/state.js';
import { computeClearRatios } from '../wavefront/helpers.js';
import { tween, pulseClass } from '../wavefront/animations.js';
import { getGrade } from '../optics/grades.js';
import { geomFor } from './geom.js?v=17';

const RADIUS = 86;
const CIRC = 2 * Math.PI * RADIUS;

export function mountHeroScore(root) {
  const el = document.createElement('div');
  el.className = 'hero-score';
  el.innerHTML = `
    <div class="hero-score-h">
      <div class="hero-score-h-l">
        <span class="hero-score-h-title">선명한 시야 종합 점수</span>
        <span class="hero-score-h-sub">OU · Clear Vision Field</span>
      </div>
      <span class="hero-score-bp" data-role="bp">BP30</span>
    </div>
    <div class="hero-score-body">
      <div class="hero-score-ring">
        <svg viewBox="0 0 200 200">
          <circle class="ring-bg" cx="100" cy="100" r="${RADIUS}" stroke-width="8"></circle>
          <circle class="ring-glow" cx="100" cy="100" r="${RADIUS}" stroke-width="8"
                  stroke-dasharray="${CIRC}" stroke-dashoffset="0"></circle>
          <circle class="ring-fg"  cx="100" cy="100" r="${RADIUS}" stroke-width="8"
                  data-role="ring"
                  stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"></circle>
        </svg>
        <div class="hero-score-num-wrap">
          <div class="hero-score-num">
            <span class="hero-score-num-int" data-role="num">0</span>
            <span class="hero-score-num-suffix">/100</span>
          </div>
          <div class="hero-score-cap" data-role="cap">선명도 지수</div>
        </div>
      </div>
    </div>
    <div class="hero-score-zones">
      ${zoneRow('d', '원거리')}
      ${zoneRow('i', '중간거리')}
      ${zoneRow('n', '근거리')}
    </div>
  `;
  root.appendChild(el);

  const refs = {};
  el.querySelectorAll('[data-role]').forEach(n => { refs[n.dataset.role] = n; });

  let lastScore = null;
  let prev = { d: 0, i: 0, n: 0 };

  function setScoreSmooth(toScore) {
    const fromScore = lastScore == null ? 0 : lastScore;
    tween(fromScore, toScore, 700, (v) => {
      refs.num.textContent = Math.round(v).toString();
      const offset = CIRC * (1 - Math.min(100, Math.max(0, v)) / 100);
      refs.ring.style.strokeDashoffset = offset;
    });
    if (lastScore != null && toScore > lastScore + 1.5) {
      pulseClass(el, 'is-improving', 800);
      refs.cap.textContent = `+${(toScore - lastScore).toFixed(0)}점 향상`;
      refs.cap.classList.add('is-positive');
      setTimeout(() => {
        refs.cap.textContent = '선명도 지수';
        refs.cap.classList.remove('is-positive');
      }, 2200);
    }
    lastScore = toScore;
  }

  function setZoneSmooth(zone, toVal) {
    const fromVal = prev[zone];
    const valEl = el.querySelector(`[data-role="val-${zone}"]`);
    const barEl = el.querySelector(`[data-role="bar-${zone}"]`);
    tween(fromVal, toVal, 600, (v) => {
      valEl.textContent = Math.round(v).toString();
      barEl.style.width = Math.round(v) + '%';
    });
    prev[zone] = toVal;
  }

  function refresh(s) {
    const od = computeClearRatios(geomFor(s, 'OD'), s.threshold);
    const os = computeClearRatios(geomFor(s, 'OS'), s.threshold);
    const total = (od.totalScore + os.totalScore) / 2;
    const d = (od.distanceWidthPct + os.distanceWidthPct) / 2;
    const i = (od.intermediateWidthPct + os.intermediateWidthPct) / 2;
    const n = (od.nearWidthPct + os.nearWidthPct) / 2;

    refs.bp.textContent = getGrade(s.grade).bpCode;

    // Synchronous first paint — no animation. Avoids early-frame race
    // where the count-up tween hasn't started yet and the page shows 0.
    if (lastScore == null) {
      refs.num.textContent = Math.round(total).toString();
      refs.ring.style.strokeDashoffset = CIRC * (1 - Math.min(100, total) / 100);
      ['d', 'i', 'n'].forEach((z, idx) => {
        const v = [d, i, n][idx];
        const valEl = el.querySelector(`[data-role="val-${z}"]`);
        const barEl = el.querySelector(`[data-role="bar-${z}"]`);
        valEl.textContent = Math.round(v).toString();
        barEl.style.width = Math.round(v) + '%';
        prev[z] = v;
      });
      lastScore = total;
    } else {
      setScoreSmooth(total);
      setZoneSmooth('d', d);
      setZoneSmooth('i', i);
      setZoneSmooth('n', n);
    }

    const distMm = (od.distanceWidth + os.distanceWidth) / 2;
    const interMm = (od.intermediateWidth + os.intermediateWidth) / 2;
    const nearMm = (od.nearWidth + os.nearWidth) / 2;
    el.querySelector('[data-role="mm-d"]').textContent = `${distMm.toFixed(0)}mm 폭`;
    el.querySelector('[data-role="mm-i"]').textContent = `${interMm.toFixed(0)}mm 폭`;
    el.querySelector('[data-role="mm-n"]').textContent = `${nearMm.toFixed(0)}mm 폭`;
  }

  refresh(state);
  subscribe(refresh);

  return { el };
}

function zoneRow(id, name) {
  return `
    <div class="zone-row">
      <span class="zone-dot ${id}"></span>
      <div class="zone-row-mid">
        <div class="zone-row-name">${name} <span class="zone-row-mm" data-role="mm-${id}">— mm 폭</span></div>
        <div class="zone-bar">
          <div class="zone-bar-fill ${id}" data-role="bar-${id}" style="width:0%"></div>
        </div>
      </div>
      <span class="zone-row-val" data-role="val-${id}">0</span>
    </div>
  `;
}
