// Bottom tab bar — drives state.activeTab and shows/hides tab panels.

import { state, update, subscribe } from './state.js';

const TABS = [
  { id: 'input',     icon: '📝', label: '도수 입력' },
  { id: 'simulator', icon: '👁',  label: '시뮬레이션' },
  { id: 'compare',   icon: '⚖',  label: 'A↔B 비교' },
];

export function mountTabbar(root) {
  root.innerHTML = '';
  TABS.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tabbar-btn';
    btn.dataset.tab = t.id;
    btn.dataset.active = String(state.activeTab === t.id);
    btn.innerHTML = `
      <span class="tabbar-icon">${t.icon}</span>
      <span class="tabbar-label">${t.label}</span>
    `;
    btn.addEventListener('click', () => update({ activeTab: t.id }));
    root.appendChild(btn);
  });

  // Show/hide panels based on activeTab
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
