# D-081 HTML/CSS 개념 보충 문제 AI 교차 검토 기록 (2026-11-17)

[D-081](/docs/decisions.md)(단원 통과의 개념 조건 수정)과 함께, 승인 문제가 적고 쉬운 문제만 있던 개념 6개에 추가한 HTML·CSS 문제 13개를 독립 AI 검토자(`ai:reviewer`)가 검토한 기록입니다.
13개 모두 승인했고, 그중 8개는 힌트를 고친 뒤 승인했습니다.

- 상태: 완료
- 검토: 독립 AI 검토자 (`ai:reviewer`, [D-027](/docs/decisions.md))
- 검토일: 2026-11-17
- 관련 문서: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md), [콘텐츠 작성 가이드](/docs/guides/content-authoring.md), [M7 HTML/CSS 보충 문제 검토](2026-11-16-m7-htmlcss-review.md)

## 추가 배경과 검토 범위

D-081의 학습자 보고는 `html.web.client-server`처럼 승인 문제가 난이도 1~2짜리 3개뿐인 개념에서 나왔습니다.
세트를 다시 만들어도 같은 쉬운 문제가 반복되어 점수가 오르지 않았습니다.
D-081은 단원 통과의 개념 조건을 장기 숙련도 점수 대신 세트 안 성과로 판정하도록 바꿔 이 문제를 풀었고, 이 배치는 같은 모양의 작은 저난이도 개념 풀에 난이도 2~3의 문제를 더해 연습 풀 자체를 넓힙니다.

대상은 아래 13개 파일입니다. 모두 `review.status: draft`, `draftedBy: ai:claude`였습니다.

| 과정 | 단원 | 주 개념 | 새 문제 | 유형 |
|---|---|---|---|---|
| HTML | `how-web-works` | `html.web.client-server` | 3 | 복수 선택 1, 빈칸(text) 2 |
| | `text` | `html.text.emphasis` | 2 | 객관식 1, 웹 실습 1 |
| | `links-images` | `html.content.paths` | 2 | 웹 실습 2 |
| CSS | `model` | `css.box.areas` | 2 | 빈칸(code) 1, 웹 실습 1 |
| | `units-colors` | `css.units.length` | 2 | 객관식 1, 웹 실습 1 |
| | `typography` | `css.type.font-properties` | 2 | 객관식 1, 웹 실습 1 |

배치가 작고 모두 개념 문제라 **13개 모두 전수 검토**했습니다.

## 검토 방법

1. 초안 대화를 보지 않고, 작성 가이드(유형별 스펙, 검토와 승인, 제품 이름 표기), 설계 문서의 품질 체크리스트, 각 단원의 `lesson.mdx`, 이전 검토 기록만 읽었습니다.
1. 시작할 때 `pnpm content:check:run`을 직접 실행했습니다(오류 0개, 경고 6개: 여섯 단원의 "검토되지 않은 문제는 빌드에서 제외").
1. 파일마다 체크리스트를 확인했습니다. 정답이 하나로 정해지는지, 그 단원과 앞 단원이 가르친 범위 안인지, 난이도 표시가 맞는지, 힌트 3단계가 정답을 그대로 주지 않는지, 해설이 정답과 오답의 이유를 모두 설명하는지, 오개념 연결이 맞는지, `web_task` 체크가 지문 요구와 맞고 엉뚱한 답이 실패하는지를 봤습니다.
1. **대체 답안 시험.** HTML·CSS 과정만 스크래치 폴더로 복사하고(`pack.yaml`에서 `js-basics` 제외), 참조 정답 자리에 다른 답안 33개를 넣은 복제 문제를 만들어 `check --dir <복사본> --run`을 돌렸습니다. 기대(통과/실패)와 실제가 모두 일치했습니다(아래 표). 원래 문제는 하나도 실패하지 않았습니다.
1. 고친 뒤 `pnpm content:check:run`을 다시 실행했습니다(아래 "검증 결과").

### 대체 답안 시험 결과

