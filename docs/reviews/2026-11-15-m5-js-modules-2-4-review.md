# JS 기초 모듈 2·4 콘텐츠 AI 교차 검토 기록 (2026-11-15)

JS 기초 모듈 2 "값과 변수"의 나머지 세 단원과 모듈 4 "조건문" 세 단원(레슨 6개, 문제 94개)을 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
검토 방법, 단원별 판단, 직접 고친 내용, 오개념 병합 결정, 최종 문제 구성과 남은 한계를 적습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-15
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [결정 기록](/docs/decisions.md), [v0.1 콘텐츠 검토 기록](/docs/reviews/2026-11-15-v0.1-content-review.md)

## 검토 범위와 방법

대상은 아래 6개 단원의 레슨 본문과 문제 전부입니다.
모든 문제가 `review.status: draft`, `draftedBy: ai:claude`였습니다.
이미 승인된 `js-basics.values.variables`는 교차 참조가 깨지지 않았는지만 확인했고, 고치지 않았습니다.

| 단원 | 중요도 | 목표 문제 수 |
|---|---|---|
| `js-basics.values.data-types` 자료형 ★ | core | 24 |
| `js-basics.values.null-undefined` 비어 있는 값 | standard | 14 |
| `js-basics.values.var-and-tdz` var와 선언 전 사용 | standard | 12 |
| `js-basics.control.if-else` if와 else ★ | core | 22 |
| `js-basics.control.switch` switch 문 | standard | 12 |
| `js-basics.control.ternary` 조건 연산자 | standard | 10 |

설계 문서는 `core` 개념의 문제만 전수 검토하고 나머지는 30% 이상 샘플링하도록 하지만, 학습자가 이 제품의 유일한 사용자라 검토가 유일한 품질 관문이므로 **94문제 모두를 전수 검토**했습니다.

검토 절차:

1. 초안 작성 대화를 보지 않고, 원본 파일과 설계 문서(레슨 표준 섹션, 중요도별 깊이, 유형별 스펙, 체크 명세 언어, 난이도 루브릭과 분포, 문제 수 산정, 6단계 AI 교차 검토, 품질 체크리스트), 결정 기록 D-026~D-039, 작성 가이드, v0.1 검토 기록만 읽었습니다.
1. 검토 시작 전에 `pnpm content:check`(오류 0)를 직접 실행했습니다.
1. 레슨마다 품질 체크리스트의 레슨 항목, 12개 표준 섹션, 개념 중요도별 깊이(`core`: 2관점 원리·값 추적 표·예제 4~5개 중 예측 2개 이상·오개념 3개 이상·확인 문제 3~4개), 선수 개념 순서(모듈 2는 모듈 3보다 앞, 모듈 4는 모듈 3 뒤), 엄격 모드(D-026)와 브라우저 엔진 문법 오류 문구(D-030)와의 일관성을 확인했습니다.
1. 문제마다 체크리스트의 문제 항목을 확인했습니다. 특히 다음을 봤습니다.
   - 정답이 하나로 확정되는지, 체크가 맞는 프로그램을 모두 받아들이는지
   - 오답 선택지·원인 선택지의 `misconception` 연결이 그 선택지를 고르게 만드는 실제 오개념과 맞는지
   - 힌트 3단계가 점진적이고, 3단계가 정답 코드를 그대로 주지 않는지
   - 난이도를 루브릭(개념 수·추론 단계·구현량·함정)으로 다시 계산해 선언과 맞는지
   - 코드 속 줄 번호(설명·힌트·오류 메시지의 `N번째 줄`)가 실제 코드와 맞는지
