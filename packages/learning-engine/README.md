# @proginone/learning-engine

숙련도, 단계 게이트, 개념 단위 FSRS를 계산하는 학습 엔진입니다.
모든 함수는 I/O가 없는 순수 함수이며, 같은 입력에는 같은 출력을 냅니다.
규격의 원천은 [학습 엔진 설계](/docs/design/learning-engine.md)와 결정 [D-009, D-023](/docs/decisions.md)이고, v0.1에서 구체화한 점은 설계 문서의 [구현 메모](/docs/design/learning-engine.md#구현-메모-v01)에 있습니다.

## 사용 규칙

- 시간은 `now`(epoch ms, UTC) 인자로만 받습니다. 하루 경계는 `DayBoundary`(`timeZone`, `dayStartHour`)로 받습니다.
- 서버는 DB에서 입력을 읽고, 엔진을 호출하고, 결과를 한 트랜잭션으로 씁니다. 엔진 계산은 트랜잭션 **전에** 끝냅니다([데이터 모델 설계](/docs/design/data-model.md#트랜잭션-경계)).
- 입력은 서버 경계에서 검증된 값이라고 가정합니다. 엔진은 다시 검증하지 않습니다.
- 샌드박스 `crashed`/`aborted` 시도(`engine_applied = 0`)는 엔진에 넘기지 않습니다.
- 숙련도 모델과 FSRS는 계산을 섞지 않습니다. 둘이 만나는 곳은 유효 숙련도(`effectiveMastery`)와 `mastered` 게이트뿐입니다.

## 공개 API

### 시도 반영

```ts
applyAttempt(deps: EngineDeps, input: {
  attempt: AttemptFacts;        // 채점 결과 중 엔진이 읽는 최소 필드
  exercise: ExerciseFacts;      // 유형·범주·난이도·변형 그룹 키·개념 태깅
  concepts: ConceptState[];     // 태깅된 개념의 현재 상태(없으면 not_started로 시작)
  now: number;
  dayBoundary: DayBoundary;
}): AttemptEffects               // { mastery: MasteryUpdate[], evidence: MasteryEvidenceRecord[], pendingRatings: PendingRating[] }

applyLessonRead(deps, { concepts, now })  // 단원이 소개하는 개념: not_started → introduced
reevaluateStage(deps, state, now, dayBoundary)  // 시도 없이 승급만 다시 판정
effectiveMastery(deps, score, memory, now)  // { effective, decay, retrievability, needsReview }
```

| 출력 | 저장 위치 |
|---|---|
| `MasteryUpdate.after` | `concept_mastery` 행 전체(`engine_version`, `updated_at = now` 추가) |
| `MasteryEvidenceRecord` | `mastery_evidence` 행(`id`, `learner_id` 추가). `breakdown`은 `breakdown_json` |
| `PendingRating` | 연습 세트와 함께 보관했다가 FSRS에 합쳐 적용 |

`ConceptState`는 `concept_mastery` 행(`mastery`), 저장된 증거 사실(`history`: `mastery_evidence.breakdown_json.fact`), FSRS 평가 이력(`reviews`: `review_logs` + 근거 시도의 `variant_group_key`), `concept_memory` 행(`memory`)으로 만듭니다.

### 보조 함수

- `resolveVariantGroupKey({ id, variantGroup, templateId })`: `variant_group` → 템플릿 ID → 문제 ID
- `computeEvidence`, `updateScore`, `evaluateGates`, `decideStage`: 계산 단계를 따로 쓰거나 테스트할 때
- `ratingForAttempt`, `aggregateRatings`: 시도 → FSRS 등급, 보류 등급 합치기
- `localDateOf`, `startOfLocalDay`, `endOfLocalDay`, `addDays`, `daysBetween`: 학습자 로컬 날짜 계산

## 테스트

설계 문서의 테스트 시나리오 중 v0.1 범위를 `scenario N` 이름의 테스트로 둡니다. FSRS는 결정론적 가짜 포트(`src/test/fixtures.ts`)로 테스트합니다.

```bash
pnpm vitest run packages/learning-engine
```
