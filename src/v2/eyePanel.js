// Per-eye slim panel — fits in the dark side gutters of the stage.
// Shows OD/OS individual score + zone rows + bar.

import { state, subscribe } from '../wavefront/state.js';
import { computeClearRatios } from '../wavefront/helpers.js';
import { tween } from '../wavefront/animations.js';
import { geomFor } from './geom.js?v=13';

export function mountEyePanel(root, eye /* 'OD' | 'OS' */) {
  const isOD = eye === 'OD';
  const eyeKo = isOD ? '우안' : '좌안';

  const el = document.createElement('div');
  el.className = 'eye-panel';
  el.innerHTML = `
    <div class="eye-panel-h">
      <span class="eye-panel-tag ${eye.toLowerCase()}">${eye}</span>
      <span class="eye-panel-tag-ko">${eyeKo}</span>
    </div>
    <div>
      <div class="eye-panel-score">
        <span class="eye-panel-score-num" data-role="num">0</span>
        <span class="eye-panel-score-suffix">/100</span>
      </div>
      <div class="eye-panel-cap">Clear Vision Field</div>
    </div>
    <div class="eye-panel-rows">
      ${row('d', '원')}
      ${row('i', '중')}
      ${row('n', '근')}
    </div>
  `;
  root.appendChild(el);

  const refs = {};
  el.querySelectorAll('[data-role]').forEach(n => { refs[n.dataset.role] = n; });

  let prev = { score: 0, d: 0, i: 0, n: 0 };
  let firstPaint = true;

  function tweenTo(key, to, format) {
    if (firstPaint) {
      const node = refs[key === 'score' ? 'num' : `val-${key}`];
      node.textContent = format(to);
      if (key !== 'score') {
        const bar = refs[`bar-${key}`];
        if (bar) bar.style.width = Math.round(to) + '%';
      }
      prev[key] = to;
      return;
    }
    const from = prev[key];
    const node = refs[key === 'score' ? 'num' : `val-${key}`];
    tween(from, to, 600, (v) => {
      node.textContent = format(v);
    });
    if (key !== 'score') {
      const bar = refs[`bar-${key}`];
      if (bar) bar.style.width = Math.round(to) + '%';
    }
    prev[key] = to;
  }

  function refresh(s) {
    const r = computeClearRatios(geomFor(s, eye), s.threshold);
    tweenTo('score', r.totalScore, v => Math.round(v).toString());
    tweenTo('d', r.distanceWidthPct, v => Math.round(v).toString());
    tweenTo('i', r.intermediateWidthPct, v => Math.round(v).toString());
    tweenTo('n', r.nearWidthPct, v => Math.round(v).toString());
    firstPaint = false;
  }

  refresh(state);
  subscribe(refresh);

  return { el };
}

function row(id, name) {
  return `
    <div class="eye-row">
      <span class="zone-dot ${id}"></span>
      <span class="eye-row-name">${name}거리</span>
      <span class="eye-row-val" data-role="val-${id}">0</span>
      <div class="eye-row-bar"><div class="eye-row-bar-fill ${id}" data-role="bar-${id}" style="width:0%"></div></div>
    </div>
  `;
}
