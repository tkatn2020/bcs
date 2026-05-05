// Bootstrap — wires up the iPad layout: top bar, tab bar, and 4 tab panels.

import { mountTabbar } from './tabbar.js';
import { mountHeader } from './header.js';
import { mountInputTab } from './inputTab.js';
import { mountSimulatorTab } from './simulatorTab.js';
import { mountCompareSection } from './compareSection.js';
import { mountSettingsModal } from './settingsModal.js';

mountHeader(document.getElementById('topbar'));
mountTabbar(document.getElementById('tabbar'));

mountInputTab(document.getElementById('tab-input'));
mountSimulatorTab(document.getElementById('tab-simulator'));
mountCompareSection(document.getElementById('tab-compare'));

mountSettingsModal(document.getElementById('settings-modal'));

// Block double-tap zoom on iPad
let lastTouch = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTouch < 300) e.preventDefault();
  lastTouch = now;
}, { passive: false });
