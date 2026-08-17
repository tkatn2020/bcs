// v3 초년차 튜토리얼 — 좌측 카드 UI (목록 / 진행 화면)
//
// 배치: 좌상단 진입 버튼(🎓) + 그 아래 카드. 3D 중앙과 좌하단 HUD를 가리지 않는
// 좌측 상단 영역만 사용, 멀티뷰 팝업과는 상호 배타(app.js에서 배선).
// 시각 언어는 controls.js가 주입한 .v3-btn/.v3-sec 등을 재사용.

const CSS = `
  .v3-tutbtn { position: fixed; left: 14px; top: 14px; z-index: 11;
    padding: 9px 13px; border-radius: 11px; border: 1px solid rgba(245,182,78,0.55);
    background: rgba(16,19,26,0.78); backdrop-filter: blur(10px); color: #f5b64e;
    font-family: 'Pretendard', system-ui, sans-serif; font-size: 12.5px; font-weight: 800;
    cursor: pointer; user-select: none; }
  .v3-tutbtn.on { background: #f5b64e; color: #10131a; }
  .v3-tutcard { position: fixed; left: 14px; top: 58px; z-index: 11; width: 306px;
    max-height: calc(100vh - 470px); overflow-y: auto; scrollbar-gutter: stable;
    padding: 13px 14px; border-radius: 14px;
    background: rgba(16,19,26,0.82); backdrop-filter: blur(10px);
    font-family: 'Pretendard', system-ui, sans-serif; color: #cfd6e4; user-select: none;
    display: flex; flex-direction: column; gap: 9px; }
  .v3-tut-title { font-size: 13px; font-weight: 800; color: #fff; }
  .v3-tut-desc { font-size: 11.5px; line-height: 1.55; color: #cfd6e4; }
  .v3-tut-bubble { font-size: 12px; line-height: 1.5; color: #10131a; background: #e8ecf4;
    border-radius: 12px 12px 12px 3px; padding: 9px 11px; font-weight: 600; }
  .v3-tut-row { display: flex; align-items: center; gap: 7px; padding: 6px 8px;
    border-radius: 8px; cursor: pointer; font-size: 11.5px; font-weight: 600; }
  .v3-tut-row:hover { background: rgba(255,255,255,0.07); }
  .v3-tut-row .ck { flex: 0 0 16px; text-align: center; color: #7dd490; font-weight: 800; }
  .v3-tut-row .nm { flex: 1; }
  .v3-tut-prog { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.10); overflow: hidden; }
  .v3-tut-prog > div { height: 100%; background: #f5b64e; transition: width .4s ease; }
  .v3-tut-phase { font-size: 10px; letter-spacing: .1em; font-weight: 800; color: #f5b64e; }
  .v3-tut-cause { display: block; width: 100%; text-align: left; margin-top: 6px;
    padding: 8px 10px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.16);
    background: transparent; color: #cfd6e4; font-size: 11.5px; font-weight: 700; cursor: pointer; }
  .v3-tut-cause:hover { background: rgba(255,255,255,0.08); }
  .v3-tut-cause.shake { animation: v3tshake .4s; border-color: rgba(239,68,68,0.7); }
  @keyframes v3tshake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
  .v3-tut-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .v3-tut-actions .v3-btn { flex: 1; text-align: center; }
`;

