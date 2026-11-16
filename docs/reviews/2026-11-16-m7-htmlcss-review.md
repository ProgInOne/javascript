# M7 HTML/CSS 보충 문제 AI 교차 검토 기록 (2026-11-16)

HTML·CSS 핵심 과정의 `type-mix` 경고 13곳을 없애려고 추가한 문제 34개(HTML 18, CSS 16)를 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
같은 배치의 JavaScript 단계적 풀이 예제(`we-*.yaml`)는 다른 검토자가 따로 봤고, 이 기록의 범위가 아닙니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-16
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [CSS 핵심 검토](/docs/reviews/2026-11-15-m5-css-core-review.md), [HTML 핵심 검토](/docs/reviews/2026-11-15-m5-html-core-review.md)

## 검토 범위와 방법

대상은 `content/courses/html/`과 `content/courses/css/`의 새 문제 파일 34개입니다. 모두 `review.status: draft`, `draftedBy: ai:claude`였습니다.
작성자가 함께 지운 기존 승인 문제 4개(아래 "삭제한 개념 문제 판단")가 단원의 개념·오개념 커버리지를 해치지 않았는지도 판단했습니다.

| 과정 | 단원 | 새 문제 | 유형 |
|---|---|---|---|
| HTML | `how-web-works` | 6 | 빈칸(text) 3, 웹 실습 3 |
| | `document` | 3 | 빈칸(text) 1, 웹 실습 2 |
| | `text` | 2 | 빈칸(text) 1, 웹 실습 1 |
| | `lists-tables` | 2 | 빈칸(code) 1, 웹 실습 1 |
| | `forms` | 2 | 빈칸(text) 1, 웹 실습 1 |
| | `landmarks` | 3 | 빈칸(code) 1, 웹 실습 2 |
| CSS | `intro` | 3 | 빈칸(code) 2, 웹 실습 1 |
| | `selectors` | 3 | 빈칸(code) 2, 웹 실습 1 |
| | `cascade` | 3 | 빈칸(text) 2, 웹 실습 1 |
| | `display` | 2 | 빈칸(text) 1, 웹 실습 1 |
| | `units-colors` | 1 | 웹 실습 1 |
| | `typography` | 2 | 객관식 1, 빈칸(code) 1 |
| | `responsive` | 2 | 웹 실습 2 |

core 개념 문제와 같은 기준으로 **34개 모두 전수 검토**했습니다.

검토 절차:

1. 초안 대화를 보지 않고, 작성 가이드(유형별 스펙, 수량·구성비, 검토와 승인), 설계 문서의 품질 체크리스트, 각 단원의 `lesson.mdx`, 오개념 파일, 이전 검토 기록만 읽었습니다.
1. 시작할 때 `pnpm content:check:run`을 직접 실행했습니다(오류 0개).
1. 파일마다 체크리스트를 확인했습니다. 정답이 하나로 정해지는지, 단원이 가르친 범위 안인지, 힌트 3단계가 정답을 그대로 주지 않는지, 해설이 오답 이유를 설명하는지, 오개념 연결이 맞는지, `web_task` 체크가 지문 요구와 맞고 엉뚱한 답으로 통과하기 어려운지를 봤습니다.
1. HTML 파서 동작 주장(`<p>…<strong>꼭</p> …</strong>`을 브라우저가 `</p>`에서 문단을 닫고 남은 글자를 `body` 아래 새 `strong`으로 감싸는 것)은 HTML 명세의 "활성 서식 요소 재구성" 규칙과 대조해 맞다고 확인했습니다. 실제 실행 결과도 아래 대체 답안 시험의 `web-fix-overlap` 오답에서 같았습니다.
1. **대체 답안 시험.** 콘텐츠를 스크래치 폴더로 복사하고(HTML·CSS 과정만), 참조 정답 자리에 다른 답안 32개를 넣은 복제 문제를 만들어 `check --run`을 돌렸습니다. 기대(통과/실패)와 실제가 모두 일치했습니다(아래 표).
1. 고친 뒤 `pnpm content:check:run`과 `pnpm content:report`를 다시 실행했습니다(아래 "검증 결과").

### 대체 답안 시험 결과

