# 릴리스 절차

ProgInOne 릴리스를 만들고 확인하는 방법입니다.

- 대상: 유지 관리자
- 최종 수정: 2026-11-23 (공통 패키지 동봉: D-093)
- 설치하는 쪽의 절차는 [설치와 업그레이드](/docs/guides/install-and-upgrade.md)에 있습니다.

## 버전 체계

| 대상 | 체계 | 원천 |
|---|---|---|
| 앱 | SemVer `MAJOR.MINOR.PATCH` | 루트 `package.json`의 `version`, git 태그 `v<버전>` |
| 콘텐츠 팩 | `YYYY.MM.DD.N` | `content/pack.yaml` |
| user.db 스키마 | 마이그레이션 일련번호 | `apps/server/src/db/user/migrations/` |
| content.db 스키마 | 정수 | `@proginone/content-schema/db`의 `CONTENT_DB_SCHEMA_VERSION`(ProgInOne/core) |

- 1.0 이전(`0.x`)에는 MINOR가 호환성 깨짐을 포함할 수 있습니다. 단, user.db 마이그레이션은 항상 전진 호환입니다(새 앱이 예전 데이터를 엽니다).
- 마일스톤 릴리스는 MINOR를 올립니다(M4 `0.1.0`, M5 `0.2.0`, M6 `0.3.0`, M7 `1.0.0`). 릴리스 뒤의 버그 수정만 담으면 PATCH를 올립니다.
- 앱 버전은 루트 `package.json` 하나에만 씁니다. 하위 패키지의 `version`(`0.0.0`)은 바꾸지 않습니다. 서버는 루트 `package.json`의 버전을 백업 메타와 `/api/v1/health`에 씁니다.

## 출시 후보

마일스톤의 완료 조건에 사람이 해야 하는 점검(실제 사용 점검, 수동 접근성·호환성 점검)이 남아 있으면 정식 버전 전에 출시 후보를 냅니다([D-075](/docs/decisions.md)).

- 버전은 SemVer 사전 릴리스 `<버전>-rc.<N>`입니다(예: `1.0.0-rc.1`). 태그는 `v1.0.0-rc.1`, CHANGELOG 섹션은 `## [1.0.0-rc.1] - <YYYY-MM-DD>`입니다.
- 릴리스 워크플로는 버전에 `-`가 있으면 GitHub Release를 사전 릴리스로 만듭니다(`--prerelease`). 로컬 대체 절차에서도 `gh release create`에 `--prerelease`를 붙입니다.
- 정식 버전을 낼 때는 출시 후보 섹션들을 그대로 두고, 그 뒤의 변경만 새 섹션 `## [<버전>]`에 적습니다. 첫 문단에 어느 출시 후보를 거쳤는지와 사람 점검의 결과를 씁니다.

## 릴리스 전 확인

1.  `develop`의 최신 커밋에서 CI가 두 작업(`check`, `e2e`) 모두 통과했는지 확인합니다.
1.  콘텐츠 실행 검증과 성능·호환성 점검을 실행합니다. 마일스톤 릴리스에서는 결과를 `docs/reviews/`에 남깁니다.

    ```shell
    pnpm content:check:run --frozen   # 모든 문제를 실제 러너로 검증
    pnpm perf                         # NFR-01~03 측정(목표 미달이면 실패)
    ```

1.  시각 회귀 기준 이미지가 최신인지 확인합니다. 화면을 바꾼 PR이 기준 이미지를 갱신하지 않았다면 먼저 갱신합니다([테스트 가이드](/docs/guides/testing.md)).

## 릴리스 PR

릴리스는 PR 두 개로 합니다([D-090](/docs/decisions.md)). 먼저 버전과 변경 이력만 바꾸는 PR을 `develop`에 병합하고, 그다음 `develop`을 `main`으로 병합합니다.

### 버전 PR

`develop`에서 브랜치 `chore/release-v<버전>`을 만듭니다.

1.  루트 `package.json`의 `version`을 올립니다.
1.  `CHANGELOG.md`의 `## [Unreleased]` 아래 항목을 새 섹션 `## [<버전>] - <YYYY-MM-DD>`로 옮기고, `[Unreleased]`는 비워 둡니다.
    - 섹션 첫 문단에 릴리스 요약(마일스톤, 핵심 기능, 알려진 제약)을 씁니다.
    - 하위 제목은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)의 `Added`, `Changed`, `Fixed`, `Removed`, `Security`를 씁니다.
    - 릴리스 워크플로가 이 섹션을 그대로 릴리스 노트로 씁니다. 제목 줄은 정확히 `## [<버전>]`으로 시작해야 합니다.
