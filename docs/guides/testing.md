# 테스트 가이드

ProgInOne의 테스트 종류, 실행 방법, 작성 규칙입니다.

- 대상: 기여자
- 최종 수정: 2026-11-16
- 전략의 원천: [시스템 아키텍처 설계 테스트 전략](/docs/design/system-architecture.md#테스트-전략)

## 한눈에 보기

| 명령 | 무엇을 | 언제 |
|---|---|---|
| `pnpm check` | lint, 포맷, 타입, 의존 방향, 토큰 대비, 단위·통합 테스트, 문서 링크 | 커밋 전 항상 |
| `pnpm test` | Vitest 단위·통합 테스트만 | 개발 중 |
| `pnpm test:watch` | Vitest 감시 모드 | 개발 중 |
| `pnpm test:e2e` | 빌드 후 Playwright 기능·접근성 테스트(로컬 Chromium) | UI·흐름을 바꿨을 때 |
| `pnpm test:e2e:visual` | Docker 안에서 기능·접근성·시각 회귀 전체 | 화면 모습을 바꿨을 때 |
| `pnpm test:e2e:visual --update` | 시각 회귀 기준 이미지 다시 만들기 | 의도한 화면 변경 후 |
| `pnpm test:e2e:compat` | Firefox·WebKit에서 샌드박스 정책·핵심 흐름 | 러너·샌드박스를 바꿨을 때, 릴리스 전 |
| `pnpm perf` | NFR-01~03 성능 측정(실제 콘텐츠, 목표 미달이면 실패) | 화면·러너 성능에 영향이 있을 때, 릴리스 전 |
| `pnpm check:bundle` | 첫 화면 JS·CSS 번들 크기 예산(`pnpm build` 뒤) | 의존성을 추가했을 때. CI가 항상 실행 |

CI는 PR과 `main` 푸시마다 `check` 단계(lint ~ audit)와 `e2e` 단계(Playwright Docker 이미지)를 실행합니다. 둘 다 통과해야 병합합니다.

## 단위·통합 테스트 (Vitest)

- 파일 위치: 대상 옆의 `*.test.ts(x)`.
- 루트 `vitest.config.ts`의 프로젝트:
  - `node`: 서버, `shared`, 스크립트
  - `ui`: `packages/ui` 컴포넌트(jsdom)
  - `web`: `apps/web`(jsdom, jest-dom 매처)
- 하나만 실행: `pnpm vitest run --project web`, `pnpm vitest run apps/server/src/services/backup`.

작성 규칙:

- **서버**: 실제 SQLite를 임시 디렉터리에 만들어 테스트합니다(`apps/server/src/test/helpers.ts`의 `setupDb()`). DB를 모의하지 않습니다.
- **HTTP**: `createApp(...).request()`로 미들웨어부터 라우트까지 통과시킵니다. `Host`와 `x-proginone-token` 헤더를 붙여야 합니다.
- **컴포넌트·화면**: Testing Library로 역할과 이름을 찾습니다(`getByRole('button', { name: '지금 백업' })`). 클래스나 테스트 ID로 찾지 않습니다. 화면 테스트는 `apps/web/src/test/render-app.tsx`로 실제 라우트 트리를 가짜 API와 함께 렌더링합니다.
- **시간**: 날짜 경계나 보존 정책은 `now`를 주입해 테스트합니다. 실제 시계를 기다리지 않습니다.
- 버그 수정에는 재현 테스트를 먼저 추가합니다.
- **학습 시나리오(여러 날)**: 며칠에서 몇 주에 걸친 학습 규칙(복습 간격, 단계 게이트)은 `apps/server/src/test/practice-app.ts`의 `practiceApp()`(실제 임시 user.db, HTTP API, `clock.now`로 움직이는 가짜 시계, Asia/Seoul 학습자)으로 날마다 같은 시각(예: 19:00)에 세션을 돌려 테스트합니다. 예: `routes/simulation.test.ts`(30일), `routes/mastered-gate.test.ts`(3주 `mastered` 게이트). 성공 경로 하나를 두고, 조건 하나만 바꾼 변형마다 결과(단계, `nextStage.missing`)가 **그 조건 하나만** 빠졌음을 확인합니다. FSRS는 실제 ts-fsrs(퍼즈는 개념 ID로 시드)라 결정론적이므로 평가 날짜와 등급(`review_logs`)을 그대로 단언해 흐름이 바뀌면 바로 드러나게 합니다.
- **AI**: 서비스 흐름은 `MockProvider`(시나리오 주입 `enqueue`, 요청 기록 `requests`)로 테스트합니다. Codex 어댑터는 실제 `codex app-server` 교환을 녹화해 재생하는 계약 테스트(`packages/ai/src/provider/codex/replay.test.ts`)와 가짜 `codex`(`fake-codex.mjs`)로 테스트하며, CI는 실제 Codex를 쓰지 않습니다. 다시 녹화하는 법은 [`@proginone/ai` README](/packages/ai/README.md#codex-프로토콜-계약-테스트)에 있습니다.
- **콘텐츠 실행 검증**: `tools/content-cli`의 판정 로직은 가짜 러너(`src/test/fake-runner.ts`)로 테스트합니다. 실제 러너를 쓰는 `src/verify/browser.test.ts`는 Chromium이 없으면 건너뜁니다. 실제 `content/` 전체는 CI e2e 작업의 `pnpm content:check:run --frozen`이 검증합니다([콘텐츠 작성 가이드](/docs/guides/content-authoring.md#contentcheckrun-실행-검증)).

## E2E (Playwright)

`e2e/`에 있습니다. 프로덕션 빌드를 별도 포트(기본 4391, `E2E_PORT`로 변경)와 **새 임시 데이터 위치**로 실행하므로 실제 학습 데이터에 닿지 않습니다.

| 파일 | 내용 |
|---|---|
| `tests/flows.spec.ts` | 핵심 흐름: 내비게이션·포커스, 테마 유지, 백업 생성·복원, 로컬 서버 보안(토큰·Host) |
| `tests/a11y.spec.ts` | 화면 × 라이트/다크에서 axe-core WCAG 2.2 AA 위반 0건(실제 브라우저라 색 대비 포함). 주요 화면, 복습 허브의 각 구역(오답 노트·약점 집중·숙련도 변화), 개념 상세, 빈 상태(복습 네 구역), 오류 상태, 로딩(스켈레톤) 상태, 실습 화면의 문제·피드백·재학습·튜터 |
| `tests/visual.spec.ts` | 화면 × 테마 × 1280/1440 전체 페이지 스크린샷 비교(`@visual`). 주요 화면은 1920, 학습 화면은 1024도. 빈·오류·로딩 상태는 대표 화면 하나씩 1280에서([아래 매트릭스](#시각-회귀-매트릭스-범위)) |
| `tests/state-mocks.ts` | 빈·오류·로딩 상태용 고정 응답(`mockEmptyReview`, `failApi`, `holdLearningApi`)과 약점 개념 목록. 시각 회귀와 접근성 검사가 함께 씀 |
| `tests/sandbox.spec.ts` | 코드 실행 샌드박스: 실행·관측값, 보안 스위트(S1~S49 중 브라우저 항목), 셸 교체·대체 경로 |
| `tests/sandbox-grading.spec.ts` | 러너 ↔ 채점기 계약: `exercise-kit`이 만든 실행 계획을 실제 러너로 돌려 채점(`preventDefault()` 없는 폼 제출이 매번 같은 결과인지 포함) |
| `tests/practice.spec.ts` | 실습 흐름: 레슨 → 연습 세트의 모든 유형 풀이(코드는 실제 러너로 채점) → 힌트 → 단원 통과 |
| `tests/reading.spec.ts` | 읽기 모드: 본문 확인 문제, 읽기 위치 이어 읽기, 활동 하트비트(`page.clock`) |
| `tests/prerequisites.spec.ts` | 설정 > 데이터 전용 서버에서 초기화한 학습자로 단원 선수 개념 경고(막지 않음, 개념·앞 단원 링크, 읽기만 했을 때와 한 번 푼 뒤의 약점 연습)와 선수 개념 숙련도, axe |
| `tests/review.spec.ts` | 대시보드와 다음 날 복습: 테스트 시계를 하루 넘겨 복습 세트를 풀고 끝냄 |
| `tests/ai-unavailable.spec.ts` | AI 비가용 상태: 실패한 답변의 오류 표시(모의 제공자의 `[mock:error:AI_*]`), 연결 해제 시 AI 진입점 비활성·서버 거부·오답 설명 대체, 다시 연결 |
| `tests/data-settings.spec.ts` | 설정 > 데이터 전용 서버에서 백업 → 데이터 변경 → 복원으로 복구, 학습 데이터 초기화(온보딩으로) → "초기화 전" 백업으로 되돌리기, 백업 위치 변경(잘못된 경로 거부, 새 위치에 증명 백업, 원래 위치로 복귀) |
| `tests/journey.spec.ts` | 첫 실행 전용 서버에서 새 학습자의 흐름: 온보딩 → 빈 대시보드 → 첫날(단원 연습) → 한 달(복습·약점, 테스트 시계) → 약점 집중 세트. 온보딩 목표 단계와 대시보드 빈·신규·장기 상태 시각 회귀(장기 상태는 1920도), 빈·장기 대시보드의 다크 모드 axe |
| `tests/full-journey.spec.ts` | 전체 학습 흐름 전용 서버에서 한 학습자가 처음부터 끝까지(M7, PRD MVP 완료 정의 4, D-066): 온보딩 → 대시보드에서 첫 단원 읽기(본문 확인 문제, 끝까지 스크롤) → 연습 세트 12문제(오답·힌트 포함, 코드는 실제 러너) → 단원 평가(규칙, 문항당 한 번, 통과) → 테스트 시계로 첫 복습일 → 복습 큐 세트 → 오답 노트에서 다시 풀기 → 학습 목표 변경 → 백업 → 목표 다시 변경 → 복원으로 되돌림(학습 기록 유지). 단계마다 axe |
| `tests/seed.ts` | API로 학습 기록 만들기: 실행이 필요 없는 문제는 답하고 나머지는 건너뛰어 세트를 끝냄, 하트비트로 학습 시간 |
| `tests/mastered.spec.ts` | `mastered` 게이트 전용 서버에서 3주(테스트 시계): 단원 연습 → 숙련과 "숙달까지" 조건 목록 → 예정일 복습 → 1주 뒤 단원 평가 → 1주 뒤 다시 연습 → 개념 상세·개념 지도에 숙달 |
| `tests/templates.spec.ts` | 템플릿 전용 서버에서 파라메트릭 템플릿 변형: 단원 연습이 변형을 일반 문제처럼 내고 채점, "한 번 더 연습"과 기한이 된 복습이 새 변형을 냄, 변형의 "문제 신고" |
| `tests/onboarded.setup.ts` | 준비 단계(`setup` 프로젝트): 주 서버의 학습자를 온보딩 완료 상태로 둠 |

- 처음 한 번 `pnpm --filter @proginone/e2e exec playwright install chromium`으로 브라우저를 설치합니다.
- **서버 여섯 개**: 주 서버(`E2E_PORT`), 첫 실행 전용 서버(`E2E_PORT + 1`, 데이터 위치 `E2E_JOURNEY_DATA_DIR`), 설정 > 데이터 전용 서버(`E2E_PORT + 2`, 데이터 위치 `E2E_DATA_SETTINGS_DIR`), `mastered` 게이트 전용 서버(`E2E_PORT + 3`, 데이터 위치 `E2E_MASTERY_DATA_DIR`, 주소 `E2E_MASTERY_URL`), 파라메트릭 템플릿 전용 서버(`E2E_PORT + 4`, 데이터 위치 `E2E_TEMPLATES_DATA_DIR`, 주소 `E2E_TEMPLATES_URL`, 콘텐츠는 기본 픽스처 + `fixtures/content-templates`), 전체 학습 흐름 전용 서버(`E2E_PORT + 5`, 데이터 위치 `E2E_FULL_JOURNEY_DATA_DIR`, 주소 `E2E_FULL_JOURNEY_URL`, 콘텐츠는 기본 픽스처 + `fixtures/content-mastery`)를 띄웁니다. 주 서버의 학습자는 `setup` 프로젝트가 먼저 온보딩을 마친 상태로 만듭니다. 새 학습자가 필요한 테스트는 `test.use({ baseURL: process.env['E2E_JOURNEY_URL'] })`로 두 번째 서버를 씁니다(D-034). 복원·초기화·백업 위치 변경처럼 학습자 전체를 바꾸는 테스트는 `E2E_DATA_SETTINGS_URL`의 세 번째 서버를 씁니다(D-045).
- 테스트는 서버를 공유하며 순서대로 실행됩니다(`workers: 1`). 앞 테스트가 만든 상태(예: 백업)를 뒤 테스트가 가정하지 않도록, 각 테스트는 필요한 상태를 직접 만들거나 확인합니다.
- 샌드박스 테스트는 앱 화면이 아직 러너를 쓰지 않으므로, `packages/runner`의 호스트 모듈을 테스트에서 번들해 앱 페이지에 `page.evaluate`로 넣고 실행합니다(DevTools 평가는 페이지 CSP를 받지 않음). 앱 문서와 CSP, 서버의 `/sandbox/runner.html`, 셸·하네스는 모두 실제 프로덕션 빌드입니다. 공격 코드가 노린 요청이 서버에 닿았는지는 테스트가 띄운 탐지용 서버와 페이지의 응답 기록으로 확인합니다.
- E2E 콘텐츠는 `e2e/fixtures/content`(문제는 draft로 저작, `includeDrafts`로 빌드)입니다. 한 서버만 더 많은 콘텐츠가 필요하면 공유 콘텐츠를 바꾸지 않고 덮어쓰기 디렉터리를 둡니다(`buildFixtureContent(out, 'content-mastery')`: `e2e/fixtures/content-mastery`를 픽스처 위에 복사해 모듈 1 단원 평가를 더함, `mastered` 게이트 서버 전용). 예측 문제의 기대값은 `node tools/content-cli/src/cli.ts check --dir e2e/fixtures/content --run`으로 `.generated/predict-expected.json`에 기록해 커밋합니다. 실제 `content/`가 바뀌어도 E2E와 시각 기준 이미지가 흔들리지 않게 따로 둡니다.
- **테스트 시계**: E2E 서버는 `PROGINONE_TEST_CLOCK_FILE=<데이터 위치>/clock-offset-ms`로 시작합니다. 서버의 학습 서비스(복습 일정, 하루 경계, 활동 시간)는 이 파일의 밀리초만큼 미래로 옮긴 시각을 씁니다(`tests/clock.ts`의 `shiftServerClock`). 학습 상태를 찍는 시각 회귀는 `setServerTime(고정 시각, 'journey')`으로 서버 시각을 고정해 날짜·요일이 실행일과 상관없이 같게 합니다. 이 환경 변수는 E2E 설정에서만 쓰며, 일반 실행에서는 설정하지 않습니다(설정되면 시작 로그에 경고).
- 실패하면 `e2e/test-results/`의 트레이스를 `pnpm --filter @proginone/e2e exec playwright show-trace <trace.zip>`으로 엽니다.

## 호환성 점검 (Firefox·WebKit)

PRD NFR-10의 점검 범위 브라우저에서 샌드박스 정책 계열과 핵심 흐름을 확인합니다([호환성 점검 기록](/docs/reviews/2026-11-16-m7-compatibility.md)).

```shell
pnpm --filter @proginone/e2e exec playwright install firefox webkit   # 처음 한 번
pnpm test:e2e:compat
```

- `PW_COMPAT=firefox|webkit`이면 E2E 설정이 그 브라우저의 프로젝트 하나만 만들고, `sandbox`·`sandbox-grading`·`flows`·`reading`·`practice` 스펙만 실행합니다. 흐름 테스트가 학습자 상태를 바꾸므로 브라우저마다 서버를 새로 띄웁니다(명령이 두 번 실행).
- Firefox는 출시판처럼 사이트 격리(Fission)를 켠 설정으로 실행합니다.
- 브라우저별로 알려진 차이로 판단해 건너뛰는 테스트는 `test.skip(browserName === …, '이유')`로 표시하고 호환성 점검 기록에 남깁니다.

## 성능 측정

```shell
pnpm perf                      # 빌드 후 측정
PERF_CPU_THROTTLE=4 pnpm --filter @proginone/e2e perf   # 4배 느린 CPU로(여유 확인)
```

- 프로덕션 빌드, 실제 콘텐츠 팩(승인된 문제만), 임시 데이터 위치의 새 학습자, 포트 4660(`PERF_PORT`)으로 Chromium에서 측정합니다(`e2e/perf.config.ts`, `e2e/perf/`).
- 측정 구간은 페이지 안에서 잽니다: 시작은 클릭·키 입력 이벤트 또는 내비게이션 시작, 끝은 기대한 요소가 문서에 있는 첫 애니메이션 프레임입니다. Playwright 왕복 시간은 들어가지 않습니다.
- 항목마다 여러 번(`PERF_ROUNDS`, 기본 5) 재고 중앙값을 목표와 비교합니다. 결과 JSON은 `e2e/perf-results/`(git 무시)에 남고 표로 출력됩니다.
- 시간 측정은 기계 상태에 따라 흔들리므로 CI에서 돌리지 않습니다. CI는 결정론적인 첫 화면 번들 크기 예산(`pnpm check:bundle`)만 검사합니다(D-064).

## 설치된 앱 스모크 테스트

이미 실행 중인 앱(릴리스 번들 등)을 검사합니다. 서버를 띄우지 않으며 학습자 상태를 바꾸므로 임시 데이터 위치로 띄운 앱에만 씁니다. 절차는 [릴리스 산출물 확인](/docs/guides/release.md#릴리스-산출물-확인)에 있습니다.

```shell
SMOKE_URL=http://127.0.0.1:4661 pnpm --filter @proginone/e2e smoke --project=chromium
```

## 시각 회귀

- 기준 이미지는 `e2e/tests/__screenshots__/`에 커밋합니다. 글꼴 렌더링이 OS마다 달라서 **반드시 Docker(`pnpm test:e2e:visual`)에서 만들고 비교**합니다. 로컬 `pnpm test:e2e`는 `@visual` 테스트를 건너뜁니다.
- 매번 바뀌는 값(백업 시각·크기 등)은 고정 응답(`page.route`)으로 바꾸거나 `mask`로 가립니다.
- 빈·오류·로딩 상태는 `tests/state-mocks.ts`의 고정 응답으로 만듭니다. 로딩은 학습 API 응답을 붙잡아 두어(`holdLearningApi`) 스켈레톤을 고정하고, `animations: 'disabled'`로 반짝임을 멈춥니다.
- 화면을 의도적으로 바꿨다면 `pnpm test:e2e:visual --update`로 다시 만들고, PR에서 이미지 차이를 직접 확인한 뒤 커밋합니다.
- 로컬 Docker를 쓸 수 없으면 GitHub Actions의 `visual-baselines` 워크플로로 같은 이미지에서 기준 이미지를 만듭니다: `gh workflow run visual-baselines.yml --ref <브랜치>`로 실행하고, 끝나면 `gh run download <실행 ID> -n visual-baselines -D e2e/tests/__screenshots__`로 받아 차이를 확인한 뒤 커밋합니다. 워크플로는 커밋하거나 푸시하지 않습니다.
- CI가 실패하면 `playwright-report` 아티팩트의 차이 이미지를 확인합니다.

### 시각 회귀 매트릭스 범위

[UI/UX 설계의 매트릭스](/docs/design/ui-ux.md#시각-회귀-매트릭스) 가운데 기준 이미지가 있는 칸입니다(2026-11-16, 118장). 모든 칸은 라이트·다크 두 장입니다. 우선순위와 이유는 [D-065](/docs/decisions.md)에 있습니다.

| 화면 | 1280·1440 | 1920 | 1024 | 상태 |
|---|---|---|---|---|
| 대시보드 | 빈·신규·장기(`journey`) | 장기 | — | 로딩(1280) |
| 온보딩(목표 단계) | 정상 | — | — | — |
| 과정 목록·과정 상세 | 정상 | — | — | — |
| 읽기 모드 | 정상(첫 방문) | 정상 | 정상 | — |
| 실습 모드 | 객관식 피드백·재학습 카드·코드 문제 | 코드 문제 | 코드 문제 | — |
| 튜터 드로어 | 열림 | — | — | — |
| 단원 평가 | 시작·결과 | — | — | — |
| 프로젝트 | 진행 중(`project`) | — | — | — |
| 복습 허브 | 오늘의 복습 | 오늘의 복습 | — | 빈·오류(1280) |
| 오답 노트 | 목록·상세 | — | — | 빈(1280) |
| 약점 집중·숙련도 변화 | 정상 | — | — | — |
| 설정(AI·학습 방식·화면·데이터·학습 목표) | 정상 | 데이터 | — | — |

아직 없는 칸(후속 과제):

- 1920: 과정, 단원 평가, 튜터 드로어, 오답 노트, 설정의 나머지 화면. 이 화면들은 최대 너비가 정해진 한 단 배치라 1440과 차이가 여백뿐입니다.
- 1024: 튜터 드로어, 객관식·파슨스 문제, 단원 평가. 1024 배치는 `responsive.spec.ts`가 기능으로 확인합니다(가로 스크롤 없음, 드로어 겹침).
- 상태: 화면별 오류·로딩(공통 컴포넌트 `QueryState`·`ErrorState`·`Skeleton`이라 대표 하나로 봄), 실습 모드의 예측·파슨스 유형(1280·1440).
- 컴포넌트 단위 촬영: 설계의 컴포넌트 카탈로그 페이지(`/__catalog`)가 아직 없습니다. 컴포넌트 상태는 `packages/ui`의 Vitest 테스트가 확인합니다.

## 관련 문서

- [시작하기](/docs/guides/getting-started.md)
- [기여 가이드 완료 정의](/CONTRIBUTING.md#완료-정의-definition-of-done)
- [UI/UX 설계 시각 회귀 매트릭스](/docs/design/ui-ux.md#시각-회귀-매트릭스)

## CI 실행 환경

- 기본은 GitHub 호스트 runner입니다. 저장소 변수 `CI_RUNNER`가 `self-hosted`이면 같은 검사를 소유자 Mac의 self-hosted runner(`mac-proginone`)에서 돌립니다([D-055](/docs/decisions.md)).
- self-hosted에서는 e2e·시각 회귀를 `tools/e2e-docker.sh`로 CI와 같은 Playwright 이미지에서 실행하므로 기준 이미지가 호환됩니다. Mac에서 Docker(Docker Desktop)가 켜져 있어야 합니다.
- 전환: `gh variable set CI_RUNNER --body self-hosted`, 복귀: `gh variable delete CI_RUNNER`.
- runner는 같은 Mac에 두 개(`mac-proginone` = `~/actions-runner`, `mac-proginone-2` = `~/actions-runner-2`)이고 작업이 동시에 두 개 돕니다. 두 runner가 `$HOME`을 같이 쓰므로 `pnpm/action-setup`은 runner별 임시 폴더(`runner.temp`)에 설치합니다.
- CI를 기다릴 때는 `gh run watch <id> --interval 120 --exit-status`처럼 간격을 넓힙니다. 기본 3초 간격으로 여러 곳에서 기다리면 GitHub API 한도(시간당 5,000회)를 금방 넘습니다.
- runner 관리: 각 runner 폴더(`~/actions-runner`, `~/actions-runner-2`)에서 `./svc.sh status`·`./svc.sh stop`·`./svc.sh start`. 제거는 `./svc.sh uninstall` 후 `./config.sh remove --token <GitHub에서 받은 제거 토큰>`.
- 저장소를 공개로 바꾸기 전에는 self-hosted runner를 반드시 제거합니다.
