# Sandbox PoC results

Generated 2026-11-13T17:40:10.366Z by tools/report.mjs from results/main.raw.json, results/memory.raw.json.
Recorded (observe-only) tests pass unless the harness itself broke; read their evidence in results/evidence.json.

| Test | chromium | chrome | firefox | webkit |
|---|---|---|---|---|
| basics › B1 js-console: console capture and serialization | ✅ | ✅ | ✅ | ✅ |
| basics › B2 callFunction / readGlobal via expose (let/const, TDZ, missing) | ✅ | ✅ | ✅ | ✅ |
| basics › B3 dom: computedStyle, boxRect and media query across viewports | ✅ | ✅ | ✅ | ✅ |
| basics › B4 dom: click handler and submit event (Q3: allow-forms + form-action none) | ✅ | ✅ | ✅ | ✅ |
| basics › B5/Q7 error positions: worker stack mapping, DOM ErrorEvent.lineno with/without sourceURL | ✅ | ✅ | ✅ | ✅ |
| basics › B6 dom scriptDelivery=blob: errors not muted, script-relative lines, globals shared, order kept | ✅ | ✅ | ✅ | ✅ |
| basics › Q6 timers/layout in an off-screen shell vs visible shell | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S1 dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S1-ext dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S1-token dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S2 dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S3 dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S4 dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S5 dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S6 dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S7 dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S25 dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S5-dom-worker dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S11 dom | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S8 dom-html | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S9 dom-html | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S9-ext dom-html | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S10 dom-html | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S12 dom-html | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S44 dom-html | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S-font dom-html | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S-script-src dom-html | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S-object dom-html | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S-prefetch dom-html | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S1-w js-console | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S1-w-ext js-console | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S3-w js-console | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S4-w js-console | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S5-w js-console | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S25-w js-console | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S25-w-import js-console | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S5-w-nested js-console | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S-w-nested-worker js-console | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S5-dom-worker-unmitigated (recorded): learner blob Worker EventSource without the worker-src meta | ✅ | ✅ | ✅ | ✅ |
| network is blocked › S13/Q3 form POST to app API: submit handler runs, request not sent | ✅ | ✅ | ✅ | ✅ |
| app isolation › S14/S15 parent & top document, cookie, localStorage | ✅ | ✅ | ✅ | ✅ |
| app isolation › S16/Q8 localStorage shim and cookie behavior in opaque origin | ✅ | ✅ | ✅ | ✅ |
| app isolation › S17 top navigation blocked | ✅ | ✅ | ✅ | ✅ |
| app isolation › S18 window.open / S19 download | ✅ | ✅ | ✅ | ✅ |
| app isolation › S20 alert/confirm/prompt do not block (both modes) | ✅ | ✅ | ✅ | ✅ |
| app isolation › S21 clipboard / S22 fullscreen & pointer lock / S23 service worker (Q9) | ✅ | ✅ | ✅ | ✅ |
| app isolation › S24 eval / new Function / string timers blocked (both modes) | ✅ | ✅ | ✅ | ✅ |
| app isolation › S36 postMessage spoofing to shell and app is ignored | ✅ | ✅ | ✅ | ✅ |
| loops and limits › S26 js-console while(true): loop guard, and terminate() without instrumentation | ✅ | ✅ | ✅ | ✅ |
| loops and limits › S27 dom while(true) on line 3: loop_limit with line, UI responsive | ✅ | ✅ | ✅ | ✅ |
| loops and limits › S28/S29/S30 loops in timers, inline handlers, do-while, generators, labels | ✅ | ✅ | ✅ | ✅ |
| loops and limits › S31 infinite recursion → RangeError (both modes) | ✅ | ✅ | ✅ | ✅ |
| loops and limits › S34/S35 console flood and huge strings are capped | ✅ | ✅ | ✅ | ✅ |
| loops and limits › S37/S38/S39 harness integrity against tampering (both modes) | ✅ | ✅ | ✅ | ✅ |
| loops and limits › S40 unhandled rejection / S41 setInterval pending at end | ✅ | ✅ | ✅ | ✅ |
| loops and limits › S43 oversized RunRequest rejected by host validation | ✅ | ✅ | ✅ | ✅ |
| browser behavior (recorded) › Q4/Q5 uninstrumented DOM infinite loop (same-site shell): app freeze? recovery? | ✅ | ✅ | ✅ | ✅ |
| browser behavior (recorded) › Q4/Q5 uninstrumented DOM infinite loop (cross-site shell): app freeze? recovery? | ✅ | ✅ | ✅ | ✅ |
| browser behavior (recorded) › Q4/Q5 uninstrumented DOM infinite loop (per-shell-subdomain shell): app freeze? recovery? | ✅ | ✅ | ✅ | ✅ |
| browser behavior (recorded) › S42 learner-created Worker with infinite loop after the nested frame is removed (allowLearnerWorkers) | ✅ | ✅ | ✅ | ✅ |
| browser behavior (recorded) › S42 learner-created Worker with infinite loop after the nested frame is removed (default-meta-worker-src-none) | ✅ | ✅ | ✅ | ✅ |
| browser behavior (recorded) › S32 memory bomb in js-console mode | ✅ | ✅ | ✅ | ✅ |
| browser behavior (recorded) › S33 memory bomb in dom mode | ✅ | ⏱ | ✅ | ✅ |

## Failures

- **browser behavior (recorded) › S33 memory bomb in dom mode** [chrome]: Test timeout of 60000ms exceeded.
