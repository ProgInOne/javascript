# JS 기초 모듈 6 콘텐츠 AI 교차 검토 기록 (2026-11-15)

JS 기초 모듈 6 "함수"(레슨 6개, 문제 124개)를 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
검토 방법, 초안 작성자 메모에 대한 판단, 단원별 요약, 직접 고친 내용, 최종 문제 구성과 남은 한계를 적습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-15
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [결정 기록](/docs/decisions.md), [JS 기초 모듈 5 검토](/docs/reviews/2026-11-15-m5-js-module-5-review.md)

## 검토 범위와 방법

대상은 `content/courses/js-basics/modules/06-functions/`의 레슨 본문과 문제 전부입니다. 이 모듈의 개념 18개(`content/concepts/js.yaml`)와 오개념 38개(`content/misconceptions/js.yaml`)도 함께 봤습니다.
모든 문제가 `review.status: draft`, `draftedBy: ai:claude`였습니다.

| 단원 | 중요도 | 목표 문제 수 |
|---|---|---|
| `function-basics` 함수 선언과 호출 ★ | core | 28 |
| `return-and-side-effects` 반환값과 부수 효과 | standard | 18 |
| `expressions-and-arrows` 함수 표현식과 화살표 함수 ★ | core | 22 |
| `default-and-rest` 기본값과 나머지 매개변수 | standard | 14 |
| `scope-basics` 스코프 기초 ★ | core | 24 |
| `callbacks-intro` 함수를 값으로 다루기 | standard | 18 |

단원 평가(`functions-review`)는 단원 평가 작업에서 따로 추가하므로 이번 범위가 아닙니다.
D-027 기준으로 레슨 본문, 핵심 단원(★)의 문제, 핵심 개념 문제는 전수 검토 대상입니다. 나머지 단원도 124문제뿐이라 **모든 문제를 전수 검토**했습니다.

검토 절차:

