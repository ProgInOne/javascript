# CSS 핵심 과정 콘텐츠 AI 교차 검토 기록 (2026-11-15)

CSS 핵심 과정(`css`)의 M5 초안(레슨 8개, 문제 70개)을 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
검토 방법, 단원별 판단, 직접 고친 내용, 최종 문제 구성과 남은 한계를 적습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-15
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [결정 기록](/docs/decisions.md), [v0.1 콘텐츠 검토](/docs/reviews/2026-11-15-v0.1-content-review.md)

## 검토 범위와 방법

대상은 `content/courses/css/`의 새 단원 8개(레슨 본문과 문제 전부), `content/concepts/css.yaml`의 새 개념 24개, `content/misconceptions/css.yaml`의 새 오개념 36개입니다.
문제는 모두 `review.status: draft`, `draftedBy: ai:claude`였습니다.
이미 승인된 `css.box.model`은 초안 작성자가 고친 안내 문장 한 줄("선택자와 규칙 구조는 앞 모듈 'CSS의 원리'에서 배웠어요")만 확인했고, 모듈 순서와 맞아 그대로 두었습니다.

| 모듈 | 단원 | 목표 문제 수 |
|---|---|---|
| `css.basics` | `intro` CSS 연결과 규칙 구조 | 7 |
| | `selectors` 선택자 | 10 |
| | `cascade` 캐스케이드와 명시도 | 10 |
| `css.box` | `display` display와 흐름 | 8 |
| `css.styling` | `units-colors` 단위와 색 | 8 |
| | `typography` 글꼴과 텍스트 | 7 |
| `css.layout` | `flex-basics` Flexbox 기초 | 12 |
| | `responsive` 반응형 기초 | 8 |

CSS 개념은 모두 `standard`라 문제는 샘플링 대상이지만, 70문제뿐이라 **모든 레슨과 문제를 전수 검토**했습니다.

검토 절차:

1. 초안 작성 대화를 보지 않고, 원본 파일과 설계 문서(레슨 표준 섹션, 유형별 스펙, 체크 명세 언어, 난이도 루브릭과 분포, 문제 수 산정, 6단계, 품질 체크리스트)·작성 가이드·결정 기록(D-026~D-040)·이전 검토 기록만 읽었습니다.
1. 검토 시작 전에 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(실패 0)을 직접 실행했습니다.
1. 레슨마다 품질 체크리스트의 레슨 항목, 12섹션, 선수 개념 순서(HTML 과정 → CSS 단원 순서), 해요체 문장을 확인했습니다.
1. 문제마다 체크리스트의 문제 항목을 확인했습니다. 특히 정답이 하나로 정해지는지, 오답 선택지와 `misconception` 연결, 힌트 3단계가 정답 전체를 주지 않는지, 해설이 오답마다의 이유를 설명하는지, 난이도가 루브릭 합계와 맞는지를 봤습니다.
1. **CSS 동작 주장을 Chromium에서 직접 확인했습니다.** 세미콜론이 빠진 선언 두 개가 함께 무시되는 것, 따옴표로 감싼 색 값이 무시되는 것, 명시도 계산과 순서, `em` 중첩(24px → 36px)과 `rem`, 마진 상쇄(30px), 인라인 요소의 위아래 margin이 줄 높이를 바꾸지 않는 것, 단위 없는 `line-height`와 `1.5em`의 상속 차이(제목 36px 대 27px), `margin: 0 auto`인 카드의 실제 위치 등을 실행해 봤습니다.
1. **`web_task`와 code 빈칸이 그럴듯한 오답을 거르는지 실행으로 확인했습니다.** 콘텐츠 디렉터리를 임시로 복사해 참조 정답 자리에 다른 답안 44개(통과해야 하는 다른 정답 포함. 오답 예: `!important`, `.menu > li`, `display: block`, `font-size: 32px`, `line-height: 27px`, margin으로 만든 메뉴 간격, `max-width`로 뒤집은 미디어 쿼리, 경계를 1px 어긋낸 미디어 쿼리)를 넣고 `check --run`을 돌려, 의도대로 통과·실패하는지 확인했습니다(아래 각 단원 참고).
1. `pnpm content:build:dev`로 빌드하고 앱(`PROGINONE_PORT=4485`, 임시 데이터 폴더, 모의 AI)을 띄워 레슨 8개를 1280px·390px로 캡처했습니다. 실습 모드에서 이 과정의 웹 실습 21개에 참조 정답을 입력해 앱이 모두 "정답이에요."로 채점하는 것을 확인했고, 콘솔 오류는 0건이었습니다. `codeOptions` 객관식(`mcq-which-mobile-first`)의 코드 선택지도 정상으로 보였습니다.
1. 수정 뒤 `pnpm content:check`(오류 0)와 `pnpm content:check:run`(문제 415개, 예제 97개, 실패 0)을 다시 실행했습니다. 예측 문제가 없어 `content/.generated/predict-expected.json`은 바뀌지 않았습니다.

