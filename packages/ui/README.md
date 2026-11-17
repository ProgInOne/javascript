# @proginone/ui

ProgInOne의 디자인 토큰(CSS 변수)과 기본 React 컴포넌트입니다.
규격의 원천은 [UI/UX 설계](/docs/design/ui-ux.md#디자인-토큰)와 결정 [D-011, D-024](/docs/decisions.md)입니다.

## 사용법

웹 앱의 진입점에서 CSS를 다음 순서로 한 번만 가져옵니다.

```ts
import '@proginone/ui/fonts.css'; // Pretendard Variable, JetBrains Mono (번들 포함, CDN 없음)
import '@proginone/ui/tokens.css'; // 기본·의미·컴포넌트 토큰
import '@proginone/ui/base.css'; // 전역 기본 스타일, 포커스 링, reduced-motion
import '@proginone/ui/components.css'; // 기본 컴포넌트 스타일
```

Tailwind를 함께 쓰는 앱(`apps/web`)은 `base.css`와 `components.css`를 각각 `@layer base`, `@layer components`로 가져와 유틸리티가 덮어쓸 수 있게 합니다(`apps/web/src/app/tailwind.css`, [D-025](/docs/decisions.md)).

빌드 단계가 없습니다. `exports`가 `src`의 TypeScript·CSS 파일을 직접 가리키며, 웹 앱의 번들러(Vite)가 처리합니다.

앱 루트를 `UiProvider`로 한 번 감쌉니다. 툴팁 지연(400ms)과 토스트 영역을 제공하며, `IconButton`, `Dialog`, `Drawer`, `useToast`가 이를 필요로 합니다.

```tsx
import { Button, UiProvider, useToast } from '@proginone/ui';

function SaveButton() {
  const toast = useToast();
  return (
    <Button variant="primary" onClick={() => toast({ title: '저장했어요', variant: 'success' })}>
      저장
    </Button>
  );
}

root.render(
  <UiProvider>
    <SaveButton />
  </UiProvider>,
);
```

## 컴포넌트

규격은 [UI/UX 설계 기본 컴포넌트](/docs/design/ui-ux.md#기본-컴포넌트)를 따릅니다. 스타일은 `components.css` 한 파일의 `pi-` 접두사 클래스(BEM 방식)이며 의미 토큰만 씁니다.

| 컴포넌트 | 기반 | 접근성 동작 |
|---|---|---|
| `Button` | `<button>` | 기본 `type="button"`. `loading`이면 레이블과 포커스를 유지하고 `aria-busy`, `aria-disabled`를 걸며 클릭을 무시합니다. 스피너는 `icon` 자리에 나타납니다 |
| `IconButton` | `<button>` + Tooltip | `label`이 필수이며 `aria-label`과 툴팁(단축키 포함)에 함께 쓰입니다. 32×32px |
| `Input` | `<input>` | 보이는 레이블 필수. `error`가 있으면 `aria-invalid`, 힌트·오류 메시지를 `aria-describedby`로 연결하고 아이콘과 텍스트로 표시합니다 |
| `Select` | Radix Select | 레이블이 연결된 combobox. 화살표·타입어헤드·Esc |
| `Checkbox`, `RadioGroup` | Radix | 레이블 텍스트 클릭으로 선택, 설명은 `aria-describedby`. 라디오는 탭 정지 하나, 화살표로 이동·선택 |
| `Tabs` (`TabsList`, `TabsTrigger`, `TabsContent`) | Radix Tabs | `underline`(콘텐츠 탭), `pill`(패널 내부 전환). ←/→, Home/End |
| `Dialog` | Radix Dialog | 모달. 포커스 트랩, Esc 닫기, 트리거로 포커스 복귀, 레이블된 닫기 버튼 |
| `Drawer` | Radix Dialog(`modal={false}`) | 오른쪽 비모달 드로어(튜터). 배경 조작 가능, 바깥 클릭으로 닫히지 않음, Esc 닫기 |
| `Tooltip` | Radix Tooltip | 400ms 지연, 키보드 포커스에도 표시, Esc로 닫힘 |
| `useToast` | Radix Toast | 우하단. 정보·성공은 5초 후 사라지고 오류는 직접 닫을 때까지 유지. 학습 피드백에는 쓰지 않습니다 |
| `Badge` | `<span>` | neutral, brand, success, error, warning, ai. 상태 배지는 아이콘이나 텍스트를 함께 씁니다 |
| `ProgressBar`, `ProgressRing` | Radix Progress, SVG | `role="progressbar"`, `aria-label` 필수, 값 텍스트는 % |
| `Skeleton` | `<span>` | 300ms 뒤에 보이며(공간은 처음부터 확보) 보조 기술에서 숨김. 로딩 영역에 `aria-busy`를 겁니다 |
| `EmptyState`, `ErrorState` | `<section>` | 아이콘 + 제목 + 설명 + 행동 1개. `ErrorState`는 오류 코드를 작게 표시하고 `inline` 변형은 `role="alert"`로 알립니다 |

`prefers-reduced-motion: reduce`에서는 이동·크기 애니메이션이 꺼지고 짧은 색·불투명도 전환만 남습니다(`base.css`).

## 테스트

`pnpm test`가 루트 Vitest `projects`로 이 패키지의 `src/**/*.test.tsx`를 jsdom 환경에서 실행합니다(다른 패키지는 node 환경).
Testing Library와 user-event로 키보드·ARIA 동작을 검사하고, axe-core로 WCAG 2.2 A/AA 규칙을 검사합니다. 색 대비는 jsdom에서 계산할 수 없으므로 `check:contrast`와 E2E에서 확인합니다.

## 토큰 계층

| 계층 | 예 | 규칙 |
|---|---|---|
| 기본(primitive) | `--jade-600`, `--neutral-550`, `--space-4`, `--radius-md` | 색 스케일과 원시 값. 컴포넌트에서 직접 쓰지 않습니다 |
| 의미(semantic) | `--color-text-primary`, `--color-action-primary`, `--color-border-input` | 컴포넌트는 이 계층만 씁니다 |
| 컴포넌트 | `--code-*`, `--syn-*`, `--mastery-*` | 에디터, 숙련 단계처럼 고유 이름이 필요한 영역만 |

- 시각 방향은 **C 차분한 교실** 하나만 기본으로 굽습니다([D-024](/docs/decisions.md)). 라이트 캔버스는 `neutral-50`, 카드는 흰색이며 밀도 토큰은 `--card-pad: space-5`, `--section-gap: space-6`, `--grid-gap: space-4`입니다.
- 의미 색은 `light-dark()`로 정의합니다. 테마 전환은 `color-scheme`만 바꾸며, 라이트·다크 값을 한 줄에서 함께 볼 수 있습니다.
- 타입 스케일은 `font` 축약값(`--text-h1` 등)과 자간 토큰(`--tracking-h1` 등)으로 씁니다. 레슨 본문 크기 설정은 `:root`의 `--lesson-font-size`를 바꿉니다.

## 테마 속성

| 속성 (`<html>`) | 값 | 동작 |
|---|---|---|
| `data-theme` | `light`, `dark` | 명시적 테마. 속성이 없으면 운영체제 설정(`prefers-color-scheme`)을 따릅니다 |
| `data-workbench` | `dark` | 설정 "작업대 테마: 어둡게". `.workbench` 하위(에디터·콘솔 패널)만 다크 매핑으로 바꿉니다 |

```html
<html lang="ko" data-theme="light" data-workbench="dark">
  …
  <section class="workbench">에디터와 콘솔</section>
</html>
```

TypeScript에서는 `Theme`, `WorkbenchTheme` 타입과 `WORKBENCH_CLASS` 상수를 씁니다.

## 대비 검사

```sh
pnpm check:contrast           # 미달 쌍만 출력, 미달이 있으면 실패
pnpm --filter @proginone/ui check:contrast -- --all   # 모든 쌍 출력
pnpm --filter @proginone/ui check:contrast -- --md    # 마크다운 표
```

[`scripts/check-contrast.ts`](scripts/check-contrast.ts)는 `tokens.css`의 의미 토큰을 라이트, 다크, 다크 작업대 각각에서 기본 색(`#rrggbb` 또는 `oklch()`)까지 풀어 WCAG 대비를 계산합니다.
기준은 본문 7:1, 텍스트 4.5:1, 입력 테두리·포커스 링·진도 채움 같은 비텍스트 3:1입니다. CI와 `pnpm check`에서 실행합니다.
의미 토큰을 추가하거나 매핑을 바꾸면 해당 쌍을 `PAIRS`에 추가합니다.

## 폰트

- [Pretendard](https://github.com/orioncactus/pretendard) 가변 글꼴의 한글 빈도 기반 동적 서브셋(`font-display: swap`)을 씁니다.
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) 가변 글꼴(굵기 축)을 Fontsource 패키지로 씁니다. 리거처는 `base.css`에서 끕니다.
- 두 글꼴 모두 SIL Open Font License 1.1입니다.
