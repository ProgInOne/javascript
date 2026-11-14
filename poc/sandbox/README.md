# M1-B 샌드박스 PoC

[코드 실행 샌드박스 설계](/docs/design/code-execution-sandbox.md)와 결정 D-018(러너 셸 방식)을 실제 브라우저에서 검증하는 일회성 PoC입니다.
제품 코드가 아니며, 결과는 설계 문서의 "M1-B PoC 결과 (2026-11-14)" 절에 반영했습니다.

## 구성

| 파일 | 역할 |
|---|---|
| `server.mjs` | `node:http` 서버(127.0.0.1). 앱 페이지(앱 CSP), `/sandbox/runner.html`(셸 CSP 헤더), 토큰·Origin 검사 `/api/secret`, 모든 요청 기록. 다른 포트에 "외부 호스트" 대역 서버 |
| `public/host.js` | RunnerHost: 셸 iframe 생성, `shell-hello` 검증(`event.source` + `origin === 'null'`), `MessageChannel` 연결, 하트비트 Watchdog, 앱 메인 스레드 응답성 측정(rAF 간격, 타이머 지연) |
| `public/prepare.js` | Prepare 단계(PoC는 앱 스레드에서 실행): acorn 반복문 계측(줄 보존), 노출 스크립트, DOM 모드 HTML 재작성 |
| `src/shell.js` | 러너 셸: `blob:` Worker(`js-console`), 중첩 `srcdoc` iframe(`dom`), 하네스 전용 포트, 시간 제한 |
| `src/harness.js` | 하네스(Worker·중첩 문서 공용, 한 줄로 주입): 콘솔 캡처·직렬화, `__pg` 반복문 가드, 타이머 추적, 관측 단계 실행 |
| `tests/sandbox.spec.mjs` | Playwright 테스트(S1~S44 중 대부분, 미결 사항 Q1~Q9) |
| `tools/report.mjs` | JSON 리포트 → `results/results.md`(테스트 × 브라우저 표), `results/evidence.json`(근거) |
| `tools/q4.mjs` | 프로세스 분리 수동 실험 스크립트(브라우저·실행 옵션 변형) |

## 실행

```shell
cd poc/sandbox
npm install
npx playwright install chromium firefox webkit

# 전체 (메모리 폭주 제외), 결과 표 생성
PG_JSON=results/main.raw.json npx playwright test --grep-invert "memory bomb"
# 메모리 폭주(S32, S33)는 따로. 브라우저 메모리를 수 GB까지 씁니다.
PG_JSON=results/memory.raw.json npx playwright test -g "memory bomb" --project=chromium --project=chrome --project=firefox --project=webkit
node tools/report.mjs results/main.raw.json results/memory.raw.json

# 셸을 셸마다 다른 사이트(s{n}.localhost)에 두는 변형(설계 권고안)으로 같은 스위트 실행
PG_SHELL_ORIGIN='http://s{n}.localhost:4331' PG_JSON=results/subdomain.raw.json npx playwright test --grep-invert "memory bomb|Q4" --project=chromium --project=firefox --project=webkit
PG_SHELL_ORIGIN='http://s{n}.localhost:4331' PG_JSON=results/memory-subdomain.raw.json npx playwright test -g "memory bomb" --project=chromium --project=chrome --project=firefox
PG_OUT=results-subdomain node tools/report.mjs results/subdomain.raw.json results/memory-subdomain.raw.json

# 수동 확인: 서버를 띄우고 브라우저에서 http://127.0.0.1:4311/ 를 연 뒤 콘솔에서 pg.run({...})
node server.mjs
```

브라우저 프로젝트:

| 프로젝트 | 실체 | 비고 |
|---|---|---|
| `chromium` | Playwright Chromium 141, `channel: 'chromium'`(new headless) | 기본 headless shell은 sandboxed iframe을 별도 프로세스로 분리하지 않아 실제 Chrome과 다릅니다(Q4) |
| `chrome` | 설치된 Google Chrome 157 stable | |
| `firefox` | Playwright Firefox 142, `fission.autostart=true` | Playwright Firefox는 기본으로 Fission이 꺼져 있어 출시판과 맞추기 위해 켬 |
| `webkit` | Playwright WebKit 26 | 실제 Safari와 다를 수 있음. Safari 자동화는 이번 범위 밖 |

## 결과

| 실행 | 결과 표 | 근거 |
|---|---|---|
| 같은 사이트 셸(`/sandbox/runner.html`), 4개 브라우저 프로젝트 | [`results/results.md`](results/results.md): 252개 중 251 통과, 1개 시간 초과(Chrome S33: Watchdog 뒤 같은 사이트 새 셸이 응답하지 않음. 아래 3번) | [`results/results.evidence.json`](results/results.evidence.json) |
| 셸별 하위 도메인(`s{n}.localhost`), Chromium·Firefox·WebKit(+ 메모리는 Chrome) | [`results/results-subdomain.md`](results/results-subdomain.md): 180개 모두 통과 | [`results/results-subdomain.evidence.json`](results/results-subdomain.evidence.json) |

근거 파일에는 테스트별 콘솔 출력, CSP 위반 이벤트, 서버 요청 로그(`leaks`), 앱 메인 스레드 측정값이 들어 있습니다.
"기록" 테스트(Q4/Q5, S32/S33, S42, `unmitigated`)는 브라우저 동작을 기록하는 용도라 단정하지 않고 통과하며, 판단은 근거 값으로 합니다.

## 요약

측정 환경: macOS, Playwright 1.56.1(Chromium 141, Firefox 142, WebKit 26), Google Chrome 157. 2026-11-14.

