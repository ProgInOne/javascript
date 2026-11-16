# 설치와 업그레이드

릴리스 번들로 ProgInOne을 설치하고, 새 버전으로 올리고, 문제가 생기면 되돌리는 방법입니다.

- 대상: 학습자(앱 사용)
- 최종 수정: 2026-11-16
- 개발 환경(소스에서 실행, 개발 모드)은 [시작하기](/docs/guides/getting-started.md)를 봅니다.

## 요구 사항

| 항목 | 조건 | 확인 |
|---|---|---|
| OS | macOS(보장). Windows·Linux는 동작할 수 있지만 보장하지 않습니다(PRD NFR-10) | — |
| 브라우저 | 최신 Chrome(보장). Edge·Safari·Firefox는 점검 범위([호환성 점검](/docs/reviews/2026-11-16-m7-compatibility.md)) | — |
| Node.js | 24 LTS 이상 | `node --version` |
| pnpm | 번들 `package.json`의 `packageManager` 버전(예: `pnpm@12.15.0`) | `pnpm --version` |
| Codex CLI | AI 튜터를 쓸 때만. 0.155.1 이상, ChatGPT 로그인 | `codex --version` |
| 디스크 | 앱 약 200MB(의존성 포함), 학습 데이터와 백업은 보통 수십 MB | — |

- pnpm은 Node.js에 포함된 Corepack으로 켤 수 있습니다: `corepack enable`. 번들 안에서 `pnpm`을 실행하면 `packageManager`에 적힌 버전을 씁니다.
- 처음 설치할 때만 npm 레지스트리에서 의존성을 내려받습니다. 그 뒤로는 AI를 제외한 모든 기능이 네트워크 없이 동작합니다.

## 내려받기와 체크섬 확인