1. 레슨과 문제에 나오는 오류 메시지는 Node(V8, 엄격 모드)로 실제 문구를 확인했습니다(`Unexpected number`, `missing ) after argument list`, `Invalid or unexpected token`, `Unexpected token '{'`, `Unexpected token 'const'`, `True is not defined`).
1. 수정 뒤 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(문제 345개, 예제 75개 — 통과 284, 실패 0, 실행 대상 아님 136)을 다시 실행했습니다. 예측 문제의 코드는 바꾸지 않아 `predict-expected.json`은 바뀌지 않았습니다.
1. `pnpm content:build:dev`로 빌드하고 앱(`PROGINONE_PORT=4485`, 임시 데이터 디렉터리)을 띄워 레슨 6개를 Playwright로 전체 페이지 캡처했습니다. 콘솔 오류는 없었습니다.

## 단원별 검토 요약

### js-basics.values.data-types ★

레슨과 문제 24개를 승인했습니다.
핵심 단원 기준(2관점 원리와 값 추적 표, 예제 5개 중 예측 4개, 오개념 12개 모두 흔한 실수에 포함, 확인 문제 4개, 실전 사례)을 충족합니다. 연산자는 모듈 1·2에서 이미 쓴 `+`·`*`만 쓰고, `"5" + 1`의 이어 붙이기는 "모듈 3에서 자세히 배운다"고 미리 밝혀 둡니다.

- 레슨: "JavaScript의 기본 값은 일곱 가지 자료형 중 하나"라는 표 다음에 객체 자료형이 따로 있다는 문장을 추가했습니다. 그대로 두면 모든 값이 일곱 가지 중 하나로 읽히고, 바로 뒤의 `typeof null`이 `"object"`라는 설명에 나오는 "객체"가 처음 등장하는 말이 됩니다.
- `find-bug-comma-number`: 원인 선택지 c2("4000보다 크면 쉼표로 나눠 써야 하는데 그러지 않았다")는 쉼표를 **쓴** 코드와 맞지 않는 오답이었고, c3("따옴표로 감싸지 않아서")은 연결된 오개념 `quoted-number-is-number`(`"5"`와 `5`가 같다)와 관계가 없었습니다. c2를 "`4,500`이 한 숫자로 읽혔는데 출력할 때 쉼표가 공백으로 바뀌었다"(`number-with-comma`)로, c3을 오개념 없는 오답으로 바꾸고 해설을 맞췄습니다.
- `impl-typeof-report`: 힌트 3이 `console.log(typeof value);`와 `value = ...;`의 배치를 그대로 알려 줘 정답과 거의 같았습니다. 구조만 알려 주도록 줄였습니다.
- 난이도 정정(루브릭 합계 기준):
  - `tf-quote-kinds` 2 → 1: 회상 한 단계, 함정 1개(합 2).
  - `impl-weekly-pay` 3 → 4: 조건 문장을 해석해 변수 3개와 중간값을 만들고 `10,030원`의 쉼표 함정을 피해야 하는 요구사항 해석형(합 7).
  - `impl-type-table` 4 → 3: `typeof`가 결과를 계산해 주므로 `typeof null`의 함정이 구현에는 작용하지 않습니다(합 5).

### js-basics.values.null-undefined

레슨과 문제 14개를 승인했습니다.

- 레슨: 학습 목표의 "계산 결과를 담지 않아서 생긴 버그"가 본문에는 흔한 실수의 한 문장으로만 나왔습니다. `undefined` 원리 설명에 `price * count;`만 쓰고 대입하지 않은 예를 짧게 추가해, 목표와 `fix-total-not-stored` 문제의 근거를 본문에 두었습니다.
- 레슨: 도입의 "이름이 빈 좌석을 고른 것인지"를 "좌석 번호가 빈 글자인 좌석을 고른 것인지, 아직 고르지 않은 것인지"로 고쳤습니다.
- 레슨: `undefined`와 `is not defined`를 비교하는 표의 코드(`let x;`, `undefined`, `ReferenceError: …`)가 일반 글자로 보여서, 인라인 코드로 감쌌습니다(화면 캡처에서 확인).
- `mcq-undefined-meaning`: 선택지 d가 쓰는 `empty-value-is-zero`를 문제의 `misconceptions` 목록에 추가했습니다.
- `impl-profile-from-typeof`: 힌트 3이 네 변수의 값을 모두 말로 알려 줘 정답 전체였습니다. 가장 쉬운 `phone`의 단서만 주도록 줄였습니다.

