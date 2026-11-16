# 콘텐츠 작성 가이드

`content/` 아래에 레슨과 문제를 쓰고, 검사하고, `content.db`로 빌드하는 방법입니다.

- 대상: 콘텐츠 작성자, 검토자, 기여자
- 최종 수정: 2026-11-15
- 설계의 원천: [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md)

이 가이드는 v0.1 저장소에서 지금 동작하는 규칙만 다룹니다.
형식의 이유와 앞으로 추가될 유형은 설계 문서를 봅니다.

## 한눈에 보기

| 명령 | 무엇을 | 언제 |
|---|---|---|
| `pnpm content:check` | 스키마, ID·참조 무결성, 레슨 섹션·MDX 컴포넌트, 유형별 스펙, 문제 수량·유형 구성비, 별칭·사라진 slug 정적 검사 | 파일을 고칠 때마다 |
| `pnpm content:report` | 단원별 문제 수·유형 구성비·난이도 분포 표와 수량 기준 위반 목록 | 검토할 때, 무엇을 더 만들지 정할 때 |
| `pnpm content:check:run` | 헤드리스 Chromium에서 앱과 같은 러너로 문제와 예제를 실행해 검증하고, 예측 문제의 기대값을 기록 | 코드가 있는 문제·예제를 쓰거나 고친 뒤, 커밋 전 |
| `pnpm content:build` | 검사 후 승인된(`approved`) 문제만 담은 `content/dist/content.db` 생성 | 배포·실사용 빌드 |
| `pnpm content:build:dev` | 검토 전(`draft`) 문제까지 담은 개발용 `content.db` 생성 | 앱에서 초안을 확인할 때 |

작업 순서는 보통 이렇습니다.

1. 파일을 쓰거나 고칩니다.
1. `pnpm content:check`로 오류를 없앱니다.
1. `pnpm content:check:run`으로 실행 검증을 통과시킵니다. 바뀐 `content/.generated/predict-expected.json`도 함께 커밋합니다.
1. `pnpm content:build:dev`로 빌드해 앱에서 확인합니다.
1. 사람이 검토하고 `review.status`를 `approved`로 바꿉니다.

## 디렉터리 구조

```text
content/
├── pack.yaml                         # 팩 ID·버전, 트랙과 과정 순서
├── concepts/
│   ├── js.yaml                       # 개념 목록 (언어별 파일)
│   └── css.yaml
├── misconceptions/
│   ├── js.yaml                       # 오개념 목록
│   └── css.yaml
├── courses/
│   └── js-basics/
│       ├── course.yaml               # 과정 메타데이터, 모듈 순서
│       └── modules/
│           └── 01-start/
│               ├── module.yaml       # 모듈 메타데이터, 단원 순서
│               └── lessons/
│                   └── 01-first-program/
│                       ├── lesson.yaml   # 단원 메타데이터
│                       ├── lesson.mdx    # 레슨 본문
│                       └── exercises/
│                           ├── 001-mcq-console-log-role.yaml
│                           └── 002-predict-quoted-expression.yaml
├── .generated/
│   └── predict-expected.json         # content:check:run이 만듦. 직접 고치지 않음
├── aliases.yaml                      # 바꾼 slug의 별칭 (필요할 때만)
├── .published-slugs.txt              # content:build가 갱신하는 공개 slug 목록. 직접 고치지 않음
└── dist/                             # 빌드 결과 (git에 올리지 않음)
```

- 디렉터리 이름의 숫자 접두사(`01-`)는 정렬용입니다. ID에는 들어가지 않습니다(`01-start` → `start`).
- 순서의 원천은 `course.yaml`의 `modules`와 `module.yaml`의 `lessons` 목록입니다. 목록과 디렉터리가 맞지 않으면 오류, 번호 순서만 다르면 경고입니다.
- `pack.yaml`의 `tracks[].courses`에 있는 과정만 읽습니다.
- 문제 파일 이름은 `<번호>-<유형 약어>-<이름>.yaml`로 씁니다. 파일 이름 순서가 단원 안 문제 순서입니다.

## slug 규칙

모든 ID는 소문자, 숫자, 하이픈으로 된 조각을 점으로 잇습니다(조각 정규식 `[a-z0-9]+(-[a-z0-9]+)*`, 전체 120자 이하).

| 대상 | 형식 | 예 |
|---|---|---|
| 과정 | `<course>` (디렉터리 이름과 같음) | `js-basics` |
| 모듈 | `<course>.<module>` | `js-basics.start` |
| 단원 | `<course>.<module>.<lesson>` | `js-basics.start.first-program` |
| 개념 | `<lang>.<area>.<concept>` | `js.basics.console-log` |
| 오개념 | `<lang>.mc.<name>` | `js.mc.log-prints-quotes` |
| 문제 | `<단원 ID>.<유형 약어>-<이름>` | `js-basics.start.first-program.predict-quoted-expression` |
| 단원 앵커 | `<단원 ID>#<섹션 ID>` | `js-basics.start.first-program#pitfalls` |

