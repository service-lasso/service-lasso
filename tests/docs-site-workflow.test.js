import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// SPEC-002 AC-4AJ.5: exercise the actual artifact/deployment predicates.
const workflow = readFileSync(new URL("../.github/workflows/docs-site.yml", import.meta.url), "utf8");
const predicates = [...workflow.matchAll(/^\s+if: (.+)$/gm)].map((match) => match[1]);

test("documentation publication admits only explicit canonical manual runs or release pushes", () => {
  assert.equal(predicates.length, 2);
  const scenarios = [
    ["push", "main", false, true],
    ["push", "develop", false, false],
    ["push", "fix/1612-docs-publication", true, false],
    ["pull_request", "main", true, false],
    ["pull_request", "develop", true, false],
    ["workflow_dispatch", "develop", true, true],
    ["workflow_dispatch", "main", true, true],
    ["workflow_dispatch", "develop", false, false],
    ["workflow_dispatch", "main", false, false],
    ["workflow_dispatch", "fix/1612-docs-publication", true, false],
    ["workflow_dispatch", "develop", undefined, false],
  ];
  for (const predicate of predicates) {
    const admits = new Function("github", "inputs", `return (${predicate});`);
    for (const [event, branch, publish, expected] of scenarios) {
      assert.equal(admits({ event_name: event, ref: `refs/heads/${branch}` }, { publish }), expected,
        `${event} ${branch} publish=${publish}`);
    }
  }
});

test("manual publication defaults off and deployment retains validated-build dependency", () => {
  assert.match(workflow, /publish:[\s\S]*?type: boolean\s+default: false/);
  assert.match(workflow, /deploy:[\s\S]*?needs: build/);
  assert.match(workflow, /environment:\s+name: github-pages/);
  for (const gate of ["npm run audit:tooling", "npm run docs:check-secrets-ledger", "npm run docs:build"]) {
    assert.ok(workflow.includes(gate), gate);
  }
});
