import { startApiServer } from "../../dist/server/index.js";
import { stopManagedProcess } from "../../dist/runtime/execution/supervisor.js";

const [servicesRoot, workspaceRoot, phase, serviceToStop] = process.argv.slice(2);
if (!servicesRoot || !workspaceRoot || !phase) {
  throw new Error("Expected servicesRoot, workspaceRoot, and startup phase.");
}

await startApiServer({
  port: 0,
  servicesRoot,
  workspaceRoot,
  autostart: true,
  startupTransactionTestHooks: {
    afterPhase: async ({ phase: current }) => {
      if (current === phase) {
        if (serviceToStop) await stopManagedProcess(serviceToStop);
        process.exit(86);
      }
    },
  },
});

throw new Error(`Startup did not crash after phase ${phase}.`);
