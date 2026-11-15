# JS 기초 모듈 9 콘텐츠 AI 교차 검토 기록 (2026-11-15)

JS 기초 모듈 9 "객체"(레슨 5개, 문제 108개)를 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
검토 방법, 검토 요청 메모에 대한 판단, 단원별 요약, 직접 고친 내용, 최종 문제 구성과 남은 한계를 적습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-15
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [결정 기록](/docs/decisions.md), [JS 기초 모듈 6 검토](/docs/reviews/2026-11-15-m6-js-module-6-review.md)

## 검토 범위와 방법

대상은 `content/courses/js-basics/modules/09-objects/`의 레슨 본문과 문제 전부, 그리고 이 모듈의 개념 17개(`content/concepts/js.yaml`)와 오개념 32개(`content/misconceptions/js.yaml`)입니다.
모든 문제가 `review.status: draft`, `draftedBy: ai:claude`였습니다.

| 단원 | 중요도 | 목표 문제 수 |
|---|---|---|
| `object-basics` 객체 기초 ★ | core | 24 |
| `reference-vs-value` 참조와 복사 ★ | core | 28 |
| `object-iteration` 객체 순회 | standard | 18 |
| `destructuring-and-spread` 구조 분해와 전개 ★ | core | 22 |
| `error-handling` 오류 처리 기초 | standard | 16 |

단원 평가(`objects-review`)는 단원 평가 작업에서 따로 추가하므로 이번 범위가 아닙니다.
D-027 기준의 전수 검토 대상은 레슨 본문, 핵심 단원(★) 문제, 핵심 개념 문제입니다. 나머지 두 단원도 34문제뿐이라 **모든 문제를 전수 검토**했습니다.

검토 절차:

