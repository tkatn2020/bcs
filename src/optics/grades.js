// Grade tier model — calibrated for perceived wearer experience.
// Note: Minkwitz theorem makes peripheral cyl mathematically unavoidable on
// any progressive surface. Even premium designs only redistribute it. Hence
// the visualization deliberately keeps BP50 with visible (just smaller)
// soft zones rather than showing it as "perfect".
//
// BP10:BP50 ratio for cylReductionFactor is ~2:1 (BP50 has half the peak
// peripheral cyl of BP10). clearZoneScale spans 0.95–1.30 so BP10 has
// noticeably tighter clear corridors and BP50 has wider but not unrealistic
// ones. Numbers are tuned for perceptual response, not raw lens-design specs.
export const GRADES = [
  {
    id: 1,
    name: '일반형',
    bpCode: 'BP10',
    nameEn: 'Conventional Spherical',
    description: '입문 등급. 구면 전면 설계로 주변부 비점수차가 가장 큼.',
    cylReductionFactor: 1.05,   // baseline — slight emphasis
    clearZoneScale: 0.95,       // tighter clear zones, more soft-zone area
    adaptation: '어려움',
    priceLevel: '$',
  },
  {
    id: 2,
    name: '비구면형',
    bpCode: 'BP20',
    nameEn: 'Aspheric',
    description: '전면 비구면. 가장자리 수차 약 15% 개선.',
    cylReductionFactor: 0.90,
    clearZoneScale: 1.05,
    adaptation: '보통',
    priceLevel: '$$',
  },
  {
    id: 3,
    name: '프리폼 표준',
    bpCode: 'BP30',
    nameEn: 'Free-form Standard',
    description: '후면 디지털 프리폼. 광역 최적화로 약 25% 개선.',
    cylReductionFactor: 0.78,
    clearZoneScale: 1.15,
    adaptation: '쉬움',
    priceLevel: '$$$',
  },
  {
    id: 4,
    name: '프리폼 개인맞춤',
    bpCode: 'BP40',
    nameEn: 'Free-form Individualized',
    description: 'PD·정점간거리·앞기울기 반영. 약 38% 개선.',
    cylReductionFactor: 0.65,
    clearZoneScale: 1.22,
    adaptation: '매우 쉬움',
    priceLevel: '$$$$',
  },
  {
    id: 5,
    name: 'AI듀얼',
    bpCode: 'BP50',
    nameEn: 'AI Dual-surface',
    description: '안구회전 모델 양면 프리폼 최상위. BP10 대비 약 50% 개선 (왜곡 잔존).',
    cylReductionFactor: 0.55,   // ~half of BP10 — never zero (Minkwitz)
    clearZoneScale: 1.30,       // widened clear zones but realistic
    adaptation: '매우 쉬움',
    priceLevel: '$$$$$',
  },
];

// Display label format: "{id}단계 {name} {bpCode}", e.g. "1단계 일반형 BP10"
export function gradeLabel(g) {
  return `${g.id}단계 ${g.name} ${g.bpCode}`;
}

export function getGrade(id) {
  return GRADES.find(g => g.id === id) ?? GRADES[2];
}
