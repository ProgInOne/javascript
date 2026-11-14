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
| `tasks/` | `tutorReply`, `tutorHint` 작업 정의(지침, 입력·출력 스키마, 컨텍스트 명세, 검증, 재시도 정책) |
| `context/` | `ContextSource` 인터페이스, 토큰 예산 빌더, XML 태그 섹션 렌더러 |
| `prompts/` | 공통 페르소나·한국어·데이터 경계 지침, `BASE_INSTRUCTIONS_VERSION` |
| `output/` | 스트림 게이트(`<meta>` 숨김, 누설 검사용 꼬리 보류), 코드 줄 수 |
| `provider/types.ts` | `ProviderAdapter` 계약 |
| `provider/codex/` | `CodexAdapter`: JSON-RPC, 프로세스 수명주기, 격리(기능 플래그 검증, 스레드 재정의, 자동 거부, 도구 항목 즉시 중단), 로그인, 사용량 |
| `provider/mock/` | `MockProvider`: 결정론적 응답, 시나리오 주입(`enqueue`), 요청 기록(`requests`) |

## 서버에서 쓰기

```ts
const provider = config.aiProvider === 'mock'
  ? new MockProvider()
  : new CodexAdapter({ codexPath, dataDir, clientVersion });
const runner = new TaskRunner({ provider });
const result = await runner.run(tutorReply, input, { source, signal, onDelta, guard });
```

## Codex 업그레이드

1. 새 Codex로 `codex app-server generate-ts --out <임시 폴더>`를 실행하고 `provider/codex/protocol.ts`의 형태와 비교합니다.
1. `codex features list` 출력을 `provider/codex/testing/features-<버전>.txt`로 녹화하고, 새로 켜진 기능이 도구인지 검토해 `REQUIRED_OFF`·`ALLOWED_ON`을 고칩니다.
1. 계약 테스트(`provider/codex/*.test.ts`)를 통과시킨 뒤 `MIN_CODEX_VERSION`을 올립니다.
1. 로컬에서 실제 Codex로 몇 턴을 확인합니다(CI는 실제 Codex를 쓰지 않습니다).
