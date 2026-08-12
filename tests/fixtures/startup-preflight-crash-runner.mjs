import {
  beginRuntimeGeneration,
  createRuntimeGenerationId,
  resolveRuntimeInstanceId,
} from "../../dist/runtime/instance/registry.js";
import {
  advanceStartupTransaction,
  beginStartupTransaction,
} from "../../dist/runtime/startup/transaction.js";

const [servicesRoot, workspaceRoot] = process.argv.slice(2);
if (!servicesRoot || !workspaceRoot) {
  throw new Error("Expected servicesRoot and workspaceRoot.");
}

const config = { servicesRoot, workspaceRoot, version: "test" };
const generationId = createRuntimeGenerationId();
let journal = await beginStartupTransaction({
  generationId,
  instanceId: resolveRuntimeInstanceId(config),
  servicesRoot,
  workspaceRoot,
});
await beginRuntimeGeneration(config, { generationId });
journal = await advanceStartupTransaction(journal, "preflight_reconciliation", {
  completedActions: ["generation_started"],
  addCompensations: ["mark_generation_failed"],
});

process.exit(86);
