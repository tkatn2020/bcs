// Compare screen — A ↔ B side-by-side comparison.
// Both sides share the shared Rx (from state.od/state.os) but can override
// grade/ADD/corridor independently. Center column shows zone-level diff.

import { state as sharedState, subscribe } from '../wavefront/state.js';
import { computeClearRatios, getGeom, CORRIDOR_OPTIONS } from '../wavefront/helpers.js';
import { GRADES, getGrade } from '../optics/grades.js';
import { createBinocularLenses } from '../wavefront/lensBox.js';

const sideState = {
  A: { label: '권장 전 · BP10', grade: 1, add: null, corridor: null },
  B: { label: '권장 후 · BP50', grade: 5, add: null, corridor: null },
};

export function mountCompare(root) {
  root.innerHTML = `
    <div class="compare-screen">
      ${sidePane('A')}
      <div class="compare-diff" id="cmp-diff"></div>
      ${sidePane('B')}
    </div>
  `;
  const panels = {};

  ['A', 'B'].forEach(side => {
    const col = root.querySelector(`[data-side="${side}"]`);
    const titleInput = col.querySelector('.compare-side-title');
    titleInput.value = sideState[side].label;
    titleInput.addEventListener('change', () => { sideState[side].label = titleInput.value; });

    // Grade pills
    const gradeBox = col.querySelector('[data-role="grades"]');
    GRADES.forEach(g => {
      const b = document.createElement('button');
      b.className = 'compare-ctrl-pill';
      b.dataset.grade = g.id;
      b.textContent = g.bpCode;
      b.addEventListener('click', () => { sideState[side].grade = g.id; refresh(); refreshDiff(); });
      gradeBox.appendChild(b);
    });

    // Corridor pills
    const corBox = col.querySelector('[data-role="corridors"]');
    CORRIDOR_OPTIONS.forEach(c => {
      const b = document.createElement('button');
      b.className = 'compare-ctrl-pill';
      b.dataset.corridor = c;
      b.textContent = `${c}mm`;
      b.addEventListener('click', () => { sideState[side].corridor = c; refresh(); refreshDiff(); });
      corBox.appendChild(b);
    });

    // ADD steppers
    col.querySelector('[data-role="add-minus"]').addEventListener('click', () => {
      const cur = sideState[side].add ?? sharedState.add;
      sideState[side].add = clamp(cur - 0.25, 0.5, 3.5);
      refresh(); refreshDiff();
    });
    col.querySelector('[data-role="add-plus"]').addEventListener('click', () => {
      const cur = sideState[side].add ?? sharedState.add;
      sideState[side].add = clamp(cur + 0.25, 0.5, 3.5);
      refresh(); refreshDiff();
    });

    // Stage — binocular lens
    let dual = null;
    const stage = col.querySelector('[data-role="stage"]');
    function buildLens() {
      if (dual?.dispose) dual.dispose();   // release old WebGL contexts before rebuild
      if (stage.firstChild) stage.removeChild(stage.firstChild);
      const W = stage.clientWidth - 12, H = stage.clientHeight - 12;
      const ASPECT = 0.55;
      let w = W;
      let h = w * ASPECT;
      if (h > H) { h = H; w = h / ASPECT; }
      w = Math.max(280, Math.round(w));
      h = Math.max(160, Math.round(h));
      dual = createBinocularLenses(w, h, buildGeom(side, 'OD'), buildGeom(side, 'OS'), {
        showIso: true, showBands: true, environment: 'driving',
      });
      stage.appendChild(dual.el);
    }
    requestAnimationFrame(() => requestAnimationFrame(buildLens));
    window.addEventListener('resize', () => requestAnimationFrame(buildLens));

    function refresh() {
      const eff = effectiveSide(side);
      col.querySelectorAll('[data-grade]').forEach(b => b.dataset.active = String(eff.grade === Number(b.dataset.grade)));
      col.querySelectorAll('[data-corridor]').forEach(b => b.dataset.active = String(eff.corridor === Number(b.dataset.corridor)));
      col.querySelector('[data-role="add-label"]').textContent = '+' + eff.add.toFixed(2);

      if (dual) dual.update({ od: buildGeom(side, 'OD'), os: buildGeom(side, 'OS'), opts: { environment: 'driving' } });

      const od = computeClearRatios(buildGeom(side, 'OD'), sharedState.threshold);
      const os = computeClearRatios(buildGeom(side, 'OS'), sharedState.threshold);
      const ouTotal = (od.totalScore + os.totalScore) / 2;
      const ouD = (od.distanceWidthPct + os.distanceWidthPct) / 2;
      const ouI = (od.intermediateWidthPct + os.intermediateWidthPct) / 2;
      const ouN = (od.nearWidthPct + os.nearWidthPct) / 2;

      col.querySelector('[data-role="total"]').textContent = Math.round(ouTotal);
      col.querySelector('[data-role="zone-d"]').textContent = Math.round(ouD);
      col.querySelector('[data-role="zone-i"]').textContent = Math.round(ouI);
      col.querySelector('[data-role="zone-n"]').textContent = Math.round(ouN);
    }

    panels[side] = { refresh, buildLens };
    refresh();
  });

  function refreshDiff() {
    const a = computeOu('A');
    const b = computeOu('B');
    const dTotal = b.total - a.total;
    const dDist = b.d - a.d;
    const dInter = b.i - a.i;
    const dNear = b.n - a.n;
    const arrow = v => v > 0.5 ? '▲' : v < -0.5 ? '▼' : '＝';
    const cls = v => v > 0.5 ? 'pos' : v < -0.5 ? 'neg' : 'flat';
    const sgn = v => (v >= 0 ? '+' : '') + v.toFixed(1);
    root.querySelector('#cmp-diff').innerHTML = `
      <div class="compare-diff-arrow">→</div>
      <div class="compare-diff-card">
        <div class="compare-diff-h">B − A</div>
        <div class="compare-diff-row total ${cls(dTotal)}">
          <span class="compare-diff-row-l">전체</span>
          <span class="compare-diff-row-v">${arrow(dTotal)} ${sgn(dTotal)}</span>
        </div>
        <div class="compare-diff-row ${cls(dDist)}">
          <span class="compare-diff-row-l">원거리</span>
          <span class="compare-diff-row-v">${arrow(dDist)} ${sgn(dDist)}</span>
        </div>
        <div class="compare-diff-row ${cls(dInter)}">
          <span class="compare-diff-row-l">중간</span>
          <span class="compare-diff-row-v">${arrow(dInter)} ${sgn(dInter)}</span>
        </div>
        <div class="compare-diff-row ${cls(dNear)}">
          <span class="compare-diff-row-l">근거리</span>
          <span class="compare-diff-row-v">${arrow(dNear)} ${sgn(dNear)}</span>
        </div>
      </div>
    `;
  }
  refreshDiff();

  subscribe(() => {
    panels.A.refresh();
    panels.B.refresh();
    refreshDiff();
  });

  let lastTab = sharedState.activeTab;
  subscribe(s => {
    if (s.activeTab === 'compare' && lastTab !== 'compare') {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        panels.A.buildLens();
        panels.B.buildLens();
      }));
    }
    lastTab = s.activeTab;
  });
}

