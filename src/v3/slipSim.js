// v3 Slip simulation — 고개 숙임 × 귀 고정력 × 코받침 지지의 흘러내림 동역학.
//
// B-6(2026-07-25 감사)의 완전 구현: 귀팁각·귀모임각은 안경을 제자리에 붙잡는
// 고정력(retention)인데, 고개를 숙였을 때 그 고정력이 수요(중력)보다 작으면
// 안경이 천천히 콧등을 타고 흘러내린다. 코받침은 쐐기 지지로 이를 받친다.
//
// 아키텍처: 흘러내림 = 프레임이 아래·앞으로 이동 = OH↓·VD↑. 라이트스루 원칙
// 그대로 **실제 장부(v3fit.oh/vd)를 이동**시킨다 — 슬라이더가 눈앞에서 움직이며
// 광학 성능이 실시간으로 나빠지는 게 곧 교육이다. 누적 슬립량은 v3fit.slip(mm)에
// 별도 기록하되 광학은 이를 읽지 않는다(코받침 평형·밀어올리기 복원·캡션 전용).
//
// ⚠️ 왕복 잔차 0 보장: 슬립을 0.1mm 양자로만 장부에 반영한다 —
//   0.1×0.8=0.08, 0.1×0.5=0.05 둘 다 0.01 단위 정확이라 누적·역산에 반올림
//   오차가 없다(밀어올리기 = slip×계수 역산이 비트 정확).

import { state, update } from '../wavefront/state.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round2 = (x) => Math.round(x * 100) / 100;

// ── 물리 상수 (교육용 준정량 — 임계값은 plan 표 참조) ──
const SLIP_OH = 0.8;        // 슬립 1mm당 OH −0.8mm (콧등 경사 근사)
const SLIP_VD = 0.5;        // 슬립 1mm당 VD +0.5mm
const QUANTUM = 0.1;        // 장부 반영 양자 (mm) — 왕복 정확성의 핵심
const S_MAX = 8;            // 최대 슬립(코끝) mm
const START_PITCH = 5;      // 이하 숙임은 무시 (시선 데모 최대 4.5° — 미발동 보장)
const SPEED = 1.8;          // 최대 슬립 속도 mm/s ("천천히")

// 수요: 고개 숙임이 클수록 중력이 프레임을 밀어낸다. 핸들 최대 28°에서 ≈1.49.
const demand = (pitch) => clamp(pitch / 30, 0, 1) * 1.6;
// 귀팁각 그립: 118°(표준)=1 → 150°+=0 (펼수록 걸리는 데가 없다)
const gripTip = (tip) => clamp((150 - tip) / 32, 0, 1);
// 귀모임각 계수: 0°=1, −25°(벌어짐)=0.4 = 그립 60% 감쇠, +25°=1.6 강화
const convF = (conv) => clamp(1 + conv * 0.024, 0.4, 1.6);

// 저항: 귀 그립(좌우 평균 — 한쪽만 풀려도 절반은 버팀) + 코받침 지지.
function resistance(fr, slip) {
  const tipR = fr.earTipAngleAsym ? (fr.earTipAngle_R ?? fr.earTipAngle) : fr.earTipAngle;
  const convR = fr.earConvergeAsym ? (fr.earConverge_R ?? fr.earConverge) : fr.earConverge;
  const earL = gripTip(fr.earTipAngle ?? 118) * convF(fr.earConverge ?? 0);
  const earR = gripTip(tipR ?? 118) * convF(convR ?? 0);
  const rEar = 1.6 * (earL + earR) / 2;
  // 코받침: 간격 좁힘(쐐기 압박)·상하 하향이 지지를 키우고, 넓히면 소실.
  // 흘러내릴수록 패드가 코의 넓은 부분에 닿아 지지 증가(쐐기 효과) = 정지 지점.
  const padBase = fr.padOn
    ? clamp(0.5 - (fr.padSpacing ?? 0) * 0.25 + Math.max(0, -(fr.padVertical ?? 0)) * 0.1, 0, 2.5)
    : 0;
  const rPad = fr.padOn ? padBase + slip * 0.2 : 0;
  return { rEar, rPad, padOn: !!fr.padOn };
}

