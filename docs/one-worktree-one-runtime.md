---
title: One worktree, one runtime
---

# One worktree, one runtime

Two agents should be able to test two branches without sharing mutable service
state or guessing which localhost listener belongs to which checkout. The useful
unit is a worktree with its own service inventory, workspace, runtime generation
and resolved endpoints. This also makes a developer-to-validator handoff explicit.

This guide uses the source repository's existing demo proof helper. It is not an
installed npm CLI subcommand. For an application-owned inventory, adapt the
contracts below through the [runtime integration guide](runtime/README.md).

## Prepare an isolated proof lane

Start in a clean issue worktree created from current `develop`, following the
repository's [contribution workflow](contributing/README.md). You need Node.js 22+,
npm, Git and network access to acquire the demo's released service artifacts.
Use a distinct proof id for each independent run. The examples assume no
`SERVICE_LASSO_*` environment overrides redirect the roots to a shared workspace;
check the reported paths before starting.

From that worktree:

```powershell
npm ci
npm run demo:worktree-proof -- --id=issue-1861
```

The npm script builds Core, then **prepares** the lane. It copies the demo service
inventory, chooses available ports, patches the copied manifests and writes:

```text
workspace/demo-instance/worktree-proof/issue-1861/services/
workspace/demo-instance/worktree-proof/issue-1861/workspace/
.demo-logs/worktree-proof/issue-1861/worktree-proof-summary.json
```

Preparation does not start the runtime. The summary records the checkout, branch,
commit, roots, proposed URLs and exact commands for the lane. In PowerShell,
inspect it with:

```powershell
$proof = Get-Content .demo-logs/worktree-proof/issue-1861/worktree-proof-summary.json -Raw | ConvertFrom-Json
$proof.paths
$proof.urls
$proof.commands
```

Copy and run `commands.start` from that summary in a terminal in the same
worktree. Complete [first-run setup](complete-first-run-setup.md) for the new
workspace if prompted. Then run its `commands.gate` and `commands.verify`.
The gate can recover/start the lane; it is not a read-only health probe.
On npm/PowerShell combinations with argument-forwarding differences, see
[demo operations](demo/README.md) rather than guessing new flags.

## Verify identity before testing

Use the lane's roots to inspect its registry without starting another runtime:

```powershell
node dist/cli.js instance --services-root ./workspace/demo-instance/worktree-proof/issue-1861/services --workspace-root ./workspace/demo-instance/worktree-proof/issue-1861/workspace --json
```

The [instance registry](reference/runtime-instance-registry.md) defines stable
instance identity, per-start generation identity and selection failures such as
`wrong_lane`, `ambiguous` and `unknown_owner`. Record the selected generation with
your evidence; `instance` also accepts `--generation <id>` to require that exact
generation. A healthy endpoint from a different lane is not a successful test.

For a running lane, these reads expose identity and resolved allocation:

```text
GET /api/runtime/instance
GET /api/runtime/endpoints/allocation
GET /api/services
```

The summary is a launch/handoff record. Runtime endpoint state is authoritative
after startup: allocation can renegotiate preferred ports. Read the actual
allocation and service endpoints before pointing tests or a browser at them; do
not hardcode the canonical demo's `17883`/`17700` ports or apply a port offset.
[Startup endpoint allocation](reference/startup-endpoint-allocation.md) defines
automatic, preferred and fixed policies, host-wide coordination and conflict
handling. Fixed endpoints fail on conflict. Free-port preparation is not a
permanent reservation against unrelated processes.

Run the app's normal tests against this lane's resolved service URLs and disposable
data. Keep the branch/commit, roots, selected generation, allocation and check
results together. When the verifier reports stale ownership, wrong-lane state or
a listener conflict, retain the failure and follow [demo diagnostics](demo/README.md).
Do not redirect verification to another healthy demo to obtain a pass.

## Connect an agent to that lane

The [Operator MCP contract](reference/operator-mcp.md) defines Streamable HTTP at
`POST /api/mcp`, discovery at `GET /api/mcp/info`, and the opt-in stdio adapter.
Connect to the selected runtime. Existing reads include
`service_lasso_runtime_status`, `service_lasso_get_health` and
`service_lasso_list_routes`. Read-only is the default; lifecycle mutations need
explicit guarded mode, appropriate authority and the server confirmation flow.
Use that canonical contract for configuration and schemas. MCP is not a generic
shell or a worktree-creation API.

## Clean up the runtime you own

When proof is finished, run the exact `commands.cleanup` saved in the summary.
For the default paths above it is:

```powershell
node scripts/demo-worktree-proof.mjs --cleanup --summary=.demo-logs/worktree-proof/issue-1861/worktree-proof-summary.json
```

Cleanup stops verified owned processes, waits for the runtime's durable shutdown
state and resets the copied service/workspace state. It records
`worktree-proof-cleanup.json` beside the summary. Inspect the result before
retiring the worktree. `--preserve-state` is available when running cleanup to stop
the lane while retaining state for diagnosis. Preserve needed evidence first;
default cleanup is intended for disposable proof state. It does not delete the
Git worktree or prove that arbitrary external systems were cleaned up.

An application harness can instead stop its lane with `service-lasso stop` using
the same explicit service/workspace roots; see the [CLI contract](runtime/README.md).
The [process ownership registry](reference/process-ownership-registry.md) governs
termination authority. A PID, port or unexpired instance lease alone is insufficient.

Separate database directories and endpoints only help if the service configuration
uses them. External databases, shared files, fixed paths and remote accounts still
need explicit test isolation. Same-account processes remain within one OS trust
boundary; see [service environment isolation](security/service-environment-isolation.md).
This workflow establishes no agent-count or resource-capacity guarantee.

[Why Service Lasso](why-service-lasso.md) explains the app-builder use case.
[Containers or process managers?](service-lasso-containers-process-managers.md)
compares other ways to organize the same work.