export function mountTutorial(root, director) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'v3-tutbtn';
  btn.textContent = '🎓 초년차 튜토리얼';
  root.appendChild(btn);

  const card = document.createElement('div');
  card.className = 'v3-tutcard';
  card.style.display = 'none';
  root.appendChild(card);

  let open = false;

  function setOpen(v) {
    open = v;
    btn.classList.toggle('on', open);
    card.style.display = open ? '' : 'none';
    if (!open && director.phase !== 'idle') director.quit();
    if (open) render();
  }
  btn.addEventListener('click', () => setOpen(!open));

  const esc = (s) => String(s).replace(/</g, '&lt;');
  const nextCaseId = () => director.cases.find((c) => !director.progress[c.id])?.id;

  // ── 렌더 ──
  function render() {
    const d = director;
    const doneN = d.cases.filter((c) => d.progress[c.id]).length;
    btn.textContent = doneN > 0 ? `🎓 초년차 튜토리얼 ${doneN}/${d.cases.length}` : '🎓 초년차 튜토리얼';
    if (!open) return;
    if (d.phase === 'idle') { renderList(); return; }
    renderRun();
  }

  function renderList() {
    const d = director;
    const doneN = d.cases.filter((c) => d.progress[c.id]).length;
    const row = (c) => `
      <div class="v3-tut-row" data-case="${c.id}">
        <span class="ck">${d.progress[c.id] ? '✓' : ''}</span>
        <span class="nm">${esc(c.title)}</span>
      </div>`;
    const probs = d.cases.filter((c) => c.kind === 'problem');
    const syms = d.cases.filter((c) => c.kind === 'symptom');
    card.innerHTML = `
      <div class="v3-tut-title">초년차 튜토리얼</div>
      <div class="v3-tut-desc">잘못된 피팅을 발견·교정하고, 고객 호소에서 원인을 감별하는 훈련입니다. 케이스를 선택하세요.</div>
      <div class="v3-tut-prog"><div style="width:${(doneN / d.cases.length) * 100}%"></div></div>
      <div class="v3-tut-desc" style="text-align:right">${doneN} / ${d.cases.length} 완료</div>
      <div class="v3-sec">문제형 — 잘못된 피팅 교정</div>
      ${probs.map(row).join('')}
      <div class="v3-sec">증상형 — 고객 호소 감별</div>
      ${syms.map(row).join('')}
      <div class="v3-tut-actions" style="margin-top:4px">
        <button class="v3-btn" data-tut="random">🎲 무작위 복습</button>
        <button class="v3-btn" data-tut="resetprog">진도 초기화</button>
      </div>`;
  }

  function renderRun() {
    const d = director;
    const c = d.current;
    const PHASE_LABEL = {
      intro: '관찰', demo: '시연 중', demoDone: '시연 완료', diagnose: '진단',
      revealed: '원인 확인', practice: '실습', done: '통과',
    };
    let body = '';
    let actions = '';

    if (c.kind === 'symptom' && (d.phase === 'diagnose')) {
      body = `
        <div class="v3-tut-bubble">"${esc(c.customer)}"</div>
        <div class="v3-tut-desc">${esc(c.intro)}</div>
        <div class="v3-tut-desc" style="color:#8b93a7">우측 조절 패널은 진단 중 가려집니다 — 3D와 좌하단 HUD로 추론하세요.</div>
        <div>${c.causes.map((x) => `<button class="v3-tut-cause" data-cause="${x.id}">${esc(x.label)}</button>`).join('')}</div>`;
      actions = `<button class="v3-btn" data-tut="quit">그만두기</button>`;
    } else if (d.phase === 'intro') {
      body = `<div class="v3-tut-desc">${esc(c.intro)}</div>`;
      actions = `
        <button class="v3-btn on" data-tut="demo">시연 보기</button>
        <button class="v3-btn" data-tut="practice">바로 실습</button>
        <button class="v3-btn" data-tut="quit">그만두기</button>`;
    } else if (d.phase === 'demo') {
      body = `<div class="v3-tut-desc">시연 재생 중 — 화면 좌하단 캡션과 HUD 변화를 따라가세요.</div>`;
      actions = `<button class="v3-btn" data-tut="quit">그만두기</button>`;
    } else if (d.phase === 'demoDone') {
      body = `<div class="v3-tut-desc">${esc(c.explain)}</div>`;
      actions = `
        <button class="v3-btn on" data-tut="practice">직접 실습하기</button>
        <button class="v3-btn" data-tut="demo">다시 시연</button>
        <button class="v3-btn" data-tut="quit">그만두기</button>`;
    } else if (d.phase === 'revealed') {
      body = `
        <div class="v3-tut-bubble">"${esc(c.customer)}"</div>
        <div class="v3-tut-desc">${esc(d.explainText() || '')}</div>`;
      actions = `
        <button class="v3-btn on" data-tut="practice">교정 실습하기</button>
        <button class="v3-btn" data-tut="quit">그만두기</button>`;
    } else if (d.phase === 'practice') {
      body = `
        <div class="v3-tut-desc">${esc(d.explainText() || c.intro)}</div>
        <div class="v3-tut-desc" style="color:#8b93a7">목표 범위에 들어오면 자동 통과됩니다. 막히면 힌트를 누르세요 (3단계, 마지막은 정답 시연).</div>`;
      actions = `
        <button class="v3-btn" data-tut="hint">힌트 ${d.hintLevel}/3</button>
        <button class="v3-btn" data-tut="quit">그만두기</button>`;
    } else if (d.phase === 'done') {
      const nxt = nextCaseId();
      const selfEval = [
        c.kind === 'symptom' && !c.quizOnly ? `진단 ${d.wrongPicks + 1}회 만에 적중` : null,
        d.hintLevel > 0 ? `힌트 ${d.hintLevel}단계 사용` : null,
      ].filter(Boolean).join(' · ');
      body = `
        <div class="v3-tut-desc" style="color:#7dd490;font-weight:800">통과했습니다 ✓${selfEval ? ` <span style="color:#8b93a7;font-weight:600">(${selfEval})</span>` : ''}</div>
        <div class="v3-tut-desc">${esc(d.explainText() || c.explain || '')}</div>`;
      actions = `
        ${nxt ? `<button class="v3-btn on" data-tut="next">다음 케이스</button>` : ''}
        <button class="v3-btn" data-tut="list">목록으로</button>`;
    }

    card.innerHTML = `
      <div class="v3-tut-phase">${PHASE_LABEL[d.phase] || ''}</div>
      <div class="v3-tut-title">${esc(c.title)}</div>
      ${body}
      <div class="v3-tut-actions">${actions}</div>`;
  }

  // ── 입력 ──
  card.addEventListener('click', (e) => {
    const d = director;
    const caseRow = e.target.closest('[data-case]');
    if (caseRow) { d.start(caseRow.dataset.case); return; }
    const causeBtn = e.target.closest('[data-cause]');
    if (causeBtn) {
      const before = d.wrongPicks;
      d.pickCause(causeBtn.dataset.cause);
      if (d.wrongPicks > before) {
        causeBtn.classList.add('shake');
        setTimeout(() => causeBtn.classList.remove('shake'), 450);
      }
      return;
    }
    const act = e.target.closest('[data-tut]')?.dataset.tut;
    if (!act) return;
    if (act === 'demo') d.runDemo();
    else if (act === 'practice') d.startPractice();
    else if (act === 'hint') d.hint();
    else if (act === 'quit') d.quit();
    else if (act === 'list') d.quit();
    else if (act === 'next') { const n = nextCaseId(); n ? d.start(n) : d.quit(); }
    else if (act === 'random') { const c = d.cases[Math.floor(Math.random() * d.cases.length)]; d.start(c.id); }
    else if (act === 'resetprog') d.resetProgress();
  });

  director.onChange(render);
  render();   // 초기 배지(저장된 진도) 반영

  return {
    get isOpen() { return open; },
    close: () => setOpen(false),
    // 멀티뷰 팝업이 같은 좌상단 자리를 쓰므로, 팝업이 열리면 진입 버튼도 숨긴다
    hideEntry(v) { btn.style.display = v ? 'none' : ''; },
  };
}