| 문제 | 대체 답안 | 기대 | 결과 |
|---|---|---|---|
| `selectors.web-news-first-last` | `.news` 없이 `p:first-child`/`p:last-child` | 실패 | 실패(상자 밖 문단도 `body`의 마지막 자식) |
| | `.news, p:last-child` (묶음) | 실패 | 실패 |
| | `.news p :first-child` (띄움) | 실패 | 실패 |
| `selectors.fill-last-child` | `:last-child`만 | 실패 | 실패(`ul`이 마지막 자식이라 회색이 상속됨) |
| | `.todo li:last-child` | 통과 | 통과 |
| | `li :last-child` | 실패 | 실패 |
| `cascade.web-page-button-override` | 공용 규칙을 직접 고침 | 실패 | 실패(새 체크) |
| | 두 번째 style에 `!important` | 통과 | 통과(결과가 같아 허용) |
| `display.web-card-link-bar` | `display: inline-block` / `width: 260px` | 실패 | 둘 다 실패 |
| | `display: flex` | 통과 | 통과(블록 수준이라 정답으로 둠) |
| `responsive.web-viewport-and-title` | `max-width: 600px` 데스크톱 우선 | 실패 | 실패(새 600px 체크) |
| | `max-width: 599px` 데스크톱 우선 | 통과 | 통과 |
| | meta 태그 없음 | 실패 | 실패 |
| `intro.web-write-rule` | `p {…}` / `"orange"` / 세미콜론 빠짐 | 실패 | 모두 실패 |
| `units-colors.web-fix-color-values` | `color: white` / `#2563eb` | 통과 | 둘 다 통과 |
| `landmarks.web-news-articles` | section·article 뒤바꿈 / 모두 section | 실패 | 둘 다 실패 |
| `text.web-strong-and-em` | `<b>` / strong·em 뒤바꿈 / 첫 문장 고침 | 실패 | 모두 실패(마지막은 새 체크) |
| `lists-tables.web-picnic-list` | `ol` / 목록 상자 없는 `li` | 실패 | 둘 다 실패 |
| `document.web-fix-overlap` | `</p>`를 "꼭" 뒤에 둠 | 실패 | 실패 |
| `forms.web-button-types` | 모두 `button` / 가입하기 `type` 생략 | 실패 | 둘 다 실패 |
| `how-web-works.web-style-not-text` | `<style>`을 body에 둠 | 실패 | 실패 |
| `how-web-works.web-weekend-plan` | 두 문장을 `p` 하나에 | 실패 | 실패 |
| `landmarks.web-nav-footer` | `nav`를 header 밖에 둠 | 실패 | 실패 |

## 판정 요약

| 판정 | 수 | 파일 |
|---|---|---|
| 그대로 승인 | 15 (HTML 6, CSS 9) | 아래 단원별 표에서 "그대로" |
| 고친 뒤 승인 | 19 (HTML 12, CSS 7) | 아래 단원별 표에서 고친 내용 참고 |
| 거부·보류 | 0 | — |

## 단원별 판단

### HTML

