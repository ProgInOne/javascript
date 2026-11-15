# JS 기초 모듈 10 콘텐츠 AI 교차 검토 기록 (2026-11-15)

JS 기초 모듈 10 "브라우저 JS 입문"(레슨 3개, 문제 46개)을 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
검토 방법, 초안 작성자 메모에 대한 판단, 단원별 요약, 직접 고친 내용, 남은 한계를 적습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-15
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [코드 실행 샌드박스 설계](/docs/design/code-execution-sandbox.md), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [결정 기록](/docs/decisions.md), [JS 기초 모듈 6 검토](/docs/reviews/2026-11-15-m6-js-module-6-review.md)

## 검토 범위와 방법

대상은 `content/courses/js-basics/modules/10-browser-intro/`의 레슨 본문 3개와 문제 46개, 그리고 이 모듈의 개념 7개(`js.dom.*`)와 오개념 14개입니다.
모든 문제가 `review.status: draft`, `draftedBy: ai:claude`였습니다.

| 단원 | 종류 | 문제 수 |
|---|---|---|
| `dom-basics` DOM 다루기 기초 | lesson | 20 (웹 실습 8) |
| `events-intro` 이벤트 입문 | lesson | 18 (웹 실습 7) |
| `final-project` 최종 프로젝트: 할 일 목록 | project | 8 (마일스톤 6개·`event` 체크 14개인 `web-todo-app` 포함 웹 실습 3) |

문제 수가 적고 최종 프로젝트가 과정의 마무리이므로 **레슨과 문제를 모두 전수 검토**했습니다.

검토 절차:

1. 초안 작성 대화를 보지 않았습니다. 원본 파일, 설계 문서(레슨 섹션, 프로젝트 단원, `web_task`·마일스톤, `dom`·`event` 체크, 난이도 루브릭, 6단계 교차 검토, 품질 체크리스트), 샌드박스 설계(DOM 모드), 결정 기록 D-026~D-047, 작성 가이드, 이전 검토 기록만 읽었습니다.
1. 검토 전에 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(실패 0)을 직접 실행했습니다.
1. **레슨과 해설의 DOM 주장을 헤드리스 Chromium(Playwright)에서 실행해 확인했습니다.** 모두 문구대로였습니다.
   - `querySelector`는 첫 요소 하나, 없으면 `null`. `querySelectorAll`은 `NodeList`이고 찾은 뒤 붙인 요소는 들어가지 않음(정적 목록)
   - `textContent`에 `"<b>…</b>"`를 넣으면 `b` 요소가 생기지 않음. 숫자를 대입해도 읽으면 문자열
   - `classList.add(".done")`은 오류 없이 이름이 `.done`인 클래스를 넣음. `remove("pass", "fail")`처럼 여러 이름, 없는 이름도 오류 없음
   - `style.fontsize = …`는 오류 없이 무시(`fontSize`는 빈 값). `style.background-color = …`는 `SyntaxError: Invalid left-hand side in assignment`
   - `null`에 대입·읽기: `Cannot set properties of null (setting 'textContent')`, `Cannot read properties of null (reading 'length')`
   - `addEventListener("click", undefined)`는 오류 없이 아무것도 등록하지 않음
   - 버튼 안의 `span`을 누르면 `target`은 `span`, `currentTarget`은 버튼
   - `type="number"` 입력창의 `value`는 문자열(직접 입력해도). `Number("")`·`Number("  ")`는 `0`, `Number(" 20 ")`은 `20`
   - 입력창에서 Enter 키를 누르면 폼 `submit`이 일어남. `event.key`는 `"a"`, `"Enter"`, 스페이스바는 `" "`
   - 엄격 모드에서 `id = "price"`는 `ReferenceError`. 최상위 `const status`는 `window.status`와 충돌하지 않음
1. **그럴듯한 오답 풀이가 떨어지는지 실행으로 확인했습니다.** 콘텐츠 사본에 정답만 바꾼 변형 문제 32개를 만들어 같은 러너(`content-cli check --run`)로 채점했습니다(아래 표).
1. 수정한 뒤 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(문제 963개, 예제 210개, 실패 0)을 다시 실행했습니다.
1. 개발용 `content.db`로 앱(`PROGINONE_PORT=4600`, 임시 데이터 폴더)을 띄워 세 레슨을 캡처하고, **웹 실습 18개의 참조 정답을 연습(또는 약점 집중) 세트에서 제출해 모두 "정답이에요"** 를 확인했습니다. `web-todo-app`은 6개 마일스톤이 "1단계 · 할 일 추가하기"처럼 묶여 보였습니다.

### 오답 풀이 실행 결과

