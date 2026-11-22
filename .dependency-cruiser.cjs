/**
 * Dependency rules from docs/design/system-architecture.md#의존-방향-규칙.
 * Rules about published @proginone/* packages (node_modules, excluded here) live in eslint.config.js.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '순환 의존은 금지합니다.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'web-not-to-server',
      severity: 'error',
      comment: '웹은 서버 코드를 직접 가져오지 않습니다(타입은 packages/shared로 공유).',
      from: { path: '^apps/web/' },
      to: { path: '^apps/server/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'packages-not-to-apps',
      severity: 'error',
      comment: '패키지는 앱에 의존하지 않습니다.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'shared-is-leaf',
      severity: 'error',
      comment: 'packages/shared는 다른 내부 패키지에 의존하지 않습니다.',
      from: { path: '^packages/shared/' },
      to: { path: '^(packages/(?!shared/)|apps/|tools/)' },
    },
    {
      name: 'runner-only-to-shared',
      severity: 'error',
      comment: 'packages/runner는 내부 패키지 중 shared에만 의존합니다(앱과 서버가 함께 씁니다).',
      from: { path: '^packages/runner/' },
      to: { path: '^(packages/(?!(runner|shared)/)|apps/|tools/)' },
    },
    {
      name: 'ai-only-to-shared',
      severity: 'error',
      comment:
        'packages/ai는 내부 패키지 중 shared에만 의존합니다. DB 조회는 서버가 구현하는 ContextSource로 주입받습니다.',
      from: { path: '^packages/ai/' },
      to: { path: '^(packages/(?!(ai|shared)/)|apps/|tools/)' },
    },
    {
      name: 'pure-packages-no-io',
      severity: 'error',
      comment:
        'exercise-kit 채점기는 I/O 없는 순수 함수입니다. learning-engine은 ProgInOne/core에서 같은 규칙을 지킵니다.',
      from: { path: '^packages/exercise-kit/' },
      to: {
        dependencyTypes: ['core'],
        path: '^(fs|node:fs|net|node:net|http|node:http|child_process|node:child_process)',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|node_modules)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
    },
  },
};