### js-basics.values.var-and-tdz

레슨과 문제 12개를 승인했습니다.
엄격 모드(D-026)에서 선언 없는 대입이 `ReferenceError`라는 점과, 비엄격 모드의 차이를 이 단원에서 설명한다는 D-026의 약속을 지킵니다.

- 오개념 연결 정정:
  - `mcq-tdz-message`: 선택지 d("`const`라서 값을 바꿀 수 없다")에 `const-can-reassign`(const도 다시 대입할 수 있다고 생각함)이 붙어 있었습니다. 이 선택지를 고르는 것은 오류 메시지를 혼동한 것이지 그 오개념이 아니라서 연결을 지웠습니다.
  - `mcq-var-before-declaration`: 선택지 d(`timeLeft is not defined`)의 `not-defined-is-undefined` 연결도 같은 이유로 지웠습니다.
- `find-bug-var-hoisting`: 원인 선택지 c3("1번 줄의 쉼표 때문에 값이 출력되지 않았다")은 그럴듯하지 않은 오답이었습니다. "값까지 끌어올려지므로 2번 줄은 문제없고 1번 줄의 console.log 쓰는 법이 틀렸다"로 바꿔 `var-hoists-value` 오개념을 실제로 대표하게 했습니다.
- `impl-hoisting-experiment`: 힌트 3이 세 줄 중 두 줄을 그대로 알려 줬습니다. 형태만 알려 주도록 줄였습니다.

### js-basics.control.if-else ★

레슨과 문제 22개를 승인했습니다.
핵심 단원 기준(갈림길·실행 추적 2관점, 줄 단위 추적 표, 예제 5개 중 예측 4개, 오개념 8개, 확인 문제 4개, 실전 사례)을 충족합니다. 비교·논리 연산자(`>`, `>=`, `===`, `&&`)와 truthy·falsy는 모두 모듈 3에서 배운 뒤라 문제없습니다.

