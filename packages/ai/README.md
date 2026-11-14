# @proginone/ai

AI 제공자 어댑터, AI 작업 정의, 컨텍스트 빌더입니다.
규격의 원천은 [AI 시스템 설계](/docs/design/ai-system.md)와 결정 [D-002, D-010, D-014](/docs/decisions.md)이고, v0.1에서 구체화한 점은 설계 문서의 [구현 메모](/docs/design/ai-system.md#구현-메모-v01)에 있습니다.

## 사용 규칙

- 이 패키지는 내부 패키지 중 `@proginone/shared`에만 의존합니다. DB 조회는 서버가 구현하는 `ContextSource`로, 정답 누설 검사는 서버가 만드는 `OutputGuard`로 주입받습니다.
- 파일 시스템과 프로세스는 Codex 어댑터(`provider/codex`)만 다룹니다: 튜터 전용 `CODEX_HOME`, 빈 작업 폴더, `codex` 자식 프로세스.
- AI 출력과 학습자 입력은 신뢰하지 않습니다. 학습자 입력은 태그 블록 안의 데이터로만 들어가고, 출력은 스키마·의미·누설 검사를 거칩니다.
- 정답을 얼마나 보여 줄지는 프롬프트가 아니라 서비스와 `ContextSource`가 정합니다(D-010). 작업 입력의 `access`는 서비스가 힌트 기록에서 계산한 값입니다.

## 구성

| 경로 | 내용 |
|---|---|
| `runner.ts` | `TaskRunner.run(task, input, { source, signal, onDelta, onReset, providerThread, guard })` → `TaskResult` 또는 `AIError`(둘 다 `ai_calls`용 `AICallRecord` 포함) |
| `tasks/` | `tutorReply`, `tutorHint`, `sessionSummarize`(롤링 대화 요약, `sanitizeSummary`·`fallbackSummary`) 작업 정의(지침, 입력·출력 스키마, 컨텍스트 명세, 검증, 재시도 정책) |
| `context/` | `ContextSource` 인터페이스(학습 상태·선수 개념, 활성 오개념, 스레드·과거 요약 포함), 토큰 예산 빌더, XML 태그 섹션 렌더러(`tutor-sections.ts`, `memory-sections.ts`) |
| `prompts/` | 공통 페르소나·한국어·데이터 경계 지침, `BASE_INSTRUCTIONS_VERSION` |
| `output/` | 스트림 게이트(`<meta>` 숨김, 누설 검사용 꼬리 보류), 코드 줄 수 |
| `provider/types.ts` | `ProviderAdapter` 계약 |
| `provider/codex/` | `CodexAdapter`: JSON-RPC, 프로세스 수명주기, 격리(기능 플래그 검증, 스레드 재정의, 자동 거부, 도구 항목 즉시 중단), 로그인, 사용량 |
| `provider/codex/testing/` | 계약 테스트 도구: 가짜 `codex`(`fake-codex.mjs`, 시나리오 주입), 녹화 재생기(`replay-codex.mjs`), 녹화 스크립트(`record-codex.ts`, `tee-codex.mjs`, `scrub.ts`), 녹화 시나리오(`scenarios.ts`), 녹화본(`recordings/<버전>/*.jsonl`) |
| `provider/mock/` | `MockProvider`: 결정론적 응답, 시나리오 주입(`enqueue`), 요청 기록(`requests`). 질문에 `[mock:slow]`(`MOCK_SLOW_MARKER`)가 있으면 시나리오 없는 답을 400ms 간격으로 보내 E2E가 중단을 검증할 수 있음 |

## 서버에서 쓰기

```ts
const provider = config.aiProvider === 'mock'
  ? new MockProvider()
  : new CodexAdapter({ codexPath, dataDir, clientVersion });
const runner = new TaskRunner({ provider });
const result = await runner.run(tutorReply, input, { source, signal, onDelta, guard });
```

## Codex 프로토콜 계약 테스트

`provider/codex/replay.test.ts`는 실제 `codex app-server`와 주고받은 JSON-RPC 메시지를 녹화해 둔 파일(`provider/codex/testing/recordings/<버전>/`)을 재생해 어댑터를 검사합니다.
초기화, 로그인 상태(로그아웃·로그인 시작·취소), 사용량, 모델 목록, 스레드 시작, 스트리밍 턴, 구조화 출력, 스레드 재개와 유실, 중단을 다룹니다.
CI는 실제 Codex를 쓰지 않습니다.

- 재생기는 녹화된 클라이언트 메시지를 메서드와 순서로 맞추고, 그 뒤에 왔던 서버 메시지를 그대로 보냅니다. 어댑터가 녹화와 다른 요청을 보내면 테스트가 실패합니다.
- 녹화 시나리오는 `testing/scenarios.ts` 하나가 녹화와 재생 양쪽을 구동합니다. 시나리오 단계를 바꾸면 다시 녹화합니다.
- 다시 녹화하기(로컬 전용, 실제 모델 턴 5회):

    ```shell
    pnpm --filter @proginone/ai codex:record --home <로그인된 Codex 홈> [--only <시나리오>]
    ```

    `--home`은 시나리오마다 임시 폴더로 복사해 쓰고 원본은 건드리지 않습니다. 녹화본은 `scrub.ts`가 이메일, 경로, 호스트 이름, 로그인 URL의 OAuth 상태, ID, 시각, 크레딧 잔액을 자리표시자로 바꾸고, 남은 개인 정보가 보이면 저장하지 않습니다. 커밋 전에 차이를 직접 검토합니다.

## Codex 업그레이드

1. 새 Codex로 `codex app-server generate-ts --out <임시 폴더>`를 실행하고 `provider/codex/protocol.ts`의 형태와 비교합니다.
1. `codex features list` 출력을 `provider/codex/testing/features-<버전>.txt`로 녹화하고, 새로 켜진 기능이 도구인지 검토해 `REQUIRED_OFF`·`ALLOWED_ON`을 고칩니다.
1. 계약 녹화본을 새 버전으로 다시 만들고(`codex:record`), 이전 버전과의 차이를 리뷰합니다. `PROTOCOL_CODEX_VERSION`을 올리면 재생 테스트가 새 녹화본을 읽습니다.
1. 계약 테스트(`provider/codex/*.test.ts`)를 통과시킨 뒤 `MIN_CODEX_VERSION`을 올립니다.
