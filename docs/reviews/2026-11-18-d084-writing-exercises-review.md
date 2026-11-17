# D-084 HTML/CSS 작성형 문제 AI 교차 검토 기록 (2026-11-18)

[D-084](/docs/decisions.md)(작성형 문제: 단원 연습 세트 보장과 "직접 작성" 배지)와 함께, HTML·CSS 과정에 넣은 작성형 `web_task` 11개를 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
11개 모두 고친 뒤 승인했습니다. 체크가 지문의 요구를 놓치거나 맞는 답을 떨어뜨린 문제가 5개(`page-buttons`, `notice-banner`, `jump-rope-table`, `club-links`, `nav-footer`) 있었고, 나머지는 주로 힌트 3이 정답 코드를 그대로 주던 것을 고쳤습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-18
- 관련 문서: [콘텐츠·문제 시스템 설계 web_task](/docs/design/content-and-exercises.md#web_task-웹-실습), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [D-081 HTML/CSS 개념 보충 문제 검토](2026-11-17-d081-htmlcss-concept-items-review.md)

## 배경과 검토 범위

학습자가 "문제들이 코드 수정, 객관식, 단답형인데 직접 코드를 처음부터 써 보는 문제는 없나?"라고 물었습니다.
HTML·CSS 과정의 `web_task`는 거의 모두 미리 쓰인 페이지를 고치거나 채우는 문제였습니다.
D-084는 시작 코드에서 실습의 초점 부분이 비어 있는 `web_task`를 작성형으로 보고(`webTaskStartsEmpty`), 단원 연습 세트에 작성형을 최소 1개 넣습니다.
작성자(`ai:claude`)는 기존 문제 4개를 빈 시작 코드로 바꾸고 새 문제 7개를 썼습니다. 파일에는 `review.status: approved`, `reviewedBy: ai:reviewer`가 미리 적혀 있었고, 이 검토가 그 승인을 확정합니다.

| 과정 | 단원 | 문제 | 구분 | 초점 |
|---|---|---|---|---|
| HTML | `document` | `web-skeleton` | 바꿈 | html |
| | `links-images` | `web-club-links` | 바꿈 | html |
| | `lists-tables` | `web-write-jump-rope-table` | 새 문제 | html |
| | `forms` | `web-search-form` | 바꿈 | html |
| | `landmarks` | `web-nav-footer` | 바꿈 | html |
| CSS | `intro` | `web-write-style-element` | 새 문제 | css |
| | `display` | `web-write-page-buttons` | 새 문제 | css |
| | `units-colors` | `web-write-notice-banner` | 새 문제 | css |
| | `typography` | `web-write-article-text` | 새 문제 | css |
| | `responsive` | `web-write-title-size-query` | 새 문제 | css |
| | `responsive` | `web-write-menu-mobile-first` | 새 문제 | css |

함께 `debugging: true`가 붙은 기존 "고치기" 문제 9개도 가볍게 확인했습니다(아래 "디버깅 표시 확인").

## 검토 방법

1. 작성자의 설명을 보지 않고, 작성 가이드(유형별 스펙, 검토와 승인, 제품 이름 표기, 수량 기준), 설계 문서의 `web_task` "작성형" 항목과 품질 체크리스트, `webTaskStartsEmpty` 구현, 각 단원의 `lesson.mdx`만 읽었습니다.
1. 파일마다 체크리스트를 확인했습니다. 그 단원과 앞 단원이 가르친 범위 안인지, 난이도 표시가 맞는지, 지문의 요구가 모두 체크되고 지문에 없는 것은 체크하지 않는지, 맞는 다른 답이 통과하고 그럴듯한 오답이 실패하는지, 힌트 3단계가 너무 일찍 정답 전체를 주지 않는지, 해설이 이유를 설명하는지, `misconceptionIfFail`이 그 오개념을 가진 학습자의 실패에만 붙는지, 문체가 이웃 문제와 맞는지, 체크가 결정적인지 봤습니다. 작성형은 빈 칸에서 시작해 시작 코드 실패 검증을 저절로 통과하므로, 순서·위치·개수 조건을 특히 확인했습니다.
1. **대체 답안 시험.** HTML·CSS 과정만 스크래치 폴더로 복사하고(`pack.yaml`에서 `js-basics` 제외, JS 개념·오개념 파일 제거), 참조 정답 자리에 다른 답안 75개를 넣은 복제 문제를 만들어 `node tools/content-cli/src/cli.ts check --dir <복사본> --run`을 돌렸습니다. 첫 실행에서 기대와 다른 결과 1개(`page-buttons`의 `display` 없는 답안이 통과)를 찾아 체크를 고쳤고, 고친 뒤 다시 돌려 75개 모두 기대와 일치했습니다(아래 표는 고친 뒤 결과). 원래 문제는 하나도 실패하지 않았습니다.
1. 고친 뒤 `pnpm content:check:run`을 실행했습니다(아래 "검증 결과").

### 대체 답안 시험 결과

실패 열에는 실패한 체크 ID를 적었습니다.

| 문제 | 대체 답안 | 기대 | 결과 |
|---|---|---|---|
| `document.web-skeleton` | `html`·`head`·`body` 태그 생략(브라우저가 넣음) | 통과 | 통과 |
| | `charset="UTF-8"` | 통과 | 통과 |
| | doctype 생략 | 통과 | 통과(채점하지 않는다고 지문에 밝힘) |
| | `title`을 `body`에 | 실패 | 실패(`tab-title`, `no-title-in-body`) |
| | `lang` 없음 | 실패 | 실패(`lang-ko`) |
| | `lang`을 `body`에 | 실패 | 실패(`lang-ko`) |
| | 제목과 문단 순서 뒤바뀜 | 실패 | 실패(`paragraph`) |
| `links-images.web-club-links` | `./photos.html`, `./join.html` | 통과 | 통과 |
| | 외부 링크에 `target="_blank"` | 통과 | 통과 |
| | 링크 세 개를 문단 하나에 | 실패 | 실패(`link-paragraphs`, 이번에 추가한 체크) |
| | 링크 글자에 주소를 씀 | 실패 | 실패(`photos`) |
| | 외부 주소에 `https://` 빠짐 | 실패 | 실패(`class`) |
| | `a`가 `p`를 감쌈 | 실패 | 실패(`photos`, `link-paragraphs`) |
| `lists-tables.web-write-jump-rope-table` | `tbody` 태그 생략(브라우저가 넣음) | 통과 | 통과 |
| | `caption` 추가 | 통과 | 통과 |
| | 제목 칸을 `td`+`strong`으로 | 실패 | 실패(`header-cells` 외 2개) |
| | `thead` 없이 제목 행 | 실패 | 실패(5개) |
| | 열 순서 뒤바뀜 | 실패 | 실패(8개) |
| | 첫 행 기록 오타(`102회`) | 실패 | 실패(`first-row-record`, 이번에 추가) |
| | 첫 행만 칸 순서 뒤바뀜 | 실패 | 실패(`first-row-name`, `first-row-record`, 이번에 추가) |
| `forms.web-search-form` | `label`이 `input`을 감쌈 | 통과 | 통과 |
| | `button`의 `type` 생략 + `method="get"` | 통과 | 통과 |
| | `label`에 `for` 없음 | 실패 | 실패(`label-for`) |
| | `type="button"` | 실패 | 실패(`button-submits`) |
| | 입력칸이 `form` 밖 | 실패 | 실패(`input-in-form`) |
| | `name` 없음 | 실패 | 실패(`input-name`) |
| | `type="text"` | 실패 | 실패(`input-type`) |
| `landmarks.web-nav-footer` | `./index.html`, `./flowers.html` | 통과 | 통과(고친 뒤. 고치기 전 체크는 이 답을 떨어뜨림) |
| | `main` 안을 `section`으로 한 번 더 묶음 | 통과 | 통과 |
| | `nav`를 `header` 밖에 | 실패 | 실패(`nav-in-header`) |
| | `footer`가 `main` 앞 | 실패 | 실패(`landmark-order`) |
| | `main` 대신 `div` | 실패 | 실패(4개) |
| | `main` 두 개 | 실패 | 실패(`one-main` 외 1개) |
| | `ul` 대신 `ol` | 실패 | 실패(`nav-in-header`, `nav-items`) |
| `intro.web-write-style-element` | 한 줄로, 마지막 세미콜론 생략 | 통과 | 통과 |
| | `rgb(0, 0, 128)` | 통과 | 통과 |
| | `style` 속성으로 | 실패 | 실패(`no-inline-style`) |
| | `p` 전체에 18px | 실패 | 실패(`phone-unchanged`) |
| | `style` 요소를 `body`에 | 실패 | 실패(`style-in-head`) |
| | `color: "navy"`(따옴표) | 실패 | 실패(`title-navy`) |
| `display.web-write-page-buttons` | `background-color` | 통과 | 통과 |
| | `display: inline-flex` | 통과 | 통과 |
| | `display: block` | 실패 | 실패(`takes-size`, `same-row-12`, `same-row-23`) |
| | `display` 없음 | 실패 | 실패(`takes-size`, 이번에 추가. 고치기 전에는 **통과**) |
| | `height` 빠뜨림 | 실패 | 실패(`size`) |
| `units-colors.web-write-notice-banner` | `rgb()` 쉼표 + `background-color` | 통과 | 통과 |
| | 16진수 `#fef3c7` | 통과 | 통과(표기 조건은 채점 불가, 아래 "남은 한계") |
| | `padding: 16px` | 통과 | 통과 |
| | `.page .notice` 선택자 + 빈 `.page` 규칙 | 통과 | 통과 |
| | `width: 50vw` | 실패 | 실패(두 화면 모두) |
| | `width: 632px` | 실패 | 실패(375px 화면) |
| | `.page` 600px + `.notice` 300px(고치기 전 문제의 정답) | 실패 | 실패(두 화면 모두) |
| | `padding: 16`(단위 없음) | 실패 | 실패(`padding`) |
| | `rgb()` 값을 0~100으로 착각 | 실패 | 실패(`background`) |
| `typography.web-write-article-text` | `p`·`h2`에 각각 `1.6`, `h2` 선택자 | 통과 | 통과 |
| | `font-size: 18PX` | 통과 | 통과 |
| | `line-height: 1.6em` | 실패 | 실패(`heading-line-height`) |
| | `line-height: 160%` | 실패 | 실패(`heading-line-height`) |
| | `line-height: 28.8px` | 실패 | 실패(`heading-line-height`) |
| | 글 상자 전체 가운데 정렬 | 실패 | 실패(`paragraph-left`) |
| | `"sans-serif"`(따옴표) | 실패 | 실패(`font-family`) |
| | `serif` | 실패 | 실패(`font-family`) |
| `responsive.web-write-title-size-query` | 데스크톱 우선 `max-width: 767px` | 통과 | 통과 |
| | `min-width: 48em` | 통과 | 통과 |
| | `h1` 선택자 | 통과 | 통과 |
| | `min-width: 769px` | 실패 | 실패(`boundary`) |
| | `max-width: 768px` 안에 40px | 실패 | 실패(3개) |
| | 미디어 쿼리를 기본 규칙 앞에 | 실패 | 실패(`boundary`, `desktop`) |
| `responsive.web-write-menu-mobile-first` | 데스크톱 우선 `max-width: 699px` | 통과 | 통과(방식 조건은 채점 불가, 지문에 밝힘) |
| | `row-gap`·`column-gap` 따로 | 통과 | 통과 |
| | `min-width: 701px` | 실패 | 실패(`row-at-700`) |
| | `display: flex`를 `.item`에 | 실패 | 실패(5개) |
| | `column` 빠뜨림 | 실패 | 실패(`stacked-on-phone`, `gap-on-phone`) |
| | `max-width: 700px` 안에 `row` | 실패 | 실패(4개) |
| | `gap` 대신 `.item`에 `margin-bottom` | 실패 | 실패(`gap-on-desktop`) |

## 판정 요약

| 판정 | 수 | 파일 |
|---|---|---|
| 그대로 승인 | 0 | — |
| 고친 뒤 승인 | 11 | 전부 |
| 거부·보류(`draft`) | 0 | — |

체크를 고친 것이 4개(`club-links`, `nav-footer`, `jump-rope-table`, `page-buttons`), 지문·참조 정답·체크·힌트·해설을 다시 쓴 것이 1개(`notice-banner`), 오개념 연결을 옮긴 것이 1개(`menu-mobile-first`)입니다. 힌트 3은 `club-links`를 뺀 10개에서 고쳤습니다. 난이도 표시는 11개 모두 맞아 바꾸지 않았습니다.

**힌트 3 공통 수정.** 9개의 힌트 3이 참조 정답의 코드를 거의 그대로 주고 있었고, `jump-rope-table`은 제목 행 전체와 데이터 행 하나를 줬습니다. 작성형은 빈 칸에서 시작하므로 힌트 3이 정답 코드를 주면 "보고 베끼기"가 되어 작성형의 의미가 없어집니다. D-081 검토와 같은 기준으로, 힌트 3에는 구조(무엇을 어디에, 어떤 순서로)와 판단 기준만 남기고 값을 조립한 완성 코드는 뺐습니다. `club-links`(세 링크 중 하나의 예)와 고친 `jump-rope-table`(네 행 중 데이터 행 하나의 예)은 일부만 보여 주는 수준이라 L3 "거의 답"으로 허용했습니다.

## 파일별 판정과 수정 내용

### HTML

| 문제 | 판정 | 판단과 고친 내용 |
|---|---|---|
| `document.web-skeleton` | 고침 | 레슨이 뼈대 전체와 `lang`·`meta charset`을 가르쳐 범위 안. 빈 파일에서 뼈대 전체를 쓰므로 난이도 2→3이 맞음. doctype은 DOM으로 확인할 수 없어 채점하지 않는다고 지문에 밝힌 것이 정직함. 생략 가능한 태그(`html`·`head`·`body`)를 빼도 브라우저가 넣어 통과하는데, 레슨의 "DOM 고치기" 예제 내용과 맞아 허용. **힌트 3**이 doctype·`html lang`·`meta`·`title` 줄을 그대로 줌 → 열고 닫는 순서와 `meta`가 닫는 태그 없는 요소라는 점, `charset` 속성만 남김 |
| `links-images.web-club-links` | 고침 | 지문은 "문단 세 개를 두고, 각 문단의 글자를 링크로"인데, 세 링크를 문단 하나에 넣어도 통과했음(빈 칸에서 시작해 생긴 틈) → `h2 ~ p:has(> a)` 3개 체크 `link-paragraphs` 추가(`link-count` 3개와 함께 "문단마다 링크 하나"를 확인). `./` 접두 경로는 원래부터 허용. "문서의 뼈대부터 쓰고"는 과정 안내라 채점하지 않음(뼈대는 앞 단원 문제가 채점). 힌트 3은 세 링크 중 하나의 예라 유지 |
| `lists-tables.web-write-jump-rope-table` | 고침 | 레슨이 `thead`·`tbody`·`th`·`td`를 가르쳐 범위 안, 난이도 3 맞음. 데이터 칸 6개 중 3개(서준의 두 칸, 하윤의 기록)만 내용을 확인해 첫 행 오타나 첫 행만 칸을 뒤바꾼 답이 통과했음 → 숨김 체크 `first-row-name`·`first-row-record`·`last-row-name` 추가(설명 문구도 칸 단위로 맞춤). `tbody`를 생략해도 브라우저가 넣어 통과하는 것은 허용. **힌트 3**이 제목 행 전체와 데이터 행 하나를 줌 → 데이터 행 하나의 예와 "제목 행은 칸 요소만 다르다"만 남김. `th-is-bold-td` 연결은 `td`로 제목 칸을 쓴 실패에 맞음 |
| `forms.web-search-form` | 고침 | 체크가 요구 5개(제목, `form action`, 입력칸의 `id`·`type`·`name`, 이름표 연결, 보내는 버튼)를 모두 확인. `label` 감싸기와 `for`/`id` 두 방법 모두 통과하고, `type` 없는 `button`도 통과. 레슨이 다루지 않은 `<input type="submit">`은 실패하지만 지문이 "버튼"을 요구해 허용. **힌트 3**이 네 요소의 여는 태그를 모두 줌 → 각 요소에 들어갈 속성과 `for`가 무엇과 같아야 하는지 묻는 형태로 완화 |
| `landmarks.web-nav-footer` | 고침 | 링크 체크가 `href="index.html"`만 받아 `./index.html`(같은 뜻, 앞 단원 해설이 "같은 뜻"이라고 가르침)이 실패했음 → 두 링크 체크 모두 `./` 형태도 받도록 선택자 확장. 구역 순서 체크(`order`)는 부분 순서 비교라 `main` 앞뒤의 다른 요소에 영향받지 않음을 확인. **힌트 2**가 요소 이름을 대응시키고 **힌트 3**이 `header` 안 코드를 그대로 줘 둘을 합치면 정답 전체 → 힌트 3을 "body 바로 안에는 구역 세 개, 메뉴는 머리말 안 제목 다음" 같은 배치 설명으로 바꿈 |

### CSS

| 문제 | 판정 | 판단과 고친 내용 |
|---|---|---|
| `intro.web-write-style-element` | 고침 | 시작 코드에 `style` 요소가 아예 없어 요소부터 만들게 하는 점이 기존 `web-write-rule`(빈 `style`이 주어짐)과 다름. `head > style`, `style` 속성 금지, 다른 문단 유지, HTML 유지가 지문 조건과 일치. 난이도 2 맞음. **힌트 3**이 `h1 { color: navy; }`를 그대로 줌(힌트 2가 선택자 두 개를 이미 줌) → 다른 선택자·속성의 예(`p { color: red; }`)와 `font-size` 속성 이름만 남김 |
| `display.web-write-page-buttons` | 고침 | **체크 결함.** Chromium의 `getComputedStyle`은 인라인 요소에도 선언한 `width: 40px`을 그대로 돌려줘, `display`를 바꾸지 않은 답(이 문제가 겨냥한 바로 그 실수)이 모든 체크를 통과했음. 계산값 체크로는 "크기가 실제로 적용되는지"를 알 수 없어서, `display`가 `inline-block`·`inline-flex`·`inline-grid` 중 하나인지 보는 체크 `takes-size`를 추가하고 `css.mc.width-on-inline` 연결을 `size`에서 이 체크로 옮김(크기 값을 잘못 쓴 실패는 그 오개념이 아님). **힌트 3**이 네 선언을 모두 줌 → `display` 값을 "바깥은 인라인, 안은 블록"으로만 설명 |
| `units-colors.web-write-notice-banner` | 고침 | **지문 요구 미채점.** 고치기 전에는 학습자가 `.page`를 `600px`로 고정한 뒤 `.notice`를 `%`로 쓰라고 했는데, 부모 너비가 하나뿐이라 `300px`도 통과해 "`%`로 쓰세요"를 확인할 수 없었음. `.page`의 너비를 학습자가 정하지 않게 바꿔(바깥 상자가 화면 너비에 따라 변함) 1280px·375px 두 화면에서 공지 띠가 바깥 상자의 절반(632px·179.5px)인지 확인하도록 지문·참조 정답·체크(`page-width` 삭제, `half-width` → `half-width-wide`·`half-width-narrow`)를 고침. 이제 `50vw`와 px 고정값은 실패함. `body` 기본 여백(8px)은 해설에서 설명(체크 설명에는 숫자를 쓰지 않음). 힌트 1~3과 해설을 새 구성에 맞춰 다시 씀 |
| `typography.web-write-article-text` | 고침 | 단위 없는 `line-height`의 상속은 레슨 "실전" 절에서 가르쳐 범위 안. 제목(27px)과 문단(18px)의 줄 높이를 따로 확인해 `1.6em`·`160%`·`28.8px`이 실패하는 것이 핵심이고 그대로 동작함. 따옴표 친 `"sans-serif"`는 일반 글꼴 이름이 아니라 실패하는 것이 맞음. "줄 높이 선언은 한 번만"은 채점하지 않음(각 요소에 `1.6`을 따로 줘도 결과가 같아 통과). **힌트 3**이 두 규칙을 모두 줌 → 규칙 구성과 "단위 없이 배수만"이라는 기준만 남김 |
| `responsive.web-write-title-size-query` | 고침 | 767px·768px 경계 체크로 `769px`·`max-width`·순서 실수가 모두 실패하고, `48em`·데스크톱 우선은 통과함(지문이 결과만 요구). **힌트 3**이 CSS 전체를 줌 → "기본 규칙 먼저, 그 아래 `min-width` 미디어 쿼리, 경계값은 지문 그대로"로 완화 |
| `responsive.web-write-menu-mobile-first` | 고침 | 세 화면 체크가 배치·간격·경계를 모두 확인함. 모바일 우선 방식 자체는 계산값으로 구분할 수 없다고 지문에 밝혀 둠. **오개념 연결 오류 2개**: `stacked-on-phone`의 `mobile-first-means-desktop-override`는 데스크톱 우선으로 쓴 답이 오히려 통과하므로 이 실패가 그 오개념을 뜻하지 않음 → 삭제. `row-at-700`의 `max-width-means-above`는 `max-width: 700px`으로 쓴 답이 700px에서는 통과하고 1280px에서 실패하므로 → `row-on-desktop`으로 옮김. **힌트 3**이 CSS 전체를 줌 → 기본 규칙의 선언 세 개와 미디어 쿼리의 선언 하나라는 구성만 남김 |

### 디버깅 표시 확인

`debugging: true`가 붙은 9개(`how-web-works.web-fix-brackets`, `intro.web-fix-broken-rule`, `selectors.web-fix-selectors`, `cascade.web-fix-warning-color`, `model.web-fix-side-by-side`, `units-colors.web-fix-missing-units`, `units-colors.web-fix-color-values`, `typography.web-fix-line-height`, `responsive.web-fix-query-order`)의 지문과 시작 코드를 읽었습니다. 모두 "의도대로 보이지 않는 페이지"(괄호로 쓴 태그, 문법 실수, 안 맞는 선택자, 명시도, `box-sizing`, 단위 누락, 잘못된 색 표기, 단위 붙은 줄 높이, 미디어 쿼리 순서)를 주고 원인을 찾아 고치게 하므로 D-069의 디버깅 뜻과 맞습니다. 고친 것은 없습니다. `document.web-fix-overlap`을 표시하지 않은 이유(단원의 구현 비율)는 작성자의 판단대로 두었습니다.

## 남은 한계

- **표기·방식 조건은 계산값으로 채점할 수 없습니다.** `notice-banner`의 "`rgb()`로 쓰세요"(16진수 `#fef3c7`도 통과), `menu-mobile-first`의 모바일 우선 방식, `article-text`의 "줄 높이 선언은 한 번만"은 결과가 같은 다른 답을 통과시킵니다. D-081 검토와 같이 받아들이고, `menu-mobile-first`는 지문에 이 점을 밝혀 두었습니다.
- **인라인 요소의 계산값.** `page-buttons`에서 보듯 `getComputedStyle`의 `width`·`height`는 인라인 요소에서도 선언값을 돌려줍니다. 크기가 실제로 적용되는지는 `display` 체크나 `layout` 체크로 확인해야 합니다. 이번 검토 범위 밖의 기존 문제는 따로 확인하지 않았습니다.
- `club-links`·`search-form`·`nav-footer`·`jump-rope-table`의 지문에 있는 "문서의 뼈대부터 쓰고"는 채점하지 않습니다. 뼈대는 `document.web-skeleton`이 채점합니다.

## 검증 결과

- 대체 답안 시험: 복제 문제 75개 모두 기대와 일치(통과 25, 실패 50). 첫 실행에서는 `page-buttons`의 `display` 없는 답안 1개가 기대와 달리 통과했고, 체크를 고친 뒤 다시 실행해 일치했습니다.
- 수정·승인 후 `pnpm content:check:run`: 실행 검증 문제 1153개·템플릿 변형 90개·예제 210개, 통과 1080, 실패 0, 정적 검사 오류 0개. 경고 1개는 알려진 `how-web-works`의 `unit-count-over`입니다.
