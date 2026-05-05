// Tab 3 — A ↔ B free comparison (consultative).
// Both sides share the patient's Rx (from Section 1). Each side has its
// own grade/ADD/corridor that can be tuned independently. A central diff
// bar shows the per-zone improvement of B over A.

import { state as sharedState, subscribe } from './state.js';
import { getGeom, computeClearRatios, ZONE_COLORS } from './helpers.js';
import { GRADES } from '../optics/grades.js';
import { createBinocularLenses } from './lensBox.js';

const sideState = {
  A: { label: '권장 전 (BP10)', grade: 1, add: null, corridor: null },
  B: { label: '권장 후 (BP50)', grade: 5, add: null, corridor: null },
};

export function mountCompareSection(root) {
  root.innerHTML = `
    <h2 class="tab-title">⚖ A ↔ B 자유 비교</h2>
    <p class="tab-subtitle">두 시나리오를 동시에 비교하세요. 도수는 [📝 도수 입력] 탭의 값을 자동 사용합니다. 각 측의 등급·ADD·누진대만 다르게 설정 가능.</p>

    <div class="compare-grid">
      ${sidePane('A')}
      <div class="compare-diff-col" id="compare-diff"></div>
      ${sidePane('B')}
    </div>
  `;

  const sidePanels = {};

  ['A', 'B'].forEach(side => {
    const col = root.querySelector(`[data-side="${side}"]`);

    // Editable label
    const titleInput = col.querySelector('.cmp-title');
    titleInput.value = sideState[side].label;
    titleInput.addEventListener('change', () => { sideState[side].label = titleInput.value; });

    // Grade pills
    const gradeBox = col.querySelector('.cmp-grades');
    GRADES.forEach(g => {
      const btn = document.createElement('button');
      btn.className = 'grade-pill-lg';
      btn.dataset.grade = g.id;
      btn.dataset.active = String(sideState[side].grade === g.id);
      btn.innerHTML = `
        <span class="gp-num">${g.id}</span>
        <span class="gp-bp">${g.bpCode}</span>
      `;
      btn.addEventListener('click', () => { sideState[side].grade = g.id; refresh(); refreshDiff(); });
      gradeBox.appendChild(btn);
    });

    // ADD ±
    col.querySelector('.cmp-add-minus').addEventListener('click', () => {
      const cur = sideState[side].add ?? sharedState.add;
      sideState[side].add = clamp(cur - 0.25, 0.5, 3.5);
      refresh(); refreshDiff();
    });
    col.querySelector('.cmp-add-plus').addEventListener('click', () => {
      const cur = sideState[side].add ?? sharedState.add;
      sideState[side].add = clamp(cur + 0.25, 0.5, 3.5);
      refresh(); refreshDiff();
    });
    col.querySelector('.cmp-add-sync').addEventListener('click', () => {
      sideState[side].add = null;
      refresh(); refreshDiff();
    });

    // Corridor
    const corBox = col.querySelector('.cmp-corridors');
    [10, 12, 14].forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'pill';
      btn.dataset.corridor = c;
      btn.textContent = `${c}mm`;
      btn.addEventListener('click', () => { sideState[side].corridor = c; refresh(); refreshDiff(); });
      corBox.appendChild(btn);
    });
    col.querySelector('.cmp-cor-sync').addEventListener('click', () => {
      sideState[side].corridor = null;
      refresh(); refreshDiff();
    });

    // Lens viewer (will be sized after layout)
    let dual = null;
    function buildLens() {
      const wrap = col.querySelector('.cmp-lens-wrap');
      if (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      const w = Math.max(400, wrap.clientWidth - 4);
      const h = Math.round(w * 0.58);
      dual = createBinocularLenses(
        w, h,
        buildGeom(side, 'OD'),
        buildGeom(side, 'OS'),
        { showIso: true, showBands: true, environment: sharedState.environment }
      );
      wrap.appendChild(dual.el);
    }
    requestAnimationFrame(() => requestAnimationFrame(buildLens));

    // Ratio bar (just the OU summary inline)
    const ratioBar = col.querySelector('.cmp-ratiobar');

    function refresh() {
      // Active pill states
      col.querySelectorAll('[data-grade]').forEach(b =>
        b.dataset.active = String(sideState[side].grade === Number(b.dataset.grade))
      );
      const eff = effectiveSide(side);
      col.querySelectorAll('[data-corridor]').forEach(b =>
        b.dataset.active = String(eff.corridor === Number(b.dataset.corridor))
      );
      const addLbl = col.querySelector('.cmp-add-label');
      addLbl.textContent = '+' + eff.add.toFixed(2) + (sideState[side].add == null ? ' (공유)' : '');
      addLbl.style.color = sideState[side].add == null ? 'var(--c-ink-faint)' : 'var(--c-ink)';

      // Lens
      if (dual) {
        dual.update({
          od: buildGeom(side, 'OD'),
          os: buildGeom(side, 'OS'),
          opts: { environment: sharedState.environment },
        });
      }

      // Ratio bar (OU avg)
      const od = computeClearRatios(buildGeom(side, 'OD'), sharedState.threshold);
      const os = computeClearRatios(buildGeom(side, 'OS'), sharedState.threshold);
      const ouTotal = (od.totalClearPct + os.totalClearPct) / 2;
      const ouD = (od.distance + os.distance) / 2;
      const ouI = (od.intermediate + os.intermediate) / 2;
      const ouN = (od.near + os.near) / 2;
      ratioBar.innerHTML = `
        <div class="cmp-rb-total">
          <span>전체 선명영역</span>
          <strong>${ouTotal.toFixed(0)}<span style="font-size:14px;opacity:0.6">%</span></strong>
        </div>
        <div class="cmp-rb-bar">
          <div style="width:${ouD}%;background:${ZONE_COLORS.distance}"></div>
          <div style="width:${ouI}%;background:${ZONE_COLORS.intermediate}"></div>
          <div style="width:${ouN}%;background:${ZONE_COLORS.near}"></div>
        </div>
        <div class="cmp-rb-zones">
          <span><span class="dot" style="background:${ZONE_COLORS.distance}"></span>원 <strong>${ouD.toFixed(0)}%</strong></span>
          <span><span class="dot" style="background:${ZONE_COLORS.intermediate}"></span>중 <strong>${ouI.toFixed(0)}%</strong></span>
          <span><span class="dot" style="background:${ZONE_COLORS.near}"></span>근 <strong>${ouN.toFixed(0)}%</strong></span>
        </div>
      `;
    }

    sidePanels[side] = { refresh, buildLens };
    refresh();

    window.addEventListener('resize', () => requestAnimationFrame(buildLens));
  });

  // Diff column (between A and B)
  const diffCol = root.querySelector('#compare-diff');
  function refreshDiff() {
    const a = computeOu('A');
    const b = computeOu('B');
    const dTotal = b.total - a.total;
    const dDist  = b.dist - a.dist;
    const dInt   = b.inter - a.inter;
    const dNear  = b.near - a.near;
    const arrow = (v) => v > 0.5 ? '▲' : v < -0.5 ? '▼' : '＝';
    const cls = (v) => v > 0.5 ? 'pos' : v < -0.5 ? 'neg' : 'flat';
    diffCol.innerHTML = `
      <div class="diff-arrow">→</div>
      <div class="diff-card">
        <div class="diff-h">B − A 차이</div>
        <div class="diff-row diff-row-total ${cls(dTotal)}">
          <span class="diff-label">전체 선명</span>
          <span class="diff-val">${arrow(dTotal)} ${signed(dTotal)}<span class="u">%p</span></span>
        </div>
        <div class="diff-row ${cls(dDist)}">
          <span class="diff-label">원거리</span>
          <span class="diff-val">${arrow(dDist)} ${signed(dDist)}<span class="u">%p</span></span>
        </div>
        <div class="diff-row ${cls(dInt)}">
          <span class="diff-label">중간거리</span>
          <span class="diff-val">${arrow(dInt)} ${signed(dInt)}<span class="u">%p</span></span>
        </div>
        <div class="diff-row ${cls(dNear)}">
          <span class="diff-label">근거리</span>
          <span class="diff-val">${arrow(dNear)} ${signed(dNear)}<span class="u">%p</span></span>
        </div>
      </div>
    `;
  }
  refreshDiff();

  // Re-render both sides when shared state changes
  subscribe(() => {
    sidePanels.A.refresh();
    sidePanels.B.refresh();
    refreshDiff();
  });

  // Re-build lenses when this tab becomes active
  let lastTab = sharedState.activeTab;
  subscribe(s => {
    if (s.activeTab === 'compare' && lastTab !== 'compare') {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        sidePanels.A.buildLens();
        sidePanels.B.buildLens();
      }));
    }
    lastTab = s.activeTab;
  });
}

