# M7 JS 단계적 풀이 예제 AI 교차 검토 기록 (2026-11-16)

JS 기초 모듈 2~5의 단계적 풀이 예제(`usage: worked_example`) 48개를 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
검토 방법, 묶음별 판단, 직접 고친 내용, 남은 한계와 검증 결과를 적습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-16
- 관련 문서: [콘텐츠 작성 가이드 — 단계적 풀이 예제](/docs/guides/content-authoring.md#단계적-풀이-예제-worked_example), [학습 엔진 설계 — 재학습 규칙](/docs/design/learning-engine.md#재학습-규칙), [콘텐츠·문제 시스템 설계 — 품질 체크리스트](/docs/design/content-and-exercises.md#품질-체크리스트-검토자용)

## 검토 범위와 방법

대상은 `content/courses/js-basics/modules/0[2-5]-*/lessons/*/exercises/we-*.yaml` 48개(16개 개념 × 단계 0·1·2)입니다.
모든 파일이 `review.status: draft`, `draftedBy: ai:claude`였습니다.
같은 브랜치의 HTML·CSS 새 문제는 다른 검토자가 맡아 이 기록에서 다루지 않습니다.

| 단원 | 개념 | 파일 |
|---|---|---|
| `js-basics.values.variables` | let, assignment, const | 9 |
| `js-basics.values.data-types` | primitives, typeof | 6 |
| `js-basics.operators.arithmetic` | arithmetic | 3 |
| `js-basics.operators.comparison` | relational, strict-equality | 6 |
| `js-basics.operators.logical` | logical-and-or-not, short-circuit | 6 |
| `js-basics.operators.implicit-coercion` | plus-concat, truthy-falsy | 6 |
| `js-basics.control.if-else` | if, else-if | 6 |
| `js-basics.loops.for` | for, accumulator-pattern | 6 |

풀이 예제는 같은 개념을 반복해서 틀린 학습자에게만 나오므로(FR-LRN-05), core 개념 문제와 같은 기준으로 **전수 검토**했습니다.

검토 절차:

1. 초안 대화를 보지 않고 작성 가이드의 "검토와 승인"·"단계적 풀이 예제"·유형별 스펙 절과 설계 문서의 품질 체크리스트, 각 단원의 `lesson.yaml`·`lesson.mdx`만 읽었습니다.
1. 시작 전에 `pnpm content:check:run`을 실행해 오류 0개를 확인했습니다.
1. 파일마다 품질 체크리스트의 문제 항목과 풀이 예제 기준을 확인했습니다.
   - 세 단계가 같은 대표 문제(또는 숫자만 바꾼 것)를 이어 가는가
   - 단계 0 코드에 줄마다 이유 주석이 있는가, 학습자가 처음 읽어도 친절하고 정확한가
   - 단계 1 빈칸이 핵심 줄 1~2개인가(typeof-1만 3개, 아래 참고)
   - 단계 2가 비슷한 새 상황을 처음부터 쓰게 하고, 난이도가 2~3인가
   - 해설이 앞 단계와 연결되는가, 힌트가 방향 → 단서 → 거의 답 순서인가
   - 그 단원까지 배운 문법만 쓰는가(모듈 2에서 if·===·반복문·함수, 모듈 3에서 if, 모듈 4~5에서 함수·배열 메서드 금지)
   - `misconceptionByAnswer`·`misconceptionIfFail`·`misconceptionMap`의 오개념이 그 오답을 실제로 만드는 생각과 맞는가
1. 단계 0의 기대 출력은 `content/.generated/predict-expected.json`의 실제 실행 결과와 해설을 대조했습니다(16개 모두 일치).
1. 해설·힌트가 말하는 오류는 Node v24(엄격 모드)로 직접 확인했습니다: `0420`(Octal literals are not allowed in strict mode), `stamps + 2 = stamps`(Invalid left-hand side in assignment), `let` 재선언(Identifier has already been declared), `"키가 " + 130 - 128`(NaN), `4 ^ 2`(6).
1. 수정 뒤 `pnpm content:check:run`을 다시 실행했습니다.

## 판정 요약

| 판정 | 수 |
|---|---|
| 승인(수정 없음) | 42 |
| 승인(검토자 수정) | 6 |
| 거부·보류 | 0 |

## 묶음별 판단

### 모듈 2 변수와 상수 (let, assignment, const)

9개 승인. 저금통 → 도장 → 체력, 사과 → 책 대여 → 입장권처럼 같은 모양의 대표 문제가 이어지고, 단계 0 주석이 "오른쪽부터 계산 → 왼쪽에 넣기"를 줄마다 설명합니다. 산술 `+ - *`는 레슨 본문에서 이미 쓰는 범위입니다.

- `we-const-0`: 오답 `총액: 2400`을 `js.mc.variable-remembers-formula`(식이 나중 변경을 따라간다)에 연결했지만, 이 코드에서는 total을 count가 바뀐 **뒤**에 계산하므로 그 오개념으로는 오히려 정답이 나옵니다. 2400은 `count = count + 1;`이 count를 바꾸지 못한다고 본 경우라 `js.mc.assign-is-equality`로 바꾸고 해설 문장을 맞췄습니다.
- `we-const-1`: `fee`에 `let`을 써도 체크를 통과합니다. 실행으로는 가를 수 없고, 해설이 "실행은 되지만 기준은 const 먼저"라고 설명하므로 그대로 둡니다.

### 모듈 2 자료형 (primitives, typeof)

6개 승인. `typeof null`과 `typeof typeof`는 레슨이 "주의!"와 핵심 규칙으로 다룬 범위입니다.

- `we-primitives-1`: 힌트 3이 "엄격 모드에서는 0으로 시작하는 숫자가 오류가 될 수 있어요"라고 아직 소개하지 않은 용어를 썼습니다. "따옴표 없이 0420을 쓰면 글자가 아니라 숫자로 읽히는데, 0으로 시작하는 이런 숫자는 오류가 나요"로 바꿨습니다.
- `we-typeof-1`: 빈칸이 3개지만 각각 한 단어(값·값·연산자)라 단계 0의 핵심 세 가지를 하나씩 거꾸로 확인하는 구성으로 받아들였습니다.

### 모듈 3 산술·비교 (arithmetic, relational, strict-equality)

9개 승인. 괄호와 `/`의 소수 결과, 문자열끼리 사전 순서와 섞인 비교의 숫자 변환, `===`의 자료형 비교를 같은 순서로 반복합니다. `**`와 `^`의 차이는 산술 레슨에서 다룹니다. if는 쓰지 않습니다.

### 모듈 3 논리 (logical-and-or-not, short-circuit)

6개 승인(3개 수정).

- `we-logical-and-or-not-0`: 4번 줄 `hasTicket && age >= 12 || withParent`는 왼쪽부터 계산해도 `&&`를 먼저 계산해도 `true`라서, 연결된 `js.mc.and-or-same-precedence`(왼쪽부터 계산한다)를 가려내지 못했습니다. 오개념 정의의 예와 같은 모양인 `withParent || age >= 12 && hasTicket`으로 바꿔, 올바른 계산은 `true || (true && false)` → `true`, 왼쪽부터 계산하면 `(true || true) && false` → `false`가 되게 했습니다. 주석·힌트 3·해설 표와 문장을 함께 고쳤습니다. 기대 출력(`false/true/true/true`)과 진단 오답 키는 그대로입니다.
- `we-short-circuit-1`: 힌트 3의 `userName ||"익명"` 띄어쓰기 오타를 고쳤습니다.
- `we-short-circuit-2`: 지문의 "`if`는 쓰지 말고"는 아직 배우지 않은 문법을 이름으로 언급합니다. "`&&`의 단락 평가를 이용해 한 줄로 쓰세요"로 바꿨습니다. `muted && console.log(...)` 모양은 논리 레슨이 직접 보여 준 예제입니다.

### 모듈 3 암묵적 형 변환 (plus-concat, truthy-falsy)

6개 승인. `Number()`는 바로 앞 단원(명시적 형 변환), `!!`는 이 단원 레슨에서 소개합니다. 단계 0의 진단 오답 키 세 개가 각각 다른 오개념(문자열 "0", 공백 문자열, "false" 내용 읽기)을 정확히 가려냅니다.

### 모듈 4 if와 else (if, else-if)

6개 승인. 교통카드 → 숫자만 바꾼 교통카드 → 놀이기구, 미세먼지 → 농도만 바꾼 미세먼지 → 택배 요금으로 이어집니다. `-=`는 산술 단원에서 배웠고, 블록 밖 변수 범위는 이 단원의 `js.control.block`이 다룹니다.

### 모듈 5 for 문 (for, accumulator-pattern)

6개 승인(1개 수정). 출석 부르기 → 6번까지 → 구구단 4단, 저금통 합계 → 500원 단위 → 타일 수로 이어집니다. 함수와 배열 메서드는 쓰지 않습니다.

- `we-accumulator-pattern-0`: `for` 머리 줄에만 이유 주석이 없었습니다. "day를 1부터 4까지 1씩 늘리며 본문을 4번 실행해요 (1일째 ~ 4일째)" 주석을 추가했습니다.

## 직접 고친 내용

| 파일 | 고친 내용 | 이유 |
|---|---|---|
| `we-const-0` | 오답 2400의 오개념을 `assign-is-equality`로, 해설 문장 수정 | 원래 오개념으로는 정답이 나와 진단이 틀림 |
| `we-primitives-1` | 힌트 3에서 "엄격 모드" 표현 제거 | 아직 소개하지 않은 용어 |
| `we-logical-and-or-not-0` | 4번 줄 식을 `withParent \|\| age >= 12 && hasTicket`으로, 주석·힌트·해설 수정 | 원래 식은 우선순위 오개념을 가려내지 못함 |
| `we-short-circuit-1` | 힌트 3 띄어쓰기 | 오타 |
| `we-short-circuit-2` | "if는 쓰지 말고" 제거 | 배우지 않은 문법 언급 |
| `we-accumulator-pattern-0` | `for` 줄 이유 주석 추가 | 단계 0은 줄마다 이유 주석 |

48개 모두 `review`를 `status: approved`, `reviewedBy: ai:reviewer`로 바꿨습니다.

## 거부·보류

없습니다.

## 남은 한계

- 프로그램 모드 단계 2와 code 모드 단계 1은 고정된 입력 한 번만 실행하므로, 결과를 직접 출력하는 하드코딩(예: `we-if-2`에서 `console.log("키가 2cm 모자라요")`, `we-assignment-1`에서 `stamps = 5;`)도 통과합니다. 지문이 "결과 숫자를 직접 쓰지 말라"고 안내하고, 재학습 경로의 목적이 연습이라 결함으로 보지 않았습니다.
- 모듈 2~3 파일은 지문 첫 줄이 "**풀이 예제 N단계: …**", 모듈 4~5 파일은 "**완성된 풀이를 읽는 단계예요.**"처럼 머리말 모양이 다릅니다. 같은 개념 안에서는 일관되어 그대로 두었습니다.

## 검증 결과

- 검토 시작 전 `pnpm content:check:run`: 오류 0개.
- 수정·승인 후 `pnpm content:check:run`: **오류 0개**. 풀이 예제 48개 모두 "통과"(단계 0 예측 16개 기대값 일치, 단계 1·2 참조 정답 체크 통과·시작 코드 실패). 모듈 2~5의 "검토되지 않은 문제" 경고와 풀이 예제 단계 누락·중복 경고는 없습니다. 남은 경고는 HTML·CSS 단원(다른 검토자 범위)과 기존 type-mix·published-slugs 경고뿐입니다.
