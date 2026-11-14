# 변경 이력

이 프로젝트의 주요 변경 사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를, 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

### Added

- `content-cli check --run`과 `pnpm content:check:run`(M4): 헤드리스 Chromium에서 앱과 같은 러너로 실행 검증(예측 문제는 3회 실행 결정론 검사 후 기대값을 `content/.generated/predict-expected.json`에 기록하고 check·build가 채움, 코드 문제는 참조 정답 통과·시작 코드 실패, 레슨 예제는 `expectError` 표시와 실제 오류 일치). CI e2e 작업에 `--frozen`으로 추가. [콘텐츠 작성 가이드](docs/guides/content-authoring.md) 추가
- v0.1 콘텐츠 JS `variables` 변수와 상수 핵심 단원(M4·C): let·대입·const·이름 규칙 레슨 본문(예제 5개, 흔한 실수 11개), 개념 4개·오개념 11개, 문제 22개. AI 초안(`draft`)이며 사람 검토 전입니다
- v0.1 콘텐츠 JS 모듈 1 "시작하기"(M4·C): `first-program`(console.log·문장·주석)과 `reading-errors`(오류 메시지 구조·SyntaxError/ReferenceError/TypeError) 레슨 본문, 개념 5개·오개념 9개, 문제 24개. AI 초안(`draft`)이며 사람 검토 전입니다
- v0.1 콘텐츠 CSS 박스 모델(M4·C): `content/` 콘텐츠 팩(트랙 "웹 프론트엔드 기초"), CSS 개념 4개·오개념 5개, `css.box.model` 레슨 본문과 문제 10개(선택형·빈칸·기본 웹 실습). AI 초안(`draft`)이며 사람 검토 전입니다
- `content-cli build --include-drafts`와 `pnpm content:build:dev`: 개발용으로 검토 전(draft) 문제를 `auto_verified` 상태로 content.db에 포함(경고 출력, `content_meta.includes_drafts`). CI에 `pnpm content:check` 단계 추가

