import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  QUALIFICATION_SCHEMA,
  fail,
  readJsonFile,
} from "./published-package-qualification-lib.mjs";
import {
  QUALIFICATION_PHASES,
  classifyQualificationFailure,
  preserveFirstFailure,
} from "./published-package-qualification-reliability.mjs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail("invalid_input", `${name} is required.`);
  return value;
}

function assertOwnedRunnerTempTarget(target, runnerTemp, prefix) {
  const resolved = path.resolve(target);
  const relative = path.relative(runnerTemp, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    path.dirname(relative) !== "." ||
    !path.basename(relative).startsWith(prefix)
  ) {
    fail("unsafe_cleanup_target", "Qualification cleanup target is outside its owned runner temp boundary.");
  }
  return resolved;
}

async function removeAndConfirm(target) {
  await rm(target, { recursive: true, force: true });
  const remains = await lstat(target).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
  if (remains) fail("cleanup_not_converged", "Qualification cleanup target remains present.");
}

const runnerTemp = path.resolve(requiredEnv("RUNNER_TEMP"));
const privateStatePath = path.resolve(requiredEnv("QUALIFICATION_PRIVATE_STATE_PATH"));
const safeStatePath = path.resolve(requiredEnv("QUALIFICATION_SAFE_STATE_PATH"));

let safeState;
try {
  safeState = await readJsonFile(safeStatePath, "qualification safe state");
  if (safeState.schema !== QUALIFICATION_SCHEMA) fail("invalid_evidence_schema", "Qualification safe state is invalid.");
} catch {
  safeState = {
    schema: QUALIFICATION_SCHEMA,
    retainedContent: "metadata_only",
    outcome: "failure",
    failureCode: "preparation_state_missing",
    scenarios: {},
  };
}

try {
  const privateState = JSON.parse(await readFile(privateStatePath, "utf8"));
  const downloadRoot = assertOwnedRunnerTempTarget(
    privateState.downloadRoot,
    runnerTemp,
    "service-lasso-published-downloads-",
  );
  const mutationRoot = assertOwnedRunnerTempTarget(
    privateState.mutationRoot,
    runnerTemp,
    "service-lasso-published-mutation-",
  );
  await removeAndConfirm(mutationRoot);
  await removeAndConfirm(downloadRoot);
  safeState.scenarios ??= {};
  safeState.scenarios.cleanupConvergence = "success";
} catch (error) {
  safeState.scenarios ??= {};
  safeState.scenarios.cleanupConvergence = "failure";
  const classified = classifyQualificationFailure({
    phase: QUALIFICATION_PHASES.OWNED_CLEANUP,
    error,
    mutationCount: Number(safeState.mutations?.brokerRestart ?? 0)
      + Number(safeState.mutations?.providerMigrationApply ?? 0),
  });
  safeState.firstFailure = preserveFirstFailure(safeState.firstFailure, classified);
  safeState.failurePhase = safeState.firstFailure.phase;
  safeState.failureCode = safeState.firstFailure.failureCode;
  await writeFile(safeStatePath, `${JSON.stringify(safeState, null, 2)}\n`).catch(() => {});
  throw error;
}

await writeFile(safeStatePath, `${JSON.stringify(safeState, null, 2)}\n`);
