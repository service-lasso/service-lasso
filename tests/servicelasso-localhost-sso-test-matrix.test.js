import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const matrixPath = new URL("../docs/reference/servicelasso-localhost-sso-test-matrix.md", import.meta.url);

const requiredSnippets = [
  "service-lasso/service-lasso#429",
  "service-lasso/service-lasso#430",
  "service-lasso/lasso-zitadel#2",
  "service-lasso/lasso-serviceadmin#90",
  "service-lasso/lasso-traefik#13",
  "service-lasso/service-lasso#431",
  "tests/traefik-local-route-generation.test.js",
  "tests/local-sso-bootstrap.test.js",
  "tests/local-sso-loop-smoke.test.js",
  "scripts/oidc-bootstrap.test.mjs",
  "zitadel-session.test.tsx",
  "protected-serviceadmin.example.yml",
  "npm run test:local-sso-loop",
  "npm run test:local-sso",
  "npm run docs:build",
  "traefik-oidc-auth",
  "auth.servicelasso.localhost",
  "serviceadmin.servicelasso.localhost",
  "zitadel.servicelasso.localhost",
];

const forbiddenSecretPattern =
  /(?:ACTUAL_SECRET|BEGIN PRIVATE KEY|id_token\s*[:=]|access_token\s*[:=]|refresh_token\s*[:=]|client_secret\s*[:=]|session_cookie\s*[:=]|provider_credential\s*[:=]|raw_secret\s*[:=]|password\s*[:=]|Bearer\s+[A-Za-z0-9._~+/-]{24,})/i;

test("servicelasso.localhost SSO test matrix maps all implementation gates", async () => {
  const matrix = await readFile(matrixPath, "utf8");

  for (const snippet of requiredSnippets) {
    assert.match(matrix, new RegExp(escapeRegExp(snippet)), `missing matrix snippet: ${snippet}`);
  }
});

test("servicelasso.localhost SSO test matrix documents corrected auth boundary", async () => {
  const matrix = await readFile(matrixPath, "utf8");

  assert.match(matrix, /external\/plugin-owned `traefik-oidc-auth`/);
  assert.match(matrix, /Service Lasso core must not implement a custom OIDC\/session\/token auth runtime/);
  assert.match(matrix, /Legacy custom auth-facade runtime concept is blocked\/superseded/);
  assert.doesNotMatch(matrix, /Service Lasso-owned custom OIDC\/session\/token\/forward-auth runtime/);
});

test("servicelasso.localhost SSO test matrix rejects local shorthand and secret material", async () => {
  const matrix = await readFile(matrixPath, "utf8");

  assert.doesNotMatch(matrix, /servicelasso\.local(?!host)/);
  assert.doesNotMatch(matrix, forbiddenSecretPattern);
  assert.match(matrix, /Any `\.local` shorthand in this SSO path must fail a test/);
  assert.match(matrix, /Any token, cookie, client secret, provider credential, private key, raw env value, or raw secret material/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