1.  `docs/roadmap.md`에 마일스톤 진행 상태를 갱신합니다.
1.  커밋 메시지는 `chore(release): v<버전>`입니다.
1.  CI가 통과하면 `develop`에 스쿼시 병합합니다.

### develop → main PR

```shell
gh pr create --base main --head develop --title "release: v<버전>" --body "<CHANGELOG 섹션 요약>"
```

- CI가 통과하면 **merge commit**으로 병합합니다(`gh pr merge --merge`). `main`은 merge commit만 허용합니다.
- `develop`은 기본 브랜치라 병합 뒤에도 지워지지 않습니다.

## 태그와 릴리스 워크플로

`main`의 merge commit에 태그를 붙여 푸시합니다.

```shell
git fetch origin && git checkout main && git pull --ff-only
git tag -a v0.4.0 -m "v0.4.0"
git push origin v0.4.0
```

`v*` 태그 푸시가 릴리스 워크플로(`.github/workflows/release.yml`)를 실행합니다.

| 단계 | 하는 일 |
|---|---|
| 체크아웃, pnpm·Node 준비 | `.nvmrc`의 Node, `packageManager`의 pnpm |
| `pnpm install --frozen-lockfile` | 빌드에 필요한 개발 의존성 포함 설치. `@proginone/*`는 GitHub Packages에서 `GITHUB_TOKEN`(`packages: read`)으로 받음 |
| Build app and content | `pnpm build`(웹 앱 `apps/web/dist`), `pnpm content:build`(승인된 문제만 담은 `content/dist/content.db`) |
| Bundle | `tools/release-bundle.sh <버전>`: 태그 커밋의 추적 파일(`git archive`)을 임시 폴더의 `proginone-<버전>/`에 풀고 빌드 결과물 두 가지와 [공통 패키지](#공통-패키지-동봉)를 넣은 뒤 `proginone-<버전>.tar.gz`와 `.sha256`을 만듦 |
| Release notes from CHANGELOG | `CHANGELOG.md`의 `## [<버전>]` 섹션을 `notes.md`로 추출. 비어 있으면 실패 |
| Publish | `gh release create`로 GitHub Release `ProgInOne <버전>`을 만들고 두 파일을 올림 |

### 공통 패키지 동봉

학습자가 GitHub 토큰 없이 설치할 수 있도록, 레지스트리에서 받는 `@proginone/*` 패키지를 묶음 안에 넣습니다([D-093](/docs/decisions.md)).
GitHub Packages는 공개 패키지도 토큰이 있어야 내려받을 수 있기 때문입니다.

- `tools/vendor-proginone.mjs`가 설치된 체크아웃에서 `pnpm ls`로 정확한 버전을 읽고, 패키지마다 `npm pack`으로 받아 묶음의 `vendor/`에 둡니다.
- 묶음의 `pnpm-workspace.yaml`에 `overrides`(`'@proginone/<이름>': file:vendor/<파일>.tgz`)를 더하고, `pnpm install --lockfile-only`로 묶음의 `pnpm-lock.yaml`을 다시 만듭니다. 그래서 **묶음의 두 파일은 태그 커밋과 다릅니다.**
- 워크스페이스 안의 패키지(`link:`)는 건드리지 않습니다. 레지스트리에서 받는 `@proginone/*`가 없으면 아무것도 하지 않습니다.
- 사전 배포판(`next`)에 의존한 채 릴리스하지 않습니다. `main`으로 가기 전에 정식 버전으로 바꿉니다(core의 [언어 저장소에서 쓰기 > 버전 고르기][core-versions]).

[core-versions]: https://github.com/ProgInOne/core/blob/develop/docs/guides/consuming.md#버전-고르기

### 실행 환경 (GitHub 호스트 또는 self-hosted)

- 기본은 GitHub 호스트 runner(`ubuntu-latest`)입니다.
- 저장소 변수 `CI_RUNNER`가 `self-hosted`이면 릴리스 작업도 소유자 Mac의 self-hosted runner(라벨 `self-hosted`, `proginone`)에서 돕니다([D-055](/docs/decisions.md)). 묶기 스크립트는 임시 폴더에서 묶음을 조립한 뒤 압축하므로 GNU tar와 macOS bsdtar의 차이에 영향받지 않고, 체크섬은 양쪽에 있는 `shasum -a 256`으로 만듭니다.
- 현재 설정 확인: `gh variable list`. 실행 확인: `gh run list --workflow release.yml`, `gh run watch <id> --exit-status`.
- 워크플로가 실패하면 원인을 고친 뒤 태그를 지우고(`git push --delete origin v<버전>`, `git tag -d v<버전>`) 고친 커밋에 다시 태그를 붙입니다. 이미 Release가 만들어졌다면 `gh release delete v<버전>`으로 먼저 지웁니다.

## 로컬 대체 절차

Actions를 쓸 수 없을 때(v0.3.0: GitHub Actions 사용량 소진) 워크플로와 같은 절차를 로컬에서 실행해 Release를 만듭니다.
태그 커밋을 깨끗한 임시 작업 트리에서 빌드해, 작업 중인 변경이나 무시된 파일이 번들에 섞이지 않게 합니다.
`@proginone/*`를 받고 동봉하려면 사용자 설정(`~/.npmrc`)에 `read:packages` 토큰이 있어야 합니다(core의 [개발 컴퓨터의 토큰][core-token]).

[core-token]: https://github.com/ProgInOne/core/blob/develop/docs/guides/consuming.md#개발-컴퓨터의-토큰

```shell
version=0.3.0
name="proginone-${version}"
work="$(mktemp -d)"
git worktree add "$work/src" "v${version}"
cd "$work/src"

pnpm install --frozen-lockfile
pnpm build
pnpm content:build
tools/release-bundle.sh "$version" "$work"

awk -v v="$version" '
  $0 ~ "^## \\[" v "\\]" { on = 1; next }
  on && /^## \[/ { exit }
  on { print }
' CHANGELOG.md > "$work/notes.md"
test -s "$work/notes.md"
```

- 릴리스 노트 맨 앞에 로컬에서 만들었다는 안내를 한 줄 넣습니다(v0.3.0 예: "이 릴리스는 GitHub Actions 사용량 소진으로 릴리스 워크플로와 같은 절차를 로컬에서 실행해 만들었습니다").
- 올리기 전에 [릴리스 산출물 확인](#릴리스-산출물-확인)을 먼저 합니다.

```shell
gh release create "v${version}" --title "ProgInOne ${version}" --notes-file "$work/notes.md" \
  "$work/${name}.tar.gz" "$work/${name}.tar.gz.sha256"
cd - && git worktree remove "$work/src"
```

## 릴리스 산출물 확인

Release에 올라간 파일로 실제 설치를 해 봅니다. 임시 폴더와 임시 데이터 위치를 써서 실제 학습 데이터에 닿지 않게 합니다.

1.  내려받고 체크섬을 확인합니다.

    ```shell
    dir="$(mktemp -d)" && cd "$dir"
    gh release download v0.3.0 -R ProgInOne/javascript
    shasum -a 256 -c proginone-0.3.0.tar.gz.sha256
    ```

1.  번들 내용을 확인합니다. 빌드 결과물 두 가지와, 레지스트리 `@proginone/*`에 의존한다면 `vendor/`의 패키지 파일이 있어야 합니다.

    ```shell
    tar -tzf proginone-0.3.0.tar.gz | grep -E 'apps/web/dist/index.html|content/dist/content.db|/vendor/.+\.tgz'
    ```

1.  설치하고 임시 데이터 위치로 시작합니다.

    ```shell
    tar -xzf proginone-0.3.0.tar.gz && cd proginone-0.3.0
    pnpm install --prod --frozen-lockfile
    PROGINONE_DATA_DIR="$dir/data" PROGINONE_PORT=4661 PROGINONE_OPEN_BROWSER=false pnpm start
    ```

1.  저장소의 작업 트리에서 스모크 테스트를 실행합니다(다른 터미널). 토큰 검사, 과정 → 레슨, 실제 샌드박스 실행과 채점, 백업 목록을 확인합니다. `--project=chrome`(설치된 Google Chrome, 보장 브라우저), `--project=firefox`, `--project=webkit`으로 다른 브라우저도 확인합니다. 프로젝트를 고르지 않으면 네 브라우저 모두 실행합니다.

    ```shell
    SMOKE_URL=http://127.0.0.1:4661 pnpm --filter @proginone/e2e smoke --project=chromium
    ```

1.  `Ctrl+C`로 서버를 끄고 임시 폴더를 지웁니다.

## 관련 문서

- [설치와 업그레이드](/docs/guides/install-and-upgrade.md)
- [테스트 가이드](/docs/guides/testing.md): CI 실행 환경, 시각 회귀 기준 이미지
- [시스템 아키텍처 설계 > 버전 관리와 릴리스](/docs/design/system-architecture.md#버전-관리와-릴리스)
- [기여 가이드](/CONTRIBUTING.md)
