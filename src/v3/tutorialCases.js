// v3 초년차 튜토리얼 — 케이스 데이터 (문제형 16 + 증상형 10)
//
// 실무에서 고객이 불편을 호소하며 방문하는 상황을 재현하고, 원인 진단 → 교정을
// 훈련한다(2026-08-18 사용자 인터뷰로 확정된 커리큘럼).
//
// ⚠️ 세팅(Step)은 patch 직접 주입이 아니라 **컨트롤 경로**로 적용된다
// (controls.applyControl → 기존 write 함수) — 라이트스루(다리→경사각, 콧대→VD,
// 코받침→OH·VD 등)가 자동 반영되어 "다리 3°인데 경사각 8°" 같은 모순 상태를
// 만들 수 없다. 세팅·교정·판정값은 현재 라이트스루 계수 기준으로 계산돼 있으니
// 계수를 바꾸면 무결성 전수 검사(검증 §1)를 다시 돌릴 것.
//
// 판정(goal) 종류 — tutorialDirector.checkGoal 참조:
//   { ns:'fit'|'frame'|'head', key, target, tol }   상태값 (raw)
//   { effR:{ns,key}, target, tol }                  오른쪽 유효값(asym off면 base)
//   { diffEff:{ns,key}, max }                       좌우 유효값 차 |L−R|
//   { roll:max }                                    프런트 롤(기욺) 절대값 °
//   { decAbs:max }                                  광학중심 편심 |decMm| (spec)
//   { corridor:target } / { slip:maxMm }            누진대 / 흘러내림 누적

// ── Step 헬퍼 ──
const F = (key, value) => ({ kind: 'fit', key, value });
const FR = (key, value) => ({ kind: 'frame', key, value });
const H = (key, value) => ({ kind: 'head', key, value });
const A = (key, on) => ({ kind: 'asym', key, value: on ? 1 : 0 });
const COR = (value) => ({ kind: 'corridor', value });
const RESET = { kind: 'reset' };
const PUSHUP = { kind: 'pushup' };

