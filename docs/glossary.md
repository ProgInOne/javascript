# 용어집

ProgInOne 문서와 코드에서 쓰는 용어의 단일 정의입니다.
문서는 아래 한국어 표기를, 코드는 "코드 식별자" 열의 이름을 씁니다.
새 용어는 이 문서에 먼저 추가한 뒤 사용합니다.

## 커리큘럼 용어

| 한국어 | 코드 식별자 | 정의 |
|---|---|---|
| 트랙 | `Track` | 여러 과정을 묶는 학습 분야. 예: "웹 프론트엔드 기초". MVP에서는 하나만 존재 |
| 과정 | `Course` | 하나의 기술을 다루는 학습 단위. 예: "JavaScript 기초". 여러 모듈로 구성 |
| 모듈 | `Module` | 과정 안의 큰 주제 묶음. 예: "함수". 여러 단원으로 구성 |
| 단원 | `Lesson` | 한 번의 학습 세션(15~40분)에서 완료할 수 있는 학습 단위. 레슨 본문과 연습 세트를 가짐 |
| 개념 | `Concept` | 숙련도를 측정하는 최소 지식 단위. 예: "화살표 함수의 `this`". 단원과 다대다 관계 |
| 선수 관계 | `ConceptPrerequisite` | "개념 A를 배우려면 개념 B가 필요하다"는 방향 그래프의 간선. 순환 금지(DAG) |
| 레슨 본문 | `LessonContent` | 단원의 설명 콘텐츠 (MDX). 섹션(학습 목표, 원리, 예제, 흔한 실수 등)으로 구성 |
| 단원 평가 | `Assessment` | 단원 또는 모듈 종료 시 치르는 종합 문제 세트 |
| 프로젝트 | `Project` | 여러 개념을 조합해 완성하는 다단계 응용 실습 |
| 오개념 | `Misconception` | 학습자가 흔히 갖는 잘못된 이해. 개념에 연결되며, 객관식 오답 선택지가 특정 오개념을 가리킬 수 있음 |
| 콘텐츠 팩 | `ContentPack` | 빌드된 콘텐츠 묶음 (`content.db`). 버전 번호를 가짐 |

## 문제 용어

