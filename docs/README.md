# ProgInOne 문서 지도

ProgInOne의 모든 문서 목록과 읽는 순서입니다.
문서를 추가하거나 삭제하면 이 목록도 함께 갱신합니다.

## 처음 읽는 순서

1.  [PRD](/docs/product/prd.md): 무엇을, 왜 만드는가
1.  [결정 기록](/docs/decisions.md): 지금까지 합의한 결정
1.  [시스템 아키텍처 설계](/docs/design/system-architecture.md): 전체 구조와 하위 설계 문서의 뼈대
1.  [구현 로드맵](/docs/roadmap.md): 무엇을 어떤 순서로 만드는가
1.  관심 영역의 설계 문서

## 공통 문서

| 문서 | 설명 |
|---|---|
| [용어집](/docs/glossary.md) | 용어와 코드 식별자의 단일 정의 |
| [결정 기록](/docs/decisions.md) | 합의된 결정과 근거 (추가 전용) |
| [문서 작성 규칙](/docs/documentation-style.md) | Google 문서화 가이드 기반 작성 규칙 |
| [기여 가이드](/CONTRIBUTING.md) | 브랜치, 커밋, 리뷰, 완료 정의 |
| [변경 이력](/CHANGELOG.md) | 릴리스별 변경 사항 |

## 가이드

| 문서 | 설명 |
|---|---|
| [시작하기](/docs/guides/getting-started.md) | 실행, 개발 모드, 설정, 데이터와 백업, 문제 해결 |
| [테스트 가이드](/docs/guides/testing.md) | 테스트 종류, 실행 방법, 작성 규칙, 시각 회귀 |

## 제품 문서

| 문서 | 상태 |
|---|---|
| [PRD](/docs/product/prd.md) | 승인됨 |

## 설계 문서

| 문서 | 다루는 내용 | 상태 |
|---|---|---|
| [시스템 아키텍처](/docs/design/system-architecture.md) | 런타임 구성, 모노레포, API 규약, 보안 경계, 빌드·CI·릴리스 | 승인됨 |
| [데이터 모델](/docs/design/data-model.md) | content.db / user.db 스키마, 마이그레이션, 자동 백업 | 승인됨 |
| [학습 엔진](/docs/design/learning-engine.md) | 숙련도, FSRS 복습, 연습 세트 구성, 재학습, 오늘의 학습 | 승인됨 |
| [콘텐츠·문제 시스템](/docs/design/content-and-exercises.md) | 커리큘럼, 레슨 형식, 문제 유형, 템플릿, 제작·검증 파이프라인 | 승인됨 |
| [코드 실행 샌드박스](/docs/design/code-execution-sandbox.md) | 격리 실행, 위협 모델, 러너 프로토콜, 체크 실행 | 승인됨 |
| [AI 시스템](/docs/design/ai-system.md) | Codex 통합, AI 작업, 프롬프트, 장기 기억 | 승인됨 |
| [UI/UX](/docs/design/ui-ux.md) | 디자인 시스템, 화면 설계, 인터랙션, 접근성 | 승인됨 |

## 계획 문서

| 문서 | 상태 |
|---|---|
| [구현 로드맵](/docs/roadmap.md) | 승인됨 |

## 예정 문서

구현이 시작되면 작성합니다. 아직 내용이 없으므로 파일을 만들지 않습니다.

| 문서 | 작성 시점 |
|---|---|
| `docs/guides/getting-started.md`: 개발 환경 준비와 실행 | M1 (기반 구축) |
| `docs/guides/testing.md`: 테스트 실행, 시각 회귀 기준 갱신 | M1 |
| `docs/guides/content-authoring.md`: 콘텐츠 작성과 검증 | 콘텐츠 파이프라인 구축 마일스톤 |
| `docs/guides/debugging.md`: 로그, 진단, 자주 발생하는 문제 | AI 통합 마일스톤 |
| `docs/guides/install-and-upgrade.md`: 설치, 업그레이드, 백업 복원 | 첫 릴리스 전 |
| `docs/guides/release.md`: 릴리스 절차 | 첫 릴리스 전 |
| 패키지별 `README.md` | 각 패키지 생성 시 |
