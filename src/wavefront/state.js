// Shared reactive state — single source of truth across all sections.
// Section 1 (playground) edits this directly.
// Section 2 (A↔B compare) inherits Rx + may override grade/add/corridor per side.
// Section 3 (sweep) uses this as the BASE config; sweep replaces one variable.

const subscribers = new Set();

// RAF batching for subscribers — multiple update() calls within the same JS
// tick (e.g., sync-eyes patch that updates OD then OS sequentially, or
// multi-field state changes from a single user action) fire subscribers
// only ONCE per animation frame. On iPad this halves the rendering work for
// common interaction patterns.
let _rafScheduled = false;
function _flushSubscribers() {
  _rafScheduled = false;
  subscribers.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
}
function _scheduleNotify() {
  if (_rafScheduled) return;
  _rafScheduled = true;
  requestAnimationFrame(_flushSubscribers);
}

const initial = {
  // Lens config (used by Section 1; Section 2/3 may override locally)
  grade: 3,
  add: 2.0,
  corridor: 12,
  threshold: 0.25,        // locked to 0.25D steps (slider step=0.25)

  // Display options — iso contours ON by default. The contours are now
  // color/width/style coded (cyan→emerald→orange→coral, thin→thick) so
  // they actively communicate severity zones to the customer rather than
  // being an opticians-only analytical layer.
  showIso: true,
  showBands: true,
  // Progressive lens manufacturing markings (DRP / FC / PRP / corridor dots /
  // NRP / side alignment marks / ADD label). OFF by default — used as an
  // in-house training overlay so staff learn what each engraving means.
  showMarkings: false,
  syncEyes: true,
  environment: 'driving',  // single env ('driving' id retained for compat — content is office scene)

  // iPad tab navigation
  activeTab: 'simulator', // 'simulator' | 'compare'
  settingsOpen: false,

  // Prescription — shared across all sections (same patient)
  od: { sphere: -2.00, cylinder: 0, axis: 0 },
  os: { sphere: -2.00, cylinder: 0, axis: 0 },
};

export const state = JSON.parse(JSON.stringify(initial));

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function update(patch) {
  applyPatch(state, patch);
  _scheduleNotify();
}

export function reset() {
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, JSON.parse(JSON.stringify(initial)));
  _scheduleNotify();
}

function applyPatch(target, patch) {
  for (const k in patch) {
    const v = patch[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {};
      applyPatch(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

// Helper to read just the prescription for a given eye.
export function getRx(eye) {
  return JSON.parse(JSON.stringify(state[eye === 'OS' ? 'os' : 'od']));
}
