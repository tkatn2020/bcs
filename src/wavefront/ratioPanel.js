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
    background: 'linear-gradient(135deg, #0f172a 0%, #111d3a 100%)',
    borderRadius: '12px',
    padding: compact ? '12px' : '20px',
    fontFamily: 'ui-sans-serif, system-ui', color: '#fff',
    boxShadow: '0 8px 28px rgba(0,0,0,0.32)',
    minHeight: compact ? '130px' : '210px',
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
      return `<div style="font-size:11px;font-family:ui-monospace,monospace;color:${cls};min-width:34px;text-align:right;font-weight:700">${arrow}${Math.abs(delta).toFixed(0)}</div>`;
    };

    const rowsHtml = rows.map(r => {
      const delta = r.base != null ? r.pct - r.base : null;
      return `
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <div style="width:9px;height:9px;border-radius:2px;background:${r.color}"></div>
            <div style="font-size:15px;font-weight:700;color:#e2e8f0">${r.label}</div>
            <div style="font-size:11px;color:#64748b;font-family:ui-monospace,monospace">${r.mm.toFixed(0)}mm</div>
            <div style="flex:1"></div>
            <div style="font-size:24px;font-weight:800;font-family:ui-monospace,monospace;letter-spacing:-0.02em">
              ${r.pct.toFixed(0)}<span style="font-size:12px;opacity:0.55;font-weight:600;margin-left:1px">점</span>
            </div>
            ${deltaTag(delta)}
          </div>
          <div style="height:10px;background:#1e293b;border-radius:5px;overflow:hidden">
            <div style="width:${r.pct}%;height:100%;background:${r.color};transition:width 250ms;box-shadow:0 0 8px ${r.color}80"></div>
          </div>
        </div>
      `;
    }).join('');

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.08)">
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#94a3b8;text-transform:uppercase">
            ${currentEyeLabel}
          </div>
          <div style="font-size:14px;font-weight:700;margin-top:3px;color:#f1f5f9">Clear Vision Field</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:38px;font-weight:800;font-family:ui-monospace,monospace;line-height:1;letter-spacing:-0.03em;color:#fff">
            ${ratios.totalScore.toFixed(0)}<span style="font-size:16px;opacity:0.55;font-weight:600;margin-left:2px"> / 100</span>
          </div>
          <div style="font-size:11px;color:#94a3b8;font-weight:600;margin-top:4px;letter-spacing:0.04em">선명도 지수</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">${rowsHtml}</div>
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
    background: 'linear-gradient(135deg, #1e293b 0%, #243046 100%)',
    borderRadius: '12px',
    padding: '14px 16px',
    color: '#fff',
    fontFamily: 'ui-sans-serif, system-ui',
    boxShadow: '0 4px 14px rgba(0,0,0,0.20)',
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
        <div style="width:${score}%;background:${color};transition:width 250ms;box-shadow:0 0 6px ${color}80"></div>
      </div>
    `;

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:#cbd5e1;text-transform:uppercase">OU 양안 평균</div>
        <div style="font-family:ui-monospace,monospace;font-size:26px;font-weight:800;letter-spacing:-0.02em">
          ${ouScore.toFixed(0)}<span style="font-size:13px;opacity:0.55;font-weight:600;margin-left:2px"> / 100</span>
        </div>
      </div>
      <div style="display:flex;height:14px;border-radius:5px;overflow:hidden;margin-bottom:8px;gap:2px">
        ${seg(ouD, ZONE_COLORS.distance)}
        ${seg(ouI, ZONE_COLORS.intermediate)}
        ${seg(ouN, ZONE_COLORS.near)}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#cbd5e1;font-family:ui-monospace,monospace;font-weight:600">
        <span>원 <strong style="color:#fff">${ouD.toFixed(0)}</strong></span>
        <span>중 <strong style="color:#fff">${ouI.toFixed(0)}</strong></span>
        <span>근 <strong style="color:#fff">${ouN.toFixed(0)}</strong></span>
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
