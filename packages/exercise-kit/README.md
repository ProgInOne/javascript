# @proginone/exercise-kit

이 저장소의 문제 유형 레지스트리와 JS 유형별 스펙·답안 스키마, 순수 채점기, 체크 언어를 제공합니다.
유형 틀, 레지스트리 팩토리, 템플릿 엔진, 선택형 3종은 공통 패키지 [`@proginone/exercise-core`](https://github.com/ProgInOne/core/blob/develop/packages/exercise-core/README.md)에 있고, 이 패키지는 그 위에 JS 유형을 얹습니다([D-096](/docs/decisions.md)).
I/O가 없는 순수 패키지이며 내부 패키지 중 `run-contract`에만 의존합니다.
설계 원천은 [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md)의 문제 유형 시스템입니다.

## 레지스트리

`src/core/registry.ts`가 `createExerciseRegistry`로 레지스트리를 만듭니다.
공통 유형(`COMMON_EXERCISE_TYPES`)과 이 저장소의 유형을 등록하고, 실행 결과는 JS 러너 계약의 `parseRunResult`로 검증합니다.
경계 함수는 레지스트리에서 구조 분해해 기존 이름으로 내보내므로, 서버·웹·`content-cli`는 `@proginone/exercise-kit`만 가져다 씁니다.
템플릿 함수 `instantiateTemplate(raw, seed)`·`instantiateVariant(raw, variantId)`도 이 레지스트리에 묶어 내보냅니다.
새 유형은 `src/types/`에 정의를 만들고 `registerExerciseType(정의)`로 레지스트리 목록에 더합니다.

- `src/core/types.ts`: 이 저장소의 유형 ID 목록(`EXERCISE_TYPE_IDS`), 체크 실패 이유(`CheckFailReason`), JS 러너에 맞춘 `ExerciseTypeDef`, 러너 상태를 공통 `RunOutcome`으로 바꾸는 `runOutcomeOf`.
- 공통 패키지에서 `CheckResult.reason`은 열린 문자열이라, 이유별 문구를 찾을 때는 모르는 코드를 그대로 보여 줍니다.

## 다른 패키지가 쓰는 API

서버·웹·`content-cli`는 유형 정의를 직접 부르지 않고 아래 경계 함수를 씁니다.
경계 함수는 신뢰할 수 없는 입력(콘텐츠 원본, AI 출력, 학습자 답안, 샌드박스 결과)을 스키마로 검증한 뒤 순수 구현을 호출합니다.

| 함수 | 용도 | 주 사용처 |
|---|---|---|
| `parseSpec(typeId, raw)` | 스펙 검증과 기본값 적용 | `content-cli`, 런타임 생성 검증 |
| `redactSpec(typeId, raw, { shuffleSeed? })` | 정답 키를 제거한 `PublicSpec` | 서버 `GET /exercises/:id` |
| `buildRunPlan({ typeId, spec, answer, purpose })` | 샌드박스 실행 계획(`RunPlan`) | 서버 `POST /exercises/:id/run-plan` |
| `gradeSubmission({ typeId, spec, answer, run?, serverFindings? })` | 채점(`GradeResult`) | 서버 `POST /attempts` |
| `verifySpec(typeId, raw)` | 정적 콘텐츠 검증(`VerifyIssue[]`) | `content-cli check` |
| `checkSpec(typeId, raw)` | 스키마 + 정적 검증을 `{ ok, errors \| warnings }` 문자열로 | `content-cli`의 `validateSpec` 연결점 |
| `leakFingerprints(typeId, raw)` | 정답 누설 지문(`normalizeLeakText`로 정규화한 문자열) | `content-cli build`, AI 힌트 검사 |
| `getExerciseType(typeId)` | 범주(`category`), 스키마, 버전 조회 | 학습 엔진 입력 구성, 웹 렌더러 |
| `isWritingExercise(typeId, raw)` | 작성형 여부: 빈 시작 코드에서 학습자가 코드를 처음부터 쓰는 문제인지(`implement_function`은 늘, `web_task`는 초점 부분이 빈 시작 코드, D-084) | 서버 `ExerciseFacts.writing`, `GET /exercises/:id`의 `writing` |

잘못된 입력은 `ExerciseKitError`(`code`: `UNKNOWN_TYPE`, `INVALID_SPEC`, `INVALID_ANSWER`, `INVALID_RUN_RESULT`, `RUN_REQUIRED`, `EXPECTED_MISSING` 등)를 던집니다.
오답은 오류가 아니라 정상적인 `GradeResult`입니다.

`GradeResult`의 `outcome`·`score`·`misconceptionIds`·`engineApplicable`·`graderVersion`은 `attempts` 행과 학습 엔진의 `AttemptFacts`에 그대로 들어갑니다.

## 구현된 유형

| 유형 | 범주 | 채점 입력 |
|---|---|---|
| `mcq_single`, `mcq_multi`, `true_false` (`@proginone/exercise-core`) | recognition | 답안만 |
| `fill_blank` (`text` 모드) | recall | 답안만 |
| `predict_output` | recall | 답안 + `content-cli check --run`이 실행으로 계산하고 빌드가 채운 `expected` |
| `fill_blank` (`code` 모드) | recall | 답안 + `RunResult` |
| `implement_function` (`entry` 선택: 없으면 `console`·`program` 체크만 쓰는 프로그램 작성 문제, D-028) | production | 답안 + `RunResult` (+ `serverFindings`) |
| `fix_bug` | production | 답안 + `RunResult` (+ `serverFindings`) |
| `web_task` (기본형: `index.html` 하나) | production | 답안 + `RunResult` (+ `serverFindings`) |

## 코드 유형의 채점 흐름 (관측 모델)

1. 서버: `buildRunPlan({ typeId, spec, answer, purpose })` → `RunPlan`(학습자 파일 + 관측 단계 `CheckBundle`, 기대값 없음). `purpose: 'interactive'`는 공개 체크만 담습니다.
1. 웹: `RunPlan`을 러너 `RunRequest`로 바꿔 실행하고 `RunResult`를 서버에 보냅니다.
1. 서버: `static`·`html-valid` 체크가 있으면 acorn·html-validate 결과를 `serverFindings`로 만들고 `gradeSubmission({ ..., run, serverFindings })`을 부릅니다.
1. 채점기는 관측값을 체크의 기대값과 비교해 체크별 결과, 가중 부분 점수, 실패한 요구사항, 마일스톤을 돌려줍니다.

공개 체크의 빠른 피드백(채점 없이 실행)은 웹이 `gradeChecks({ checks: 공개 체크, run })`를 직접 불러 계산할 수 있습니다.

## 파라메트릭 템플릿

| 함수 | 용도 |
|---|---|
| `instantiateTemplate(rawTemplate, seed)` | 시드 하나로 변형 생성. 같은 템플릿·시드 → 항상 같은 결과(매개변수, 렌더링된 `render`·`spec`·`hints`·`explanation`, `variantId`) |
| `instantiateVariant(rawTemplate, variantId)` | `<템플릿 ID>@<seed>`로 변형 재현(과거 풀이 재현) |
| `sampleSeeds(templateId, n)` | 빌드 검증용 결정론적 표본 시드 |
| `paramSpaceSize(params)` | 매개변수 공간 크기 상한(`variantPolicy.maxVariants`와 비교) |
| `parseTemplate(raw)` | 템플릿 검증(`INVALID_TEMPLATE`) |

렌더링한 스펙은 유형의 스펙 스키마로 검증되므로, 결과의 `spec`은 바로 `redactSpec`·`gradeSubmission`에 넣을 수 있습니다.

## 샌드박스 계약

`SerializedValue`, 관측 단계(`ObservationStep`, `CheckBundle`), 관측값(`Observation`), `RunResult`, `RunPlan`, ProgInOne 콘솔 형식(`formatConsoleArgs`)은 내부 패키지 `@proginone/run-contract`에 있습니다.
러너도 이 계약에만 의존할 수 있기 때문입니다.

## 식별자

`formatVariantId`, `parseVariantId`, `parseSeed`, `exerciseOriginOf`, `variantGroupKey`는 `@proginone/exercise-core`에 있고(이 패키지가 다시 내보냄), [데이터 모델 설계](/docs/design/data-model.md#식별자-전략)의 형식을 따릅니다.