| 문제 | 판정 | 판단과 고친 내용 |
|---|---|---|
| `how-web-works.fill-request-response` | 그대로 | 요청·응답·브라우저 순서가 레슨과 같음. 힌트 3이 첫 글자를 주지만 L1이라 허용 |
| `how-web-works.fill-three-languages` | 그대로 | 세 칸 모두 정답 유일. 해설의 표는 지문 Markdown이 지원함(`Markdown.tsx`) |
| `how-web-works.fill-render-result` | 그대로 | `strong`은 3단원에서 배우지만, 답에 필요한 것은 "태그는 보이지 않는다"뿐이고 힌트·해설이 설명해 허용 |
| `how-web-works.web-fix-brackets` | 고침 | 힌트 3이 네 태그의 정답을 그대로 줌 → 괄호→꺾쇠 규칙만 알려 주도록 완화 |
| `how-web-works.web-style-not-text` | 그대로 | `head > style` 요구를 지문에 밝힘. body에 둔 style은 실패 |
| `how-web-works.web-weekend-plan` | 고침 | 힌트 3이 코드 전체 → "세 줄을 따로 감싸고 p 하나에 두 문장 넣지 않기"로 완화 |
| `document.fill-count-tags` | 고침 | 힌트 3이 태그 네 개를 나열해 답이 됨 → `em` 하나로 세는 법만 보이도록 완화 |
| `document.web-title-attribute` | 고침 | 힌트 3이 여는 태그 전체 → 옮길 위치만 알려 주도록 완화 |
| `document.web-fix-overlap` | 고침 | 파서 복구 설명이 정확함. 힌트 3이 닫는 위치를 그대로 줌 → 원리만 남김 |
| `text.fill-heading-outline` | 그대로 | 오개념 매핑(h3·h4 → 단계 건너뛰기) 적절 |
| `text.web-strong-and-em` | 고침 | 힌트 3이 정답 코드 → 감쌀 범위만 안내. "두 문단의 문장 유지" 체크가 둘째 문단만 보던 것을 첫째 문단 체크(`first-sentence-kept`) 추가로 보강 |
| `lists-tables.fill-table-header-row` | 고침 | 힌트 3이 정답 그대로 → tbody 행을 본보기로 삼게 완화 |
| `lists-tables.web-picnic-list` | 고침 | `ol`로 답해도 `li-alone`(목록 상자 없는 li) 오개념이 붙던 매핑 수정: `ul > li` 체크의 오개념 제거, `items-in-ul`의 부모를 `"ul, ol"`로 바꿔 진짜 "상자 없는 li"만 그 오개념으로 진단. 힌트 3 완화 |
| `forms.fill-form-scope` | 고침 | 지문이 이미 "폼을 보냈다"고 하므로 `title` 답을 `button-does-nothing`으로 진단하는 근거가 약함 → 매핑을 지우고 `misconceptions: []`, 해설 문장을 "폼 안팎 혼동"으로 고침 |
| `forms.web-button-types` | 고침 | `reset`은 레슨 표에 있음. 힌트 3이 세 정답을 짝지어 줌 → 값 목록과 짝짓는 기준만 주도록 완화 |
| `landmarks.fill-footer-landmark` | 그대로 | L1 회상 문제. 순서 체크로 위치까지 확인 |
| `landmarks.web-news-articles` | 고침 | 레슨 두 번째 예제와 구조가 비슷하지만 판단 근거를 지문이 주고 상황이 달라 허용. 힌트 3 완화 |
| `landmarks.web-nav-footer` | 고침 | 기존 `web-page-landmarks`의 일부(nav·footer)와 겹치지만 반복 연습으로 허용. 힌트 3 완화 |

### CSS

| 문제 | 판정 | 판단과 고친 내용 |
|---|---|---|
| `intro.fill-style-element` | 그대로 | L1. 힌트 3이 거의 답이지만 L1 회상이라 허용 |
| `intro.fill-inline-style` | 그대로 | 다른 두 문단이 그대로인지 확인하는 체크가 있음 |
| `intro.web-write-rule` | 그대로 | 타입 선택자·따옴표 값·세미콜론 누락이 모두 실패함을 확인 |
| `selectors.fill-class-and-id` | 그대로 | `h1`·`p.sale` 같은 동등 답 허용을 해설에 밝힘 |
| `selectors.fill-last-child` | 고침 | 힌트 3이 `li:last-child`를 그대로 줌 → 원리만 남김. 체크별 오개념이 어긋남(`li` 전체 회색이면 `pseudo-class-is-class`로 진단 등) → 체크의 `misconceptionIfFail`을 지우고 빈칸 `misconceptionMap`으로 옮김(`li :last-child` → `hover-space`, `.last-child`·`li.last-child` → `pseudo-class-is-class`) |
| `selectors.web-news-first-last` | 고침 | 힌트 3이 정답 두 규칙 → 고를 대상만 말로 설명. 힌트 2·해설의 "골라질 수 있어요"를 실행 결과대로 단정(상자 밖 문단도 `body`의 마지막 자식이라 실패) |
| `cascade.fill-later-rule-result` | 그대로 | 속성 단위 캐스케이드(padding 유지)를 잘 짚음. 삭제된 `mcq-same-specificity-order`를 대신함 |
| `cascade.fill-inherited-props` | 고침 | 글자 색 칸의 `"black"` → `all-props-inherit` 매핑이 반대 방향(검정은 "color도 상속 안 됨"이라는 생각) → 삭제. 테두리 칸에 `"없음"`도 정답으로 추가 |
| `cascade.web-page-button-override` | 고침 | "공용 규칙은 고치지 말고"를 채점하지 않아, 공용 규칙을 직접 고쳐도 통과 → 첫 번째 `style`의 글자가 원래와 같은지 보는 `dom` 체크(`shared-rule-kept`, 공백은 정규화) 추가. `!important`는 결과가 같아 허용 |
| `display.fill-count-lines` | 그대로 | 2줄이 맞음. 1·3줄 오개념 매핑 적절 |
| `display.web-card-link-bar` | 고침 | 힌트 3이 `display: block`을 그대로 줌 → 완화. `flex`도 블록 수준이라 통과하는데 실제로 너비를 채우므로 정답으로 둠 |
| `units-colors.web-fix-color-values` | 고침 | 16진수 변환(37=25, 99=63, 235=eb) 확인. 힌트 3이 정답 두 값 → "기호 하나 지우기/붙이기"로 완화 |
| `typography.mcq-line-height-value` | 그대로 | 선택지마다 이유가 분명하고 정답 유일 |
| `typography.fill-receipt-align` | 그대로 | 상속과 직접 지정의 우선을 함께 다룸 |
| `responsive.web-viewport-and-title` | 고침 | "600px 이상"의 경계를 채점하지 않아 `max-width: 600px`·`min-width: 601px`도 통과 → 너비 600px 체크(`big-title-at-600`) 추가, 해설을 경계 설명으로 고침. 힌트 2·3을 합치면 답 전체가 되던 것을 힌트 3 완화로 해결 |
| `responsive.web-fix-query-order` | 그대로 | 768px 경계 체크가 있음. `!important`로도 통과하지만 "선택자와 값"은 지켜 허용 |

