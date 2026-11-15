# 디버깅 가이드

ProgInOne에서 문제가 생겼을 때 로그와 데이터를 보고 원인을 찾는 방법입니다.
AI 튜터(Codex), 코드 실행 샌드박스, 데이터베이스·백업·마이그레이션 순서로 다룹니다.

- 대상: 기여자, 앱을 직접 실행하는 학습자
- 최종 수정: 2026-11-15
- 관련 문서: [시작하기](/docs/guides/getting-started.md), [테스트 가이드](/docs/guides/testing.md), [AI 시스템 설계](/docs/design/ai-system.md), [코드 실행 샌드박스 설계](/docs/design/code-execution-sandbox.md), [데이터 모델 설계](/docs/design/data-model.md)

## 먼저 확인할 것

| 증상 | 먼저 볼 곳 |
|---|---|
| 화면에 오류 문구가 보임 | 브라우저 개발자 도구의 네트워크 탭에서 실패한 `/api/v1/...` 응답의 `error.code`. 아래 [자주 보는 오류 코드](#자주-보는-오류-코드) |
| AI 튜터가 답하지 않음 | 헤더의 AI 상태 표시와 **설정 > AI**. 아래 [AI·Codex 문제 진단](#aicodex-문제-진단) |
| 코드 실행·채점이 멈춤 | 실행 결과 영역의 상태 문구와 브라우저 콘솔. 아래 [샌드박스·러너 문제](#샌드박스러너-문제) |
| 서버가 시작되지 않음 | 서버를 실행한 터미널의 마지막 로그 줄. 아래 [데이터베이스·백업·마이그레이션](#데이터베이스백업마이그레이션) |

## 로그

서버 로그는 파일이 아니라 **서버를 실행한 터미널(표준 출력)**에 나옵니다.

- 프로덕션(`pnpm start`)은 한 줄에 JSON 하나(pino)입니다. 개발 모드(`pnpm dev`)는 사람이 읽기 쉬운 형식입니다.
- 자세한 로그는 `PROGINONE_LOG_LEVEL=debug`로 봅니다. Codex의 표준 오류(`codex.stderr`)는 `debug`에서만 나옵니다.

    ```shell
    PROGINONE_LOG_LEVEL=debug pnpm start | pnpm --filter @proginone/server exec pino-pretty
    ```

- 세션 토큰(`x-proginone-token`)은 로그에서 `[redacted]`로 가려집니다. AI 프롬프트와 응답 원문은 로그와 DB에 남기지 않습니다(대화는 `tutor_messages`에 있음).

자주 찾는 로그 이벤트:

| 이벤트 | 뜻 |
|---|---|
| `codex.status` | AI 연결 상태 변화(`starting`, `ready`, `logged_out`, `rate_limited`, `isolation_failed`, `error` …) |
| `codex.process.spawn` / `codex.process.exit` / `codex.process.restart_scheduled` | Codex 자식 프로세스 시작·종료·재시작 예약(1→30초 백오프, 5회 실패하면 멈춤) |
| `codex.isolation.failed`, `codex.isolation.thread_failed` | 튜터 격리 검증 실패(기능 플래그, 홈 경로, 스레드 실효 설정). 튜터를 끕니다 |
| `codex.approval.declined`, `codex.tool_item` | Codex가 도구를 쓰려고 해 자동 거부·턴 중단 |
| `codex.turn.failed` | 턴 실패와 Codex 오류 종류(`kind`: `usageLimitExceeded`, `unauthorized` 등) |
| `tutor.reply failed`, `tutor.hint fell back to the authored hint` | 튜터 답변 실패, AI 힌트가 저작 힌트로 대체됨 |
| `session.summarize stored` / `failed`, `misconception.propose applied` / `failed` | 장기 기억 요약과 오개념 제안(백그라운드) |
| `user.db migrated`, `tutor messages marked interrupted` | 시작 시 마이그레이션 적용, 비정상 종료로 끊긴 답변 정리 |

## 데이터 위치

| 실행 방법 | 데이터 위치 |
|---|---|
| `pnpm start` (macOS) | `~/Library/Application Support/ProgInOne/` |
| `pnpm start` (그 밖의 OS) | OS 표준 데이터 폴더의 `ProgInOne/` |
| `pnpm dev` | 저장소의 `.data/` |
| E2E | 실행마다 만드는 임시 폴더 |
| 직접 지정 | `PROGINONE_DATA_DIR` |

```text
<데이터 위치>/
├── user.db (+ -wal, -shm)  # 학습 기록. SQLite WAL 모드
├── config.json             # 선택. 환경 변수 다음 우선순위의 설정
├── backups/                # 자동·수동 백업 (PROGINONE_BACKUP_DIR로 변경)
├── codex-home/             # 튜터 전용 CODEX_HOME: 기능 플래그 config.toml, ChatGPT 로그인, Codex 대화 기록
├── codex-workspace/        # Codex 작업 폴더. 항상 비어 있어야 함(시작할 때 비움)
└── server.lock             # 실행 중인 인스턴스 표시(같은 데이터로 두 번 실행 방지)
```

- 학습 콘텐츠(`content.db`)는 데이터 위치가 아니라 `content/dist/content.db`(또는 `PROGINONE_CONTENT_DB`)에서 읽습니다.
- `codex-home`은 사용자의 Codex CLI 설정(`~/.codex`)과 **분리된** 튜터 전용 홈입니다. 여기 로그인한 계정은 Codex CLI 로그인과 별개입니다(D-002).

## AI·Codex 문제 진단

### AI 상태로 원인 찾기

헤더의 AI 표시는 `GET /api/v1/ai/status`(설정 AI 화면, Codex를 지연 시작함)와 `GET /api/v1/ai/events`(SSE, 시작하지 않음)의 `status.state`를 그대로 보여 줍니다.

| 상태 (화면 표시) | 원인 | 해결 |
|---|---|---|
| `idle` (대기 중) | 아직 Codex를 시작하지 않음. 첫 AI 요청이나 설정 AI 화면에서 시작 | 문제 아님 |
| `not_installed` (Codex CLI 미설치) | `codex` 실행 파일을 찾지 못했거나 `codex --version`이 실패 | Codex CLI 설치. 설치 위치가 다르면 `PROGINONE_CODEX_PATH` |
| `unsupported_version` (지원하지 않는 버전) | `codex --version`이 최소 버전(`MIN_CODEX_VERSION`, 0.155.1) 미만 | Codex CLI 업데이트 |
| `isolation_failed` (격리 실패) | 도구 계열 기능이 켜져 있거나 모르는 기능이 켜짐, Codex가 다른 홈을 씀, 스레드 실효 설정이 다름 | 아래 [격리 검증 실패](#격리-검증-실패) |
| `logged_out` (연결 안 됨) | 튜터 전용 홈에 ChatGPT 로그인이 없음, 또는 토큰이 거부됨(`unauthorized`) | **설정 > AI**에서 ChatGPT로 로그인 |
| `rate_limited` (한도 도달) | ChatGPT 사용량 한도(`usageLimitExceeded`) | 표시된 초기화 시각 이후 자동으로 다시 쓸 수 있음 |
| `error` (연결 오류) | Codex가 5번 연속 종료되었거나 전용 폴더를 만들지 못함 | 서버 로그의 `codex.process.exit` 확인 후 **설정 > AI > 다시 연결** |

사용량 표시는 Codex가 알려 준 값(`account/rateLimits/read`의 창별 `usedPercent`, `windowDurationMins`, `resetsAt`)만 씁니다. 80% 이상이면 헤더가 주의 표시로 바뀌고, 백그라운드 AI 작업(대화 요약, 오개념 제안)을 미룹니다.

### 격리 검증 실패

서버는 시작할 때 튜터 전용 홈으로 `codex features list`를 실행해 도구 기능이 모두 꺼졌는지 확인합니다. 같은 명령을 직접 실행해 봅니다.

```shell
CODEX_HOME="<데이터 위치>/codex-home" codex features list
```

- 문제 목록은 `GET /api/v1/ai/status`의 `status.problems`와 서버 로그 `codex.isolation.failed`에 있습니다.
- `config.toml`은 시작할 때마다 기대값으로 다시 쓰므로 손으로 고치지 않습니다.
- Codex를 업데이트한 뒤 새 기능 때문에 실패하면, 그 기능이 도구인지 검토해 `packages/ai/src/provider/codex/features.ts`의 `REQUIRED_OFF`·`ALLOWED_ON`을 고칩니다([`@proginone/ai` README의 Codex 업그레이드](/packages/ai/README.md#codex-업그레이드)).

### AI 호출 기록(`ai_calls`) 보기

모든 AI 작업 호출은 `ai_calls`에 한 행씩 남습니다(프롬프트와 응답 원문은 없음).
최근 호출은 API로 볼 수 있습니다.

```shell
TOKEN=$(curl -s http://127.0.0.1:4310/ | grep -o 'proginone-token" content="[^"]*' | cut -d'"' -f3)
curl -s -H "x-proginone-token: $TOKEN" 'http://127.0.0.1:4310/api/v1/ai/calls?limit=20'
```

- 세션 토큰은 서버를 시작할 때마다 바뀝니다. 개발 모드에서는 `.data/dev-session.json`에도 있습니다.
- `taskName`으로 거를 수 있습니다(`?taskName=tutor.reply`). `limit`은 1~200입니다.

SQLite로 직접 보려면 서버를 끄거나 읽기 전용으로 엽니다.

```shell
sqlite3 -readonly "<데이터 위치>/user.db" \
  "SELECT datetime(created_at/1000,'unixepoch','localtime'), task_name, task_version, status, error_code, retries, latency_total_ms, input_tokens, output_tokens FROM ai_calls ORDER BY created_at DESC LIMIT 20;"
```

| 열 | 보는 법 |
|---|---|
| `status` | `ok`, `fallback`(AI 결과 대신 저작 힌트·결정론적 요약 등을 씀), `bad_output`(검증 실패로 숨김), `cancelled`, `timeout`, `rate_limited`, `unauthorized`, `provider_error` |
| `error_code`, `error_message` | `AI_*` 오류 코드와 학습자에게 보인 문구 |
| `validation_issues_json` | 출력 검증에서 걸린 규칙(`schema`, `answer_leak`, `code_lines`, `tool_attempt`, 지운 근거 `evidence` 등) |
| `tool_attempts` | 자동 거부한 도구 시도 수. 0이 아니면 격리 층이 작동한 것 |
| `context_manifest_json` | 컨텍스트에 넣은 섹션과 추정 토큰, 잘림 여부 |
| `task_version`, `base_version` | 프롬프트 버전. 품질 문제를 버전별로 비교 |

### 튜터 답변 문제

| 증상 | 원인과 확인 |
|---|---|
| 답변이 "학습 정책에 따라 숨겨졌습니다"로 바뀜 | 정답 누설 검사에 두 번 걸림(`tutor_messages.status = 'withheld'`, `ai_calls.validation_issues_json`에 `answer_leak`) |
| 답변이 "(중단됨)"으로 끝남 | 학습자가 중단했거나 앱 종료(`cancelled`/`interrupted`) |
| 이전 대화를 기억하지 못함 | Codex 스레드를 다시 만든 경우(모델·지침 버전 변경, 재개 실패). DB의 스레드 요약과 최근 메시지 12개로 복원합니다. `GET /api/v1/tutor/threads/:id/summary`로 요약을 확인 |
| 첫 글자가 늦게 나옴 | 문제 맥락이 있으면 누설 검사용으로 꼬리 텍스트를 잠시 붙잡아 둠(설계상 지연) |
| AI 힌트가 저작 힌트로 나옴 | 응답의 `fallbackCode`가 이유(`AI_NOT_CONNECTED`, `AI_BAD_OUTPUT` 등) |

### 실제 Codex로 재현하기

- 서버를 실제 Codex로 띄우되 학습 데이터를 건드리지 않으려면 임시 데이터 위치를 씁니다: `PROGINONE_DATA_DIR=$(mktemp -d) pnpm start`. 처음에는 설정 AI에서 로그인해야 합니다.
- 모의 제공자(`PROGINONE_AI_PROVIDER=mock`)는 결정론적으로 답합니다. 질문에 `[mock:slow]`를 넣으면 천천히 보내다 중간에서 취소될 때까지(최대 30초) 멈추고, `[mock:error:<AI 오류 코드>]`(예: `[mock:error:AI_RATE_LIMITED]`)를 넣으면 그 오류로 실패합니다(E2E용).
- 프로토콜이 바뀐 것 같으면 계약 테스트를 실행합니다: `pnpm vitest run packages/ai/src/provider/codex`. 녹화본을 다시 만드는 법은 [`@proginone/ai` README](/packages/ai/README.md#codex-프로토콜-계약-테스트)에 있습니다.

## 샌드박스·러너 문제

학습자 코드는 앱 페이지 안의 격리된 iframe(셸, `http://<shellId>.localhost:<포트>/sandbox/runner.html`)에서 실행됩니다([코드 실행 샌드박스 설계](/docs/design/code-execution-sandbox.md)).

| 증상 | 원인과 해결 |
|---|---|
| 실행 버튼을 눌러도 결과가 없음 | 셸이 3초 안에 준비되지 않으면 같은 사이트 경로(`/sandbox/runner.html`)로 대체합니다. 브라우저 콘솔의 CSP 오류와 네트워크 탭의 `runner.html` 응답을 확인 |
| "시간 초과"로 끝남 | 무한 반복문 감시(watchdog)가 셸을 교체함. 학습자 코드 문제이며 다음 실행은 새 셸에서 정상 |
| 채점이 "실행 환경 문제로 반영하지 않았어요" | 실행 결과가 `crashed`라 시도를 숙련도에 반영하지 않음(`attempts.engine_applied = 0`). 다시 제출 |
| 문법 오류 문구가 브라우저와 다름 | 엔진 문법 검사가 실패해 대체 문구를 씀(D-030). 브라우저 콘솔 확인 |
| `EXERCISE_RUN_REQUIRED` | 실행이 필요한 문제를 본문 확인 문제로 제출함. 실습 모드에서 풀어야 함 |

- Safari는 `*.localhost` 해석이 확인되지 않아 대체 경로를 쓸 수 있습니다. Chromium 계열이 기준 환경입니다.
- 콘텐츠의 문제가 실제 러너에서 통과하는지는 `pnpm content:check:run`으로 확인합니다([콘텐츠 작성 가이드](/docs/guides/content-authoring.md)).
- 러너 동작 자체는 `pnpm test:e2e`의 `sandbox.spec.ts`(보안 스위트)와 `sandbox-grading.spec.ts`가 검증합니다.

## 데이터베이스·백업·마이그레이션

### 데이터베이스 들여다보기

- 서버가 켜져 있으면 `sqlite3 -readonly`로만 엽니다. 쓰기는 서버와 충돌하고, 스키마를 깨뜨릴 수 있습니다.
- 적용된 마이그레이션: `SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at;`. 앱이 가진 마이그레이션 목록은 `apps/server/src/db/user/migrations/meta/_journal.json`입니다.
- JSON 열(`*_json`)은 읽을 때 스키마를 검사합니다. 손상된 행이 있으면 그 요청만 `INTERNAL`로 실패하고 서버 로그에 `corrupt <테이블> row <키>`가 남습니다.

### 백업과 복원

- 자동 백업은 하루 한 번(하루 경계 04:00), 주의 첫 백업은 주간 백업으로도 남습니다(일일 14개, 주간 8개).
- **설정 > 데이터**에서 백업을 만들고 복원합니다. 복원하기 전 상태도 따로 백업됩니다. 복원 대화상자는 먼저 파일을 검사하고(체크섬·무결성·스키마 버전), 손상되었거나 더 새로운 앱의 백업이면 복원 버튼을 끕니다.
- 백업 위치를 바꾸면 새 위치가 `config.json`의 `backupDir`에 저장되고, 이전 위치의 백업은 그 자리에 남습니다(목록에는 새 위치의 백업만 보임). 이전 백업을 복원하려면 위치를 다시 원래대로 바꿉니다. `PROGINONE_BACKUP_DIR`가 설정되어 있으면 화면에서 바꿀 수 없습니다.
- 학습 데이터 초기화 직전 상태는 "초기화 전"(`pre-reset`) 백업으로 남습니다. 그 백업을 복원하면 초기화를 되돌릴 수 있습니다.
- 백업 파일은 `<백업 위치>/<종류>/`의 SQLite 파일과 메타 파일(`*_user.meta.json`: 앱 버전, 스키마 마이그레이션, 무결성 검사)입니다.
- 서버가 시작되지 않을 만큼 데이터가 망가졌다면 서버를 끄고, 현재 `user.db`(+ `-wal`, `-shm`)를 다른 곳에 옮긴 뒤 원하는 백업 파일을 `user.db`로 복사합니다. 더 새로운 앱이 만든 백업은 열 수 없습니다.

### 마이그레이션

- 앱을 시작할 때 밀린 마이그레이션을 적용합니다. 적용 전 `pre-migration` 백업을 만들고, 실패하면 그 백업으로 되돌린 뒤 종료합니다("데이터베이스 업데이트에 실패해 이전 상태로 복구했습니다").
- "더 새로운 버전의 ProgInOne이 만든 것입니다"는 데이터보다 오래된 앱을 실행한 경우입니다. 앱을 업데이트합니다.
- 개발 중 스키마를 바꾸면 `pnpm --filter @proginone/server db:generate --name <이름>`으로 마이그레이션을 만듭니다. 생성된 SQL과 `meta/_journal.json`은 손으로 고치지 않습니다. 다른 마이그레이션이 먼저 병합되면 내 마이그레이션을 지우고 리베이스 후 다시 생성합니다.
- 마이그레이션 테스트는 `apps/server/src/db/user/migrate.test.ts`에 있습니다(이전 버전 DB에 데이터를 넣고 올리기).

## 자주 보는 오류 코드

API 오류는 `{ "error": { "code", "message", "retryable", "details" } }` 형식입니다. 화면 문구는 `message`, 분기는 `code`로 합니다.

| 코드 | HTTP | 뜻과 해결 |
|---|---|---|
| `UNAUTHORIZED` | 401 | 세션 토큰이 없거나 바뀜(서버 재시작). 페이지 새로 고침 |
| `FORBIDDEN_HOST`, `FORBIDDEN_ORIGIN` | 403 | `127.0.0.1`/`localhost`가 아닌 주소나 다른 출처에서 호출함 |
| `MAINTENANCE` | 503 | 백업 복원 등 유지 보수 중. 잠시 후 다시 시도 |
| `CONTENT_UNAVAILABLE` | 503 | `content.db`가 없음. `pnpm content:build` |
| `VALIDATION_FAILED` | 400 | 요청 값 오류. `details.issues`에 경로와 이유 |
| `NOT_FOUND` | 404 | 없는 단원·문제·스레드·시도 |
| `AI_NOT_CONNECTED` | 409 | ChatGPT 로그인이 필요함 |
| `AI_UNAUTHORIZED` | 409 | 로그인이 만료됨. 다시 로그인 |
| `AI_RATE_LIMITED` | 429 | 사용량 한도. `details.resetsAt` 이후 다시 시도 |
| `AI_UNAVAILABLE` | 503 | Codex 미설치·미지원 버전·격리 실패·재시작 소진(`details.reason`) |
| `AI_PROVIDER_ERROR`, `AI_OVERLOADED` | 502, 503 | Codex 연결 끊김·과부하. 잠시 후 다시 시도 |
| `AI_TIMEOUT` | 504 | 응답이 너무 늦음(튜터 답변 첫 글자 20초, 전체 90초) |
| `AI_BAD_OUTPUT` | 502 | 출력 검증을 재시도 후에도 통과하지 못함(힌트·오답 분석은 저작 내용으로 대체) |
| `AI_CONTEXT_TOO_LARGE` | 413 | 질문·코드가 너무 김 |
| `AI_LOCKED_IN_ASSESSMENT` | 403 | 단원 평가 중에는 AI를 쓸 수 없음 |
| `ATTEMPT_CORRECT` | 409 | 맞힌 시도는 오답 분석을 하지 않음 |
| `EXERCISE_HINT_REQUIRED` | 409 | AI 힌트 전에 저작 힌트를 먼저 열어야 함 |
| `INTERNAL` | 500 | 서버 버그. 서버 로그의 `unhandled error`와 `requestId`로 원인 확인 |

## 관련 문서

- [시작하기 문제 해결](/docs/guides/getting-started.md#문제-해결)
- [테스트 가이드](/docs/guides/testing.md)
- [AI 시스템 설계 구현 메모](/docs/design/ai-system.md#구현-메모-v02)
- [`@proginone/ai` README](/packages/ai/README.md)