| 문제 | 대체 답안 | 기대 | 결과 |
|---|---|---|---|
| `links-images.web-science-club-paths` | 사이트 맨 위 기준(`images/map.png`, `index.html`, `clubs/list.html`) | 실패 | 실패(체크 3개) |
| | 지도만 `../images/map.png` | 실패 | 실패 |
| | 미술부만 `art/intro.html` | 실패 | 실패 |
| | `./../../images/map.png`, `./../list.html` | 통과 | 통과 |
| | 루트 기준 `/images/map.png` | 실패 | 실패 |
| `links-images.web-product-page-paths` | `./cups.html` | 통과 | 통과 |
| | `../cups.html` | 실패 | 실패 |
| | `images/logo.png` | 실패 | 실패 |
| | 외부 주소에서 `https://` 빠짐 | 실패 | 실패 |
| `text.web-library-notice` | `strong`·`em` 모두 뒤바꿈 | 실패 | 실패 |
| | 네 곳 모두 `strong` | 실패 | 실패 |
| | `<em>12시까지</em>`(조사 포함) | 실패 | 실패 |
| | 마침표까지 `strong`에 넣음 | 실패 | 실패 |
| | `strong` 대신 `<b>` | 실패 | 실패 |
| `model.fill-area-properties` | 첫 칸 `margin`, 마지막 칸 `padding`(뒤바꿈) | 실패 | 실패(체크 2개) |
| | 선 칸에 `outline` | 실패 | 실패 |
| | 마지막 칸도 `padding` | 실패 | 실패 |
| `model.web-memo-board` | `margin: 16px 0` | 통과 | 통과(맞닿은 margin이 겹쳐 16px) |
| | `margin-top: 16px` | 통과 | 통과 |
| | `margin: 16px` | 통과 | 통과 |
| | `padding: 20px 10px`(순서 뒤바꿈) | 실패 | 실패 |
| | 틈을 `padding-bottom`으로 | 실패 | 실패(체크 2개) |
| | `margin: 8px`(겹쳐서 8px) | 실패 | 실패 |
| `units-colors.web-vw-and-percent` | 두 막대 모두 `50%` | 실패 | 실패 |
| | `vw`·`%` 뒤바꿈 | 실패 | 실패(체크 4개) |
| | 주황 막대 `150px` | 실패 | 실패(1280px 화면) |
| | `calc(100vw / 2)` | 통과 | 통과 |
| `typography.web-quote-font` | `"Georgia", serif`(따옴표) | 통과 | 통과 |
| | `Georgia,serif` + `20px` + `700` | 통과 | 통과 |
| | `1.25em` | 실패 | 실패(17.5px) |
| | `serif, Georgia` | 실패 | 실패 |
| | `Georgia`만 | 실패 | 실패 |
| | `.quote`에 `bold` | 실패 | 실패(인용문 본문까지 굵어짐) |

객관식·복수 선택·빈칸(text) 문제는 실행 채점이 아니라서 선택지와 `accept` 목록을 직접 대조했습니다.

## 판정 요약

| 판정 | 수 | 파일 |
|---|---|---|
| 그대로 승인 | 5 | `how-web-works.fill-reload-change`, `text.mcq-em-position`, `links-images.web-science-club-paths`, `links-images.web-product-page-paths`, `model.fill-area-properties` |
| 고친 뒤 승인 | 8 | 아래 단원별 표에서 "고침" |
| 거부·보류 | 0 | — |

8개 모두 같은 종류의 수정입니다. 힌트 3(또는 힌트 2와 3을 합친 것)이 문제의 핵심 판단을 대신해 주거나 정답 값을 그대로 알려 줘서, 판단 기준만 남기도록 완화했습니다. 지문, 정답, 체크, 해설은 바꾸지 않았습니다.

## 단원별 판단

### HTML

| 문제 | 판정 | 판단과 고친 내용 |
|---|---|---|
| `how-web-works.multi-browser-jobs` | 고침 | 정답 a·b·c가 레슨의 요청·응답·그리기 세 단계와 "그림 파일도 다시 요청" 문장과 맞음. d는 `page-lives-in-browser` 오개념, e는 서버의 일이라 오답이 분명함. 힌트 3이 브라우저의 일 세 가지를 그대로 나열해 정답 목록이 됨 → 선택지를 세 종류의 일로 분류해 보라는 기준만 주도록 완화 |
| `how-web-works.fill-request-order` | 고침 | B → D → C → A → E가 유일함(C는 HTML을 받아야 알 수 있고, A는 C 다음, E는 마지막). 레슨이 "적혀 있는 그림·CSS 파일도 다시 요청"을 가르쳐 범위 안. 난이도 3은 다섯 단계 순서 판단이라 맞음. 힌트 3이 "HTML 요청·받기 → 그림 요청·받기 → 그리기"로 순서 전체를 줌 → "요청·응답이 파일마다 한 쌍, 응답은 짝 요청 바로 뒤, 완성은 다 받은 뒤"라는 원리만 남김 |
| `how-web-works.fill-reload-change` | 그대로 | "HTML만으로 만든"으로 JavaScript 갱신 가능성을 막아 정답이 유일함. `토`·`request`·`response` 같은 변형 허용, `금요일`→`page-lives-in-browser` 매핑이 적절함. 캐시는 레슨 범위 밖이라 다루지 않은 것이 맞음 |
| `text.mcq-em-position` | 그대로 | `em`의 위치가 뜻을 바꾼다는 레슨 내용을 그대로 적용함. b·c는 강세 위치, d는 `strong-is-bold` 오개념으로 각각 이유가 다름. 힌트 3이 "언제"를 가리키지만 L3 객관식의 "거의 답" 수준이라 허용 |
| `text.web-library-notice` | 고침 | 네 곳의 판단 근거를 지문이 줌. 체크가 요소 종류·감싼 범위·개수·문장 유지를 모두 확인해 뒤바꿈, 모두 `strong`, 조사·마침표 포함, `<b>`가 실패함. 힌트 3이 "1·3번은 중요, 2·4번은 강세"로 짝을 지어 줌 → 지문의 "꼭 ~", "~가 아니라" 표현으로 나누라는 기준만 주도록 완화 |
| `links-images.web-science-club-paths` | 그대로 | `../../`는 레슨이 "두 단계 위"로 가르침. 체크가 `./` 접두 변형도 받고, 사이트 맨 위 기준·한 단계 부족·`art/` 직접 접근·루트 기준(`/`)은 모두 실패함. 힌트 3이 미술부 경로 하나를 말로 설명하지만 네 경로 중 하나라 허용 |
| `links-images.web-product-page-paths` | 그대로 | 같은 폴더·위 폴더·외부 사이트 세 경우를 한 문제에 묶음. `./cups.html`은 통과, `../cups.html`과 `https://` 없는 외부 주소는 실패함 |