export const CASES = [
  // ════════ 문제형 16 — 잘못된 피팅을 발견하고 교정한다 ════════
  {
    id: 'p1-panto-steep', kind: 'problem', title: 'P1 · 경사각 과다',
    cam: 'side', zones: ['distance'],
    intro: '전면부가 과하게 기울어 조제된 안경입니다. 원용 시야와 왜곡 노출이 어떻게 변하는지 HUD를 관찰하세요.',
    set: [F('panto', 15)],
    explain: '경사각이 표준(8~12°)을 넘으면 사선 비점수차로 원용부가 흐려지고 왜곡 노출이 커집니다. HUD의 원용 시야·왜곡 노출 행이 주황으로 내려간 것을 확인하세요.',
    fix: [F('panto', 8)],
    goal: [{ ns: 'fit', key: 'panto', target: 8, tol: 2 }],
    hints: ['전면부 기울기(경사각)가 표준보다 큽니다 — 렌즈 아래쪽이 얼굴 쪽으로 과하게 누웠습니다.', 'panto'],
  },
  {
    id: 'p2-panto-retro', kind: 'problem', title: 'P2 · 역경사(경사각 부족)',
    cam: 'side', zones: ['near'],
    intro: '경사각이 음수(역경사)로 조제된 안경입니다. 근용부가 어떻게 되는지 보세요.',
    set: [F('panto', -5)],
    explain: '경사각이 부족하면(특히 역경사) 근용 시선이 렌즈를 비스듬히 통과해 근용 시야가 크게 깎입니다. HUD 근용 시야 행을 확인하세요.',
    fix: [F('panto', 8)],
    goal: [{ ns: 'fit', key: 'panto', target: 8, tol: 2 }],
    hints: ['렌즈가 뒤로 젖혀져 있습니다 — 근용부 손실의 대표 원인입니다.', 'panto'],
  },
  {
    id: 'p3-vd-far', kind: 'problem', title: 'P3 · 정점간거리 과다',
    cam: 'side', zones: ['near'],
    intro: '안경이 눈에서 멀리 앉아 있습니다. 모든 시야가 어떻게 변하는지 보세요.',
    set: [F('vd', 19)],
    explain: '정점간거리가 멀수록 렌즈 개구가 좁아져 원·중·근 시야가 전부 줄고 왜곡 노출은 커집니다. 근용 콘이 40cm 타깃을 놓치는 것도 함께 관찰하세요.',
    fix: [F('vd', 12)],
    goal: [{ ns: 'fit', key: 'vd', target: 12, tol: 1.5 }],
    hints: ['렌즈와 눈 사이 거리가 표준(12mm)보다 큽니다.', 'vd'],
  },
  {
    id: 'p4-vd-close', kind: 'problem', title: 'P4 · 눈에 붙은 안경',
    cam: 'side', zones: [],
    intro: '안경이 눈에 닿을 듯 붙어 있습니다. 시야는 넓어 보이지만 실무에서는 착용 불가입니다.',
    set: [F('vd', 5)],
    explain: '정점간거리가 너무 짧으면 속눈썹이 렌즈에 닿고 김서림·압박이 생깁니다. 시야각 수치만 보고 "가까울수록 좋다"고 판단하면 안 되는 이유입니다.',
    fix: [F('vd', 12)],
    goal: [{ ns: 'fit', key: 'vd', target: 12, tol: 1.5 }],
    hints: ['수치상 시야는 넓지만 물리적으로 착용 불가능한 거리입니다.', 'vd'],
  },
  {
    id: 'p5-oh-high', kind: 'problem', title: 'P5 · OH 과다 조제',
    cam: 'front', zones: ['distance'],
    intro: '피팅 높이(OH)가 과하게 높게 조제됐습니다. 원용부에 무슨 일이 생기는지 보세요.',
    set: [F('oh', 5)],
    explain: 'OH가 높으면 누진 시작부가 정면 시선까지 올라와 원용부를 침범합니다 — "OH는 높을수록 좋다"는 오개념의 대가입니다. HUD 원용 시야 행이 깎였습니다.',
    fix: [F('oh', 0)],
    goal: [{ ns: 'fit', key: 'oh', target: 0, tol: 1 }],
    hints: ['십자(아이포인트)가 동공보다 위에 있습니다 — 존 지도가 통째로 올라갔습니다.', 'oh'],
  },
  {
    id: 'p6-oh-low', kind: 'problem', title: 'P6 · OH 부족 조제',
    cam: 'front', zones: ['near'],
    intro: '피팅 높이가 낮게 조제됐습니다. 근용부 도달이 어떻게 되는지 보세요.',
    set: [F('oh', -5)],
    explain: 'OH가 낮으면 근용부가 렌즈 바닥으로 내려가 시선이 도달하기 어렵고, 심하면 프레임 밖으로 잘립니다. 근용 시선 하강각이 커진 것을 확인하세요.',
    fix: [F('oh', 0)],
    goal: [{ ns: 'fit', key: 'oh', target: 0, tol: 1 }],
    hints: ['십자가 동공 아래에 있습니다 — 근용부가 너무 깊이 내려갔습니다.', 'oh'],
  },
  {
    id: 'p7-pd-both', kind: 'problem', title: 'P7 · 양안 PD 오차',
    cam: 'front', zones: ['intermediate'],
    intro: '양쪽 광학중심이 동공에서 같은 방향으로 어긋난 조제입니다.',
    set: [F('pdErr', 6)],
    explain: '광학중심 편심은 누진 통로를 좁히고 좌우 콘을 벌려 양안 겹침을 깎습니다. HUD 맨 위 광학중심 편심 행과 콘 발산을 함께 보세요.',
    fix: [F('pdErr', 0)],
    goal: [{ ns: 'fit', key: 'pdErr', target: 0, tol: 0.5 }],
    hints: ['십자 2개가 모두 동공 바깥쪽으로 벗어나 있습니다.', 'pdErr'],
  },
  {
    id: 'p8-pd-mono', kind: 'problem', title: 'P8 · 단안 PD 어긋남',
    cam: 'front', zones: ['near'],
    intro: '한쪽 렌즈만 광학중심이 어긋난 조제입니다. PD는 원래 단안으로 재는 값입니다.',
    set: [A('pdErr', 1), F('pdErr', 6)],
    explain: '한쪽만 어긋나면 그 눈만 통로 정렬이 깨집니다 — HUD 편심 행이 "좌/우"로 갈라지고, 상면에서 한쪽 콘만 발산합니다. 양안 평균 PD만 재면 놓치는 문제입니다.',
    fix: [F('pdErr', 0), F('pdErr_R', 0)],
    goal: [
      { ns: 'fit', key: 'pdErr', target: 0, tol: 0.5 },
      { effR: { ns: 'fit', key: 'pdErr' }, target: 0, tol: 0.5 },
    ],
    hints: ['왼쪽 십자만 동공에서 벗어나 있습니다 — 좌우를 따로 확인하세요.', 'pdErr'],
  },
  {
    id: 'p9-temple-asym', kind: 'problem', title: 'P9 · 짝다리(다리 경사각 비대칭)',
    cam: 'front', zones: [],
    intro: '한쪽 다리만 더 굽혀진 안경입니다. 프레임이 어떻게 되는지 정면에서 보세요.',
    set: [A('templeAngle', 1), FR('templeAngle', 4)],
    explain: '한쪽 다리만 굽히면 그쪽 힌지가 올라가 프레임이 기울고(수평 틀어짐), 경사각·OH도 함께 끌려갑니다. 실물 조정에서 좌우를 반드시 같이 확인해야 하는 이유입니다.',
    fix: [FR('templeAngle', 0)],
    goal: [{ diffEff: { ns: 'frame', key: 'templeAngle' }, max: 1 }],
    hints: ['프레임 수평이 틀어져 있습니다 — 원인은 두상이 아니라 다리 좌우 차이입니다.', 'templeAngle'],
  },
  {
    id: 'p10-ear-asym', kind: 'problem', title: 'P10 · 짝귀 프레임 기욺',
    cam: 'front', zones: [],
    intro: '고객의 왼쪽 귀가 오른쪽보다 10mm 높습니다(짝귀). 고객 얼굴은 바꿀 수 없습니다 — 안경 쪽에서 해결하세요.',
    set: [A('earY', 1), H('earY', 17)],
    explain: '다리는 각자의 귀에 얹히므로 귀 높이가 다르면 프레임이 기웁니다. 교정은 귀가 아니라 **다리 경사각 좌우 차이**로 — 높은 귀 쪽 다리를 덜 굽히고 낮은 쪽을 더 굽혀 수평을 되찾습니다.',
    fix: [A('templeAngle', 1), FR('templeAngle', -2.5), FR('templeAngle_R', 3)],
    goal: [
      { ns: 'head', key: 'earY', target: 17, tol: 0.5 },
      { effR: { ns: 'head', key: 'earY' }, target: 7, tol: 0.5 },
      { roll: 1.2 },
    ],
    hints: ['귀 높이는 고객의 얼굴 — 건드리면 안 됩니다. 프레임 수평은 다리 좌우 굽힘 차이로 맞춥니다.', 'templeAngle'],
  },
  {
    id: 'p11-pad-wide', kind: 'problem', title: 'P11 · 코받침 벌어짐',
    cam: 'front', zones: ['near'],
    intro: '코받침이 넓게 벌어진 안경입니다. 안경 전체가 어디로 가는지 보세요.',
    set: [FR('padSpacing', 6)],
    explain: '코는 아래로 갈수록 넓어지는 쐐기라, 패드를 벌리면 안경이 코를 타고 깊이 내려앉습니다(OH↓·VD↓). 흘러내림처럼 보이는 증상의 흔한 정적 원인입니다.',
    fix: [FR('padSpacing', 0)],
    goal: [{ ns: 'frame', key: 'padSpacing', target: 0, tol: 1 }],
    hints: ['안경이 통째로 내려앉았습니다 — 다리가 아니라 코받침 간격을 보세요.', 'padSpacing'],
  },
  {
    id: 'p12-slip', kind: 'problem', title: 'P12 · 흘러내리는 안경',
    cam: 'side', zones: [], observeMs: 5000,
    intro: '귀팁각이 펴진 안경을 쓴 고객이 고개를 숙입니다. 안경이 실제로 흘러내리는 것을 지켜보세요.',
    set: [FR('earTipAngle', 164), F('headPitch', 28)],
    explain: '귀팁각이 펴지면(150°+) 귀 뒤에 걸리는 데가 없어 고개만 숙여도 흘러내립니다. 코받침 쐐기가 일부 받치지만 한계가 있습니다. 교정: 팁각을 감고, 흘러내린 안경은 밀어 올립니다.',
    fix: [FR('earTipAngle', 118), F('headPitch', 0), PUSHUP],
    goal: [
      { ns: 'frame', key: 'earTipAngle', target: 118, tol: 10 },
      { slip: 0.005 },
    ],
    hints: ['다리 끝(귀 뒤 이어피스)이 거의 직선입니다 — 고정력이 없습니다. 교정 후 "안경 밀어 올리기"도 잊지 마세요.', 'earTipAngle'],
  },
  {
    id: 'p13-gap-asym', kind: 'problem', title: 'P13 · 옆면 간격 비대칭',
    cam: 'front', zones: [],
    intro: '한쪽 다리만 좁혀진 안경입니다. 좁힌 쪽 림이 어떻게 되는지 보세요.',
    set: [A('templeGap', 1), FR('templeGap', -6)],
    explain: '한쪽 간격을 좁히면 그쪽 다리가 두상 앞쪽에 걸려 림이 전방으로 뜨고 수평도 올라갑니다. 얼굴 좌우 폭이 다른 고객에게 일부러 쓰기도 하지만, 의도 없이 생기면 교정 대상입니다.',
    fix: [FR('templeGap', 0)],
    goal: [{ diffEff: { ns: 'frame', key: 'templeGap' }, max: 1 }],
    hints: ['한쪽 림만 얼굴에서 떠 있습니다 — 옆면 간격의 좌우 차이를 보세요.', 'templeGap'],
  },
  {
    id: 'p14-wrap', kind: 'problem', title: 'P14 · 안면각 과다(랩)',
    cam: 'top', zones: ['distance'],
    intro: '스포츠 프레임처럼 렌즈가 얼굴을 감싸는(랩) 조제입니다. 상면에서 콘 방향을 보세요.',
    set: [F('wrap', 13)],
    explain: '랩이 크면 정면 시선이 광학중심을 벗어나 유효 편심(수평 프리즘)이 생깁니다 — 콘이 벌어진 이유입니다. 실무에서는 광학중심을 코쪽으로 편심(2°당 약 1mm)하고 도수를 보상(as-worn)해야 합니다.',
    fix: [F('wrap', 5)],
    goal: [{ ns: 'fit', key: 'wrap', target: 5, tol: 2 }],
    hints: ['시야 폭 문제가 아니라 양안 정렬 문제입니다 — 안면각이 만든 유효 편심을 보세요.', 'wrap'],
  },
  {
    id: 'p15-frame-big', kind: 'problem', title: 'P15 · 프레임 과대 + 가공 미보정',
    cam: 'front', zones: ['intermediate'],
    intro: '고객이 큰 프레임을 원합니다(B 38). 가공 전 기준으로 광학중심이 얼마나 벌어지는지, PD 보정으로 어디까지 회복되는지 체험하세요. 프레임은 유지해야 합니다.',
    set: [F('bSize', 38)],
    explain: '큰 테는 렌즈 박스 중앙(광학중심)이 동공 밖으로 벌어집니다(+14mm). PD 보정(−10mm 한계)으로도 완전히 못 잡는 것 — 그게 "큰 테의 대가"이며, 고객 상담에서 미리 설명해야 할 지점입니다.',
    fix: [F('pdErr', -10)],
    goal: [
      { ns: 'fit', key: 'bSize', target: 38, tol: 2 },
      { decAbs: 5 },
    ],
    hints: ['프레임을 줄이면 안 됩니다(고객 선택). 편심을 PD 보정으로 최대한 상쇄하세요.', 'pdErr'],
  },
  {
    id: 'p16-low-nose', kind: 'problem', title: 'P16 · 저비강 내려앉음',
    cam: 'side', zones: ['near'],
    intro: '콧대가 낮은 고객입니다(저비강). 안경이 눈에 붙고 내려앉았습니다. 고객 얼굴은 바꿀 수 없습니다 — 코받침으로 보상하세요.',
    set: [H('noseBridge', -6)],
    explain: '낮은 콧대는 코받침이 받칠 지점이 낮아 안경이 눈에 붙고(VD↓) 내려앉습니다(OH↓) — 속눈썹 닿음·근용부 낮아짐의 원인. 코받침 간격을 좁히고 전후를 늘려 정점간거리와 높이를 되찾습니다.',
    fix: [FR('padSpacing', -1), FR('padArm', 6)],
    goal: [
      { ns: 'head', key: 'noseBridge', target: -6, tol: 0.5 },
      { ns: 'fit', key: 'oh', target: 0, tol: 1.2 },
      { ns: 'fit', key: 'vd', target: 11.5, tol: 1.5 },
    ],
    hints: ['콧대는 고객의 얼굴입니다. 코받침 간격(좁힘)과 전후(연장)로 안경 위치를 되찾으세요.', 'padSpacing'],
  },

  // ════════ 증상형 10 — 고객 호소 → 감별 → 교정 ════════
  {
    id: 's1-near-blur', kind: 'symptom', title: 'S1 · "책 볼 때 흐려요"',
    customer: '가까운 글씨가 흐릿해요. 책을 좀 멀리 떨어뜨려야 보여요.',
    cam: 'side', zones: ['near'],
    intro: '근거리 불편 호소입니다. 3D의 근용 콘·HUD 근용 행을 관찰해 원인을 찾으세요.',
    causes: [
      {
        id: 'oh-low', label: 'OH가 낮게 조제됨',
        set: [F('oh', -4)],
        explain: 'OH가 낮으면 근용부가 렌즈 바닥으로 내려가 시선이 도달하기 어렵습니다 — 십자가 동공 아래, 근용 하강각이 커진 게 단서였습니다.',
        fix: [F('oh', 0)], goal: [{ ns: 'fit', key: 'oh', target: 0, tol: 1 }],
        hints: ['십자와 동공의 상하 관계를 보세요.', 'oh'],
      },
      {
        id: 'vd-far', label: '정점간거리가 멂',
        set: [F('vd', 18)],
        explain: 'VD가 멀면 근용 콘이 아래 40cm 타깃을 놓칩니다 — 측면에서 안경-눈 간격이 큰 게 단서였습니다.',
        fix: [F('vd', 12)], goal: [{ ns: 'fit', key: 'vd', target: 12, tol: 1.5 }],
        hints: ['측면에서 렌즈와 눈 사이 거리를 보세요.', 'vd'],
      },
      {
        id: 'corr-long', label: '누진대가 긺 (설계 요인)', isTrap: true,
        set: [COR(14)],
        explain: '정답! 하지만 이건 **피팅으로 해결 못 하는 설계 요인**입니다 — 누진대가 길면 근용부가 깊어 시선이 닿기 어렵습니다. 프레임·피팅이 정상인데 근용 하강각만 큰 게 단서. 해결은 짧은 누진대로 **렌즈 재제작**입니다.',
        fix: [COR(12)], goal: [{ corridor: 12 }],
        hints: ['피팅 값은 전부 표준인데 근용 하강각만 큽니다 — 하단 누진대 버튼을 보세요.', null],
      },
    ],
  },
  {
    id: 's2-dist-blur', kind: 'symptom', title: 'S2 · "멀리가 덜 선명해요"',
    customer: '운전할 때 표지판이 예전 안경보다 덜 선명한 것 같아요.',
    cam: 'front', zones: ['distance'],
    intro: '원거리 불편 호소입니다. HUD 원용 행·광학중심 편심 행을 관찰하세요.',
    causes: [
      {
        id: 'panto-steep', label: '경사각 과다',
        set: [F('panto', 15)],
        explain: '경사각 과다는 사선 비점수차로 원용부를 깎습니다 — 측면에서 렌즈가 과하게 누운 게 단서였습니다.',
        fix: [F('panto', 8)], goal: [{ ns: 'fit', key: 'panto', target: 8, tol: 2 }],
        hints: ['측면에서 전면부 기울기를 보세요.', 'panto'],
      },
      {
        id: 'oh-high', label: 'OH 과다 조제',
        set: [F('oh', 5)],
        explain: 'OH가 높으면 누진 시작부가 정면 시선을 침범해 원용이 흐려집니다 — 십자가 동공 위에 있는 게 단서였습니다.',
        fix: [F('oh', 0)], goal: [{ ns: 'fit', key: 'oh', target: 0, tol: 1 }],
        hints: ['십자가 동공보다 위에 있지 않나요?', 'oh'],
      },
      {
        id: 'frame-big', label: '프레임 과대(편심 미보정)',
        set: [F('bSize', 38)],
        explain: '큰 테는 광학중심이 동공 밖으로 벌어져(편심 +14) 양안 겹침이 무너집니다 — HUD 편심 행이 단서였습니다. PD 보정으로 최대한 상쇄하세요.',
        fix: [F('pdErr', -10)],
        goal: [{ ns: 'fit', key: 'bSize', target: 38, tol: 2 }, { decAbs: 5 }],
        hints: ['HUD 맨 위 광학중심 편심 값을 보세요. 프레임은 고객 선택이라 유지합니다.', 'pdErr'],
      },
    ],
  },
  {
    id: 's3-mid-neck', kind: 'symptom', title: 'S3 · "모니터 볼 때 목을 젖혀야 해요"',
    customer: '컴퓨터 화면이 정면으로 보면 흐리고, 턱을 들어야 선명해져요.',
    cam: 'side', zones: ['intermediate'],
    intro: '중간거리(모니터) 불편 호소입니다. 중간 콘의 방향과 HUD 중간 행을 관찰하세요.',
    causes: [
      {
        id: 'oh-low', label: 'OH가 낮게 조제됨',
        set: [F('oh', -4)],
        explain: '존 지도가 통째로 내려가 중간부를 보려면 턱을 들어야 합니다 — 십자가 동공 아래인 게 단서였습니다.',
        fix: [F('oh', 0)], goal: [{ ns: 'fit', key: 'oh', target: 0, tol: 1 }],
        hints: ['십자 위치를 보세요 — 존 전체가 낮게 깔려 있습니다.', 'oh'],
      },
      {
        id: 'panto-retro', label: '경사각 부족(역경사)',
        set: [F('panto', -3)],
        explain: '경사각이 부족하면 코리도 정렬이 틀어져 중간부가 좁아집니다 — 측면에서 렌즈가 젖혀진 게 단서였습니다.',
        fix: [F('panto', 8)], goal: [{ ns: 'fit', key: 'panto', target: 8, tol: 2 }],
        hints: ['측면에서 전면부가 뒤로 젖혀져 있지 않나요?', 'panto'],
      },
      {
        id: 'corr-short', label: '누진대가 짧음 (설계 요인)', isTrap: true,
        set: [COR(10)],
        explain: '정답! 짧은 누진대는 중간 통로가 급해 폭이 좁습니다 — 피팅이 전부 표준인데 중간 시야만 좁은 게 단서. **피팅으로 해결 불가**, 긴 누진대로 렌즈 재제작이 답입니다.',
        fix: [COR(12)], goal: [{ corridor: 12 }],
        hints: ['피팅 값이 전부 표준입니다 — 하단 누진대 버튼을 보세요.', null],
      },
    ],
  },
  {
    id: 's4-distortion', kind: 'symptom', title: 'S4 · "바닥이 울렁거려요"',
    customer: '걸을 때 바닥이 출렁거리고 계단이 무서워요.',
    cam: 'quarter', zones: [],
    intro: '왜곡·어지럼 호소입니다. HUD 왜곡 노출 행을 클릭하면 요인 분해가 열립니다 — 그걸로 원인을 좁히세요.',
    causes: [
      {
        id: 'panto-steep', label: '경사각 과다',
        set: [F('panto', 15)],
        explain: '경사각 이탈은 기울기 비점수차로 왜곡 체감을 키웁니다 — 왜곡 요인 분해에서 "기울기 비점수차"가 커진 게 단서였습니다.',
        fix: [F('panto', 8)], goal: [{ ns: 'fit', key: 'panto', target: 8, tol: 2 }],
        hints: ['왜곡 노출 행을 클릭해 요인 분해를 여세요.', 'panto'],
      },
      {
        id: 'wrap-high', label: '안면각 과다',
        set: [F('wrap', 13)],
        explain: '안면각 이탈도 기울기 비점수차의 한 축입니다 — 상면에서 렌즈가 얼굴을 감싼 게 단서였습니다.',
        fix: [F('wrap', 5)], goal: [{ ns: 'fit', key: 'wrap', target: 5, tol: 2 }],
        hints: ['상면(위) 카메라로 렌즈 감김을 보세요.', 'wrap'],
      },
      {
        id: 'vd-far', label: '정점간거리 과다',
        set: [F('vd', 18)],
        explain: 'VD가 멀수록 시야에서 왜곡 날개가 차지하는 비중이 커집니다 — 왜곡 요인 분해의 "정점간거리" 항이 단서였습니다.',
        fix: [F('vd', 12)], goal: [{ ns: 'fit', key: 'vd', target: 12, tol: 1.5 }],
        hints: ['측면에서 안경-눈 거리를 보세요.', 'vd'],
      },
    ],
  },
  {
    id: 's5-one-eye', kind: 'symptom', title: 'S5 · "오른쪽만 흐릿해요"',
    customer: '왼쪽 눈은 괜찮은데 오른쪽만 초점이 안 맞아요.',
    cam: 'front', zones: ['near'],
    intro: '양안 불균형 호소입니다. 정면에서 프레임 수평·십자 위치를 좌우 비교하세요. (아바타 기준 오른쪽 = 화면 왼쪽)',
    causes: [
      {
        id: 'pd-mono', label: '오른쪽 단안 PD 어긋남',
        set: [A('pdErr', 1), F('pdErr_R', 5)],
        explain: '오른쪽 광학중심만 어긋나 그 눈만 통로 정렬이 깨졌습니다 — HUD 편심 행이 "좌 0 / 우 5"로 갈라진 게 단서였습니다.',
        fix: [F('pdErr_R', 0)],
        goal: [{ effR: { ns: 'fit', key: 'pdErr' }, target: 0, tol: 0.5 }],
        hints: ['HUD 편심 행이 좌/우로 갈라져 있지 않나요?', 'pdErr'],
      },
      {
        id: 'ear-tilt', label: '짝귀로 프레임 기욺',
        set: [A('earY', 1), H('earY_R', 15)],
        explain: '오른쪽 귀가 높아 프레임이 기울고, 오른쪽 눈이 렌즈의 엉뚱한 구간을 봅니다 — 정면에서 수평 틀어짐 + 귀 높이 차가 단서. 교정은 다리 좌우 굽힘 차이로.',
        fix: [A('templeAngle', 1), FR('templeAngle', 2.5), FR('templeAngle_R', -2)],
        goal: [
          { effR: { ns: 'head', key: 'earY' }, target: 15, tol: 0.5 },
          { roll: 1.2 },
        ],
        hints: ['프레임이 기울었습니다 — 귀 높이(고객 얼굴)는 못 바꾸니 다리 좌우로 수평을 잡으세요.', 'templeAngle'],
      },
      {
        id: 'temple-tilt', label: '오른쪽 다리만 굽음(짝다리)',
        set: [A('templeAngle', 1), FR('templeAngle_R', 4)],
        explain: '오른쪽 다리만 굽어 프레임이 기울었습니다 — 귀 높이는 같은데 다리 각도가 다른 게 단서(짝귀와의 감별 포인트).',
        fix: [FR('templeAngle_R', 0)],
        goal: [{ diffEff: { ns: 'frame', key: 'templeAngle' }, max: 1 }],
        hints: ['기울긴 했는데 귀 높이는 같습니다 — 다리를 확대해 보세요.', 'templeAngle'],
      },
    ],
  },
  {
    id: 's6-slipping', kind: 'symptom', title: 'S6 · "안경이 자꾸 흘러내려요"',
    customer: '하루에도 몇 번씩 안경을 밀어 올려요. 고개만 숙이면 내려와요.',
    cam: 'side', zones: [], observeMs: 4500,
    intro: '착용감·흘러내림 호소입니다. 고개를 숙인 상태로 재현했습니다 — 실제로 흘러내리는지, 아니면 내려앉은 것인지 지켜보세요.',
    causes: [
      {
        id: 'tip-open', label: '귀팁각이 펴짐',
        set: [FR('earTipAngle', 164), F('headPitch', 28)],
        explain: '귀 뒤 걸림이 없어 고개를 숙이면 실제로 미끄러집니다 — 다리 끝이 직선인 게 단서. 팁각을 감고 밀어 올리세요.',
        fix: [FR('earTipAngle', 118), F('headPitch', 0), PUSHUP],
        goal: [{ ns: 'frame', key: 'earTipAngle', target: 118, tol: 10 }, { slip: 0.005 }],
        hints: ['다리 끝(이어피스) 꺾임을 확대해 보세요. 교정 후 밀어 올리기까지.', 'earTipAngle'],
      },
      {
        id: 'conv-open', label: '귀모임각이 벌어짐',
        set: [FR('earConverge', -25), F('headPitch', 28)],
        explain: '이어피스가 유양돌기에서 벌어져 그립이 감쇠했습니다 — 위에서 보면 다리 끝이 바깥으로 벌어진 게 단서.',
        fix: [FR('earConverge', 0), F('headPitch', 0), PUSHUP],
        goal: [{ ns: 'frame', key: 'earConverge', target: 0, tol: 5 }, { slip: 0.005 }],
        hints: ['상면에서 이어피스가 머리에 붙는지 벌어지는지 보세요.', 'earConverge'],
      },
      {
        id: 'pad-wide', label: '코받침이 벌어짐(내려앉음)',
        set: [FR('padSpacing', 6)],
        explain: '이건 동적 흘러내림이 아니라 **정적 내려앉음**입니다 — 고개를 숙여도 더 미끄러지지 않고, 처음부터 낮게 앉아 있는 게 감별 포인트. 코받침 간격을 되잡으세요.',
        fix: [FR('padSpacing', 0)],
        goal: [{ ns: 'frame', key: 'padSpacing', target: 0, tol: 1 }],
        hints: ['흘러내리는 중인가요, 처음부터 낮은가요? 코받침 폭을 보세요.', 'padSpacing'],
      },
    ],
  },
  {
    id: 's7-fatigue', kind: 'symptom', title: 'S7 · "오후엔 눈이 피곤하고 두통이 와요"',
    customer: '보이긴 다 보이는데, 오후만 되면 눈이 몹시 피곤하고 관자놀이가 아파요.',
    cam: 'front', zones: ['intermediate'],
    intro: '뚜렷한 흐림 없이 피로만 호소하는 케이스 — **작은 오차의 누적**입니다. HUD의 작은 주황 Δ를 찾아내세요.',
    causes: [
      {
        id: 'pd-slight', label: '경미한 PD 오차 (2.5mm)',
        set: [F('pdErr', 2.5)],
        explain: '흐림을 못 느낄 수준의 편심도 융상 부담을 계속 걸어 오후 피로·두통으로 나타납니다 — HUD 편심 2.5mm가 단서. "보이니까 괜찮다"가 아닙니다.',
        fix: [F('pdErr', 0)], goal: [{ ns: 'fit', key: 'pdErr', target: 0, tol: 0.5 }],
        hints: ['HUD 맨 위 편심 행 — 작지만 0이 아닙니다.', 'pdErr'],
      },
      {
        id: 'oh-slight', label: '경미한 OH 오차 (−2mm)',
        set: [F('oh', -2)],
        explain: '2mm 낮은 OH는 근거리 작업 내내 시선을 더 내려야 해 안정피로가 쌓입니다 — 근용 하강각의 작은 증가가 단서.',
        fix: [F('oh', 0)], goal: [{ ns: 'fit', key: 'oh', target: 0, tol: 1 }],
        hints: ['근용 시선 하강 행의 작은 Δ를 보세요.', 'oh'],
      },
      {
        id: 'vd-slight', label: '정점간거리 과다 (17mm)',
        set: [F('vd', 17)],
        explain: '멀리 앉은 안경은 모든 존을 조금씩 깎고 왜곡 비중을 키워 은근한 피로를 만듭니다 — 전 행에 걸친 작은 주황 Δ가 단서.',
        fix: [F('vd', 12)], goal: [{ ns: 'fit', key: 'vd', target: 12, tol: 1.5 }],
        hints: ['한 행이 아니라 여러 행이 조금씩 나쁩니다 — 공통 원인을 찾으세요.', 'vd'],
      },
    ],
  },
  {
    id: 's8-old-glasses', kind: 'symptom', title: 'S8 · "예전 안경이 더 편해요"',
    customer: '새 안경이 도수는 맞다는데, 예전 안경 쓰면 더 편해요.',
    cam: 'side', zones: [],
    intro: '적응 실패 호소 — 도수가 아니라 **착용 조건의 급변**이 원인일 수 있습니다. 표준과 크게 다른 값을 찾으세요.',
    causes: [
      {
        id: 'vd-changed', label: '정점간거리가 이전과 크게 다름',
        set: [F('vd', 18)],
        explain: '이전 안경(VD 12 부근)보다 6mm 멀어 유효 배율·시야가 급변했습니다. 한 번에 되돌리기보다 고객과 상의해 단계적으로 좁혀가는 것도 방법입니다.',
        fix: [F('vd', 12)], goal: [{ ns: 'fit', key: 'vd', target: 12, tol: 1.5 }],
        hints: ['이전 안경과 무엇이 가장 다른가 — 측면 간격부터 보세요.', 'vd'],
      },
      {
        id: 'panto-changed', label: '경사각이 이전과 크게 다름',
        set: [F('panto', 2)],
        explain: '이전 안경(8~12°)보다 훨씬 플랫해 근용 접근 습관이 달라졌습니다 — 몸이 기억하는 각도로 되돌리면 적응이 빨라집니다.',
        fix: [F('panto', 8)], goal: [{ ns: 'fit', key: 'panto', target: 8, tol: 2 }],
        hints: ['측면에서 전면부 기울기를 이전 안경 기준(8~12°)과 비교하세요.', 'panto'],
      },
    ],
  },
  {
    id: 's9-posture', kind: 'symptom', title: 'S9 · "누워서 폰 볼 땐 안 보여요"',
    customer: '앉아서는 잘 보이는데, 누워서 폰을 보면 가까운 게 안 보여요.',
    cam: 'side', zones: ['near'], quizOnly: true,
    intro: '자세 관련 호소입니다. 고개를 든 자세를 재현했습니다 — 근용 콘이 어디를 향하는지 보고, 이 고객에게 맞는 안내를 고르세요.',
    set: [F('headPitch', -12)],
    causes: [
      {
        id: 'posture', label: '피팅 문제 아님 — 사용 자세 안내', isAnswer: true,
        explain: '정답! 누우면 시선이 렌즈 위쪽(원용부)을 지나므로 근용부를 쓸 수 없습니다 — 피팅이 아니라 **누진렌즈의 기하**입니다. "누울 땐 폰을 눈높이보다 아래로" 같은 사용 안내가 올바른 응대입니다.',
      },
      {
        id: 'oh-up', label: 'OH를 올려 근용부를 키운다',
        explain: '오답 — OH를 올리면 이번엔 앉은 자세에서 원용이 침범됩니다. 특정 자세 하나 때문에 기본 피팅을 희생하면 안 됩니다.',
      },
      {
        id: 'vd-down', label: 'VD를 줄인다',
        explain: '오답 — VD를 줄여도 누운 시선은 여전히 원용부를 지납니다. 원인은 거리도 높이도 아닌 시선 방향입니다.',
      },
    ],
  },
  {
    id: 's10-nose-pain', kind: 'symptom', title: 'S10 · "코가 아파요"',
    customer: '오래 쓰면 코받침 자리가 빨갛게 눌리고 아파요.',
    cam: 'front', zones: [],
    intro: '압박 통증 호소입니다(통증 자체는 시뮬레이션에 없음 — 접촉 상태로 추론). 코받침을 확대해 패드가 콧대를 어떻게 무는지 보세요.',
    causes: [
      {
        id: 'pad-narrow', label: '코받침 간격이 좁음(꽉 묾)',
        set: [FR('padSpacing', -3)],
        explain: '패드가 콧대를 좁게 물어 접촉압이 집중됩니다 — 안경이 높이 올라앉은 것(OH↑)도 단서. 간격을 되벌려 접촉면을 넓히세요.',
        fix: [FR('padSpacing', 0)],
        goal: [{ ns: 'frame', key: 'padSpacing', target: 0, tol: 1 }],
        hints: ['안경이 표준보다 올라앉아 있습니다 — 패드 간격을 보세요.', 'padSpacing'],
      },
      {
        id: 'pad-shift', label: '패드 상하가 아래로 쏠림',
        set: [FR('padVertical', -8)],
        explain: '패드가 프레임 기준 아래로 쏠려 콧대의 좁은 위쪽을 파고듭니다 — 림 대비 패드 위치가 단서. 상하 위치를 중앙으로.',
        fix: [FR('padVertical', 0)],
        goal: [{ ns: 'frame', key: 'padVertical', target: 0, tol: 1 }],
        hints: ['림과 패드의 상대 위치를 확대해 비교하세요.', 'padVertical'],
      },
    ],
  },
];

// 감별(진단) 단계에서 우측 패널을 가리는 케이스: 세팅값이 슬라이더에 그대로
// 보이면 감별이 자명해진다 — 증상형은 전부 가림(3D·HUD로만 추론).
// quizOnly(S9)는 숨긴 세팅이 없어 예외.
export const shouldHidePanel = (c) => c.kind === 'symptom' && !c.quizOnly;
