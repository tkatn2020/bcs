// 🅟 Lens pricing — refractive index auto-determined from sphere, base
// price table per (index × grade), and option pricing (currently only
// 시그니처 GENS adds cost; tint and protection are bundled free).

// Refractive index determined by the LARGER of |OD.sphere| and |OS.sphere|.
// Threshold rule mirrors industry standard for high-index lens selection.
//   |S_eff| ≤ 1.00  → 1.50 (standard CR-39)
//   |S_eff| ≤ 4.00  → 1.60 (mid-index)
//   |S_eff| > 4.00  → 1.67 (high-index)
// Sign-agnostic — applies to both myopia and hyperopia.
export function refractiveIndexFor(odSphere, osSphere) {
  const sEff = Math.max(Math.abs(odSphere ?? 0), Math.abs(osSphere ?? 0));
  if (sEff <= 1.00) return 1.50;
  if (sEff <= 4.00) return 1.60;
  return 1.67;
}

// Base price table — indexed by [refractiveIndex][gradeId-1].
// Source: 매장 운영 가격표 (BP10 / BP20 / BP30 / BP40 / BP50).
const BASE_PRICES = {
  1.50: [150000, 250000, 350000, 500000,  900000],
  1.60: [200000, 300000, 400000, 600000, 1000000],
  1.67: [270000, 370000, 470000, 700000, 1100000],
};

export function basePriceFor(gradeId, refractiveIndex) {
  return BASE_PRICES[refractiveIndex]?.[gradeId - 1] ?? 0;
}

// Option pricing — currently only 시그니처 GENS adds cost.
// 착색·자외선·블루라이트는 등급 무관 무료(번들).
export const OPTION_PRICES = {
  tint: 0,
  protectionUv: 0,
  protectionBlue: 0,
  signatureGens: 150000,
};

export function totalPriceFor(gradeId, refractiveIndex, options = {}) {
  let total = basePriceFor(gradeId, refractiveIndex);
  if (options.signatureGens) total += OPTION_PRICES.signatureGens;
  return total;
}

// 1,234,567 형식 (한국식 천단위 구분).
export function formatPrice(n) {
  return new Intl.NumberFormat('ko-KR').format(n);
}