### 검토자가 다시 쓴 문제의 2차 검토

채점 방식을 바꾸려고 크게 고친 웹 실습 9개(`intro.web-style-all-tips`, `cascade.web-fix-warning-color`·`web-button-order`·`web-inherit-card-color`, `units-colors.web-rem-heading`, `typography.web-fix-line-height`, `flex-basics.web-nav-gap`, `responsive.web-cards-row-on-wide`·`web-mobile-first-page`)는 자기 승인을 피하려고 **분리된 컨텍스트의 2차 AI 검토자**에게 다시 검토하게 했습니다.
2차 검토는 6개를 승인(2개는 문구 보강)하고, 다음을 지적해 반영했습니다.

- `cascade.web-fix-warning-color`: 레슨 예제 1과 상황·답이 같았고, 문단 하나에만 ID를 쓰는 답도 통과할 수 있었음 → 도서관 일정표(`#schedule li`) 상황으로 바꾸고, 휴관 안내를 두 개로 늘려 모두 빨간색인지 확인
- `flex-basics.web-nav-gap`: "가장자리 24px"을 padding으로만 채점하면서 지문은 결과만 요구해, margin으로 맞춘 옳은 배치가 실패할 수 있었음 → 지문에 "`.nav`의 좌우 padding을 24px로"라고 밝히고, 로고와 메뉴 묶음의 `same-row` 체크 추가
- `responsive.web-mobile-first-page`: 참조 정답이 768~899px에서 `width: 900px` 때문에 화면을 넘쳐 지문의 문제를 그대로 남겼음 → 경계를 `min-width: 960px`(900px + body 여백이 들어가는 너비)로 바꾸고 960px에서도 너비 900px을 확인
- `layout` 체크 설명이 `right-of`(가로 위치만 비교)인데 "같은 줄"이라고 약속하던 곳들 → "보다 오른쪽에"로 고치고, 같은 줄이 필요한 곳은 `same-row` 체크를 따로 둠
- `cascade.web-button-order`·`units-colors.web-rem-heading`: 해설 한 줄씩 보강

`draftedBy`는 스키마 형식에 따라 `ai:claude`로 두었습니다. 이 문제들을 검토자가 고쳐 썼다는 사실은 이 기록과 git 이력에 남습니다.

## 과정 전체에 걸친 수정

- **해설의 선택지 문자 참조 13문제.** 객관식 선택지는 섞여서 번호(1~5)로 보이는데, 해설이 "(b)", "b와 c", "정답은 a"처럼 저작 ID로 가리켰습니다. 모두 선택지 내용으로 고쳤습니다.
- **YAML 주석으로 잘린 체크 설명 4개.** `description: 카드 제목의 글자 색이 #1d4ed8이어야 합니다.`처럼 따옴표 없는 값 안의 ` #`은 YAML 주석이라, 학습자에게 "카드 제목의 글자 색이"까지만 보였습니다. 따옴표로 감쌌습니다. 스키마 검사로는 잡히지 않는 실수라 작성 시 주의가 필요합니다.
- **해설 안의 표 2개.** 문제 지문·해설용 Markdown(`apps/web/src/features/practice/Markdown.tsx`)은 표를 지원하지 않아 `| … |` 줄이 그대로 이어 붙어 보입니다. `cascade.fill-count-specificity`와 `responsive.fill-which-color`의 표를 목록으로 바꿨습니다.
- **힌트 3이 정답을 그대로 주던 7문제 완화**: `intro.web-fix-broken-rule`, `selectors.fill-group-selector`, `selectors.web-first-child`, `cascade.web-inherit-card-color`, `typography.fill-line-height-px`, `flex-basics.web-menu-row`, `flex-basics.fill-center-both`. 반응형 웹 실습 2개는 힌트 2·3을 합치면 답 전체가 되던 것을 고쳤습니다.
- **배우지 않은 개념.** HTML 과정은 `class`·`id` 속성을 따로 가르치지 않는데, CSS 첫 단원의 예제와 실습이 `.notice` 같은 클래스 선택자를 썼습니다. 첫 단원 두 번째 예제 앞에 "`class` 속성은 이름표, 점으로 시작하는 선택자로 고른다"를, 선택자 단원에 `class`·`id` 속성 설명을 한 문단 추가했습니다. 반응형 레슨 예제와 실습 시작 코드의 `flex: 1`(가르치지 않음)에는 "남는 공간을 똑같이 나눠 갖는다"는 설명과 주석을 붙였습니다.
- 레슨에서 웹사이트 사용자를 "학습자"라고 쓴 곳 4군데를 "사용자"·"페이지를 보는 사람"으로 고쳤습니다.