- 모듈·단원 ID의 마지막 조각은 숫자 접두사를 뺀 디렉터리 이름과 같아야 합니다.
- 문제 ID는 자기 단원 ID로 시작해야 합니다.
- ID는 학습 기록(`user.db`)이 가리키므로 **공개한 뒤에는 바꾸지 않습니다.** 꼭 바꿔야 하면 아래 [slug를 바꿀 때](#slug를-바꿀-때-aliasesyaml)대로 별칭을 남깁니다.

### slug를 바꿀 때 (aliases.yaml)

커리큘럼을 고치다 개념 이름을 바로잡거나 단원을 나누고 합쳐야 하면, 이전 slug와 새 slug를 `content/aliases.yaml`에 적습니다([D-057](/docs/decisions.md)).
앱은 시작할 때 학습 기록(시도, 숙련도, 복습 일정, 오답 노트, 진도)을 새 slug로 옮기므로 기록이 끊기지 않습니다.

```yaml
# content/aliases.yaml
- from: js.fn.returns            # 이전 slug(콘텐츠에서 사라진 것)
  to: js.fn.return               # 현재 slug
  kind: rename                   # rename | merge | split
- from: js.conv.to-number-a      # 합쳐진 slug마다 한 항목
  to: js.conv.to-number
  kind: merge
- from: js.conv.to-number-b
  to: js.conv.to-number
  kind: merge
- from: js-basics.functions.basics
  to: [js-basics.functions.function-basics, js-basics.functions.return-and-side-effects]
  kind: split
  primary: js-basics.functions.function-basics   # 진도를 이어받을 단원
  since: 2026.12.01.1            # 선택. 생략하면 빌드하는 pack.yaml 버전
```

- `from`은 콘텐츠에 더는 없어야 하고, `to`는 현재 콘텐츠에 있어야 합니다. 대상 종류(과정·모듈·단원·개념·오개념·문제)는 `to`로 정해지며, `from`도 그 종류의 slug 형식이어야 합니다.
- 이미 있는 별칭의 대상 이름을 또 바꾸면 이전 항목의 `to`도 최종 slug로 고칩니다(별칭은 이어서 따라가지 않습니다).
- 숙련도처럼 개념마다 한 행인 기록은 새 slug에 기록이 없을 때만 옮겨집니다. `merge`로 합칠 때 두 개념의 숙련도를 다시 계산하는 기능은 아직 없습니다(시도 기록은 모두 옮겨짐).

**공개 slug 목록**: `content/.published-slugs.txt`는 마지막 `pnpm content:build`가 공개한 slug 목록입니다(`<종류> <slug>` 한 줄씩).
`content:check`는 이 목록에 있던 slug가 콘텐츠에서 사라졌는데 별칭이 없으면 경고합니다.

```text
경고  .published-slugs.txt  공개했던 개념 js.fn.returns이(가) 사라졌습니다. 이름을 바꿨다면 aliases.yaml에 기록하고, 의도한 삭제라면 pnpm content:build로 목록을 갱신하세요
```

- 이름을 바꿨다면 `aliases.yaml`에 기록합니다.
- 정말 지운 것이라면(예: 잘못 만든 문제) `pnpm content:build`로 목록을 갱신해 원본과 함께 커밋합니다. 목록 diff가 "무엇을 지웠는지"의 검토 기록입니다.
- 목록은 `content:build`(초안 제외 빌드)만 갱신합니다. `content:build:dev`와 `content:check`는 쓰지 않습니다. 목록 파일이 없으면 비교하지 않습니다.

자세한 근거는 설계 문서의 [slug 규칙](/docs/design/content-and-exercises.md#slug-규칙)을 봅니다.

## 메타데이터 파일

### 과정·모듈·단원

```yaml
# courses/js-basics/course.yaml
id: js-basics
title: JavaScript 기초
summary: 값, 연산, 제어 흐름, 함수, 배열, 객체로 문제를 해결하는 프로그램을 작성합니다.
language: javascript        # html | css | javascript
level: basic                # intro | basic | advanced
depth: full                 # full | core
objectives:
  - console.log로 프로그램의 결과를 확인하고, 문장이 실행되는 순서를 예측할 수 있다.
modules: [start, values]
```

```yaml
# courses/js-basics/modules/01-start/module.yaml
id: js-basics.start
title: 시작하기
summary: 첫 프로그램을 실행해 결과를 확인하고, 오류 메시지를 읽는 법을 배웁니다.
lessons: [first-program, reading-errors]
```

```yaml
# .../lessons/01-first-program/lesson.yaml
id: js-basics.start.first-program
title: 첫 프로그램
summary: console.log로 값을 출력하고, 문장이 위에서 아래로 실행되는 순서와 주석을 익힙니다.
kind: lesson                 # lesson | assessment | project
importance: standard         # core | standard | minor
estimatedMinutes: { read: 12, practice: 15 }
concepts:
  primary: [js.basics.statements, js.basics.console-log, js.basics.comments]
objectives:
  - console.log로 글자(문자열)와 계산 결과를 콘솔에 출력할 수 있다.
practice:
  targetCount: 12            # 승인된 문제 수 목표 (다르면 경고)
```

- `concepts.primary`는 이 단원이 **처음 소개하는** 개념입니다. 한 개념은 한 단원에서만 소개합니다.
- `concepts.practiced`, `concepts.reviewed`는 연습·복습하는 개념입니다.
- 단원 평가(`kind: assessment`)와 응용 프로젝트(`kind: project`)의 형식은 설계 문서의 [단원 평가 단원](/docs/design/content-and-exercises.md#단원-평가-단원-kind-assessment)과 [프로젝트 단원](/docs/design/content-and-exercises.md#프로젝트-단원-kind-project)에 있습니다. 프로젝트 단원은 `concepts.primary` 없이 `practiced`·`reviewed`만 쓰고, 프로젝트 문제는 `usage: project`인 `web_task` 하나(마일스톤 `milestones` 필수, 3~10개 권장)이고, 나머지 문제는 그 단원에서만 나오는 준비 연습(`usage: practice`, 주 개념은 `practiced`·`reviewed` 안)입니다. 모든 마일스톤을 통과하면 단원 완료입니다.

### 개념과 오개념

```yaml
# concepts/js.yaml (목록)
- id: js.basics.console-log
  title: console.log로 출력하기
  importance: standard
  summary: console.log(값)은 괄호 안의 값을 콘솔에 보여 줍니다.
  prerequisites: [js.basics.statements]     # 직접 필요한 것만. { id, strength: helpful }도 가능
  misconceptions: [js.mc.log-prints-quotes]
  mdn: Web/API/console/log_static
```

```yaml
# misconceptions/js.yaml (목록)
- id: js.mc.log-prints-quotes
  concept: js.basics.console-log
  title: 따옴표까지 출력된다고 생각함
  statement: 'console.log("안녕")을 실행하면 콘솔에 따옴표까지 포함한 "안녕"이 나온다고 생각한다.'
  reality: 따옴표는 글자의 범위를 표시하는 기호일 뿐이다. 콘솔에는 따옴표 안의 글자만 나온다.
  remediation:
    lessonSection: js-basics.start.first-program#pitfalls
    exercises: [js-basics.start.first-program.predict-quoted-expression]
```

- 선수 관계에 순환이 있으면 오류, 선수 개념이 뒤 단원에서 소개되면 경고입니다.
- 오개념의 `concept`와 그 개념의 `misconceptions` 목록은 서로 맞아야 합니다.
- 주 개념의 오개념은 모두 그 단원의 `pitfalls` 섹션에서 `<Pitfall>`로 다뤄야 합니다(없으면 경고).

## 레슨 본문 (lesson.mdx)

본문은 Markdown(GFM)과 허용된 MDX 컴포넌트만 씁니다.
콘텐츠는 코드를 실행하지 않으므로 `import`/`export`, `{표현식}`, 원시 HTML은 모두 오류입니다.
컴포넌트 속성은 문자열이나 JSON 리터럴(`{["a", "b"]}`, `{true}`)만 씁니다.

### 섹션

본문 전체를 `<Section kind="...">`로 나눕니다. 일반 단원(`kind: lesson`)은 다음 12종이 모두 필요하고, 첫 섹션은 `objectives`, 마지막은 `next`입니다.

`objectives`, `prerequisites`, `intro`, `principle`, `examples`, `walkthrough`, `pitfalls`, `in-practice`, `check`, `practice`, `summary`, `next`

평가·프로젝트 단원은 `objectives`, `practice`, `summary`, `next`만 필요합니다.
같은 종류를 여러 번 쓸 수 있고, 섹션 ID는 `examples`, `examples-2`처럼 붙습니다.
내용이 없는 섹션(예: 선수 지식 자동 표시)은 `<Section kind="prerequisites" />`처럼 비워 둡니다.

### 컴포넌트

| 컴포넌트 | 쓰임 | 주요 속성 |
|---|---|---|
| `<RunnableExample>` | 실행 가능한 코드 예제. 내용은 코드 블록 하나 | `id`(필수, 단원 안 고유), `lang`(필수: `js`·`html`·`css`·`web`), `predict`, `predictKind`, `expectError`, `editable`, `concepts`, `highlight` |
| `<InlineExercise>` | 본문 중간의 확인 문제 | `ref`(같은 단원의 문제 ID) |
| `<Callout>` | 참고·팁·주의 상자 | `kind`(`note`·`tip`·`warning`·`danger`·`deep-dive`), `title` |
| `<CompareTable>`, `<Row>` | 비교 표. 행 내용은 `\|`로 칸을 나눔 | `columns`, `label` |
| `<ConceptLink>` | 개념 링크 | `to`(개념 ID) |
| `<Pitfall>` + `<Wrong>`·`<Actual>`·`<Right>` | 흔한 실수 | `misconception`(오개념 ID) |
| `<ValueTrace>` | 변수 값 추적 표 | `code`, `vars` |
| `<Diagram>` | 다이어그램(코드 블록) | `alt`(필수) |
| `<Figure>` | 그림 | `src`, `alt`(필수), `caption` |
| `<MdnLink>` | MDN 링크 | `path` |
| `<Reveal>` | 펼쳐 보기 | `title` |
| `<Key>` | 키보드 키 표시 | 없음 |

`<RunnableExample>` 예:

````mdx
<RunnableExample id="hello" lang="js" predict predictKind="console" concepts={["js.basics.console-log"]}>
```js
console.log("안녕하세요");
console.log(3 + 4);
```
</RunnableExample>
````

- `lang="js"`는 콘솔 실행, `html`·`web`은 문서 미리보기로 실행합니다. `css`만 있는 예제는 적용할 문서가 없어 실행 버튼 없이 보입니다.
- **일부러 오류를 보여 주는 예제는 `expectError`를 붙입니다.** `content:check:run`은 표시가 없는 예제가 오류를 내거나, 표시가 있는 예제가 오류를 내지 않으면 실패합니다.

### 문장 규칙

- 원시 HTML 대신 컴포넌트를 씁니다. 인라인 코드(`` `<div>` ``) 안의 태그는 괜찮습니다.
- 존댓말 해요체로 쓰고, 개념을 "왜 필요한가"의 구체적 상황으로 시작합니다. 자세한 기준은 설계 문서의 [레슨 본문 표준 섹션](/docs/design/content-and-exercises.md#레슨-본문-표준-섹션)을 봅니다.

## 문제 파일

### 공통 필드

```yaml
id: js-basics.start.first-program.mcq-console-log-role
type: mcq_single
difficulty: 1                   # 1~5
concepts:
  - { id: js.basics.console-log, weight: 1 }   # weight 1인 주 개념이 정확히 하나
tags: [console-log]
estimatedSeconds: 40
prompt: |                       # Markdown. 원시 HTML 금지
  `console.log("완료");`를 실행하면 어떤 일이 일어나나요?
code: |                         # 선택. 지문과 함께 보여 줄 코드
spec: { ... }                   # 유형별 스펙 (아래)
misconceptions: [js.mc.log-is-return]
hints:                          # 정확히 3개. 방향 → 구체적 단서 → 거의 답
  - "`log`는 \"기록하다\"라는 뜻이에요. 어디에 기록할까요?"
  - console.log는 사람이 볼 수 있게 보여 주는 일만 해요.
  - 따옴표는 글자의 범위를 표시할 뿐이고, 출력은 저장과 다른 일이에요.
explanation: |                  # 정답과 오답의 이유
  ...
origin: authored
review:
  status: draft                 # draft | approved
  draftedBy: ai:claude          # human | ai:<이름>
```

`usage`(기본 `practice`), `workedExampleStage`, `variantGroup`은 필요할 때만 씁니다.
필드 전체 설명은 설계 문서의 [문제 파일 형식](/docs/design/content-and-exercises.md#문제-파일-형식-공통-필드)을 봅니다.

### 유형별 스펙

쓸 수 있는 유형은 `mcq_single`, `mcq_multi`, `true_false`, `fill_blank`, `predict_output`, `parsons`, `find_bug_line`, `implement_function`, `fix_bug`, `web_task`입니다(`mcq_multi`·`true_false`·`parsons`·`find_bug_line`은 v0.2부터).
아래 예는 `content/`의 실제 문제를 줄인 것입니다. v0.2 유형의 예는 E2E 고정 콘텐츠(`e2e/fixtures/content`)를 줄인 것입니다.

**CSS 과정**(`language: css`)에서는 `mcq_single`, `fill_blank`, `web_task`만 씁니다([D-028](/docs/decisions.md)). 다른 유형은 `content:check` 오류입니다. HTML/CSS 핵심(`depth: core`) 과정에는 "단원 풀의 유형 4종 이상" 규칙을 적용하지 않습니다.

#### mcq_single

```yaml
spec:
  options:                       # 3~5개
    - id: a
      text: 콘솔에 `완료`라는 글자가 보인다
    - id: c
      text: 콘솔에 따옴표까지 붙은 `"완료"`가 보인다
      misconception: js.mc.log-prints-quotes      # 이 오답이 시사하는 오개념
      rationale: 따옴표는 글자의 시작과 끝을 표시하는 기호예요.
    - id: d
      text: 프로그램이 `완료` 상태가 되어 실행을 끝낸다
  correct: a
```

- "모두 정답", "정답 없음" 같은 선택지는 쓸 수 없습니다.
- `shuffle`(기본 `true`), `codeOptions`(선택지를 코드로 표시)를 쓸 수 있습니다.

#### mcq_multi

정답이 하나 이상인 선택형입니다. 학습자에게는 "해당하는 것을 모두 고르세요. 정답이 여러 개일 수 있어요."가 항상 보이고, 정답 개수는 알려 주지 않습니다.

```yaml
spec:
  options:                       # 3~6개
    - id: a
      text: 괄호 안의 값을 콘솔에 보여 준다
      missedMisconception: js.mc.log-is-silent    # 선택. 이 정답을 놓치면 시사되는 오개념
    - id: b
      text: 한 번 호출하면 콘솔에 한 줄이 생긴다
    - id: c
      text: 출력한 값을 저장해 두었다가 다음 줄에서 돌려준다
      misconception: js.mc.log-is-return          # 이 오답을 고르면 시사되는 오개념
      rationale: console.log는 보여 주기만 하고 값을 저장하지 않아요.
  correct: [a, b]                # 1개 이상
  minSelect: 1                   # 선택. 제출 전에 골라야 하는 최소 개수(학습자에게 보임)
```

- 고른 집합이 정답 집합과 정확히 같아야 정답입니다. 부분 점수는 `(맞게 고른 수 − 잘못 고른 수) / 정답 수`(0 미만은 0)입니다.
- 정답 선택지에는 `misconception`·`rationale`을, 오답 선택지에는 `missedMisconception`을 쓰지 않습니다.
- 모든 선택지가 정답이면 `content:check` 오류입니다(전부 고르기만 해도 맞힘).
- `minSelect`는 정답 수보다 클 수 없습니다. `minSelect: 2` 이상이면 "(2개 이상)"이 안내에 붙으므로 정답이 최소 몇 개인지 드러납니다.

#### true_false

설명 하나가 참인지 거짓인지 고릅니다. 찍어서 맞힐 확률이 50%라 숙련도 반영 가중치가 0.5로 가장 낮습니다([학습 엔진](/docs/design/learning-engine.md)). L2 이상에서는 `requireReason`으로 이유도 고르게 하세요.

```yaml
spec:
  statement: 문장이 여러 개 있으면 가장 짧은 문장부터 실행된다.
  answer: false                  # 정답
  misconceptionIfWrong: js.mc.short-runs-first    # 선택. 참/거짓을 틀리면 시사되는 오개념
  requireReason: true            # 선택(기본 false)
  reasons:                       # requireReason일 때 2~5개, 정답은 정확히 하나
    - id: r1
      text: 문장은 적힌 순서대로 위에서 아래로 실행된다
      correct: true
    - id: r2
      text: 짧은 문장일수록 빨리 끝나서 먼저 실행된다
      misconception: js.mc.short-runs-first
```

- `requireReason`이면 참/거짓과 이유가 모두 맞아야 정답입니다. 참/거짓만 맞으면 부분 점수 0.5입니다.
- 지문(`prompt`)에는 "다음 설명이 맞는지 고르세요."처럼 지시만 쓰고, 판단할 설명은 `statement`에 씁니다.

`mcq_multi`·`true_false`를 포함한 모든 유형에서, 스펙 안의 오개념 ID(`misconception`, `missedMisconception`, `misconceptionIfWrong`, `misconceptionIfFail`, `misconceptionMap`·`misconceptionByAnswer`의 값 등 이름에 `misconception`이 들어간 필드)는 `misconceptions/*.yaml`에 있어야 합니다. 없으면 `content:check` 오류입니다.

#### fill_blank (text 모드)

답을 문자열로 비교합니다. 템플릿의 `{{blank:<id>}}`마다 `blanks` 항목이 하나씩 있어야 합니다.

```yaml
spec:
  mode: text
  template: |
    화면에서 보이는 너비(테두리까지): {{blank:w}}
  blanks:
    - id: w
      accept: ["250px", "250"]
      acceptRegex: "250 ?(?:px)?"   # 선택. 전체 일치, 중첩 수량자 금지
      caseSensitive: false
      width: 8
      misconceptionMap:
        "200px": css.mc.width-includes-padding
```

#### fill_blank (code 모드)

빈칸을 채운 코드를 **실행해서** 체크로 채점합니다. 그래서 `b + a`처럼 동등한 답도 맞습니다.

```yaml
spec:
  mode: code
  lang: js                       # js | html
  template: |
    console.log("오늘의 목표");
    {{blank:line}}
  blanks:
    - id: line
      accept: ['console.log("첫 프로그램 완성하기");']   # 첫 번째가 실행 검증의 참조 정답
      width: 40
  checks:
    - kind: console
      id: output
      description: 콘솔에 "오늘의 목표"와 "첫 프로그램 완성하기"가 차례로 출력되어야 합니다.
      requirement: 두 줄 출력
      expect:
        lines: ["오늘의 목표", "첫 프로그램 완성하기"]
```

- code 모드의 빈칸마다 `accept`에 예시 답이 하나 이상 있어야 합니다. `content:check:run`이 각 빈칸의 첫 번째 `accept`로 참조 정답을 만들어 실행합니다.

#### predict_output

```yaml
spec:
  lang: js                       # js | web
  code: |
    console.log("10 + 5");
    console.log(10 + 5);
  answerKind: console            # console | value | error | choice
  misconceptionByAnswer:
    "15\n15": js.mc.quoted-expression-evaluates
```

- **정답(`expected`)은 쓰지 않습니다.** `content:check:run`이 실제로 3번 실행해 결과가 같은지 확인하고, 그 결과를 `content/.generated/predict-expected.json`에 기록합니다. `spec.expected`를 직접 쓰면 오류입니다.
- `answerKind: value`는 `expression`에 끝났을 때 값을 물을 전역 변수 이름을 씁니다.
- `answerKind: error`는 오류 여부와 종류(`ReferenceError` 등)를 묻습니다. 문법 오류(`SyntaxError`)는 실행 결과가 없어 예측 문제로 쓸 수 없습니다.
- `answerKind: choice`는 `choices`를 주고, 실제 출력과 정확히 하나만 같아야 합니다.
- 무작위 값, 현재 시각, 타이머 순서에 기대는 코드는 결정론 검사에서 실패합니다.
- `misconceptionByAnswer`의 답이 실제 정답과 같으면 오류입니다(기대값이 계산된 뒤 검사합니다).

#### parsons

코드 조각을 순서대로 놓아 프로그램을 완성합니다. `lines`는 **정답 순서대로** 쓰고, 학습자에게는 방해 줄과 섞여 보입니다(ID도 감춤). 지문에 출력 예시처럼 목표를 분명히 적습니다. "필요 없는 조각이 섞여 있을 수 있어요"는 화면이 항상 보여 주므로 지문에 쓰지 않아도 됩니다.

**순서로 채점**(체크 없음):

```yaml
spec:
  lines:                         # 정답 순서. 2~30줄, 한 줄에 한 문장
    - { id: l1, code: "function sum(arr) {" }
    - { id: l2, code: "let total = 0;", indent: 1 }
    - { id: l3, code: "for (const n of arr) {", indent: 1 }
    - { id: l4, code: "total += n;", indent: 2 }
    - { id: l5, code: "}", indent: 1 }
    - { id: l6, code: "return total;", indent: 1 }
    - { id: l7, code: "}" }
  distractors:                   # 선택. 어디에도 쓰지 않는 줄
    - { id: d1, code: "total = n;", misconception: js.mc.accumulator-overwrite }
  gradeIndent: true              # 기본 true. 들여쓰기 수준도 채점
  alternatives:                  # 선택. 허용하는 다른 순서(모든 줄 ID를 한 번씩)
    - [l2, l1, l3, l4, l5, l6, l7]
```

**실행으로 채점**(`checks`가 있으면 동작이 같은 다른 순서도 정답):

```yaml
spec:
  lines:
    - { id: wake, code: 'console.log("일어나기");' }
    - { id: wash, code: 'console.log("세수하기");' }
    - { id: eat, code: 'console.log("아침 먹기");' }
  distractors:
    - { id: sleep, code: 'console.log("다시 자기");', replaces: wash }   # replaces: 선택
  gradeIndent: false
  checks:
    - kind: console
      id: order
      description: 세 줄이 아침 순서대로 출력되어야 합니다.
      expect:
        lines: ['일어나기', '세수하기', '아침 먹기']
```

- 코드가 같은 줄(여러 개의 `}` 등)은 서로 바꿔 놓아도 정답입니다. 그래서 정답 줄과 코드가 같은 방해 줄은 쓸 수 없습니다.
- 들여쓰기 1단계는 공백 2칸입니다. `checks`로 채점하면 들여쓰기는 채점하지 않습니다(`gradeIndent: false`로 두세요).
- `checks`가 있으면 `content:check:run`이 정답 순서(와 `alternatives`)로 조립한 코드가 필수 체크를 모두 통과하는지, 방해 줄을 넣으면 실패하는지 확인합니다. 방해 줄은 `replaces`에 적은 줄 자리에, 없으면 **모든 위치**에 넣어 봅니다. 맨 끝에 넣어도 출력이 같은 방해 줄처럼 어딘가에서 통과하면 실패이니, `replaces`를 적거나 체크를 보강하세요.
- 함수를 부르는 `call` 체크에는 `entry`가 필요합니다.

#### find_bug_line

증상을 보고 원인이 되는 줄을 고릅니다. 원인 선택지(`causeOptions`)를 두면 이유까지 골라야 정답입니다(줄만 맞으면 부분 점수 0.5).

```yaml
spec:
  code: |-                       # JavaScript. 학습자에게 줄 번호와 함께 보임
    const price = 3500;
    console.log("김밥 가격");
    console.log("price");
  bugLines: [3]                  # 원인 줄(1부터), 여러 개 가능
  acceptLines: []                # 선택. 원인으로 함께 인정할 줄
  symptom: 가격 `3500` 대신 `price`라는 글자가 출력돼요.     # 학습자에게 보이는 증상(어디인지는 쓰지 않음)
  symptomCheck:                  # 같은 증상을 기계로 비교하는 형태. 둘 중 하나
    console: ['김밥 가격', 'price']   # 버그 코드의 콘솔 출력 전체
    # error: TypeError               # 또는 버그 코드가 던지는 오류 이름
  fixedCode: |-                  # 고친 코드. 오류 없이 실행되고 증상이 없어야 함
    const price = 3500;
    console.log("김밥 가격");
    console.log(price);
  causeOptions:                  # 선택. 2~5개, 정답은 정확히 하나
    - id: c1
      text: 변수 이름을 따옴표로 감싸서 글자가 되었다
      correct: true
    - id: c2
      text: console.log는 변수를 출력할 수 없다
      misconception: js.mc.log-cannot-print-variables   # 선택
```

- `code`는 YAML `|-`로 써서 끝 빈 줄이 줄 번호에 들어가지 않게 합니다. 원인 줄은 빈 줄일 수 없습니다.
- `symptomCheck`·`fixedCode`는 학습자에게 보이지 않습니다. `content:check:run`이 버그 코드와 `fixedCode`를 실제로 실행해 확인합니다.
- `fixedCode`와 `code`의 줄 수가 같으면, 고친 줄이 `bugLines`·`acceptLines`에 들어 있는지 정적 검사가 확인합니다(밖이면 경고).
- 지문(`prompt`)에 코드를 다시 쓰지 않습니다. `code`가 화면에 보입니다.

#### fix_bug

```yaml
spec:
  buggy:
    files:
      - path: main.js
        content: |
          console.log("김밥 2줄:", "3500 * 2");
  solution:
    files:
      - path: main.js
        content: |
          console.log("김밥 2줄:", 3500 * 2);
  bugDescription: 김밥 가격이 계산되지 않아요.    # 증상만. 원인은 쓰지 않음
  checks:
    - kind: console
      id: output
      description: 김밥 가격이 계산되어 출력되어야 합니다.
      expect:
        lines: ["김밥 2줄: 7000"]
```

`maxEditDistance`(새로 쓰기 방지), `bugMisconception`, `entry`(함수를 부르는 `call` 체크용)를 쓸 수 있습니다.

#### implement_function

v0.1 콘텐츠에는 프로그램 작성 문제(`entry` 없음)만 있습니다(예: `first-program/exercises/004-impl-print-goal.yaml`). `entry`(함수 이름)는 선택입니다([D-028](/docs/decisions.md)).

**함수 작성 문제**(`entry` 있음, 함수를 배운 모듈 6부터):

```yaml
spec:
  starter:
    files:
      - path: main.js
        content: |
          function sum(list) {
          }
  entry: sum                     # call 체크가 부를 함수
  solution:
    files:
      - path: main.js
        content: |
          function sum(list) {
            return list.reduce((s, n) => s + n, 0);
          }
  checks:
    - { kind: call, id: basic, args: [[1, 2]], expect: { equals: 3 } }
    - { kind: call, id: empty, args: [[]], expect: { equals: 0 } }
```

**프로그램 작성 문제**(`entry` 없음, 모듈 1부터): 학습자가 최상위 코드를 씁니다. 프로그램 전체를 관측하는 `console`(출력)과 `program`(끝난 뒤의 변수 값, `noError`) 체크만 씁니다. `call` 체크를 쓰면 `CHECK_NEEDS_ENTRY` 오류입니다.

```yaml
spec:
  starter:
    files:
      - path: main.js
        content: |
          // price와 count를 곱해 total에 넣고 출력하세요
  solution:
    files:
      - path: main.js
        content: |
          let price = 1000;
          let count = 3;
          let total = price * count;
          console.log(total);
  checks:
    - { kind: console, id: output, expect: { lines: ["3000"] } }
    - kind: program
      id: has-total
      description: total 변수에 계산 결과가 들어 있어야 합니다.
      expect: { globals: { total: { equals: 3000 } }, noError: true }
```

`program` 체크의 `globals`는 최상위 `let`·`const`로 만든 변수도 읽습니다.

#### web_task

`index.html` 파일 하나로 된 시작 코드와 참조 결과를 줍니다.

```yaml
spec:
  focus: css                     # html | css | dom | project
  starter:
    files:
      - path: index.html
        content: |
          <!doctype html>
          ...
  solution:
    files:
      - path: index.html
        content: |
          <!doctype html>
          ...
  checks:
    - kind: layout
      id: same-as-ruler
      description: 노란 상자의 너비(테두리까지)가 파란 안내선과 같아야 합니다.
      requirement: 안내선과 같은 너비
      visible: true
      a: .box
      container: .ruler
      relation: fills-width
```

`viewports`(기본 `[1280]`), `timers`, `milestones`를 쓸 수 있습니다.

### 체크

코드 유형은 정답 조건을 체크 목록으로 선언합니다.
`call`, `console`, `program`, `dom`, `event`, `css`, `layout`, `a11y`, `html-valid`, `static` 종류가 있습니다.

- 동작을 확인하는 필수 체크(`static`, `html-valid` 제외)가 최소 1개 있어야 합니다.
- `visible: false`(숨김) 체크에도 학습자가 볼 `description`을 씁니다.
- `requirement`로 묶은 체크는 피드백에서 하나의 요구사항으로 보입니다.

종류별 필드는 설계 문서의 [체크 명세 언어](/docs/design/content-and-exercises.md#체크-명세-언어)를 봅니다.

### 학습자 코드는 엄격 모드로 실행됩니다

러너는 학습자 JavaScript(문제 답안, 시작 코드, 예측 문제 코드, 레슨 예제)를 모두 엄격 모드로 실행합니다([D-026](/docs/decisions.md)). 문제를 쓸 때 다음을 기억합니다.

- `let`·`const` 없이 `nickname = "코코";`처럼 대입하면 `ReferenceError: nickname is not defined`가 납니다. 선언을 빠뜨린 답안은 실패해야 정상입니다.
- 일반 함수 호출(`f()`)의 `this`는 `undefined`입니다.
- `with`, `010` 같은 8진수 리터럴, 중복 매개변수는 실행 전 `SyntaxError`입니다.
- 예측 문제의 기대값도 엄격 모드 실행 결과입니다.

## 검사와 실행 검증

### content:check (정적 검사)

브라우저 없이 몇 초 안에 끝납니다. 오류가 있으면 실패(종료 코드 1)하고, 경고는 보고만 합니다.
`--strict`를 붙이면 경고도 실패로 처리합니다.

```text
경고  courses/js-basics/.../lesson.yaml  검토되지 않은 문제 12개는 빌드에서 제외됩니다
오류 0개, 경고 8개
```

### 문제 수량과 유형 구성비 (FR-EX-09)

`content:check`(와 `check:run`, `build`)는 [PRD 문제 수량 기준](/docs/product/prd.md#문제-수량-기준)을 단원마다 검사합니다([D-056](/docs/decisions.md)).
**승인된 문제만** 셉니다. 초안은 세지 않으므로 검토가 끝나야 수량을 채운 것입니다.

| 규칙 | 기준 | JavaScript | HTML/CSS |
|---|---|---|---|
| `unit-count` | 단원 연습 문항 수: JS `core` 단원 20~30, 그 밖의 JS 단원 10~20, HTML/CSS 6~12 (`lesson.yaml`의 `importance`) | 오류 | 경고 |
| `unit-count-over` | 위 범위를 넘음 | 경고 | 경고 |
| `concept-min` | 주 개념(가중치 1)으로 태깅된 연습 문항 수: JS `core` 6·`standard` 4·`minor` 3, HTML/CSS 2. 부 개념 태그는 세지 않음 | 오류 | 경고 |
| `type-mix` | 범주 비율이 목표 ±10%p 안: JS 개념 확인 25·코드 이해 25·디버깅 20·구현 20·응용 10, HTML/CSS 35·25·10·30·0~5 | **경고**(콘텐츠를 고친 뒤 오류로 전환) | 경고 |
| `type-diversity` | 유형 4종 이상, 한 유형이 50% 이하(HTML/CSS 핵심 과정은 면제, D-028) | 오류 | — |
| `assessment-coverage` | 단원 평가에 그 모듈이 소개한 개념마다 승인된 평가 문항 1개 이상 | 오류 | 경고 |

- 범주: 단일·복수 선택, 참/거짓 = 개념 확인 / 실행 결과 예측, 빈칸, 파슨스, 오류 줄 찾기 = 코드 이해 / 버그 수정 = 디버깅 / 함수 구현, 웹 실습 = 구현 / **난이도 4 이상의 구현·디버깅 = 응용**(구현·디버깅 대신 응용으로 셈).
- 평가 단원의 한 번 출제 문항 수(10~20 권장)는 단원 평가 검사가, 프로젝트 단원은 프로젝트 검사가 따로 봅니다. 수량 규칙은 일반 단원(`kind: lesson`)에 적용합니다.
- 메시지는 규칙 이름으로 시작합니다: `[type-mix] 유형 구성비가 ±10%p를 벗어났습니다: 디버깅 0개 0% (목표 20%)`.

`pnpm content:report`는 단원별 표(승인 수/기준, 범주별 수·비율, 난이도 1~5 분포, 유형 수, 초안 수, 기준 충족)와 위반 목록을 출력합니다. 검토할 때나 무엇을 더 만들지 정할 때 씁니다. `--markdown`을 붙이면(`node tools/content-cli/src/cli.ts report --dir content --markdown`) PR 설명에 붙일 수 있는 표가 나옵니다.

### content:check:run (실행 검증)

헤드리스 Chromium을 띄우고 웹 앱과 **같은 러너**(`packages/runner`의 셸·하네스, 셸별 `*.localhost` 사이트)로 실행합니다.
빌드할 때와 학습할 때 실행 결과가 달라지지 않게 하기 위해서입니다.
검토 전(`draft`) 문제도 모두 검증합니다.

| 대상 | 검증 |
|---|---|
| `predict_output` | 3번 실행해 결과가 같은지 확인하고 기대값을 계산·기록 |
| `implement_function`, `fix_bug`, `fill_blank`(code), `web_task` | 참조 정답이 실행으로 확인하는 필수 체크를 모두 통과하고, 시작 코드(버그 코드, 빈칸을 비운 코드)는 하나 이상 실패 |
| `<RunnableExample>` | 오류 없이 실행. `expectError`가 있으면 오류가 나야 함. `css`, `src` 예제는 건너뜀 |
| `parsons` | `checks`가 있으면 정답 순서(와 `alternatives`)로 조립한 코드가 필수 체크를 모두 통과하고, 방해 줄을 넣으면(`replaces` 자리, 없으면 모든 위치) 하나 이상 실패. 없으면 조립한 코드에 문법 오류가 없는지만 확인 |
| `find_bug_line` | 버그 코드가 `symptomCheck`의 증상(콘솔 출력 전체 또는 오류 이름)을 그대로 내고, `fixedCode`는 오류 없이 실행되며 증상이 없음 |
| `mcq_single`, `mcq_multi`, `true_false`, `fill_blank`(text) | 실행할 코드가 없어 건너뜀. 스펙의 오개념 ID가 있는지는 정적 검사에서 확인 |

- `static`, `html-valid` 체크는 서버가 실행 없이 채점하므로 실행 검증에서 뺍니다.
- v0.1의 `mcq_single`에는 선택지 코드를 실행하는 `verifyChecks`가 없어 실행 검증 대상이 아닙니다.
- 처음에는 브라우저를 설치합니다: `pnpm --filter @proginone/e2e exec playwright install chromium`.
- `--concurrency <n>`으로 동시에 쓰는 페이지 수를 바꿉니다(기본 4).

출력은 항목마다 한 줄이고, 실패는 고칠 내용을 아래 줄에 덧붙입니다.

```text
통과  courses/.../002-predict-quoted-expression.yaml  predict_output  기대값 콘솔 2줄: 10 + 5 ⏎ 15
실패  courses/.../012-fix-receipt.yaml  fix_bug  참조 정답이 필수 체크 1개를 통과하지 못합니다
      "output" (영수증 다섯 줄이 ...): 값이 기대와 다릅니다 · 기대 합계: 11000 · 실제 합계: 7000

실행 검증: 문제 56개, 예제 14개 — 통과 43, 실패 2, 실행 대상 아님 25
```

실행 검증이 끝나면 새 기대값으로 정적 검사를 한 번 더 하고 그 결과도 보여 줍니다.

### 예측 문제의 기대값 파일

`content/.generated/predict-expected.json`은 문제 ID별로 기대값과 **입력 해시**(코드, `lang`, `answerKind`, `expression`, `choices`의 해시)를 담습니다.

- `content:check`와 `content:build`는 이 파일을 읽어, 해시가 맞는 문제의 `spec.expected`를 채웁니다. 그래서 빌드에는 브라우저가 필요 없고, 같은 원본은 항상 같은 `content.db`가 됩니다.
- 코드를 고치고 `content:check:run`을 다시 돌리지 않으면 해시가 달라져 "실행 기대값이 낡았습니다"가 나옵니다. 승인된 문제는 오류(빌드 실패), 초안은 경고입니다.
- 힌트, 해설, `misconceptionByAnswer`만 고쳤다면 다시 실행할 필요가 없습니다.
- 파일은 `content:check:run`이 다시 씁니다. 손으로 고치지 않고, 바뀌면 원본과 함께 커밋합니다.
- CI의 e2e 작업은 `pnpm content:check:run --frozen`을 실행합니다. `--frozen`은 파일을 쓰지 않고, 커밋된 파일이 실행 결과와 다르면 실패합니다.

### content:build와 content:build:dev

`content:build`는 검사를 통과하면 `content/dist/content.db`를 원자적으로(임시 파일 후 이름 바꾸기) 만듭니다. 검사 오류가 있으면 아무것도 쓰지 않습니다.

- 승인된 문제만 들어갑니다([D-004](/docs/decisions.md)).
- `aliases.yaml`의 별칭을 `content_id_aliases`에 쓰고, 성공하면 공개 slug 목록(`content/.published-slugs.txt`)을 갱신합니다. 바뀌었으면 커밋합니다.
- `content:build:dev`(`--include-drafts`)는 초안도 넣은 개발용 빌드입니다. `content_meta`에 `includes_drafts = 1`이 기록됩니다. 배포·실사용에는 쓰지 않습니다.

## 검토와 승인

자동 검증은 "실행상 올바름"만 보장합니다. 교육적 품질은 검토자가 판단합니다.
사용자가 학습자 본인이므로, 검토는 **AI 교차 검토**로 합니다([D-027](/docs/decisions.md), [설계 6단계](/docs/design/content-and-exercises.md#6단계-ai-교차-검토)).

1. 작성자(사람 또는 AI)는 `review.status: draft`로 씁니다. AI 초안은 `draftedBy: ai:<이름>`입니다.
1. 작성자는 `content:check`와 `content:check:run`을 모두 통과시킵니다.
1. **독립 AI 검토자**가 초안 작성자와 분리된 컨텍스트(새 세션, 초안 대화 없음)에서 검토합니다.
   - 시작할 때와 고친 뒤에 `pnpm content:check:run`을 **직접 다시 실행**해 오류 0개를 확인합니다.
   - 설계 문서의 [품질 체크리스트](/docs/design/content-and-exercises.md#품질-체크리스트-검토자용)로 확인합니다. 레슨 본문, `core` 개념의 문제, 단원 평가 문제는 전수 검토하고, 그 밖의 문제는 배치마다 30% 이상 무작위 + 경고가 있는 문제 전부를 봅니다.
   - 승인·수정·거부 판단과 이유, 직접 고친 내용을 PR 설명(또는 검토 기록)에 남깁니다.
1. 승인하면 다음처럼 바꿉니다. `reviewedBy`는 `human` 또는 `ai:reviewer`만 쓸 수 있고, `draftedBy`와 같으면(자기 승인) 오류입니다. `reviewedBy` 없이 `approved`로 두어도 오류입니다.

   ```yaml
   review:
     status: approved
     draftedBy: ai:claude
     reviewedBy: ai:reviewer
   ```

1. 승인한 예측 문제는 기대값이 최신이어야 빌드됩니다.
1. 승인된 문제는 검토자와 관계없이 content.db에 `review_status = 'trusted'`로 들어갑니다.

단원의 승인된 문제 수가 `practice.targetCount`와 다르면 경고가 납니다.

## 자주 나는 오류

| 메시지 | 원인과 해결 |
|---|---|
| `문제 ID는 단원 ID(...)로 시작해야 합니다` | 문제 `id` 앞부분을 단원 ID와 맞춥니다. |
| `id는 "js-basics.start.first-program"여야 합니다` | 디렉터리 이름(숫자 접두사 제외)과 `id` 마지막 조각을 맞춥니다. |
| `목록에 없는 단원 디렉터리입니다` / `단원 "..."의 디렉터리가 없습니다` | `module.yaml`의 `lessons`(또는 `course.yaml`의 `modules`)와 디렉터리를 맞춥니다. |
| `개념 ...을(를) 이미 앞 단원에서 소개했습니다` | 한 개념은 한 단원의 `primary`에만 둡니다. 다른 단원에서는 `practiced`나 `reviewed`로 씁니다. |
| `흔한 실수에 오개념 ...이(가) 없습니다` | 주 개념의 오개념마다 `pitfalls` 섹션에 `<Pitfall misconception="...">`을 씁니다. |
| `필수 섹션이 없습니다` / `첫 섹션은 objectives여야 합니다` | 12개 섹션을 모두 두고, `objectives`로 시작해 `next`로 끝냅니다. |
| `허용되지 않은 컴포넌트입니다` / `원시 HTML은 쓸 수 없습니다` | 표의 컴포넌트만 씁니다. 태그 예시는 인라인 코드로 감쌉니다. |
| `속성 표현식은 JSON 리터럴...만 쓸 수 있습니다` | `concepts={["a"]}`처럼 큰따옴표 JSON으로 씁니다. |
| `힌트는 정확히 3개여야 합니다` | `hints`를 3단계로 맞춥니다. |
| `주 개념(weight: 1)이 정확히 1개여야 합니다` | `concepts`에서 `weight: 1`을 하나만 둡니다. |
| `CSS 과정에서는 mcq_single, fill_blank, web_task 유형만 쓸 수 있습니다` | CSS 과정 문제는 세 유형 중 하나로 바꿉니다([D-028](/docs/decisions.md)). |
| `승인된 문제는 검토자(...)가 필요합니다` / `초안 작성자가 스스로 검토할 수 없습니다` | `reviewedBy`를 `human` 또는 `ai:reviewer`로, `draftedBy`와 다르게 씁니다. |
| `spec: checks.N: call 체크에는 entry가 필요합니다. (CHECK_NEEDS_ENTRY)` | `entry` 없는 `implement_function`(프로그램 작성 문제)에는 `console`·`program` 체크만 씁니다. |
| `spec: 없는 오개념입니다: ...` | 스펙 안의 오개념 ID(선택지 `misconception` 등)를 `misconceptions/*.yaml`에 추가하거나 고칩니다. |
| `spec: ...` | 유형별 스펙 오류입니다. 경로(`blanks.0.accept` 등)를 보고 위의 유형별 예와 비교합니다. |
| `실행 기대값이 아직 없습니다` / `낡았습니다` | `pnpm content:check:run`을 실행하고 바뀐 기대값 파일을 커밋합니다. |
| `실행 결과로 기대값을 만들 수 없습니다` | 예측 코드가 예상하지 못한 오류를 냈습니다. 오류를 묻는 문제면 `answerKind: error`로 바꿉니다. |
| `결정론 위반` | `Math.random()`, `Date`, 타이머 순서 등에 기대지 않게 코드를 바꿉니다. |
| `참조 정답이 필수 체크 N개를 통과하지 못합니다` | `solution`(또는 첫 `accept`)이나 체크의 기대값이 틀렸습니다. 아래 줄의 기대·실제 값을 비교합니다. |
| `시작 코드가 이미 모든 필수 체크를 통과합니다` | 아무것도 고치지 않아도 정답이 됩니다. 체크를 보강하거나 시작 코드를 바꿉니다. |
| `방해 줄 ...을 ...에 넣어도 모든 필수 체크를 통과합니다` | 파슨스의 방해 줄이 동작을 바꾸지 않는 자리가 있습니다. `replaces`로 대신할 줄을 적거나 체크를 보강합니다. |
| `버그 코드가 symptomCheck의 증상(...)을 내지 않습니다` / `fixedCode에도 같은 증상이 남아 있습니다` | 아래 줄의 실제 실행 결과와 `symptomCheck`·`fixedCode`를 비교해 고칩니다. |
| `오류 없이 실행되어야 합니다` / `expectError로 표시했지만` | 예제의 `expectError` 표시를 실제 동작과 맞춥니다. |
| `Chromium을 찾을 수 없습니다` | `pnpm --filter @proginone/e2e exec playwright install chromium`을 실행합니다. |

## 관련 문서

- [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md)
- [코드 실행 샌드박스 설계](/docs/design/code-execution-sandbox.md)
- [`@proginone/exercise-kit` README](/packages/exercise-kit/README.md)
- [테스트 가이드](/docs/guides/testing.md)