- `@proginone/exercise-ui` 코드 에디터와 코드 유형 렌더러(M4): CodeMirror 6 에디터(토큰 기반 라이트·다크 작업대 테마, `Esc`→`Tab` 탈출, `⇧⌥F` Prettier 포맷, 자동 완성 기본 끔, 오류 줄 표시), 파일·포맷·초기화·저장 상태를 갖춘 에디터 패널, HTML/CSS 미리보기 자리(실행은 러너), `implement_function`·`fix_bug`·`web_task` 기본형 렌더러와 유형 선택 렌더러
- `@proginone/exercise-ui`(M4): `mcq_single`·`fill_blank`·`predict_output` 렌더러, 확신도 선택, 힌트 사다리(3단계 + 확인 후 정답 보기), 피드백 배너(확신도별 문구·실패한 테스트·오개념 설명), 체크 목록(숨김 체크는 설명만), 콘솔 보기(`RunResult` 상태·오류 설명), 문제 단축키 훅
- `@proginone/exercise-kit` 파라메트릭 템플릿 엔진(M4): `<템플릿 ID>@<seed>` → 항상 같은 변형(SplitMix64 시딩 + `xoshiro128**`), 매개변수 8종, 제약 재시도(최대 100회), eval 없는 템플릿 표현식 언어, 렌더링 후 유형 스펙 검증, 빌드용 표본 시드
- 레슨 예제 실행(M4): `RunnableExample`이 러너로 실제 실행됩니다. 예측 후 실행(예측 입력 또는 건너뛰기 → 실행 → 예측과 콘솔 출력 비교), 오류의 줄 번호, 시간 초과·반복 제한 안내, HTML 예제 미리보기
- 코드 실행 샌드박스 `@proginone/runner`(M4): 러너 셸(`/sandbox/runner.html`, 셸 CSP, 셸마다 다른 `*.localhost` 사이트와 같은 사이트 대체), `@proginone/shared` 샌드박스 계약(`RunPlan`·관측 단계·`Observation`·`RunResult`)을 따르는 관측 전용 하네스(콘솔 직렬화, 타이머 추적, `alert`·`confirm`·`prompt`·`localStorage` 대체 구현, 관측 단계, `argsExpr`), 반복문 가드(acorn 계측), DOM 모드 HTML 재작성(blob 전달), 호스트 API(`createRunnerHost`)와 `parseRunResult` 경계 검증, Watchdog, 오류 위치의 학습자 파일·줄 역매핑, Playwright 보안 스위트와 채점기 계약 테스트
- 읽기 진도·복습·학습 시간 API(M4): `POST /api/v1/lessons/:id/progress`(읽기 위치 저장, 첫 방문 시 단원 개념을 `introduced`로), `GET /review-queue`(오늘의 복습 큐와 밀린 복습), `POST /practice-sets` `kind: 'review'`(복습 세트), `POST /activity/heartbeat`(30초 하트비트로 활동 시간을 04:00 기준 학습자 날짜에 집계, 비활성 2분·간격 90초 규칙), `GET /dashboard`(이어서 학습, 오늘 복습 수, 오늘 학습 시간)
- 연습 세트와 시도 제출(M4): `POST /api/v1/practice-sets`(단원 연습 세트를 학습 엔진으로 구성, 진행 중이면 같은 세트), `GET /practice-sets/:id`, `POST /attempts`(서버 스펙으로 채점 → 숙련도·근거·보류 FSRS 등급을 한 트랜잭션으로 기록, 개념의 항목이 끝나면 FSRS 적용, 세트가 끝나면 통과 기준 판정과 단원 완료). 샌드박스 `crashed`/`aborted` 실행은 기록만 하고 학습 엔진에 반영하지 않음
- 학습 기록 저장소와 문제 API(M4): user.db 마이그레이션 0001(단원 진도, 연습 세트·항목, 시도·제출물·힌트 이벤트, 문제 스냅샷, 숙련도·근거, FSRS 기억 상태·리뷰 로그, 보류 등급, 문제 신고, 일별 활동), `GET /api/v1/exercises/:id`(정답 키를 뺀 공개 스펙), `POST /exercises/:id/run-plan`(샌드박스 실행 계획, 기대값 없음), `POST /exercises/:id/hints`(힌트 1→3단계), `POST /exercises/:id/solution`(힌트 3단계 뒤 해설·참조 정답), `POST /exercises/:id/reports`(신고한 문제는 다시 내지 않음)
- `@proginone/exercise-kit` 파라메트릭 템플릿 엔진(M4): `<템플릿 ID>@<seed>` → 항상 같은 변형(SplitMix64 시딩 + `xoshiro128**`), 매개변수 8종, 제약 재시도(최대 100회), eval 없는 템플릿 표현식 언어, 렌더링 후 유형 스펙 검증, 빌드용 표본 시드
- `@proginone/exercise-kit` 코드 채점기(M4): 체크 명세 언어 스키마(call·console·program·dom·event·css·layout·a11y·html-valid·static), 체크 → 관측 단계 컴파일(`buildRunPlan`), 관측값과 기대값 비교, 체크 가중 부분 점수·요구사항별 피드백·마일스톤, `implement_function`·`fix_bug`(토큰 편집 거리 규칙)·`web_task` 기본형·`fill_blank` 코드 모드
- `@proginone/exercise-kit`(M4): 문제 유형 레지스트리와 경계 함수(`parseSpec`·`redactSpec`·`gradeSubmission`·`verifySpec`), `mcq_single`·`fill_blank`(텍스트)·`predict_output` 스펙·답안 스키마와 순수 채점기, 정답 키 제거, 학습자 리터럴 안전 파서, 결정론적 PRNG(`xoshiro128**`). `@proginone/shared`에 샌드박스 계약(`SerializedValue`, 관측 단계·관측값, `RunResult`, `RunPlan`)과 ProgInOne 콘솔 형식
- 학습 엔진 핵심(M4): `@proginone/learning-engine` 증거 가중치(`W_rep` 변형 그룹 반복 감쇠, `W_ctx` 학습 맥락 포함), 숙련도 갱신, 단계 게이트(`proficient` 변형 그룹 3개, `mastered` 간격 복습 2회·독립 응용), 유효 숙련도, 시도 → FSRS 등급, ts-fsrs v6(FSRS-7) 어댑터, 보류 등급의 "개념당 하루 한 번" 적용과 복습 후 단계 재판정, 복습 큐(우선순위·일일 예산)
- 학습 엔진 핵심(M4): `@proginone/learning-engine` 증거 가중치(`W_rep` 변형 그룹 반복 감쇠, `W_ctx` 학습 맥락 포함), 숙련도 갱신, 단계 게이트(`proficient` 변형 그룹 3개, `mastered` 간격 복습 2회·독립 응용), 유효 숙련도, 시도 → FSRS 등급, ts-fsrs v6(FSRS-7) 어댑터, 보류 등급의 "개념당 하루 한 번" 적용과 복습 후 단계 재판정, 복습 큐(우선순위·일일 예산), 단원 연습 세트 구성(개념별 몫·난이도 구간·생성 문제 포함·변형 그룹 중복 금지·같은 유형 3연속 방지)과 통과 기준, 복습 세트 구성(교차 배치), 시드 RNG
- 과정·단원 화면(M4): 과정 목록, 과정 상세(커리큘럼 아코디언·학습 목표·학습 시작), 학습 화면 읽기 모드(집중 헤더, 레슨 본문 렌더러, 이 단원의 개념, 스크롤 추적 목차, 이전/다음 단원). 예제 실행과 확인 문제는 러너·문제 UI와 함께 연결
- 커리큘럼 API(M4): 서버가 content.db를 읽기 전용으로 열고(스키마 버전 검사, 없으면 `CONTENT_UNAVAILABLE`), `GET /api/v1/courses`, `/courses/:id`, `/lessons/:id`(본문 트리·개념·이전/다음 단원), `pnpm content:build`
- `content-cli build`(M4): 검사를 통과한 콘텐츠로 content.db를 원자적으로 생성(커리큘럼·개념·선수 관계·오개념·문제·trigram 전문 검색), 공개 스펙·정답 누설 지문은 exercise-kit 연결점으로 계산, 미검토 문제 제외
- 콘텐츠 스키마와 검사(M4): `@proginone/content-schema`(pack·개념·오개념·과정·모듈·단원·문제 공통 필드 zod 스키마, slug 규칙), `content-cli check`(참조 무결성, 선수 관계 순환, 디렉터리·목록 순서, 레슨 MDX 허용 컴포넌트·섹션 규칙, 원시 HTML 금지, 유형별 스펙 검증 연결점)
- Tailwind CSS v4(D-025): 웹 앱 화면 배치를 토큰 기반 유틸리티로 전환(시각 변화 없음)
- 가이드(M3): 시작하기(`docs/guides/getting-started.md`), 테스트(`docs/guides/testing.md`)
- E2E·시각 회귀·접근성 테스트(M3): Playwright(`e2e/`)로 핵심 흐름·로컬 서버 보안, 화면 × 테마별 axe-core WCAG 2.2 AA 검사, 화면 × 테마 × 뷰포트 스크린샷 비교(Playwright Docker 이미지), CI `e2e` 작업, `pnpm test:e2e`·`pnpm test:e2e:visual`
- 웹 앱 셸(M3): 상단 내비게이션, 라우팅(TanStack Router), 테마 동기화(라이트·다크·시스템, 첫 화면 깜빡임 방지), 페이지 전환 시 포커스·알림, 페이지 오류·유지보수·없는 화면 처리, 설정 > 화면(테마), 설정 > 데이터(백업 목록·지금 백업·복원 확인), `pnpm dev`·`pnpm start`
- 서버의 웹 앱 제공(M3): 설정 API(`GET/PATCH /api/v1/settings`, 테마), 빌드된 웹 앱 정적 제공과 SPA 대체, 앱 문서 CSP, 세션 토큰 전달(프로덕션 메타 태그, 개발 모드 세션 파일), 시작 시 브라우저 열기
- user.db와 자동 백업(M3): Drizzle 스키마·첫 마이그레이션(`app_meta`, `learners`, `settings`), 마이그레이션 전 백업과 실패 시 자동 복구, 일간·주간 백업과 보존 정책, 백업 검증(무결성·체크섬·스키마 호환), 복원(유지보수 모드, 복원 전 백업), `GET/POST /api/v1/backups`, `POST /api/v1/backups/:id/restore`
- 서버 골격(M3): Hono 앱, 설정 로더(환경 변수 > `config.json` > 기본값), 구조화 로그, 오류 응답 모델, 보안 미들웨어(Host·Origin·세션 토큰), 유지보수 모드, 단일 인스턴스 잠금, `GET /api/v1/health`
- `@proginone/ui` 기본 컴포넌트(M3): Button, IconButton, Input, Select, Checkbox, RadioGroup, Tabs, Dialog, Drawer, Tooltip, Toast, Badge, ProgressBar, ProgressRing, Skeleton, EmptyState, ErrorState와 `UiProvider`. Radix 프리미티브와 Lucide 아이콘 기반, 키보드·ARIA·axe 테스트(jsdom)
- `@proginone/ui` 디자인 토큰(M3): 기본·의미·컴포넌트 토큰 CSS(C 차분한 교실 기본, 라이트·다크, 선택형 다크 작업대), 번들 폰트(Pretendard, JetBrains Mono), 전역 기본 스타일, 토큰 대비 검사(`pnpm check:contrast`, CI 포함)
- 모노레포 기반(M3): pnpm 워크스페이스, TypeScript strict, ESLint, Prettier, Vitest, 의존 방향 검사, 문서 링크 검사, GitHub Actions CI, Dependabot, PR 템플릿, `@proginone/shared` 오류 계약
- M1 기술 검증(2026-11-14): Codex 튜터 PoC(`poc/codex-tutor`)와 샌드박스 PoC(`poc/sandbox`) 결과, D-002·D-018 확정. 튜터 전용 `CODEX_HOME`과 도구 기능 비활성화, 셸 서브도메인 방식 추가
- M2 디자인 프로토타입(2026-11-14): 3개 시각 안 비교(`design/prototypes`), D-024(C 차분한 교실, 라이트 에디터, 로고 1안, 토큰 v1 수정)
- 외부 검토 반영(2026-11-14): 단계별 출시(v0.1 시범판 → v1.0 MVP), 학습 맥락별 규칙, 문제 수량 기준과 유형 구성비, 변형 그룹 반복 감쇠·게이트 강화, 체크 가중 부분 점수, 노트·자유 연습·인터랙티브 컴포넌트(P1), 결정 D-021~D-023
- 프로젝트 기획 문서: PRD, 시스템 아키텍처, 데이터 모델, 학습 엔진, 콘텐츠·문제 시스템, 코드 실행 샌드박스, AI 시스템, UI/UX 설계, 구현 로드맵.
- 결정 기록, 용어집, 문서 작성 규칙, 기여 가이드.
