# JS 기초 모듈 8 콘텐츠 AI 교차 검토 기록 (2026-11-15)

JS 기초 모듈 8 "배열"(레슨 5개, 문제 110개)을 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
검토 방법, 초안 작성자 메모에 대한 판단, 단원별 요약, 직접 고친 내용, 최종 문제 구성과 남은 한계를 적습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-15
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [결정 기록](/docs/decisions.md), [JS 기초 모듈 6 검토](/docs/reviews/2026-11-15-m6-js-module-6-review.md)

## 검토 범위와 방법

대상은 `content/courses/js-basics/modules/08-arrays/`의 레슨 본문과 문제 전부, 그리고 이 모듈의 개념 18개(`content/concepts/js.yaml`)와 오개념 42개(`content/misconceptions/js.yaml`)입니다.
모든 문제가 `review.status: draft`, `draftedBy: ai:claude`였습니다.

| 단원 | 중요도 | 목표 문제 수 |
|---|---|---|
| `array-basics` 배열 기초 | standard | 20 |
| `array-mutation` 배열 바꾸기 ★ | core | 22 |
| `array-iteration` 배열 순회 | standard | 18 |
| `array-hof` 고차 함수: map·filter·reduce ★ | core | 32 |
| `array-search-sort` 찾기와 정렬 | standard | 18 |

단원 평가(`arrays-review`)는 단원 평가 작업에서 따로 추가하므로 이번 범위가 아닙니다.
D-027 기준으로 레슨 본문, 핵심 단원(★)의 문제, 핵심 개념(`literal-index`, `push-pop`, `mutating-vs-not`, `for-of`, `map`, `filter`, `reduce`, `sort`) 문제는 전수 검토 대상입니다. 나머지도 110문제뿐이라 **모든 문제를 전수 검토**했습니다.

검토 절차:

