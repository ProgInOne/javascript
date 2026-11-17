# @proginone/exercise-ui

문제 유형별 React 렌더러와 실습 위젯(확신도, 힌트 사다리, 피드백 배너, 체크 목록, 콘솔)입니다.
규격의 원천은 [UI/UX 설계](/docs/design/ui-ux.md#학습-특화-컴포넌트)와 [콘텐츠·문제 시스템 설계](/docs/design/content-and-exercises.md#유형별-스펙)이고, 스펙·답안 형식은 `@proginone/exercise-kit`의 공개 스키마가 원천입니다.

## 원칙

- 렌더러는 **정답 키를 제거한 공개 스펙**(`redactSpec` 결과)만 받습니다. 정답 키가 없어도 동작해야 합니다.
- 렌더러는 제어 컴포넌트입니다. `value`를 보여주고 바뀐 답안을 `onChange`로 알립니다. 답안 형식은 exercise-kit의 답안 스키마와 같습니다.
- 채점·실행은 하지 않습니다. 채점 결과(`GradeResult`)와 실행 결과(`RunResult`, `packages/runner`)를 받아 보여주기만 합니다.
- 단축키(`⌘Enter` 제출, `⌘'` 실행, `⌘.` 다음 힌트)는 페이지가 `useExerciseShortcuts`로 한 번 등록합니다. 위젯은 단축키 표시(`Kbd`, `aria-keyshortcuts`)만 합니다.
- 정오·상태는 항상 아이콘과 텍스트를 함께 씁니다(색만으로 표시하지 않음).

## 스타일

[D-025](/docs/decisions.md)에 따라 일반 CSS(`pi-ex-` 접두사, 의미 토큰만 사용)입니다. 앱은 `@proginone/ui/components.css` 다음에 같은 계층으로 가져옵니다.

```css
/* apps/web/src/app/tailwind.css */
@import '@proginone/ui/components.css' layer(components);
@import '@proginone/exercise-ui/exercise-ui.css' layer(components);
```

에디터·콘솔을 감싸는 영역에 `workbench` 클래스(`WORKBENCH_CLASS`)를 붙이면 설정 "작업대 테마: 어둡게"(`<html data-workbench="dark">`)가 그 영역에만 적용됩니다.

## 문제 모델

| API | 용도 |
|---|---|
| `parsePublicSpec(typeId, raw)` | API로 받은 공개 스펙을 exercise-kit 공개 스키마로 검증. 모르는 유형·잘못된 스펙은 `null` |
| `initialAnswer(exercise)` | 빈 답안: 선택 없음(`null`), 빈 빈칸, 시작 코드·버그 코드 복사본 |
| `isAnswerReady(exercise, answer)`, `notReadyReason(exercise)` | 제출 가능 여부와 확신도 버튼에 보여줄 이유 |

## 렌더러

| 컴포넌트 | 유형 | 주요 props |
|---|---|---|
| `McqSingle` | `mcq_single` | `spec`, `value: { optionId } \| null`, `onChange`, `labelledBy`, `disabled`, `correctOptionId`(채점 후 정답 표시). 네이티브 라디오 그룹(화살표 이동), 그룹 안에서 숫자 키 `1`~`5` 선택 |
| `FillBlank` | `fill_blank` (text·code) | `spec`, `value: { blanks }`, `onChange`, `feedback`(빈칸별 정오 표시), `checkResults`(코드 모드 체크 목록). 읽는 순서대로 인라인 입력, `Tab`으로 다음 빈칸 |
| `PredictOutput` | `predict_output` | `spec`, `value`, `onChange`, `onRunActual`·`actual`·`running`(제출 후 "실제로 실행"과 줄 단위 비교). `answerKind`별 입력: 여러 줄 출력, 값, 오류 여부·이름, 선택지 |

| `ImplementFunction` | `implement_function` | `spec`, `value: { files }`, `onChange` + 코드 실행 props(아래). 에디터 + [테스트 결과 / 콘솔] 탭. 초기화 → 시작 코드 |
| `FixBug` | `fix_bug` | 위와 같음 + 증상(`bugDescription`)과 `maxEditDistance` 안내. 초기화 → 버그 코드 |
| `WebTask` | `web_task` 기본형 | 위와 같음 + `preview`(`PreviewFrame` props). 에디터 \| 미리보기, 요구사항 목록(마일스톤 묶음). `focus: dom`이면 콘솔 탭이 먼저 열림 |
| `ExerciseRenderer` | 6종 모두 | `exercise`(`parsePublicSpec` 결과)로 위 렌더러를 고르는 편의 컴포넌트 |

코드 유형의 실행 props(`CodeRunProps`): `onRun()`(실행 버튼, `⌘'`), `onStop()`, `running`, `run: RunResult | null`(콘솔 탭, 에디터 오류 줄), `checkResults`(공개 체크 빠른 피드백 `gradeChecks` 또는 채점 결과), `saveStatus`, `autocomplete`, `timeoutMs`.
실행 자체는 `packages/runner`가 합니다. 이 패키지는 iframe을 만들지도, 코드를 실행하지도 않습니다.

## 에디터와 미리보기

| 컴포넌트 | 주요 props | 동작 |
|---|---|---|
| `CodeEditor` | `value`, `onChange`, `language`(`js`·`html`·`css`), `label`, `readOnly`, `autocomplete`(기본 끔), `lineNumbers`, `errorLines`, `onFormatError`, `ref`(`focus`·`goToLine`·`format`) | CodeMirror 6. 토큰 기반 테마라 라이트 기본과 다크 작업대가 함께 동작합니다. `Tab` 들여쓰기, `Esc` 다음 `Tab`으로 빠져나가기(하단 안내), `⇧⌥F` 포맷(물리 키 기준이라 macOS Option 조합도 동작), `⌘Enter`는 비워 두어 제출 단축키로 전달 |
| `EditorPane` | `files`, `onChange`, `onReset`, `saveStatus`, `readOnly`, `autocomplete`, `errorLines`, `ref`(`goTo(file, line)`) | 파일 이름(여러 파일은 전환 버튼, P1), 포맷, 확인 후 초기화, 자동 저장 상태, 포맷 실패 안내 |
| `PreviewFrame` | `mountRef`(러너가 샌드박스 iframe을 붙일 자리) 또는 `children`, `status`(`idle`·`loading`·`ready`·`error`), `errorMessage`, `notice`, `documentTitle`, `onRefresh` | 툴바(새로 고침), 알림, 탭 제목 막대, 빈 상태·로딩·오류 상태. 뷰포트 전환과 요소 검사는 P1 |
| `PreviewTabBar` | `title`(러너가 알린 `document.title`, 없으면 "제목 없음") | 미리보기 위 브라우저 탭 모양 막대(D-082). 제목은 텍스트로만 그림 |
| `formatCode(code, language)` | — | Prettier(첫 사용 때 지연 로드). 문법 오류는 줄 번호가 있는 `FormatError` |

## 위젯

| 컴포넌트 | 주요 props | 동작 |
|---|---|---|
| `ConfidencePicker` | `onSubmit(confidence \| null)`, `askConfidence`, `disabledReason`, `submitting` | "확실해요 / 애매해요 / 찍었어요" 제출 버튼. 끄면 "제출" 하나. 제출할 수 없으면 버튼에 포커스는 남기고(`aria-disabled`) 이유를 설명으로 연결 |
| `HintLadder` | `hints`, `revealed`, `onReveal(level)`, `onRevealAnswer`, `answerRevealed`, `answer`, `locked`, `pending` | 한 단계씩 열고 쌓음. "정답 보기"는 마지막 힌트 뒤에만 활성, 확인 대화 후 공개. `locked`(평가)면 "평가가 끝나면 열려요" |
| `FeedbackBanner` | `result`, `confidence`, `misconceptions`, `explanation`, `actions` | 정답·부분 정답·오답·실행 오류. 확신도별 문구, 실패한 테스트·요구사항·마일스톤 요약, 오개념 설명(확신했는데 틀리면 펼침), 해설(찍었으면 펼침). `role="status"`이므로 제출 전에도 `result={null}`로 마운트해 둡니다 |
| `MisconceptionNote` | `info`, `defaultOpen` | 오개념 이름·설명·관련 레슨 행동 |
| `CheckList` | `checks`, `results`, `entry`, `title`, `milestones` | 공개 체크는 입력·기대값 요약(`sumEven([1, 2]) → 2`), 숨김 체크는 설명과 "숨김" 표시만. 결과가 있으면 실패를 먼저, 공개 체크만 기대값·실제값 펼침 |
| `ConsoleView` | `result`, `running`, `timeoutMs`, `onStop`, `onClear`, `onNavigate` | `RunResult.status`와 1:1인 상태 문구, ProgInOne 콘솔 형식 한 줄 출력, 잘림 안내, 오류 원문 + 학습자 언어 설명, 위치 버튼(에디터 이동). 요약은 `role="status"`로 실행 단위 알림 |
| `CodeBlock` | `code`, `language`, `lineNumbers`, `highlightLines` | 읽기 전용 코드. 줄 번호는 텍스트로 포함(스크린 리더가 읽음), 복사 시 제외 |

보조 함수: `checkSummary`, `checkTitle`, `runStatusText`, `explainRunError`, `matchExerciseShortcut`, `modKeyLabel`, `InlineText`(백틱 코드만 해석하는 안전한 짧은 텍스트 렌더러).

## 테스트

루트 Vitest의 `ui` 프로젝트(jsdom)에서 실행합니다. Testing Library + user-event로 역할·이름과 키보드 동작을, axe-core로 WCAG 2.2 A/AA 규칙을 검사합니다.
jsdom에는 레이아웃이 없어 에디터는 래퍼 계약(값·`onChange`·접근성 이름·오류 줄·포맷·줄 이동)만 검사합니다. 실제 타이핑·키보드 탈출·`⇧⌥F` 같은 브라우저 동작은 실습 화면 통합 후 Playwright E2E로 검사합니다.