## 초안 작성자 메모 확인

- **`web-tag-badges`의 레이아웃 비교(맞음).** Chromium에서 `<span style="width:80px">`의 `getComputedStyle().width`는 `"80px"`, 실제 상자 너비는 8px였습니다. CSSOM 규칙상 `width`가 적용되지 않는 요소(인라인 비대체 요소)는 사용값이 아니라 계산값을 돌려주기 때문입니다. 그래서 80px 안내선과 너비를 비교하는 `layout fills-width`가 맞는 방법입니다. `display: block`은 실패, `inline-block`·`inline-flex`는 통과하는 것을 확인했습니다. `right-of`는 가로 위치만 비교하므로 `same-row` 체크를 하나 더했습니다.
- **채점할 수 없던 조건은 체크로 바꿨습니다.**

| 문제 | 초안의 빈틈 | 바꾼 채점 |
|---|---|---|
| `cascade.web-fix-warning-color` | "선택자만" 고치라는데 `!important`도 통과 | 맨 아래에 `#schedule li.past` (1, 1, 1) 규칙과 "지난 일정"을 두어, 명시도를 (1, 0, 1)보다 높이되 (1, 1, 1)을 넘지 않는 선택자만 통과. `!important`는 지난 일정까지 빨갛게 만들어 실패 |
| `cascade.web-inherit-card-color` | "선언 하나만"을 채점할 수 없어 `.card h2, .card p, .card li`도 통과 | 카드에 바로 들어 있는 글자("문의: 안내 데스크")를 넣어 `.card` 자신의 색을 확인하고, 카드 밖 문단은 그대로인지 확인. 상속을 쓰지 않는 답과 `body` 답이 실패. 지문의 "하나만"은 "하나면 충분해요"로 완화 |
| `cascade.web-button-order` | "선택자는 바꾸지 말고"를 채점할 수 없음 | 중요한 버튼("게시")을 하나 더 두어 `#save {}`처럼 한 버튼만 고르는 답이 실패. 지문은 "새로 쓰지 않고도 고칠 수 있어요"로 완화 |
| `units-colors.web-rem-heading` | `32px`도 통과 | 시작 코드에 "900px 이상에서 루트 20px" 규칙을 주고 375px(32px)·1280px(40px) 두 너비에서 채점. `px`와 `em`이 실패. 미디어 쿼리는 읽기만 하면 된다고 안내 |
| `typography.web-fix-line-height` | `27px`도 통과 | 글 상자 안에 24px 제목을 두어 제목 36px·문단 27px을 모두 확인. `27px`·`1.5em`·`150%`는 27px이 물려져 실패하고, 단위 없는 `1.5`만 통과 |
| `intro.web-style-all-tips` | 팁마다 `style` 속성을 붙여도 통과 | 두 번째·세 번째 팁에 `style` 속성이 없는지 `dom` 체크 |
| `flex-basics.web-nav-gap` | margin으로 만든 간격도 통과(해설은 실패한다고 설명) | 마지막 메뉴의 `margin-right`가 0인지 확인 |
| `responsive.web-cards-row-on-wide` | `min-width: 601px`도 통과 | 정확히 600px에서도 가로인지 확인 |
| `responsive.web-mobile-first-page` | 데스크톱 우선 답도 통과 | 결과가 모든 너비에서 같아 구별할 수 없음. 경계 960px에서도 확인해 흔한 `max-width: 960px` 실수는 실패하게 하고, 지문에 "채점은 결과만 보므로 모바일 우선으로 썼는지는 스스로 확인"이라고 밝힘 |

