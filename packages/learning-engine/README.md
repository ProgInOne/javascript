# @proginone/learning-engine

숙련도, 단계 게이트, 개념 단위 FSRS, 복습 큐, 연습 세트 구성, 오개념 상태 전이, 재학습 판정을 계산하는 학습 엔진입니다.
모든 함수는 I/O가 없는 순수 함수이며, 같은 입력에는 같은 출력을 냅니다.
규격의 원천은 [학습 엔진 설계](/docs/design/learning-engine.md)와 결정 [D-009, D-023, D-033](/docs/decisions.md)이고, 구현하면서 구체화한 점은 설계 문서의 구현 메모([v0.1](/docs/design/learning-engine.md#구현-메모-v01), [v0.2](/docs/design/learning-engine.md#구현-메모-v02))에 있습니다.

## 사용 규칙

- 시간은 `now`(epoch ms, UTC) 인자로만 받습니다. 무작위는 `seed` 문자열로 만든 RNG만 씁니다(`createRng`). 하루 경계는 `DayBoundary`(`timeZone`, `dayStartHour`)로 받습니다.
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

`applyAttempt`에 선택 입력 두 가지를 주면 결과에 오개념과 재학습이 함께 나옵니다.

```ts
applyAttempt(deps, {
  ...,
  misconceptions?: {
    observed: { misconceptionId; conceptId; source: 'distractor' | 'pattern' }[];  // 오답이 가리키는 오개념
    targets: string[];                  // 이 문제가 겨냥하는 오개념
    states: MisconceptionState[];       // 위 오개념들의 현재 관측(misconception_observations)
  };
  remediation?: RemediationContext;     // 선수 그래프, 선수 개념 상태, 세트의 이전 항목 결과, 풀이 예제, 최근 제안
}): AttemptEffects & {
  misconceptions: MisconceptionUpdate[];         // before === null이면 새 행
  remediation: RemediationSuggestion | null;     // 주 개념의 재학습 제안
}

updateMisconceptions(config, { attempt, states, now, dayBoundary })  // 단독 사용
misconceptionStatusAt(config, state, now)   // 30일 경과 의심을 저장 없이 dismissed로 읽기
remediationTrigger(deps, …) / detectRemediation(deps, …) / inspectPrerequisites(deps, …)
```

| 출력 | 저장 위치 |
|---|---|
| `MisconceptionUpdate.after` | `misconception_observations` 행. `evidence[].attemptId` → `evidence_attempt_ids_json`, `resolution[].attemptId` → `resolution_attempt_ids_json` |
| `RemediationSuggestion` | `remediation_suggestions` 행. 전체는 `detail_json` |

`MisconceptionState.evidence`의 문제 ID와 시각은 근거 시도(`attempts`)에서 읽습니다.

### FSRS와 복습 큐

```ts
createTsFsrsPort(defaultEngineConfig.fsrs): Promise<FsrsPort>  // 서버 시작 시 한 번. 이후 모든 메서드는 동기·결정론적

flushPendingRatings(deps, {
  pending: PendingRating[];     // 지금 적용할 보류 등급(conceptsReadyToFlush로 고름)
  concepts: ConceptState[];
  now: number; dayBoundary: DayBoundary;
}): { memory: ConceptMemoryState[]; reviewLogs: ReviewLogRecord[]; skipped: SkippedRating[];
      mastery: MasteryUpdate[]; evidence: MasteryEvidenceRecord[] }

buildReviewQueue(deps, {
  concepts: ReviewQueueConcept[];   // concept_memory + concept_mastery + importance + 마지막 등급
  budgetMinutes: number; now: number; dayBoundary: DayBoundary;
}): { due: ReviewQueueEntry[]; deferred: ReviewQueueEntry[] }
```

| 출력 | 저장 위치 |
|---|---|
| `ConceptMemoryState` | `concept_memory` 행. `card.raw` → `card_json`, `card`의 나머지 필드 → 비정규화 컬럼, `fsrsVersion` → `fsrs_version` |
| `ReviewLogRecord` | `review_logs` 행. `revlog` → `revlog_json`, `sourceAttemptIds` → `source_attempt_ids_json` |
| `skipped` | 저장하지 않고 버림(그날 이미 평가한 개념) |

`concept_memory.card_json`은 `deps.fsrs.fromRaw(JSON.parse(card_json))`로 카드를 복원해 `ConceptMemoryState.card`에 넣습니다.

### 연습 세트

```ts
buildLessonPracticeSet(deps, {
  lesson: { id; importance; introduces: ConceptId[]; reviews: ConceptId[]; passRule?: Partial<PassRule> };
  concepts: LessonSetConcept[];          // { conceptId, importance, state? }
  candidates: ExerciseCandidate[];       // ExerciseFacts(+ writing: 작성형, D-084) + origin
  lastSeenAtByGroup: Record<string, number>;
  misconceptionTargetIds?: ExerciseId[];
  seed: string;                          // 연습 세트 ID
  now: number;
}): { items: PlannedItem[]; passRule: PassRule; rationale: SetRationale }  // 작성형 최소 1개(writing_required), 없으면 생성 범주 최소 1개

buildReviewSet(deps, {
  entries: ReviewQueueEntry[];           // buildReviewQueue의 due
  concepts: ReviewSetConcept[];          // { conceptId, moduleId, state }
  candidates; lastSeenAtByGroup; misconceptionTargetIds?; seed; now;
}): { items: PlannedItem[]; rationale }

evaluatePassRule(config, rule, { items: PassRuleItem[]; introducedScores: Record<ConceptId, number> }): PassResult
```

| 출력 | 저장 위치 |
|---|---|
| `PlannedItem` | `practice_set_items` 행: `position`, `exercise_id`, `exercise_origin`, `reason`, `target_concept_id` |
| `passRule` | `practice_sets.pass_rule_json` |
| `rationale` | 로그 또는 `practice_sets.scope_json`의 보조 정보(근거 표시용) |

### 진행 중 적응과 약점 집중

```ts
nextAdaptiveStep(deps, {
  set: { kind, items: SetItemSnapshot[] };   // 현재 항목의 새 상태를 반영한 항목들(touched: 시도·힌트 여부)
  itemId; event: 'answered' | 'skipped';
  outcomes: ItemOutcome[];                   // 답한 항목의 마지막 결과, 현재 항목이 마지막
  solutionJustViewed: boolean;               // 정답을 본 뒤 첫 제출
  remediation: RemediationSuggestion | null; // applyAttempt의 제안
  candidates; remedialCandidates?; concepts; lastSeenAtByGroup; seed; now;
}): AdaptiveAction[]   // { kind: 'replace', itemId, item } | { kind: 'append', reason, item }

rankWeakConcepts(deps, { concepts: WeakConceptInput[]; now }): WeakConceptEntry[]
selectWeaknessTargets(deps, entries): WeakConceptEntry[]       // 상위 3~5개
buildWeaknessSet(deps, { targets, concepts, candidates, confirmedTargetIds, … }): { items, rationale }
```

| 출력 | 저장 위치 |
|---|---|
| `replace` | 대기 중 항목의 `exercise_id`, `exercise_origin`, `reason` |
| `append` | 새 `practice_set_items` 행(`position`은 이어 붙임) |

### 계획: 오늘의 학습, 목표 페이스, 주간 달성, 학습 시간

```ts
buildDailyPlan(deps, { goal, todayActiveMs, reviewQueue, continueLesson, nextLesson, weakConcepts, pace, firstRun }): DailyPlan
dailyReviewMinutes(deps, goal, queue)        // 복습 큐의 하루 예산(목표의 복습 몫)
computePace(deps, { goal, lessons, completedTimings, today, todayGoalMet }): PaceResult | null
remainingLessonMinutes(lesson, calibration?) / paceCalibration(deps, timings)
summarizeWeek(deps, { days, goalOn, weekStart, today }) / weeklyStreak(deps, { days, goalOn, today }) / weekStartOf(date)
accumulateActiveTime(config, prev, cur, dayBoundary): { date, ms }[]   // 하트비트 → 날짜별 활동 시간
conceptReport(deps, state, now, dayBoundary)   // 유효 숙련도 + 다음 단계 게이트(개념 상세)
```

모두 저장할 행을 만들지 않는 읽기용 계산입니다. 서버는 `goals`, `daily_activity`, `lesson_progress`, 복습 큐, 약점 순위를 읽어 넘깁니다.

### 보조 함수

- `resolveVariantGroupKey({ id, variantGroup, templateId })`: `variant_group` → 템플릿 ID → 문제 ID
- `computeEvidence`, `updateScore`, `evaluateGates`, `decideStage`: 계산 단계를 따로 쓰거나 테스트할 때
- `ratingForAttempt`, `aggregateRatings`: 시도 → FSRS 등급, 보류 등급 합치기
- `localDateOf`, `startOfLocalDay`, `endOfLocalDay`, `addDays`, `daysBetween`: 학습자 로컬 날짜 계산

## 테스트

설계 문서의 테스트 시나리오 1~23을 모두 `scenario N` 이름의 테스트로 둡니다. FSRS는 결정론적 가짜 포트(`src/test/fixtures.ts`)와 실제 ts-fsrs 어댑터 둘 다로 테스트합니다.

`src/simulation.test.ts`는 30일 가짜 시계 시뮬레이션입니다. `src/test/simulator.ts`의 학습자가 평일마다 오늘의 학습을 따라 복습·단원·약점 세트를 풀고, 복습 일정·숙련도·오늘의 학습이 설계대로 움직이는지 확인합니다(로드맵 M5 완료 조건).

```bash
pnpm vitest run packages/learning-engine
```
