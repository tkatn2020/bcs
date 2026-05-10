// ClearRatioPanel — the Score panel customers actually look at.
// Premium dark "obsidian stage" aesthetic, with animated count-up + glow
// pulse on improvements. All visual styling lives in styles.css.

import { computeClearRatios, rxDioptricGap, gapScoreFromDioptric } from './helpers.js';
import { countUp, pulseClass } from './animations.js';

export function createRatioPanel(initialGeom, opts = {}) {
  const { eyeLabel = '선명한 시야 분포', threshold = 0.25, baseline = null } = opts;

  let currentGeom = initialGeom;
  let currentBaseline = baseline;
  let currentThreshold = threshold;
  let currentEyeLabel = eyeLabel;
  let lastTotal = null;

  const el = document.createElement('div');
  el.className = 'score-panel';

  el.innerHTML = `
    <div class="score-eye-row">
      <div>
        <div class="score-eye-label" data-role="eye">${currentEyeLabel}</div>
        <div class="score-eye-sub">Clear Vision Field</div>
      </div>
      <div class="score-headline">
        <div class="score-num"><span data-role="total">0</span><span class="score-num-suffix">/ 100</span></div>
        <div class="score-caption">선명도 지수</div>
      </div>
    </div>
    <div class="score-rows">
      ${row('d', '원거리')}
      ${row('i', '중간거리')}
      ${row('n', '근거리')}
    </div>
  `;

  function row(id, name) {
    return `
      <div class="score-row" data-zone="${id}">
        <div class="score-row-h">
          <span class="score-zone-dot ${id}"></span>
          <span class="score-zone-name">${name}</span>
          <span class="score-zone-mm" data-role="mm-${id}">— mm</span>
          <span class="score-zone-spacer"></span>
          <span class="score-zone-val" data-role="val-${id}">0<span class="score-zone-val-suffix">점</span></span>
          <span class="score-zone-delta zero" data-role="delta-${id}"></span>
        </div>
        <div class="score-bar-track">
          <div class="score-bar-fill ${id}" data-role="bar-${id}" style="width:0%"></div>
        </div>
      </div>
    `;
  }

  const refs = {
    eye:    el.querySelector('[data-role="eye"]'),
    total:  el.querySelector('[data-role="total"]'),
    valD:   el.querySelector('[data-role="val-d"]'),
    valI:   el.querySelector('[data-role="val-i"]'),
    valN:   el.querySelector('[data-role="val-n"]'),
    mmD:    el.querySelector('[data-role="mm-d"]'),
    mmI:    el.querySelector('[data-role="mm-i"]'),
    mmN:    el.querySelector('[data-role="mm-n"]'),
    barD:   el.querySelector('[data-role="bar-d"]'),
    barI:   el.querySelector('[data-role="bar-i"]'),
    barN:   el.querySelector('[data-role="bar-n"]'),
    deltaD: el.querySelector('[data-role="delta-d"]'),
    deltaI: el.querySelector('[data-role="delta-i"]'),
    deltaN: el.querySelector('[data-role="delta-n"]'),
  };

  function setDelta(node, delta) {
    if (delta == null) {
      node.textContent = '';
      return;
    }
    const abs = Math.abs(delta);
    if (abs < 0.5) {
      node.textContent = '—';
      node.className = 'score-zone-delta zero';
      return;
    }
    const arrow = delta > 0 ? '▲' : '▼';
    node.textContent = `${arrow}${abs.toFixed(0)}`;
    node.className = 'score-zone-delta ' + (delta > 0 ? 'pos' : 'neg');
  }

  function valFormat(v) {
    return Math.round(v) + '<span class="score-zone-val-suffix">점</span>';
  }

  function render(animate = true) {
    if (!currentGeom) return;
    const r = computeClearRatios(currentGeom, currentThreshold);
    const base = currentBaseline ? computeClearRatios(currentBaseline, currentThreshold) : null;
    refs.eye.textContent = currentEyeLabel;

    // Count-up the headline. Pulse the panel if it improved noticeably.
    const onImprove = () => pulseClass(el, 'is-improving', 800);
    countUp(refs.total, r.totalScore, { duration: animate ? 280 : 0, onImprove });
    lastTotal = r.totalScore;

    // Per-zone values
    const apply = (zone, key, mmKey, base) => {
      const v = r[key];
      countUp(refs['val' + zone.toUpperCase()], v, {
        duration: animate ? 480 : 0, decimals: 0,
        formatter: (n) => Math.round(n) + '<span class="score-zone-val-suffix">점</span>',
      });
      // textContent doesn't accept HTML — use innerHTML via formatter trick:
      const valEl = refs['val' + zone.toUpperCase()];
      // The countUp animation ends by setting textContent; immediately
      // re-write innerHTML so the suffix span renders correctly.
      // We achieve this by overriding the formatter to use innerHTML:
      // (countUp uses textContent, so we need a custom approach):
      // → Done below with an effect override.
      refs[`mm${zone.toUpperCase()}`].textContent = `${r[mmKey].toFixed(0)}mm`;
      refs[`bar${zone.toUpperCase()}`].style.width = Math.round(v) + '%';
      const delta = base != null ? v - base[key] : null;
      setDelta(refs[`delta${zone.toUpperCase()}`], delta);
    };
    apply('d', 'distanceWidthPct',     'distanceWidth');
    apply('i', 'intermediateWidthPct', 'intermediateWidth');
    apply('n', 'nearWidthPct',         'nearWidth');
  }

  // Replace textContent-only count-up with an innerHTML formatter for
  // values that need a suffix span. Override countUp behaviour with a
  // direct render fallback on every animation frame:
  //   (we patch by re-rendering values with innerHTML after countUp ends)
  // Simpler: don't rely on countUp's HTML, instead wrap value spans so
  // the number is one node and suffix is another.
  // → Refactor: number goes to a child, suffix is sibling.

  // Replace zone-val markup to separate number + suffix:
  ['d', 'i', 'n'].forEach(z => {
    const node = refs['val' + z.toUpperCase()];
    node.innerHTML = '<span data-num>0</span><span class="score-zone-val-suffix">점</span>';
    refs['valNum_' + z] = node.querySelector('[data-num]');
  });
  refs.totalNum = refs.total; // already a span

  // Simpler rendering rewritten:
  function renderV2(animate = true) {
    if (!currentGeom) return;
    const r = computeClearRatios(currentGeom, currentThreshold);
    const base = currentBaseline ? computeClearRatios(currentBaseline, currentThreshold) : null;
    refs.eye.textContent = currentEyeLabel;
    const dur = animate ? 280 : 0;     // was 520 — snappier for iPad

    const onImprove = () => pulseClass(el, 'is-improving', 800);
    countUp(refs.totalNum, r.totalScore, { duration: dur, decimals: 0, onImprove });

    const each = [
      ['d', 'distanceWidthPct',     'distanceWidth'],
      ['i', 'intermediateWidthPct', 'intermediateWidth'],
      ['n', 'nearWidthPct',         'nearWidth'],
    ];
    each.forEach(([z, key, mmKey]) => {
      const v = r[key];
      countUp(refs['valNum_' + z], v, { duration: dur, decimals: 0 });
      refs['mm' + z.toUpperCase()].textContent = `${r[mmKey].toFixed(0)}mm`;
      refs['bar' + z.toUpperCase()].style.width = Math.round(v) + '%';
      const delta = base != null ? v - base[key] : null;
      setDelta(refs['delta' + z.toUpperCase()], delta);
    });
  }

  // Initial paint, no animation
  renderV2(false);

  function update({ geom, baseline, threshold, eyeLabel } = {}) {
    if (geom !== undefined) currentGeom = geom;
    if (baseline !== undefined) currentBaseline = baseline;
    if (threshold !== undefined) currentThreshold = threshold;
    if (eyeLabel !== undefined) currentEyeLabel = eyeLabel;
    renderV2(true);
  }

  return { el, update };
}

