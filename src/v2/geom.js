// Shared geom helper — used by all v2 modules so they don't re-implement
// the eye-specific geometry construction from state.

import { getGeom } from '../wavefront/helpers.js';

export function geomFor(s, eye) {
  const rx = eye === 'OS' ? s.os : s.od;
  return getGeom({
    grade: s.grade, corridorLength: s.corridor, add: s.add,
    sphere: rx.sphere, cylinder: rx.cylinder, axis: rx.axis, eye,
  });
}
