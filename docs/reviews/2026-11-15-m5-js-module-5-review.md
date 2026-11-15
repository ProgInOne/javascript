# JS 기초 모듈 5 콘텐츠 AI 교차 검토 기록 (2026-11-15)

JS 기초 모듈 5 "반복문"(레슨 4개, 문제 70개)을 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
검토 방법, 단원별 판단, 직접 고친 내용, 최종 문제 구성과 남은 한계를 적습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-15
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [결정 기록](/docs/decisions.md), [JS 기초 모듈 3 검토](/docs/reviews/2026-11-15-m5-js-module-3-review.md)

## 검토 범위와 방법

대상은 `content/courses/js-basics/modules/05-loops/`의 레슨 본문과 문제 전부입니다. 이 모듈의 개념 9개(`content/concepts/js.yaml`)와 오개념 19개(`content/misconceptions/js.yaml`)도 함께 봤습니다.
모든 문제가 `review.status: draft`, `draftedBy: ai:claude`였습니다.

| 단원 | 중요도 | 목표 문제 수 |
|---|---|---|
| `while` while 반복 | standard | 16 |
| `for` for 반복 ★ | core | 26 |
| `break-continue` 반복 제어 | standard | 14 |
| `nested-loops` 중첩 반복 | standard | 14 |

단원 평가(`loops-review`)는 [D-040](/docs/decisions.md)에 따라 M6에서 추가하므로 이번 범위가 아닙니다.
D-027 기준으로 레슨 본문과 핵심 개념(`js.loops.for`, `js.loops.accumulator-pattern`) 문제는 전수 검토 대상입니다. 그 밖의 문제는 샘플링 대상이지만, 70문제뿐이라 **모든 문제를 전수 검토**했습니다.

검토 절차:

1. 초안 작성 대화를 보지 않았습니다. 원본 파일과 설계 문서·작성 가이드·결정 기록(D-026~D-040), 이전 검토 기록만 읽었습니다.
1. 검토 시작 전에 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(실패 0)을 직접 실행했습니다.
1. 레슨마다 [품질 체크리스트](/docs/design/content-and-exercises.md#품질-체크리스트-검토자용)의 레슨 항목을 확인했습니다. 함께 본 것은 표준 12섹션, 개념 중요도별 깊이, 선수 개념 순서(모듈 1~4와 앞 단원만 사용, 함수·배열 없음), 엄격 모드(D-026)와의 일관성입니다.
1. 문제마다 체크리스트의 문제 항목을 확인했습니다. 특히 다음을 봤습니다.
   - 정답이 하나로 정해지는지
   - 체크가 동등한 다른 정답을 받아들이고, 시작 코드와 버그 코드는 실패하는지
   - 오답 선택지와 `misconception` 연결이 실제 오개념과 같은 방향인지
   - 힌트 3단계가 정답 코드를 그대로 주지 않는지
   - 난이도가 루브릭 합계(개념 수·추론·구현량·함정)와 맞는지
1. **레슨과 해설이 주장하는 실행 결과를 Node 24 엄격 모드에서 실행해 확인했습니다.** 확인한 것은 출력, 반복이 끝난 뒤의 변수 값, `TypeError: Assignment to constant variable.`, `ReferenceError: i is not defined`, 해설이 말하는 오답 풀이의 결과, 그리고 다른 풀이가 체크를 통과하는지입니다.
1. **무한 반복의 안전성과 안내 문구를 앱에서 확인했습니다.** 아래 [무한 반복](#무한-반복-초안-작성자-메모-확인)을 봅니다.
1. `pnpm content:build:dev`로 빌드하고 앱(`PROGINONE_PORT=4490`, 임시 데이터 폴더)을 띄워 레슨 4개를 Playwright로 1280px에서 캡처했습니다. 미렌더링 Markdown, 가로 넘침, 콘솔 오류를 자동으로 검사했고, 셋 다 없었습니다.
1. 수정한 뒤 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(문제 485개, 예제 114개, 실패 0)을 다시 실행했습니다.

### 검토자가 직접 쓴 문제의 2차 검토

검토자가 새로 쓰거나 크게 고친 문제는 자기 승인을 피하려고 **분리된 컨텍스트의 2차 AI 검토자**에게 다시 검토하게 했습니다. 대상은 다음 5개입니다.

- `for.impl-even-floors`: 다시 씀
- `for.impl-class-timetable`: 새로 씀
- `for.fix-loop-var-outside`: 다시 씀
- `for.impl-multiples-of-three`: 범위와 체크 공개 여부를 바꿈
- `while.find-bug-dice-while`: `fixedCode`와 해설을 바꿈

2차 검토는 실행 결과를 모두 다시 확인했습니다. 3문제를 그대로 승인했고, 3문제에 수정을 요청했습니다. 요청한 문구를 그대로 반영했습니다.

- `impl-class-timetable`: 지문은 굵게 "반복 변수로 시각을 계산"하라고 요구했는데, 해설은 따로 센 `hour` 변수로 푼 방법도 "정답"이라고 했음. 둘이 어긋나서 지문을 "`period`로 시각을 계산해 보세요"로 완화하고, 해설은 "출력은 같지만 이 문제는 `period`로 계산하는 연습"으로 고침. "5교시부터 한 시간씩 늦게"는 뒤로 갈수록 더 늦어진다는 뜻으로도 읽혀서 "시작 시각이 1시간 늦어져요"로 고침.
- `fix-loop-var-outside`: 출력 체크에 단 `misconceptionIfFail: loop-var-final-value`는 버그 코드를 그대로 내도 붙음 → 삭제하고, `no-error` 체크에 `loop-var-outside-for`를 붙임.
- `find-bug-dice-while` c3: 오답 선택지 안의 논리가 스스로 맞지 않았음("`!==`가 같을 때 참이면 6에서 끝난다") → "같은지 확인하는 연산자라서 6이면 참이 되어 끝났다"로 고치고, 해설에 "`while`은 조건이 거짓이면 끝나요"를 추가.
- 선택 제안도 반영: `impl-even-floors` 힌트 3이 `for` 머리를 거의 다 줬음 → 조건은 직접 정하게 바꿈.

`draftedBy`는 스키마 형식에 따라 `ai:claude`로 두었습니다. 이 문제들을 검토자가 썼다는 사실은 이 기록과 git 이력에 남습니다.

## 초안 작성자 메모에 대한 판단

### 무한 반복 (초안 작성자 메모 확인)

러너는 반복이 1초(`loopBudgetMs: 1000`) 넘게 돌면 `LoopLimitError`로 멈춥니다(`packages/runner/src/harness/main.ts`).
실제로 끝나지 않는 반복이 실행되는 곳은 세 군데이고, 모두 안전합니다.

| 위치 | 확인 |
|---|---|
| `while` 레슨 예제 `infinite` (`expectError`) | 앱에서 직접 실행. 1초 뒤 콘솔에 `LoopLimitError: 반복문이 1000ms 넘게 실행되어 멈췄습니다. (2번째 줄)`과 `반복이 너무 많이 돌아서 실행을 멈췄어요. 반복 조건을 확인해 보세요.`가 차례로 나옴. 레슨 해설이 인용한 두 줄과 글자까지 같음 |
| `while.fix-forgot-update` 버그 코드 | `check:run`에서 버그 코드가 반복 한도로 실패하고 정답은 통과. 채점 피드백 `반복문이 너무 오래 실행되어 멈췄습니다`(`RUN_LOOP_LIMIT`)와 `bugDescription`("반복이 너무 오래 실행되어 멈췄다는 안내")이 맞음 |
| `while.fix-skip-target` 버그 코드 | 위와 같음 |

`mcq-continue-while-forever`의 코드와 레슨 "흔한 실수"의 무한 반복 코드는 실행 버튼이 없는 코드 블록이라 실행되지 않습니다.
레슨이 "`LoopLimitError`는 JavaScript의 오류가 아니라 ProgInOne의 안전장치"라고 분명히 말하고 있어서, 오개념 `infinite-loop-error`("JavaScript가 알려 준다")와도 어긋나지 않습니다.

### `find-bug-dice-while`의 `FIND_BUG_FIX_OUTSIDE_LINES` 경고

`fixedCode`를 `do...while`로 바꾸면 7번 줄(`}` → `} while (...);`)도 바뀌어 경고가 났습니다. 7번 줄은 원인 줄로 인정할 수 없습니다.
`fixedCode`는 학습자에게 보이지 않고 실행 검증에만 쓰입니다. 그래서 `fixedCode`를 1번 줄만 고친 수정(`let dice = 0; // 아직 굴리기 전`)으로 바꿨습니다. 1번 줄은 원래 `acceptLines`에 있습니다.
"굴리기 전"을 0으로 표시하는 편이 6보다 오히려 자연스럽고, 출력도 `do...while` 수정과 같습니다(`1번째: 3`, `2번째: 6`).
해설은 `do...while`을 권하는 수정으로 그대로 보여 주고, 1번 줄 수정이 정답으로 인정되는 이유를 덧붙였습니다. 경고는 사라졌습니다.

### `fill-cups-while`의 주 개념

초안 작성자는 주 개념을 `js.loops.while`에서 `js.loops.infinite`로 옮겼습니다. **유지했습니다.**
문제의 핵심은 두 번째 빈칸(조건 변수를 바꾸는 줄)이고, 오개념 `while-auto-update`(개념 `infinite`)를 겨냥합니다.
또 `infinite` 개념의 코드 이해 유형은 이 문제 하나뿐이라, 설계의 "주 개념마다 개념 이해·코드 이해·실습 유형 각 1개 이상" 규칙을 채우려면 필요합니다.
지문에 "출력되고 반복이 끝나게 하세요. 반복이 끝나지 않으면 `주문 완료`는 나오지 않아요"를 넣어 무한 반복과의 관계를 드러냈습니다.

### `fix-loop-var-outside`의 이상한 `for` 조건

`for (let count = 1; total + price <= budget; count++)`는 조건에 반복 변수를 쓰지 않아, 입문자에게 나쁜 본보기였습니다.
그래서 조건을 `count * price <= budget`("`count`개를 사도 예산 안이면 산다")으로 바꾸고 지문에서 뜻을 풀었습니다.
이렇게 하면 함정이 하나 생깁니다. `count`만 반복 밖으로 옮기면 오류는 사라지지만, 반복이 끝난 `count`가 5라서 `5개를 샀어요`가 나옵니다. 오개념 `loop-var-final-value`와 이어지는 함정입니다.
해설에는 값 추적 표와 바른 수정(따로 세는 변수)을 넣었습니다. 루브릭 합계 7로 L4가 맞습니다(2차 검토 동의).

### 핵심 단원 `for`의 L4 이상 부족 (12% → 19%)

초안의 L4 이상은 3개(12%)였고, 그중 L5 `fix-receipt-loop-bugs`("버그 세 개")는 배운 버그의 조합이라 L4입니다(모듈 3 검토와 같은 기준).
요구사항 해석이 필요한 진짜 L4를 만들었습니다.

- `impl-even-floors`(L3 → L4): 꼭대기 21층(홀수)에서 출발하는 짝수 층 엘리베이터로 바꿈. 첫 값(`topFloor - 1`)을 요구사항에서 찾아야 하고, 2층을 포함하는 경계와 선 횟수 세기(`stops`, `program` 체크)가 더해짐.
  - 변수 이름 `top`은 브라우저의 `window.top`(재정의할 수 없는 전역)과 부딪혀, 문서에서 하는 문법 검사에서 오류가 날 수 있습니다. 그래서 `topFloor`로 썼습니다.
- `impl-class-timetable`(새 문제, L4): 교시 번호로 시작 시각을 계산하고, 점심시간 뒤에 규칙이 바뀌는 시간표 문제. 하나 차이(`firstHour + period - 1`), 점심시간 줄의 위치, 문자열 연결 순서(`"1교시: 91" - 1` → `NaN`)가 함정.
- `fix-loop-var-outside`(L3 → L4): 위에서 설명.

그런데 PRD 범주표에서는 L4 이상의 구현·버그 수정이 "응용"으로 빠집니다. 그래서 L4가 늘면 "구현"이 4%로 떨어지고(최소 10%) "응용"이 23%가 됐습니다(최대 20%).
다음 두 가지로 범주를 맞췄습니다.

- `predict-step-down`을 삭제했습니다. 레슨 예제 `step-down`(`i -= 3`으로 0을 지나쳐 끝남)과 모양·요점이 거의 같아서입니다.
- 그 자리에 원래 초안의 L2 구현 `impl-print-squares`를 되살렸습니다(힌트 3 완화).
- `impl-multiples-of-three`는 L4 → L3으로 정정했습니다. 설계 문서가 L3의 예로 드는 것이 바로 "조건부 합계 구현"이고, 2차 검토도 L3/L4 경계라고 봤습니다.

결과는 L4 5개(19%)입니다. 목표 25%에는 못 미치지만, 모든 범주가 목표 ±10%p 안이고 난이도 표시는 루브릭과 맞습니다. 목표에 맞추려고 난이도를 올려 적지는 않았습니다.

### "반복을 써서" 요구의 채점

`static` 체크가 없어 "반복으로 계산하라"를 강제할 수 없습니다. 기대 출력을 그대로 출력하면 통과합니다.

- **`impl-multiples-of-three`는 직접 쓴 답이 통하지 않게 설계했습니다.**
  - 범위를 1~60에서 **1~999**로 넓혔습니다(333개, 합계 166833).
  - 출력 체크를 `visible: false`로 바꿨습니다. `program` 체크는 원래 숨김이라, 정답 숫자가 화면 어디에도 보이지 않습니다.
  - 대신 지문에 "1부터 10까지로 줄여 먼저 확인하면 `3의 배수: 3개, 합계: 18`"을 보여 줍니다. 작은 범위로 확인한 뒤 늘리는 습관도 함께 연습합니다.
- 나머지 문제는 지시 문구를 채점하는 것처럼 쓰지 않았습니다. 예: `impl-paper-fold` "반복이 찾게 해 보세요", `impl-sum-1-to-100` "미리 계산해 숫자로 쓰면 반복을 연습할 수 없어요", `fix-loop-var-outside` "반복에서 구해 보세요". 모듈 3 검토와 같은 기준입니다.

## 단원별 검토 요약

### js-basics.loops.while

레슨과 문제 16개를 승인했습니다.
일반 개념 기준을 충족합니다. 원리를 단계 그림과 세 가지 할 일 표로 설명하고, 예제 4개 중 3개가 예측형이며, 오개념 5개를 모두 `<Pitfall>`로 다루고, 확인 문제 2개와 실전 사례가 있습니다.

- `find-bug-dice-while`: 위의 경고를 해결하고, c3 선택지를 고침(2차 검토).
- `fill-cups-while`: 지문에 반복이 끝나야 한다는 조건을 넣음.
- 힌트 3이 정답 코드 전체였던 2문제를 완화: `impl-paper-fold`, `impl-countdown-start`. `impl-atm-withdraw`의 힌트 3도 반복 코드 대신 할 일의 순서만 주도록 바꿈.
- `impl-paper-fold`의 "미리 계산하지 말고"는 채점할 수 없어 권장 문구로 바꿈.
- 확인한 결과: 0.1mm를 7번 접으면 정확히 `12.8`이 출력됩니다(2배는 부동소수점에서도 정확함). 적금 사례는 4개월, 120000원입니다.

### js-basics.loops.for ★

레슨과 문제 26개를 승인했습니다.
핵심 개념 기준을 충족합니다.

- 원리를 두 관점(`while`로 펼치기, 값 추적)으로 설명하고 값 추적 표가 있습니다.
- 예제 5개 중 3개가 예측형입니다.
- 오개념 8개를 모두 `<Pitfall>`로 다룹니다.
- 실전 사례와 확인 문제 4개가 있습니다.

블록 안 `let`의 범위는 모듈 4의 `<Reveal>`에서 이미 배워서, "`for (let i …)`의 `i`는 반복 밖에서 쓸 수 없다"를 그 자리에서 이어 설명한 것이 맞습니다.

- 레슨: 실전 사례가 "쇼핑몰의 월별 저축 계획"이라 어색했음 → "은행 앱의"로 고침.
- 위에서 설명한 L4 보강: `impl-even-floors`·`fix-loop-var-outside` 다시 씀, `impl-class-timetable` 새로 씀, `predict-step-down` 삭제, `impl-print-squares` 되살림.
- `impl-multiples-of-three`: 범위 1~999와 숨김 체크(위 참고).
- 힌트 3 완화: `impl-sum-1-to-100`, `impl-print-squares`, `web-star-rating`, `impl-even-floors`.
- 파일 번호를 다시 매겼습니다(`005`~`012`). 문제 ID는 바뀌지 않았습니다.

### js-basics.loops.break-continue

레슨과 문제 14개를 승인했습니다.
일반 개념 기준을 충족합니다. 예제 4개 중 2개가 예측형이고, 오개념 4개를 모두 `<Pitfall>`로 다루며, 확인 문제 2개와 실전 사례가 있습니다.
`break-exits-all-loops`는 중첩 반복을 배우기 전이지만, "다음 단원에서 자세히"라고 예고하고 코드로만 보여 주므로 범위 안입니다.

- `impl-skip-and-stop`: 해설의 "개수 검사를 출력보다 먼저 하면 8개가 나오거나 6개에서 멈춘다"는 일부 순서에서만 맞았음. 실제로 검사 → 출력 → 세기 순서는 7개로 정상입니다. 실행해 확인한 대로 "출력 → 검사 → 세기면 8개, 세기 → 검사 → 출력이면 6개"로 정확히 고침.
- 힌트 3이 정답 코드를 주던 3문제 완화: `impl-sum-over-100`, `web-smallest-divisor`, `impl-elevator-buttons`.
- 이 단원의 `web-smallest-divisor`, 모듈의 `web-star-rating`·`web-apartment-numbers`는 화면을 다루는 코드(이벤트 연결, 값 읽기, 화면 쓰기)를 모두 주고 반복 부분만 쓰게 합니다. 그래서 모듈 10 전에도 범위 안입니다.

### js-basics.loops.nested-loops

레슨과 문제 14개를 승인했습니다.
일반 개념 기준을 충족합니다. 원리는 시계 비유와 곱셈 표로 설명하고, 예제 4개 중 3개가 예측형이며, 오개념 2개를 모두 `<Pitfall>`로 다루고, 확인 문제 2개와 실전 사례(달력)가 있습니다. 플래그를 쓰려면 불리언과 `if (found)`가 필요한데, 모듈 2·3에서 배웠습니다.

- `mcq-which-prints-grid` c: `inner-var-not-reset`("안쪽 반복이 다시 시작하지 않는다")은 방향이 반대인 연결이었음. C를 고른 학습자는 오히려 "변수가 저절로 다시 시작된다"고 생각한 것입니다. 맞는 오개념이 없어 연결을 삭제함.
- `fix-seat-count-reset`: 해설 표의 "안쪽 본문 → 아무것도 쌓이지 않음"을 "칸마다 0으로 돌아가 쌓이지 않음(안쪽 반복 밖에서는 쓸 수도 없음)"으로 정확히 고침.
- 힌트 3 완화: `impl-two-times-tables`, `fix-break-only-inner`.

### 난이도 정정

| 문제 | 전 → 후 | 이유 |
|---|---|---|
| `for.find-bug-attendance` | 3 → 2 | 개념 1개, 한 단계 경계 추적, 오개념 1개 (합 4) |
| `for.impl-even-floors` | 3 → 4 | 다시 씀(요구사항 해석, 경계, 횟수 세기, 합 8) |
| `for.fix-loop-var-outside` | 3 → 4 | 다시 씀(범위 오류 + 반복 뒤 값 함정, 합 7) |
| `for.impl-multiples-of-three` | 4 → 3 | 설계 문서의 L3 예("조건부 합계 구현")와 같은 모양 |
| `for.fix-receipt-loop-bugs` | 5 → 4 | 배운 버그 세 개의 조합이지 새 상황으로의 전이가 아님 (합 8~9) |
| `break-continue.fix-break-instead-of-continue` | 3 → 2 | `break` → `continue` 한 단어 교체 (합 4) |

반복을 추적하는 예측 문제(`predict-final-counter`, `predict-reset-inside`, `find-bug-reset-total` 등)는 "상태 변화를 머릿속에서 시뮬레이션"(추론 3점)에 해당해 L3을 유지했습니다.

## 최종 문제 구성

승인된 문제 70개, 미승인 0개입니다. 단원별 승인 수는 `practice.targetCount`와 같습니다.

### 유형 범주 (JS 목표: 개념 확인 25 · 코드 이해 25 · 디버깅 20 · 구현 20 · 응용 10, ±10%p)

PRD 범주표대로 셌습니다. `find_bug_line`은 코드 이해, 응용은 L4 이상의 `implement_function`·`fix_bug`·`web_task`입니다(디버깅·구현 칸에서 뺌).

| 단원 | 개념 확인 | 코드 이해 | 디버깅 | 구현 | 응용 (L4+) |
|---|---|---|---|---|---|
| while (16) | 5 (31%) | 5 (31%) | 2 (13%) | 2 (13%) | 2 (13%) |
| for (26) | 7 (27%) | 8 (31%) | 3 (12%) | 3 (12%) | 5 (19%) |
| break-continue (14) | 4 (29%) | 4 (29%) | 2 (14%) | 2 (14%) | 2 (14%) |
| nested-loops (14) | 4 (29%) | 4 (29%) | 2 (14%) | 2 (14%) | 2 (14%) |

모든 단원이 범주별 목표 ±10%p 안입니다.

### 유형별 수

| 단원 | mcq_single | mcq_multi | true_false | predict_output | fill_blank | parsons | find_bug_line | fix_bug | implement_function | web_task |
|---|---|---|---|---|---|---|---|---|---|---|
| while | 2 | 1 | 2 | 3 | 1 | | 1 | 3 | 3 | |
| for | 3 | 1 | 3 | 3 | 2 | 1 | 2 | 5 | 5 | 1 |
| break-continue | 2 | 1 | 1 | 2 | | 1 | 1 | 2 | 3 | 1 |
| nested-loops | 2 | 1 | 1 | 2 | | 1 | 1 | 3 | 2 | 1 |

모든 단원이 유형 8종 이상이고, 한 유형이 25%를 넘지 않습니다.

### 난이도

| 단원 | L1 | L2 | L3 | L4 | L5 | 목표 (L1/L2/L3/L4/L5) |
|---|---|---|---|---|---|---|
| while | 3 (19%) | 6 (38%) | 5 (31%) | 2 (13%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| for ★ | 2 (8%) | 10 (38%) | 9 (35%) | 5 (19%) | 0 | 15 / 30 / 30 / 20 / 5 |
| break-continue | 1 (7%) | 6 (43%) | 5 (36%) | 2 (14%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| nested-loops | 1 (7%) | 5 (36%) | 6 (43%) | 2 (14%) | 0 | 20 / 35 / 30 / 15 / 0~5 |

### 주 개념별 수 (최소: JS core 6 · standard 4 · minor 3)

| 개념 | 중요도 | 문제 수 | L3 이상 |
|---|---|---|---|
| `js.loops.while` | standard | 8 | 3 |
| `js.loops.do-while` | minor | 3 | 1 |
| `js.loops.infinite` | standard | 5 | 3 |
| `js.loops.for` | core | 9 | 4 |
| `js.loops.loop-variable` | standard | 7 | 3 |
| `js.loops.accumulator-pattern` | core | 10 | 7 |
| `js.loops.break` | standard | 9 | 7 |
| `js.loops.continue` | standard | 7 | 2 |
| `js.loops.nested` | standard | 12 | 6 |

`break`에는 중첩 반복 단원의 2문제(`predict-break-inner`, `fix-break-only-inner`)가 포함됩니다.
모든 주 개념이 개념 이해·코드 이해·실습 유형을 각각 1개 이상, L3 이상 문제를 1개 이상 가집니다(숙련 단계 게이트). 예외는 `minor`인 `do-while`로, 실습 유형을 생략할 수 있습니다.

### ID 변경

- 삭제: `js-basics.loops.for.predict-step-down` (레슨 예제와 중복)
- 추가: `js-basics.loops.for.impl-class-timetable`

둘 다 초안이라 빌드에 들어간 적이 없어 학습 기록이 없습니다. 다른 파일에서 참조하지 않음도 확인했습니다. `content/.generated/predict-expected.json`에서 삭제한 문제의 항목이 빠졌습니다.

## 남은 한계와 후속 제안

1. **L4·L5가 목표보다 적습니다.**
   - 핵심 단원 `for`의 L4는 19%(목표 20%, L5 포함 25%)이고, 네 단원 모두 L5가 없습니다.
   - `for`·`break-continue`·`nested-loops`는 L1이 7~8%로 낮습니다.
   - 범주 비율(응용 ≤ 20%)과 같이 맞추려면 L4를 개념 확인·코드 이해 유형에서 만들어야 합니다. 예: 여러 반복이 얽힌 결과 예측. 템플릿과 함께 보강하길 권합니다.
1. **"반복을 써서"와 "중첩 반복으로" 같은 지시는 채점되지 않습니다.**
   - `static` 체크가 없어서, 기대 출력을 그대로 쓴 답도 통과합니다.
   - 직접 쓴 답을 막은 문제는 `impl-multiples-of-three` 하나입니다(넓은 범위 + 숨김 기대값).
   - 같은 설계를 다른 구현 문제에 넓히거나, `static` 체크(예: `require-syntax: ForStatement`)를 판정 보조로 쓰는 방안을 제안합니다.
1. **입력이 하나뿐인 프로그램 문제는 일부 틀린 풀이도 통과합니다.** 함수(모듈 6) 전이라 같은 코드를 여러 입력으로 채점할 수 없습니다.
   - 예: `impl-atm-withdraw`는 잔액이 정확히 나누어떨어지는 한 가지 경우만 봅니다.
   - 웹 실습 3개는 이벤트 체크로 여러 입력을 봅니다.
1. **복습용 템플릿이 없습니다.** 설계상 주 개념마다(minor 제외) 템플릿이 1개 이상 필요합니다.
1. **`rubric` 필드를 아직 스키마가 받지 않습니다.** 난이도는 검토자가 루브릭으로 직접 계산했고, 근거는 이 기록에 남겼습니다.
1. **좁은 화면(390px)은 이번에 캡처하지 않았습니다.** 이전 검토들이 보고한 레슨 머리의 가로 넘침은 앱 스타일 문제로 따로 다뤄지고 있습니다.
