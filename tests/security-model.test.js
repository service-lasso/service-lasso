import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createCustomAccessGroup,
  createProviderGroupMapping,
  removeActorAssignment,
  resolveProviderMappedAccessGroups,
  seedSecurityModel,
  serviceLassoPermissionCatalogue,
} from "../dist/platform/security-model.js";

const repoRoot = process.cwd();

test("security model exposes a Service Lasso-owned permission catalogue and built-in groups", () => {
  const model = seedSecurityModel("wks_local_demo", "local-root");
  const permissionKeys = serviceLassoPermissionCatalogue.map((entry) => entry.key);

  assert.ok(permissionKeys.includes("security:manage"));
  assert.ok(permissionKeys.includes("service:restart"));
  assert.ok(permissionKeys.includes("backup:restore"));
  assert.ok(permissionKeys.includes("broker:resolve-scoped"));

  assert.deepEqual(
    model.accessGroups.map((group) => group.name),
    [
      "Owner",
      "Security Admin",
      "Service Admin",
      "Operator",
      "Viewer",
      "Backup Operator",
      "Restore Operator",
      "File Export Operator",
      "Scheduler",
      "Service Identity",
    ],
  );
  assert.ok(model.accessGroups.every((group) => group.resettable));
  assert.equal(model.actorAssignments[0].actor.kind, "local-root");
  assert.equal(model.actorAssignments[0].groupId, "wks_local_demo:owner");
});

test("custom groups can only use catalogue permissions and remain default-deny until assigned", () => {
  const model = seedSecurityModel("wks_local_demo", "local-root");
  const next = createCustomAccessGroup(model, {
    id: "wks_local_demo:postgres-admins",
    name: "Postgres Admins",
    description: "Restart and diagnose Postgres only.",
    permissions: ["workspace:read", "service:restart", "service:diagnose"],
    scopeRules: [{ type: "service", id: "@postgres" }],
    createdBy: "usr_security_admin",
  });

  const group = next.accessGroups.find((candidate) => candidate.id === "wks_local_demo:postgres-admins");
  assert.ok(group);
  assert.equal(group.kind, "custom");
  assert.deepEqual(group.scopeRules, [{ type: "service", id: "@postgres" }]);
  assert.equal(next.actorAssignments.length, model.actorAssignments.length);

  assert.throws(
    () =>
      createCustomAccessGroup(model, {
        id: "wks_local_demo:bad",
        name: "Bad",
        description: "Uses an unknown permission.",
        permissions: ["provider-specific-role-string"],
        createdBy: "usr_security_admin",
      }),
    /Unknown Service Lasso permission/,
  );
});

test("provider mappings are generic and do not make Zitadel the role source", () => {
  const model = createProviderGroupMapping(seedSecurityModel("wks_local_demo", "local-root"), {
    id: "map_zitadel_admins_to_security_admin",
    provider: "zitadel",
    claimType: "group",
    claimValue: "service-lasso-admins",
    targetGroupId: "wks_local_demo:security-admin",
    createdBy: "usr_security_admin",
  });
  const withOidc = createProviderGroupMapping(model, {
    id: "map_custom_oidc_ops_to_operator",
    provider: "custom-oidc",
    claimType: "role",
    claimValue: "ops",
    targetGroupId: "wks_local_demo:operator",
    createdBy: "usr_security_admin",
  });

  assert.deepEqual(
    resolveProviderMappedAccessGroups(withOidc, {
      workspaceId: "wks_local_demo",
      provider: "zitadel",
      claims: { group: ["service-lasso-admins"], role: ["ops"] },
    }).map((group) => group.name),
    ["Security Admin"],
  );
  assert.deepEqual(
    resolveProviderMappedAccessGroups(withOidc, {
      workspaceId: "wks_local_demo",
      provider: "custom-oidc",
      claims: { role: ["ops"] },
    }).map((group) => group.name),
    ["Operator"],
  );
});

test("last-owner protection rejects removing final recovery-capable actor", () => {
  const model = seedSecurityModel("wks_local_demo", "local-root");
  const denied = removeActorAssignment(model, "wks_local_demo:assignment:local-root-owner", "usr_security_admin");

  assert.equal(denied.ok, false);
  assert.equal(!denied.ok && denied.reason, "last-owner-protection");
  assert.equal(denied.auditEvent.outcome, "denied");
  assert.equal(denied.auditEvent.reason, "last-owner-protection");
});

test("security model docs describe catalogue groups mappings and last-owner protection", async () => {
  const docs = await readFile(path.join(repoRoot, "docs", "reference", "product-api-facade.md"), "utf8");

  for (const requiredText of [
    "Permission catalogue and access groups",
    "Provider mappings are generic",
    "Owner: all permissions",
    "Security Admin: users, groups, mappings, local tokens, provider auth, audit/security settings",
    "Never allow deleting/removing the last Owner-capable actor",
  ]) {
    assert.ok(docs.includes(requiredText), `Expected docs to include ${requiredText}`);
  }
});