function sidePane(side) {
  return `
    <div class="compare-side" data-side="${side}">
      <div class="compare-side-h">
        <span class="compare-side-tag ${side.toLowerCase()}">구성 ${side}</span>
        <input type="text" class="compare-side-title" />
      </div>
      <div class="compare-side-ctrls">
        <div class="compare-ctrl-row">
          <span class="compare-ctrl-label">Grade</span>
          <div class="compare-ctrl-pills" data-role="grades"></div>
        </div>
        <div class="compare-ctrl-row">
          <span class="compare-ctrl-label">ADD</span>
          <div class="compare-mini-add">
            <button class="stepper" data-role="add-minus">−</button>
            <div class="add-display" data-role="add-label">+2.00</div>
            <button class="stepper" data-role="add-plus">+</button>
          </div>
          <span class="compare-ctrl-label" style="margin-left:auto">Corridor</span>
          <div class="compare-ctrl-pills" data-role="corridors"></div>
        </div>
      </div>
      <div class="compare-side-stage" data-role="stage"></div>
      <div class="compare-side-foot">
        <div class="compare-side-foot-l">
          <span class="compare-side-foot-l-num" data-role="total">0</span>
          <span class="compare-side-foot-l-suf">/100</span>
        </div>
        <div class="compare-side-foot-zones">
          <div class="compare-zone"><span class="compare-zone-lbl">원</span><span class="compare-zone-val" data-role="zone-d">0</span></div>
          <div class="compare-zone"><span class="compare-zone-lbl">중</span><span class="compare-zone-val" data-role="zone-i">0</span></div>
          <div class="compare-zone"><span class="compare-zone-lbl">근</span><span class="compare-zone-val" data-role="zone-n">0</span></div>
        </div>
      </div>
    </div>
  `;
}

function effectiveSide(side) {
  return {
    grade: sideState[side].grade,
    add: sideState[side].add ?? sharedState.add,
    corridor: sideState[side].corridor ?? sharedState.corridor,
  };
}
function buildGeom(side, eye) {
  const eff = effectiveSide(side);
  const rx = eye === 'OS' ? sharedState.os : sharedState.od;
  return getGeom({
    grade: eff.grade, corridorLength: eff.corridor, add: eff.add,
    sphere: rx.sphere, cylinder: rx.cylinder, axis: rx.axis, eye,
  });
}
function computeOu(side) {
  const od = computeClearRatios(buildGeom(side, 'OD'), sharedState.threshold);
  const os = computeClearRatios(buildGeom(side, 'OS'), sharedState.threshold);
  return {
    total: (od.totalScore + os.totalScore) / 2,
    d:     (od.distanceWidthPct + os.distanceWidthPct) / 2,
    i:     (od.intermediateWidthPct + os.intermediateWidthPct) / 2,
    n:     (od.nearWidthPct + os.nearWidthPct) / 2,
  };
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Math.round(v / 0.25) * 0.25));
}
