# 함수·배열·객체 단원 평가 AI 교차 검토 기록 (2026-11-15)

JS 기초 모듈 6·8·9의 단원 평가 단원 3개(문항 72개)를 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
검토 방법, 초안 작성자 메모에 대한 판단, 단원별로 고친 내용, 최종 구성과 남은 한계를 적습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-15
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [학습 엔진 설계 구현 메모 (v0.3)](/docs/design/learning-engine.md#구현-메모-v03), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [결정 기록](/docs/decisions.md) D-026~D-050, [모듈 7과 단원 평가 4개 검토](/docs/reviews/2026-11-15-m6-strings-and-assessments-review.md)

## 검토 범위와 방법

| 대상 | 문항 풀 | `itemCount` | 평가 개념 | 검토 방식 |
|---|---|---|---|---|
| `js-basics.functions.functions-review` 함수 단원 평가 | 24 | 20 | 18 | 전수 |
| `js-basics.arrays.arrays-review` 배열 단원 평가 | 24 | 20 | 18 | 전수 |
| `js-basics.objects.objects-review` 객체 단원 평가 | 24 | 20 | 17 | 전수 |

D-027 기준으로 단원 평가 문항은 전수 검토 대상입니다. 모듈 8·9·10의 연습 문제는 다른 검토자가 따로 검토하므로 고치지 않았고, 평가 문항이 연습 문제와 겹치는지 비교하는 데만 읽었습니다.

검토 절차:

1. 초안 작성 대화를 보지 않았습니다. 원본 파일, 설계 문서, 작성 가이드, 결정 기록, 이전 검토 기록, 초안 PR(#102)의 검토자 메모만 읽었습니다.
1. 시작할 때 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(문제 1035개, 예제 210개, 실패 0)을 직접 실행했습니다.
1. 72문항을 하나씩 [품질 체크리스트](/docs/design/content-and-exercises.md#품질-체크리스트-검토자용)로 확인했습니다. 특히 다음을 봤습니다.
   - **처음 보는 문제인지**: 같은 모듈의 연습 문제와 "같은 것을 같은 모양으로" 묻는 문항은 다시 썼습니다(아래 표).
   - 배우기 전 개념을 쓰지 않는지: 함수 평가는 모듈 7(문자열)·8(배열)보다 앞이라 나머지 매개변수의 `length`와 위치 번호만 씁니다. 객체 평가의 `this`는 레슨이 정한 범위(`객체.메서드()`로 부른 메서드 안의 `this.속성`) 안에 있어야 합니다.
   - 정답이 하나로 정해지는지, 오답 선택지와 `misconception` 연결이 맞는지, 해설이 선택지 글자를 가리키지 않는지, 참/거짓 진술이 인라인 코드만 쓰는지
   - 함수 작성형 문항에 숨김 `call` 체크가 있어 답을 그대로 적은 코드가 실패하는지
   - 풀이 방법 요구("화살표 함수로", "`reduce`로" 등)를 채점하는 것처럼 지문이 약속하지 않는지(`static` 체크는 서버 채점이 없음)
   - 난이도 표시가 [루브릭](/docs/design/content-and-exercises.md#난이도-루브릭) 합계와 맞는지, 평가 난이도 분포(10/30/35/20/5%)에 가까운지
1. 해설과 선택지의 실행 결과·오류 메시지를 Node 24 엄격 모드에서 직접 확인했습니다(나머지 매개변수 위치의 `SyntaxError`, `TypeError: half is not a function`, `TypeError: Assignment to constant variable.`, `TypeError: Cannot read properties of undefined (reading 'value')`, `["ab", "cde", "f"].reduce(...)`의 `ab31`, `0서론본론결론`, `slice(NaN)` 등). 예측 문제는 실행 검증(헤드리스 Chromium)이 기록한 기대값과 해설의 출력을 하나씩 대조했습니다.
1. 고친 뒤 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(실패 0)을 다시 실행하고, 바뀐 `content/.generated/predict-expected.json`을 함께 커밋했습니다.

### 검토자가 고친 문항의 2차 검토

검토자가 다시 쓰거나 고친 문항은 자기 승인을 피하려고 **분리된 컨텍스트의 2차 AI 검토자**에게 맡겼습니다. 2차 검토는 Node에서 출력과 줄 번호를 다시 계산하고, 연습 문제와 겹치는지, 레슨 범위를 넘는지를 따로 확인했습니다. 결과는 [2차 검토 결과](#2차-검토-결과)에 있습니다.

`draftedBy`는 스키마 형식에 따라 `ai:claude`로 두었습니다. 검토자가 고친 사실은 이 기록과 git 이력에 남습니다.

## 초안 작성자 메모에 대한 판단

| 메모 | 판단 |
|---|---|
| 함수 `predict-pick-style` 힌트 2가 꽤 직접적 | **완화했습니다.** "`pick`은 함수 자체를 돌려준다"는 핵심 추론을 그대로 말하던 문장을 "조건 연산자가 고르는 `quiet`, `loud`에 괄호가 붙어 있나요? 그렇다면 무엇을 돌려줄까요?"라는 질문으로 바꿨습니다. 오개념 연결도 고쳤습니다. `안녕!!!`이 두 번 나온다는 답은 `assign-call-result`와 관계가 없어 지웠고, 마지막 줄을 `string`으로 쓰는 답은 함수를 값으로 보지 못한 것이라 `function-not-a-value`로 바꿨습니다. 함수에서 함수를 돌려주고 바로 부르는 `pick(false)("잘 자")`는 레슨에 직접 나오지 않지만, "함수도 값이다"에서 이어지는 L4 전이 문제로 보고 유지했습니다. |
| 배열 `impl-pin-to-front`, `impl-initials`, `impl-rotate-duty`의 힌트 3이 메서드를 가리킴 | **유지합니다.** 셋 다 할 일("배열 두 개를 이어 새 배열을 만드는 메서드", "초기값을 빼면 첫 회차가 어떻게 되는지")을 말할 뿐 코드를 주지 않고, 다른 풀이(`slice()` 복사 뒤 `splice`·`unshift`, `for...of`)도 통합니다. 힌트 3은 "거의 답"까지 허용하는 정책(D-010)에 맞습니다. 평가 중에는 힌트가 잠깁니다. |
| 연습 문제와 가까운 문항 6개 | 문항마다 같은 모듈의 연습 문제와 비교했습니다(아래 표). 셋은 같은 것을 같은 모양으로 물어서 **다시 썼고**, 셋은 모양이 달라 **유지**했습니다. 검토 중에 메모에 없던 겹침 4개(배열 `predict-pack-bag`·`predict-rank-sort`, 객체 `mcq-sensor-rest`·`predict-level-check`)를 더 찾아 다시 썼습니다. |
| 오개념이 없는 배열 오답 2개(`multi-find-words`의 "못 찾으면 `undefined`" 선택지, `mcq-reduce-no-initial`의 "4") | **연결하지 않고 둡니다.** `multi-find-words`의 그 선택지는 "결과가 `"moon"`인 식"을 묻는데, 못 찾는 식을 고르는 이유는 `find-not-found-minus-one`(못 찾으면 `-1`)과 맞지 않습니다. "4"는 첫 요소를 건너뛴다고 본 계산이라 `reduce-initial-optional-safe`(초기값을 빼도 결과가 같다)와 다릅니다. 둘 다 `rationale`이 있습니다. |
| 객체 `impl-trip-label`의 오개념을 `destructuring-default-on-null`로 둠 | **바꿨습니다.** 이 문항이 잡는 실수는 `trip.nights \|\| 1`로 0이 1이 되는 것이고, 이는 `js.mc.or-default-keeps-zero`("`\|\|`로 기본값을 줄 때 0이 유지된다고 생각함")와 정확히 맞습니다. `misconceptions`를 바꾸고, 당일치기 숨김 체크에 `misconceptionIfFail`로 연결했습니다. 지문은 이미 "채점은 돌려준 문장으로만 해요"라고 밝힙니다. |
| 객체 `fill-plant-water`가 공유 메서드에서 `this`를 씀 | **다시 썼습니다.** 레슨은 "`this`가 정해지는 규칙은 부르는 방법에 따라 더 복잡해지며 심화 과정에서 다룬다, 이 과정에서는 `객체.메서드()`로 부르고 `this.속성`으로 자기 속성을 읽는다"고 범위를 정합니다. 다른 객체의 메서드를 빌려 쓰는 상황은 그 경계에 있어서, 같은 함수 `makePlant`가 만든 서로 다른 화분 두 개가 각자 `water`를 부르는 모양으로 바꿨습니다. `this.moisture`(정답), `moisture`(`ReferenceError`), `monstera.moisture`(선인장에 물을 줘도 몬스테라가 바뀜)를 가르는 점은 그대로입니다. 공장 함수의 매개변수 이름을 `plantName`, `start`로 해서 `moisture`라고만 쓰면 클로저가 아니라 `ReferenceError`가 나게 했습니다. |
| 객체 `impl-transfer-points`가 `structuredClone`으로도 통과 | **유지합니다.** 레슨 2(참조와 복사)가 `structuredClone`을 깊은 복사 방법으로 보여 주고, 해설도 정답으로 인정합니다. |
| 풀이 방법 요구는 채점하지 않음 | 지문이 방법을 "쓰세요"라고 요구하던 문항 5개(함수 `fill-repeat-apply`·`impl-rental-fee`·`impl-days-in-year`, 배열 `impl-longest-word`·`impl-initials`)를 "~로 해 보세요. 채점은 돌려준 값(실행 결과)으로만 해요"로 바꾸고, 다른 풀이도 통과한다고 해설에 적었습니다. 파슨스 `parsons-arrow-temp-label`은 조각이 화살표 함수뿐이라 실제로 방법이 정해져 있어 그대로 둡니다. |
| 풀 크기 경고(24개, 권장 10~20개) | 코드를 고치지 않는 작업이라 경고를 그대로 둡니다. 검사가 `itemCount`가 아니라 문항 풀을 보는 문제는 [남은 한계](#남은-한계)에 적었습니다. |

### 연습 문제와 겹치는지에 대한 판단

| 평가 문항 | 가까운 연습 문제 | 판단 |
|---|---|---|
| 함수 `predict-block-greeting` | `scope-basics.tf-sibling-blocks-same-name` | **다시 씀.** `if`/`else` 두 블록에 같은 이름의 `let`을 두고 출력하는 코드 모양이 연습 문제와 거의 같았습니다. 반복 본문에서 `let greeting;`을 값 없이 만들고 오전에만 대입하는 문제로 바꿨습니다. 블록 변수가 회차마다 새로 만들어져 `undefined`에서 시작한다는 점과 바깥 변수를 가린다는 점을 함께 봅니다(L2 → L3). |
| 함수 `find-bug-lives-typo` | `scope-basics.fix-undeclared-assign` | **유지.** 연습 문제는 선언을 빠뜨린 코드를 고치는 문제이고, 이 문항은 오타 하나가 엄격 모드 오류를 내는 줄과 원인을 고르는 문제라 모양이 다릅니다. 다만 증상에 `live is not defined`가 그대로 있어 줄을 바로 찾을 수 있었으므로, 증상을 "`ReferenceError`가 나고 `남은 목숨`이 한 줄도 나오지 않는다"로 바꾸고 힌트 1·2를 맞췄습니다. 그래도 추론이 짧아 L3 → L2로 내렸습니다. |
| 객체 `predict-shared-lamps` | `reference-vs-value.predict-alias-change`, `predict-equality-arrays` | **유지.** 같은 객체를 배열의 두 칸에 넣는 상황은 연습 문제에 없습니다. |
| 객체 `predict-camp-copy` | `reference-vs-value.predict-shallow-nested` | **다시 씀.** "전개로 복사 → 원시 값 바꾸기 → 안쪽 객체 고치기 → 출력과 `===`" 순서가 연습 문제와 같았습니다. 객체 배열을 `[...groups]`로 복사한 뒤 칸의 객체 고치기, 칸에 새 객체 넣기, `push`를 구별하는 문제로 바꿨습니다. |
| 객체 `mcq-sensor-rest` | `destructuring-and-spread.multi-destructure-facts`, `mcq-destructure-keeps-original` | **다시 씀.** 나머지로 모은 뒤 원본의 키 개수를 묻는 점이 연습 문제의 선택지와 같았습니다. 나머지로 모은 `reading`이 새 객체인지(고쳐도 원본이 그대로인지)와, 앞에서 꺼낸 속성이 나머지에 없는지를 묻도록 바꿨습니다. |
| 객체 `predict-level-check` | `error-handling.fix-orders-loop`(고친 코드), `predict-throw-in-function` | **다시 씀.** "반복 안의 `try`에서 오류를 던지는 함수를 부르고 합계를 낸다"는 모양이 연습 문제 `fix-orders-loop`의 정답 코드와 같았습니다. `try` 안의 세 호출 중 두 번째가 오류를 던질 때, 던지기 전의 부수 효과(시도 횟수)는 남고 세 번째 호출은 실행되지 않는다는 점을 묻도록 바꿨습니다. |
| 배열 `predict-pack-bag` | `array-mutation.predict-push-pop` | **다시 씀.** `push` 반환값·`pop` 반환값·남은 배열을 출력하는 모양이 연습 문제와 같았습니다. `while`과 `pop`으로 가방을 비우며 다른 배열에 옮기는 문제(순서가 뒤집힘, 원본이 빈 배열)로 바꿨습니다. |
| 배열 `predict-rank-sort` | `array-search-sort.predict-sort-same-array` | **다시 씀.** "`sort` 결과를 담고 `push`한 뒤 원본·길이·첫 요소를 출력"하는 모양이 같았습니다. `slice()`로 복사한 배열의 기본 정렬(사전순)과 원본의 숫자 정렬(같은 배열 반환)을 한 코드에서 비교하는 문제로 바꿨습니다. |
| 배열 `find-bug-water-plants`, `predict-levels-loops`, `predict-foreach-tickets`, `mcq-reduce-no-initial` | `fix-cart-total`, `predict-for-in-index`, `predict-foreach-return`, `multi-reduce-initial` | **유지.** 같은 개념의 대표 실수를 다루지만 유형과 상황, 묻는 것이 다릅니다(예: `reduce`의 초기값 생략을 문자열 이어 붙이기 `ab31`로 묻기). |

## 단원별로 고친 내용

### 함수 단원 평가 (`functions-review`)

평가 개념 18개가 모두 주 개념으로 나옵니다. 함수 평가는 문자열·배열보다 앞이라 쓰는 문법이 그 범위 안인지 확인했습니다.

- `predict-block-greeting`: 다시 씀(위 표).
- `find-bug-lives-typo`: 증상과 힌트, 난이도(위 표).
- `predict-pick-style`: 힌트 2 완화, 오개념 연결 정리, 해설에 `string` 오답 설명 추가.
- `multi-which-return-ten`: `missedMisconception: code-after-return-runs`가 `return n + 5; console.log(...)` 선택지에 있었습니다. 이 선택지는 `return` 뒤 코드가 실행된다고 믿어도 결과가 10이라 놓칠 이유가 없습니다. `if (n > 3) { return 10; } return 0;` 선택지(뒤의 `return 0`이 덮어쓴다고 보면 놓침)로 옮기고 해설에 한 문장을 더했습니다.
- `fix-weather-report`: 체크가 출력과 `noError`뿐이라 기대 출력 두 줄을 `console.log`로 적으면 통과했습니다. `entry: toFahrenheit`와 숨김 `call` 체크 2개(섭씨 10도 → 50, -40도 → -40)를 더하고, 이름을 바꾸지 말라는 안내를 지문에 넣었습니다. 함수 선언으로 바꾸는 풀이도 그대로 통과합니다.
- `fill-repeat-apply`, `impl-rental-fee`, `impl-days-in-year`: 방법 요구 문구(위 표).

### 배열 단원 평가 (`arrays-review`)

평가 개념 18개가 모두 주 개념으로 나옵니다. 입력을 바꾸면 안 되는 문항은 모두 `argsUnchanged`(필요하면 `returnsNewReference`)로 확인합니다.

- `predict-pack-bag`, `predict-rank-sort`: 다시 씀(위 표).
- `impl-longest-word`, `impl-initials`: 방법 요구 문구(위 표).
- `fill-light-ends`는 `entry`가 없어 숨김 `call` 체크를 둘 수 없지만(함수가 값을 돌려주지 않고 인수를 바꿈), 길이가 다른 두 배열로 출력을 확인해 숫자를 직접 쓴 답은 실패합니다. 그대로 둡니다.

### 객체 단원 평가 (`objects-review`)

평가 개념 17개가 모두 주 개념으로 나옵니다.

- `fill-plant-water`, `predict-camp-copy`, `mcq-sensor-rest`, `predict-level-check`: 다시 씀(위 표).
- `impl-trip-label`: 오개념 연결(위 표).
- `predict-range-order`: 중괄호 없는 한 줄 `if`(`if (n < low) low = n;`)는 레슨에서 쓰지 않는 모양이라 중괄호를 붙였습니다. 힌트가 가리키는 줄 번호(11 → 15)도 맞췄습니다.

## 2차 검토 결과

1차 2차 검토는 고친 18문항 가운데 13문항을 승인하고 5문항에 수정을 요청했습니다. 요청을 모두 반영한 뒤 다시 맡겨 7문항(수정 요청 5개와 연결만 더한 2개)을 모두 승인받았습니다.

| 문항 | 요청 | 반영 |
|---|---|---|
| 배열 `predict-pack-bag` | 첫 다시 쓰기도 `const count = bag.push(...)`를 출력해 연습 문제 `predict-push-pop`과 같은 모양이 남았고, 목록의 `pop-returns-rest`에 연결된 답이 없음 | `push` 반환값을 빼고, 물건이 3개인 가방에서 `pop`을 **네 번** 하게 바꿈. 마지막 `pop`은 빈 배열이라 `undefined`가 정리함에 들어감(레슨 2가 가르치지만 연습 문제는 묻지 않음). 배열이 쌓인다고 본 답을 `pop-returns-rest`에 연결 |
| 객체 `predict-level-check` | 첫 다시 쓰기의 중심(`try` 안 세 문장 중 가운데가 실패, 다음 줄로 이어짐)이 연습 문제 `predict-try-resume`과 같음 | `catch`가 그 순간의 시도 횟수를 출력하고 3단계를 대신 플레이하게 바꿈. 던지기 전 부수 효과가 되돌아가지 않는 점이 출력에 바로 드러남 |
| 객체 `predict-camp-copy` | `3 10 9 / true true` 답을 `array-assign-copies`(대입하면 복사된다)에 연결했는데 반대 믿음임 | `copy-equals-original`로 바꿈 |
| 함수 `predict-block-greeting` | 모든 줄이 `좋은 아침이에요`인 답은 두 오류가 섞여 있어 `shadow-changes-outer` 하나로 볼 수 없음 | 그 답의 연결을 지움 |
| 함수 `find-bug-lives-typo` | 원인 선택지 c3가 스스로 모순("`live`가 생기는데 `lives`를 출력해서 오류"), 힌트 1이 찾는 방법을 다 말함 | c3를 "전역 변수가 생길 뿐 오류가 아니고 오류는 두 번째 호출에서 났다"로 바꾸고 힌트 1을 질문으로 완화 |
| 객체 `mcq-sensor-rest`(선택) | 오답 두 개에 맞는 오개념이 있음 | `30 undefined 80` → `spread-mutates-original`, `21.5 80 80` → `rest-includes-named` |

절차 메모: 재검토가 끝나기 전에 작업 사본에서 72문항의 `review` 필드를 `approved`로 먼저 바꿔 두었습니다(2차 검토자가 지적). 재검토가 7문항을 모두 승인한 뒤에 커밋했으므로 승인 기록은 2차 검토 결과와 어긋나지 않습니다. 다음 검토부터는 재검토가 끝난 뒤에 상태를 바꿉니다.

2차 검토는 `fix-weather-report`에서 출력만 직접 적고 빠진 `return`만 고친 답은 콜백 괄호 버그를 고치지 않아도 통과한다고 짚었습니다. 함수 자체는 바르게 고쳐진 것이라 받아들였습니다.

## 앱에서 평가 응시

최종 원본을 `content:build --include-drafts`로 빌드하고, 프로덕션 서버를 `PROGINONE_PORT=4605`, 새 임시 데이터 폴더, 모의 AI로 띄웠습니다.
Playwright 스크립트가 평가마다 "단원 평가 보기 → 평가 시작 → 문항마다 YAML의 참조 정답 입력 → 확실해요 → 다음 문제 → 종료 화면"을 두 번씩 진행했습니다. 참조 정답은 선택형은 `correct`, 예측은 실행 검증의 기대값, 빈칸은 첫 `accept`, 파슨스는 정답 순서, 코드 문제는 `solution`입니다.

| 평가 | 1회차 | 재응시 | 재응시에 새로 나온 문항 |
|---|---|---|---|
| 함수 | 20문항 중 20문항 정답 | 20/20 | 4개 (두 번으로 24문항 모두 풂) |
| 배열 | 20/20 | 20/20 | 4개 (24문항 모두) |
| 객체 | 20/20 | 20/20 | 4개 (24문항 모두) |

- 시작 화면에 20문항이 표시됐고, 종료 화면에 "단원 평가를 통과했어요", 개념별 결과, 문항별 정답과 해설이 나왔습니다.
- 여섯 번의 종료 화면 모두 해설 20개가 비어 있지 않았고, 해설 영역에 렌더링되지 않은 Markdown 기호(백틱, `**`)가 남지 않았습니다.
- 콘솔 오류는 0건이었습니다.
- 다시 쓴 문항과 체크를 더한 `fix-weather-report`도 이 응시에서 앱 러너로 정답 처리됐습니다.

## 최종 구성

72문항을 모두 승인했습니다(`review: { status: approved, draftedBy: ai:claude, reviewedBy: ai:reviewer }`). `draft`로 남긴 문항은 없습니다.

| 단원 | 문항 풀 | L1 | L2 | L3 | L4 | L5 | 유형 | 문항이 2개인 개념 |
|---|---|---|---|---|---|---|---|---|
| `functions-review` | 24 | 2 (8%) | 7 (29%) | 9 (38%) | 5 (21%) | 1 (4%) | 9종(예측 6) | arrow, declaration, hoisting, rest-params, return, scope.block |
| `arrays-review` | 24 | 2 (8%) | 8 (33%) | 9 (38%) | 4 (17%) | 1 (4%) | 9종(함수 구현 7) | for-of, map, mutating-vs-not, push-pop, reduce, sort |
| `objects-review` | 24 | 2 (8%) | 7 (29%) | 9 (38%) | 5 (21%) | 1 (4%) | 9종(예측 8) | copy-shallow, destructuring, dot-bracket, literal, reference, spread, try-catch |

- 목표 분포는 단원 평가 10/30/35/20/5%이고, 24문항 기준으로 세 단원 모두 1문항 이내로 맞습니다. 함수 평가는 `predict-block-greeting`(L2 → L3)과 `find-bug-lives-typo`(L3 → L2)를 바꿔 분포가 그대로입니다.
- 평가 개념(18·18·17개)은 모두 1문항 이상에서 주 개념이고, `itemCount: 20`이 개념 수보다 커서 응시할 때마다 모든 개념이 나옵니다.
- 한 유형이 50%를 넘는 단원은 없습니다.

## 남은 한계

- **풀 크기 경고**: `content:check`는 평가 단원의 문항 풀이 10~20개인지 봅니다. 재응시용 문항을 더한 세 단원(24개)은 항상 경고가 납니다. 검사를 `itemCount` 기준으로 바꾸는 것은 코드 작업으로 남깁니다.
- **재응시 때 달라지는 문항은 4개 안팎입니다.** 학습 엔진은 개념마다 한 문항을 먼저 고르므로, 문항이 하나뿐인 개념은 재응시 때도 같은 문항이 나옵니다.
- **풀이 방법은 강제할 수 없습니다.** `static` 체크는 서버 채점이 없습니다. 방법을 권하는 문항은 지문이 "채점은 결과로만 한다"고 밝힙니다. 그래서 `reduce`를 주 개념으로 하는 `impl-initials`를 `for...of`로 풀어도 `reduce` 개념의 정답 증거가 됩니다.
- **인수를 바꾸는 함수는 숨김 `call` 체크로 확인할 수 없습니다.** `call` 체크에는 "호출 뒤 인수의 상태"를 기대하는 형식이 없어서 `fill-light-ends`는 출력으로만 채점합니다.