| 문제 | 오답 풀이 | 결과 |
|---|---|---|
| `web-todo-app` | 남은 개수에 완료한 것도 셈 | 완료 표시·삭제 체크 실패 |
| | 삭제·완료 뒤 개수를 다시 쓰지 않음 | 해당 마일스톤 실패 |
| | `trim` 없음 / 빈 입력 막지 않음 | 2단계만 실패(수정 후) |
| | 입력창 비우지 않음 | `clear-input`만 실패 |
| | `toggle(".done")` | 완료 표시 실패 |
| | 빈 목록 안내를 `style.display`로 처리 | 6단계 실패 |
| | 삭제 버튼에 `del()`처럼 괄호를 붙여 등록 | 5·6단계 실패 |
| | `value`를 함수 밖에서 한 번만 읽음 | 전부 실패 |
| | 폼이 아닌 버튼 `click`에 등록 | 전부 실패(채점은 `requestSubmit`으로 제출) |
| | `li`에 클릭 등록, `innerHTML`로 틀 만들기, `document.querySelectorAll(".done")` | 통과(동작이 같으므로 맞음) |
| `web-clear-done` | `querySelector`로 하나만 지움 / `updateStatus()` 누락 | 실패 |
| `web-score-result` | 클래스를 빼지 않음 / `toggle` 사용 / `> 90` | 실패 |
| `web-cart-total` | `Number` 없이 더함 | 실패 |
| `web-menu-board` | 다시 그리기 전에 비우지 않음 | 실패 |
| `web-age-calculator` | 빈칸 확인 없이 `NaN`만 검사 | 실패 |
| `web-enter-memo` | `event.key` 확인 없음 | 실패 |
| `web-greeting` | `value`를 함수 밖에서 읽음 | 실패 |
| `web-light-switch` | `toggle(".dark")` | 실패 |
| `web-signup-form` | `trim` 없음 | 실패 |

## 초안 작성자 메모에 대한 판단

