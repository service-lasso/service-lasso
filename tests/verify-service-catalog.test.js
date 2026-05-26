import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarkdownBulletIds,
  parseReadmeBaselineTable,
} from '../scripts/verify-service-catalog.mjs';

test('parseReadmeBaselineTable extracts service ids and release tags deterministically', () => {
  const parsed = parseReadmeBaselineTable(`
# Heading

## Baseline Services

| Service | Role | Source |
| --- | --- | --- |
| \`@node\` | runtime provider | acquired from [\`service-lasso/lasso-node\`](https://github.com/service-lasso/lasso-node) release \`2026.4.27-eca215a\` |
| \`echo-service\` | harness | acquired from [\`service-lasso/lasso-echoservice\`](https://github.com/service-lasso/lasso-echoservice) release \`2026.5.3-6d3dc19\` |

## Next Section
`);

  assert.deepEqual(parsed, [
    { serviceId: '@node', releaseTag: '2026.4.27-eca215a' },
    { serviceId: 'echo-service', releaseTag: '2026.5.3-6d3dc19' },
  ]);
});

test('parseMarkdownBulletIds extracts the baseline list after a marker', () => {
  const parsed = parseMarkdownBulletIds(`
Default baseline services currently are:

- \`@archive\`
- \`@java\`
- \`@node\`

Next paragraph.
`, 'Default baseline services currently are:');

  assert.deepEqual(parsed, ['@archive', '@java', '@node']);
});
