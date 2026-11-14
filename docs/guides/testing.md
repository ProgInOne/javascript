# 테스트 가이드

ProgInOne의 테스트 종류, 실행 방법, 작성 규칙입니다.

- 대상: 기여자
- 최종 수정: 2026-11-14
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
- **콘텐츠 실행 검증**: `tools/content-cli`의 판정 로직은 가짜 러너(`src/test/fake-runner.ts`)로 테스트합니다. 실제 러너를 쓰는 `src/verify/browser.test.ts`는 Chromium이 없으면 건너뜁니다. 실제 `content/` 전체는 CI e2e 작업의 `pnpm content:check:run --frozen`이 검증합니다([콘텐츠 작성 가이드](/docs/guides/content-authoring.md#contentcheckrun-실행-검증)).

## E2E (Playwright)

`e2e/`에 있습니다. 프로덕션 빌드를 별도 포트(기본 4391, `E2E_PORT`로 변경)와 **새 임시 데이터 위치**로 실행하므로 실제 학습 데이터에 닿지 않습니다.

| 파일 | 내용 |
|---|---|
| `tests/flows.spec.ts` | 핵심 흐름: 내비게이션·포커스, 테마 유지, 백업 생성·복원, 로컬 서버 보안(토큰·Host) |
| `tests/a11y.spec.ts` | 화면 × 라이트/다크에서 axe-core WCAG 2.2 AA 위반 0건(실제 브라우저라 색 대비 포함) |
| `tests/visual.spec.ts` | 화면 × 테마 × 1280/1440 전체 페이지 스크린샷 비교(`@visual`) |
| `tests/sandbox.spec.ts` | 코드 실행 샌드박스: 실행·관측값, 보안 스위트(S1~S48 중 브라우저 항목), 셸 교체·대체 경로 |
| `tests/sandbox-grading.spec.ts` | 러너 ↔ 채점기 계약: `exercise-kit`이 만든 실행 계획을 실제 러너로 돌려 채점 |
| `tests/practice.spec.ts` | 실습 흐름: 레슨 → 연습 세트의 모든 유형 풀이(코드는 실제 러너로 채점) → 힌트 → 단원 통과 |
| `tests/reading.spec.ts` | 읽기 모드: 본문 확인 문제, 읽기 위치 이어 읽기, 활동 하트비트(`page.clock`) |
| `tests/review.spec.ts` | 대시보드와 다음 날 복습: 테스트 시계를 하루 넘겨 복습 세트를 풀고 끝냄 |

- 처음 한 번 `pnpm --filter @proginone/e2e exec playwright install chromium`으로 브라우저를 설치합니다.
- 테스트는 서버 하나를 공유하며 순서대로 실행됩니다(`workers: 1`). 앞 테스트가 만든 상태(예: 백업)를 뒤 테스트가 가정하지 않도록, 각 테스트는 필요한 상태를 직접 만들거나 확인합니다.
- 샌드박스 테스트는 앱 화면이 아직 러너를 쓰지 않으므로, `packages/runner`의 호스트 모듈을 테스트에서 번들해 앱 페이지에 `page.evaluate`로 넣고 실행합니다(DevTools 평가는 페이지 CSP를 받지 않음). 앱 문서와 CSP, 서버의 `/sandbox/runner.html`, 셸·하네스는 모두 실제 프로덕션 빌드입니다. 공격 코드가 노린 요청이 서버에 닿았는지는 테스트가 띄운 탐지용 서버와 페이지의 응답 기록으로 확인합니다.
- E2E 콘텐츠는 `e2e/fixtures/content`(문제는 draft로 저작, `includeDrafts`로 빌드)입니다. 예측 문제의 기대값은 `node tools/content-cli/src/cli.ts check --dir e2e/fixtures/content --run`으로 `.generated/predict-expected.json`에 기록해 커밋합니다. 실제 `content/`가 바뀌어도 E2E와 시각 기준 이미지가 흔들리지 않게 따로 둡니다.
- **테스트 시계**: E2E 서버는 `PROGINONE_TEST_CLOCK_FILE=<데이터 위치>/clock-offset-ms`로 시작합니다. 서버의 학습 서비스(복습 일정, 하루 경계, 활동 시간)는 이 파일의 밀리초만큼 미래로 옮긴 시각을 씁니다(`tests/clock.ts`의 `shiftServerClock`). 이 환경 변수는 E2E 설정에서만 쓰며, 일반 실행에서는 설정하지 않습니다(설정되면 시작 로그에 경고).
- 실패하면 `e2e/test-results/`의 트레이스를 `pnpm --filter @proginone/e2e exec playwright show-trace <trace.zip>`으로 엽니다.

## 시각 회귀

- 기준 이미지는 `e2e/tests/__screenshots__/`에 커밋합니다. 글꼴 렌더링이 OS마다 달라서 **반드시 Docker(`pnpm test:e2e:visual`)에서 만들고 비교**합니다. 로컬 `pnpm test:e2e`는 `@visual` 테스트를 건너뜁니다.
- 매번 바뀌는 값(백업 시각·크기 등)은 `mask`로 가립니다.
- 화면을 의도적으로 바꿨다면 `pnpm test:e2e:visual --update`로 다시 만들고, PR에서 이미지 차이를 직접 확인한 뒤 커밋합니다.
- CI가 실패하면 `playwright-report` 아티팩트의 차이 이미지를 확인합니다.

## 관련 문서

- [시작하기](/docs/guides/getting-started.md)
- [기여 가이드 완료 정의](/CONTRIBUTING.md#완료-정의-definition-of-done)
- [UI/UX 설계 시각 회귀 매트릭스](/docs/design/ui-ux.md#시각-회귀-매트릭스)