## 단원별 검토 요약

### css.basics.intro

레슨과 문제 7개를 승인했습니다. 일반 개념 기준(예제 3개 중 예측 1개, 오개념 4개 모두 `<Pitfall>`, 확인 문제 2개, 실전 사례)을 충족합니다.

- 레슨: 클래스 선택자 안내 추가(위 참고).
- `web-style-all-tips`: `dom` 체크 추가, L3 → L2. `mcq-inline-scope`: L2 → L1(루브릭 합 2).
- `web-fix-broken-rule`: 힌트 3이 고칠 곳 두 군데를 그대로 알려 줌 → 볼 줄과 규칙만 알려 주도록 완화.

### css.basics.selectors

레슨과 문제 10개를 승인했습니다.

- 레슨: `class`·`id` 속성 설명 추가. 두 번째 예제 안내의 "링크 목록 두 개"(링크가 아님)를 고쳤습니다.
- `web-menu-only`: `.menu > li`(하위 메뉴 배경 빠짐), `.menu, li`, `ul li`가 모두 실패하는 것을 확인했습니다.
- `web-first-child`: `li :first-child`(공백)가 실패하는 것을 확인. 힌트 3 완화, L3 → L2. `mcq-multiple-classes`: L2 → L1.

### css.basics.cascade

레슨과 문제 10개를 승인했습니다. 명시도 표(`nav .menu a:hover` = (0, 2, 2) 등)와 상속 목록이 정확합니다.

- 레슨: "물려받은 값은 그 요소를 고르는 규칙이 하나도 없을 때만 쓰여요"는 다른 속성을 정하는 규칙이 있어도 상속되므로 부정확 → "그 속성을 정하는 규칙이 하나도 없을 때"로 고침. 개발자 도구 안내의 "명시도 순서로 보여요"를 "이기는 규칙부터"로 고침.
- 웹 실습 3개의 채점 보강(위 표). `web-fix-warning-color`는 L3 → L4(개념 3개·세 규칙 추적·함정 2개, 합 7).

### css.box.display

레슨과 문제 8개를 승인했습니다. 블록·인라인 표, 마진 상쇄, inline-block 설명을 Chromium에서 확인했습니다.

- `web-tag-badges`: `same-row` 체크 추가.
- `fill-margin-collapse`: L2 → L1. `fill-side-menu-block`은 `display: flex`·`list-item`도 통과하는데, 둘 다 실제로 링크마다 한 줄을 채우므로 정답으로 둡니다.

### css.styling.units-colors

레슨과 문제 8개를 승인했습니다. `#ff8000` = `rgb(255 128 0)`, `em` 중첩, `%`와 `vw` 계산이 정확합니다.

- `web-rem-heading`: 두 너비 채점으로 바꿈(위 표), L2 → L3.

### css.styling.typography

레슨과 문제 7개를 승인했습니다.

- **`web-center-card` 해설의 계산 오류.** "페이지에 320px이 남아 160px씩"이었지만 카드는 `280 + 32(padding) + 4(border) = 316px`을 차지해 284px이 남고 142px씩입니다(Chromium에서 142px 확인). 고쳤습니다.
- `web-fix-line-height`: 제목을 더해 단위 없는 값만 통과하게 바꿈(위 표). 레슨 실전 사례의 "글자 크기가 다른 요소에서도 다시 계산돼요"와 같은 내용을 실습으로 확인하게 됐습니다.
- `web-title-font`·`fill-generic-font`·`fill-line-height-px`: L2 → L1(루브릭 합 2).

### css.layout.flex-basics

레슨과 문제 12개를 승인했습니다. `flex-direction: column`에서 `justify-content`가 세로를 맡는다는 설명(레슨 예제 2, `mcq-justify-in-column`)이 정확합니다.

- `fill-center-both`: 두 빈칸의 순서를 바꿔도 결과가 같아 정답인데, `misconceptionMap`이 바꾼 답을 오개념으로 표시하도록 되어 있었음 → 삭제. 힌트 2·3이 합쳐 답 전체가 되던 것을 완화.
- `web-nav-gap`: 2차 검토 반영(위 참고). `web-header-bar`는 로고에 `margin-right: auto`를 주는 답도 통과하는 것을 확인했습니다.
- `mcq-vertical-center-row`: 축 판단과 속성 선택 두 개념이 필요해 L1 → L2. `fill-main-cross-axis`: L2 → L1.

