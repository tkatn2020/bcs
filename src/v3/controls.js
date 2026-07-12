// v3 controls — temporary minimal overlay (grade cards + ADD stepper +
// corridor buttons). Visual design intentionally plain: final look is
// decided during build (PRD v0.5); this earns its structure in M2 when it
// splits into gradeSelector.js / floatingControls.js per PRD §9.2.

import { state, update, subscribe } from '../wavefront/state.js';
import { GRADES } from '../optics/grades.js';

const CSS = `
  .v3-top, .v3-bottom {
    position: fixed; left: 50%; transform: translateX(-50%);
    display: flex; gap: 8px; align-items: center;
    padding: 10px 14px; border-radius: 14px;
    background: rgba(16, 19, 26, 0.72); backdrop-filter: blur(10px);
    font-family: 'Pretendard', system-ui, sans-serif;
    z-index: 10; user-select: none; -webkit-user-select: none;
  }
  .v3-top { top: 16px; }
  .v3-bottom { bottom: 18px; }
  .v3-grade {
    min-width: 74px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14);
    background: transparent; color: #cfd6e4; font-size: 13px; font-weight: 700; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
  }
  .v3-grade small { font-size: 10px; font-weight: 500; opacity: 0.65; }
  .v3-grade.on { background: #e8ecf4; color: #10131a; border-color: #e8ecf4; }
  .v3-label { font-size: 11px; letter-spacing: 0.08em; color: #8b93a7; font-weight: 700; margin: 0 2px 0 10px; }
  .v3-step { width: 34px; height: 34px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.14);
    background: transparent; color: #e8ecf4; font-size: 16px; cursor: pointer; }
  .v3-val { min-width: 58px; text-align: center; color: #fff; font-weight: 800; font-size: 15px;
    font-variant-numeric: tabular-nums; }
  .v3-corr { padding: 8px 12px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.14);
    background: transparent; color: #cfd6e4; font-size: 13px; font-weight: 700; cursor: pointer; }
  .v3-corr.on { background: #e8ecf4; color: #10131a; border-color: #e8ecf4; }
`;

export function mountControls(root) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const top = document.createElement('div');
  top.className = 'v3-top';
  top.innerHTML = GRADES.map((g) => `
    <button class="v3-grade" data-grade="${g.id}">${g.bpCode}<small>${g.name}</small></button>
  `).join('');
  root.appendChild(top);

  const bottom = document.createElement('div');
  bottom.className = 'v3-bottom';
  bottom.innerHTML = `
    <span class="v3-label">ADD</span>
    <button class="v3-step" data-add="-0.25">−</button>
    <span class="v3-val" data-role="add">+2.00</span>
    <button class="v3-step" data-add="0.25">＋</button>
    <span class="v3-label">누진대</span>
    ${[10, 12, 14].map((c) => `<button class="v3-corr" data-corr="${c}">${c}mm</button>`).join('')}
  `;
  root.appendChild(bottom);

  top.addEventListener('click', (e) => {
    const b = e.target.closest('[data-grade]');
    if (b) update({ grade: Number(b.dataset.grade) });
  });
  bottom.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const next = Math.min(3.5, Math.max(0.75, (state.add ?? 2) + Number(add.dataset.add)));
      update({ add: Math.round(next * 4) / 4 });
    }
    const corr = e.target.closest('[data-corr]');
    if (corr) update({ corridor: Number(corr.dataset.corr) });
  });

  function refresh(s) {
    top.querySelectorAll('[data-grade]').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.grade) === s.grade));
    bottom.querySelector('[data-role="add"]').textContent = '+' + (s.add ?? 2).toFixed(2);
    bottom.querySelectorAll('[data-corr]').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.corr) === s.corridor));
  }
  refresh(state);
  subscribe(refresh);
}
