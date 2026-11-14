# @proginone/exercise-kit

문제 유형 레지스트리와 유형별 스펙·답안 스키마, 순수 채점기, 정답 키 제거를 제공합니다.
I/O가 없는 순수 패키지이며 `@proginone/shared`에만 의존합니다.
설계 원천은 [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md)의 문제 유형 시스템입니다.

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

잘못된 입력은 `ExerciseKitError`(`code`: `UNKNOWN_TYPE`, `INVALID_SPEC`, `INVALID_ANSWER`, `INVALID_RUN_RESULT`, `RUN_REQUIRED`, `EXPECTED_MISSING` 등)를 던집니다.
오답은 오류가 아니라 정상적인 `GradeResult`입니다.

`GradeResult`의 `outcome`·`score`·`misconceptionIds`·`engineApplicable`·`graderVersion`은 `attempts` 행과 학습 엔진의 `AttemptFacts`에 그대로 들어갑니다.

## 구현된 유형

| 유형 | 범주 | 채점 입력 |
|---|---|---|
| `mcq_single` | recognition | 답안만 |
| `fill_blank` (`text` 모드) | recall | 답안만 |
| `predict_output` | recall | 답안 + 빌드가 실행으로 채운 `expected` |
| `fill_blank` (`code` 모드) | recall | 답안 + `RunResult` |
| `implement_function` | production | 답안 + `RunResult` (+ `serverFindings`) |
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

`SerializedValue`, 관측 단계(`ObservationStep`, `CheckBundle`), 관측값(`Observation`), `RunResult`, `RunPlan`, ProgInOne 콘솔 형식(`formatConsoleArgs`)은 `@proginone/shared`에 있습니다.
러너도 `shared`에만 의존할 수 있기 때문입니다.

## 식별자

`formatVariantId`, `parseVariantId`, `parseSeed`, `exerciseOriginOf`, `variantGroupKey`는 [데이터 모델 설계](/docs/design/data-model.md#식별자-전략)의 형식을 따릅니다.