**확인된 것 (모든 브라우저)**

- 네트워크 차단: `fetch`·XHR·WebSocket·EventSource·`sendBeacon`·이미지·CSS `url()`·`@font-face`·`<link>`·`<script src>`·`<iframe>`·`<object>`·prefetch·`import()`·`importScripts`·폼 전송·`location`·`<meta refresh>`·`<base>`로 앱 서버와 "외부" 서버에 보낸 요청이 서버 로그 0건(아래 Firefox 예외 제외).
- 앱 격리: `parent`/`top`의 `document`·쿠키·`localStorage` 접근은 `SecurityError`, 최상위 탐색·팝업·다운로드 없음, 클립보드·전체 화면·서비스 워커 거부, `eval`/`new Function`은 `EvalError`, 문자열 타이머는 실행되지 않음.
- `allow-forms` + `form-action 'none'`: `submit` 이벤트는 발생하고 전송은 차단(Q3).
- `frame-src 'none'` 아래에서도 중첩 `srcdoc` iframe은 생성됨(Q2).
- opaque origin 셸의 `blob:` Worker와 Worker 안 `blob:` `importScripts` 동작, 스택에서 파일·줄 복원(Q1).
- 반복문 계측: `while`/`for`/`do`/`for-of`(무한 생성기)/레이블/본문 없는 반복/`async`/타이머 콜백/`onclick` 속성 모두 `loop_limit`, 줄 번호 정확. 메모리 폭주(S32/S33)도 계측이 1초에 멈춤.
- 하네스 무결성: `Array.prototype.push`·`JSON.stringify`·`Object.keys`·`MessagePort.prototype.postMessage` 변조, `__pg` 덮어쓰기에도 관측값 정확. `postMessage` 위조는 셸·앱 모두 무시.
- 콘솔 상한 1,000개 + 버린 개수 집계, 대용량 문자열 절단, 미처리 거부, `setInterval` 잔존 집계, 큰 요청 거부.

**발견한 문제와 PoC에서 검증한 대응**

| # | 발견 | 브라우저 | 대응(검증됨) |
|---|---|---|---|
| 1 | Worker 안 `EventSource`가 상속된 `connect-src 'none'`을 무시하고 요청을 보냄(`Origin: null`). 서버는 토큰·Origin 검사로 거부 | Firefox | 하네스가 Worker 전역에서 `EventSource`·`Worker`·`SharedWorker` 제거(S5-w, S5-w-nested), DOM 문서에 `<meta>` `worker-src 'none'` 주입(S5-dom-worker) |
| 2 | 같은 사이트 셸이면 계측 없는 무한 루프가 앱 탭을 영구히 멈춤(Watchdog도 멈춤) | Firefox(Fission), WebKit | 셸을 셸마다 다른 사이트(`<id>.localhost`)에서 로드 → Firefox는 앱 응답 유지·복구. WebKit은 사이트와 무관하게 멈춤(대응 불가, 계측이 유일한 방어) |
| 3 | Watchdog이 셸을 버린 뒤 같은 사이트로 만든 새 셸이 아직 돌고 있는 이전 프로세스에 배치되어 8초 넘게 응답 없음. 이전 프로세스는 같은 사이트 셸이 남아 있으면 30초 넘게 회수되지 않음 | Chromium, Chrome | 셸별 하위 도메인 → 다음 실행 55~70ms에 정상, 이전 프로세스는 3.5~11.5초 뒤 회수 |
| 4 | opaque origin 문서의 인라인 스크립트 오류가 `"Script error."`(줄 0, `error` 없음) | WebKit | 인라인 스크립트를 문서 안에서 만든 `blob:` 스크립트로 `document.write`해 같은 위치에 실행(blob 전달). 순서·`DOMContentLoaded`·전역 공유 유지, 오류 위치 스크립트 기준(B6) |
| 5 | 화면 밖(`left:-10000px`) 셸에서 중첩 문서 `setTimeout`이 3초 넘게 멈춤 | WebKit | 채점 셸을 뷰포트 안 `opacity:0`으로 배치(Q6) |
| 6 | 정상 계측이어도 루프 예산(1초) 동안 앱 화면이 멈춤 | Firefox 같은 사이트, WebKit | Firefox는 2번 대응으로 해소. WebKit은 잔여 |
| 7 | 문자열 절단 기준(10,000자)이 항목 상한(10KB)보다 커서 큰 문자열 항목이 통째로 버려짐 | 공통(설계 불일치) | 문자열 8,000자로 절단(S35) |
| 8 | Playwright 기본 headless shell은 sandbox iframe을 분리하지 않아 실제 Chrome과 결과가 다름. Playwright Firefox는 Fission 꺼짐 | 테스트 환경 | CI는 `channel: 'chromium'`, Firefox는 `fission.autostart` 켬 |

**확인하지 못한 것**

- 실제 Safari(자동화 미설정)와 실제 Firefox 출시판. Playwright 빌드로 대신했고, Firefox는 출시판 기본값(Fission)에 맞췄습니다.
- 실제 Safari의 `*.localhost` 해석. 설계에 같은 사이트 경로로의 대체를 넣었습니다.
- Vite 개발 서버에서 경로별 CSP 헤더(Q10). 브라우저 동작이 아니므로 M3에서 확인합니다.
- 끝나지 않는 마이크로태스크 체인, 계측 밖의 긴 내장 함수 호출. 계측 없는 무한 루프(Q4)와 같은 경로로 처리되며 별도 측정은 하지 않았습니다.
