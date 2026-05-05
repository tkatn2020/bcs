# 웨이브프론트 누진다초점 분석기

안경원에서 누진다초점렌즈의 등급별 왜곡 차이를 **양안 동시 비교**로 보여주기 위한 iPad 웹앱.

## 무엇을 보여주는가

- 고객의 도수(OD/OS, S/C/Axis), ADD(가입도), 누진대 길이(10·12·14mm), 렌즈 등급(1~5)을 입력하면
- 각 렌즈의 unwanted cylinder 분포가 **연속 히트맵 + iso 등고선**으로 표시되고
- 우측 패널에 **원/중/근(원거리/중간거리/근거리) 선명시역 비율**이 % 단위로 즉시 산출됨
- 좌우 도수가 다른 부동시(anisometropia)의 경우 양안 격차도 함께 표시
- A↔B 비교, 변수별 스윕(등급/ADD/누진대/구면/부동시)으로 상담 시 권장 등급의 가치를 시연

## 페이지 구성 (3개 섹션)

1. **양안(OD/OS) 인터랙티브 플레이그라운드**
   - 좌측: 등급/ADD/누진대/임계값 + OD·OS 도수 카드 (양안 동기화 토글)
   - 중앙: OS·OD 듀얼 렌즈 (코받침 포함, 좌우 미러링)
   - 우측: 양안 각각의 Clear Vision Field 패널 + OU 평균 막대

2. **A ↔ B 자유 비교**
   - 두 가지 컨피그(예: 권장 전 BP10 vs 권장 후 BP50)를 동시 시연
   - 라벨 인라인 편집 가능

3. **변수별 스윕**
   - 5개 탭: 등급(BP10→BP50) · 가입도 · 누진대 길이 · 구면도수 · 좌우 도수차이
   - 각 탭마다 5–6셀의 미니 렌즈 + 원/중/근 비율 바

## 광학 모델

- **Minkwitz 정리** 기반: 주변부 unwanted cyl ≈ ADD × (12 / 누진대길이) × 등급계수
- **등급 계수**: BP10=1.0 / BP20=0.75 / BP30=0.6 / BP40=0.45 / BP50=0.35 (즉 BP50은 BP10 대비 65% 감소)
- **소프트/하드 타입**: 누진대 길이가 길수록(14mm) 소프트, 짧을수록(10mm) 하드 — falloff 거리도 그에 따라 변화
- **구면 영향**: |sphere|>3D에서 4%/D씩 clearScale·falloff 압축 (강도수 적응 어려움 모델링)
- **난시 floor**: cylinder의 0.20×|cyl|만큼 균일 베이스라인 추가
- **선명 임계값**: cyl < threshold(기본 0.25D)인 픽셀을 "선명"으로 판정. 0.10–0.75D 슬라이더로 조정

## 실행

PWA 기능은 제거됐으므로 어떤 정적 호스팅이든 동작합니다.

### 옵션 1. Python (가장 간단)
```bash
cd "다초점 설명"
python -m http.server 8000
```
브라우저에서 http://localhost:8000

### 옵션 2. Node.js
```bash
npx serve
```

### 옵션 3. VS Code Live Server 확장
프로젝트 폴더에서 우클릭 → "Open with Live Server"

### iPad에서 사용하기

1. PC와 iPad가 같은 Wi-Fi에 있어야 합니다
2. PC에서 `python -m http.server 8000` 실행
3. PC의 IP 확인 (`ipconfig` → "IPv4 주소")
4. iPad Safari에서 `http://<PC-IP>:8000` 접속
5. 공유 → 홈 화면에 추가 → 풀스크린 동작

## 디렉토리 구조

```
.
├── index.html                       # 진입점 (3섹션 SPA)
├── src/
│   ├── optics/
│   │   └── grades.js                # 5등급(BP10~BP50) 정의
│   └── wavefront/
│       ├── helpers.js               # getGeom, sampleUnwantedCyl, computeClearRatios, renderField, drawIsoLines
│       ├── lensBox.js               # 단일/양안 렌즈 뷰어
│       ├── ratioPanel.js            # Clear Vision Field 카드 + OU 평균 막대
│       ├── playground.js            # Section 1 (인터랙티브 양안)
│       ├── compareSection.js        # Section 2 (A↔B)
│       ├── sweepSection.js          # Section 3 (변수별 스윕)
│       └── styles.css               # 페이지 스타일
└── README.md
```

## 시각화 팔레트

연속 그라데이션:
- 짙은 파랑 (0D, 선명) → 청록 → 라임 → 노랑 → 주황 → 자홍 (peak unwanted cyl)

iso 등고선:
- 0.15 / 0.60 / 0.85 / 1.00 ADD 레벨

영역 분할선:
- 원거리(blue) / 중간거리(green) / 근거리(amber)

## 한계

- 분석적 모델이라 실제 렌즈 제조사의 power map과 정확히 일치하지 않음 (영업·교육 도구 용도)
- 양안 시점은 좌우 미러링된 두 단일 렌즈 — 실제 stereoscopic merge는 별도 디스플레이 필요
- 색수차·prism shift·AR 코팅 효과는 모델링하지 않음

## 라이선스

내부 사용 도구. 외부 의존 없음 (순수 ES 모듈).
