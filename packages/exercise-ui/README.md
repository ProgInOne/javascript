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
