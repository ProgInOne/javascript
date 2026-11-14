# @proginone/ui

ProgInOne의 디자인 토큰(CSS 변수)과 기본 React 컴포넌트입니다.
규격의 원천은 [UI/UX 설계](/docs/design/ui-ux.md#디자인-토큰)와 결정 [D-011, D-024](/docs/decisions.md)입니다.

## 사용법

웹 앱의 진입점에서 CSS를 다음 순서로 한 번만 가져옵니다.

```ts
import '@proginone/ui/fonts.css'; // Pretendard Variable, JetBrains Mono (번들 포함, CDN 없음)
import '@proginone/ui/tokens.css'; // 기본·의미·컴포넌트 토큰
import '@proginone/ui/base.css'; // 전역 기본 스타일, 포커스 링, reduced-motion
```

빌드 단계가 없습니다. `exports`가 `src`의 TypeScript·CSS 파일을 직접 가리키며, 웹 앱의 번들러(Vite)가 처리합니다.

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

[`scripts/check-contrast.ts`](scripts/check-contrast.ts)는 `tokens.css`의 의미 토큰을 라이트, 다크, 다크 작업대 각각에서 OKLCH 값까지 풀어 WCAG 대비를 계산합니다.
기준은 본문 7:1, 텍스트 4.5:1, 입력 테두리·포커스 링·진도 채움 같은 비텍스트 3:1입니다. CI와 `pnpm check`에서 실행합니다.
의미 토큰을 추가하거나 매핑을 바꾸면 해당 쌍을 `PAIRS`에 추가합니다.

## 폰트

- [Pretendard](https://github.com/orioncactus/pretendard) 가변 글꼴의 한글 빈도 기반 동적 서브셋(`font-display: swap`)을 씁니다.
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) 가변 글꼴(굵기 축)을 Fontsource 패키지로 씁니다. 리거처는 `base.css`에서 끕니다.
- 두 글꼴 모두 SIL Open Font License 1.1입니다.