### CSS

| 문제 | 판정 | 판단과 고친 내용 |
|---|---|---|
| `model.fill-area-properties` | 그대로 | code 모드라 실행으로 채점함. `.frame`에 테두리가 있어 margin이 겹치지 않고 회색으로 보임. padding·margin 뒤바꿈, `outline`은 실패함. 힌트 3이 세 영역의 우리말 이름까지만 주고 속성 이름은 학습자가 표에서 찾게 해 허용 |
| `model.web-memo-board` | 고침 | margin 겹침(16px 0이 16px로 보임)을 해설이 바르게 설명하고 체크도 그대로 동작함. 힌트 2가 `padding`·`border`·`margin`을 요구별로 짝지어 주고, 힌트 3이 단축 속성 순서와 `margin-bottom`을 줘서 둘을 합치면 정답 전체가 됨 → 힌트 2는 "배경색은 테두리 안쪽에만, 바깥은 투명"이라는 기준과 표 찾기로, 힌트 3은 값 2개의 순서를 떠올리게 하는 질문으로 완화 |
| `units-colors.mcq-nested-percent` | 고침 | 정답 200px이 유일함. 400·500·180·220px이 각각 다른 계산 실수(부모 건너뛰기, 화면 기준, padding 빼기, padding 더하기)를 대표함. 힌트 3이 `800 × 0.5`와 그 50%를 줘서 계산만 남음 → "padding과 상관없이 `width: 50%`가 정한 값이 기준"이라는 원리만 남김 |
| `units-colors.web-vw-and-percent` | 고침 | 지문의 `@media`는 읽기만 하면 되도록 설명함. 두 화면 너비 체크로 `px` 고정값과 뒤바꿈이 실패함. 힌트 2가 `%`와 `vw`의 기준을 그대로 대응시키고 힌트 3이 숫자 50을 줘서 합치면 정답 → 힌트 2를 "단위 표의 기준 칸을 보라"로 완화 |
| `typography.mcq-note-font` | 고침 | 상속된 목록으로 돌아가지 않는다는 점(c), `rem` 기준(d), 굵기 숫자(e)가 각각 하나의 실수를 대표하고 정답이 유일함. 힌트 3이 세 속성의 결론(다음 이름, 16 × 0.875, 700 = bold)을 모두 줌 → 각 속성에서 확인할 질문만 남김 |
| `typography.web-quote-font` | 고침 | 계산값 비교라 `"Georgia"` 따옴표·쉼표 뒤 공백 유무·`20px`·`700`이 모두 통과하고, `1.25em`·순서 뒤바꿈·대안 없음·`.quote`에 `bold`는 실패함. 힌트 3이 `serif`와 `1.25rem`을 그대로 줌 → `sans-serif`와 대비해 떠올리게 하고 단위는 이전 단원을 가리키도록 완화 |

## 남은 한계

- **`how-web-works` 단원 문제 수.** 이 배치로 승인 문제가 15개가 되어 `unit-count-over`(기준 6~12개) 경고가 납니다. D-081의 의도(작은 개념 풀 넓히기)대로라 받아들이고, 경고는 알려진 것으로 둡니다.
- **`practice.targetCount`.** 여섯 단원 모두 승인 문제 수가 `lesson.yaml`의 `targetCount`보다 2~3개 많아 경고가 납니다. 문제 파일만 다루는 이번 검토 범위 밖이라 고치지 않았습니다(조율자 몫).
- 지문의 방식 조건 중 "`.note` 규칙에 속성을 추가"(`web-memo-board`), "`.quote`·`.source` 규칙에 추가"(`web-quote-font`)는 채점하지 않습니다. 결과가 같은 다른 방법은 통과합니다.

## 검증 결과

- 시작 시 `pnpm content:check:run`: 오류 0개, 경고 6개(검토되지 않은 문제 제외 안내).
- 대체 답안 시험: 복제 문제 33개 모두 기대와 일치(통과 8, 실패 25).
- 수정·승인 후 `pnpm content:check:run`: 실행 검증 문제 1146개·템플릿 변형 90개·예제 210개, 통과 1073, 실패 0, 정적 검사 오류 0개. 경고 7개는 여섯 단원의 `targetCount` 초과와 `how-web-works`의 `unit-count-over`입니다.
