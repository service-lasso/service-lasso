# #1541 durable CLI evidence plan

Development-mode delivery for GitHub issue #1541 is bound to SPEC-006 AC-6F.1.

The branch is based on `origin/develop` `374765210ccb71fe0f7747ba68749bbe48d7d99d`.
The only Core contract input is frozen reviewed PR #1472 head
`cf0b1b8eb24120479f86b8e6f9bc8e219c7396f3`; it is not a published or
qualified runtime claim.

Required evidence:

- fixture transport tests for capability, confirmation, idempotency, context
  conflict, status exits, bounded wait, cancellation availability, authorization,
  and redaction;
- source-built CLI exercise against an isolated frozen-Core checkout when its
  guarded HTTP contract can be started safely;
- a PR into `develop` that states the remaining Core merge, exact-head CI,
  packaged-runtime, and distribution dependencies.

Non-goals: source admission, local project authoring, registration, update or
remove mutation, inbox mutation, release publication, deployment, and GA.
