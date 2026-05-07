// Bootstrap — wires up the iPad layout: top bar, tab bar, simulator + compare.

import { mountTabbar } from './tabbar.js';
import { mountHeader } from './header.js';
import { mountSimulatorTab } from './simulatorTab.js';
import { mountCompareSection } from './compareSection.js';
import { mountSettingsModal } from './settingsModal.js';
import { mountDetailModal } from './detailModal.js';

mountHeader(document.getElementById('topbar'));
mountTabbar(document.getElementById('tabbar'));

mountSimulatorTab(document.getElementById('tab-simulator'));
mountCompareSection(document.getElementById('tab-compare'));

mountSettingsModal(document.getElementById('settings-modal'));
mountDetailModal(document.getElementById('detail-modal'));

// Block double-tap zoom on iPad
let lastTouch = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTouch < 300) e.preventDefault();
  lastTouch = now;
}, { passive: false });