// Combined OU bar — premium dark style.
export function createCombinedRatioBar(odGeom, osGeom, threshold = 0.25) {
  let currentOd = odGeom, currentOs = osGeom, currentThreshold = threshold;

  const el = document.createElement('div');
  el.className = 'ou-panel';
  el.innerHTML = `
    <div class="ou-h">
      <span class="ou-h-label">OU 양안 평균</span>
      <span class="ou-h-num"><span data-role="ou-num">0</span><span class="ou-h-num-suffix">/ 100</span></span>
    </div>
    <div class="ou-bar">
      <div class="ou-bar-seg"><div class="ou-bar-fill d" data-role="ou-d" style="width:0%"></div></div>
      <div class="ou-bar-seg"><div class="ou-bar-fill i" data-role="ou-i" style="width:0%"></div></div>
      <div class="ou-bar-seg"><div class="ou-bar-fill n" data-role="ou-n" style="width:0%"></div></div>
    </div>
    <div class="ou-zones">
      <span>원 <strong data-role="ou-dn">0</strong></span>
      <span>중 <strong data-role="ou-in">0</strong></span>
      <span>근 <strong data-role="ou-nn">0</strong></span>
      <span class="ou-aniso" data-role="ou-gap">좌우격차 0.0</span>
    </div>
  `;
  const refs = {};
  el.querySelectorAll('[data-role]').forEach(n => { refs[n.dataset.role] = n; });

  function avg(a, b) { return (a + b) / 2; }

  function render(animate = true) {
    const od = computeClearRatios(currentOd, currentThreshold);
    const os = computeClearRatios(currentOs, currentThreshold);
    const ouScore = avg(od.totalScore, os.totalScore);
    const ouD = avg(od.distanceWidthPct, os.distanceWidthPct);
    const ouI = avg(od.intermediateWidthPct, os.intermediateWidthPct);
    const ouN = avg(od.nearWidthPct, os.nearWidthPct);
    // Power-vector dioptric gap (handles sphere + cyl + axis differences
    // uniformly per Long's decomposition). geom objects carry sphere,
    // cylinder (abs), axis fields. See rxDioptricGap().
    const dGap = rxDioptricGap(currentOd, currentOs);
    const gapScore = gapScoreFromDioptric(dGap);

    const dur = animate ? 260 : 0;     // was 480 — snappier for iPad
    countUp(refs['ou-num'], ouScore, { duration: dur, decimals: 0 });
    refs['ou-d'].style.width = Math.round(ouD) + '%';
    refs['ou-i'].style.width = Math.round(ouI) + '%';
    refs['ou-n'].style.width = Math.round(ouN) + '%';
    countUp(refs['ou-dn'], ouD, { duration: dur, decimals: 0 });
    countUp(refs['ou-in'], ouI, { duration: dur, decimals: 0 });
    countUp(refs['ou-nn'], ouN, { duration: dur, decimals: 0 });
    refs['ou-gap'].textContent = `좌우격차 ${dGap.toFixed(1)}D (${Math.round(gapScore)}점)`;
    // Warn-color triggers at 1.5 D (clinically borderline-significant).
    refs['ou-gap'].classList.toggle('warn', dGap > 1.5);
  }
  render(false);

  function update({ od, os, threshold } = {}) {
    if (od) currentOd = od;
    if (os) currentOs = os;
    if (threshold !== undefined) currentThreshold = threshold;
    render(true);
  }
  return { el, update };
}
