# ProgInOne

> 로컬에서 실행되는 AI 기반 개인 맞춤형 웹 개발 학습 플랫폼

ProgInOne은 체계적인 커리큘럼, 충분한 문제은행, 브라우저 내장 실습 환경, 그리고 AI 튜터를 하나의 화면에 결합한 학습 플랫폼입니다.

**핵심 철학: AI는 학습을 돕고, 학습 상태와 교육 과정의 관리 책임은 애플리케이션이 진다.**

## 현재 상태

🟢 **기반 구축 중 (M3)**: 기술 검증(M1)과 디자인 방향(M2)이 확정되었고, 모노레포·서버·DB·디자인 시스템 골격을 만들고 있습니다.

## 문서

모든 문서는 [문서 지도](docs/README.md)에서 찾을 수 있습니다.
처음이라면 다음 순서로 읽으세요.

1.  [PRD](docs/product/prd.md): 무엇을, 왜 만드는가
1.  [결정 기록](docs/decisions.md): 합의된 결정
1.  [시스템 아키텍처 설계](docs/design/system-architecture.md): 전체 구조
1.  [구현 로드맵](docs/roadmap.md): 개발 순서

기여 방법은 [기여 가이드](CONTRIBUTING.md)를 참고하세요.

## 빠른 시작

필요한 도구: Node.js 24 LTS 이상(`.nvmrc`), pnpm(`package.json`의 `packageManager` 버전).

```shell
pnpm install
pnpm dev                   # 개발 모드: 서버(:4310) + Vite(:5173). http://127.0.0.1:5173
pnpm build && pnpm start   # 프로덕션 모드: http://127.0.0.1:4310 (브라우저 자동 열림)
pnpm check                 # lint, 포맷, 타입, 의존 규칙, 대비, 테스트, 문서 링크 검사
```

개발 모드의 학습 데이터는 저장소의 `.data/`(git 무시), 프로덕션은 OS 표준 위치에 저장됩니다([시스템 아키텍처 설계](docs/design/system-architecture.md#데이터-디렉터리)).

## 기술 방향 (요약)

- 로컬 웹앱: Vite + React + TypeScript(strict) / Node 로컬 서버(Hono)
- SQLite + Drizzle ORM, 자동 백업
- CodeMirror 6 에디터, sandbox iframe 기반 코드 실행
- AI: Codex App Server (ChatGPT 구독) 우선, 어댑터 계층으로 확장
- 숙련도: 설명 가능한 규칙 기반 + 개념 단위 FSRS 간격 반복

자세한 근거는 [결정 기록](docs/decisions.md)을 참고하세요.
