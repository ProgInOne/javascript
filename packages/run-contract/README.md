# @proginone/run-contract

브라우저 러너(`@proginone/runner`)와 서버 채점기(`@proginone/exercise-kit`) 사이의 계약입니다.
실행 결과(`RunResult`), 관측 단계와 관측값(`ObservationStep`, `Observation`), 직렬화 값(`SerializedValue`), 실행 계획(`RunPlan`), 그리고 콘솔 표시·정답 비교에 쓰는 ProgInOne 콘솔 형식(`formatValue`, `consoleEntriesToLines`)을 담습니다.
규격의 원천은 [코드 실행 샌드박스 설계](/docs/design/code-execution-sandbox.md)입니다.

## 왜 따로 있나

처음에는 `packages/shared`에 있었습니다. shared를 언어와 무관한 공통 패키지(`@proginone/shared`, ProgInOne/core)로 옮기면서, JavaScript 러너에만 해당하는 이 계약은 이 저장소에 남겼습니다([D-090](/docs/decisions.md)).
배포하지 않는 내부 패키지이고, 의존성은 `zod`뿐입니다. runner와 exercise-kit이 둘 다 이 패키지에 의존하므로, 서버 채점기가 브라우저 러너 패키지에 의존하지 않습니다.

## 신뢰 경계

여기 정의한 값은 모두 학습자 코드가 만든 것입니다(하네스 안에서 실행됨). 서버는 채점 전에 반드시 `parseRunResult`로 검증합니다.

## 테스트

```shell
pnpm vitest run packages/run-contract
```