1. 초안 작성 대화를 보지 않았습니다. 원본 파일, 설계 문서, 작성 가이드, 결정 기록(D-026~D-043), 이전 검토 기록만 읽었습니다. D-044~D-046은 아직 결정 기록에 없습니다.
1. 검토 시작 전에 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(실패 0)을 직접 실행했습니다.
1. 레슨마다 [품질 체크리스트](/docs/design/content-and-exercises.md#품질-체크리스트-검토자용)의 레슨 항목을 확인했습니다. 함께 본 것은 다음과 같습니다.
   - 표준 12섹션과 개념 중요도별 깊이
   - 선수 개념 순서: 모듈 1~5와 앞 단원만 쓰는지. 배열·객체(모듈 8~9)는 나머지 매개변수에서 `length`와 `[i]`만 쓰는지, 화살표 함수의 `this`처럼 가르치지 않은 내용을 주장하지 않는지
   - 엄격 모드(D-026)와의 일관성
1. 문제마다 체크리스트의 문제 항목을 확인했습니다. 특히 다음을 봤습니다.
   - 정답이 하나로 정해지는지
   - 체크가 동등한 다른 정답은 받아들이고, 시작 코드·버그 코드·직접 쓴 답은 떨어뜨리는지
   - 오답 선택지와 `misconception` 연결이 실제 오개념과 같은 방향인지
   - 힌트 3단계가 정답을 그대로 주지 않는지
   - 해설이 선택지 기호가 아니라 내용으로 정답과 오답의 이유를 설명하는지
   - 난이도가 루브릭 합계(개념 수·추론·구현량·함정)와 맞는지
1. **레슨과 해설이 주장하는 실행 결과를 Node 24 엄격 모드에서 실행해 확인했습니다.** 확인한 오류 메시지는 다음과 같고, 모두 레슨·해설의 문구와 글자까지 같았습니다.
   - `SyntaxError: Unexpected token '{'`, `Unexpected token 'return'`
   - `SyntaxError: Rest parameter must be last formal parameter`, `Identifier 'price' has already been declared`, `Missing initializer in const declaration`
   - `ReferenceError: Cannot access '…' before initialization`(함수 표현식, 섀도잉 TDZ)
   - `TypeError: … is not a function`

   그 밖에 `1 <= function(){}`이 `false`, `4500 * null`이 `0`, `180 + undefined`가 `NaN`, `12000 * 0.9`가 정확히 `10800`이라는 것도 확인했습니다. 오답 풀이가 말하는 실행 결과와 다른 풀이의 채점 결과도 실행해 봤습니다.
1. 레슨의 MDN 링크 6개가 모두 열리는지(HTTP 200) 확인했습니다. 초안 작성자가 메모한 `Glossary/Callback_function`도 있는 문서입니다.
1. `pnpm content:build:dev`로 빌드하고 앱(`PROGINONE_PORT=4565`, 임시 데이터 폴더)을 띄워, 레슨 6개를 Playwright로 1280px와 390px에서 캡처했습니다. 미렌더링 Markdown, 가로 넘침, 콘솔 오류를 자동 검사했고 셋 다 없었습니다. 캡처를 눈으로 보다가 스코프 레슨의 상자 그림이 깨진 것을 찾아 고쳤습니다(아래).
1. 수정한 뒤 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(문제 699개, 예제 150개, 실패 0)을 다시 실행했습니다.

### 검토자가 직접 쓴 부분의 2차 검토

검토자가 새로 쓰거나 크게 고친 부분은 자기 승인을 피하려고 **분리된 컨텍스트의 2차 AI 검토자**에게 다시 검토하게 했습니다. 대상은 레슨 4곳(함수 선언과 호출, 함수 표현식과 화살표 함수, 스코프 기초, 함수를 값으로 다루기)과 문제 13개입니다.
2차 검토는 실행 결과를 모두 다시 확인했고, 10개 항목은 그대로 승인했습니다. 수정을 요청한 3가지는 그대로 반영했습니다.

- `fill-return-all-paths`: 빈칸을 문장 전체로 바꾼 뒤 `misconceptionMap`의 키가 공백·세미콜론 한 글자 차이로도 빗나갔음 → 세미콜론과 공백이 다른 형태 3개를 더함
- `fix-default-on-null`: 지문은 "부르는 쪽**만** 고쳐 보세요"인데, 해설은 함수를 고쳐도 통과한다고 해서 어긋났음 → "만"을 뺌
- 화살표 함수 레슨: 새로 넣은 문장이 `=>`의 정의와 그 설명 사이에 끼어 흐름이 끊겼음 → `=>` 설명 뒤로 옮김

`draftedBy`는 스키마 형식에 따라 `ai:claude`로 두었습니다. 검토자가 고친 사실은 이 기록과 git 이력에 남습니다.

## 초안 작성자 메모에 대한 판단

### 뒤 단원의 오개념 ID를 앞 단원에서 쓰기

| 문제 | 연결 | 판단 |
|---|---|---|
| `return-and-side-effects.parsons-pure-discount` 방해 줄 `salePrice = price - off;` | `undeclared-assign-creates-global` (스코프 기초) | **연결 삭제** |
| `expressions-and-arrows.fix-expression-call-result` | `assign-call-result` (함수를 값으로 다루기) | **유지** + 레슨 보강 |
| `expressions-and-arrows.fix-mixed-function-bugs` | `assign-call-result` | **유지** + 레슨 보강 |

- 파슨스 방해 줄을 고른 학습자의 생각은 "값을 밖으로 내보내려면 변수에 대입하면 된다"입니다. "`let` 없이 대입하면 전역 변수가 생긴다"와는 방향이 다릅니다. 맞는 오개념이 없어 연결을 지웠습니다. 선언하지 않은 대입이 `ReferenceError`라는 해설 문장은 모듈 2(변수)에서 이미 배운 내용이라 그대로 뒀습니다.
- `assign-call-result`는 두 문제의 버그(`const getTax = calcTax(1000);`, `const getPrice = priceOf(menu); getPrice()`)를 정확히 설명합니다. 다른 ID로 바꾸면 연결이 부정확해집니다.
  - 대신 함수 표현식 레슨의 원리 섹션에 `const plus = add2;`(함수 자체)와 `const five = add2(2, 3);`(실행 결과)를 비교하는 짧은 코드와 `five()`의 `TypeError`를 넣었습니다. 문제에 필요한 내용을 그 단원에서 먼저 배우게 하려는 것입니다. "함수를 값으로 다루기" 단원에서 더 배운다는 예고도 함께 넣었습니다.
  - 이 오개념의 보충 학습 링크는 같은 모듈의 뒤 단원 "흔한 실수"를 가리키지만, 내용이 바로 이 버그라서 문제없다고 판단했습니다.

### 스코프 단원 전에 섀도잉을 쓰기 (`function-basics`)

`fix-return-outer-variable`과 레슨의 "흔한 실수" `return-changes-outer-variable`은 바깥 `let total`과 함수 안 `const total`을 함께 씁니다.
**예고 문장을 달고 유지했습니다.**

- 이 오개념("return하면 바깥의 같은 이름 변수에 값이 들어간다")은 이름이 같아야 생기는 착각이라, 이름을 바꾸면 오개념 자체가 약해집니다.
- 학습자는 모듈 4에서 "블록 안의 `let`은 블록 밖에서 보이지 않는다"를 배웠으므로, "안쪽 변수는 이름만 같은 다른 변수"라는 한 줄 설명을 이해할 수 있습니다.
- 문제 해설에는 이미 예고가 있었고, 레슨의 "흔한 실수"에도 "안과 밖에 같은 이름이 있을 때의 규칙은 '스코프 기초' 단원에서 자세히 배워요"를 더했습니다.

### 채점되지 않는 지시

| 문제 | 초안 | 처리 |
|---|---|---|
| `default-and-rest.fix-default-on-null` | "함수는 그대로 두세요" | 권장 문구("고치지 않아도 돼요. 부르는 쪽을 고쳐 보세요")로 바꾸고, 함수를 고쳐도 통과하지만 이 문제의 요점이 무엇인지 해설에 적음. 함수 안에서 `null`을 처리하는 답이 실무에서 틀린 것은 아니라서 막지 않음 |
| `default-and-rest.impl-max-of-many` | `Math.max(...records)`로도 통과 | 유지. 호출 괄호 안의 `...`(전개 문법)는 배우지 않았고, 지문이 이미 "풀어 보세요"라는 권장 문구임. 해설에 "통과하지만 `for`로 찾는 연습"이라고 밝힘 |
| `callbacks-intro.impl-each-number` | 출력만 확인해서 `console.log` 일곱 줄로도 통과 | **채점을 보강함.** 시작 코드의 `repeatFor`가 콜백을 부른 횟수를 `callbackCalls`에 세고, `program` 체크가 7을 요구함. 직접 쓴 일곱 줄은 0이라 실패함. 지문에 이 사실을 밝힘 |
| `return-and-side-effects.impl-sell-stock` | 출력 + `stock` 값만 확인 | 유지. 함수 문제가 아닌 프로그램 문제라 숨김 입력을 줄 수 없음. 직접 쓴 답이 통과하려면 출력 세 줄을 글자 그대로 쓰고 `stock`도 3으로 맞춰야 해서, 일부러 과제를 피하는 경우뿐임 |
| `function-basics.fix-order-summary-bugs` | "금액 계산은 `itemTotal`에 맡기세요" | **채점을 보강함.** `entry: itemTotal`과 숨김 `call` 체크(`itemTotal(1500, 3)` → 4500, 실패하면 `return-is-log`)를 더함 |
| `function-basics.fix-missing-call`, `fix-return-outer-variable` | "함수는 그대로 두세요" | 권장 문구("고치지 않아도 돼요")로 바꿈 |

### `find-bug-return-in-loop`이 닫는 중괄호를 원인으로 인정함

닫는 중괄호(6번 줄)에는 잘못이 없어서 `acceptLines`에서 지웠습니다.
그런데 고친 코드(`fixedCode`)가 `return`을 6번 줄 아래로 옮기면 6번 줄도 바뀌어 `FIND_BUG_FIX_OUTSIDE_LINES` 경고가 납니다.
`fixedCode`는 학습자에게 보이지 않고 실행 검증에만 쓰이므로, 5번 줄 한 줄만 바꾼 수정(`if (i === n) return total;`)으로 바꿨습니다. 출력은 같습니다(`10`, `55`).
해설은 "반복이 끝난 뒤로 옮기기"를 권하는 수정으로 그대로 보여 줍니다.
같은 이유로 `callbacks-intro.find-bug-assign-call-result`의 `acceptLines: [6]`도 지웠습니다. 6번 줄의 괄호를 지우면 오류는 사라지지만 "다른 이름으로도 부르고 싶다"는 지문의 의도와 어긋나기 때문이고, 해설에 그 이유를 적었습니다.

### `fill-return-all-paths`의 힌트 3

빈칸이 낱말 `return` 하나라서, 힌트 3("호출한 자리로 값을 보내고 함수를 끝내는 낱말")이 사실상 정답이었습니다.
빈칸을 문장 전체(`return (hours - 1) * 1000;`)로 넓혔습니다. 이제 `return`과 요금 계산식을 함께 써야 하고, 힌트는 "빠진 `return` 찾기 → 계산식(시간 − 1) → 3번 줄과 같은 모양의 문장"으로 이어지되 답을 그대로 주지 않습니다.
코드 모드 빈칸은 체크로 채점하므로 `return hours * 1000 - 1000;` 같은 같은 뜻의 답도 정답입니다.

### "next" 섹션 문구와 MDN 링크

- `callbacks-intro`의 "다음 학습 연결"이 "이 단원으로 함수 모듈의 레슨이 끝나요"였습니다. 이 단원 뒤에 단원 평가가 붙을 예정이라, 평가 단원이 있든 없든 맞는 "함수 모듈에서 새로 배우는 내용은 여기까지예요"로 바꿨습니다.
- `Glossary/Callback_function`은 MDN에 있는 문서라 그대로 뒀습니다.

## 단원별 검토 요약

### js-basics.functions.function-basics ★

레슨과 문제 28개를 승인했습니다.
핵심 단원 기준을 충족합니다. 원리를 두 관점(실행 흐름 표, 호출 식을 반환값으로 바꿔 읽기)으로 설명하고, 예제 5개 중 3개가 예측형이며, 오개념 9개를 모두 `<Pitfall>`로 다루고, 실전 사례와 확인 문제 4개가 있습니다.

- 레슨: 실행 흐름 표 아래의 "함수 선언 두 개(1~10번 줄)"는 실제로 1~9번 줄이라 고침. 섀도잉 예고 추가(위 참고).
- `find-bug-return-in-loop`: `acceptLines` 정리(위 참고).
- `fix-order-summary-bugs`: `itemTotal` 숨김 체크 추가.
- 난이도 정정 3개(아래 표).

### js-basics.functions.return-and-side-effects

레슨과 문제 18개를 승인했습니다.
일반 개념 기준을 충족합니다. 반환값·부수 효과 비교 표, `undefined`가 되는 세 경우의 표와 흐름 그림이 있고, 예제 4개 중 3개가 예측형이며, 오개념 6개를 모두 `<Pitfall>`로 다룹니다.

- `fill-return-all-paths`: 빈칸과 힌트를 다시 씀(위 참고).
- `parsons-pure-discount`: 방해 줄의 오개념 연결 삭제(위 참고).

### js-basics.functions.expressions-and-arrows ★

레슨과 문제 22개를 승인했습니다.
핵심 단원 기준을 충족합니다. 화살표 함수를 단계별로 줄여 보이고, 식 본문과 중괄호 본문을 표로 비교하며, 호이스팅을 두 관점(실행 전 준비 표, "호출하는 순간" 관점)으로 설명합니다. 예제는 5개(예측형 3개), 오개념은 6개, 확인 문제는 4개입니다.
화살표 함수의 `this`는 다루지 않으며, 그와 어긋나는 주장도 없습니다.

- 레슨: 함수 자체와 실행 결과를 비교하는 코드 추가(위 참고).
- 레슨: "화살표 함수는 함수 표현식을 더 짧게 쓰는 방법"이 모든 면에서 같다는 뜻으로 읽히지 않게 "이 단원의 예제처럼 값을 계산해 돌려주는 함수라면 똑같이 동작해요. 몇 가지 다른 점은 뒤에서 따로 배워요"를 덧붙임.
- 레슨: 실전 사례의 "다음다음 단원 '함수를 값으로 다루기'"는 실제로 세 단원 뒤라서 "이 모듈의 '함수를 값으로 다루기' 단원"으로 고침.
- `multi-arrow-equivalents`: `const total = price, count => …`의 오류 설명을 고침. "`total = price`와 `count => …`로 나뉜다"가 아니라 "변수 두 개를 만드는 줄로 읽혀 값이 없는 `count`에서 `Missing initializer`"가 정확합니다.

### js-basics.functions.default-and-rest

레슨과 문제 14개를 승인했습니다.
일반 개념 기준을 충족합니다. 기본값이 쓰이는 경우를 표로 정리하고(`undefined`만, `0`·`null`은 아님), 모듈 3의 `count || 1`과 비교합니다. 예제 3개가 모두 예측형이고, 오개념 4개를 모두 다룹니다.
나머지 매개변수의 묶음(배열)은 `length`와 `[i]`만 쓰고 "모듈 8에서 자세히"라고 예고해서 범위 안입니다.

- `fix-default-on-null`, `impl-max-of-many`: 위 "채점되지 않는 지시" 참고.

### js-basics.functions.scope-basics ★

레슨과 문제 24개를 승인했습니다.
핵심 단원 기준을 충족합니다. 원리를 두 관점(겹친 상자, 이름을 찾는 순서 표)으로 설명하고, 오개념 10개를 모두 다루며, 실전 사례(점수판)와 확인 문제 4개가 있습니다.

- **상자 그림 교체**: 원리 섹션의 상자 그림(`┌ │ └`)은 한글이 고정폭 글꼴에서 두 칸을 차지해 오른쪽 테두리가 어긋나 보였습니다(캡처로 확인). 오른쪽 테두리가 필요 없는 트리(`└─`)와 "코드가 있는 곳 → 보이는 변수" 표로 바꿨습니다.
- **예제 6개 → 5개**: 설계의 예제 수 기준(2~5개)을 넘었습니다. 두 번째 예제(블록 밖에서 `grade` 쓰기, `expectError`)는 첫 번째 예제와 요점이 겹쳐서 지웠습니다. 대신 첫 번째 예제 해설에 "맨 아래에 `console.log(left);`를 더해 실행해 보세요"와 `is not defined`의 뜻을 옮겼습니다. 뒤 예제 번호와 "흔한 실수"의 예제 참조를 다시 매겼습니다.
- 확인한 결과: 레슨과 해설의 모든 출력이 실제와 같습니다(점수판 `44`·`77`·`총점 121`, 섀도잉 `1: 민지` … `4: 바깥`, 좌석 예매 해설의 "기본값이 없으면 `NaN~NaN번 좌석`").

### js-basics.functions.callbacks-intro

레슨과 문제 18개를 승인했습니다.
일반 개념 기준을 충족합니다. 숫자와 함수가 할 수 있는 일을 비교하는 표, 콜백을 받는 함수와 콜백의 역할 분담 표, 줄 단위 흐름 표가 있고, 예제 4개 중 3개가 예측형이며, 오개념 4개를 모두 다룹니다.

- 레슨: "다음 학습 연결" 문구(위 참고).
- `find-bug-assign-call-result`: `acceptLines` 정리(위 참고).
- `impl-each-number`: 콜백 호출 횟수 체크 추가(위 참고).

### 난이도 정정

| 문제 | 전 → 후 | 이유 (루브릭: 개념·추론·구현·함정) |
|---|---|---|
| `function-basics.find-bug-missing-parens` | 3 → 2 | 개념 2개(1) + 한 단계 적용(1) + 함정 1개(1) = 3 |
| `function-basics.multi-return-facts` | 3 → 2 | 개념 1개(0) + 회상·한 단계(1) + 오개념 여럿(2) = 3 |
| `function-basics.find-bug-return-in-loop` | 4 → 3 | 개념 3개(2) + 여러 단계 추적(2) + 오개념 2개(2) = 6 |
| `expressions-and-arrows.multi-arrow-equivalents` | 4 → 3 | 개념 3개(2) + 여러 단계(2) + 오개념 2개(2) = 6 |
| `scope-basics.find-bug-shadow-total` | 4 → 3 | 개념 3개(2) + 여러 단계(2) + 오개념 2개(2) = 6 |

반대로 여러 호출과 출력 순서를 머릿속에서 시뮬레이션해야 하는 예측 문제(`predict-call-flow`, `predict-nested-calls`, `predict-hoisting-mixed`, `predict-two-counters`, `predict-shadow-tdz`, `predict-callback-trace`)는 추론 3점에 해당해 L4를 유지했습니다.
L5 3문제(`impl-receipt-functions`, `impl-converter-suite`, `impl-seat-booking`)는 여러 함수를 설계하고 경계 조건을 함께 다뤄 루브릭 합계가 10 이상입니다.

## 최종 문제 구성

승인된 문제 124개, 미승인 0개입니다. 단원별 승인 수는 `practice.targetCount`와 같습니다. 문제를 지우거나 새로 만들지 않아 문제 ID는 바뀌지 않았습니다.

### 유형 범주 (JS 목표: 개념 확인 25 · 코드 이해 25 · 디버깅 20 · 구현 20 · 응용 10, ±10%p)

PRD 범주표대로 셌습니다. 응용은 L4 이상의 `implement_function`·`fix_bug`·`web_task`입니다(디버깅·구현 칸에서 뺌).

| 단원 | 개념 확인 | 코드 이해 | 디버깅 | 구현 | 응용 (L4+) |
|---|---|---|---|---|---|
| function-basics (28) | 7 (25%) | 7 (25%) | 5 (18%) | 5 (18%) | 4 (14%) |
| return-and-side-effects (18) | 5 (28%) | 5 (28%) | 3 (17%) | 3 (17%) | 2 (11%) |
| expressions-and-arrows (22) | 6 (27%) | 6 (27%) | 4 (18%) | 3 (14%) | 3 (14%) |
| default-and-rest (14) | 4 (29%) | 4 (29%) | 2 (14%) | 2 (14%) | 2 (14%) |
| scope-basics (24) | 6 (25%) | 7 (29%) | 4 (17%) | 3 (13%) | 4 (17%) |
| callbacks-intro (18) | 5 (28%) | 5 (28%) | 3 (17%) | 3 (17%) | 2 (11%) |

모든 단원이 범주별 목표 ±10%p 안입니다.

### 유형별 수

| 단원 | mcq_single | mcq_multi | true_false | predict_output | fill_blank | parsons | find_bug_line | fix_bug | implement_function | web_task |
|---|---|---|---|---|---|---|---|---|---|---|
| function-basics | 4 | 1 | 2 | 3 | 1 | 1 | 2 | 6 | 7 | 1 |
| return-and-side-effects | 2 | 1 | 2 | 2 | 1 | 1 | 1 | 4 | 4 | |
| expressions-and-arrows | 3 | 1 | 2 | 3 | 1 | 1 | 1 | 5 | 5 | |
| default-and-rest | 2 | 1 | 1 | 2 | 1 | 1 | | 2 | 4 | |
| scope-basics | 3 | 1 | 2 | 5 | | | 2 | 5 | 5 | 1 |
| callbacks-intro | 3 | 1 | 1 | 2 | 1 | 1 | 1 | 3 | 4 | 1 |

모든 단원이 유형 8종 이상이고, 한 유형이 50%를 넘지 않습니다(가장 많은 것은 `default-and-rest`의 `implement_function` 29%).

### 난이도

| 단원 | L1 | L2 | L3 | L4 | L5 | 목표 (L1/L2/L3/L4/L5) |
|---|---|---|---|---|---|---|
| function-basics ★ | 4 (14%) | 10 (36%) | 8 (29%) | 5 (18%) | 1 (4%) | 15 / 30 / 30 / 20 / 5 |
| return-and-side-effects | 3 (17%) | 7 (39%) | 5 (28%) | 3 (17%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| expressions-and-arrows ★ | 3 (14%) | 7 (32%) | 7 (32%) | 4 (18%) | 1 (5%) | 15 / 30 / 30 / 20 / 5 |
| default-and-rest | 3 (21%) | 5 (36%) | 4 (29%) | 2 (14%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| scope-basics ★ | 3 (13%) | 7 (29%) | 8 (33%) | 5 (21%) | 1 (4%) | 15 / 30 / 30 / 20 / 5 |
| callbacks-intro | 3 (17%) | 6 (33%) | 6 (33%) | 3 (17%) | 0 | 20 / 35 / 30 / 15 / 0~5 |

모든 단원이 목표에 가깝고, 핵심 단원 세 개 모두 L5를 1문제씩 가집니다. 목표를 맞추려고 난이도를 올려 적지 않았습니다.

### 주 개념별 수 (최소: JS core 6 · standard 4 · minor 3)

| 개념 | 중요도 | 문제 수 | L3 이상 |
|---|---|---|---|
| `js.fn.declaration` | core | 6 | 1 |
| `js.fn.call` | standard | 6 | 3 |
| `js.fn.params-args` | core | 7 | 3 |
| `js.fn.return` | core | 9 (+ 반환값 단원 1) | 7 |
| `js.fn.side-effects` | standard | 6 | 3 |
| `js.fn.undefined-return` | standard | 6 | 4 |
| `js.fn.pure` | minor | 5 | 1 |
| `js.fn.expression` | standard | 6 | 1 |
| `js.fn.arrow` | core | 11 | 7 |
| `js.fn.hoisting` | standard | 5 | 4 |
| `js.fn.default-params` | standard | 7 | 2 |
| `js.fn.rest-params` | standard | 7 | 4 |
| `js.scope.block` | core | 7 | 3 |
| `js.scope.function` | standard | 5 | 3 |
| `js.scope.global` | standard | 6 | 3 |
| `js.scope.shadowing` | core | 6 | 5 |
| `js.fn.first-class` | standard | 6 | 2 |
| `js.fn.callback` | standard | 12 | 7 |

모든 주 개념이 개념 이해 유형, 코드 이해 유형, 실습 유형(버그 수정·구현·웹 실습)을 각각 1개 이상 갖고, L3 이상 문제도 1개 이상 가집니다(숙련 단계 게이트).

## 남은 한계와 후속 제안

1. **복습용 템플릿이 없습니다.** 설계상 주 개념마다(minor 제외) 템플릿이 1개 이상 필요합니다. 이전 모듈들과 같은 상태입니다.
1. **프로그램 작성 문제는 직접 쓴 답을 완전히 막지 못합니다.** `impl-sell-stock`, `impl-visit-counter`처럼 `entry`가 없는 문제는 숨김 입력을 줄 수 없습니다. `static` 체크는 서버가 아직 결과(`serverFindings`)를 계산하지 않아 쓸 수 없습니다. 이번에는 `impl-each-number`만 콜백 호출 횟수로 보강했습니다.
1. **순서에 기대는 `call` 체크**: `impl-stamp-card`와 `impl-seat-booking`은 바깥 변수의 상태를 이어 가며 채점합니다(지문에 "위 호출에 이어서"라고 밝힘). 체크 순서가 바뀌는 구현 변경이 있으면 두 문제를 다시 확인해야 합니다.
1. **`rubric` 필드를 아직 스키마가 받지 않습니다.** 난이도는 검토자가 루브릭으로 직접 계산했고, 근거는 이 기록에 남겼습니다.
1. **개념의 `mdn` 필드는 `Web/`으로 시작하는 경로만 받습니다.** 그래서 `js.fn.hoisting`·`js.scope.global`처럼 MDN 용어 사전(`Glossary/Hoisting` 등)이 더 맞는 개념도 일반 안내서로 연결합니다. 레슨의 `<MdnLink>`는 용어 사전을 쓸 수 있습니다.