1. 초안 작성 대화를 보지 않았습니다. 원본 파일, 설계 문서, 작성 가이드, 결정 기록(D-026~D-047), 이전 검토 기록만 읽었습니다.
1. 검토 시작 전에 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(문제 917개, 예제 199개, 실패 0)을 직접 실행했습니다.
1. 레슨마다 [품질 체크리스트](/docs/design/content-and-exercises.md#품질-체크리스트-검토자용)의 레슨 항목과 표준 12섹션, 개념 중요도별 깊이, 선수 개념 순서(모듈 1~7과 앞 단원만 쓰는지, 객체 없이 원시 값 배열만 쓰는지)를 확인했습니다.
1. 문제마다 체크리스트의 문제 항목을 확인했습니다. 특히 정답이 하나로 정해지는지, 체크가 동등한 다른 정답은 받아들이고 직접 쓴 답·우회한 답은 떨어뜨리는지, 오답과 `misconception` 연결의 방향, 힌트 3단계, 해설이 선택지 기호를 쓰지 않는지, 난이도가 루브릭과 맞는지를 봤습니다.
1. **레슨과 해설이 주장하는 실행 결과를 Node 24 엄격 모드와 Chromium 159(러너와 같은 헤드리스 Chromium)에서 실행해 확인했습니다.** 확인한 것은 다음과 같고, 모두 레슨·해설과 같았습니다.
   - 기본 정렬: `[10, 9, 1, 100, 25].sort()` → `[1, 10, 100, 25, 9]`, `["banana", "Cherry", "apple"].sort()` → `["Cherry", "apple", "banana"]`
   - `splice` 반환값: `[10, 20, 30, 40, 50]`에 `splice(1, 2, 99)` → `[20, 30]`, `splice(-1, 1)` → `[50]`, `splice(2, 0, 7, 8)` → `[]`, 남은 배열 `[10, 99, 7, 8, 40]`
   - 빈 칸: `marks[4] = 5` 뒤 `length` 5, `marks[3]`은 `undefined`, 합계 `NaN`. `for...in` 합계 `"0012"`
   - 오류 메시지: `TypeError: Reduce of empty array with no initial value`, `TypeError: undefined is not a function`(`forEach(undefined)`), `TypeError: Cannot read properties of undefined (reading 'filter')`, `SyntaxError: Illegal break statement`, `TypeError: Assignment to constant variable.`, `TypeError: Cannot assign to read only property '0' of string 'java'`
   - 그 밖에 `[1, 2, 3].reduce((acc, n) => acc + n * 2)`가 `11`, `[95] + 5`가 `"955"`, `"".split(",")`가 `[""]`, `[].every(...)`가 `true`·`[].some(...)`이 `false`, `pop("우유")`가 인수를 무시함. `indexOf(NaN)`은 `-1`, `includes(NaN)`은 `true`(모듈 8 콘텐츠에는 쓰이지 않음)
1. `pnpm content:build:dev`로 빌드하고 앱(`PROGINONE_PORT=4585`, 임시 데이터 폴더)을 띄워, 레슨 5개를 Playwright로 1280px와 390px에서 캡처했습니다. 미렌더링 Markdown, 가로 넘침, 콘솔 오류를 자동 검사했고 셋 다 없었습니다. 고친 정렬 "흔한 실수" 부분은 캡처를 눈으로 확인했습니다.
1. 새로 넣은 판별 체크 5개는 **일부러 틀린 정답으로 바꿔 `content:check:run`을 돌려** 그 체크가 실패하는 것을 확인한 뒤 되돌렸습니다(아래 "채점되지 않는 지시").
1. 수정한 뒤 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(실패 0)을 다시 실행했습니다. 예측 문제의 코드는 바꾸지 않아 `content/.generated/predict-expected.json`은 바뀌지 않았습니다.

### 검토자가 직접 쓴 부분의 2차 검토

검토자가 새로 쓰거나 크게 고친 부분은 자기 승인을 피하려고 **분리된 컨텍스트의 2차 AI 검토자**에게 다시 검토하게 했습니다. 대상은 판별 체크 5개, 다시 설계한 웹 실습 1개, 정렬 비교 함수 관련 문제 3개와 레슨·오개념 문구, 힌트 2개, 난이도 정정, 두 버그로 바꾼 `fix-map-no-return`입니다.
2차 검토는 틀린 풀이 여러 개를 실제로 돌려 보고 다음을 요청했고, 모두 반영한 뒤 승인받았습니다.

- `impl-cap-scores`: 판별 체크가 "110보다 큰 점수가 없다"만 확인해서, 큰 점수를 `0`으로 바꾸는 틀린 답도 통과했음 → `max` 99로 다시 넘겨 2개가 세어지는지 보는 체크를 더함
- `fix-update-latest`: 판별 체크가 학습자 함수의 반환값(2번 줄 버그)에 기대서, 3번 줄만 고친 학습자에게 엉뚱한 오개념이 붙었음 → 반환값과 무관하게 3번 줄만 판별하도록 바꿈
- `multi-sort-facts`의 새 오답 선택지가 `sort-compare-boolean` 오개념과 반대 방향이었음 → 오개념을 그대로 담은 문장으로 바꿈
- 정렬 문구에 "우연히 제대로 정렬되기도 한다"(다른 엔진의 경우)를 넣음. `tf-compare-boolean` 해설의 "기본 정렬과도 다르다"도 엔진에 기대는 주장이라 고침
- `fix-map-no-return`: 새 바깥 `return` 버그를 진단하는 체크가 없었음 → 배열을 돌려주는지만 보는 체크(`returns-array`, 오개념 `map-mutates-original`)를 더함

`draftedBy`는 스키마 형식에 따라 `ai:claude`로 두었습니다. 검토자가 고친 사실은 이 기록과 git 이력에 남습니다.

## 초안 작성자 메모에 대한 판단

### `a > b` 비교 함수의 결과 (`[5, 1, 4, 2, 3]`, `[30, 4, 200]`)

Chromium 159(V8)에서도 두 배열은 그대로였습니다. 하지만 일관되지 않은 비교 함수의 정렬 결과는 명세상 구현이 정하는 것이라, 다른 엔진(예: 병합 정렬을 쓰는 엔진)에서는 우연히 맞게 정렬되기도 합니다. 그래서 **특정 엔진의 결과를 주장하는 문장을 모두 없앴습니다.**

- 레슨 "흔한 실수": "Chrome에서 실행해 보면 순서가 전혀 바뀌지 않아요"와 `// [5, 1, 4, 2, 3]` 예제를 지우고, 두 수를 직접 넣어 `wrong(1, 5)`는 `false`(0, "순서를 바꾸지 않음"), `right(1, 5)`는 `-4`("1을 앞에")임을 보여 주는 예제로 바꿈. 결과는 "그대로이거나, 일부만 정렬되거나, 우연히 제대로 정렬되기도 해서 믿을 수 없다"고 설명
- `tf-compare-boolean`: 진위가 엔진에 따라 달라지는 문장("작은 수부터 정렬된다"는 거짓)을 "`a > b`는 `a`가 작을 때 '`a`를 앞에'라는 신호를 줄 수 있다"(엔진과 무관하게 거짓)로 바꾸고 이유 선택지·해설을 다시 씀
- `multi-sort-facts`: 오답 선택지 "`a > b`로 바꿔도 결과는 같다"도 엔진에 따라 참이 될 수 있어 "`a > b`로 바꿔 써도 작은 수부터 정렬된다고 믿을 수 있다"로 바꿈. 해설의 "`[30, 4, 200]` 그대로예요" 삭제
- 오개념 `js.mc.sort-compare-boolean`의 `reality`, 원리 섹션·요약·`fill-sort-descending` 해설의 "제대로 정렬되지 않는다"를 "정렬 결과를 믿을 수 없다"로 맞춤

### "확인용 (그대로 두세요)" 줄을 읽는 `program` 체크 (배열 기초 3문제)

`impl-cap-scores`, `impl-reserve-seat`, `fix-update-latest`는 학습자가 시작 코드의 확인용 줄을 지우거나 이름을 바꾸면 맞는 함수도 실패했습니다.
**`program` 체크를 없애고, 함수를 직접 부르는 숨김 `call` 체크로 "배열을 실제로 바꿨는지"를 판별하게 바꿨습니다.** `argsExpr`은 학습자 코드와 같은 전역 범위에서 실행되므로(`packages/runner/src/prepare/expose.ts`), 학습자 함수를 한 번 부른 뒤 **같은 배열을 다시 넘기는** 식으로 첫 호출의 결과가 배열에 남았는지 확인할 수 있습니다.

| 문제 | 판별 체크 | 떨어뜨리는 틀린 답(실제로 확인) |
|---|---|---|
| `impl-cap-scores` | 바꾼 배열을 `max` 110으로 다시 넘기면 0개, `max` 99로 넘기면 2개 | 복사본만 바꾸는 답, 큰 점수를 다른 값(0)으로 바꾸는 답 |
| `impl-reserve-seat` | 예약한 좌석표로 같은 좌석을 다시 예약하면 "이미 예약된 좌석이에요" | 좌석표에 이름을 넣지 않는 답 |
| `fix-update-latest` | 고친 뒤 세 번째 자리가 59이고 기록 수가 그대로인지(반환값의 2번 줄 버그와 무관하게) | 3번 줄 버그(끝에 덧붙이기)가 남은 답 |

시작 코드의 예시 줄은 "실행해 보는 예시예요(바꾸거나 지워도 채점과 상관없어요)"로 바꾸고, 지문에 채점 방식을 밝혔습니다.

### 채점되지 않는 지시 ("`forEach`로", "`map`으로" 등)

| 문제 | 초안 | 처리 |
|---|---|---|
| `array-iteration.web-todo-list` | 할 일 다섯 줄을 `addItem`으로 직접 적어도 통과 | **채점을 보강함.** 학습자는 `showTodos(todos)`의 본문을 쓰고, 시작 코드가 오늘 할 일로 한 번 부른 뒤 "내일 할 일 보기" 버튼이 내일 할 일로 다시 부름. `event` 체크가 버튼을 눌러 목록 2줄과 "급한 일 1개 / 전체 2개"를 확인. 직접 적은 답, 전역 `today`를 도는 답, 개수를 전역 변수로 세는 답이 실패함 |
| `array-mutation.fix-queue-pop` | "부른 손님은 대기열에서 빠져야" 하지만 확인하지 않음(`queue[0]`으로 읽기만 해도 통과) | **채점을 보강함.** 한 명을 부른 뒤 같은 대기열로 다시 부르면 13번이 불려야 하는 숨김 체크 |
| `array-hof.impl-price-labels`, `impl-passed-scores` | "`map`으로 완성하세요", "`filter`로 완성하세요" | 동작으로 구별할 수 없고 정적 규칙 체크(`static`)는 아직 서버가 계산하지 않음. "이 단원에서 배운 `map`으로 풀어 보세요(반복과 `push`로 만들어도 채점은 통과해요)"처럼 권장 문구로 바꿈 |
| `impl-count-passed`, `impl-best-day`, `impl-coupon-sum` | "…로 풀어 보세요" | 이미 권장 문구이고 해설이 다른 풀이도 정답이라고 밝혀서 유지 |

### `impl-move-item`과 `impl-best-day`의 힌트 3

- `impl-move-item`: 힌트 3이 "반복이나 `splice`보다 먼저 확인하라"고 해서 예시 정답(복사 → 확인)과 어긋났음. "`splice`를 부르기 **전에** 확인하라(`-1`을 넘기면 어떤 요소가 꺼내질지 떠올려 보라), 이때도 새 배열을 돌려줘야 한다"로 바꿈. 정답 코드를 주지 않음
- `impl-best-day`: 힌트 1·2·3을 이으면 풀이 단계가 그대로 나왔음("더 클 때만 바꾸고 아니면 그대로"). 힌트 3을 "콜백은 어느 경우에도 다음 누적값을 돌려줘야 한다, 같을 때 어느 날이 남아야 하는지 요구사항을 다시 읽고 비교 연산자를 고르라"로 바꿈

### `impl-top-three`의 주 개념

**`js.arr.sort`로 바꿨습니다**(`slice-concat`은 0.5). 이 문제의 함정은 비교 함수 없는 정렬(`sort-numeric-default`), 원본을 정렬하는 실수(`sort-returns-new-array`)로 모두 `sort`의 오개념이고, "`slice()`로 복사한 뒤 정렬"은 `sort` 개념의 학습 목표입니다. 또 `sort`(core)에는 함수 구현 문제가 없었습니다. `slice-concat`은 5문제로 standard 최소(4)를 넘고, L3 이상도 3문제입니다.

### 핵심 단원의 L4 비율

루브릭으로 다시 매긴 결과(아래 "난이도 정정") 고차 함수 단원은 L4 19%(6/32), 배열 바꾸기 단원은 18%(4/22)입니다. 목표(20%)와 한 문제 이내 차이이고 L5가 각각 2개·1개 있어서, **L4를 새로 만들지 않았습니다.** 목표를 맞추려고 난이도를 올려 적지도 않았습니다. 다만 `web-search-filter`는 검색 함수와 입력 연결을 함께 쓰는 상호작용 과제라 루브릭 합계가 9로, L3 → L4가 정직한 값이었습니다.

## 단원별 검토 요약

### js-basics.arrays.array-basics

레슨과 문제 20개를 승인했습니다.
`literal-index`는 core라 core 깊이로 봤습니다. 인덱스를 두 관점(사물함 번호, 앞에서 떨어진 거리)으로 설명하고, 인덱스 표, 예제 5개 중 예측형 2개, 오개념 6개, 실전 사례(슬라이드)와 확인 문제 4개가 있습니다.

- `impl-cap-scores`, `impl-reserve-seat`, `fix-update-latest`: 위 "확인용 줄" 참고
- 레슨은 고칠 곳이 없었습니다. 범위 밖 인덱스, 빈 칸, `const` 배열의 요소 변경, 문자열과의 비교 표가 모두 실제와 같습니다.

### js-basics.arrays.array-mutation ★

레슨과 문제 22개를 승인했습니다.
`splice`를 두 관점(지우기 + 끼워 넣기, 가위와 풀)으로 설명하고, 바꾸는 메서드와 바꾸지 않는 메서드의 표, 예제 5개 중 예측형 3개, 오개념 9개, 실전 사례와 확인 문제 4개가 있습니다.

- 레슨: `const stack`에 `stack = stack.push(...)`를 하면 "숫자가 들어간다"고 했지만 실제로는 `TypeError`라서 "`let`으로 만든 변수에…(`const`라면 `TypeError`)"로 고침. `001-mcq-push-returns` 해설도 같은 이유로 고침
- 레슨: "먼저 복사본을 만들어"라고 하면서 배열 복사 방법(`slice`)은 5단원에서 배움 → "지금은 빈 배열에 요소를 하나씩 `push`해서 만들 수 있다"를 더함
- `fix-queue-pop`: 대기열에서 빼는지 확인하는 체크 추가(위 참고)
- `find-bug-slice-remove`: 원인 선택지 "indexOf가 달걀을 찾지 못했다"에 붙은 `indexof-as-boolean` 연결 삭제(그 오개념은 "`indexOf` 결과를 참·거짓처럼 쓴다"라서 방향이 다름)
- `impl-insert-after`: `indexof-as-boolean`을 빈 일정표 체크에 걸어 두었지만 `if (index)` 버그가 그 체크를 우연히 통과함 → 실제로 그 버그를 떨어뜨리는 "없으면 맨 끝에" 체크로 옮김
- `impl-move-item`: 힌트 3(위 참고)

### js-basics.arrays.array-iteration

레슨과 문제 18개를 승인했습니다.
`for-of`(core)를 두 관점(꺼내기, 인덱스 반복과 같다고 보기)과 바퀴별 표로 설명하고, 세 가지 순회 방법 비교 표, 예제 5개 중 예측형 3개, 오개념 5개, 실전 사례와 확인 문제 4개가 있습니다.

- `web-todo-list`: 다시 설계(위 참고). 시작 코드가 함수 틀과 버튼 연결을 주고 학습자는 함수 본문 하나만 써서 L3을 유지
- `find-bug-loop-var-assign`: 원인이 아닌 3번 줄(조건)을 `acceptLines`에서 지움. 보이지 않는 `fixedCode`는 2번·4번 줄만 바꾸게 고쳐 정적 검사 경고가 나지 않게 하고, 해설의 고친 예도 `const score = scores[i];`를 쓰는 모양으로 맞춤

### js-basics.arrays.array-hof ★

레슨과 문제 32개를 승인했습니다.
`map`을 `for...of`와 나란히 보이고, 메서드별 "콜백이 돌려줄 것 / 메서드가 돌려주는 값" 표, `reduce` 단계 표, 이어 쓰기 순서 비교 표가 있습니다. 예제 5개 중 예측형 3개, 오개념 15개를 모두 다루고, 실전 사례(검색)와 확인 문제 4개가 있습니다.

- `fix-map-no-return`: 루브릭으로 L2였는데, L2로 내리면 `map`(core)의 L3 이상 문제가 하나도 없어 숙련 단계 게이트(L3 이상 1문제)를 채울 수 없었음. 난이도를 그대로 적는 대신 **실제로 두 단계가 필요한 문제로 바꿈**: 바깥 `return`도 빠져 함수가 `undefined`를 돌려주고, 그것만 고치면 `[undefined, undefined]`가 나옴. 바깥 `return` 버그를 진단하는 `returns-array` 체크 추가. 루브릭 6~7로 L3
- `web-search-filter`: L3 → L4(위 참고)
- `fix-find-minus-one` L3 → L2, `multi-reduce-initial` L4 → L3(아래 표)
- `impl-best-day`: 힌트 3(위 참고)
- `find-bug-foreach-chain`: 5번 줄(`.filter`)을 원인으로 인정하던 `acceptLines` 삭제. 오류는 5번 줄에서 보고되지만 원인은 4번 줄의 `forEach`라는 것을 해설에 분명히 씀
- `impl-price-labels`, `impl-passed-scores`: 지문을 권장 문구로(위 참고)

### js-basics.arrays.array-search-sort

레슨과 문제 18개를 승인했습니다.
`sort`(core)를 두 관점(부호로 보기, 모양으로 보기)과 사전순 위치 표로 설명하고, 예제 5개 중 예측형 3개, 오개념 7개, 실전 사례(점수판 TOP 3)와 확인 문제 4개가 있습니다.

- `a > b` 비교 함수 관련 문장 정리(위 참고)
- `predict-search-values`: 오답 `"3\nfalse\n-1\ntrue\n-1"`(마지막 위치로 착각)에 붙은 `indexof-as-boolean` 연결 삭제. 방향이 다름
- `impl-top-three`: 주 개념을 `sort`로(위 참고)
- 레슨 "다음 학습 연결": "배열 모듈의 단원을 모두 배웠어요"는 뒤에 단원 평가가 붙을 예정이라 "새로 배우는 내용은 여기까지예요"로 바꾸고, 모듈 9에 없는 "객체 값 기준 정렬을 다시 만나요"를 "객체를 배우고 나면 … 정렬할 수도 있어요"로 바꿈

### 난이도 정정

| 문제 | 전 → 후 | 이유 (루브릭: 개념·추론·구현·함정) |
|---|---|---|
| `array-hof.fix-find-minus-one` | 3 → 2 | 개념 2개(1) + 한 단계 적용(1) + 한 줄 수정(1) + 오개념 1개(1) = 4 |
| `array-hof.multi-reduce-initial` | 4 → 3 | 개념 1개(0) + 여러 단계(2) + 없음(0) + 경계 조건·비직관 규칙(2~3) = 4~5 |
| `array-hof.web-search-filter` | 3 → 4 | 개념 4개(3) + 여러 단계(2) + 함수와 입력 연결(2~3) + 콜백 넘기기·공백(2) = 9 |
| `array-hof.fix-map-no-return` | 3 유지 | 위 설명처럼 두 버그 문제로 바꿔 6~7 |

나머지는 루브릭과 맞았습니다. 여러 단계의 상태 변화를 머릿속에서 따라가야 하는 예측 문제(`predict-length-gap`, `predict-splice-steps`, `predict-function-arg`, `predict-foreach-return`, `predict-some-every-stop`, `predict-chain-order`, `predict-copy-or-change`)는 L4를 유지했습니다.

## 최종 문제 구성

승인된 문제 110개, 미승인 0개입니다. 단원별 승인 수는 `practice.targetCount`와 같습니다. 문제를 지우거나 새로 만들지 않아 문제 ID는 바뀌지 않았습니다.

### 유형 범주 (JS 목표: 개념 확인 25 · 코드 이해 25 · 디버깅 20 · 구현 20 · 응용 10, ±10%p)

응용은 L4 이상의 `implement_function`·`fix_bug`·`web_task`입니다(디버깅·구현 칸에서 뺌).

| 단원 | 개념 확인 | 코드 이해 | 디버깅 | 구현 | 응용 (L4+) |
|---|---|---|---|---|---|
| array-basics (20) | 6 (30%) | 5 (25%) | 4 (20%) | 3 (15%) | 2 (10%) |
| array-mutation (22) | 6 (27%) | 5 (23%) | 5 (23%) | 3 (14%) | 3 (14%) |
| array-iteration (18) | 4 (22%) | 5 (28%) | 4 (22%) | 3 (17%) | 2 (11%) |
| array-hof (32) | 10 (31%) | 8 (25%) | 6 (19%) | 3 (9%) | 5 (16%) |
| array-search-sort (18) | 5 (28%) | 5 (28%) | 4 (22%) | 2 (11%) | 2 (11%) |

고차 함수 단원의 "구현" 칸만 9%로 목표 범위(10~30%)보다 1%p 낮습니다. `web-search-filter`를 L4로 정정하면서 응용 칸으로 옮겨 갔기 때문이고, 구현과 응용을 합치면 25%(목표 합 30%, 범위 안)입니다. 범주를 맞추려고 난이도를 낮춰 적지 않았습니다.

### 유형별 수

| 단원 | mcq_single | mcq_multi | true_false | predict_output | fill_blank | parsons | find_bug_line | fix_bug | implement_function | web_task |
|---|---|---|---|---|---|---|---|---|---|---|
| array-basics | 3 | 1 | 2 | 3 | 1 | 1 | 1 | 4 | 4 | |
| array-mutation | 3 | 1 | 2 | 3 | 1 | 1 | 1 | 5 | 5 | |
| array-iteration | 2 | 1 | 1 | 3 | 1 | 1 | 1 | 4 | 3 | 1 |
| array-hof | 6 | 2 | 2 | 6 | 1 | 1 | 2 | 4 | 7 | 1 |
| array-search-sort | 3 | 1 | 1 | 3 | 1 | 1 | 1 | 4 | 3 | |

모든 단원이 유형 9종 이상이고, 한 유형이 50%를 넘지 않습니다(가장 많은 것은 `array-mutation`의 `fix_bug`·`implement_function` 23%).

### 난이도

| 단원 | L1 | L2 | L3 | L4 | L5 | 목표 (L1/L2/L3/L4/L5) |
|---|---|---|---|---|---|---|
| array-basics | 3 (15%) | 7 (35%) | 7 (35%) | 3 (15%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| array-mutation ★ | 3 (14%) | 8 (36%) | 6 (27%) | 4 (18%) | 1 (5%) | 15 / 30 / 30 / 20 / 5 |
| array-iteration | 4 (22%) | 6 (33%) | 5 (28%) | 3 (17%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| array-hof ★ | 5 (16%) | 10 (31%) | 9 (28%) | 6 (19%) | 2 (6%) | 15 / 30 / 30 / 20 / 5 |
| array-search-sort | 3 (17%) | 6 (33%) | 6 (33%) | 3 (17%) | 0 | 20 / 35 / 30 / 15 / 0~5 |

### 주 개념별 수 (최소: JS core 6 · standard 4 · minor 3)

| 개념 | 중요도 | 문제 수 | L3 이상 |
|---|---|---|---|
| `js.arr.literal-index` | core | 8 | 2 |
| `js.arr.length` | standard | 7 | 4 |
| `js.arr.element-update` | standard | 5 | 4 |
| `js.arr.push-pop` | core | 6 | 2 |
| `js.arr.shift-unshift` | minor | 4 | 1 |
| `js.arr.splice` | standard | 5 | 3 |
| `js.arr.mutating-vs-not` | core | 7 | 5 |
| `js.arr.for-of` | core | 9 | 4 |
| `js.arr.foreach` | standard | 9 | 4 |
| `js.arr.map` | core | 6 | 1 |
| `js.arr.filter` | core | 6 | 3 |
| `js.arr.find` | standard | 4 | 1 |
| `js.arr.some-every` | standard | 4 | 2 |
| `js.arr.reduce` | core | 7 | 5 |
| `js.arr.chaining` | standard | 5 | 4 |
| `js.arr.includes-indexof` | standard | 5 | 3 |
| `js.arr.sort` | core | 8 | 3 |
| `js.arr.slice-concat` | standard | 5 | 3 |

모든 주 개념이 개념 이해 유형과 코드 이해 유형, L3 이상 문제를 1개 이상 가집니다. 실습 유형(버그 수정·구현·웹 실습)도 모두 있습니다(`some-every`는 구현만, `shift-unshift`(minor)는 버그 수정만).

## 남은 한계와 후속 제안

- **풀이 방법 지시는 강제하지 못합니다.** `static` 체크(예: `require-call: map`)는 스키마에 있지만 서버가 아직 계산하지 않아(`serverFindings` 없음) 쓸 수 없습니다. "`map`으로", "`for...of`로" 같은 지시는 권장 문구로 두었습니다. 서버의 정적 검사가 생기면 `required: false` 체크로 피드백만 주는 것을 제안합니다.
- **판별용 `argsExpr`는 숨김 체크에만 씁니다.** 공개 체크로 보이면 `entry((() => { … })())`처럼 읽기 어려운 호출로 표시되기 때문입니다. 체크 명세에 "인수 변경 후 값"(`argsAfter` 기대값)을 비교하는 기대 종류가 생기면 이 문제들을 그쪽으로 옮기는 편이 읽기 쉽습니다.
- **`map`의 L3 이상 문제가 1개뿐입니다.** 게이트는 채우지만 core 개념으로는 얇습니다. 템플릿이나 단원 평가에서 `map`의 콜백 인덱스·이어 쓰기 응용을 보강하면 좋습니다.
- 복습 출제용 템플릿은 이 모듈에도 아직 없습니다(설계의 "주 개념마다 템플릿 1개 이상"은 앞 모듈과 같이 후속 작업).
- 고차 함수 단원의 "구현" 범주가 목표보다 1%p 낮습니다(위 표).
