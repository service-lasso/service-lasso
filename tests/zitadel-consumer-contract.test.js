import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { compileServiceSelectorPlan } from "../dist/runtime/operator/variables.js";

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, "fixtures", "zitadel-consumer-app");
const servicesRoot = path.join(fixtureRoot, "services");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

test("ZITADEL consumer fixture declares an app-owned PostgreSQL-backed identity stack", async () => {
  const services = await discoverServices(servicesRoot);
  const byId = new Map(services.map((service) => [service.manifest.id, service.manifest]));

  assert.deepEqual([...byId.keys()].sort(), ["postgres", "zitadel"]);
  assert.equal(byId.get("postgres")?.artifact?.source?.repo, "service-lasso/lasso-postgres");
  assert.equal(byId.get("zitadel")?.artifact?.source?.repo, "service-lasso/lasso-zitadel");
  assert.deepEqual(byId.get("zitadel")?.depend_on, ["postgres"]);
  assert.equal(byId.get("zitadel")?.enabled, true);
  assert.equal(byId.get("zitadel")?.env?.ZITADEL_EXTERNALDOMAIN, "localhost");
  assert.equal(byId.get("zitadel")?.env?.ZITADEL_EXTERNALSECURE, "false");
  assert.match(byId.get("zitadel")?.env?.ZITADEL_DATABASE_POSTGRES_DSN ?? "", /^postgresql:\/\//);
  assert.match(byId.get("zitadel")?.globalenv?.ZITADEL_ISSUER ?? "", /^http:\/\/localhost:/);
});

test("ZITADEL master key is broker-backed and no raw master key is committed", async () => {
  const manifest = await readJson("fixtures/zitadel-consumer-app/services/zitadel/service.json");
  const manifestText = await readFile(path.join(repoRoot, "fixtures", "zitadel-consumer-app", "services", "zitadel", "service.json"), "utf8");

  assert.equal(manifest.env.ZITADEL_MASTERKEY, "${identity.ZITADEL_MASTERKEY}");
  assert.deepEqual(manifest.broker.imports, [
    {
      namespace: "services/zitadel",
      ref: "identity.ZITADEL_MASTERKEY",
      as: "ZITADEL_MASTERKEY",
      required: true,
    },
  ]);
  assert.equal(manifestText.includes("<exactly-32-byte-master-key>"), false);
  assert.equal(/ZITADEL_MASTERKEY"\s*:\s*"[A-Za-z0-9_-]{32,}"/.test(manifestText), false);

  const selectorPlan = compileServiceSelectorPlan(manifest.env);
  assert.deepEqual(selectorPlan.brokerRefs, ["identity.ZITADEL_MASTERKEY"]);
});

test("core baseline remains free of optional ZITADEL", async () => {
  const coreServices = await discoverServices(path.join(repoRoot, "services"));
  const coreIds = new Set(coreServices.map((service) => service.manifest.id));

  assert.equal(coreIds.has("zitadel"), false);
  assert.equal(coreIds.has("postgres"), false);
});

test("ZITADEL consumer docs name the required app-owned contract fields", async () => {
  const docs = await readFile(path.join(repoRoot, "docs", "reference", "zitadel-consumer-integration.md"), "utf8");

  for (const requiredText of [
    "fixtures/zitadel-consumer-app/services/zitadel/service.json",
    "ZITADEL_DATABASE_POSTGRES_DSN",
    "ZITADEL_MASTERKEY",
    "PostgreSQL dependency",
    "Issuer URL",
    "Redirect URIs",
    "Client setup",
    "Do not add ZITADEL to the core baseline",
    "fail closed",
  ]) {
    assert.ok(docs.includes(requiredText), `Expected docs to include ${requiredText}`);
  }
});