1. 초안 작성 대화를 보지 않았습니다. 원본 파일, 설계 문서, 작성 가이드, 결정 기록(D-026~D-047), 이전 검토 기록만 읽었습니다.
1. 검토 시작 전에 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(실패 0)을 직접 실행했습니다.
1. 레슨마다 [품질 체크리스트](/docs/design/content-and-exercises.md#품질-체크리스트-검토자용)의 레슨 항목, 표준 12섹션, 개념 중요도별 깊이, 선수 개념 순서(모듈 1~8과 앞 단원만 쓰는지)를 확인했습니다. 모듈 8(배열)이 이 모듈보다 먼저 main에 들어왔으므로, 배열 사용이 모듈 8이 가르친 범위(`push`, `join`, `slice`, `for...of` 등)와 맞는지도 봤습니다.
1. 문제마다 체크리스트의 문제 항목을 확인했습니다. 정답이 하나로 정해지는지, 체크가 동등한 다른 정답은 받고 시작 코드·버그 코드·우회한 답은 떨어뜨리는지, 오답과 `misconception` 연결의 방향, 힌트 3단계, 해설이 선택지 기호가 아니라 내용으로 설명하는지, 난이도가 루브릭 합계와 맞는지를 특히 봤습니다.
1. **레슨과 해설이 주장하는 실행 결과를 Node 24 엄격 모드에서 실행해 확인했습니다.** 확인한 것은 다음과 같고, 모두 레슨·해설의 문구와 글자까지 같았습니다.
   - `SyntaxError: Unexpected token ';'`(속성 사이 세미콜론), `Unexpected identifier 'deliver'`, `missing ) after argument list`(D-030 엔진 문구)
   - `TypeError: Cannot read properties of undefined (reading 'city')`, `Assignment to constant variable.`, `Cannot assign to read only property 'count' of object '#<Object>'`(`Object.freeze`), `scores is not iterable`, `menu.keys is not a function`, `menu.order is not a function`, `Cannot use 'in' operator to search for 'name' in 서연`
   - `Cannot destructure property 'menu' of 'undefined' as it is undefined.`, 첫 항목에 기본값이 있는 패턴의 `Cannot read properties of undefined (reading 'settings')`
   - `ReferenceError: price is not defined`, `city is not defined`(`shop.home-city`), `b is not defined`(메서드 안에서 `this` 없이 속성 이름 사용)
   - 엄격 모드에서도 리터럴의 중복 키는 오류가 아니고 뒤의 값이 남음, 정수 모양 키가 `Object.entries`·`for...in`에서 먼저 나옴(`2`, `10`, `z` 순), 구조 분해 기본값은 `null`에 쓰이지 않음, `user?.address.city`는 `TypeError`, `finally`가 `return`보다 먼저 출력됨, `"주문 수량: " + new Error(...)`가 `Error: ...`로 이어 붙음, `"20" < 19`가 `false`, `undefined < 1`이 `false`, `!"name" in form`이 `"false" in form`으로 읽힘
   - 같은 엔진(V8)의 Chromium에서는 `content:check:run`이 모든 예측 문제·예제·참조 정답을 실제 러너로 실행해 확인합니다.
1. 콘솔 형식을 `packages/shared/src/console-format.ts`에서 직접 확인했습니다. 키가 `^[A-Za-z_$][\w$]*$`에 맞지 않으면 큰따옴표로 감싸므로 `{ "떡볶이": 5 }`라는 레슨 설명이 맞습니다. 채점(`outputLineEquals`)은 양쪽이 리터럴로 읽히면 구조로 비교하고 객체 키 순서를 무시합니다. 그래서 `predict-cart-changes`의 "속성 순서는 채점하지 않아요"도 맞습니다(`{ milk: 3, bread: 1, item: 5, apple: undefined }`와 순서를 바꾼 답이 같다고 판정됨을 실행해 확인). 다만 학습자가 `{ 떡볶이: 5 }`처럼 따옴표 없이 쓰면 리터럴로 읽히지 않아 오답이 됩니다. 이 모듈의 예측 문제 중 출력에 한글 키 객체가 나오는 것은 없습니다.
1. 고친 채점이 실제로 우회 답을 떨어뜨리는지 확인하려고, 콘텐츠를 임시 폴더에 복사해 일부 문제의 참조 정답을 "우회 답"으로 바꾸고 `content-cli check --run --dir`로 실행했습니다. 아래 "채점되지 않던 지시"의 우회 답 5개가 모두 실패했습니다.
1. `pnpm content:build:dev`로 빌드하고 앱(`PROGINONE_PORT=4590`, 임시 데이터 폴더)을 띄워 레슨 5개를 Playwright로 1280px와 390px에서 캡처했습니다. 가로 넘침, 미렌더링 Markdown, 콘솔 오류를 자동 검사했고 모두 없었습니다. 캡처를 눈으로 보다가 참조와 복사 레슨의 상자 그림 두 개가 한글 폭 때문에 어긋난 것을 찾아 고쳤습니다(아래).

### 검토자가 직접 쓴 부분의 2차 검토

검토자가 새로 쓰거나 크게 고친 부분은 자기 승인을 피하려고 **분리된 컨텍스트의 2차 AI 검토자**에게 다시 검토하게 했습니다. 대상은 레슨 5개의 고친 문단·그림과 문제 21개(다시 쓴 2개 포함), 개념·오개념 파일의 수정입니다.
2차 검토는 모든 실행 결과를 Node 엄격 모드에서 다시 확인했고, 대부분을 그대로 승인했습니다. 요청한 4가지와 문구 제안 2가지를 반영했습니다.

- `fix-finally-loading`: `loading = true;` 줄을 지우기만 해도 출력과 `loading` 값이 맞아 통과했음 → 불러오는 중 줄에 로딩 상태를 함께 출력해(`불러오는 중... (로딩 중: true)`) 그 우회를 떨어뜨림
- `impl-level-up`: 숨김 체크가 걸러 내는 답(`let`으로 바꿔 새 객체 대입)은 "const 객체 속성은 못 바꾼다"고 생각해 통째로 다시 만든 경우라 `const-can-reassign`이 아니라 `const-object-props-frozen`으로 연결
- 참조와 복사 레슨: "`slice()`도 같은 새 배열을 만들어요"가 "똑같은 배열"로 읽힐 수 있어 "마찬가지로 새 배열을"로 고침
- `predict-param-reassign`: 새로 쓴 "`지민 99`" 해설 문장이 그 답의 생각과 맞지 않아(그 생각이면 셋째 줄이 `true`) "4번 줄이 `user`의 객체를 바꾼다고 본 것"으로 고침
- 문구: `predict-missing-then-error` 힌트 3, 구조 분해 레슨 관점 표의 "값을 만드는 자리" 칸

`impl-check-orders`(L3)는 루브릭 합계가 6~7로 L3/L4 경계라는 의견이 있었습니다. 지문이 규칙을 모두 밝히고 함정이 하나뿐이라 L3로 두었습니다.

`draftedBy`는 스키마 형식에 따라 `ai:claude`로 두었습니다. 검토자가 고친 사실은 이 기록과 git 이력에 남습니다.

## 검토 요청 메모에 대한 판단

### 모듈 8 선수 개념과 `concepts.reviewed`

병합 과정에서 `js.obj.keys-values-entries`, `js.obj.copy-shallow`, `js.obj.spread`, `js.arr.destructuring`에 배열 선수 개념이 들어가 있었습니다. 하나만 바꿨습니다.

- `js.obj.copy-shallow`: `js.arr.for-of` → `js.arr.push-pop`. 얕은 복사 레슨과 문제는 `push`로 "안쪽 배열이 함께 바뀐다"를 보여 주고, `for...of`는 쓰지 않습니다.
- 나머지 세 개는 그대로 맞습니다(`Object.values`를 `for...of`로 돌기, 배열 인덱스, 배열 전개).

각 레슨의 `concepts.reviewed`에 문제가 실제로 쓰는 배열 개념을 더했습니다.

| 단원 | 더한 개념 |
|---|---|
| object-basics | `js.arr.literal-index`, `js.arr.push-pop`, `js.arr.for-of` |
| reference-vs-value | `js.arr.literal-index`, `js.arr.push-pop`, `js.arr.for-of`, `js.arr.mutating-vs-not` |
| object-iteration | `js.arr.literal-index`, `js.arr.push-pop`, `js.arr.for-of` |
| destructuring-and-spread | `js.arr.literal-index`, `js.arr.push-pop`, `js.str.split-join` |
| error-handling | `js.arr.push-pop`, `js.arr.for-of` |

배열 사용은 모듈 8 범위 안이었습니다(`push`, `join`, `slice()`, `for...of`). `map`·`filter`·`reduce`는 쓰지 않습니다. 대신 이제 배워서 알고 있는 내용을 "처음 보는 것"처럼 설명하던 곳을 고쳤습니다.

- `impl-count-words`, `impl-run-commands` 지문의 `for...of`·`push` 사용법 안내 → "모듈 8에서 배운 …"으로 바꿈
- 참조와 복사 레슨: 모듈 8이 "왜 그런지는 모듈 9에서"라고 미뤄 둔 두 가지(함수 안의 `push`·`sort`가 바깥 배열을 바꿈, `const` 배열의 요소를 바꿀 수 있음)를 그 자리에서 회수하는 문장을 넣고, `slice()`도 새 배열을 만든다고 연결
- 객체 순회 레슨: 모듈 8의 "배열에 `for...in`을 쓰면 인덱스 문자열이 나온다"와 연결하는 문단을 넣음

### 콘솔의 한글 키 표시

위 검토 방법에 적은 대로 실제 형식기와 같습니다. 고치지 않았습니다.

### `predict-cart-changes`의 속성 순서

채점기가 키 순서를 무시함을 확인했으므로 지문은 그대로 둡니다. 오개념 연결 두 개는 방향이 맞지 않아 바꿨습니다.

- `{ milk: 3, item: 5, apple: undefined }`: `cart[item]`도 이름이 `item`인 속성을 만든다고 본 답이라 `dot-with-variable-key`가 아니라 `bracket-key-without-quotes`(대괄호 안 이름을 글자 그대로 읽음)
- `{ milk: 3, bread: 1, item: 5 }`: `apple`에 `undefined`를 넣으면 속성이 없는 것과 같다고 본 답이라 `missing-property-error`가 아니라 `undefined-value-means-missing`

### `this`는 `obj.method()`만

레슨과 문제 모두 `객체.메서드()` 호출에서의 `this`만 쓰고, 다른 호출 방식은 "JavaScript 심화에서"라고 미룹니다. 범위 밖 주장이 없습니다.

### 전역 `name`을 피하기

브라우저와 Worker에는 전역 `name`이 미리 있어서, 선언을 빠뜨린 코드가 `ReferenceError` 대신 빈 문자열을 읽을 수 있습니다. 최상위에서 `name` 변수를 만드는 실행 코드를 찾아 바꿨습니다.

- 구조 분해 레슨 첫 예제: `const { name, price } = menu;` → 속성을 `title`로 바꿈(`menuTitle`로 이름 바꾸기)
- 구조 분해 레슨의 이름 바꾸기 방향 흔한 실수: `{ userName: name }` → `{ userName: nickname }`(오개념 문장도 같이 고침)
- `mcq-destructure-keeps-original`의 코드: `name` → `nickname`
- 함수 매개변수나 `for` 블록 안의 `name`은 전역이 아니라 그대로 둠. `fill-param-destructure` 해설의 "`name`은 브라우저가 미리 만들어 둔 전역 이름이라 …" 설명은 사실이고 교육적이라 둠
- `web-cart-const`에 새로 넣은 객체도 전역 `screen`(window.screen)과 겹치지 않게 `view`로 지음

### 채점되지 않던 지시

| 문제 | 초안 | 처리 |
|---|---|---|
| `object-basics.impl-score-board` | "아래 코드는 그대로 두세요", 출력만 검사 | **부분 보강 + 문구 정리.** 함수가 아닌 객체 리터럴 문제라 숨김 입력으로 메서드를 부를 수 없습니다(`call` 체크는 함수 하나만 부르고, 메서드가 든 객체는 `equals`로 비교할 수 없음). `program` 체크에 `board`가 객체인지를 더해, 아래 코드를 지우고 여섯 줄만 출력하는 답을 떨어뜨립니다(임시 실행으로 확인). "그대로 두세요"는 "아래 코드가 `board`의 메서드를 불러요"로 바꾸고, 해설에 무엇을 검사하는지 밝힘 |
| `reference-vs-value.impl-level-up` | "1번 줄은 그대로 두고" | **채점 보강.** 시작 코드에 `const party = [hero];`를 더하고, 숨김 `program` 체크가 `party[0]`에도 레벨 업 결과가 보이는지 확인합니다. `let`으로 바꿔 새 객체를 대입하는 답은 `party`에 옛 객체가 남아 실패합니다(확인). 같은 객체를 바꾼다는 이 단원의 요점도 함께 연습합니다. 실패 시 오개념은 `const-object-props-frozen` |
| `reference-vs-value.web-cart-const` | "`cart`를 만드는 줄은 그대로 두세요" | **채점 보강.** 화면 객체 `view`가 처음 만든 장바구니를 기억하고 `show()`가 그 객체를 그리도록 바꿨습니다. `let cart`로 바꿔 새 객체를 대입하면 화면이 비워지지 않아 체크 3개가 실패합니다(확인). "비우기" 체크에 담은 메뉴 목록이 빈 문자열인지도 더함 |
| `destructuring-and-spread.web-drink-options` | "전개 구문으로" 새 객체를 만들라고 하지만 `resetOrder`를 리터럴로 쓰면 `state`를 직접 고쳐도 통과 | **채점 보강.** 화면에 기본 주문(`DEFAULT`)도 보여 주고, 숨김 체크 `default-kept`가 버튼을 누르는 동안 기본 주문이 그대로인지 확인합니다. `state`를 직접 고치는 답은 실패합니다(확인). 속성을 하나씩 적어 새 객체를 만드는 답은 원본을 지키므로 정답으로 두고 해설에 밝힘 |
| `error-handling.impl-check-orders` | 입력 세 개를 고정한 프로그램 문제, 출력과 `okCount`만 검사 | **함수 문제로 다시 씀.** `checkOrders(texts)`가 결과 문장 배열을 돌려주고, 숨김 입력 세 개(첫 입력부터 실패, 모두 성공, 빈 배열)로 채점합니다. `try...catch`를 반복 밖에 둔 답은 실패합니다(확인). 모듈 8 뒤라 배열과 `for...of`를 쓸 수 있어서 가능해졌습니다. 난이도 L2 → L3(반복 + 오류 처리 + 누적) |
| `error-handling.fix-finally-loading` | 정리 코드를 `catch`에도 한 줄 더 쓰면 `finally` 없이 통과 | **버그를 다시 설계.** 불러오는 동안의 로딩 상태도 출력해 `loading = true;`를 지우는 우회를 막음(2차 검토 반영). `try`와 `catch`가 모두 `return`으로 끝나고 그 뒤의 `loading = false;`가 한 번도 실행되지 않는 버그로 바꿨습니다. `finally`가 `return`이 있어도 실행된다는 레슨의 요점을 쓰게 되고, `finally` 없이 고치려면 두 갈래를 모두 고쳐야 해서 자연스러운 답이 `finally`가 됩니다. 그 방법도 출력은 같으므로 해설에 밝힘. 오개념 연결은 `code-after-return-runs`, `finally-only-on-error`로 바꾸고, `try-resumes-after-catch`의 보충 문제 목록에서 이 문제를 빼고 `impl-check-orders`를 넣음 |

`checkout-wallet`의 "`charge`는 고치지 마세요"와 `impl-check-orders`의 `toQuantity`는 그대로 두었습니다. 시작 코드의 도우미 함수를 바꿔 오류를 던지지 않게 하면 우회할 수 있지만, 채점으로 막을 방법이 없고 일부러 과제를 피하는 경우뿐입니다. `impl-check-orders` 해설에는 그 점을 밝혔습니다.

### `fix-order-template` L5 → L4

루브릭으로 개념 3개(2) + 상태 시뮬레이션(3) + 한 줄 고치기(1) + 오개념 두 겹(2) = 8로 L4입니다. "고친 뒤에도 남는 두 번째 버그"라는 함정은 좋지만, L5의 "새로운 상황으로 전이·여러 함수 설계"에는 미치지 않습니다.

### `tf-rename-direction`의 힌트 3

힌트 2가 "키 자리는 속성 이름이에요"라고 답을 말해 버리고, 힌트 3은 "`bookTitle` 속성이 있나요? 변수 이름은 콜론의 어느 쪽?"으로 남은 판단까지 대신했습니다. 힌트 2는 "콜론 왼쪽(키 자리)에는 객체에 있어야 하는 무엇이 올까요?"라는 질문으로, 힌트 3은 "2번 줄이 찾으려는 이름이 `book`에 실제로 있는지 확인해 보세요"로 바꿔 답을 직접 주지 않게 했습니다.

### `fix-cart-bugs`가 뒤 단원 오개념을 씀

`object-basics.fix-cart-bugs`의 세 번째 버그(`cart[name] = undefined`로 "빼기")는 `undefined-value-means-missing`(객체 순회 단원)을 정확히 나타냅니다. **연결은 유지**하고, 객체 기초 레슨의 속성 삭제 설명에 "`obj.x = undefined`는 삭제가 아니라 값만 바뀌고 속성은 남아 출력에 보인다"는 문단을 넣어 그 단원에서 먼저 배우게 했습니다. 같은 문단이 `predict-cart-changes`의 바뀐 오개념 연결도 받쳐 줍니다.

### `impl-apply-order`의 계산된 속성 이름

해설 끝의 `{ ...stock, [item]: left - qty }`(계산된 속성 이름)는 어디에서도 가르치지 않아 지웠습니다. 정답 풀이는 `next[item] = ...`로 충분합니다.

## 단원별 검토 요약

### js-basics.objects.object-basics ★

레슨과 문제 24개를 승인했습니다.
핵심 단원 기준을 충족합니다. 원리를 두 관점(서랍장 그림, 이름을 찾는 3단계 표)으로 설명하고, 예제 5개 중 3개가 예측형이며, 오개념 7개를 모두 `<Pitfall>`로 다루고, 실전 사례(JSON 응답)와 확인 문제 4개가 있습니다.

- **해설·지문에 작은따옴표가 그대로 보이던 문제 19개**: 해설(`explanation: |`)과 지문 안의 목록 줄이 `- '...'`처럼 YAML 따옴표로 감싸여 있었습니다. 블록 문자열 안이라 따옴표가 글자 그대로 화면에 나오고, 작은따옴표는 `''`로 두 번 보였습니다(예: `Unexpected token '';''`). 55줄을 기계적으로 풀었습니다. 다른 모듈에는 같은 문제가 없음을 확인했습니다.
- 레슨: `undefined` 대입과 삭제의 차이 문단 추가(위 참고).
- `predict-missing-then-error`: 힌트 3의 뜻이 통하지 않던 문장("값을 할 수 없는 방식으로 쓰면")을 다시 씀.
- `predict-cart-changes`: 오개념 연결 2개 정정(위 참고).
- `fix-bracket-quotes`: 해설이 "8번 줄의 문법 오류 때문에 7번 줄 실행 전에 멈추고, 7번 줄만 고치면 그때 이 오류가 보인다"고 순서를 거꾸로 말했습니다. 처음 실행하면 8번 줄의 `SyntaxError`가 먼저 보이고, 8번 줄을 고쳐야 7번 줄의 `ReferenceError`가 보입니다. 해설 순서와 힌트 1("다음 줄에서" → "다른 줄에서")을 고침.
- `fix-method-this`: 문제와 상관없는 오개념 `undeclared-assign-creates-global`을 목록에서 뺌(엄격 모드에서 `balance += amount`는 전역을 만들지 않고 `ReferenceError`).
- `impl-score-board`: 위 "채점되지 않던 지시" 참고.
- `impl-run-commands`: `split-result-is-string`(split 결과 자체가 문자열이라고 생각함)은 이 문제의 함정(조각이 문자열이라 `Number`가 필요함)과 달라 뺌.

### js-basics.objects.reference-vs-value ★

레슨과 문제 28개를 승인했습니다.
핵심 단원 기준을 충족합니다. 원리를 두 관점(화살표, 사물함 번호표)으로 설명하고, 예제 6개 중 4개가 예측형이며, 오개념 8개를 모두 다루고, 실전 사례(편집 취소)와 확인 문제 4개가 있습니다. 예제 수가 설계 기준(2~5개)을 하나 넘지만, 대입·함수 인수·얕은 복사·깊은 복사·비교·`const`가 각각 하나의 요점이라 줄이지 않았습니다.

- **상자 그림 2개 교체**: 원시 값과 객체 그림, 얕은 복사 그림이 캡처에서 한글 폭 때문에 연결선이 어긋났습니다. 오른쪽 정렬이 필요 없는 모양(라벨을 위로 올리고, "객체 1·객체 2·배열 A"로 이름 붙이기)으로 바꿈. 같은 이유로 `predict-shallow-nested`의 해설 그림과 `impl-move-member`의 해설 그림도 각각 이름 붙인 그림과 표로 바꿈.
- 레슨: 모듈 8 회수 문장 두 곳과 `slice()` 연결(위 참고).
- `find-bug-param-mutates`: 원인 선택지 "const로 만든 result의 속성을 바꾸면 원래 값이 함께 바뀐다"의 오개념 연결(`const-object-props-frozen`, "const 객체 속성은 못 바꾼다")이 반대 방향이라 지움.
- `predict-param-reassign`: `지민 99`를 `param-reassign-replaces-object`로 보던 연결을 지우고(그 오개념이면 `익명 99`가 나옴), 해설에서 그 답의 생각을 따로 설명.
- `impl-level-up`, `web-cart-const`: 위 "채점되지 않던 지시" 참고.
- `fix-order-template`: 난이도 L5 → L4(위 참고).

### js-basics.objects.object-iteration

레슨과 문제 18개를 승인했습니다.
일반 개념 기준을 충족합니다. 세 함수 비교 표, `in`과 `=== undefined` 비교 표가 있고, 예제 4개 중 2개가 예측형이며, 오개념 6개를 모두 다룹니다.

- 레슨: 정수 모양 키의 순서 규칙이 `Object.keys`·`values`·`entries`에도 같다는 문장과 모듈 8의 배열 `for...in` 연결 문단을 더함.
- 문제는 고칠 것이 없었습니다. `impl-missing-fields`의 `!(field in form)` 괄호 설명, `impl-get-setting`의 `settings?.[key] ?? fallback`, `fix-cart-summary`의 세 겹 버그를 모두 실행으로 확인했습니다.

### js-basics.objects.destructuring-and-spread ★

레슨과 문제 22개를 승인했습니다.
핵심 단원 기준을 충족합니다. 왼쪽 패턴의 뜻 표 두 개, 전개 순서 추적 표, "같은 점 세 개, 반대 방향" 관점 표가 있고, 예제 5개 중 4개가 예측형이며, 오개념 6개를 모두 다루고, 실전 사례(상태 객체, 설정 매개변수)와 확인 문제 4개가 있습니다.

- 레슨: 첫 예제와 흔한 실수의 전역 `name` 정리(위 참고).
- 레슨: **단축 속성(`{ menu, qty }`로 객체 만들기)** 문단을 더함. `impl-run-commands` 해설이 "이 줄임 문법은 구조 분해와 전개 단원에서 다시 봐요"라고 했지만 그 단원에 없었습니다. 구조 분해와 모양이 같고 방향만 반대라는 점을 함께 설명합니다.
- 레슨: 실전 사례의 `toLocaleString("ko-KR")`이 설명 없이 쓰여서 한 문장으로 설명. 관점 표의 "호출의 인수"(배우지 않은 `f(...arr)`)를 "`return` 뒤"로 바꿈.
- `tf-rename-direction`: 힌트 2·3(위 참고).
- `multi-destructure-facts`: 난이도 L4 → L3. 개념 3개(2) + 항목별 판단(2) + 오개념 세 개(2) = 6. 같은 모듈의 `multi-reassign-vs-mutate`(L4)는 함수 호출 전후의 상태 변화를 따라가야 해서(추론 3) L4를 유지했습니다.
- `impl-parse-record`: `split-result-is-string` 연결 삭제(위와 같은 이유).
- `web-drink-options`: 위 "채점되지 않던 지시" 참고.
- `impl-apply-order`: 계산된 속성 이름 문장 삭제(위 참고).

### js-basics.objects.error-handling

레슨과 문제 16개를 승인했습니다.
일반 개념 기준을 충족합니다. 실행 순서 표, 잡을 수 있는 오류 표가 있고, 예제 4개 중 2개가 예측형이며, 오개념 5개를 모두 다룹니다. 문법 오류 예제의 메시지는 D-030의 엔진 문구(`missing ) after argument list`)와 같습니다.

- 레슨: "이 단원이 객체 모듈의 마지막 단원이에요"는 뒤에 단원 평가가 붙으므로 "객체 모듈에서 새로 배우는 내용은 여기까지예요"로 바꿈.
- `predict-try-resume`: `손님: undefined`를 `missing-property-error`("없는 속성은 오류")로 보던 연결은 반대 방향이라 지움.
- `predict-finally-return`: 세 번째 연결(`finally`가 두 번 다 실행되지만 반환값보다 늦다고 본 답)은 `finally-only-on-error`가 아니라 순서 문제라 지움.
- `fix-finally-loading`, `impl-check-orders`: 위 "채점되지 않던 지시" 참고.

### 난이도 정정

| 문제 | 전 → 후 | 이유 (루브릭: 개념·추론·구현·함정) |
|---|---|---|
| `reference-vs-value.fix-order-template` | 5 → 4 | 개념 3개(2) + 시뮬레이션(3) + 한 줄 고치기(1) + 오개념 두 겹(2) = 8 |
| `destructuring-and-spread.multi-destructure-facts` | 4 → 3 | 개념 3개(2) + 항목별 판단(2) + 선택(0) + 오개념 세 개(2) = 6 |
| `error-handling.impl-check-orders` | 2 → 3 | 다시 쓴 문제: 개념 3개(2) + 한 단계(1) + 함수(2) + 반복 밖 `try` 함정(1) = 6 |

남은 L5 3문제(`impl-run-commands`, `impl-move-member`, `impl-merge-profile`)는 여러 단계의 객체를 다루는 함수를 설계하고 경계 조건을 함께 처리해 루브릭 합계가 10 이상입니다. 핵심 단원 세 개가 L5를 1문제씩 가집니다.

## 최종 문제 구성

승인된 문제 108개, 미승인 0개입니다. 단원별 승인 수는 `practice.targetCount`와 같습니다. 문제를 지우거나 새로 만들지 않아 문제 ID는 바뀌지 않았습니다(`impl-check-orders`, `fix-finally-loading`은 같은 ID로 내용을 다시 씀).

### 유형별 수

| 단원 | mcq_single | mcq_multi | true_false | predict_output | fill_blank | parsons | find_bug_line | fix_bug | implement_function | web_task |
|---|---|---|---|---|---|---|---|---|---|---|
| object-basics (24) | 4 | 1 | 2 | 3 | 1 | 1 | 1 | 4 | 6 | 1 |
| reference-vs-value (28) | 3 | 2 | 2 | 5 | 1 | 1 | 1 | 7 | 5 | 1 |
| object-iteration (18) | 2 | 1 | 2 | 2 | 1 | 1 | 1 | 4 | 3 | 1 |
| destructuring-and-spread (22) | 3 | 1 | 2 | 3 | 1 | 1 | 1 | 5 | 4 | 1 |
| error-handling (16) | 2 | 1 | 1 | 3 | | 1 | 1 | 4 | 3 | |

모든 단원이 유형 9종 이상이고, 한 유형이 50%를 넘지 않습니다(가장 많은 것은 `reference-vs-value`의 `fix_bug` 25%).

### 난이도

| 단원 | L1 | L2 | L3 | L4 | L5 | 목표 (L1/L2/L3/L4/L5) |
|---|---|---|---|---|---|---|
| object-basics ★ | 4 (17%) | 8 (33%) | 7 (29%) | 4 (17%) | 1 (4%) | 15 / 30 / 30 / 20 / 5 |
| reference-vs-value ★ | 3 (11%) | 10 (36%) | 9 (32%) | 5 (18%) | 1 (4%) | 15 / 30 / 30 / 20 / 5 |
| object-iteration | 3 (17%) | 6 (33%) | 7 (39%) | 2 (11%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| destructuring-and-spread ★ | 3 (14%) | 7 (32%) | 8 (36%) | 3 (14%) | 1 (5%) | 15 / 30 / 30 / 20 / 5 |
| error-handling | 3 (19%) | 5 (31%) | 6 (38%) | 2 (13%) | 0 | 20 / 35 / 30 / 15 / 0~5 |

모든 단원이 목표에 가깝습니다. 목표를 맞추려고 난이도를 올려 적지 않았습니다.

### 주 개념별 수 (최소: JS core 6 · standard 4 · minor 3)

| 개념 | 중요도 | 문제 수 | L3 이상 |
|---|---|---|---|
| `js.obj.literal` | core | 6 | 1 |
| `js.obj.dot-bracket` | core | 8 | 4 |
| `js.obj.add-delete` | standard | 6 | 5 |
| `js.obj.methods-intro` | standard | 4 | 2 |
| `js.obj.reference` | core | 10 | 7 |
| `js.obj.copy-shallow` | core | 8 | 5 |
| `js.obj.equality` | standard | 5 | 2 |
| `js.obj.const-mutation` | standard | 5 | 1 |
| `js.obj.keys-values-entries` | standard | 6 | 2 |
| `js.obj.for-in` | minor | 4 | 1 |
| `js.obj.in-optional-chaining` | standard | 8 | 6 |
| `js.obj.destructuring` | core | 10 | 6 |
| `js.arr.destructuring` | standard | 4 | 1 |
| `js.obj.spread` | core | 8 | 5 |
| `js.errors.throw` | standard | 5 | 1 |
| `js.errors.try-catch` | standard | 8 | 5 |
| `js.errors.finally` | minor | 3 | 2 |

모든 주 개념이 최솟값 이상이고, 개념 이해 유형·코드 이해 유형·실습 유형(버그 수정·구현·웹 실습)을 각각 1개 이상, L3 이상 문제를 1개 이상 가집니다(숙련 단계 게이트).

## 남은 한계와 후속 제안

1. **복습용 템플릿이 없습니다.** 이전 모듈들과 같은 상태입니다.
1. **객체 리터럴 문제는 우회를 완전히 막지 못합니다.** `impl-score-board`처럼 메서드가 든 객체를 만드는 문제는 숨김 입력으로 메서드를 부를 수 없습니다. 메서드 호출 결과를 관측하는 체크(예: `call` 체크의 메서드 경로)가 생기면 보강할 수 있습니다.
1. **시작 코드의 도우미 함수를 고치는 우회**(`impl-check-orders`의 `toQuantity`, `impl-checkout-wallet`의 `charge`)는 채점으로 막을 수 없습니다.
1. **한글 키 객체를 예측하는 문제는 쓰지 않는 편이 안전합니다.** 채점기의 리터럴 해석이 한글 식별자를 받지 않아, 학습자가 `{ 떡볶이: 5 }`처럼 따옴표 없이 쓰면 맞는 답도 오답이 됩니다. 지금 이 모듈에는 해당 문제가 없지만, 앞으로 쓸 때 주의가 필요하고 채점기 쪽에서 유니코드 식별자를 받는 것도 검토할 만합니다.
1. **`rubric` 필드를 아직 스키마가 받지 않습니다.** 난이도는 검토자가 루브릭으로 직접 계산했고, 근거는 이 기록에 남겼습니다.
