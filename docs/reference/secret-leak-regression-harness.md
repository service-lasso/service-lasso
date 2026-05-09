# Secret leak regression harness

Service Lasso test suites should use deterministic fake sentinels plus common credential-shape detection whenever a feature can render, log, export, persist, screenshot, or report secret-adjacent data.

The reusable harness lives in `src/testing/secretLeakHarness.ts` and is exported from the package wrapper for downstream tests.

## What to scan

Add covered surfaces as plain strings or nested objects:

- route paths and query strings
- page titles, breadcrumbs, and rendered text
- console/server logs and diagnostics
- support bundles, reports, exports, and snapshots
- local/session storage dumps
- workflow YAML, run logs, and artifacts
- screenshot/failure-artifact text extraction when available

## Sentinel policy

Use only deterministic fake material. The default sentinels are clearly fake Service Lasso values and must not resemble live credentials. The harness also detects common credential shapes such as bearer tokens, basic-auth URLs, GitHub tokens, AWS access keys, and private-key blocks.

Raw sentinel values may appear only inside deliberately contained test inputs. Any generated output containing them must be scrub-verified by `assertNoSecretMaterial` or equivalent before it becomes a durable artifact.

## Example

```ts
import { assertNoSecretMaterial } from "@service-lasso/service-lasso";

await assertNoSecretMaterial({
  route: "/secrets-broker",
  title: document.title,
  text: document.body.textContent ?? "",
  localStorage: { ...localStorage },
});
```

Metadata-only broker surfaces are allowed:

```json
{
  "ref": "api.DB_PASSWORD",
  "status": "policy-denied",
  "required": true,
  "valuePresent": true,
  "fingerprint": "0123456789abcdef"
}
```

Do not allow raw values, raw tokens, cookies, private keys, provider credentials, or unredacted secret material in comments, logs, PR bodies, docs, support bundles, or test artifacts.