## 삭제한 개념 문제 판단

작성자가 지운 기존 승인 문제 4개를 단원의 남은 문제와 대조했습니다. 넷 모두 **삭제를 받아들입니다**.

- **`html.basics.document.mcq-nesting-order`** (중첩 순서 고르기, `overlapping-tags`): 같은 오개념을 `fill-close-nested`(닫는 순서 빈칸)와 새 `web-fix-overlap`(엇갈린 태그를 직접 고치고, 브라우저가 구조를 바꾸는 결과를 봄)이 다룹니다. `html.doc.nesting`의 주 개념 문제도 2개로 `concept-min`을 채웁니다. 세 겹 중첩을 고르는 판단은 빠졌지만, 직접 고치는 문제가 더 강한 증거라 커버리지 손실은 작습니다.
- **`html.semantics.landmarks.multi-article-candidates`** (article 후보 모두 고르기): `section-article-same`은 `mcq-article-or-section`, `fill-faq-section`, `web-blog-structure`, 새 `web-news-articles`가 계속 다룹니다. `div-is-wrong`은 `mcq-div-when`, `fill-layout-div`, `web-blog-structure`에 남습니다. **빠진 것은 "댓글 하나도 article"이라는 사례 하나**입니다. 레슨이 이 사례를 핵심으로 다루지 않아 막을 정도는 아니지만, 다음에 이 단원을 보강할 때 후보로 적어 둡니다.
- **`css.basics.selectors.mcq-hover-meaning`** (`:hover`에 무엇이 필요한가): `pseudo-class-is-class`는 `mcq-hover-space`(오답 선택지), `web-first-child`, 새 `fill-last-child`·`web-news-first-last`가 다룹니다. `:hover` 자체의 뜻은 `mcq-hover-space`와 레슨 확인 문제에 남습니다.
- **`css.basics.cascade.mcq-same-specificity-order`** (같은 명시도면 나중 규칙): 오개념 연결이 없던 문제이고, 새 `fill-later-rule-result`가 같은 규칙에 "속성 단위로 이긴다"까지 더해 묻습니다. `web-button-order`와 새 `web-page-button-override`도 순서를 다룹니다.

이 4개는 이미 공개된 문제라 `check`가 `.published-slugs.txt` 경고를 냅니다. 의도한 삭제이므로 커밋 전에 `pnpm content:build`로 목록을 갱신해야 합니다(조율자 몫).

## 오개념 재학습 문제 추가

