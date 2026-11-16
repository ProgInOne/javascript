# M7 호환성 점검 (2026-11-16)

PRD NFR-10의 점검 범위 브라우저에서 샌드박스 정책과 핵심 흐름을 확인하고, macOS에서 v0.3.0 릴리스 번들을 설치·실행한 결과입니다. 로드맵 M7 작업 5, M6 P0 점검의 NFR-10 "부분" 항목을 다룹니다.

- 대상: v0.3.0 이후 `main`(커밋 `f029294` 기준)과 v0.3.0 GitHub Release 번들
- 실행 방법: `pnpm test:e2e:compat`(`PW_COMPAT=firefox|webkit`), `pnpm --filter @proginone/e2e smoke`, 결정 [D-064](/docs/decisions.md)
- 결론: **Firefox와 WebKit에서 샌드박스 보안 경계는 모두 지켜집니다**(서버에 닿은 요청 0건, 앱 문서·저장소·최상위 창 접근 차단). 차이는 오류 문구·열 번호, 차단된 탐색의 결과 종류, 그리고 이미 설계에 적힌 WebKit의 메인 스레드 공유입니다. 릴리스 번들은 macOS에서 설명대로 설치·실행·종료되고 네 브라우저(Chromium, Chrome, Firefox, WebKit)에서 스모크 테스트를 통과했습니다.

## 환경

| 항목 | 값 |
|---|---|
| OS | macOS 26.6.2 (Apple M1 Pro) |
| Node.js / pnpm | 24.14.0 / 12.15.0 |
| Playwright | 1.65.1 |
| Chromium(Playwright, new headless) | 159.0.8154.6 |
| Google Chrome(설치본, `channel: 'chrome'`) | 157.0.8103.52 |
| Firefox(Playwright) | 159.0, 사이트 격리(Fission) 켬 — 출시판 기본값과 같게 |
| WebKit(Playwright) | 27.2 — 실제 Safari와 다를 수 있음 |

