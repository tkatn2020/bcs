// v3 초년차 튜토리얼 — 진행 엔진 (상태 머신 · 판정 · 3단계 힌트 · 진도)
//
// 흐름: idle → intro → demo → practice → done            (문제형)
//       idle → diagnose → revealed → practice → done      (증상형; quizOnly는 revealed→done)
//
// 원칙:
// - 모든 세팅은 ctrl.applyControl(컨트롤 경로) 경유 — 사용자 조작과 동일 경로라
//   라이트스루가 자동 적용되고 모순 상태가 안 생긴다(tutorialCases.js 헤더).
// - 시퀀스는 취소 토큰 기반(setTimeout 체인) — 케이스 전환·그만두기 시 즉시 중단
//   (demoDirector의 restore 규율과 동일).
// - 감별(진단) 단계에선 우측 패널을 블러 처리 — 슬라이더 값이 보이면 감별이
//   자명해진다. 3D·HUD 관찰로만 추론하게 한다.

import { state, subscribe, update } from '../wavefront/state.js';
import { computeZones, STANDARD_FIT } from './fittingModel.js';
import { CASES, shouldHidePanel } from './tutorialCases.js';
import { CAM_PRESETS } from './controls.js';

const LS_KEY = 'bcs-tutorial-v1';

export function createTutorialDirector({ ctrl, getDemo, getMulti, cap, stage, getGlasses } = {}) {
  let phase = 'idle';           // idle | intro | demo | diagnose | revealed | practice | done
  let cur = null;               // 현재 케이스
  let curCause = null;          // 증상형: 몰래 세팅된 원인 / quizOnly: 정답 선택지
  let hintLevel = 0;
  let wrongPicks = 0;
  let judging = true;           // 힌트③ 정답 시연 중엔 false — 시연이 통과로 처리되면 안 됨
  let seq = 0;                  // 취소 토큰 — 증가하면 진행 중 시퀀스 전부 무효
  const lastCause = {};         // caseId → 직전 원인 id (재시작 시 다른 원인 우선)
  const listeners = new Set();

  const say = (t) => { if (cap) cap(t); };
  const notify = () => {
    syncLocks();
    listeners.forEach((fn) => { try { fn(); } catch { /* UI 오류가 진행을 못 막게 */ } });
  };

  // ── 진도 (localStorage — 공용 PC는 '진도 초기화'로 해결) ──
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(LS_KEY))?.done || {}; } catch { return {}; }
  }
  let done = loadProgress();
  const saveProgress = () => { try { localStorage.setItem(LS_KEY, JSON.stringify({ done })); } catch { /* 시크릿 모드 등 */ } };

  // ── 세팅 적용 ──
  function applyStep(s) {
    if (s.kind === 'pushup') { document.querySelector('[data-pushup]')?.click(); return; }
    ctrl.applyControl(s.kind, s.key, s.value);
  }
  const applySteps = (steps) => (steps || []).forEach(applyStep);

  function applyCam(id) {
    const c = CAM_PRESETS.find((x) => x.id === id);
    if (!c || !stage) return;
    stage.controls.autoRotate = false;
    stage.camera.position.set(...c.pos);
    stage.controls.target.set(...c.tgt);
  }

  // 존 토글은 컨트롤 경로가 없어 state 직접 — 표시 전용이라 라이트스루 무관.
  function setZones(list) {
    const zones = { distance: false, intermediate: false, near: false };
    (list || []).forEach((z) => { zones[z] = true; });
    update({ v3view: { zones } });
  }

  // ── 진단 중 우측 패널 가림 ──
  function hidePanel(on) {
    const el = document.querySelector('.v3-panel');
    if (!el) return;
    el.style.filter = on ? 'blur(7px)' : '';
    el.style.pointerEvents = on ? 'none' : '';
    el.style.userSelect = on ? 'none' : '';
  }

  // ── 진행 중 잠금 동기화 (notify마다 1곳에서 처리) ──
  // · 리셋/프리셋: 실습 목표가 대부분 "표준 복귀"라 전체 복귀 클릭이 곧 치팅 통과가
  //   되고, 프리셋 로드는 케이스 상태를 통째로 깨뜨린다 → 튜토리얼 중 잠금.
  //   단 '안경 밀어 올리기'(P12·S6의 정답 동작)는 살려둔다.
  // · 시연(demo) 중엔 우측 패널도 잠금(블러 없이) — 시연과 손조작이 겹치면 혼선.
  function syncLocks() {
    const running = phase !== 'idle';
    const lock = (el, on) => { if (el) { el.style.pointerEvents = on ? 'none' : ''; el.style.opacity = on ? '0.4' : ''; } };
    lock(document.querySelector('[data-resetall]'), running);
    lock(document.querySelector('.v3-presetbar'), running);
    lock(document.querySelector('[data-demo]'), running);   // 시선 데모 — 판정과 겹치면 혼선
    const panel = document.querySelector('.v3-panel');
    if (panel && !panel.style.filter) panel.style.pointerEvents = (phase === 'demo') ? 'none' : '';
  }

  // ── 문제 상태 세팅(리셋 → set → 존·카메라) ──
  function applyBroken(steps) {
    applyStep({ kind: 'reset' });
    applySteps(steps);
    setZones(cur.zones);
    applyCam(cur.cam);
  }

  // ── 판정 ──
  function goalVal(g) {
    const fit = { ...STANDARD_FIT, ...(state.v3fit || {}) };
    const nsObj = (ns) => (ns === 'fit' ? fit : ns === 'frame' ? state.v3frame : state.v3head);
    if (g.ns) return Math.abs(nsObj(g.ns)[g.key] - g.target) <= g.tol;
    if (g.effR) {
      const o = nsObj(g.effR.ns);
      const v = o[`${g.effR.key}Asym`] ? (o[`${g.effR.key}_R`] ?? o[g.effR.key]) : o[g.effR.key];
      return Math.abs(v - g.target) <= g.tol;
    }
    if (g.diffEff) {
      const o = nsObj(g.diffEff.ns);
      const r = o[`${g.diffEff.key}Asym`] ? (o[`${g.diffEff.key}_R`] ?? o[g.diffEff.key]) : o[g.diffEff.key];
      return Math.abs(o[g.diffEff.key] - r) <= g.max;
    }
    if (g.roll !== undefined) {
      let maxRoll = 0;
      getGlasses?.()?.group?.traverse((o) => {
        if (o.isGroup && Math.abs(o.rotation.z) > maxRoll) maxRoll = Math.abs(o.rotation.z);
      });
      return (maxRoll * 180) / Math.PI <= g.roll;
    }
    if (g.decAbs !== undefined) {
      const spec = computeZones({ grade: state.grade, add: state.add, corridor: state.corridor, v3fit: state.v3fit });
      return Math.abs(spec.decMm) <= g.decAbs;
    }
    if (g.corridor !== undefined) return state.corridor === g.corridor;
    if (g.slip !== undefined) return (fit.slip || 0) <= g.slip;
    return false;
  }

  const activeGoal = () => (cur?.kind === 'symptom' ? curCause?.goal : cur?.goal);
  const activeFix = () => (cur?.kind === 'symptom' ? curCause?.fix : cur?.fix);
  const activeHints = () => (cur?.kind === 'symptom' ? curCause?.hints : cur?.hints) || [];
  const activeExplain = () => (cur?.kind === 'symptom' ? curCause?.explain : cur?.explain);

  subscribe(() => {
    if (phase !== 'practice' || !cur || !judging) return;
    const goals = activeGoal();
    if (goals?.length && goals.every(goalVal)) {
      phase = 'done';
      done[cur.id] = true;
      saveProgress();
      say(`통과! ${cur.title} — 교정 완료. 실무에서도 이 순서로: 관찰 → 원인 → 교정 → 재확인.`);
      notify();
    }
  });

  // ── 시퀀스(취소 가능 sleep) ──
  const sleep = (ms, tok) => new Promise((r) => setTimeout(() => tok === seq && r(), ms));
  const alive = (tok) => tok === seq;

  // ── 공개 동작 ──
  function start(caseId) {
    const c = CASES.find((x) => x.id === caseId);
    if (!c) return;
    seq++;
    getDemo?.()?.playing && getDemo().stop();
    getMulti?.()?.isOpen && getMulti().close();
    cur = c; hintLevel = 0; wrongPicks = 0; curCause = null;

    if (c.kind === 'problem') {
      phase = 'intro';
      applyBroken(c.set);
      say(c.intro);
    } else {
      // 증상형: 원인 랜덤(직전과 다른 것 우선) 몰래 세팅 + 패널 가림
      if (c.quizOnly) {
        curCause = null;
        applyBroken(c.set);
      } else {
        const pool = c.causes.filter((x) => x.id !== lastCause[c.id]);
        curCause = (pool.length ? pool : c.causes)[Math.floor(Math.random() * (pool.length ? pool.length : c.causes.length))];
        lastCause[c.id] = curCause.id;
        applyBroken(curCause.set);
      }
      phase = 'diagnose';
      if (shouldHidePanel(c)) hidePanel(true);
      say(`고객: "${c.customer}" — ${c.intro}`);
    }
    notify();
  }

  async function runDemo() {
    if (!cur || cur.kind !== 'problem') return;
    const tok = ++seq;
    phase = 'demo'; notify();
    say('잘못된 상태를 관찰하세요…');
    await sleep(cur.observeMs || 2200, tok); if (!alive(tok)) return;
    say(cur.explain);
    await sleep(3200, tok); if (!alive(tok)) return;
    say('이제 교정합니다 — 어떤 값이 어떻게 움직이는지 보세요.');
    for (const s of cur.fix) {
      await sleep(1100, tok); if (!alive(tok)) return;
      applyStep(s);
    }
    await sleep(1400, tok); if (!alive(tok)) return;
    say('회복 확인 — HUD가 표준으로 돌아왔습니다. 이제 직접 해보세요.');
    phase = 'demoDone'; notify();
  }

  function startPractice() {
    if (!cur) return;
    seq++;
    hintLevel = 0;
    applyBroken(cur.kind === 'symptom' ? curCause.set : cur.set);
    hidePanel(false);
    phase = 'practice';
    say('직접 교정해 보세요 — 목표 범위에 들어오면 자동으로 통과 처리됩니다.');
    notify();
  }

  function pickCause(causeId) {
    if (phase !== 'diagnose' || !cur) return;
    const picked = cur.causes.find((x) => x.id === causeId);
    if (!picked) return;
    if (cur.quizOnly) {
      say(picked.explain);
      if (picked.isAnswer) {
        curCause = picked;   // done 화면의 해설(explainText)이 정답 해설을 가리키게
        phase = 'done'; done[cur.id] = true; saveProgress();
      } else { wrongPicks++; }
      notify();
      return;
    }
    if (picked.id === curCause.id) {
      hidePanel(false);
      phase = 'revealed';
      say(picked.explain);
    } else {
      wrongPicks++;
      say('그 원인의 흔적이 보이지 않습니다 — 3D 자세와 HUD 수치를 다시 관찰하세요. (오답도 학습입니다)');
    }
    notify();
  }

  async function hint() {
    if (phase !== 'practice' || !cur) return;
    const [h1, ctrlKey] = activeHints();
    hintLevel = Math.min(hintLevel + 1, 3);
    notify();
    if (hintLevel === 1) { say(`힌트 ①: ${h1}`); return; }
    if (hintLevel === 2) {
      if (ctrlKey) {
        window.dispatchEvent(new CustomEvent('v3:flash-control', { detail: { ctrl: ctrlKey } }));
        say('힌트 ②: 방금 빛난 조절 행이 교정 지점입니다.');
      } else {
        say('힌트 ②: 이 케이스는 슬라이더가 아니라 하단 렌즈 설계(누진대) 영역입니다.');
      }
      return;
    }
    // 힌트 ③: 정답 시연 후 문제 상태로 되돌림 — 마지막은 학습자 손으로.
    // 시연 동안 판정 정지(judging) — 시연이 스스로 통과 처리되면 안 된다.
    const tok = ++seq;
    judging = false;
    say('힌트 ③: 정답을 시연합니다 — 잘 보고 그대로 따라하세요.');
    await sleep(1200, tok);
    if (alive(tok)) {
      for (const s of activeFix()) {
        applyStep(s);
        await sleep(900, tok); if (!alive(tok)) break;
      }
    }
    if (alive(tok)) {
      await sleep(1600, tok);
      if (alive(tok)) {
        applyBroken(cur.kind === 'symptom' ? curCause.set : cur.set);
        say('문제 상태로 되돌렸습니다 — 이제 직접.');
      }
    }
    judging = true;
  }

  function quit() {
    seq++;
    hidePanel(false);
    if (phase !== 'idle') {
      applyStep({ kind: 'reset' });
      say('튜토리얼 종료 — 표준 피팅으로 복귀했습니다.');
    }
    phase = 'idle'; cur = null; curCause = null; hintLevel = 0;
    notify();
  }

  function resetProgress() { done = {}; saveProgress(); notify(); }

  return {
    cases: CASES,
    start, runDemo, startPractice, pickCause, hint, quit, resetProgress,
    get phase() { return phase; },
    get current() { return cur; },
    get currentCause() { return curCause; },
    get hintLevel() { return hintLevel; },
    get wrongPicks() { return wrongPicks; },
    get progress() { return done; },
    explainText: activeExplain,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { seq++; hidePanel(false); listeners.clear(); },
  };
}