function sidePane(side) {
  const tag = side === 'A' ? '구성 A' : '구성 B';
  return `
    <div class="compare-side" data-side="${side}">
      <div class="cmp-h">
        <input type="text" class="cmp-title" />
        <span class="cmp-tag cmp-tag-${side.toLowerCase()}">${tag}</span>
      </div>
      <div class="cmp-ctrls">
        <div class="cmp-ctrl">
          <div class="cmp-ctrl-label">렌즈 등급</div>
          <div class="grade-pills-lg cmp-grades"></div>
        </div>
        <div class="cmp-ctrl-row">
          <div class="cmp-ctrl">
            <div class="cmp-ctrl-label">ADD</div>
            <div class="add-control">
              <button class="stepper cmp-add-minus">−</button>
              <div class="add-display cmp-add-label">+2.00</div>
              <button class="stepper cmp-add-plus">+</button>
              <button class="btn cmp-add-sync" style="height:var(--touch-min);font-size:12px;padding:0 10px">동기화</button>
            </div>
          </div>
          <div class="cmp-ctrl">
            <div class="cmp-ctrl-label">누진대</div>
            <div class="cmp-corridor-row">
              <div class="corridor-pills-lg cmp-corridors"></div>
              <button class="btn cmp-cor-sync" style="height:var(--touch-min);font-size:12px;padding:0 10px">동기화</button>
            </div>
          </div>
        </div>
      </div>
      <div class="cmp-lens-wrap"></div>
      <div class="cmp-ratiobar"></div>
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
    total: (od.totalClearPct + os.totalClearPct) / 2,
    dist:  (od.distance + os.distance) / 2,
    inter: (od.intermediate + os.intermediate) / 2,
    near:  (od.near + os.near) / 2,
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Math.round(v / 0.25) * 0.25));
}
function signed(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(1);
}
