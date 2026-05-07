// Bottom tab bar — pill-style, numbered.

import { state, update, subscribe } from './state.js';

const TABS = [
  { id: 'input',     num: '01', label: '도수 입력' },
  { id: 'simulator', num: '02', label: '시뮬레이션' },
  { id: 'compare',   num: '03', label: 'A↔B 비교' },
];

export function mountTabbar(root) {
  root.innerHTML = '';
  TABS.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tabbar-btn';
    btn.dataset.tab = t.id;
    btn.dataset.active = String(state.activeTab === t.id);
    btn.innerHTML = `
      <span class="tabbar-num">${t.num}</span>
      <span class="tabbar-label">${t.label}</span>
    `;
    btn.addEventListener('click', () => update({ activeTab: t.id }));
    root.appendChild(btn);
  });

  function applyTab(tab) {
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.tab === tab);
    });
    root.querySelectorAll('.tabbar-btn').forEach(b => {
      b.dataset.active = String(b.dataset.tab === tab);
    });
  }
  applyTab(state.activeTab);
  subscribe(s => applyTab(s.activeTab));
}

export { TABS };