실제 Safari와 실제 Firefox 출시판은 Playwright로 자동화할 수 없어 이번 범위에 넣지 않았습니다([남은 확인](#남은-확인)).

## 브라우저별 E2E 결과

범위: 샌드박스 정책·계측 계열(`sandbox.spec.ts` 보안 스위트 S1~S49의 브라우저 항목, `sandbox-grading.spec.ts` 러너 ↔ 채점기 계약)과 핵심 흐름(`flows.spec.ts` 내비게이션·테마·백업 복원·토큰·Host 검사, `reading.spec.ts`, `practice.spec.ts` 9개 유형 풀이와 실제 러너 채점). 41개 테스트(준비 단계 포함).

| 브라우저 | 처음 실행(테스트 조정 전) | 조정 후 | 건너뜀 |
|---|---|---|---|
| Chromium | 전체 E2E 통과(기존 CI 범위) | 변화 없음 | — |
| Firefox(Fission) | 31 통과, 10 실패 | 39 통과 | 2 |
| WebKit | 34 통과, 7 실패 | 40 통과 | 1 |

기계 부하가 매우 높을 때(load average 50 이상) Firefox에서 셸 준비 시간 초과("실행 환경을 준비하지 못했습니다")와 실습 흐름 시간 초과가 한 번씩 있었고, 부하가 내려간 뒤 다시 실행하면 통과했습니다. 실습 흐름은 다른 엔진에서 `test.slow()`로 제한 시간을 늘렸습니다.

처음 실행의 실패를 하나씩 원인별로 나눴습니다. "조정"은 Chromium의 단언은 그대로 두고, 다른 엔진에서만 엔진 차이를 허용하거나 건너뛰는 것입니다(`browserName` 분기, `forEngine` 도우미).

### 엔진 차이 (보안·기능 문제 아님)

| 차이 | 브라우저 | 근거 테스트 | 판단 |
|---|---|---|---|
| 오류 메시지 문구가 V8과 다름. 예: `nickname = 1` → Firefox "assignment to undeclared variable nickname", WebKit "Can't find variable: nickname"; `console.log("셋";` → WebKit "Unexpected token ';'. Expected ')' to end an argument list." | Firefox, WebKit | D-026, D-030 | 설계대로(D-030: 엔진 문구를 그대로 보여 줌, E2E는 Chromium 문구만 검사). 다른 엔진에서는 문구와 열을 빼고 파일·줄·종류만 검사 |
| 오류 열 번호가 다름(예: 같은 `TypeError`가 47 → Firefox 42, WebKit 46). WebKit은 문법 오류에 열을 주지 않음 | Firefox, WebKit | 같음 | 위와 같음. 줄 번호와 파일 매핑은 모든 엔진에서 일치 |
| 무한 재귀가 `RangeError`가 아니라 `InternalError: too much recursion` | Firefox | S31 | 학습자에게는 그대로 보임. 아래 [개선 후보](#개선-후보) 1 |
| 샌드박스 안 `window.open()`이 `null` 대신 `InvalidAccessError`를 던짐 | Firefox | S14~S23 | 둘 다 창이 열리지 않음(열린 페이지 1개 확인). 허용 |
| 중첩 문서의 `location.href = …`(S11)가 즉시 `NavigationError`가 아니라 실행 시간 제한(3초)까지 기다린 뒤 "시간 초과" | Firefox, WebKit | S11 | 요청은 서버에 닿지 않음(누출 검사 통과). 학습자에게는 덜 구체적인 결과. [개선 후보](#개선-후보) 2 |
| 취소하지 않은 폼 제출(S49)에서 `dispatch` 단계 관측값 하나가 먼저 기록됨 | WebKit | S49 | 결과는 매번 같은 `NavigationError`이고 제출 뒤 단계는 관측되지 않음(결정론 유지). 다섯 번 실행의 관측값이 같은지로 검사 |

### 설계에 적힌 제약

| 제약 | 브라우저 | 근거 테스트 | 판단 |
|---|---|---|---|
| 계측을 빠져나간 무한 루프(마이크로태스크 무한 반복)가 셸과 함께 앱 화면과 Watchdog까지 멈춤. 다음 실행이 돌아오지 않음 | WebKit | S48 | [코드 실행 샌드박스 설계](/docs/design/code-execution-sandbox.md)의 장애 복구 표("메인 스레드 공유 브라우저: WebKit/Safari — 복구 없음")와 같음. M1-B PoC 결과와도 같음. WebKit에서는 건너뜀 |

반복문 계측으로 잡는 일반 무한 루프(S26~S30)는 WebKit에서도 멈추고 보고합니다.

### 테스트 도구 제약 (앱 문제 아님)

Playwright의 Firefox는 사이트 격리(Fission)를 공식 지원하지 않습니다. Fission을 켜면 다음이 실패했고, **같은 테스트를 Fission을 끄고 실행하면 모두 통과**했습니다.

| 증상 | 근거 테스트 | 처리 |
|---|---|---|
| 프로세스 밖 iframe(셸의 `*.localhost` 사이트, 미리보기 문서) 안을 볼 수 없음: `page.frames()`에 셸이 없고 `frameLocator`가 비어 있음 | D-030 미리보기 유지, 미리보기 링크·폼 취소, 셸별 사이트, 실습 흐름의 웹 실습 미리보기 | Firefox에서 해당 확인만 건너뜀(`FISSION_FRAMES`). 실행·채점 결과는 계속 검사 |
| 셸을 띄운 페이지의 새로 고침·`page.goto`가 `load`(또는 `commit`)를 끝내지 못함 | 실습 흐름의 새로 고침, 스모크 테스트의 설정 화면 이동 | Firefox에서 새로 고침을 건너뜀. 스모크 테스트는 앱 안 링크로 이동 |
| axe 검사 중 페이지가 멈춤(`Page crashed`) | 실습 흐름의 axe | Firefox에서 건너뜀. 접근성(NFR-13)은 Chromium `a11y.spec.ts`가 검사 |

Fission을 켠 이유는 출시판 Firefox의 기본값이고, 셸을 셸마다 다른 사이트에 두는 설계(D-018)가 Fission에서 앱 응답성을 지키는지가 핵심 확인 대상이기 때문입니다. 그 확인(S26 앱 응답성, S27~S31 계측, 네트워크·격리 계열)은 Fission을 켠 채 모두 통과했습니다.

## 릴리스 번들 설치·실행 (macOS)

v0.3.0 GitHub Release의 번들을 임시 폴더에 받아 [설치와 업그레이드](/docs/guides/install-and-upgrade.md) 절차대로 설치했습니다. 데이터 위치는 임시 폴더(`PROGINONE_DATA_DIR`), 포트는 4661, Codex는 없는 경로로 두어 실제 학습 데이터와 Codex 로그인에 닿지 않게 했습니다.

| 단계 | 결과 |
|---|---|
| `gh release download v0.3.0` | `proginone-0.3.0.tar.gz`(35MB), `.sha256` |
| `shasum -a 256 -c` | `OK` |
| 압축 풀기 | `apps/web/dist`, `content/dist/content.db` 포함 확인 |
| `pnpm install --prod --frozen-lockfile` | 1초(로컬 pnpm 저장소 재사용), 391개 패키지 |
| `pnpm start` | 마이그레이션 6개 적용, 콘텐츠 팩 `2026.11.14.1` 로드, 첫 일일 백업 생성, `http://127.0.0.1:4661`에서 시작 |
| 스모크 테스트 | Chromium·Google Chrome·Firefox·WebKit 모두 통과: 토큰 없는 API 401, 대시보드, 과정 3개, 과정 상세 → 레슨, 실제 샌드박스 실행(콘솔 출력)과 채점, 설정 > 데이터 백업 목록 |
| `Ctrl+C`(SIGINT) | "종료합니다." 로그, WAL 체크포인트(`user.db-wal`·`-shm` 없음), 잠금 파일 해제 |
| 같은 데이터로 다시 시작 | 정상 시작, 다시 종료 |

발견한 점:

- `--prod`로 설치하면 `pnpm start` 때마다 pnpm이 의존성 상태를 다시 확인하며 "Workspace package @proginone/e2e has dependencies but does not have a modules directory" 경고를 냅니다. 실행에는 영향이 없어 설치 가이드에 적었습니다.
- "Agent skills awaiting approval: @tanstack/react-router" 안내가 나옵니다. 승인할 필요가 없으며 설치 가이드에 적었습니다.
- 번들에는 `poc/`, `design/`, `e2e/` 등 실행에 필요 없는 추적 파일도 들어 있습니다(`git archive` 전체). 크기(35MB)에 큰 영향이 없어 그대로 둡니다.

## 개선 후보

| 번호 | 내용 | 영향 | 예상 규모 |
|---|---|---|---|
| 1 | 러너가 Firefox의 `InternalError: too much recursion`을 `RangeError`처럼 설명("함수가 자기 자신을 끝없이 부르고 있어요")하도록 콘솔 설명 대응표에 추가 | Firefox 학습자의 오류 설명 | 반영함(D-074) |
| 2 | 하네스가 중첩 문서의 `pagehide`/`unload`도 탐색으로 보고해, Firefox·WebKit의 S11이 시간 초과 대신 즉시 `NavigationError`가 되게 | 학습자가 받는 결과의 정확성 | 반나절(엔진별 확인 포함) |
| 3 | 콘솔의 학습자 언어 설명이 V8 문구(`is not defined`, `Assignment to constant variable` 등)에 맞춰져 있음. Firefox·WebKit 문구도 대응 | 다른 브라우저의 오류 설명 | 반영함(D-074) |
| 4 | Firefox·WebKit 호환성 실행을 CI에 넣기(설계의 브라우저 매트릭스) | 회귀 조기 발견 | GitHub 호스트 runner 복귀 뒤 결정(D-064) |

보장 범위는 macOS + 최신 Chrome이므로(NFR-10) 위 항목은 v1.0 출시를 막지 않습니다. 알려진 문제로 릴리스 노트에 적습니다.

## 남은 확인

- **실제 Safari**: 설정 > 고급 > "웹 개발자용 기능 보기" 후 개발자 메뉴에서 "원격 자동화 허용"을 켜면 `safaridriver`로 자동화할 수 있지만 사용자 설정이 필요해 이번에는 하지 않았습니다. 릴리스 전 수동 점검 항목: `*.localhost` 셸 사이트 해석(안 되면 같은 사이트 대체 경로가 동작하는지), 코드 실행·채점, 마이크로태스크 무한 루프 시 탭이 멈추는지(WebKit과 같다고 가정).
- **실제 Firefox 출시판**: Fission에서 Playwright가 못 하는 확인(미리보기 문서 표시, 셸 페이지 새로 고침)을 수동으로 확인합니다.
- **Edge**: Chromium 계열이라 Chrome과 같은 결과를 가정합니다.

## 다시 실행하는 법

```shell
pnpm --filter @proginone/e2e exec playwright install firefox webkit   # 처음 한 번
pnpm test:e2e:compat
```

릴리스 번들 확인은 [릴리스 절차 > 릴리스 산출물 확인](/docs/guides/release.md#릴리스-산출물-확인)을 따릅니다.

## 관련 문서

- [PRD 비기능 요구사항 NFR-10](/docs/product/prd.md)
- [코드 실행 샌드박스 설계](/docs/design/code-execution-sandbox.md)
- [M6 P0 요구사항 점검](/docs/reviews/2026-11-15-m6-p0-audit.md)
- [M7 성능 점검](/docs/reviews/2026-11-16-m7-performance.md)
