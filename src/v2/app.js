// breezm 다초점 시뮬레이터 v2 — entry orchestrator
// Mounts header + simulator/compare screens and routes between tabs.

import { state, update, subscribe } from '../wavefront/state.js';
import { mountHeader } from './header.js?v=13';
import { mountSimulator } from './simulator.js?v=13';
import { mountCompare } from './compare.js?v=13';

function bootstrap() {
  const headerRoot = document.getElementById('topbar');
  mountHeader(headerRoot);

  const simRoot = document.getElementById('screen-simulator');
  mountSimulator(simRoot);

  const cmpRoot = document.getElementById('screen-compare');
  mountCompare(cmpRoot);

  // Tab routing
  function applyTab(s) {
    document.querySelectorAll('.screen').forEach(el => {
      el.classList.toggle('is-active', el.dataset.tab === s.activeTab);
    });
  }
  applyTab(state);
  subscribe(applyTab);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