`content/misconceptions/html.yaml`·`css.yaml`의 `remediation.exercises`에, 그 오개념을 실제로 진단하는 새 승인 문제를 하나씩 덧붙였습니다(23곳). 모두 해당 문제의 `misconceptions`에 그 오개념이 들어 있습니다.

| 오개념 | 추가한 문제 |
|---|---|
| `html.mc.page-lives-in-browser` | `html.basics.how-web-works.fill-request-response` |
| `html.mc.html-is-programming` | `html.basics.how-web-works.fill-three-languages` |
| `html.mc.code-shown-as-is` | `html.basics.how-web-works.fill-render-result` |
| `html.mc.tag-is-element` | `html.basics.document.fill-count-tags` |
| `html.mc.attribute-shown-on-page` | `html.basics.document.web-title-attribute` |
| `html.mc.overlapping-tags` | `html.basics.document.web-fix-overlap` |
| `html.mc.heading-skip-levels` | `html.basics.text.fill-heading-outline` |
| `html.mc.strong-is-bold` | `html.basics.text.web-strong-and-em` |
| `html.mc.li-alone` | `html.content.lists-tables.web-picnic-list` |
| `html.mc.th-is-bold-td` | `html.content.lists-tables.fill-table-header-row` |
| `html.mc.button-does-nothing` | `html.content.forms.web-button-types` |
| `html.mc.section-article-same` | `html.semantics.landmarks.web-news-articles` |
| `css.mc.value-in-quotes` | `css.basics.intro.fill-inline-style` |
| `css.mc.link-uses-src` | `css.basics.intro.fill-style-element` |
| `css.mc.selector-symbol-mixup` | `css.basics.selectors.fill-class-and-id` |
| `css.mc.hover-space` | `css.basics.selectors.fill-last-child` |
| `css.mc.pseudo-class-is-class` | `css.basics.selectors.fill-last-child` |
| `css.mc.all-props-inherit` | `css.basics.cascade.fill-inherited-props` |
| `css.mc.width-on-inline` | `css.box.display.web-card-link-bar` |
| `css.mc.inline-block-new-line` | `css.box.display.fill-count-lines` |
| `css.mc.narrow-blocks-sit-side-by-side` | `css.box.display.fill-count-lines` |
| `css.mc.line-height-unitless-px` | `css.styling.typography.mcq-line-height-value` |
| `css.mc.viewport-meta-makes-responsive` | `css.layout.responsive.web-viewport-and-title` |

## 남은 한계

- **"코드 이해" 범주의 회상 문제.** `how-web-works.fill-request-response`·`fill-three-languages`, `landmarks.fill-footer-landmark`처럼 빈칸(text·code) 유형이지만 실제로는 낱말 회상인 문제가 있습니다. 구성비 규칙이 유형으로 범주를 정해 "코드 이해"로 셉니다. 교육적으로 틀린 문제는 아니라 승인했지만, 구성비 수치가 코드 읽기 연습량을 다소 부풀린다는 점을 적어 둡니다.
- 비슷한 웹 실습이 겹치는 단원이 있습니다(`how-web-works`의 h1+p 실습 3개, `landmarks`의 `web-page-landmarks`와 `web-nav-footer`). 반복 연습으로 허용했습니다.
- 지문의 "선언 하나만"(`web-card-link-bar`), "규칙 하나"(`web-write-rule`), "`.btn` 선택자로"(`web-page-button-override`) 같은 방식 조건은 채점하지 않습니다. 결과가 같은 다른 방법은 통과합니다.

## 검증 결과

- 시작 시 `pnpm content:check:run`: 오류 0개.
- 수정 후 `pnpm content:check:run`: 실행 검증 문제 1113개·템플릿 변형 90개·예제 210개, 실패 0, 정적 검사 오류 0개(경고 9개: JavaScript 구성비 5개, 삭제한 공개 문제 4개의 `.published-slugs.txt`).
- 수정 후 `pnpm content:report`: HTML 7개·CSS 9개 일반 단원 모두 기준 충족, HTML/CSS 위반 0건(남은 위반 5건은 모두 JavaScript). 단원별 범주 비율은 개념 33~44%, 코드 20~33%, 디버깅 0%, 구현 22~33%, 응용 0~10%, 문제 수 9~12개로 목표 안입니다.
- 이번 수정은 유형·난이도를 바꾸지 않아 범주가 바뀐 문제는 없습니다.
