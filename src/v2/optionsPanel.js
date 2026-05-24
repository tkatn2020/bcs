// 🅞 Options panel — interactive lens purchase configuration.
//
// - Refractive index display (auto from sphere, read-only)
// - 착색 checkbox (+0)
// - 보호 radio: 자외선 ∣ 블루라이트 (both +0)
// - 시그니처 GENS checkbox (+150,000) → conditional 베이스컬러 dropdown
// - Total price for currently SELECTED grade (recomputed reactively)
//
// All option mutations route through state.update(), so the recommender
// tier prices re-render via its own subscribe(refresh) listener.

import { state, update, subscribe } from '../wavefront/state.js';
import { getGrade } from '../optics/grades.js';
import { refractiveIndexFor, totalPriceFor, formatPrice } from '../optics/pricing.js';

const BASE_COLORS = ['BROWN', 'GRAY', 'GREEN'];

export function mountOptionsPanel(root) {
  const el = document.createElement('div');
  el.className = 'options-card';
  el.innerHTML = `
    <div class="options-h">
      <div class="options-h-l">렌즈 옵션</div>
      <div class="options-h-mono">Options</div>
    </div>

    <div class="options-row">
      <div class="options-label">굴절률</div>
      <div class="options-ri-badge">
        <span class="options-ri-num" data-role="ri">1.60</span>
        <span class="options-ri-cap" data-role="ri-cap">S −2.00 기준</span>
      </div>
    </div>

    <div class="options-row">
      <div class="options-label">착색</div>
      <label class="options-toggle">
        <input type="checkbox" data-role="tint">
        <span class="options-toggle-track"></span>
        <span class="options-toggle-label">+0원</span>
      </label>
    </div>

    <div class="options-row">
      <div class="options-label">보호</div>
      <div class="options-segmented" data-role="protection-group">
        <button class="options-seg" data-protection="uv">자외선</button>
        <button class="options-seg" data-protection="blue">블루라이트</button>
      </div>
    </div>

    <div class="options-row">
      <div class="options-label">시그니처 GENS</div>
      <label class="options-toggle">
        <input type="checkbox" data-role="signature">
        <span class="options-toggle-track"></span>
        <span class="options-toggle-label">+150,000원</span>
      </label>
    </div>

    <div class="options-row options-row-color" data-role="color-row" style="display:none">
      <div class="options-label">베이스컬러</div>
      <select class="options-select" data-role="base-color">
        ${BASE_COLORS.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>

    <div class="options-divider"></div>

    <div class="options-total">
      <div class="options-total-l">
        <span class="options-total-cap">선택 등급</span>
        <span class="options-total-grade" data-role="total-grade">BP30</span>
      </div>
      <div class="options-total-r">
        <span class="options-total-num" data-role="total-price">0</span>
        <span class="options-total-suffix">원</span>
      </div>
    </div>
  `;
  root.appendChild(el);

  const refs = {};
  el.querySelectorAll('[data-role]').forEach(n => { refs[n.dataset.role] = n; });

  // ── Event wiring ─────────────────────────────────────────────────
  refs.tint.addEventListener('change', () => {
    update({ tint: refs.tint.checked });
  });

  el.querySelectorAll('[data-protection]').forEach(btn => {
    btn.addEventListener('click', () => {
      update({ protection: btn.dataset.protection });
    });
  });

  refs.signature.addEventListener('change', () => {
    update({ signatureGens: refs.signature.checked });
  });

  refs['base-color'].addEventListener('change', () => {
    update({ baseColor: refs['base-color'].value });
  });

  // ── Reactive refresh ────────────────────────────────────────────
  function refresh(s) {
    // Refractive index + sphere reference label
    const ri = refractiveIndexFor(s.od.sphere, s.os.sphere);
    refs.ri.textContent = ri.toFixed(2);
    const sBigger = Math.abs(s.od.sphere) >= Math.abs(s.os.sphere) ? s.od.sphere : s.os.sphere;
    const sStr = `S ${sBigger >= 0 ? '+' : '−'}${Math.abs(sBigger).toFixed(2)}`;
    refs['ri-cap'].textContent = `${sStr} 기준`;

    // Tint
    if (refs.tint.checked !== s.tint) refs.tint.checked = !!s.tint;

    // Protection segmented
    el.querySelectorAll('[data-protection]').forEach(btn => {
      btn.dataset.active = (btn.dataset.protection === s.protection) ? 'true' : 'false';
    });

    // Signature GENS + conditional base color
    if (refs.signature.checked !== s.signatureGens) refs.signature.checked = !!s.signatureGens;
    refs['color-row'].style.display = s.signatureGens ? '' : 'none';
    if (refs['base-color'].value !== s.baseColor) refs['base-color'].value = s.baseColor;

    // Selected grade total
    const g = getGrade(s.grade);
    refs['total-grade'].textContent = g.bpCode;
    const total = totalPriceFor(s.grade, ri, { signatureGens: s.signatureGens });
    refs['total-price'].textContent = formatPrice(total);
  }

  refresh(state);
  subscribe(refresh);

  return { el };
}
