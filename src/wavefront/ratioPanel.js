// ClearRatioPanel — the "원/중/근 선명시역 비율" card.
// This is the consumer-facing readout the optician shows during consultation.

import { computeClearRatios, ZONE_COLORS } from './helpers.js';

export function createRatioPanel(initialGeom, opts = {}) {
  const { compact = false, eyeLabel = '선명한 시야 분포', threshold = 0.25, baseline = null } = opts;

  let currentGeom = initialGeom;
  let currentBaseline = baseline;
  let currentThreshold = threshold;
  let currentEyeLabel = eyeLabel;

  const el = document.createElement('div');
  Object.assign(el.style, {
    background: '#0f172a', borderRadius: '10px',
    padding: compact ? '12px' : '16px',
    fontFamily: 'ui-sans-serif, system-ui', color: '#fff',
    boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
    minHeight: compact ? '130px' : '170px',
  });

  function render() {
    const ratios = currentGeom ? computeClearRatios(currentGeom, currentThreshold) : null;
    const baseRatios = currentBaseline ? computeClearRatios(currentBaseline, currentThreshold) : null;
    const useBase = !!currentBaseline;
    if (!ratios) {
      el.innerHTML = '<div style="color:#475569;font-size:10px;text-align:center;padding:20px">계산 중…</div>';
      return;
    }
    // PLATEAU WIDTHS (mm + normalized %) — actual width of clear column at
    // each zone-canonical gaze height. Exposes the pinched-corridor (Minkwitz)
    // shape: distance widest, corridor narrowest, near in between. Numbers
    // stay sales-meaningful (50–100% range for typical Rx) thanks to the
    // 0.40 D comfort threshold instead of 0.25 D.
    const rows = [
      { id: 'd', label: '원거리',   pct: ratios.distanceWidthPct,     mm: ratios.distanceWidth,     base: useBase ? baseRatios.distanceWidthPct     : null, color: ZONE_COLORS.distance },
      { id: 'i', label: '중간거리', pct: ratios.intermediateWidthPct, mm: ratios.intermediateWidth, base: useBase ? baseRatios.intermediateWidthPct : null, color: ZONE_COLORS.intermediate },
      { id: 'n', label: '근거리',   pct: ratios.nearWidthPct,         mm: ratios.nearWidth,         base: useBase ? baseRatios.nearWidthPct         : null, color: ZONE_COLORS.near },
    ];

    const deltaTag = (delta) => {
      if (delta == null) return '';
      const cls = Math.abs(delta) < 0.5 ? '#94a3b8' : delta > 0 ? '#4ade80' : '#f87171';
      const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '';
      return `<div style="font-size:9px;font-family:ui-monospace,monospace;color:${cls};min-width:30px;text-align:right">${arrow}${Math.abs(delta).toFixed(0)}</div>`;
    };

    const rowsHtml = rows.map(r => {
      const delta = r.base != null ? r.pct - r.base : null;
      return `
        <div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <div style="width:7px;height:7px;border-radius:1px;background:${r.color}"></div>
            <div style="font-size:11px;font-weight:600">${r.label}</div>
            <div style="font-size:9px;color:#64748b;font-family:ui-monospace,monospace">${r.mm.toFixed(0)}mm</div>
            <div style="flex:1"></div>
            <div style="font-size:14px;font-weight:700;font-family:ui-monospace,monospace">
              ${r.pct.toFixed(0)}<span style="font-size:9px;opacity:0.6">점</span>
            </div>
            ${deltaTag(delta)}
          </div>
          <div style="height:6px;background:#1e293b;border-radius:3px;overflow:hidden">
            <div style="width:${r.pct}%;height:100%;background:${r.color};transition:width 250ms"></div>
          </div>
        </div>
      `;
    }).join('');

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
        <div>
          <div style="font-size:9px;font-weight:700;letter-spacing:0.08em;color:#94a3b8;text-transform:uppercase">
            ${currentEyeLabel}
          </div>
          <div style="font-size:11px;font-weight:600;margin-top:2px">Clear Vision Field</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:700;font-family:ui-monospace,monospace">
            ${ratios.totalScore.toFixed(0)}<span style="font-size:11px;opacity:0.6"> / 100</span>
          </div>
          <div style="font-size:8px;color:#94a3b8">선명도 지수</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">${rowsHtml}</div>
    `;
  }

  render();

  function update({ geom, baseline, threshold, eyeLabel } = {}) {
    if (geom !== undefined) currentGeom = geom;
    if (baseline !== undefined) currentBaseline = baseline;
    if (threshold !== undefined) currentThreshold = threshold;
    if (eyeLabel !== undefined) currentEyeLabel = eyeLabel;
    render();
  }

  return { el, update };
}

// Combined OU bar — average of OD and OS, summarizing binocular outcome.
export function createCombinedRatioBar(odGeom, osGeom, threshold = 0.25) {
  let currentOd = odGeom, currentOs = osGeom, currentThreshold = threshold;

  const el = document.createElement('div');
  Object.assign(el.style, {
    background: '#1e293b', borderRadius: '8px', padding: '10px 12px',
    color: '#fff', fontFamily: 'ui-sans-serif, system-ui',
  });

  function avg(a, b) { return (a + b) / 2; }

  function render() {
    const od = computeClearRatios(currentOd, currentThreshold);
    const os = computeClearRatios(currentOs, currentThreshold);
    // Headline averaged across both eyes; per-zone uses plateau widths so
    // the OU bar matches the per-eye panels' Minkwitz-pinch shape.
    const ouScore = avg(od.totalScore, os.totalScore);
    const ouD = avg(od.distanceWidthPct,     os.distanceWidthPct);
    const ouI = avg(od.intermediateWidthPct, os.intermediateWidthPct);
    const ouN = avg(od.nearWidthPct,         os.nearWidthPct);
    const gap = Math.abs(od.totalScore - os.totalScore);

    // Each zone gets equal width in the bar; its inner color fills `score%`
    // of that third — so the eye reads "how much clarity in each zone".
    const seg = (score, color) => `
      <div style="flex:1;background:#0f172a;display:flex;align-items:stretch">
        <div style="width:${score}%;background:${color};transition:width 250ms"></div>
      </div>
    `;

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.08em;color:#94a3b8;text-transform:uppercase">OU 양안 평균</div>
        <div style="font-family:ui-monospace,monospace;font-size:14px;font-weight:700">
          ${ouScore.toFixed(0)}<span style="font-size:9px;opacity:0.6"> / 100</span>
        </div>
      </div>
      <div style="display:flex;height:10px;border-radius:3px;overflow:hidden;margin-bottom:6px;gap:2px">
        ${seg(ouD, ZONE_COLORS.distance)}
        ${seg(ouI, ZONE_COLORS.intermediate)}
        ${seg(ouN, ZONE_COLORS.near)}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;font-family:ui-monospace,monospace">
        <span>원 ${ouD.toFixed(0)}</span>
        <span>중 ${ouI.toFixed(0)}</span>
        <span>근 ${ouN.toFixed(0)}</span>
        <span style="color:${gap > 5 ? '#fbbf24' : '#94a3b8'}">좌우격차 ${gap.toFixed(1)}점</span>
      </div>
    `;
  }
  render();

  function update({ od, os, threshold } = {}) {
    if (od) currentOd = od;
    if (os) currentOs = os;
    if (threshold !== undefined) currentThreshold = threshold;
    render();
  }
  return { el, update };
}
