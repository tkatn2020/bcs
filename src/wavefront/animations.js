// Animation utilities — count-up, value-tween, raf scheduling.
//
// Used by: ratioPanel.js (score animation), lensBox.js (heatmap morph),
//          simulatorTab.js + compareSection.js (transitions).

const EASE_OUT_QUART = t => 1 - Math.pow(1 - t, 4);

// Animate a numeric value from `from` → `to` over `ms`. Calls `onUpdate(v)`
// on each frame and `onDone(v)` once at the end. Returns a `cancel()` fn.
export function tween(from, to, ms, onUpdate, onDone, ease = EASE_OUT_QUART) {
  if (ms <= 0 || from === to) {
    onUpdate(to);
    if (onDone) onDone(to);
    return () => {};
  }
  let startTs = 0;
  let raf = 0;
  let cancelled = false;
  function frame(ts) {
    if (cancelled) return;
    if (!startTs) startTs = ts;
    const t = Math.min(1, (ts - startTs) / ms);
    const v = from + (to - from) * ease(t);
    onUpdate(v);
    if (t < 1) raf = requestAnimationFrame(frame);
    else if (onDone) onDone(to);
  }
  raf = requestAnimationFrame(frame);
  return () => { cancelled = true; cancelAnimationFrame(raf); };
}

// Per-element count-up. Reuses any in-flight tween on the same element.
const ANIM_REGISTRY = new WeakMap();

export function countUp(el, toValue, opts = {}) {
  const {
    duration = 280,         // was 480 — shorter feels snappier on iPad without sacrificing the count-up effect
    decimals = 0,
    suffix = '',
    formatter = null,
    onImprove = null,
  } = opts;
  if (!el) return;
  const prev = ANIM_REGISTRY.get(el);
  if (prev) prev.cancel();
  const fromValue = prev ? prev.target : (parseFloat(el.dataset.value) || 0);
  if (toValue > fromValue + 0.4 && onImprove) onImprove();
  const fmt = (v) => {
    if (formatter) return formatter(v);
    return v.toFixed(decimals) + suffix;
  };
  const cancel = tween(fromValue, toValue, duration, (v) => {
    el.textContent = fmt(v);
  }, () => {
    el.dataset.value = String(toValue);
    el.textContent = fmt(toValue);
    ANIM_REGISTRY.delete(el);
  });
  ANIM_REGISTRY.set(el, { target: toValue, cancel });
}

// Trigger a one-shot CSS class animation (e.g. glow pulse).
export function pulseClass(el, className, ms = 800) {
  if (!el) return;
  el.classList.remove(className);
  // Force reflow so re-add restarts the keyframe
  void el.offsetWidth;
  el.classList.add(className);
  setTimeout(() => el.classList.remove(className), ms);
}