| 한국어 | 코드 식별자 | 정의 |
|---|---|---|
| 문제 | `Exercise` | 학습자가 푸는 하나의 문항. 유형, 난이도, 관련 개념, 채점 명세를 가짐 |
| 문제 유형 | `ExerciseType` | 문제의 UI와 채점 방식을 정의하는 플러그인. 예: `mcq_single`, `predict_output` |
| 문제 템플릿 | `ExerciseTemplate` | 매개변수를 바꿔 여러 변형을 만드는 파라메트릭 문제 원본 |
| 변형 | `ExerciseVariant` | 템플릿에 특정 매개변수를 넣어 만든 구체적 문제 인스턴스 |
| 난이도 | `difficulty` | 1~5 단계. L1 개념 확인, L2 기본 적용, L3 복합 개념, L4 실전 응용, L5 심화·도전 |
| 문제 출처 | `ExerciseOrigin` | `authored`(사전 제작), `template`(파라메트릭), `generated`(런타임 AI 생성) |
| 검증 상태 | `VerificationStatus` | `draft` → `auto_verified` → `trusted`, 또는 `flagged` / `quarantined` |
| 채점기 | `Grader` | 문제 유형별 정답 판정 로직. 결정론적 채점을 우선함 |
| 체크 | `Check` | 실습 문제의 개별 검증 항목 (테스트 케이스, DOM·CSS assertion 등) |
| 힌트 단계 | `hintLevel` | 0(없음), 1(방향 제시), 2(핵심 개념·부분 코드), 3(거의 완성된 가이드). 정답 열람은 별도 `solutionViewed` |
| 연습 세트 | `PracticeSet` | 한 번에 제시되는 문제 묶음. 단원 연습, 복습, 단원 평가, 약점 집중, 자유 연습(P1) 등. 종류(`kind`)가 학습 맥락을 정함 |
| 학습 맥락 | `PracticeSet.kind` → `W_ctx` | 학습·연습·평가·복습. 맥락마다 힌트 허용과 증거 가중치가 다름. 평가 맥락은 힌트·튜터 잠금 |
| 자유 연습 | `custom` 세트 | 학습자가 개념·난이도·유형·문제 수를 골라 만드는 연습 세트(P1) |
| 문제 범주 | `ExerciseCategory` | 문제 유형의 증거 범주: `recognition`(재인), `recall`(회상·이해), `production`(생성). 숙련도 증거 가중치에 사용 |
| 문제 용도 | `usage` | `practice` / `assessment` / `diagnostic` / `remedial` / `worked_example` |
| 단계적 풀이 예제 | `WorkedExample`, `workedExampleStage` | 완전한 풀이(0) → 일부 빈칸(1) → 직접 풀기(2)로 진행하는 재학습용 문제 묶음 |
| 변형 그룹 | `variantGroup`, `variantGroupKey` | "사실상 같은 문제"를 묶는 키. 지정이 없으면 템플릿 변형은 템플릿 ID, 그 외는 문제 ID. 같은 그룹은 한 세트에 1개만 출제하고 문제 수 집계에서 1개로 셈 |
| 반복 감쇠 | `W_rep` | 같은 변형 그룹의 정답을 14일 안에서 1.0 → 0.5 → 0.25로 약하게 반영하는 증거 가중치 |
| 시드 | `seed` | 템플릿 변형을 결정론적으로 만드는 64비트 값. 변형 ID는 `<템플릿 ID>@<seed>` |
| 정답 키 | answer key | 스펙 중 학습자에게 보내면 안 되는 필드(정답, 참조 구현, 숨김 체크 기대값). `redact`가 제거 |
| 공개 스펙 | `PublicSpec` | 유형의 `redact(spec)` 결과. 클라이언트로 보내는 문제 데이터 |
| 공개 체크 / 숨김 체크 | `visible` | 공개 체크는 입력·기대값을 학습자에게 보여주고, 숨김 체크는 설명만 보여줌 |
| 실행 계획 | `RunPlan` | 서버가 문제와 답안으로 만드는 샌드박스 실행 명세(파일, 하네스 옵션, 체크 번들). 기대값 없음 |
| 숨김 검증 실행 | `purpose: 'verification'` | 학습자에게 보이지 않게 정답·변형·생성 문제를 실행해 기대값을 계산하거나 검증하는 실행 |
| 내용 해시 / 개정 번호 | `contentHash`, `revision` | 문제 내용의 해시와 정답에 영향을 주는 수정 횟수. `invalidatesPrevious`면 이전 판 시도를 숙련도에서 제외 |
| 문제 스냅샷 | `ExerciseSnapshot` | 출제 시점의 `PublicSpec`. 과거 풀이 비교에 사용 |
| 지문(중복 검사) | `Fingerprint` | 문제 중복 검사용 정규화 서명(AST 정규화 해시, n-gram) |
| 누설 지문 | leak fingerprint | AI 힌트·튜터 응답이 정답을 노출했는지 검사하는 정답 리터럴·기대 출력·참조 구현 핵심 줄의 정규화 해시 |
| 개념 중요도 | `importance` | 개념과 단원의 `core` / `standard` / `minor`. 레슨 깊이, 문제 수 목표, 연습 세트 크기, 복습 우선순위에 영향 |
| 난이도 루브릭 | `rubric` | 개념 수, 추론 단계, 구현량, 함정 4항목 점수로 L1~L5를 정하는 기준 |
| 마일스톤 | `milestone` | `web_task`에서 체크를 단계로 묶은 프로젝트형 진행 단위 |
| 통과 기준 | `PassRule` | 연습 세트 통과 판정 필드(`minCorrect`, `minConceptCredit`, `minDistinctTypes`, `minLevel3Correct`). 단원이 일부 덮어쓸 수 있음 |
| 별칭 | alias | 바뀐 slug의 매핑(`rename` / `merge` / `split`). `content/aliases.yaml` |
| 콘텐츠 원본 스키마 버전 | `schemaVersion` | `pack.yaml`의 원본 형식 버전. `content-schema` 패키지와 일치해야 함 |
| 고아 참조 | `orphan_refs` | user.db가 참조하지만 콘텐츠 팩에서 해석되지 않는 콘텐츠 ID. 기록은 지우지 않고 "보관됨"으로 표시 |

## 학습 기록 용어