1.  [GitHub Releases](https://github.com/oscarjhk/ProgInOne/releases)에서 원하는 버전의 두 파일을 받습니다.
    - `proginone-<버전>.tar.gz`: 앱 번들(소스, 빌드된 웹 앱 `apps/web/dist`, 콘텐츠 팩 `content/dist/content.db`)
    - `proginone-<버전>.tar.gz.sha256`: SHA-256 체크섬

    GitHub CLI를 쓴다면:

    ```shell
    gh release download v0.3.0 -R oscarjhk/ProgInOne
    ```

1.  두 파일이 있는 폴더에서 체크섬을 확인합니다. `OK`가 나와야 합니다.

    ```shell
    shasum -a 256 -c proginone-0.3.0.tar.gz.sha256
    ```

    `FAILED`가 나오면 파일이 손상되었거나 바뀐 것입니다. 압축을 풀지 말고 다시 받습니다.

## 설치

앱 폴더는 버전마다 따로 둡니다. 예: `~/Applications/ProgInOne/proginone-0.3.0`.
학습 데이터는 앱 폴더 밖에 있으므로([데이터 위치](#데이터-위치)) 앱 폴더를 지우거나 바꿔도 학습 기록은 남습니다.

```shell
mkdir -p ~/Applications/ProgInOne
tar -xzf proginone-0.3.0.tar.gz -C ~/Applications/ProgInOne
cd ~/Applications/ProgInOne/proginone-0.3.0
pnpm install --prod --frozen-lockfile
```

- `--prod`는 실행에 필요한 의존성만 설치합니다. 테스트 도구(Playwright 등)는 받지 않습니다.
- `--frozen-lockfile`은 릴리스에 고정된 의존성 버전을 그대로 씁니다.
- 의존성의 설치 스크립트는 허용 목록에 있는 것만 실행됩니다(`pnpm-workspace.yaml`의 `allowBuilds`). 그래서 "Agent skills awaiting approval" 같은 안내가 나와도 승인할 필요가 없습니다.

## 처음 시작하기

```shell
cd ~/Applications/ProgInOne/proginone-0.3.0
pnpm start
```

- 서버가 `http://127.0.0.1:4310`에서 시작하고 브라우저를 엽니다. 처음에는 온보딩(학습 목표 설정)부터 시작합니다.
- 이미 실행 중이면 새로 띄우지 않고 실행 중인 앱을 엽니다.
- 끄려면 터미널에서 `Ctrl+C`를 누릅니다. 진행 중인 작업을 정리하고 데이터베이스를 안전하게 닫습니다.
- `pnpm start`는 실행 전에 의존성 상태를 확인합니다. `--prod`로 설치했으면 "Workspace package @proginone/e2e has dependencies but does not have a modules directory" 경고가 나올 수 있는데, 테스트 패키지가 설치되지 않았다는 뜻일 뿐 앱 실행에는 영향이 없습니다.
- 포트·데이터 위치·백업 위치는 환경 변수로 바꿀 수 있습니다(예: `PROGINONE_PORT=4311 pnpm start`). 전체 목록은 [시작하기 > 설정](/docs/guides/getting-started.md#설정)에 있습니다.
- AI 튜터를 쓰려면 앱의 **설정 > AI**에서 Codex 연결 상태를 확인하고 로그인합니다.

## 데이터 위치

| 무엇 | 위치(macOS 기본값) | 바꾸는 방법 |
|---|---|---|
| 학습 기록 `user.db`, 설정 `config.json`, 로그 | `~/Library/Application Support/ProgInOne/` | `PROGINONE_DATA_DIR` |
| 백업 | `<데이터 위치>/backups/` | 설정 > 데이터 > 백업 위치, 또는 `PROGINONE_BACKUP_DIR` |
| 콘텐츠 팩 `content.db` | 앱 폴더의 `content/dist/content.db` | `PROGINONE_CONTENT_DB` |

- 학습 기록은 데이터 위치에만 있습니다. 앱 폴더에는 학습 기록이 없습니다.
- 콘텐츠 팩(레슨·문제)은 앱 버전과 함께 배포되는 읽기 전용 파일입니다. 학습 기록은 콘텐츠 팩이 아니라 `user.db`에 있으므로, 콘텐츠 팩을 새 버전으로 바꿔도 학습 기록은 그대로입니다.
- 폴더 구조와 각 파일의 역할은 [디버깅 가이드](/docs/guides/debugging.md)에 있습니다.

## 백업

- 앱이 시작할 때와 매시간 확인해 하루 한 번(하루 경계 04:00) 자동으로 백업합니다. 새 주의 첫 백업은 주간 백업으로도 남깁니다.
- 보관 개수: 일일 14개, 주간 8개, 업데이트 전(`pre-migration`) 5개, 복원 전 3개, 초기화 전 3개, 직접 만든 백업은 지우지 않습니다.
- **설정 > 데이터 > 지금 백업**으로 원할 때 백업합니다. 업그레이드하기 전에는 한 번 직접 백업해 두기를 권장합니다.
- 백업은 `<백업 위치>/<종류>/<시각>_user.db`(SQLite 파일)와 메타 파일(`*_user.meta.json`)입니다. 다른 디스크로 옮겨 두려면 백업 폴더째 복사합니다.
- 컴퓨터를 바꿀 때는 앱을 끄고 데이터 위치 폴더 전체를 새 컴퓨터의 같은 위치로 복사한 뒤, 새 컴퓨터에 같은 버전 이상의 앱을 설치합니다.

## 업그레이드

새 버전은 새 폴더에 설치하고, 데이터 위치는 그대로 씁니다.

1.  실행 중인 앱에서 **설정 > 데이터 > 지금 백업**을 누릅니다(권장).
1.  터미널에서 `Ctrl+C`로 앱을 끕니다.
1.  새 버전을 [내려받고 체크섬을 확인](#내려받기와-체크섬-확인)한 뒤, [설치](#설치)처럼 새 폴더에 풀고 `pnpm install --prod --frozen-lockfile`을 실행합니다.
1.  새 폴더에서 `pnpm start`를 실행합니다.
1.  동작을 확인한 뒤 이전 버전 폴더를 지웁니다. 문제가 생기면 되돌릴 수 있도록 며칠 두어도 됩니다.

업그레이드할 때 앱이 하는 일:

- **학습 기록 마이그레이션**: 새 버전이 `user.db` 구조를 바꿔야 하면, 처음 시작할 때 먼저 `pre-migration` 백업을 만들고 마이그레이션을 적용합니다. 실패하면 그 백업으로 자동 복구하고 "데이터베이스 업데이트에 실패해 이전 상태로 복구했습니다"를 출력한 뒤 종료합니다. 이때 학습 기록은 업데이트 전 상태입니다.
- **콘텐츠 팩 교체**: 새 번들의 `content/dist/content.db`가 자동으로 쓰입니다. 앱은 시작할 때 콘텐츠 팩 버전을 기록합니다. 학습 기록은 문제·개념 ID로 연결되므로 ID가 그대로인 문제와 개념은 기록이 이어집니다. 콘텐츠 팩에서 빠진 문제의 기록은 지우지 않고 남지만 화면에는 나오지 않을 수 있습니다. 이름이 바뀌거나 합쳐진 개념의 처리는 [시스템 아키텍처 설계](/docs/design/system-architecture.md)의 시작 순서(콘텐츠 팩 별칭)를 따르며, 릴리스 노트(`CHANGELOG.md`)에 영향이 적힙니다.
- `PROGINONE_CONTENT_DB`로 콘텐츠 팩 위치를 고정했다면 새 번들의 `content/dist/content.db`로 바꿔 줘야 합니다. 앱과 콘텐츠 팩의 스키마 버전이 맞지 않으면 앱이 시작하지 않고 알려 줍니다.

여러 버전을 건너뛰어도 됩니다. 마이그레이션은 순서대로 모두 적용됩니다.

## 되돌리기 (롤백)

이전 버전의 앱은 더 새로운 버전이 바꾼 `user.db`를 열지 않습니다("이 데이터는 더 새로운 버전의 ProgInOne이 만든 것입니다"). 다운그레이드는 지원하지 않으므로, 업그레이드 직전 백업으로 데이터를 되돌린 뒤 이전 버전을 실행합니다.
업그레이드 뒤에 쌓인 학습 기록은 사라집니다.

1.  새 버전 앱을 `Ctrl+C`로 끕니다.
1.  되돌릴 백업을 고릅니다. 업그레이드 전에 직접 만든 백업(`backups/manual/`) 또는 업그레이드 때 자동으로 만든 가장 최근의 `backups/pre-migration/` 백업입니다. 마이그레이션이 없던 업그레이드라면 `pre-migration` 백업이 없으므로 이 단계 없이 이전 버전을 실행하면 됩니다.
1.  현재 데이터를 옮겨 둡니다(지우지 않습니다).

    ```shell
    cd ~/Library/Application\ Support/ProgInOne
    mkdir -p rollback-saved
    mv user.db user.db-wal user.db-shm rollback-saved/ 2>/dev/null
    ```

1.  고른 백업을 `user.db`로 복사합니다.

    ```shell
    cp "backups/pre-migration/<파일 이름>_user.db" user.db
    ```

1.  이전 버전 폴더에서 `pnpm start`를 실행합니다. 이전 버전 폴더를 지웠다면 그 버전의 번들을 다시 받아 설치합니다.

앱이 시작되는 상태라면 위 방법 대신 **설정 > 데이터**에서 백업을 골라 복원할 수도 있습니다. 다만 그 화면은 실행 중인 앱보다 새로운 버전의 백업을 막고, 이전 버전 백업을 복원하면 실행 중인 앱의 구조로 다시 마이그레이션합니다. 그래서 다운그레이드에는 위의 수동 절차를 씁니다.

## 제거

1.  앱을 끕니다.
1.  앱 폴더를 지웁니다: `rm -rf ~/Applications/ProgInOne/proginone-<버전>`.
1.  학습 기록까지 지우려면 데이터 위치를 지웁니다. **되돌릴 수 없습니다.** 필요하면 먼저 백업 폴더를 다른 곳에 복사합니다.

    ```shell
    rm -rf ~/Library/Application\ Support/ProgInOne
    ```

    백업 위치를 바꿨다면 그 폴더도 따로 지웁니다.

1.  Codex CLI의 ChatGPT 로그인은 ProgInOne과 별개입니다. 필요하면 `codex logout`으로 로그아웃합니다.

## 문제 해결

| 증상 | 해결 |
|---|---|
| `shasum -c`가 `FAILED` | 다시 내려받습니다. 계속 실패하면 이슈로 남깁니다 |
| `pnpm: command not found` | `corepack enable` 후 새 터미널을 엽니다 |
| `Unsupported engine` 또는 문법 오류로 서버가 시작하지 않음 | Node.js 24 이상인지 확인합니다(`node --version`) |
| "포트 4310을(를) 이미 다른 프로그램이 쓰고 있습니다" | `PROGINONE_PORT=4311 pnpm start`처럼 다른 포트를 씁니다 |
| "웹 앱이 빌드되지 않았습니다" | 릴리스 번들이 아니라 소스 저장소에서 실행했습니다. `pnpm build`를 먼저 실행하거나 릴리스 번들을 씁니다 |
| "더 새로운 버전의 ProgInOne이 만든 것입니다" | 데이터를 만든 앱보다 오래된 앱을 실행했습니다. 새 버전을 설치하거나 [되돌리기](#되돌리기-롤백)를 따릅니다 |
| "데이터베이스 업데이트에 실패해 이전 상태로 복구했습니다" | 학습 기록은 업데이트 전 상태입니다. 이전 버전으로 계속 쓰고, 출력된 오류를 이슈로 남깁니다 |

더 많은 증상과 진단 방법은 [디버깅 가이드](/docs/guides/debugging.md)에 있습니다.

## 관련 문서

- [시작하기](/docs/guides/getting-started.md): 소스에서 실행, 설정 환경 변수
- [릴리스 절차](/docs/guides/release.md): 릴리스를 만드는 쪽의 절차
- [시스템 아키텍처 설계 > 설치와 업그레이드](/docs/design/system-architecture.md#설치와-업그레이드)
- [데이터 모델 설계](/docs/design/data-model.md): 마이그레이션과 자동 백업
