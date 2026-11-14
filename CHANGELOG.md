# 변경 이력

이 프로젝트의 주요 변경 사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를, 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

### Added

- 서버 골격(M3): Hono 앱, 설정 로더(환경 변수 > `config.json` > 기본값), 구조화 로그, 오류 응답 모델, 보안 미들웨어(Host·Origin·세션 토큰), 유지보수 모드, 단일 인스턴스 잠금, `GET /api/v1/health`
- 모노레포 기반(M3): pnpm 워크스페이스, TypeScript strict, ESLint, Prettier, Vitest, 의존 방향 검사, 문서 링크 검사, GitHub Actions CI, Dependabot, PR 템플릿, `@proginone/shared` 오류 계약
- M1 기술 검증(2026-11-14): Codex 튜터 PoC(`poc/codex-tutor`)와 샌드박스 PoC(`poc/sandbox`) 결과, D-002·D-018 확정. 튜터 전용 `CODEX_HOME`과 도구 기능 비활성화, 셸 서브도메인 방식 추가
- M2 디자인 프로토타입(2026-11-14): 3개 시각 안 비교(`design/prototypes`), D-024(C 차분한 교실, 라이트 에디터, 로고 1안, 토큰 v1 수정)
- 외부 검토 반영(2026-11-14): 단계별 출시(v0.1 시범판 → v1.0 MVP), 학습 맥락별 규칙, 문제 수량 기준과 유형 구성비, 변형 그룹 반복 감쇠·게이트 강화, 체크 가중 부분 점수, 노트·자유 연습·인터랙티브 컴포넌트(P1), 결정 D-021~D-023
- 프로젝트 기획 문서: PRD, 시스템 아키텍처, 데이터 모델, 학습 엔진, 콘텐츠·문제 시스템, 코드 실행 샌드박스, AI 시스템, UI/UX 설계, 구현 로드맵.
- 결정 기록, 용어집, 문서 작성 규칙, 기여 가이드.