| 한국어 | 코드 식별자 | 정의 |
|---|---|---|
| 학습자 | `Learner` | 플랫폼 사용자. MVP에서는 1명이지만 스키마는 `learnerId`를 가짐 |
| 시도 | `Attempt` | 한 문제에 대한 한 번의 답안 제출과 채점 결과 |
| 제출물 | `Submission` | 시도에 포함된 답안 원본 (선택지, 코드 파일 등) |
| 확신도 | `confidence` | 제출 시 학습자가 고르는 확신 정도: `sure` / `unsure` / `guess` |
| 학습 세션 | `StudySession` | 앱에서 연속으로 학습한 시간 구간. 비활성 10분이 지나면 종료 |
| 숙련도 | `mastery` | 개념별 0~100 점수. 얼마나 잘 아는가 |
| 숙련 단계 | `MasteryStage` | `not_started`(미학습), `introduced`(입문), `practicing`(연습 중), `proficient`(숙련), `mastered`(숙달) |
| 숙련도 근거 | `MasteryEvidence` | 숙련도 변화의 원인이 된 시도와 계산 내역. 설명 가능성을 위해 저장 |
| 기억 상태 | `ConceptMemory` | 개념별 FSRS 상태 (stability, difficulty, due 등). 언제 복습할까 |
| 복습 큐 | `ReviewQueue` | 오늘 복습 예정인 개념 목록. 학습 엔진이 계산 |
| 오개념 관측 | `MisconceptionObservation` | 특정 오개념의 근거가 된 시도 기록. 상태는 `suspected`(의심) / `confirmed`(확정) / `resolved`(해소) / `dismissed`(기각). 전이 규칙은 [학습 엔진 설계](/docs/design/learning-engine.md#오개념-상태-전이) |
| 미분류 오개념 후보 | `ai.<ULID>` 오개념 ID | AI가 제안했지만 오개념 카탈로그에 없는 오개념. 튜터 맥락에만 쓰고 숙련도·문제 선택에는 쓰지 않음 |
| 개인 노트 | `Note` | 학습자가 쓰거나 튜터 답변·코드에서 저장한 메모. 개념·단원·문제에 연결(P1) |
| 오답 노트 | `MistakeNote` | 틀린 시도를 모아 보여주는 화면이자 뷰. 별도 저장이 아닌 시도에서 파생 |
| 학습 목표 | `Goal` | 일일 학습 시간, 주간 학습 일수, 과정 완료 목표일 |
| 오늘의 학습 | `DailyPlan` | 목표와 복습 큐를 기반으로 학습 엔진이 제안하는 오늘의 할 일 목록 |
| 학습자 모델 | `LearnerModel` | 숙련도, 기억 상태, 오개념, 선호도를 합친 학습자 상태의 논리적 개념 |

## 학습 엔진 용어

| 한국어 | 코드 식별자 | 정의 |
|---|---|---|
| 유효 숙련도 | `effectiveMastery` | 저장된 숙련도에 망각(FSRS 회상 확률)을 반영해 조회 시 계산하는 값 |
| 회상 확률 | `retrievability` | FSRS가 추정한 지금 시점의 기억 유지 확률(R) |
| 증거 가중치 | `evidenceWeight` | 시도 하나가 개념 숙련도에 주는 영향의 크기. 개념·유형 범주·난이도·시도·힌트·확신도·시간 요소의 곱 |
| FSRS 평가 등급 | `FsrsRating` | `again` / `hard` / `good` / `easy` |
| 보류 등급 | `PendingRating` | 같은 날 같은 개념의 여러 시도에서 모은 FSRS 등급 후보. 하루 한 번 가장 나쁜 쪽으로 합쳐 적용 |
| 재학습 제안 | `RemediationSuggestion` | 반복 실패 시 학습 엔진이 내는 제안(선수 개념 점검, 단계적 풀이 예제, 레슨 다시 읽기). 학습자는 거절 가능 |
| 약점 점수 | `weakness` | 약점 집중 세트의 개념 선택 점수 |
| 페이스 상태 | `PaceStatus` | 목표 완료일 대비 진행 상태: `on_track` / `tight` / `behind` / `overdue` |
| 일일 복습 상한 | `maxDailyReviews` | 하루에 복습 큐로 내보내는 개념 수 상한. 기본 20 |
| 하루 시작 시각 | `dayStartHour` | "하루"의 경계 시각. 기본 04:00 |
| 학습 엔진 버전 | `ENGINE_VERSION` | 숙련도·연습 세트 계산 규칙의 버전. 파생 상태와 함께 저장 |

## AI 용어

| 한국어 | 코드 식별자 | 정의 |
|---|---|---|
| AI 제공자 | `AIProvider` | AI 모델 접근 수단. 예: Codex App Server |
| 제공자 어댑터 | `ProviderAdapter` | 제공자별 프로토콜 차이를 숨기는 구현체. 공통 인터페이스 `runTask` 제공 |
| AI 작업 | `AITask` | 하나의 AI 역할 호출 단위. 프롬프트 템플릿, Context Builder, 출력 스키마, 후처리 검증으로 구성. 예: `tutor.reply`, `exercise.generate` |
| AI 역할 | `AIRole` | Tutor, Evaluator, ProblemGenerator, SessionSummarizer 등 논리적 역할. 별도 에이전트가 아니라 AI 작업의 묶음 |
| 컨텍스트 빌더 | `ContextBuilder` | DB에서 필요한 학습 정보를 조회해 토큰 예산 안에서 AI 입력을 구성하는 모듈 |
| 튜터 스레드 | `TutorThread` | 단원 또는 문제 단위의 AI 대화. 원문 전체를 보관 |
| 메시지 | `TutorMessage` | 튜터 스레드의 한 발화 |
| 세션 요약 | `SessionSummary` | 튜터 스레드 또는 학습 세션 종료 시 생성하는 구조화된 요약 |
| 제공자 스레드 | `providerThreadId` | 제공자 쪽 세션 ID (예: Codex thread id). 캐시로만 취급 |
| 작업 실행기 | `TaskRunner` | AI 작업을 실행하는 공통 경로: 컨텍스트 조립 → 제공자 호출 → 출력 검증 → 기록 |
| 컨텍스트 소스 | `ContextSource` | 컨텍스트 빌더가 DB를 조회하는 인터페이스. 서버가 구현해 주입 |
| 컨텍스트 섹션 | `ContextSection` | 컨텍스트를 이루는 단위(학습 상태, 현재 문제, 대화 요약 등). 우선순위와 토큰 예산을 가짐 |
| 재구성 | rehydration | 제공자 스레드가 없거나 맞지 않을 때 DB의 요약과 최근 메시지로 새 제공자 스레드를 만드는 것 |
| 골든 세트 | golden set | 프롬프트 회귀 평가용 고정 입력과 기대 특성 목록 |
| 모의 제공자 | `MockProvider` | 테스트용 결정론적 AI 제공자. `PROGINONE_AI_PROVIDER=mock` |
| AI 호출 기록 | `ai_calls` | AI 호출 한 건의 메타데이터(작업, 버전, 지연, 토큰, 결과) |
| 연기 작업 큐 | `ai_jobs` | 사용량 한도·연결 문제로 미뤄진 백그라운드 AI 작업 |
| 선제 제안 | proactive suggestion | 반복 실패·정체·확신 오답 시 튜터 버튼에 표시하는 도움 제안. 대화를 자동으로 열지 않음 |

## 실행 환경 용어

| 한국어 | 코드 식별자 | 정의 |
|---|---|---|
| 러너 | `Runner` | 학습자 코드를 격리 환경에서 실행하고 결과를 돌려주는 모듈 |
| 샌드박스 | `Sandbox` | 러너가 코드를 실행하는 격리 영역. `sandbox` 속성 iframe (opaque origin) |
| 러너 호스트 | `RunnerHost` | 메인 앱 쪽에서 샌드박스를 생성·통신·폐기하는 컨트롤러 |
| 실행 요청 | `RunRequest` | 파일 묶음, 실행 모드, 체크 목록, 제한값을 담은 메시지 |
| 실행 결과 | `RunResult` | 콘솔 출력, 오류, 체크 결과, 실행 시간, 종료 사유를 담은 메시지 |
| 워치독 | `Watchdog` | 시간 제한을 넘긴 실행을 강제로 중단하는 감시자 |
| 러너 셸 | `RunnerShell` | 서버가 셸 CSP 헤더와 함께 제공하는 `/sandbox/runner.html`. opaque origin iframe으로 열림 |
| 테스트 하네스 | `Harness` | 샌드박스 안에서 학습자 코드 실행을 감싸고 콘솔 캡처·관측 단계를 수행하는 코드 |
| 준비 워커 | `PrepareWorker` | 실행 전 코드 계측(반복문 보호, 위치 매핑), 포맷, `html-validate`를 수행하는 Worker |
| 체크 번들 | `CheckBundle` | 샌드박스에 보내는 관측 단계 목록. 기대값 없음 |
| 관측값 | `Observation` | 관측 단계 하나의 결과(반환값, 계산된 스타일, 상자 좌표 등). 비교는 서버가 함 |
| 직렬화 값 | `SerializedValue` | 콘솔·관측값 전달용 태그 기반 값 표현. 표시와 정답 비교의 입력 |
| ProgInOne 콘솔 형식 | console format | `SerializedValue`를 문자열로 보여주는 형식. 실행 결과 예측의 기대 출력 형식과 같음 |
| 반복문 보호 | `LoopGuard` | DOM 모드에서 반복문에 시간 검사를 삽입하는 계측 |
| 노출 스크립트 | expose script | 최상위 `let`/`const` 식별자를 하네스가 읽을 수 있게 학습자 스크립트 뒤에 실행하는 생성 스크립트 |
| 가상 타이머 | `timers: 'virtual'` | 채점·검증에서 시간 경과를 시뮬레이션하는 타이머 모드 |
| 실행 상태 | `RunResult.status` | `completed` / `error` / `timeout` / `loop_limit` / `crashed` / `aborted`. `crashed`·`aborted`는 숙련도에 반영하지 않음 |

## 화면 용어

| 한국어 | 코드 식별자 | 정의 |
|---|---|---|
| 읽기 모드 | `read` mode | 레슨 본문 중심의 학습 화면 배치 |
| 실습 모드 | `practice` mode | 문제와 에디터·미리보기·콘솔 중심의 학습 화면 배치 |
| 튜터 드로어 | `TutorDrawer` | 학습 화면 오른쪽에서 열리는 AI 튜터 패널 |
| 커맨드 팔레트 | `CommandPalette` | ⌘K로 여는 전역 검색·명령 창 |
| 디자인 토큰 | design token | 색·간격·타이포그래피 등 디자인 값을 이름으로 정의한 CSS 변수 |
| 학습 헤더 | learn header | 학습 화면 전용 상단 바(뒤로, 빵부스러기, 모드 전환, 목표 링, AI 상태, 튜터 버튼) |
| 하단 행동 바 | action bar | 실습 모드 하단의 자동 저장 상태·실행·제출·건너뛰기·다음 버튼 영역 |
| 커리큘럼 레일 | `CurriculumRail` | 학습 화면 왼쪽의 접히는 커리큘럼 내비게이션 |
| 개념 지도 | `ConceptMap` | 모듈 행 × 개념 타일 그리드로 숙련 단계를 보여주는 대시보드 영역 |
| 개념 상세 시트 | `ConceptSheet` | 개념의 숙련 단계, 근거, 다음 단계 조건, 오개념을 보여주는 시트 |
| 실행 가능 예제 | `RunnableExample` | 레슨 본문의 예측 후 실행 예제 |
| 예측 후 실행 | predict-then-run | 실행 전에 결과를 먼저 예측하게 하는 인터랙션(PRIMM) |
| 떠올려보기 | recall prompt | 요약을 보기 전에 핵심을 먼저 떠올리게 하는 접힌 카드(인출 연습) |
| 힌트 사다리 | `HintLadder` | 힌트 3단계와 정답 보기를 차례로 여는 컴포넌트 |
| 확신도 선택 | `ConfidencePicker` | 제출 버튼을 "확실해요 / 애매해요 / 찍었어요"로 나눈 컴포넌트 |
| 컨텍스트 칩 | `ContextChip` | 튜터에게 전달되는 맥락을 보여주고 제거할 수 있게 하는 칩 |
| 약점 집중 | `WeakSpotPractice` | `weakness` 상위 개념으로 구성한 연습 세트(`PracticeSet.kind = 'weakness'`) 화면 |
| 콘솔 패널 | `ConsoleView` | 실행 출력과 실행 상태를 보여주는 패널 |

## 디자인 시스템 용어

| 한국어 | 코드 식별자 | 정의 |
|---|---|---|
| 기본 토큰 | primitive token | 원시 디자인 값(예: `--jade-600`). 컴포넌트가 직접 쓰지 않음 |
| 의미 토큰 | semantic token | 용도 이름의 토큰(예: `--color-text-muted`). 라이트/다크에서 다른 기본 토큰에 매핑 |
| 엘리베이션 | elevation | 표면의 층위. 그림자와 표면 색으로 표현 |
| 컴포넌트 카탈로그 | `/__catalog` | 개발 모드 전용 라우트. 컴포넌트 상태를 모아 보여주고 시각 회귀 촬영에 사용 |
