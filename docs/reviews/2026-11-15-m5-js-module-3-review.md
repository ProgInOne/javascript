# JS 기초 모듈 3 콘텐츠 AI 교차 검토 기록 (2026-11-15)

JS 기초 모듈 3 "연산자와 형 변환"(레슨 6개, 문제 134개)을 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
검토 방법, 단원별 판단, 직접 고친 내용, 최종 문제 구성과 남은 한계를 적습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-15
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [결정 기록](/docs/decisions.md), [v0.1 콘텐츠 검토](/docs/reviews/2026-11-15-v0.1-content-review.md)

## 검토 범위와 방법

대상은 `content/courses/js-basics/modules/03-operators/`의 레슨 본문과 문제 전부, 그리고 이 모듈 개념 18개(`content/concepts/js.yaml`)와 오개념 38개(`content/misconceptions/js.yaml`)입니다.
모든 문제가 `review.status: draft`, `draftedBy: ai:claude`였습니다.

| 단원 | 중요도 | 목표 문제 수 |
|---|---|---|
| `arithmetic` 산술 연산 ★ | core | 22 |
| `comparison` 비교 연산 ★ | core | 24 |
| `logical` 논리 연산 ★ | core | 24 |
| `explicit-conversion` 명시적 형 변환 | standard | 20 |
| `implicit-coercion` 암묵적 형 변환 ★ | core | 26 |
| `operators-review` 단원 평가 | assessment | 18 |

D-027 기준으로 레슨 본문, 핵심 단원 문제, 단원 평가 문제는 전수 검토 대상입니다.
`explicit-conversion`은 샘플링 대상이지만 20문제뿐이라 **모든 문제를 전수 검토**했습니다.

검토 절차:

1. 초안 작성 대화를 보지 않고, 원본 파일과 설계 문서·작성 가이드·결정 기록(D-026~D-039)만 읽었습니다.
1. 검토 시작 전에 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(실패 0)을 직접 실행했습니다.
1. 레슨마다 [품질 체크리스트](/docs/design/content-and-exercises.md#품질-체크리스트-검토자용)의 레슨 항목, 표준 12섹션, 개념 중요도별 깊이, 선수 개념 순서(모듈 1·2와 앞 단원만 사용), 엄격 모드(D-026)와의 일관성을 확인했습니다.
1. 문제마다 체크리스트의 문제 항목을 확인했습니다. 특히 다음을 봤습니다.
   - 정답이 하나로 확정되는지, 체크가 동등한 다른 정답을 모두 받아들이고 시작 코드는 실패하는지
   - 오답 선택지와 `misconception` 연결이 실제 오개념과 같은 방향인지
   - 힌트 3단계가 정답 전체를 주지 않는지
   - 해설이 정답의 이유와 오답마다의 이유를 설명하는지
   - 난이도가 루브릭 합계(개념 수·추론·구현량·함정)와 맞는지
1. **형 변환·비교 규칙 주장을 모두 실행해 확인했습니다.** 레슨과 해설의 결과(`"10" < "9"`, `null == 0`, `"0" == false`, `Number("")`, `parseInt("3.9")`, `Boolean(" ")`, `1 + 2 + "3"`, `"abc" - 1` 등)를 Node 24 엄격 모드와 헤드리스 Chromium(엄격 모드 스크립트)에서 실행했습니다. 오류 문구는 D-030에 따라 Chromium 결과로 확인했습니다.
1. `fix_bug`의 `maxEditDistance`를 러너와 같은 토큰 편집 거리(`packages/exercise-kit/src/common/edit-distance.ts`)로 계산해, 참조 정답과 해설이 인정하는 다른 풀이가 "새로 쓰지 마세요" 감점을 받지 않는지 확인했습니다.
1. `pnpm content:build:dev`로 빌드하고 앱(`PROGINONE_PORT=4490`, 임시 데이터 폴더)을 띄워 레슨 6개를 Playwright로 캡처했습니다. 1280px·390px에서 미렌더링 Markdown, 넘치는 요소, 콘솔 오류를 자동 검사했습니다.
1. 수정 뒤 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(문제 345개, 예제 75개, 실패 0)을 다시 실행했습니다.

### 검토자가 직접 쓴 문제의 2차 검토

검토자가 다시 쓴 15문제(단원 평가 14개, `arithmetic.mcq-postfix-prefix` 1개)는 자기 승인을 피하려고 **분리된 컨텍스트의 2차 AI 검토자**에게 다시 검토하게 했습니다.
2차 검토는 15문제를 모두 승인하고 3문제를 고쳤습니다.

- `operators-review.tf-loose-converts`: 해설이 오개념 `loose-equals-like-strict`("`==`도 자료형을 비교한다")와 다른 방향의 오답 이유만 다뤘음 → 두 방향의 잘못된 생각을 모두 설명하고 `"5" == 5` 예를 추가
- `operators-review.fix-member-discount`: 출력 줄만 `(discountB || 0)`으로 고치면 출력 체크는 통과하지만 숨김 값 체크에서 실패함 → 체크는 그대로 두고, 지문에 "할인 변수(`discountA`, `discountB`)가 숫자를 갖도록" 고치라고 명시
- `operators-review.impl-pack-boxes`: 힌트 2의 인과가 거꾸로였음 → "나눗셈은 소수점을 버리지 않아서 `cookies / perBox`는 4.5예요"로 정정

`draftedBy`는 스키마 형식에 따라 `ai:claude`로 두었습니다. 이 15문제를 검토자가 썼다는 사실은 이 기록과 git 이력에 남습니다.

## 단원별 검토 요약

### js-basics.operators.arithmetic ★

레슨과 문제 22개를 승인했습니다.
핵심 개념 기준(원리 2관점: 단계별 줄이기·보이지 않는 괄호, 값 추적 표, 예제 5개 중 예측 4개, 오개념 10개 모두 `<Pitfall>`, 실전 사례, 확인 문제 4개)을 충족합니다.

- 레슨: "친구 다섯 명과 피자를 시켰어요"가 본인 포함 6명으로 읽혀, 5명이 나누는 `impl-split-pizza-bill`과 어긋남 → "친구들과 다섯 명이서"로 고침.
- 개념 `js.ops.precedence` 요약이 괄호를 맨 뒤에 말하고 문장이 어색했음 → "괄호 → 거듭제곱 → 곱셈·나눗셈·나머지 → 덧셈·뺄셈, 같으면 왼쪽부터(거듭제곱끼리만 오른쪽부터)"로 다시 씀.
- `mcq-postfix-prefix`(레슨 확인 문제): 코드가 바로 앞 레슨 예제 5와 글자까지 같아 기억만으로 풀렸음 → `a = 3; b = ++a; c = a++`로 바꾸고 선택지·힌트·해설을 다시 씀(검토자 작성, 2차 검토 승인).
- 오개념 연결 오류 4건(반대 방향이거나 무관): `tf-expression-changes-variable` r2(`log-is-return`), `mcq-remainder-meaning` d와 `find-bug-candy-share` c3(`division-truncates`, 둘 다 반대 방향), `mcq-postfix-prefix` x3. `parsons-visitor-count`의 방해 줄 `let visitors = visitors - 1;`에는 `let-again-to-change`를 연결.
- `impl-seconds-to-time`: 힌트 1이 핵심 기법을 바로 줌 → 레슨의 "135초 → 2:15" 사례를 떠올리게 하고 기법은 힌트 2로 옮김.
- `maxEditDistance` 완화: `fix-cafe-orders` 10 → 20(해설이 권하는 다른 풀이의 거리가 18), `fix-reversed-compound` 6 → 12, `fix-average-and-rate` 6 → 10, `fix-game-score` 6 → 8.

**소수 계산 허용 범위(초안 작성자 메모 확인).** 값 체크(`program`)는 `closeTo`(epsilon 1e-6)라 `* 0.9`, `* 1.1` 같은 풀이의 부동소수 오차를 흡수합니다. 의도된 설계가 맞습니다.
다만 출력 체크(`console`)는 문자열 정확 비교라 더 엄격합니다. 이 단원의 숫자로는 흔한 다른 풀이(`61300 * 1.1`, `67430 * 0.2`, `39000 * 0.9 + 2500`, `22500 * 0.9`, `22500 - 22500 / 10`, `18 / 20 * 100` 등)가 Chromium에서 모두 정수로 떨어져 출력 체크도 통과합니다.
`22500 * 1.1`(= `24750.000000000004`)처럼 오차가 출력에 드러나는 값은 쓰이지 않습니다. 숫자를 바꿀 때는 이 확인을 다시 해야 합니다.

### js-basics.operators.comparison ★

레슨과 문제 24개를 승인했습니다.
핵심 개념 기준(두 관점, 값 추적 표, 예제 5개 중 예측 3개, 오개념 7개 모두 `<Pitfall>`, 실전 사례, 확인 문제 4개)을 충족합니다.
`==`·문자열 비교·NaN 결과와 `TypeError: Assignment to constant variable.`, `=<`의 `SyntaxError: Unexpected token '<'`를 Chromium에서 확인했습니다.

- 레슨: 다섯 번째 예제 안내가 "2번 줄과 3번 줄"이었지만 비교하는 줄은 3·4번 → 고침. "그래서 `===`를 일치 연산자라고"의 어색한 접속 정리.
- 레슨: NaN이 들어간 `<`·`>`·`<=`·`>=`가 모두 `false`라는 문장을 추가했습니다(단원 평가 검토에서 빠진 점으로 확인).
- `predict-relational-basics`: 해설이 실제로 `true`인 2번 줄(`age >= 13`)을 오답처럼 설명 → "`age > 13`도 `true`라고 답했다면"으로 정정.
- 힌트 3이 정답 줄을 그대로 주던 5문제 완화: `predict-relational-basics`, `impl-quiz-answer`, `impl-loose-strict-pair`, `impl-missing-values`, `impl-score-compare`.
- `tf-chained-comparison`: 해설이 학습자에게 보이지 않는 이유 ID("r1")를 씀 → 이유 문장을 인용하고 오답 이유 2개의 설명 추가. `find-bug-nan-check`: 오답 원인 선택지의 설명 추가.
- `maxEditDistance` 완화: `fix-order-check` 8 → 10(참조 정답이 정확히 8), `fix-ticket-checker` 12 → 14.
- 개념·오개념 항목은 정확해 고치지 않았습니다. `js.mc.assign-as-compare`와 모듈 4 `assign-in-condition`의 정리는 다른 검토자의 범위라 손대지 않았습니다.

### js-basics.operators.logical ★

레슨과 문제 24개를 승인했습니다.
핵심 개념 기준(진리표와 "값을 고르는 연산자" 두 관점, 계산 순서 표, 예제 5개 모두 예측형, 오개념 7개 모두 `<Pitfall>`, 실전 사례, 확인 문제 4개)을 충족합니다.
truthy·falsy는 05단원보다 먼저 나오지만, 레슨이 필요한 만큼(falsy 6개, `"0"`·`"false"`는 truthy) 그 자리에서 설명하고 05단원으로 연결해 괜찮습니다.

- **`??`와 `||` 혼용 `SyntaxError` 확인(D-030).** Chromium 엄격 모드에서 `const name = savedName ?? "익명" || "손님";`은 `SyntaxError: Unexpected token '||'`이 맞습니다(`a || b ?? c` → `Unexpected token '??'`, `a ?? b && c` → `Unexpected token '&&'`). 그러나 같은 식을 `console.log(a ?? b || 5)`처럼 호출 괄호 안에 쓰면 Chromium은 `missing ) after argument list`를 냅니다. 레슨에 "오류 설명은 코드 모양에 따라 달라질 수 있고, 원인은 같다"는 안내를 추가해 한 문구만 약속하지 않게 했습니다. `fix-settings-bugs`의 버그 코드는 실제로 `Unexpected token '||'`를 내므로 문제 설명은 그대로 맞습니다.
- 레슨: 단락 평가 비유가 "회로가 끊긴다"였음 → 단락은 전류가 지름길로 빠지는 것이라 고침.
- 레슨·`mcq-or-returns-value`: "결과가 `true`/`false`인 건 양쪽에 `true`/`false`를 넣었을 때뿐"은 틀림(`0 || false` → `false`, `true && 5` → `5`) → "결과가 `true`/`false`라면 고른 쪽 값이 원래 `true`/`false`였기 때문"으로 정정.
- 레슨·`fix-not-precedence`: `!age >= 19`에서 `false >= 19`가 왜 `false`인지(`false`가 0으로 바뀌어 `0 >= 19`) 설명 추가.
- `predict-nullish-mix`: 어떤 오개념으로도 나오지 않는 `misconceptionByAnswer` 항목 삭제.
- `maxEditDistance` 완화: `fix-guest-name` 4 → 6(참조 정답이 정확히 4), `fix-settings-bugs` 8 → 10.

### js-basics.operators.explicit-conversion

레슨과 문제 20개를 승인했습니다.
일반 개념 기준(예제 4개 모두 예측형, 오개념 6개 모두 `<Pitfall>`, 확인 문제 2개, 실전 사례)을 충족합니다.
변환 결과(`Number("   ")` → 0, `Number(null)` → 0, `Number(undefined)` → NaN, `Number("1,500")` → NaN, `parseInt("")` → NaN, `String(null)` → `"null"`, `Boolean("0")` → `true` 등)를 모두 실행해 확인했고 틀린 값은 없었습니다.

- 레슨: `Number(...)` 등을 함수라고 소개하지 않고 바로 썼고 "돌려준다"도 설명이 없었음(함수는 모듈 6) → 원리 섹션 앞에 "미리 들어 있는 함수이고, `console.log`처럼 괄호 안에 값을 넣어 부르면 결과를 돌려준다, 직접 만드는 법은 모듈 6"을 추가.
- 레슨: Number 표의 `Number(null)`·`Number(undefined)` 이유 칸이 비어 있었음 → 채움. 공백만 있는 문자열도 0이 된다는 점 추가.
- 레슨·`multi-nan-facts`: "NaN과 계산한 결과는 계속 NaN"은 지나친 일반화(`NaN + "원"`은 `"NaN원"`) → "NaN으로 숫자 계산을 하면"으로 고침. `multi-nan-facts`의 `misconceptions`에 빠진 `nan-equals-nan` 추가.
- 힌트 3이 정답 코드를 그대로 주던 4문제 완화: `fix-boolean-string`, `impl-convert-inputs`, `impl-label-text`, `impl-order-form`.
- `fix-string-of-null`: 해설의 `||`·`??` 비교 문장을 다듬고, `maxEditDistance` 4 → 6(`String`을 빼고 `memo ?? ""`로 쓰는 풀이도 허용).
- 체크가 다른 정답(`isNaN(x)`, `x !== x`, 단항 `+`, `parseFloat`, `!!`)도 받아들이는 것을 확인했습니다.

### js-basics.operators.implicit-coercion ★

레슨과 문제 26개를 승인했습니다.
핵심 개념 기준(규칙표와 한 단계씩 따라가기 두 관점, 단계 표 4개, 예제 5개 중 예측 3개, 오개념 8개 모두 `<Pitfall>`, 실전 사례, 확인 문제 4개)을 충족합니다.

- **`==` 규칙 정밀화.** "`null`은 `undefined`와만 같아요"는 `null == null`도 `true`라 부정확 → 레슨 규칙, `<Pitfall>`, 요약, 개념 `js.conv.equality-coercion` 요약, 오개념 `null-loose-equals-zero`의 `reality`를 "`null`과 `undefined`는 숫자로 바뀌지 않고 서로(그리고 자기 자신)와만 같다"로 고침.
- `[]`(배열, 모듈 8)는 "빈 목록" 설명과 함께 커리큘럼 표의 대표 오개념으로만 다뤄 유지했습니다.
- 오개념 연결 오류 4건: `find-bug-zero-score` c2·c3(무관한 오개념 2개 삭제), `tf-minus-string` r3(`failed-conversion-throws` → `minus-string-fails`), `parsons-receipt` d2(반대 방향 삭제).
- `mcq-empty-list`: 쓰지 않는 부 개념 `js.ops.short-circuit` 삭제.
- 힌트 3이 정답을 주던 4문제 완화: `multi-falsy-values`, `predict-double-not`, `multi-loose-rules`, `find-bug-space-zero`.
- `impl-count-filled`, `impl-checkout-text`: 채점할 수 없는 "값을 직접 쓰지 말고"를 필수처럼 말함 → "계산해 보세요"로 완화(v0.1 검토 기준과 같음).
- `fix-entered-zero`: `maxEditDistance` 6 → 8(해설이 인정하는 `ageText !== ""` 풀이).
- 오개념 보충 문제 정리: `minus-string-fails` → `tf-minus-string`, `predict-chain-typeof`. `loose-equality-uses-truthiness` → `multi-loose-rules`, `fix-empty-check`.
- `web-calculator`: DOM 코드(값 읽기·화면 쓰기)는 모두 주어지고 계산 줄만 고치게 되어 있어 모듈 10 전에도 범위 안입니다.

### js-basics.operators.operators-review (단원 평가)

레슨과 문제 18개를 승인했습니다.

- **중복이 많았습니다.** 18문제 중 14문제가 앞 단원 문제와 거의 같거나 한 단원 개념만 다뤘습니다. 예:
  - `multi-falsy-values`: implicit `multi-falsy-values`와 선택지 6개 중 5개, 정답 집합까지 같음
  - `fill-nullish-settings`: logical `fix-volume-zero`와 같은 상황(음량 0, 속도 `null`, 기본값 50·1)
  - `fix-display-name`: logical `fix-guest-name`과 같은 값(`""`/`"민지"`/`"손님"`)과 같은 수정(`&&` → `||`)
  - `fix-width-px`: explicit `find-bug-nan-source`와 같은 `"120px"` → `parseInt`
  - `predict-increment-values`: arithmetic `mcq-postfix-prefix`와 같은 코드 구조
  - `impl-score-report`: arithmetic `fix-average-and-rate`와 같은 세 과목 평균

  14문제를 두 단원 이상의 개념을 섞는 문제로 다시 썼습니다(예: 증감과 `===`, `-`와 `>`를 같은 문자열 쌍에 써서 대비, 팁 0원은 `??`·빈 요청 사항은 `||`, `parseInt("3.5km")`와 `+= "4km"` 두 버그). 다시 쓴 문제는 모두 2차 검토를 거쳤습니다.
- **ID 변경 3건.** 내용이 완전히 바뀌어 원래 이름이 틀린 뜻이 된 문제입니다. 모두 초안(빌드에 들어간 적 없음)이라 학습 기록이 없고, 다른 곳에서 참조하지 않음을 확인했습니다.
  - `fix-width-px` → `fix-run-distance`
  - `fix-display-name` → `fix-member-discount`
  - `impl-score-report` → `impl-trip-budget`
- 원본 결함: `predict-increment-values`의 오답 해설("5 6 7")이 틀렸고, `fill-nullish-settings`는 두 번째 빈칸에 `||`도 통과하는데 해설은 "둘 다 `??`"라고 했습니다. 다시 쓰면서 빈칸마다 답이 하나로 정해지게 했습니다.
- `impl-ride-rules`: A 손님이 두 규칙을 모두 만족하도록 바꿔 `||`가 "둘 중 하나만"이 아님을 실제로 보여 주게 함. 괄호 없이 써도 결과가 같아 일어날 수 없는 `misconceptionIfFail` 연결 삭제.
- 레슨: 요약에 "산술 → 비교 → `&&`·`||`" 우선순위 한 문장 추가(`predict-precedence-mix`가 이 규칙을 씀).
- 18개 주 개념이 각각 정확히 1문제씩 주 개념으로 나옵니다(개념당 최소 1).

## 최종 문제 구성

승인된 문제 134개, 미승인 0개입니다. 단원별 승인 수는 `practice.targetCount`와 같습니다.

### 유형 범주 (JS 목표: 개념 확인 25 · 코드 이해 25 · 디버깅 20 · 구현 20 · 응용 10, ±10%p)

| 단원 | 개념 확인 | 코드 이해 | 디버깅 | 구현 | 응용 (L4+) |
|---|---|---|---|---|---|
| arithmetic (22) | 6 (27%) | 6 (27%) | 3 (14%) | 3 (14%) | 4 (18%) |
| comparison (24) | 7 (29%) | 7 (29%) | 3 (13%) | 5 (21%) | 2 (8%) |
| logical (24) | 7 (29%) | 7 (29%) | 3 (13%) | 3 (13%) | 4 (17%) |
| explicit-conversion (20) | 5 (25%) | 5 (25%) | 4 (20%) | 4 (20%) | 2 (10%) |
| implicit-coercion (26) | 8 (31%) | 8 (31%) | 3 (12%) | 3 (12%) | 4 (15%) |
| operators-review (18) | 5 (28%) | 6 (33%) | 2 (11%) | 2 (11%) | 3 (17%) |

모든 단원이 범주별 목표 ±10%p 안입니다. 응용은 L4 이상의 `fix_bug`·`implement_function`·`web_task`로 셌습니다.

### 유형별 수

| 단원 | mcq_single | mcq_multi | true_false | predict_output | fill_blank | parsons | find_bug_line | fix_bug | implement_function | web_task |
|---|---|---|---|---|---|---|---|---|---|---|
| arithmetic | 3 | 1 | 2 | 3 | 1 | 1 | 1 | 5 | 4 | 1 |
| comparison | 3 | 2 | 2 | 3 | 1 | 1 | 2 | 5 | 5 | |
| logical | 4 | 1 | 2 | 4 | 1 | 1 | 1 | 4 | 6 | |
| explicit-conversion | 2 | 1 | 2 | 2 | 1 | 1 | 1 | 5 | 5 | |
| implicit-coercion | 4 | 2 | 2 | 4 | 1 | 1 | 2 | 5 | 4 | 1 |
| operators-review | 2 | 1 | 2 | 3 | 1 | 1 | 1 | 4 | 3 | |

모든 단원이 유형 9종 이상이고, 한 유형이 25%를 넘지 않습니다.

### 난이도

| 단원 | L1 | L2 | L3 | L4 | L5 | 목표 (L1/L2/L3/L4/L5) |
|---|---|---|---|---|---|---|
| arithmetic | 3 (14%) | 11 (50%) | 4 (18%) | 4 (18%) | 0 | 15 / 30 / 30 / 20 / 5 |
| comparison | 4 (17%) | 12 (50%) | 6 (25%) | 2 (8%) | 0 | 15 / 30 / 30 / 20 / 5 |
| logical | 6 (25%) | 7 (29%) | 7 (29%) | 4 (17%) | 0 | 15 / 30 / 30 / 20 / 5 |
| explicit-conversion | 3 (15%) | 10 (50%) | 5 (25%) | 2 (10%) | 0 | 20 / 35 / 30 / 15 / 0~5 |
| implicit-coercion | 5 (19%) | 7 (27%) | 10 (38%) | 4 (15%) | 0 | 15 / 30 / 30 / 20 / 5 |
| operators-review | 1 (6%) | 5 (28%) | 9 (50%) | 2 (11%) | 1 (6%) | 10 / 30 / 35 / 20 / 5 |

**난이도는 초안에서 일관되게 높게 표시되어 있었습니다.** 루브릭 합계로 다시 계산해 23문제를 내렸고, 올린 문제는 1개입니다(단원 평가의 다시 쓴 문제는 새로 계산).

| 단원 | 내린 문제 (전 → 후) |
|---|---|
| arithmetic | `multi-precedence-eighteen` 3→2, `find-bug-candy-share` 3→2, `fix-reversed-compound` 3→2, `fix-cafe-orders` 5→4 |
| comparison | `fix-assign-compare`·`find-bug-nan-check`·`fix-point-type`·`impl-missing-values` 3→2, `impl-score-compare`·`impl-ride-check` 4→3, `fix-ticket-checker` 5→4 |
| logical | `tf-or-both-true`·`mcq-nullish-volume` 2→1, `predict-and-returns-zero`·`fix-guest-name` 3→2, `predict-nullish-mix` 4→3, `fix-settings-bugs` 5→4 |
| explicit-conversion | `fix-parseint-decimal`·`fix-nan-check-equality` 3→2 (`multi-nan-facts`는 함정 3개라 1→2로 올림) |
| implicit-coercion | `mcq-empty-list` 2→1, `predict-chain-typeof`·`predict-loose-rules` 4→3, `fix-saved-settings` 5→4 |

단원 평가를 뺀 네 단원의 초안 L5 4문제("버그 세 개" 종합 수정 문제)는 배운 버그의 조합이지 새로운 상황으로의 전이가 아니어서 모두 L4(루브릭 합 8~9)로 내렸습니다.
그래서 단원 평가를 뺀 다섯 단원에 L5가 없고, 세 단원은 L2가 50%입니다. 목표 분포에 맞추려고 올리지는 않았습니다.

### 주 개념별 수 (최소: JS core 6 · standard 4 · minor 3)

| 개념 | 중요도 | 문제 수 | L3 이상 |
|---|---|---|---|
| `js.ops.arithmetic` | core | 6 | 3 |
| `js.ops.precedence` | standard | 4 | 2 |
| `js.ops.remainder` | standard | 4 | 1 |
| `js.ops.compound-assignment` | standard | 4 | 1 |
| `js.ops.increment` | standard | 4 | 1 |
| `js.ops.strict-equality` | core | 9 | 2 |
| `js.ops.loose-equality` | standard | 6 | 1 |
| `js.ops.relational` | core | 9 | 5 |
| `js.ops.logical-and-or-not` | core | 9 | 4 |
| `js.ops.short-circuit` | core | 9 | 3 |
| `js.ops.nullish` | core | 6 | 4 |
| `js.conv.to-number` | standard | 6 | 2 |
| `js.conv.to-string` | minor | 4 | 1 |
| `js.conv.to-boolean` | minor | 4 | 1 |
| `js.conv.nan` | standard | 6 | 3 |
| `js.conv.truthy-falsy` | core | 10 | 4 |
| `js.conv.plus-concat` | core | 10 | 6 |
| `js.conv.equality-coercion` | standard | 6 | 4 |

단원 평가를 뺀 수입니다(단원 평가에서 각 1문제씩 더 있음).
모든 주 개념이 개념 이해·코드 이해·실습 유형을 각각 1개 이상, L3 이상 문제를 1개 이상 가집니다(숙련 단계 게이트).

## 렌더링 확인

레슨 6개를 1280px에서 캡처해 확인했습니다. 표, `<Pitfall>`, `<RunnableExample>`(예측 입력), 레슨 안 확인 문제(`InlineExercise`)가 정상으로 보이고 콘솔 오류는 없었습니다.
미렌더링 Markdown 자동 검사에서 걸린 것은 산술 레슨의 거듭제곱 연산자 `**` 글자뿐(오탐)이었습니다.

## 남은 한계와 후속 제안

1. **L4·L5가 부족하고 L2가 많습니다.** 루브릭대로 내린 결과, 핵심 단원 4개 모두 L5가 없고 comparison은 L4가 8%입니다. 요구사항 해석형 L4 문제와 새 상황으로 전이하는 L5 문제(또는 템플릿)를 보강하길 권합니다. 응용 범주가 이미 15~18%인 단원은 L2 구현 문제를 L4로 바꾸는 방식이 맞습니다.
1. **채점할 수 없는 요구가 남아 있습니다.** `static` 체크가 없어 "값을 직접 쓰지 말고 식으로 계산"을 강제할 수 없습니다. 문구는 권장으로 완화했습니다.
1. **입력이 하나뿐인 프로그램 문제는 일부 틀린 식도 통과합니다.** 함수(모듈 6) 전이라 같은 코드를 여러 입력으로 채점할 수 없습니다. 예: `logical.impl-room-comfort`는 29도 하나만 보므로 `temperature >= 18`을 빠뜨려도 통과하고, `logical.fill-join-condition`의 두 번째 빈칸은 우연히 `true`가 되는 `!==`·`<`도 통과합니다. 대표 오개념(이어 쓴 비교, `&&`/`||` 혼동)은 잡습니다.
1. **같은 상황이 여러 단원에서 반복됩니다.** "놀이기구 탑승"(comparison, logical, 단원 평가)과 "저장된 음량 0"(logical 3문제, implicit 1문제)입니다. 중복 문제는 아니지만 다음 개정 때 상황을 다양하게 바꾸길 권합니다.
1. **`rubric` 필드를 아직 스키마가 받지 않습니다.** 난이도는 검토자가 루브릭으로 직접 계산했고, 근거는 이 기록에 남겼습니다.
1. **복습용 템플릿이 없습니다.** 설계상 주 개념마다(minor 제외) 템플릿 1개 이상이 필요합니다.
1. **좁은 화면(390px)에서 가로 넘침이 있습니다.** 레슨 페이지의 머리(경로 표시)와 레이아웃이 넘치며, 이미 승인된 모듈 1·2 레슨에서도 똑같이 나타나는 앱 스타일 문제라 콘텐츠에서는 고치지 않았습니다.