1. **`dom-basics`의 L4 웹 실습 3개(`web-score-result`, `web-cart-total`, `web-menu-board`)에 이벤트 연결을 미리 써 둔 것**: 받아들였습니다. 학습자는 함수 본문만 쓰고, 연결 코드는 "다음 단원에서 배워요, 고치지 마세요" 주석으로 분리되어 있습니다. 덕분에 한 번 실행으로 여러 입력(경계 점수, 상품 추가, 다시 그리기)을 채점할 수 있고, 클래스가 쌓이는 버그나 다시 그리기 전 비우기처럼 "상태가 바뀌는" 실수를 잡을 수 있습니다. 레슨의 실전 사례 끝에서도 미리 알립니다.
1. **`createElement`/`append`를 `js.dom.document-tree`에 둔 것**: 그대로 둡니다. 커리큘럼 표에 이름이 없지만 "트리를 바꾼다"는 개념의 일부이고, 개념 요약과 오개념(`js.mc.created-element-auto-shown`), 레슨 원리·예제·흔한 실수가 모두 이 개념으로 묶여 있습니다. 브라우저 JS 과정의 "요소 생성·삽입·삭제 ★"에서 다시 다룹니다.
1. **"`preventDefault()`는 채점할 수 없다(샌드박스가 어차피 이동을 막는다)"**: **사실과 달랐습니다.** 채점(`dom` 모드)은 미리보기와 달리 이동을 가로채지 않고, `submit` 동작은 `requestSubmit()`으로 실제 제출을 일으킵니다. `preventDefault()`가 없으면 학습자 문서가 오류 페이지로 바뀌며 `NavigationError: 실행 중에는 다른 페이지로 이동하거나 폼을 전송할 수 없습니다.`로 실행이 끝나고, 체크는 "결과를 확인하지 못했어요"가 됩니다(앱에서 확인). 다만 **이동이 비동기라 결과가 실행마다 다릅니다.** `web-todo-app`에서 `preventDefault()`를 뺀 변형을 다섯 번 채점하니 세 번은 체크 10~13개 실패, 두 번은 14개 모두 통과였습니다. `web-signup-form` 변형은 다섯 번 모두 실패, 체크 하나짜리 변형은 세 번 중 한 번 통과였습니다. 그래서 콘텐츠는 "빠뜨리면 이 오류로 실패해요, 시점에 따라 통과할 때도 있지만 꼭 넣어요"라고 정직하게 쓰고, `web-signup-form` 해설의 "이 줄이 없어도 체크는 통과할 수 있다"를 고쳤습니다. 러너 쪽 후속 과제는 [남은 한계](#남은-한계와-후속-과제)에 적었습니다.
1. **DOM이 없는 유형(`find_bug_line`, `fix_bug`, 체크가 있는 `parsons`)에서 `document`를 쓰지 않는지**: 확인했습니다. `document`를 쓰는 `parsons` 3개(`parsons-create-item`, `parsons-like-counter`, `parsons-submit-handler`)는 체크 없이 순서로 채점하므로 실행하지 않습니다. DOM 디버깅은 모두 `web_task`입니다.
1. **마일스톤 의존**: 체크가 한 페이지에서 차례로 실행되므로 앞 단계 실패가 뒤로 번집니다. 초안에서는 2단계(공백 정리·빈 입력)가 할 일을 하나 더 만들거나 덜 만들어, 2단계만 빠뜨려도 3~6단계 체크 10개가 함께 실패했습니다. 체크 순서를 바꿔 이 의존을 없앴습니다(아래). 남은 의존(3단계 개수 → 4·5단계, 5단계 삭제 → 6단계)은 지문의 단계 설명 그대로라 자연스럽고, 지문과 레슨에 "체크는 차례로 이어서 실행돼요, 가장 앞의 실패한 단계부터 고치세요"를 넣었습니다.
1. **프로젝트 문제가 다른 단원 연습 세트에 섞이는 것**: 앱 버그로 보고 손대지 않았습니다. 앱 확인 중에도 `final-project` 연습 세트에는 다른 모듈의 복습 문제만 나왔고, `web-clear-done`·`web-fix-todo-bugs`·`predict-todo-count`는 `dom-basics`·`events-intro` 세트에, `web-todo-app`은 약점 집중 세트에 나왔습니다. 프로젝트 단원 흐름을 만드는 개발 작업에서 다룹니다.

## 단원별 요약

### DOM 다루기 기초 (`dom-basics`, 20문제)

레슨은 "콘솔이 아니라 화면이 바뀐다"는 상황으로 시작해 찾기·바꾸기·모양·만들어 붙이기 네 가지를 예제 5개로 보여 줍니다. 정의된 오개념 8개가 모두 흔한 실수에 있고, 예제 줄 번호와 출력이 실행 결과와 같습니다.
보탠 것: `textContent` 설명 뒤에 `innerHTML` 주의 상자를 넣었습니다(다른 자료에서 만나게 되지만 사용자 입력을 넣으면 위험하므로 이 과정은 `textContent`와 `createElement`만 쓴다, 보안 단원 예고).
문제: `predict-script-in-head`는 레슨 세 번째 예제와 같은 상황이라 L3 → L2로 낮췄습니다. `tf-created-element-shown`의 이유 선택지와 `multi-classlist-style` 힌트에 백틱을 넣었습니다(참/거짓 설명·이유·선택지는 인라인 코드만 렌더링).
난이도 분포: L1 4 · L2 9 · L3 4 · L4 3, 유형 7종(웹 실습 40%).

### 이벤트 입문 (`events-intro`, 18문제)

레슨은 "언제 누를지 모르니 함수를 맡겨 둔다"는 콜백 연결로 시작하고, 괄호를 붙인 등록, `on` 접두사, `preventDefault`가 함수를 끝내지 않음, `value`가 문자열이고 읽는 순간의 값이라는 오개념 6개를 모두 다룹니다.
고친 것:

- `value-string` 해설의 줄 번호(9번 → 8번).
- 이벤트 객체 설명에 `target`과 `currentTarget`의 차이를 한 문장 보탬(버튼 안에 `span`이 있으면 `target`이 안쪽 요소일 수 있음). `fill-menu-target`이 `currentTarget`도 받으므로 레슨과 맞춤.
- 미리보기 안내 상자를 "미리보기와 채점에서는"으로 바꾸고, 채점에서는 `preventDefault()` 누락이 `NavigationError`로 실패할 수 있다는 문단을 더함.

문제: `web-signup-form` 해설의 잘못된 채점 설명 수정, `predict-handler-called`는 레슨 두 번째 예제와 거의 같아 L3 → L2, `predict-click-count`의 `misconceptionByAnswer` 중 "콜백이 넘길 때 실행된다"와 맞지 않는 키("클릭 1"이 두 번 나오는 답) 삭제, `find-bug-saving-total`의 원인 선택지·`mcq-submit-default` 선택지·`multi-event-object`의 풀이와 힌트에 백틱.
난이도 분포: L1 3 · L2 8 · L3 4 · L4 3, 유형 9종(웹 실습 39%).

### 최종 프로젝트 (`final-project`, 8문제)

프로젝트 단원 필수 섹션(목표·연습·요약·다음)과 설계 원칙 세 가지(추가는 `submit` 한곳, 이벤트는 만드는 자리에서, 개수는 화면에서 다시 세기)가 있습니다. 할 일 목록은 모듈 1~10에서 배운 것(함수, `if`, `trim`, 템플릿 리터럴, `querySelectorAll`·`length`, `createElement`·`append`, `classList`, `addEventListener`, `preventDefault`, `value`)만으로 만들 수 있고, 새로 필요한 `remove()`는 지문에서 알려 줍니다.

- **`web-todo-app` 체크 순서 변경(체크 ID·마일스톤 유지)**: 2단계의 `ignore-blank`·`trim`을 맨 뒤로 옮기고, 개수 대신 `li.todo:last-child .todo-text`의 글자(`trim: false`)로 판정합니다. `count-after-add`는 "물 마시기"와 "산책하기"를 함께 추가합니다. 이제 공백 처리만 빠뜨리면 2단계만 실패하고, 2단계 체크도 앞 단계 상태와 상관없이 1단계(추가)만 되면 판정됩니다.
- 지문에 마일스톤 의존 설명과 `NavigationError` 안내를 더함. 레슨에 `요소.remove()` 소개 한 문단, "막히면" 목록에 같은 두 항목.
- `predict-todo-count`: 레슨에서 가르치지 않은 `list.children.length`를 `list.querySelectorAll("li").length`로 바꿈(출력 `1 1 2 1` 그대로). "만든 요소가 바로 보인다" 오개념 키를 실제로 그 생각에서 나오는 답(`2 1 2 1`)으로 고침.
- `multi-later-elements`: 선택지·풀이의 코드에 백틱.

마일스톤 체크와 설명은 서로 맞습니다. 1단계 추가 2개, 2단계 비우기·공백·빈 입력, 3단계 남은 개수, 4단계 완료 넣기·빼기, 5단계 미완료·완료 항목 삭제, 6단계 안내 숨김·표시·다시 숨김입니다.

## 승인 결과

46문제 모두 `review: { status: approved, draftedBy: ai:claude, reviewedBy: ai:reviewer }`로 바꿨습니다. 초안으로 남긴 문제는 없습니다.

### 검토자가 직접 쓴 부분의 2차 검토

검토자가 고친 부분(체크 순서를 바꾼 `web-todo-app`, 채점 동작 설명 4곳, 레슨 보탬 4곳, `predict-todo-count`, 백틱·난이도 수정)은 분리된 컨텍스트의 2차 AI 검토자가 다시 검토했습니다.
2차 검토는 `web-todo-app`의 체크 14개를 참조 정답으로 한 단계씩 따라가 기대값이 모두 맞음을, 오답 풀이가 해당 마일스톤만 떨어뜨림을, 채점 동작 설명이 러너 코드(`requestSubmit`, `NavigationError` 문구, "결과를 확인하지 못했어요")와 맞음을 확인했습니다. 막는 문제는 없었고, 요청한 다듬기 3가지를 반영했습니다.

- `web-signup-form` 해설과 이벤트 레슨 안내 상자의 "체크가 실패해요"가 매번 실패한다고 약속함 → "실패할 수 있어요"
- `web-todo-app` 지문의 "5단계에서 다 지운 목록으로 6단계를 확인해요"가 실제와 다름(6단계 체크가 남은 항목을 직접 지움) → "5단계의 삭제 기능으로 남은 할 일을 모두 지운 뒤"
- `ignore-blank`의 `trim: false`는 필요 없고 지나치게 엄격함 → 기본 비교로 되돌림(`trim` 체크만 `trim: false`)

## 남은 한계와 후속 과제

- **채점의 폼 제출 경쟁 상태(러너, 개발 과제)**: `preventDefault()`를 빠뜨린 답이 실행마다 통과하기도 하고 실패하기도 합니다. 채점이 결정론적이어야 한다는 원칙과 어긋납니다. 제안: 채점 모드의 하네스가 `submit` 기본 동작이 취소되지 않았는지를 동기적으로 기록해 그 실행을 `NavigationError`로 확정하거나, 이동을 끝까지 기다린 뒤 판정. 고쳐지면 레슨·지문의 "통과할 때도 있지만" 문장을 지웁니다.
- **프로젝트 문제의 연습 세트 노출(앱, 진행 중)**: 위 메모 6번. `web-todo-app`(L5)은 단원 연습 세트에 나오지 않았습니다.
- `parsons` 3개는 `document`를 쓰지만 순서로만 채점합니다. 같은 동작의 다른 순서는 `alternatives`로 모두 열거했습니다.
- 이벤트 위임, `innerHTML`의 위험, `DOMContentLoaded`는 브라우저 JavaScript 과정에서 다룹니다.

## 로컬 검증

| 명령 | 결과 |
|---|---|
| `pnpm content:check` | 오류 0 |
| `pnpm content:check:run` | 문제 963개, 예제 210개, 실패 0 |
| 앱에서 웹 실습 18개 참조 정답 제출 | 모두 정답 |
| `pnpm content:check:run --frozen` | 실패 0 |
| `pnpm check` | 통과 (단위 테스트 1281개, 링크 0개 깨짐) |
| `pnpm build` | 통과 |
| `E2E_PORT=4601 pnpm exec playwright test` | 95개 통과 |