- 오개념 병합: `js.mc.assign-in-condition`을 모듈 3의 `js.mc.assign-as-compare`로 합쳤습니다([아래](#오개념-병합-결정)). 레슨의 흔한 실수, `tf-assign-in-condition`, `fix-password-check`, `fix-cafe-order-bugs`의 연결을 바꿨습니다.
- 선수 개념 정리([아래](#선수-개념-정리)).
- `impl-grade-two-students`: 힌트 3이 체인 전체(조건 네 개 포함)를 그대로 줘서, 조건 자리를 비운 형태와 기준 순서만 알려 주도록 줄였습니다.
- 난이도 정정: `predict-first-true-only` 3 → 2, `predict-separate-ifs` 3 → 2. 개념 하나를 그대로 적용해 조건 세 개를 차례로 따지는 예측이라 루브릭 합이 3~4입니다.

### js-basics.control.switch

레슨과 문제 12개를 승인했습니다.
레슨의 줄 번호 해설(7번 줄, 15번 줄 등), `case`에 조건식을 쓸 때의 동작, `===` 비교 설명이 모두 정확했습니다. 고칠 것이 없었고 선수 개념만 보강했습니다.

### js-basics.control.ternary

레슨과 문제 10개를 승인했습니다.
우선순위 함정(`"결과: " + score >= 60 ? … : …`)의 계산 과정(`NaN` 비교라 `false`)이 정확하고, 모듈 3의 형 변환과 잘 이어집니다.

- 난이도 정정: `fix-ternary-discarded` 3 → 2. 버린 결과를 대입 두 줄로 받는 한 단계 적용입니다(합 4).

## 오개념 병합 결정

모듈 4의 `js.mc.assign-in-condition`("if 조건에 `=`를 써도 비교된다고 생각함")과 모듈 3의 `js.mc.assign-as-compare`("비교하려고 `=`를 씀")가 같은 오개념인지 판단했습니다.

**결정: 같은 오개념이므로 `js.mc.assign-as-compare`로 합쳤습니다.**

- 두 항목이 진단하는 학습자의 믿음은 하나입니다. "같은지 확인하려는 자리에서는 `=`가 비교로 동작한다"입니다. `if (password = "1234")`와 `const isPerfect = score = 100`은 그 믿음이 나타나는 장소만 다르고, 고치는 방법(`===`)도 같습니다.
- 둘로 나누면 같은 믿음의 관측 근거가 두 오개념으로 흩어져, 학습 엔진의 오개념 확인·해소 판정과 보충 문제 선택이 각각 절반의 증거로 움직입니다.
- 남길 ID로는 `===`를 처음 가르치는 비교 단원의 `assign-as-compare`를 골랐습니다. 오개념은 그 개념을 처음 소개한 곳에 붙이는 것이 자연스럽고, 모듈 3 문제 8개가 이미 이 ID를 씁니다.

바꾼 내용:

- `misconceptions/js.yaml`: `assign-in-condition`을 지우고, `assign-as-compare`의 `statement`에 "조건 괄호 안에 쓰면 `=`도 비교로 동작한다고 생각하기도 한다"를, `reality`에 조건 자리의 결과(원래 값을 덮어쓰고, 대입한 값의 참·거짓으로 판단해 if 블록이 늘 실행됨)를 더했습니다. 모듈 4에 있던 `diagnosticHint`를 옮기고, 보충 문제에 `if-else.tf-assign-in-condition`, `if-else.fix-password-check`를 추가했습니다. `lessonSection`은 비교 단원 그대로입니다.
- `concepts/js.yaml`: `js.control.if`의 `misconceptions`에서 지웠습니다(오개념의 `concept`는 `js.ops.strict-equality` 하나여야 하므로).
- if-else 레슨의 `<Pitfall>`과 문제 3개(`tf-assign-in-condition`, `fix-password-check`, `fix-cafe-order-bugs`)의 연결을 `assign-as-compare`로 바꿨습니다. 문제 ID는 그대로 둡니다.
- 커리큘럼 표의 if-else 대표 오개념 "조건에 `=`를 써도 비교된다고 생각함"은 if-else 레슨의 흔한 실수와 위 문제들이 계속 다룹니다.

모듈 3 검토가 같은 파일을 동시에 고치고 있어, 이 PR은 `assign-as-compare` 항목 하나와 모듈 4 항목만 건드렸습니다.

## 선수 개념 정리

모듈 3이 main에 들어왔으므로, 조건문 개념이 실제로 쓰는 비교·논리·형 변환 개념을 선수 관계로 적었습니다(`content/concepts/js.yaml`).

| 개념 | 이전 | 이후 |
|---|---|---|
| `js.control.if` | `types.boolean` | `types.boolean`, `ops.strict-equality`, `ops.relational`, `ops.logical-and-or-not`(helpful), `conv.truthy-falsy`(helpful) |
| `js.control.switch` | `control.else-if` | `control.else-if`, `ops.strict-equality` |
| `js.control.ternary` | `control.if` | `control.if`, `ops.precedence`(helpful), `conv.plus-concat`(helpful) |

- 조건식에 비교 연산자가 거의 항상 쓰이므로 `strict-equality`·`relational`은 필수로, 레슨의 한두 곳에서만 쓰는 `&&`와 truthy·falsy 안내는 `helpful`로 두었습니다.
- `switch`는 `===`로 비교한다는 것이 단원의 핵심이라 `strict-equality`를 필수로 두었습니다.
- 조건 연산자의 우선순위 함정은 `+`·비교 연산의 우선순위와 문자열 이어 붙이기를 알아야 이해되므로 두 개념을 `helpful`로 두었습니다.
- `else-if`·`block`·`fallthrough`는 `control.if`·`control.switch`를 거쳐 위 선수 개념을 이어받으므로 그대로 두었습니다.
- 단원 메타데이터에 실제 연습하는 개념을 적었습니다: if-else의 `practiced`에 `ops.relational`, `ops.strict-equality`, switch의 `practiced`에 `ops.strict-equality`.
- 모듈 4 레슨·문제가 모듈 3보다 늦게 배우는 연산자(템플릿 문자열, 배열 메서드 등)를 쓰지 않는지 확인했습니다. 시작 코드의 `addEventListener`·화살표 함수(웹 실습 3개)는 "모듈 10에서 배워요"라는 안내와 함께 이미 작성된 부분에만 있습니다.

## 최종 문제 구성

승인된 문제 94개, 미승인 0개입니다. 단원별 승인 수는 `practice.targetCount`와 같습니다.

### 유형 범주 (JS 목표: 개념 확인 25 · 코드 이해 25 · 디버깅 20 · 구현 20 · 응용 10, ±10%p)

응용은 난이도 4 이상의 구현·버그 수정·웹 실습이고, 디버깅·구현 칸에서 뺐습니다.

| 단원 | 개념 확인 | 코드 이해 | 디버깅 | 구현 | 응용 (L4+) |
|---|---|---|---|---|---|
| data-types (24) | 7 (29%) | 7 (29%) | 3 (13%) | 4 (17%) | 3 (13%) |
| null-undefined (14) | 4 (29%) | 4 (29%) | 2 (14%) | 2 (14%) | 2 (14%) |
| var-and-tdz (12) | 3 (25%) | 4 (33%) | 2 (17%) | 2 (17%) | 1 (8%) |
| if-else (22) | 6 (27%) | 6 (27%) | 4 (18%) | 3 (14%) | 3 (14%) |
| switch (12) | 3 (25%) | 3 (25%) | 2 (17%) | 2 (17%) | 2 (17%) |
| ternary (10) | 3 (30%) | 2 (20%) | 2 (20%) | 2 (20%) | 1 (10%) |

모든 단원이 범위 안입니다.

### 유형별 수

| 단원 | mcq_single | mcq_multi | true_false | predict_output | fill_blank | parsons | find_bug_line | fix_bug | implement_function | web_task |
|---|---|---|---|---|---|---|---|---|---|---|
| data-types | 3 | 2 | 2 | 4 | 1 | 1 | 1 | 4 | 6 | |
| null-undefined | 2 | 1 | 1 | 2 | 1 | | 1 | 3 | 3 | |
| var-and-tdz | 2 | | 1 | 2 | | 1 | 1 | 3 | 2 | |
| if-else | 3 | 1 | 2 | 3 | 1 | 1 | 1 | 5 | 4 | 1 |
| switch | 1 | 1 | 1 | 2 | | | 1 | 3 | 2 | 1 |
| ternary | 1 | 1 | 1 | 2 | | | | 3 | 1 | 1 |

모든 단원이 유형 4종 이상이고, 한 유형이 50%를 넘지 않습니다.

### 난이도 (검토 후)

| 단원 | L1 | L2 | L3 | L4 | L5 | 목표 (L1/L2/L3/L4/L5) |
|---|---|---|---|---|---|---|
| data-types ★ | 4 (17%) | 10 (42%) | 7 (29%) | 3 (13%) | 0 | 15 / 30 / 30 / 20 / 5 |
| null-undefined | 2 (14%) | 7 (50%) | 3 (21%) | 2 (14%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| var-and-tdz | 2 (17%) | 5 (42%) | 4 (33%) | 1 (8%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| if-else ★ | 3 (14%) | 9 (41%) | 7 (32%) | 3 (14%) | 0 | 15 / 30 / 30 / 20 / 5 |
| switch | 2 (17%) | 4 (33%) | 4 (33%) | 2 (17%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| ternary | 2 (20%) | 4 (40%) | 2 (20%) | 2 (20%) | 0 | 20 / 35 / 30 / 15 / 0~5 |

난이도는 목표 분포에 맞추려고 바꾸지 않고 루브릭 합계대로 표시했습니다. 초안은 단순 예측이나 한 단계 수정을 L3로 표시하는 등 과대 표시가 많았고, 요구사항 해석형 구현 하나는 과소 표시였습니다. 검토 후 정정은 6건(올림 1, 내림 5)이며, 결과적으로 L2가 목표보다 많고 L4가 조금 부족합니다.

### 주 개념별 수 (최소: JS core 6 · standard 4)

| 개념 | 중요도 | 문제 수 |
|---|---|---|
| `js.types.primitives` | core | 6 |
| `js.types.typeof` | core | 6 |
| `js.types.number` / `string` / `boolean` | standard | 4 / 4 / 4 |
| `js.types.undefined` / `null` | standard | 7 / 7 |
| `js.values.var` / `tdz` | standard | 6 / 6 |
| `js.control.if` | core | 7 |
| `js.control.else-if` | core | 9 |
| `js.control.block` | standard | 6 |
| `js.control.switch` / `fallthrough` | standard | 6 / 6 |
| `js.control.ternary` | standard | 10 |

모든 주 개념이 개념 이해·코드 이해·실습 유형을 각각 1개 이상 가집니다.

## 남은 한계와 후속 제안

1. **L4가 부족하고 L2가 많습니다.** 두 핵심 단원 모두 L4가 13~14%(목표 20%)이고 L5는 0입니다. 다음 콘텐츠 작업에서 요구사항 해석형 L4 구현이나 모듈 단원 평가(`control-review`, M6 예정)에서 보강하기를 권합니다.
1. **`rubric` 필드가 여전히 없습니다.** 이번 난이도 판단도 검토자가 루브릭으로 직접 계산했습니다. 빌드의 난이도 불일치 경고가 동작하려면 원본에 루브릭 점수를 기록해야 합니다.
1. **프로그램 작성 문제에서 채점하지 않는 요구사항이 있습니다.** `static` 체크가 서버에 아직 없어 "typeof로 확인해 출력", "case를 묶어서", "조건 연산자로", "중첩 조건문으로" 같은 지시를 강제할 수 없습니다. 결과를 직접 적어도 통과하는 문제가 있으며(`impl-typeof-report`, `impl-type-table`, `impl-recycling-day`, `impl-weather-labels`, `impl-library-loan` 등), 해설에서 왜 지시대로 쓰는지 설명합니다. `static` 체크가 구현되면 비필수 정적 규칙(`require-syntax`)을 붙이기를 권합니다.
1. **복습용 템플릿이 없습니다.** 설계상 주 개념마다(minor 제외) 템플릿이 필요하지만 템플릿 기능이 아직 없습니다.
1. **화면에서 확인한 앱 쪽 문제 (코드 범위 밖, 고치지 않음)**: 레슨 안 확인 문제(`InlineExercise`)에서 선택형 문제의 `code`가 "출력"이라는 머리글이 붙은 상자에 보입니다(예: if-else의 `mcq-false-condition-continues`). 코드 조각인데 실행 결과처럼 읽힐 수 있어, 머리글을 "코드"로 바꾸기를 권합니다.
1. **오개념 병합과 동시 작업**: 모듈 3 검토가 같은 `misconceptions/js.yaml`의 연산자 구역을 고치고 있어, `assign-as-compare` 항목에서 병합 충돌이 날 수 있습니다. 충돌이 나면 이 기록의 `statement`·`reality`·`diagnosticHint` 보강과 보충 문제 두 개 추가를 모듈 3 쪽 수정과 합쳐 주세요.