export function createSlipSim({ cap } = {}) {
  let alive = true;
  let slipF = state.v3fit?.slip || 0;   // 내부 연속 적분값 (장부는 0.1mm 양자)
  let phase = 'idle';                    // idle | slipping | stopped
  let lastT = 0;

  const say = (t) => { if (cap) cap(t); };

  function frame(t) {
    if (!alive) return;
    requestAnimationFrame(frame);
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0;   // 탭 복귀 점프 가드
    lastT = t;

    const f = state.v3fit || {};
    const slipState = f.slip || 0;
    // 외부 리셋/프리셋/밀어올리기가 장부 slip을 바꿨으면 내부 적분값 동기화
    if (Math.abs(slipF - slipState) > QUANTUM) slipF = slipState;

    const pitch = f.headPitch || 0;
    if (pitch <= START_PITCH && slipState === 0) { phase = 'idle'; return; }   // 조기 반환

    const D = demand(pitch);
    const { rEar, rPad, padOn } = resistance(state.v3frame || {}, slipF);
    const deficit = D - rEar - rPad;

    // 실효 정지 임계: 코받침 쐐기 평형은 점근적(deficit가 0에 닿지 않고 무한히
    // 느려짐)이라, 속도가 0.11mm/s 미만(deficit < 0.06)이면 멈춘 것으로 판정하고
    // 적분도 중단한다 — 안 그러면 "받쳐 멈춤" 캡션이 영영 안 뜬다.
    const STOP_EPS = 0.06;
    if (deficit > STOP_EPS && slipF < S_MAX && dt > 0) {
      slipF = Math.min(S_MAX, slipF + SPEED * clamp(deficit, 0, 1) * dt);
      if (phase !== 'slipping') { phase = 'slipping'; say('안경이 흘러내립니다… (귀 고정력 부족)'); }
    } else if (phase === 'slipping' && (deficit <= STOP_EPS || slipF >= S_MAX)) {
      phase = 'stopped';
      if (slipF >= S_MAX) say(`코받침 지지 없음 — 코끝(${S_MAX}mm)까지 흘러내렸습니다`);
      else if (pitch > START_PITCH && padOn) say(`코받침이 받쳐 ${slipState.toFixed(1)}mm에서 멈췄습니다`);
      // 고개를 들어 멈춘 경우는 조용히 (흘러내린 상태는 유지 — 실제 안경과 동일)
    }

    // 장부 반영: 0.1mm 양자 단위로만 (왕복 정확성). +1e-6 = 부동소수 경계 가드
    // (8−7.9=0.0999…이 floor에 걸려 마지막 양자가 영영 안 실리는 것 방지)
    const quanta = Math.floor((slipF - slipState) / QUANTUM + 1e-6);
    if (quanta >= 1) {
      const ds = quanta * QUANTUM;
      update({ v3fit: {
        slip: round2(slipState + ds),
        oh: round2((f.oh ?? 0) - ds * SLIP_OH),
        vd: round2((f.vd ?? 12) + ds * SLIP_VD),
      } });
    }
  }
  requestAnimationFrame(frame);

  return { dispose() { alive = false; } };
}

// 안경 밀어 올리기 — 흘러내린 만큼을 정확 역산해 원위치(잔차 0).
// 슬립은 0.1mm 양자로만 쌓였으므로 slip×0.8/×0.5가 항상 0.01 단위 정확.
export function pushUpGlasses() {
  const f = state.v3fit || {};
  const slip = f.slip || 0;
  if (slip <= 0) return;
  update({ v3fit: {
    slip: 0,
    oh: round2((f.oh ?? 0) + slip * SLIP_OH),
    vd: round2((f.vd ?? 12) - slip * SLIP_VD),
  } });
}
