# 시작하기

ProgInOne을 내 컴퓨터에서 실행하고 개발 환경을 준비하는 방법입니다.

- 대상: 학습자(앱 사용), 기여자(개발)
- 최종 수정: 2026-11-23 (공통 패키지 토큰: D-094)

## 필요한 도구

| 도구 | 버전 | 확인 |
|---|---|---|
| Node.js | 24 LTS 이상(`.nvmrc`) | `node --version` |
| pnpm | `package.json`의 `packageManager` 버전 | `pnpm --version` |
| Codex CLI | AI 튜터를 쓸 때만. 0.155.1 이상 | `codex --version` |
| Docker | 시각 회귀 테스트를 돌릴 때만 | `docker info` |

nvm을 쓴다면 저장소에서 `nvm use`를 실행합니다.

### 공통 패키지 토큰

저장소에서 개발하려면(`pnpm install`) GitHub 토큰이 필요합니다. 언어 저장소들이 함께 쓰는 공통 패키지(`@proginone/*`)가 GitHub Packages에 있고, GitHub Packages는 공개 패키지도 토큰이 있어야 내려받을 수 있기 때문입니다([D-090](/docs/decisions.md)).
릴리스 묶음으로 설치하는 학습자는 토큰이 필요 없습니다([설치와 업그레이드](/docs/guides/install-and-upgrade.md)).

```shell
gh auth refresh -h github.com -s read:packages
npm config set //npm.pkg.github.com/:_authToken "$(gh auth token)"
```

- 토큰은 사용자 설정(`~/.npmrc`)에만 둡니다. pnpm은 저장소의 `.npmrc`에 쓴 인증 설정을 무시합니다. 저장소의 `.npmrc`에는 레지스트리 주소만 있습니다.
- GitHub CLI 대신 `read:packages` 권한만 준 classic 개인 토큰을 같은 자리에 넣어도 됩니다. 자세한 내용은 core의 [언어 저장소에서 쓰기][core-consuming]에 있습니다.
- `pnpm install`이 `401`(`No authorization header`)로 실패하면 토큰이 없거나 권한이 부족한 것입니다.

[core-consuming]: https://github.com/ProgInOne/core/blob/develop/docs/guides/consuming.md#레지스트리-설정

## 앱 실행

```shell
pnpm install
pnpm build && pnpm start
```

- 서버가 `http://127.0.0.1:4310`에서 시작하고 브라우저를 엽니다.
- 학습 데이터는 OS 표준 위치에 저장됩니다(macOS: `~/Library/Application Support/ProgInOne/`).
- 이미 실행 중이면 새로 띄우지 않고 실행 중인 앱을 엽니다.
- 끄려면 터미널에서 `Ctrl+C`를 누릅니다. 진행 중인 작업을 정리하고 데이터베이스를 안전하게 닫습니다.

## 개발 모드

```shell
pnpm dev
```

- 서버(`:4310`, 변경 시 자동 재시작)와 Vite 개발 서버(`:5173`)가 함께 뜹니다. `http://127.0.0.1:5173`을 엽니다.
- 개발 모드의 데이터는 저장소의 `.data/`에 저장되며 git에 올라가지 않습니다. 처음부터 다시 시작하려면 서버를 끄고 `.data/`를 지웁니다.
- Vite가 `/api`를 서버로 프록시하고, 서버가 쓴 세션 토큰(`.data/dev-session.json`)을 페이지에 넣습니다. 서버를 재시작하면 토큰이 바뀌므로 페이지를 새로 고칩니다.

## 콘텐츠 빌드

서버는 `content/dist/content.db`(또는 `PROGINONE_CONTENT_DB`)의 콘텐츠를 읽습니다.

```shell
pnpm content:check      # 스키마·참조·레슨 본문 검사
pnpm content:build      # 승인된(approved) 문제만 넣어 content.db 생성
pnpm content:build:dev  # 개발용: 검토 전(draft) 문제도 포함
```

- AI가 쓴 문제는 사람이 검토해 `review.status: approved`로 바꾸기 전까지 `draft`입니다. `content:build`는 draft 문제를 빼므로, 검토 전에는 연습 문제가 비어 보입니다.
- `content:build:dev`는 draft 문제를 `auto_verified` 상태로 넣고 `content_meta`에 `includes_drafts = 1`을 남깁니다. 개발 중 화면 확인용이며 실사용 content.db에는 쓰지 않습니다.

## 설정

설정 우선순위는 **환경 변수 > `<데이터 위치>/config.json` > 기본값**입니다. 값이 잘못되면 서버가 어떤 값이 문제인지 출력하고 종료합니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PROGINONE_PORT` | `4310` | 서버 포트. 사용 중이면 시작하지 않고 알려 줍니다 |
| `PROGINONE_DATA_DIR` | OS 표준 위치(개발: `.data/`) | 학습 데이터 위치 |
| `PROGINONE_BACKUP_DIR` | `<데이터 위치>/backups` | 백업 위치 |
| `PROGINONE_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `PROGINONE_OPEN_BROWSER` | 프로덕션 `true`, 개발 `false` | 시작 시 브라우저 열기 |
| `PROGINONE_CODEX_PATH` | `codex` | Codex CLI 실행 파일 |
| `PROGINONE_AI_PROVIDER` | `codex` | `mock`은 테스트·개발용 |

## 데이터와 백업

- 앱은 시작할 때와 매시간 확인해 하루에 한 번(하루 경계 04:00) 자동으로 백업합니다. 새 주의 첫 백업은 주간 백업으로도 보관합니다. 보관 개수는 일일 14개, 주간 8개입니다.
- 앱을 업데이트해 데이터베이스 구조가 바뀌면, 바꾸기 전에 백업하고 실패하면 자동으로 되돌립니다.
- **설정 > 데이터**에서 백업 목록을 보고, 지금 백업하거나 원하는 시점으로 복원합니다. 복원하기 전 상태도 따로 백업됩니다.
- 백업 파일은 `<백업 위치>/<종류>/` 아래의 SQLite 파일과 메타 파일(`*_user.meta.json`)입니다.

## 문제 해결

| 증상 | 해결 |
|---|---|
| "포트 4310을(를) 이미 다른 프로그램이 쓰고 있습니다" | `PROGINONE_PORT=4311 pnpm start`처럼 다른 포트를 지정합니다 |
| "웹 앱이 빌드되지 않았습니다" | `pnpm build`를 먼저 실행합니다 |
| 화면에 "세션이 만료되었습니다" | 서버가 재시작되어 토큰이 바뀌었습니다. 페이지를 새로 고칩니다 |
| "더 새로운 버전의 ProgInOne이 만든 것입니다" | 데이터를 만든 앱보다 오래된 앱을 실행했습니다. 앱을 업데이트합니다 |
| "데이터베이스 업데이트에 실패해 이전 상태로 복구했습니다" | 출력된 백업 경로와 오류를 이슈로 남깁니다. 데이터는 업데이트 전 상태로 남아 있습니다 |

더 많은 증상과 진단 방법은 [디버깅 가이드](/docs/guides/debugging.md)에 있습니다.

## 관련 문서

- [테스트 가이드](/docs/guides/testing.md)
- [디버깅 가이드](/docs/guides/debugging.md)
- [기여 가이드](/CONTRIBUTING.md)
- [시스템 아키텍처 설계](/docs/design/system-architecture.md)