### css.layout.responsive

레슨과 문제 8개를 승인했습니다. `min-width`·`max-width`의 경계 포함 여부, 뷰포트 메타 태그가 하는 일과 하지 않는 일이 정확합니다.

- 레슨: `flex: 1` 설명 추가.
- 웹 실습 2개의 경계 채점 보강(위 표). `web-mobile-first-page`: L3 → L4(개념 3개·구조 바꾸기·미디어 쿼리, 합 7). `mcq-media-query-not-working`: 980px로 그리는 상황을 추적해야 해 L2 → L3.
- 러너가 체크마다 뷰포트를 바꿔 채점하므로 D-040의 "뷰포트별 검사 미룸" 조건은 해당하지 않습니다. 실제로 375·600·960·1280px 체크가 각각 다르게 판정되는 것을 오답 실행으로 확인했습니다.

## 최종 문제 구성

승인된 문제 70개, 미승인 0개입니다. 단원별 승인 수는 `practice.targetCount`와 같습니다. 문제 ID는 바꾸거나 지우지 않았습니다.

### 유형별 수 (CSS는 D-028에 따라 세 유형만)

| 단원 | mcq_single | fill_blank | web_task | 합계 (목표) |
|---|---|---|---|---|
| intro | 4 | 1 | 2 | 7 (7) |
| selectors | 6 | 1 | 3 | 10 (10) |
| cascade | 6 | 1 | 3 | 10 (10) |
| display | 4 | 2 | 2 | 8 (8) |
| units-colors | 3 | 3 | 2 | 8 (8) |
| typography | 2 | 2 | 3 | 7 (7) |
| flex-basics | 5 | 3 | 4 | 12 (12) |
| responsive | 4 | 2 | 2 | 8 (8) |
| 합계 | 34 | 15 | 21 | 70 |

### 난이도 (목표: HTML/CSS 핵심 L1 30 · L2 40 · L3 25 · L4 5 · L5 0)

| 단원 | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| intro | 3 | 3 | 1 | 0 |
| selectors | 4 | 4 | 2 | 0 |
| cascade | 3 | 5 | 1 | 1 |
| display | 3 | 3 | 2 | 0 |
| units-colors | 3 | 3 | 2 | 0 |
| typography | 4 | 1 | 2 | 0 |
| flex-basics | 3 | 6 | 2 | 1 |
| responsive | 2 | 3 | 2 | 1 |
| 합계 | 25 (36%) | 28 (40%) | 14 (20%) | 3 (4%) |

초안은 L1 19 · L2 34 · L3 16 · L4 1(27/49/23/1%)이었습니다. 루브릭 합계로 다시 매겨 14문제를 바꿨습니다.

- 내림(9): `intro.web-style-all-tips` 3→2, `intro.mcq-inline-scope` 2→1, `selectors.mcq-multiple-classes` 2→1, `selectors.web-first-child` 3→2, `display.fill-margin-collapse` 2→1, `typography.web-title-font`·`fill-generic-font`·`fill-line-height-px` 2→1, `flex-basics.fill-main-cross-axis` 2→1
- 올림(5): `cascade.web-fix-warning-color` 3→4, `units-colors.web-rem-heading` 2→3, `flex-basics.mcq-vertical-center-row` 1→2, `responsive.mcq-media-query-not-working` 2→3, `responsive.web-mobile-first-page` 3→4. 올린 문제는 대부분 채점을 바꾸면서 실제로 요구가 늘어난 문제입니다.

L2 편중은 풀렸고 L4는 3개(4%)로 목표에 가깝습니다. L3이 20%로 목표보다 조금 적고 L1이 조금 많지만, 맞추려고 난이도를 올리지는 않았습니다.

### 주 개념별 수 (HTML/CSS 최소 2)

모든 주 개념이 2~4문제로 최소를 채웁니다. 개념마다의 수와 L3 이상 수는 다음과 같습니다.

