/**
 * Read back Core 1.0 GitHub repository authority for issue #1164.
 * Requires `gh` authenticated against service-lasso/service-lasso.
 */
import { spawnSync } from "node:child_process";

const repository = "service-lasso/service-lasso";

/**
 * @param {string[]} args
 * @returns {unknown}
 */
function ghJson(args) {
  const result = spawnSync("gh", ["api", ...args], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `gh api failed: ${args.join(" ")}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function readProperty(value, key) {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  return value[key];
}

/**
 * @param {unknown} value
 * @returns {boolean | undefined}
 */
function readEnabledFlag(value) {
  const enabled = readProperty(value, "enabled");
  return typeof enabled === "boolean" ? enabled : undefined;
}

/**
 * @param {unknown} entry
 * @returns {string | null}
 */
function readEnvironmentName(entry) {
  const name = readProperty(entry, "name");
  return typeof name === "string" ? name : null;
}

const protection = ghJson([`repos/${repository}/branches/develop/protection`]);
const workflowPermissions = ghJson([`repos/${repository}/actions/permissions/workflow`]);
const actionPermissions = ghJson([`repos/${repository}/actions/permissions`]);
const environments = ghJson([`repos/${repository}/environments`]);

const reviews = readProperty(protection, "required_pull_request_reviews");
const checks = readProperty(protection, "required_status_checks");
const checkContexts = readProperty(checks, "contexts");
if (readProperty(reviews, "require_code_owner_reviews") !== true) {
  throw new Error("develop must require code-owner reviews");
}
if (!Array.isArray(checkContexts) || !checkContexts.includes("qualify-release")) {
  throw new Error("develop must require qualify-release");
}
if (readEnabledFlag(readProperty(protection, "enforce_admins")) !== true) {
  throw new Error("develop protection must apply to administrators");
}
if (readEnabledFlag(readProperty(protection, "allow_force_pushes")) !== false) {
  throw new Error("develop must forbid force pushes");
}

if (readProperty(workflowPermissions, "default_workflow_permissions") !== "read") {
  throw new Error("default Actions permissions must be read");
}
if (readProperty(workflowPermissions, "can_approve_pull_request_reviews") !== false) {
  throw new Error("Actions must not approve pull-request reviews");
}
if (readProperty(actionPermissions, "sha_pinning_required") !== true) {
  throw new Error("Actions SHA pinning must be required");
}

const listedEnvironments = readProperty(environments, "environments");
const environmentNames = Array.isArray(listedEnvironments)
  ? listedEnvironments.map(readEnvironmentName).filter((name) => name !== null)
  : [];
if (!environmentNames.includes("release")) {
  throw new Error("protected release environment is missing");
}

process.stdout.write(
  `${JSON.stringify(
    {
      repository,
      developProtection: {
        requireCodeOwnerReviews: readProperty(reviews, "require_code_owner_reviews"),
        requiredStatusChecks: checkContexts,
        enforceAdmins: readEnabledFlag(readProperty(protection, "enforce_admins")),
        allowForcePushes: readEnabledFlag(readProperty(protection, "allow_force_pushes")),
      },
      actions: {
        defaultWorkflowPermissions: readProperty(workflowPermissions, "default_workflow_permissions"),
        shaPinningRequired: readProperty(actionPermissions, "sha_pinning_required"),
      },
      environments: environmentNames,
    },
    null,
    2,
  )}\n`,
);