| 개념 | 수 | L3+ | 개념 | 수 | L3+ |
|---|---|---|---|---|---|
| `intro.rule-structure` | 4 | 1 | `units.length` | 3 | 0 |
| `intro.linking` | 3 | 0 | `units.rem-em` | 3 | 2 |
| `selectors.basic` | 3 | 0 | `colors.notation` | 2 | 0 |
| `selectors.combinators` | 4 | 1 | `type.font-properties` | 3 | 0 |
| `selectors.pseudo-class` | 3 | 1 | `type.line-height` | 2 | 1 |
| `cascade.specificity` | 4 | 1 | `type.text-align` | 2 | 1 |
| `cascade.order` | 3 | 0 | `flex.container` | 3 | 0 |
| `cascade.inheritance` | 3 | 1 | `flex.axes` | 3 | 0 |
| `display.block-inline` | 3 | 0 | `flex.justify-align` | 4 | 2 |
| `display.inline-block` | 2 | 1 | `flex.gap` | 2 | 1 |
| `display.normal-flow` | 3 | 1 | `responsive.viewport-meta` | 2 | 1 |
| | | | `responsive.media-queries` | 3 | 1 |
| | | | `responsive.mobile-first` | 3 | 1 |

## 렌더링 확인

레슨 8개를 1280px·390px로 캡처했습니다(390px 가로 넘침은 앱 문제로, 남은 한계 참고). 표, `<Pitfall>`, `<RunnableExample>`, 텍스트 다이어그램, 레슨 안 확인 문제가 정상으로 보였고, 화면 글자에 남은 `**` 표시는 없었습니다(조사 앞 굵게도 `remark-cjk-friendly`로 정상). 실습 모드의 웹 실습 21개는 참조 정답을 입력하면 모두 정답으로 채점됐습니다.

## 남은 한계와 후속 제안

1. **L3 이상 문제가 없는 주 개념이 9개입니다**(`intro.linking`, `selectors.basic`, `cascade.order`, `display.block-inline`, `units.length`, `colors.notation`, `type.font-properties`, `flex.container`, `flex.axes`). 숙련 단계 게이트(L3 이상 1문제)를 채울 수 없으니, 이 개념들은 M6 단원 평가나 다음 개정에서 요구사항 해석형 웹 실습을 더하길 권합니다. 루브릭을 무시하고 난이도만 올리지는 않았습니다.
1. **`responsive.viewport-meta`에는 실습 유형이 없습니다.** 미리보기 iframe에서는 메타 태그의 효과(축소 끄기)를 재현할 수 없어 객관식 2개로만 다룹니다.
1. **"모바일 우선으로 썼는가"는 채점할 수 없습니다.** 모바일 우선과 데스크톱 우선은 모든 너비에서 결과가 같습니다. 지문에 이를 밝혔고, 흔한 경계 실수만 잡습니다. `static` 체크로 CSS 구조를 볼 수 있게 되면 다시 검토할 만합니다.
1. **아직 결과로 막지 못하는 다른 풀이**: `cascade.web-fix-warning-color`의 `#schedule #w1, #schedule #w2`(ID로 하나씩 고르기), `typography.web-fix-line-height`의 제목·문단별 px 규칙. 둘 다 결과는 맞는 답이라 해설에서 더 나은 방법을 설명합니다.
1. **문제 지문·해설 Markdown이 표를 지원하지 않습니다.** CSS 문제의 표는 목록으로 바꿨지만, 이미 승인된 `css.box.model.fill-shorthand-four-values`와 JS 문제 일부(예: `js-basics.control` 모듈)의 지문·해설에도 표가 있습니다. 렌더러에 표를 더하거나 콘텐츠를 고치는 후속 작업이 필요합니다.
1. **검토 중 본 앱 문제 두 가지는 #80에서 고쳐졌습니다.** 검토 빌드에서는 문제의 `code` 필드 머리에 "출력"이 나오고, 390px에서 레슨 본문 상자가 가장 넓은 코드 블록만큼 늘어나 가로로 넘쳤습니다(JS 레슨도 같음). 둘 다 콘텐츠가 아니라 앱 쪽 원인이라 콘텐츠는 고치지 않았고, 이 브랜치를 #80 위로 옮긴 뒤 다시 캡처하지는 않았습니다.
1. **복습용 템플릿과 `rubric` 필드가 없습니다.** 이전 검토와 같은 한계입니다. 난이도 근거는 이 기록에 남겼습니다.
1. **같은 체크 설명 실수의 재발 방지.** 따옴표 없는 YAML 값 안의 ` #`이 주석이 되는 문제는 `content-cli`가 잡지 못합니다. 체크 `description`이 `#`으로 끝나는 색 값 앞에서 잘리는지 검사하는 규칙을 더하면 좋겠습니다.
